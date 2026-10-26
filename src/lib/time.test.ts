import { describe, expect, it } from "vitest";
import {
  addDays,
  addMonthsClamped,
  addYears,
  compare,
  daysInMonth,
  diffDays,
  eachDay,
  endOfMonth,
  endOfWeek,
  formatRelativeZh,
  formatZh,
  isValidDateOnly,
  shiftMonth,
  startOfMonth,
  startOfWeek,
  toDateOnly,
  todayFrom,
  fromDateOnly,
} from "./time";

describe("addMonthsClamped —— 月底钳制不能退化", () => {
  it("1/31 +1 月钳到 2/28", () => {
    expect(addMonthsClamped("2026-01-31", 1, 31)).toBe("2026-02-28");
  });

  it("从 2/28 再 +1 月能拿回 3/31（锚点日号必须来自 anchorDate，不能来自上次结果）", () => {
    // 这是整个模块最容易写错的地方：若实现里用「上一次结果的日号」当锚点，
    // 2/28 的日号是 28，+1 月会得到 3/28 并从此永久停在 28。
    const feb = addMonthsClamped("2026-01-31", 1, 31);
    expect(feb).toBe("2026-02-28");
    expect(addMonthsClamped(feb, 1, 31)).toBe("2026-03-31");
  });

  it("连续推进 12 个月，每次都回到 31（不退化）", () => {
    let cursor = "2026-01-31";
    const results = [cursor];
    for (let i = 0; i < 12; i += 1) {
      cursor = addMonthsClamped(cursor, 1, 31);
      results.push(cursor);
    }
    // 只有 2 月被钳制，其余月份都应回到 31 号
    expect(results.filter((d) => d.endsWith("-31"))).toHaveLength(8);
    expect(results).toContain("2026-03-31");
    expect(results).toContain("2026-12-31");
  });

  it("闰年 2 月保留 29 号", () => {
    expect(addMonthsClamped("2028-01-31", 1, 31)).toBe("2028-02-29");
  });

  it("平年 2 月钳到 28 号", () => {
    expect(addMonthsClamped("2027-01-31", 1, 31)).toBe("2027-02-28");
  });

  it("跨年 +1 月", () => {
    expect(addMonthsClamped("2026-12-15", 1, 15)).toBe("2027-01-15");
  });

  it("跨年 -1 月", () => {
    expect(addMonthsClamped("2026-01-15", -1, 15)).toBe("2025-12-15");
  });

  it("跨多年", () => {
    expect(addMonthsClamped("2026-03-15", 25, 15)).toBe("2028-04-15");
    expect(addMonthsClamped("2026-03-15", -25, 15)).toBe("2024-02-15");
  });

  it("锚点日号超过目标月天数时钳制（30 号在 2 月）", () => {
    expect(addMonthsClamped("2026-01-30", 1, 30)).toBe("2026-02-28");
  });

  it("每月 1 号这种小日号不受影响", () => {
    expect(addMonthsClamped("2026-01-01", 1, 1)).toBe("2026-02-01");
    expect(addMonthsClamped("2026-01-01", 12, 1)).toBe("2027-01-01");
  });
});

describe("daysInMonth", () => {
  it("各月天数正确", () => {
    expect(daysInMonth(2026, 1)).toBe(31);
    expect(daysInMonth(2026, 2)).toBe(28);
    expect(daysInMonth(2027, 2)).toBe(28);
    expect(daysInMonth(2028, 2)).toBe(29);
    expect(daysInMonth(2100, 2)).toBe(28); // 百年不闰
    expect(daysInMonth(2000, 2)).toBe(29); // 四百年又闰
    expect(daysInMonth(2026, 4)).toBe(30);
    expect(daysInMonth(2026, 12)).toBe(31);
  });
});

describe("addDays", () => {
  it("基本加减", () => {
    expect(addDays("2026-09-15", 14)).toBe("2026-09-29");
    expect(addDays("2026-09-29", -14)).toBe("2026-09-15");
    expect(addDays("2026-09-15", 0)).toBe("2026-09-15");
  });

  it("跨月", () => {
    expect(addDays("2026-01-31", 1)).toBe("2026-02-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });

  it("跨年（含闰年 2/29）", () => {
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
    expect(addDays("2028-02-29", 1)).toBe("2028-03-01");
  });

  it("「31 天后」这个用户原话里的用例算得准", () => {
    // 用户原话：「提醒我 31 天后，提醒妈房子没卖出去」
    expect(addDays("2026-09-15", 31)).toBe("2026-10-16");
    expect(diffDays("2026-09-15", "2026-10-16")).toBe(31);
  });
});

describe("addYears", () => {
  it("2/29 在平年被钳到 2/28", () => {
    expect(addYears("2028-02-29", 1)).toBe("2029-02-28");
    expect(addYears("2028-02-29", 4)).toBe("2032-02-29");
  });
});

describe("diffDays / compare", () => {
  it("同一天为 0，方向正确", () => {
    expect(diffDays("2026-09-15", "2026-09-15")).toBe(0);
    expect(diffDays("2026-09-15", "2026-09-16")).toBe(1);
    expect(diffDays("2026-09-16", "2026-09-15")).toBe(-1);
    expect(diffDays("2026-01-01", "2027-01-01")).toBe(365);
    expect(diffDays("2028-01-01", "2029-01-01")).toBe(366); // 闰年
  });

  it("字典序即时间序", () => {
    expect(compare("2026-09-15", "2026-09-16")).toBe(-1);
    expect(compare("2026-09-16", "2026-09-15")).toBe(1);
    expect(compare("2026-09-15", "2026-09-15")).toBe(0);
    // 跨年、跨十年都要正确
    expect(compare("2026-12-31", "2027-01-01")).toBe(-1);
    expect(["2026-09-15", "2025-01-01", "2026-12-31"].sort(compare)).toEqual([
      "2025-01-01",
      "2026-09-15",
      "2026-12-31",
    ]);
  });
});

describe("区间边界", () => {
  it("月初 / 月末", () => {
    expect(startOfMonth("2026-09-15")).toBe("2026-09-01");
    expect(endOfMonth("2026-09-15")).toBe("2026-09-30");
    expect(endOfMonth("2026-02-10")).toBe("2026-02-28");
    expect(endOfMonth("2028-02-10")).toBe("2028-02-29");
  });

  it("周一为一周之首", () => {
    // 2026-09-15 是周二
    expect(startOfWeek("2026-09-15")).toBe("2026-09-14");
    expect(endOfWeek("2026-09-15")).toBe("2026-09-20");
    // 周一自身
    expect(startOfWeek("2026-09-14")).toBe("2026-09-14");
    // 周日应归到前一个周一，而不是开启新的一周
    expect(startOfWeek("2026-09-20")).toBe("2026-09-14");
    expect(startOfWeek("2026-09-21")).toBe("2026-09-21");
  });

  it("shiftMonth 翻页", () => {
    expect(shiftMonth("2026-01-31", 1)).toBe("2026-02-01");
    expect(shiftMonth("2026-12-15", 1)).toBe("2027-01-01");
    expect(shiftMonth("2026-01-15", -1)).toBe("2025-12-01");
  });

  it("eachDay 生成闭区间", () => {
    expect(eachDay("2026-09-15", "2026-09-15")).toEqual(["2026-09-15"]);
    expect(eachDay("2026-09-29", "2026-10-02")).toEqual([
      "2026-09-29",
      "2026-09-30",
      "2026-10-01",
      "2026-10-02",
    ]);
    expect(eachDay("2026-02-27", "2026-03-01")).toHaveLength(3);
  });
});

describe("DateOnly <-> Date 往返（@db.Date 列的读写路径）", () => {
  it("往返不丢天", () => {
    for (const s of ["2026-01-01", "2026-02-28", "2028-02-29", "2026-12-31"]) {
      expect(toDateOnly(fromDateOnly(s))).toBe(s);
    }
  });

  it("toDateOnly 用 UTC getter，不受进程时区影响", () => {
    // @db.Date 读出来是 UTC 午夜。若实现误用 getFullYear() 等本地 getter，
    // 在 UTC- 时区（如 America/New_York）会把 9/15 读成 9/14。
    // 这里断言的是「取 UTC 字段」这一实现约定。
    const utcMidnight = new Date("2026-09-15T00:00:00.000Z");
    expect(toDateOnly(utcMidnight)).toBe("2026-09-15");
  });
});

describe("todayFrom —— 时区折算", () => {
  it("北京 00:30 属于新的一天，而不是 UTC 的前一天", () => {
    // 这是整个模块存在的理由。北京时间 2026-09-16 00:30 = UTC 2026-09-15 16:30。
    // 服务端若直接用 UTC 判断「今天」，会把这次记录归到 9/15。
    const instant = new Date("2026-09-15T16:30:00.000Z");
    const beijing = todayFrom(instant);
    expect(beijing).toBe("2026-09-16");
  });

  it("北京 23:30 仍是当天，不提前跨天", () => {
    const instant = new Date("2026-09-15T15:30:00.000Z"); // 北京 23:30
    expect(todayFrom(instant)).toBe("2026-09-15");
  });

  it("UTC 正午折算成北京的当天", () => {
    const instant = new Date("2026-09-15T04:00:00.000Z"); // 北京 12:00
    expect(todayFrom(instant)).toBe("2026-09-15");
  });
});

describe("isValidDateOnly", () => {
  it("接受合法日期，含闰年 2/29", () => {
    expect(isValidDateOnly("2026-09-15")).toBe(true);
    expect(isValidDateOnly("2028-02-29")).toBe(true);
  });

  it("拒绝格式错误与不存在的日期", () => {
    expect(isValidDateOnly("2026-9-15")).toBe(false);
    expect(isValidDateOnly("2026/09/15")).toBe(false);
    expect(isValidDateOnly("2027-02-29")).toBe(false); // 平年没有 2/29
    expect(isValidDateOnly("2026-13-01")).toBe(false);
    expect(isValidDateOnly("2026-00-10")).toBe(false);
    expect(isValidDateOnly("2026-04-31")).toBe(false);
    expect(isValidDateOnly("")).toBe(false);
    expect(isValidDateOnly(null)).toBe(false);
    expect(isValidDateOnly(20260915)).toBe(false);
  });
});

describe("中文展示", () => {
  it("formatZh 带星期", () => {
    expect(formatZh("2026-09-15")).toBe("9月15日 周二");
    expect(formatZh("2026-09-20")).toBe("9月20日 周日");
  });

  it("formatRelativeZh 口语化", () => {
    const base = "2026-09-15";
    expect(formatRelativeZh("2026-09-15", base)).toBe("今天");
    expect(formatRelativeZh("2026-09-16", base)).toBe("明天");
    expect(formatRelativeZh("2026-09-17", base)).toBe("后天");
    expect(formatRelativeZh("2026-09-14", base)).toBe("昨天");
    expect(formatRelativeZh("2026-09-29", base)).toBe("14 天后");
    expect(formatRelativeZh("2026-10-16", base)).toBe("31 天后");
    expect(formatRelativeZh("2026-09-13", base)).toBe("已逾期 2 天");
  });
});
describe("指定提醒时间", () => {
  it("北京时间 15:00 对应 UTC 07:00，凌晨不能错一天", async () => {
    const { reminderInstant, clockTimeFrom } = await import("./time");
    expect(reminderInstant("2026-10-20", "15:00")?.toISOString()).toBe("2026-10-20T07:00:00.000Z");
    const midnight = reminderInstant("2026-10-20", "00:05")!;
    expect(midnight.toISOString()).toBe("2026-10-19T16:05:00.000Z");
    expect(clockTimeFrom(midnight)).toBe("00:05");
    expect(reminderInstant("2026-10-20", null)).toBeNull();
    expect(() => reminderInstant("2026-10-20", "25:60")).toThrow();
    expect(() => reminderInstant("2026-02-30", "09:00")).toThrow();
  });
});
