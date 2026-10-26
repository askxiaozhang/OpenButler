import { db } from "@/lib/db";
import {
  addDays,
  fromDateOnly,
  minDate,
  nowInstant,
  reminderInstant,
  toDateOnly,
  today,
  type DateOnly,
} from "@/lib/time";
import { nextAfterCompletion, nextOccurrence, type RecurrenceRule } from "./rules";
import type { Prisma, Recurrence, Task } from "@/generated/prisma/client";

/**
 * 周期实例的生成与推进。
 *
 * ## 生成策略：预生成有界窗口 + 读取时惰性补齐 + 唯一约束兜底
 *
 * - **不能纯动态计算**：每次发生都有自己的状态（done / skipped / 完成时刻）和
 *   关联的记录。临时算出来的实例无处存放这些状态，最终还是要物化。
 * - **不能无界预生成**：无限级数 = 无限行。
 * - **唯一约束是支点**：`@@unique([recurrenceId, dueOn])` + `skipDuplicates`
 *   保证并发触发也不会重复，所以惰性补齐可以放心跑在读路径上，**不需要分布式锁**。
 *   即使两个请求同时进来，最坏结果只是一次多余的查询。
 * - **Cron 只是加速器**：它整个挂掉也不影响正确性，读取时的惰性补齐会兜住。
 */

/** 预生成窗口。20 个周期项 × 60 天 ≈ 几十行，规模上完全无压力。 */
export const HORIZON_DAYS = 60;

/** 单个周期项一次最多物化多少条。防 interval 被写成 0 之类的脏数据导致死循环。 */
const MAX_INSTANCES_PER_RULE = 400;

/** 事务客户端类型，让推进逻辑既能独立跑、也能挂在调用方的事务里。 */
type Tx = Prisma.TransactionClient;

function ruleOf(recurrence: Recurrence): RecurrenceRule {
  return {
    freq: recurrence.freq,
    interval: recurrence.interval,
    anchorDate: toDateOnly(recurrence.anchorDate),
  };
}

/**
 * 把 `until` 之前（含）的周期实例都物化出来。
 *
 * 内部只做一次 `findMany` 判断有没有落后 —— 绝大多数请求会直接返回 0，
 * 一次写入都不发生。这是它能安全跑在每个读路径上的前提。
 *
 * @returns 本次新增的实例数
 */
export async function ensureGenerated(until?: DateOnly): Promise<number> {
  const todayStr = today();
  const horizon = minDate(until ?? addDays(todayStr, HORIZON_DAYS), addDays(todayStr, HORIZON_DAYS));
  const horizonDate = fromDateOnly(horizon);

  const rules = await db().recurrence.findMany({
    where: { active: true, nextCursorOn: { lte: horizonDate } },
  });

  if (rules.length === 0) return 0;

  let created = 0;

  for (const rule of rules) {
    const ruleSpec = ruleOf(rule);
    let cursor: DateOnly = toDateOnly(rule.nextCursorOn);
    let exhausted = false;

    const rows: Prisma.TaskCreateManyInput[] = [];

    for (let i = 0; i < MAX_INSTANCES_PER_RULE && cursor <= horizon; i += 1) {
      rows.push({
        subjectId: rule.subjectId,
        assigneeId: rule.assigneeId,
        title: rule.title,
        note: rule.note,
        dueOn: fromDateOnly(cursor),
        reminderAt: reminderInstant(cursor, rule.reminderTime),
        source: "RECURRENCE",
        recurrenceId: rule.id,
      });

      const next = nextOccurrence(ruleSpec, cursor);
      if (!next) {
        // ONCE 走完这一次就没了
        exhausted = true;
        break;
      }
      cursor = next;
    }

    // 游标推进与实例写入放在同一个事务里：否则中途失败会推进了游标却没建出
    // 待办，那段时间的提醒就永久丢了。
    await db().$transaction(async (tx) => {
      if (rows.length > 0) {
        await tx.task.createMany({ data: rows, skipDuplicates: true });
      }
      await tx.recurrence.update({
        where: { id: rule.id },
        data: exhausted
          ? { active: false }
          : { nextCursorOn: fromDateOnly(cursor) },
      });
    });

    created += rows.length;
  }

  return created;
}

/**
 * 完成一条周期待办后推进规则。
 *
 * 在调用方的事务里执行，所以签名收 `tx`。逻辑：
 *
 * - `LAST_DONE`（护理类）：删掉本次之后所有未完成的未来实例，把游标重置到
 *   「从今天/本次到期日起算的下一次」。下次读取时惰性补齐会自动填上 ——
 *   这正好实现了「晚做 3 天就顺延」，且天然幂等（重复执行结果一样）。
 * - `FIXED_SCHEDULE`（账单类）：只标完成，游标一个字节都不动。
 */
export async function applyRecurrenceOnCompletion(
  tx: Tx,
  task: Task,
  todayStr: DateOnly,
): Promise<void> {
  if (!task.recurrenceId) return;

  const recurrence = await tx.recurrence.findUnique({
    where: { id: task.recurrenceId },
  });
  if (!recurrence) return;

  const ruleSpec = ruleOf(recurrence);
  const completedDueOn = toDateOnly(task.dueOn);

  await tx.recurrence.update({
    where: { id: recurrence.id },
    data: { lastDoneOn: fromDateOnly(completedDueOn) },
  });

  const next = nextAfterCompletion(
    { ...ruleSpec, anchorOn: recurrence.anchorOn },
    { completedDueOn, today: todayStr },
  );

  // FIXED_SCHEDULE 或 ONCE：游标不动
  if (!next) return;

  // 删掉本次之后的未来未完成实例，交给惰性补齐按新基准重建。
  // 只删 PENDING —— 已经做完的历史实例必须留着。
  await tx.task.deleteMany({
    where: {
      recurrenceId: recurrence.id,
      status: "PENDING",
      dueOn: { gt: task.dueOn },
    },
  });

  await tx.recurrence.update({
    where: { id: recurrence.id },
    data: { nextCursorOn: fromDateOnly(next), active: true },
  });
}

/**
 * 撤销完成时把周期拉回正轨。
 *
 * 完成时可能已经删掉并重建了未来实例，撤销不能只是把状态改回去 ——
 * 那会留下一个和规则对不上的排期。做法是把未来未完成实例全清掉，
 * 让游标回到「本次到期日的下一次」，再靠惰性补齐重建。
 */
export async function revertRecurrenceOnUncomplete(
  tx: Tx,
  task: Task,
): Promise<void> {
  if (!task.recurrenceId) return;

  const recurrence = await tx.recurrence.findUnique({
    where: { id: task.recurrenceId },
  });
  if (!recurrence) return;

  const ruleSpec = ruleOf(recurrence);
  const dueOn = toDateOnly(task.dueOn);

  await tx.task.deleteMany({
    where: {
      recurrenceId: recurrence.id,
      status: "PENDING",
      dueOn: { gt: task.dueOn },
    },
  });

  // 游标退回「本次这条之后的下一次」，并重新激活（ONCE 完成时被停用过）
  const next = nextOccurrence(ruleSpec, dueOn);
  await tx.recurrence.update({
    where: { id: recurrence.id },
    data: {
      active: true,
      nextCursorOn: fromDateOnly(next ?? dueOn),
      lastDoneOn: null,
    },
  });
}

/**
 * 建（或复用）一个周期项。
 *
 * 用 upsert 而不是 create：同一角色下同名周期项只应存在一条
 * （`@@unique([subjectId, title])`），重复说一遍「猫咪掏耳朵」不该建出两条。
 * 这也是 AI 路径的幂等守卫。
 */
export async function upsertRecurrence(params: {
  subjectId: string;
  assigneeId?: string | null;
  title: string;
  note?: string | null;
  rule: RecurrenceRule & { anchorOn: Recurrence["anchorOn"] };
  source?: Recurrence["source"];
  /** 首次发生日。不传则用规则里的 anchorDate。 */
  startOn?: DateOnly;
  reminderTime?: string | null;
}): Promise<{ recurrence: Recurrence; created: boolean }> {
  const start = params.startOn ?? params.rule.anchorDate;
  const anchorDate = fromDateOnly(start);

  const existing = await db().recurrence.findUnique({
    where: { subjectId_title: { subjectId: params.subjectId, title: params.title } },
  });

  if (existing) {
    // 已存在就不动它的排期 —— 用户重新说一遍「猫咪掏耳朵」，语义是「记一笔」，
    // 不是「把周期重置」。重置会让已经排好的未来实例全部错位。
    return { recurrence: existing, created: false };
  }

  const recurrence = await db().recurrence.create({
    data: {
      subjectId: params.subjectId,
      assigneeId: params.assigneeId ?? null,
      title: params.title,
      note: params.note ?? null,
      freq: params.rule.freq,
      interval: params.rule.interval,
      anchorOn: params.rule.anchorOn,
      anchorDate,
      // 游标从首次发生日开始，惰性补齐会把它一路推到窗口边界
      nextCursorOn: anchorDate,
      source: params.source ?? "MANUAL",
      reminderTime: params.reminderTime ?? null,
    },
  });

  return { recurrence, created: true };
}

/** 周期项列表用的汇总信息。 */
export async function listRecurrences(includeArchived = false) {
  return db().recurrence.findMany({
    where: includeArchived ? {} : { active: true },
    include: {
      subject: true,
      _count: { select: { tasks: true, records: true } },
    },
    orderBy: [{ active: "desc" }, { createdAt: "asc" }],
  });
}

export { nowInstant };