/**
 * 全项目唯一的日期换算入口。
 *
 * ## 为什么要有这个模块
 *
 * Vercel 函数跑在 UTC，用户在北京 (UTC+8)。北京时间 00:30 时，服务端的
 * `new Date()` 是前一天 16:30 UTC —— 于是「今天掏耳朵了」会被记成昨天，
 * 14 天后的提醒也跟着错一天。这类 bug 在开发期几乎发现不了（本地时区恰好
 * 就是北京），上线后才会在半夜零星出现。
 *
 * 所以约定：**除本文件外，任何地方不得用 `new Date()` 做日期判断。**
 *
 * ## 两类日期，不要混用
 *
 * - `DateOnly`（"2026-09-15"）：日历语义。数据库里是 `@db.Date` 列。
 *   按天算的一切逻辑（到期、周期、分组、日历格子）都用它。
 * - `Date`：时间戳。数据库里是完整 `DateTime` 列，只用于排序和审计。
 *
 * `toDateOnly()` 和 `today()` 看着都是「转成 YYYY-MM-DD」，但语义完全不同：
 * 前者把 `@db.Date` 读出来的 UTC 午夜锚点还原成字符串，后者是把**此刻**
 * 按 APP_TIMEZONE 折算成当地日期。用错就会差一天，所以名字分开、注释写死。
 */

/** 日历日期，格式固定为 "YYYY-MM-DD"（字典序即时间序，可直接用于排序比较） */
export type DateOnly = string;

/** 用户所在时区。服务端渲染「今天」时以它为准。 */
export const APP_TIMEZONE = process.env.APP_TIMEZONE ?? "Asia/Shanghai";

const DATE_ONLY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MS_PER_DAY = 86_400_000;

const WEEKDAY_ZH = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"] as const;

// ---------------------------------------------------------------- 解析与格式化

export function isValidDateOnly(value: unknown): value is DateOnly {
  if (typeof value !== "string") return false;
  const m = DATE_ONLY_RE.exec(value);
  if (!m) return false;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  // 月份必须先单独校验：daysInMonth(2026, 13) 会溢出到 2027 年 1 月并「恰好」
  // 返回 31，于是 2026-13-01 会被误判为合法。
  if (month < 1 || month > 12) return false;
  return day >= 1 && day <= daysInMonth(year, month);
}

/** 把 "YYYY-MM-DD" 拆成数字。调用方保证格式合法（内部路径都经过 isValidDateOnly 或构造器）。 */
function parts(s: DateOnly): { year: number; month: number; day: number } {
  const m = DATE_ONLY_RE.exec(s);
  if (!m) throw new Error(`Invalid DateOnly: ${JSON.stringify(s)}`);
  return { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) };
}

function build(year: number, month: number, day: number): DateOnly {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** 某年某月有多少天。第 3 个参数传 0 会回退到上个月的最后一天，这是 Date 的既定行为。 */
export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

// ---------------------------------------------------------------- 时间戳

/**
 * 当前时刻，供 `*At` 审计字段使用（createdAt / completedAt / archivedAt）。
 *
 * 存在的意义是让「除 time.ts 外不许出现 `new Date()`」这条纪律可以被 grep 执行：
 * 业务代码里再看到裸的 `new Date()` 就是 bug。
 * 注意它**不能**用来判断「今天」—— 那要用 `today()`。
 */
export function nowInstant(): Date {
  return new Date();
}

// ---------------------------------------------------------------- Date <-> DateOnly

/**
 * 此刻在 APP_TIMEZONE 下是哪一天。
 *
 * `en-CA` 的 locale 输出恰好就是 YYYY-MM-DD，省掉手工拼接。
 * 这是本模块唯一允许读系统时钟的地方。
 */
export function today(): DateOnly {
  return todayFrom(new Date());
}

/** `today()` 的可注入版本。测试里传一个固定的时刻，就不用去 mock 全局时钟。 */
export function todayFrom(instant: Date): DateOnly {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: APP_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(instant);
}

/**
 * 把数据库 `@db.Date` 列读出来的 Date 还原成 DateOnly。
 *
 * `@db.Date` 在 JS 侧表现为「UTC 午夜」的 Date 对象，所以这里必须用 UTC getter。
 * 用 `getFullYear()` 之类的本地 getter 会在 UTC- 时区把日期减一天。
 */
export function toDateOnly(value: Date): DateOnly {
  return build(value.getUTCFullYear(), value.getUTCMonth() + 1, value.getUTCDate());
}

/**
 * 转成可直接写入 `@db.Date` 列的 Date。
 *
 * 锚在 UTC 午夜，于是 Prisma 写进 date 列时不会再被时区偏移影响。
 */
export function fromDateOnly(value: DateOnly): Date {
  const { year, month, day } = parts(value);
  return new Date(Date.UTC(year, month - 1, day));
}

/** Prisma 的 `@db.Date` 字段可能为 null，这个包装省掉调用方的三元表达式。 */
export function toDateOnlyOrNull(value: Date | null | undefined): DateOnly | null {
  return value ? toDateOnly(value) : null;
}

// ---------------------------------------------------------------- 算术

/**
 * 加减天数。
 *
 * 走 UTC 毫秒运算，因此不受夏令时影响 —— UTC 没有夏令时，
 * 一天恒等于 86400000 ms。（若将来支持非 UTC 时区用户的本地墙钟运算，
 * 这里要改成基于日历字段的加减。）
 */
export function addDays(value: DateOnly, days: number): DateOnly {
  const { year, month, day } = parts(value);
  const shifted = new Date(Date.UTC(year, month - 1, day) + days * MS_PER_DAY);
  return toDateOnly(shifted);
}

/**
 * 加减月份，并把「日号」钳制到目标月的合法范围内。
 *
 * `anchorDay` 必须显式传入，且应当始终来自规则的 `anchorDate`，**不要**用上一次
 * 的结果。否则会出现永久退化：1/31 →(锚点用 28)→ 2/28 → 3/28 → 4/28 …
 * 正确行为是 1/31 → 2/28 → 3/31（三月重新取回 31）。
 *
 * 这个函数是第二个必须防的 bug（第一个是时区），`time.test.ts` 里有覆盖。
 */
export function addMonthsClamped(
  value: DateOnly,
  months: number,
  anchorDay: number,
): DateOnly {
  const { year, month } = parts(value);
  // 先换算成「绝对月序」再加，避免手工处理跨年借位
  const absolute = year * 12 + (month - 1) + months;
  const targetYear = Math.floor(absolute / 12);
  const targetMonth = (absolute % 12) + 1;
  const day = Math.min(anchorDay, daysInMonth(targetYear, targetMonth));
  return build(targetYear, targetMonth, Math.max(1, day));
}

/** 加减年。2/29 在平年会被钳到 2/28。 */
export function addYears(value: DateOnly, years: number): DateOnly {
  const { year, month, day } = parts(value);
  const targetYear = year + years;
  return build(targetYear, month, Math.min(day, daysInMonth(targetYear, month)));
}

/** `b - a`，单位天。同一天为 0，b 在 a 之后为正数。 */
export function diffDays(a: DateOnly, b: DateOnly): number {
  const { year: ay, month: am, day: ad } = parts(a);
  const { year: by, month: bm, day: bd } = parts(b);
  return Math.round(
    (Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / MS_PER_DAY,
  );
}

/** 字典序即时间序，所以直接比较字符串即可。 */
export function compare(a: DateOnly, b: DateOnly): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function minDate(a: DateOnly, b: DateOnly): DateOnly {
  return a <= b ? a : b;
}

export function maxDate(a: DateOnly, b: DateOnly): DateOnly {
  return a >= b ? a : b;
}

// ---------------------------------------------------------------- 区间边界

/** 所在月的 1 号。 */
export function startOfMonth(value: DateOnly): DateOnly {
  const { year, month } = parts(value);
  return build(year, month, 1);
}

/** 所在月的最后一天。 */
export function endOfMonth(value: DateOnly): DateOnly {
  const { year, month } = parts(value);
  return build(year, month, daysInMonth(year, month));
}

/** 加减月份，日号钳到 1 号（日历翻页用，不涉及锚点语义）。 */
export function shiftMonth(value: DateOnly, months: number): DateOnly {
  return addMonthsClamped(startOfMonth(value), months, 1);
}

/** 所在周的周一。中国人习惯把周一当一周之首。 */
export function startOfWeek(value: DateOnly): DateOnly {
  const { year, month, day } = parts(value);
  // getUTCDay(): 0=周日 … 6=周六。转换成「距离本周一几天」。
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  const offset = (weekday + 6) % 7;
  return addDays(value, -offset);
}

export function endOfWeek(value: DateOnly): DateOnly {
  return addDays(startOfWeek(value), 6);
}

/** 生成 [from, to] 闭区间内的每一天。日历格子、批量查询都用它。 */
export function eachDay(from: DateOnly, to: DateOnly): DateOnly[] {
  const out: DateOnly[] = [];
  const total = diffDays(from, to);
  for (let i = 0; i <= total; i += 1) out.push(addDays(from, i));
  return out;
}

// ---------------------------------------------------------------- 中文展示

/** "9月15日 周一" */
export function formatZh(value: DateOnly): string {
  const { month, day } = parts(value);
  return `${month}月${day}日 ${WEEKDAY_ZH[weekdayIndex(value)]}`;
}

/** "2026年9月15日 周一" */
export function formatZhFull(value: DateOnly): string {
  const { year, month, day } = parts(value);
  return `${year}年${month}月${day}日 ${WEEKDAY_ZH[weekdayIndex(value)]}`;
}

/** "9月15日" */
export function formatZhShort(value: DateOnly): string {
  const { month, day } = parts(value);
  return `${month}月${day}日`;
}

/** 日号（1-31）。MONTHLY 周期规则靠它做月底钳制。 */
export function dayOfMonth(value: DateOnly): number {
  return parts(value).day;
}

/** 0=周日 … 6=周六 */
export function weekdayIndex(value: DateOnly): number {
  const { year, month, day } = parts(value);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

/**
 * 相对今天的口语化描述："今天" / "明天" / "3 天后" / "已逾期 2 天"。
 *
 * `base` 由调用方传入而不是内部调 `today()` —— 这样纯函数保持可测，
 * 也强制调用方想清楚「以哪一天为基准」。
 */
export function formatRelativeZh(value: DateOnly, base: DateOnly): string {
  const delta = diffDays(base, value);
  if (delta === 0) return "今天";
  if (delta === 1) return "明天";
  if (delta === 2) return "后天";
  if (delta === -1) return "昨天";
  if (delta > 0) return `${delta} 天后`;
  return `已逾期 ${-delta} 天`;
}

/** 本地墙钟 HH:mm，统一使用家庭时区，不使用浏览器/服务器所在时区。 */
export function isValidClockTime(value: unknown): value is string {
  return typeof value === "string" && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value);
}

export function clockTimeFrom(instant: Date): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: APP_TIMEZONE, hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).format(instant);
}

/** 把家庭时区的日期、时间转换成 UTC 时刻。往返校验拒绝不存在的夏令时时间。 */
export function reminderInstant(date: DateOnly, time?: string | null): Date | null {
  if (!time) return null;
  if (!isValidDateOnly(date) || !isValidClockTime(time)) throw new Error("提醒日期或时间无效");
  const target = Date.parse(`${date}T${time}:00Z`);
  let instant = new Date(target);
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const local = Date.parse(`${todayFrom(instant)}T${clockTimeFrom(instant)}:00Z`);
    if (local === target) return instant;
    instant = new Date(instant.getTime() + target - local);
  }
  throw new Error("这个提醒时间在家庭时区不存在，请换一个时间");
}

/** 调度租约/退避时间，业务模块不直接构造 Date。 */
export function minutesAfter(instant: Date, minutes: number): Date {
  return new Date(instant.getTime() + minutes * 60_000);
}
