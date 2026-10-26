"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth/guard";
import { fail, ok, type ActionResult } from "@/lib/action-result";
import { taskInputFromForm, taskInputSchema } from "@/lib/validation/entry";
import { clockTimeFrom, fromDateOnly, nowInstant, reminderInstant, today } from "@/lib/time";
import {
  applyRecurrenceOnCompletion,
  ensureGenerated,
  revertRecurrenceOnUncomplete,
} from "@/lib/recurrence/engine";
import type { Task } from "@/generated/prisma/client";

/**
 * 待办的增删改。
 *
 * 每个 action 都以 `requireUser()` 开头 —— Server Action 是可以被直接调用的
 * HTTP 端点，不能假设调用方一定经过了页面。
 */

function revalidateTaskSurfaces() {
  // 待办出现在首页、待办页、日历，完成状态还会影响首页角标
  revalidatePath("/", "layout");
}

/** 新建一次性待办。周期待办由周期引擎生成，不走这里。 */
export async function createTask(
  _prev: ActionResult<Task> | null,
  formData: FormData,
): Promise<ActionResult<Task>> {
  // requireUser() 用 React cache 包过，同一次请求内重复调用只查一次库
  const user = await requireUser();

  const parsed = taskInputSchema.safeParse(taskInputFromForm(formData));
  if (!parsed.success) {
    return fail("请检查填写的内容", parsed.error.flatten().fieldErrors);
  }

  const { subjectId, assigneeId, title, note, dueOn, reminderTime } = parsed.data;

  try {
    const task = await db().task.create({
      data: {
        subjectId: subjectId ?? null,
        assigneeId: assigneeId ?? null,
        title,
        note,
        dueOn: fromDateOnly(dueOn),
        reminderAt: reminderInstant(dueOn, reminderTime),
        source: "MANUAL",
        authorId: user.id,
      },
    });
    revalidateTaskSurfaces();
    return ok(task);
  } catch (e) {
    console.error("[createTask]", e);
    return fail("创建失败，请稍后重试");
  }
}

/**
 * 完成一条待办。
 *
 * 阶段 3 只做「标记完成 + 记一笔事件」；周期项的「自动排下一次」在阶段 4
 * 接到 `onTaskCompleted` 上。
 *
 * `createRecord` 默认为 true —— 「做了就是发生了」，记录流因此会自动丰满，
 * 不用再手动补记一遍。
 */
export async function completeTask(
  taskId: string,
  options: { createRecord?: boolean } = {},
): Promise<ActionResult<Task>> {
  const user = await requireUser();
  const { createRecord = true } = options;

  const task = await db().task.findUnique({
    where: { id: taskId },
    include: { recurrence: true },
  });
  if (!task) return fail("待办不存在");
  if (task.status === "DONE") return ok(task); // 幂等：重复点不出错

  const todayStr = today();

  const updated = await db().$transaction(async (tx) => {
    const next = await tx.task.update({
      where: { id: taskId },
      data: { status: "DONE", completedAt: nowInstant() },
    });

    // 记一笔事件，把「完成了哪条待办」串起来。
    // taskId 上有唯一约束，所以重复调用不会记出两条。
    if (createRecord) {
      const existing = await tx.record.findUnique({ where: { taskId } });
      if (!existing) {
        await tx.record.create({
          data: {
            subjectId: task.subjectId,
            assigneeId: task.assigneeId,
            title: task.title,
            note: task.note,
            occurredOn: fromDateOnly(todayStr),
            source: task.recurrenceId ? "RECURRENCE" : "MANUAL",
            authorId: user.id,
            taskId: task.id,
            recurrenceId: task.recurrenceId,
          },
        });
      }
    }

    // 周期项：排下一次（LAST_DONE 会顺延，FIXED_SCHEDULE 不动游标）。
    // 放在同一个事务里 —— 完成状态和排期必须一起生效，
    // 否则中途失败会留下「已标记完成但下一次没排」的空档。
    await applyRecurrenceOnCompletion(tx, task, todayStr);

    return next;
  });

  revalidateTaskSurfaces();
  return ok(updated);
}
export async function uncompleteTask(taskId: string): Promise<ActionResult<Task>> {
  await requireUser();

  const task = await db().task.findUnique({ where: { id: taskId } });
  if (!task) return fail("待办不存在");

  const updated = await db().$transaction(async (tx) => {
    // 一并删掉完成时生成的那条记录，否则记录流里会留下一条「做过但其实没做」
    await tx.record.deleteMany({ where: { taskId } });
    const next = await tx.task.update({
      where: { id: taskId },
      data: { status: "PENDING", completedAt: null },
    });
    // 周期项的排期也要拉回正轨 —— 只改状态会留下和规则对不上的排期
    await revertRecurrenceOnUncomplete(tx, task);
    return next;
  });

  revalidateTaskSurfaces();
  return ok(updated);
}

/** 跳过这条待办（这次不做了）。 */
export async function skipTask(taskId: string): Promise<ActionResult<Task>> {
  await requireUser();

  const task = await db().task.findUnique({ where: { id: taskId } });
  if (!task) return fail("待办不存在");

  const updated = await db().task.update({
    where: { id: taskId },
    data: { status: "SKIPPED", completedAt: nowInstant() },
  });

  revalidateTaskSurfaces();
  return ok(updated);
}

/** 改期。原定那天没做，推到另一天。 */
export async function rescheduleTask(
  taskId: string,
  dueOn: string,
): Promise<ActionResult<Task>> {
  await requireUser();

  const parsed = taskInputSchema.pick({ dueOn: true }).safeParse({ dueOn });
  if (!parsed.success) return fail("日期格式不对");

  const task = await db().task.findUnique({ where: { id: taskId } });
  if (!task) return fail("待办不存在");
  const updated = await db().task.update({
    where: { id: taskId },
    data: { dueOn: fromDateOnly(parsed.data.dueOn), reminderAt: reminderInstant(parsed.data.dueOn, task.reminderAt ? clockTimeFrom(task.reminderAt) : null), reminderSentAt: null, qqReminderSentAt: null },
  });

  revalidateTaskSurfaces();
  return ok(updated);
}

/**
 * 读取前先补齐周期实例。所有读待办的页面都应先调它。
 *
 * 放在这里而不是页面里，是为了让「哪些读路径会触发生成」这件事有个统一的
 * 清单 —— 新加页面时容易忘记调，而忘了的表现是「这个周期项在某个页面
 * 莫名不出现」，很难联想到是生成没跑。
 */
export async function ensureTaskInstances(): Promise<void> {
  await ensureGenerated();
}

/** 删除待办。仅用于「建错了」，正常流程应该用完成或跳过。 */
export async function deleteTask(taskId: string): Promise<ActionResult<void>> {
  await requireUser();
  try {
    await db().task.delete({ where: { id: taskId } });
    revalidateTaskSurfaces();
    return ok();
  } catch (e) {
    console.error("[deleteTask]", e);
    return fail("删除失败");
  }
}
/** 给已有待办设置/移除指定时间。重设后允许在新时间再次提醒。 */
export async function setTaskReminder(
  taskId: string,
  dueOn: string,
  reminderTime: string,
): Promise<ActionResult> {
  await requireUser();
  const parsed = taskInputSchema.pick({ dueOn: true, reminderTime: true }).safeParse({ dueOn, reminderTime });
  if (!parsed.success) return fail("请检查提醒日期和时间");
  try {
    await db().$transaction(async (tx) => {
      const task = await tx.task.findUnique({ where: { id: taskId } });
      if (!task || task.status !== "PENDING") throw new Error("只能设置未完成待办的提醒");
      await tx.task.update({
        where: { id: taskId },
        data: {
          dueOn: fromDateOnly(parsed.data.dueOn),
          reminderAt: reminderInstant(parsed.data.dueOn, parsed.data.reminderTime),
          reminderSentAt: null, qqReminderSentAt: null,
        },
      });
      await tx.pushDelivery.deleteMany({ where: { taskId } });
      await tx.qqReminderDelivery.deleteMany({ where: { taskId } });
    });
    revalidateTaskSurfaces();
    return ok();
  } catch {
    return fail("设置提醒失败，请确认待办尚未完成");
  }
}
