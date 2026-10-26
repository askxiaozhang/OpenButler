import { db } from "@/lib/db";
import { ensureGenerated, upsertRecurrence } from "@/lib/recurrence/engine";
import { clockTimeFrom, fromDateOnly, nowInstant, reminderInstant, today } from "@/lib/time";
import type { IntakeAction } from "./types";

/**
 * AI、网页对话和 QQ 对话共用的唯一写入入口。
 * 调用方只能传服务端生成或已经由确认卡片展示过的计划。
 */
export async function applyIntakeActions(
  actions: IntakeAction[],
  authorId: string,
): Promise<number> {
  if (!Array.isArray(actions) || actions.length === 0) {
    throw new Error("没有要保存的内容");
  }
  if (actions.length > 20) {
    throw new Error("一次最多处理 20 条");
  }

  let created = 0;
  for (const action of actions) {
    created += await applyAction(action, authorId);
  }

  // 新建周期项后立刻铺出窗口内的待办，所有入口都能马上看到结果。
  await ensureGenerated();
  return created;
}

async function applyAction(action: IntakeAction, authorId: string): Promise<number> {
  switch (action.type) {
    case "createRecord": {
      await db().$transaction(async (tx) => {
        const recurrence =
          action.followUp && action.subjectId
            ? await upsertRecurrenceTx(tx, {
                subjectId: action.subjectId,
                assigneeId: action.assigneeId,
                title: action.followUp.title,
                rule: action.followUp,
                source: "AI",
              })
            : null;

        await tx.record.create({
          data: {
            subjectId: action.subjectId,
            assigneeId: action.assigneeId,
            title: action.title,
            note: action.note ?? null,
            occurredOn: fromDateOnly(action.occurredOn),
            source: "AI",
            authorId,
            recurrenceId: recurrence?.id ?? null,
          },
        });
      });
      return 1;
    }

    case "createTask": {
      await db().$transaction(async (tx) => {
        const recurrence =
          action.followUp && action.subjectId
            ? await upsertRecurrenceTx(tx, {
                subjectId: action.subjectId,
                assigneeId: action.assigneeId,
                title: action.followUp.title,
                rule: action.followUp,
                source: "AI",
              })
            : null;

        await tx.task.create({
          data: {
            subjectId: action.subjectId,
            assigneeId: action.assigneeId,
            title: action.title,
            note: action.note ?? null,
            dueOn: fromDateOnly(action.dueOn),
            reminderAt: reminderInstant(action.dueOn, action.reminderTime),
            source: "AI",
            authorId,
            recurrenceId: recurrence?.id ?? null,
          },
        });
      });
      return 1;
    }

    case "createRoutines": {
      for (const item of action.items) {
        await upsertRecurrence({
          subjectId: action.subjectId,
          title: item.title,
          rule: {
            freq: item.freq,
            interval: item.interval,
            anchorOn: item.anchorOn,
            anchorDate: item.startOn,
          },
          startOn: item.startOn,
          reminderTime: item.reminderTime,
          source: "AI",
        });
      }
      return action.items.length;
    }

    case "completeTask": {
      const task = await db().task.findUnique({ where: { id: action.taskId } });
      if (!task || task.status === "DONE") return 0;

      await db().$transaction(async (tx) => {
        await tx.task.update({
          where: { id: task.id },
          data: { status: "DONE", completedAt: nowInstant() },
        });
        const existing = await tx.record.findUnique({ where: { taskId: task.id } });
        if (!existing) {
          await tx.record.create({
            data: {
              subjectId: task.subjectId,
              assigneeId: task.assigneeId,
              title: task.title,
              occurredOn: fromDateOnly(today()),
              source: "AI",
              authorId,
              taskId: task.id,
              recurrenceId: task.recurrenceId,
            },
          });
        }
      });
      return 1;
    }

    case "reschedule": {
      const task = await db().task.findUnique({ where: { id: action.taskId } });
      if (!task) return 0;
      await db().task.update({
        where: { id: action.taskId },
        data: { dueOn: fromDateOnly(action.dueOn), reminderAt: reminderInstant(action.dueOn, task.reminderAt ? clockTimeFrom(task.reminderAt) : null), reminderSentAt: null, qqReminderSentAt: null },
      });
      return 1;
    }
  }
}

async function upsertRecurrenceTx(
  tx: Parameters<Parameters<ReturnType<typeof db>["$transaction"]>[0]>[0],
  params: {
    subjectId: string;
    assigneeId?: string | null;
    title: string;
    rule: {
      freq: "DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY";
      interval: number;
      anchorOn: "LAST_DONE" | "FIXED_SCHEDULE";
      startOn: string;
      reminderTime?: string | null;
    };
    source: "AI";
  },
) {
  const existing = await tx.recurrence.findUnique({
    where: { subjectId_title: { subjectId: params.subjectId, title: params.title } },
  });
  if (existing) return existing;

  return tx.recurrence.create({
    data: {
      subjectId: params.subjectId,
      assigneeId: params.assigneeId ?? null,
      title: params.title,
      freq: params.rule.freq,
      interval: Math.max(1, params.rule.interval),
      anchorOn: params.rule.anchorOn,
      anchorDate: fromDateOnly(params.rule.startOn),
      nextCursorOn: fromDateOnly(params.rule.startOn),
      source: params.source,
      reminderTime: params.rule.reminderTime ?? null,
    },
  });
}
