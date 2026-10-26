import { addDays, addMonthsClamped, addYears, dayOfMonth, type DateOnly } from "@/lib/time";
import type { AnchorOn, Freq } from "@/generated/prisma/client";

/**
 * 周期规则的推进逻辑 —— 纯函数，不碰数据库，全部可测。
 *
 * ## 为什么不用 rrule 字符串
 *
 * 需求只覆盖「每 N 天 / 每 N 周 / 每 N 月 / 每 N 年 / 仅一次」这几档，
 * 结构化字段（freq + interval + anchorDate）就够，且：
 * - 数据库里可读、可直接在表单里编辑
 * - **LLM 输出它的可靠性远高于输出 rrule 字符串** —— `{"freq":"MONTHLY","interval":1}`
 *   几乎不会错，`"FREQ=MONTHLY;BYMONTHDAY=1"` 经常错一个分号
 *
 * 真需要复杂规则时，加一个可空的 `rruleOverride` 作为逃生舱即可，不影响现有数据。
 */

export interface RecurrenceRule {
  freq: Freq;
  interval: number;
  anchorDate: DateOnly;
}

/**
 * 从 `from` 推进一个周期，返回下一次的日期。
 *
 * `from` 通常是规则的游标 `nextCursorOn`（下一个尚未物化的日期），
 * 所以这里是「推进一格」而不是「找出 from 之后第一个符合条件的日期」。
 * 后者需要解同余方程，对本项目的规则形态是过度设计。
 *
 * ONCE 返回 null —— 表示「没有下一次」。
 */
export function nextOccurrence(rule: RecurrenceRule, from: DateOnly): DateOnly | null {
  const step = Math.max(1, Math.trunc(rule.interval));

  switch (rule.freq) {
    case "ONCE":
      return null;
    case "DAILY":
      return addDays(from, step);
    case "WEEKLY":
      return addDays(from, 7 * step);
    case "MONTHLY":
      // 日号必须取自 anchorDate 而不是 from —— 否则 1/31 → 2/28 → 3/28
      // 会永久退化成 28 号（见 addMonthsClamped 的注释与测试）
      return addMonthsClamped(from, step, dayOfMonth(rule.anchorDate));
    case "YEARLY":
      return addYears(from, step);
  }
}

/** 规则的第一次发生。ONCE 之外，游标初始值就是它。 */
export function firstOccurrence(rule: RecurrenceRule): DateOnly {
  return rule.anchorDate;
}

/**
 * 完成一次周期任务后，下一次从哪天算起。
 *
 * - `LAST_DONE`（护理类）：从**实际做的这天**算起。掏耳朵每 14 天，
 *   晚了 3 天做，下次就该是今天 +14 天，而不是原计划的 +11 天。
 *   取 `max(today, 本次到期日)` 而不是直接用 today —— 补做一条很久以前
 *   的逾期项时，用 today 才对；而提前做（today < 本次到期日）时，
 *   用本次到期日可以避免把周期整体往前拽。
 * - `FIXED_SCHEDULE`（账单类）：钉死在日历上，下一次与你有没做、早做晚做无关。
 *   返回 null 表示「游标不用动」。
 */
export function nextAfterCompletion(
  rule: RecurrenceRule & { anchorOn: AnchorOn },
  params: { completedDueOn: DateOnly; today: DateOnly },
): DateOnly | null {
  if (rule.freq === "ONCE") return null;
  if (rule.anchorOn === "FIXED_SCHEDULE") return null;

  const base =
    params.today > params.completedDueOn ? params.today : params.completedDueOn;
  return nextOccurrence(rule, base);
}

/**
 * 人类可读的周期描述。用在周期项列表和确认卡片上。
 *
 * 「每 1 天」要说成「每天」，「每 14 天」才说「每 14 天」——
 * 直接拼数字出来会很生硬。
 */
export function describeRule(rule: RecurrenceRule): string {
  const n = Math.max(1, Math.trunc(rule.interval));

  if (rule.freq === "ONCE") return "仅一次";

  const unit: Record<Exclude<Freq, "ONCE">, string> = {
    DAILY: "天",
    WEEKLY: "周",
    MONTHLY: "个月",
    YEARLY: "年",
  };

  const u = unit[rule.freq as Exclude<Freq, "ONCE">];
  if (n === 1) {
    if (rule.freq === "DAILY") return "每天";
    if (rule.freq === "WEEKLY") return "每周";
    if (rule.freq === "MONTHLY") return `每月 ${dayOfMonth(rule.anchorDate)} 号`;
    return "每年";
  }
  return `每 ${n} ${u}`;
}

/** 锚点语义的中文说明，表单里当下拉项的副标题用。 */
export function describeAnchor(anchorOn: AnchorOn): string {
  return anchorOn === "LAST_DONE"
    ? "从上次完成那天算起（护理类，晚做会顺延）"
    : "固定在日历上（账单类，早晚做都一样）";
}