"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth/guard";
import { fail, fromPrismaError, ok, type ActionResult } from "@/lib/action-result";
import { routineInputFromForm, routineInputSchema } from "@/lib/validation/routine";
import { ensureGenerated, upsertRecurrence } from "@/lib/recurrence/engine";
import { fromDateOnly, today } from "@/lib/time";
import type { Recurrence } from "@/generated/prisma/client";

/**
 * 周期项的增删改。
 *
 * 周期项的「删除」是**停用**而不是真删：已经生成的历史待办和记录都挂在它上面，
 * 硬删会级联带走这些历史（`onDelete: Cascade`），「猫咪去年掏过几次耳朵」
 * 就再也答不上来了。
 */

function revalidateRoutineSurfaces() {
  revalidatePath("/", "layout");
}

export async function createRoutine(
  _prev: ActionResult<Recurrence> | null,
  formData: FormData,
): Promise<ActionResult<Recurrence>> {
  await requireUser();

  const parsed = routineInputSchema.safeParse(routineInputFromForm(formData));
  if (!parsed.success) {
    return fail("请检查填写的内容", parsed.error.flatten().fieldErrors);
  }

  const { subjectId, assigneeId, title, note, freq, interval, anchorOn, startOn, reminderTime } =
    parsed.data;

  try {
    const { recurrence } = await upsertRecurrence({
      subjectId,
      assigneeId: assigneeId ?? null,
      title,
      note,
      rule: { freq, interval, anchorOn, anchorDate: startOn },
      startOn,
      reminderTime,
      source: "MANUAL",
    });

    // 立刻把窗口内的实例铺出来，用户建完马上能在待办页看到，而不是等下次读
    await ensureGenerated();

    revalidateRoutineSurfaces();
    return ok(recurrence);
  } catch (e) {
    return fromPrismaError(e, "createRoutine", {
      subjectId_title: "这个角色下已经有同名的周期项了",
    });
  }
}

export async function updateRoutine(
  id: string,
  _prev: ActionResult<Recurrence> | null,
  formData: FormData,
): Promise<ActionResult<Recurrence>> {
  await requireUser();

  const parsed = routineInputSchema.safeParse(routineInputFromForm(formData));
  if (!parsed.success) {
    return fail("请检查填写的内容", parsed.error.flatten().fieldErrors);
  }

  const { subjectId, assigneeId, title, note, freq, interval, anchorOn, startOn, reminderTime } =
    parsed.data;

  try {
    // 改了规则就要重建未来的实例 —— 否则用户会看到按旧规则排出来的待办
    // 挂在那里，怎么改都不消失。
    const recurrence = await db().$transaction(async (tx) => {
      const updated = await tx.recurrence.update({
        where: { id },
        data: {
          subjectId,
          assigneeId: assigneeId ?? null,
          title,
          note,
          freq,
          interval,
          anchorOn,
          reminderTime,
          anchorDate: fromDateOnly(startOn),
          // 游标退回到新的起点，让惰性补齐按新规则重铺
          nextCursorOn: fromDateOnly(startOn),
          active: true,
        },
      });

      // 只删未来的未完成实例，历史（已完成 + 已生成的记录）原样保留
      await tx.task.deleteMany({
        where: {
          recurrenceId: id,
          status: "PENDING",
          dueOn: { gte: fromDateOnly(startOn) },
        },
      });

      return updated;
    });

    await ensureGenerated();

    revalidateRoutineSurfaces();
    return ok(recurrence);
  } catch (e) {
    return fromPrismaError(e, "updateRoutine", {
      subjectId_title: "这个角色下已经有同名的周期项了",
    });
  }
}

/** 停用。不再生成新的实例，历史完整保留。 */
export async function deactivateRoutine(
  id: string,
): Promise<ActionResult<Recurrence>> {
  await requireUser();

  const recurrence = await db().$transaction(async (tx) => {
    const updated = await tx.recurrence.update({
      where: { id },
      data: { active: false },
    });
    // 同时清掉还没做的未来实例，否则停用了待办还挂在那儿，很困惑
    await tx.task.deleteMany({
      where: {
        recurrenceId: id,
        status: "PENDING",
        dueOn: { gte: fromDateOnly(today()) },
      },
    });
    return updated;
  });

  revalidateRoutineSurfaces();
  return ok(recurrence);
}

/** 重新启用。游标如果已经落在过去，会被惰性补齐推回来。 */
export async function reactivateRoutine(
  id: string,
): Promise<ActionResult<Recurrence>> {
  await requireUser();

  const recurrence = await db().recurrence.update({
    where: { id },
    data: { active: true },
  });

  // 停用期间游标没动，可能已经落后很久了 —— 补齐会把落到过去的一次性铺出来，
  // 用户会看到一堆逾期项。这里先把游标推到今天，避免「一启用就欠了一屁股债」。
  const todayStr = today();
  const cursorIsPast = recurrence.nextCursorOn < fromDateOnly(todayStr);
  if (cursorIsPast) {
    await db().recurrence.update({
      where: { id },
      data: { nextCursorOn: fromDateOnly(todayStr) },
    });
  }

  await ensureGenerated();

  revalidateRoutineSurfaces();
  return ok(recurrence);
}

/** 真删。会级联带走所有历史实例和记录，仅用于「建错了」。 */
export async function deleteRoutine(id: string): Promise<ActionResult<void>> {
  await requireUser();
  try {
    await db().recurrence.delete({ where: { id } });
    revalidateRoutineSurfaces();
    return ok();
  } catch (e) {
    console.error("[deleteRoutine]", e);
    return fail("删除失败");
  }
}