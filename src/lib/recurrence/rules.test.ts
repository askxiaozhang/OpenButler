import { describe, expect, it } from "vitest";
import {
  describeRule,
  firstOccurrence,
  nextAfterCompletion,
  nextOccurrence,
  type RecurrenceRule,
} from "./rules";

const daily14: RecurrenceRule = {
  freq: "DAILY",
  interval: 14,
  anchorDate: "2026-09-15",
};

describe("nextOccurrence —— 用户的核心用例：猫咪每 14 天掏耳朵", () => {
  it("每 14 天推进", () => {
    expect(nextOccurrence(daily14, "2026-09-15")).toBe("2026-09-29");
    expect(nextOccurrence(daily14, "2026-09-29")).toBe("2026-10-13");
  });

  it("连续推进 10 次都恰好间隔 14 天", () => {
    let cursor = "2026-09-15";
    const dates: string[] = [cursor];
    for (let i = 0; i < 10; i += 1) {
      cursor = nextOccurrence(daily14, cursor)!;
      dates.push(cursor);
    }
    expect(dates[1]).toBe("2026-09-29");
    expect(dates[10]).toBe("2027-02-02");
    // 每一次间隔都精确等于 14 天
    for (let i = 1; i < dates.length; i += 1) {
      const [ay, am, ad] = dates[i - 1].split("-").map(Number);
      const [by, bm, bd] = dates[i].split("-").map(Number);
      const diff =
        (Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86_400_000;
      expect(diff).toBe(14);
    }
  });
});

describe("nextOccurrence —— 各频率", () => {
  it("每天 / 每 N 天", () => {
    const r: RecurrenceRule = { freq: "DAILY", interval: 1, anchorDate: "2026-09-15" };
    expect(nextOccurrence(r, "2026-09-15")).toBe("2026-09-16");
    expect(nextOccurrence({ ...r, interval: 3 }, "2026-09-15")).toBe("2026-09-18");
  });

  it("每周 / 每 N 周", () => {
    const r: RecurrenceRule = { freq: "WEEKLY", interval: 1, anchorDate: "2026-09-15" };
    expect(nextOccurrence(r, "2026-09-15")).toBe("2026-09-22");
    expect(nextOccurrence({ ...r, interval: 2 }, "2026-09-15")).toBe("2026-09-29");
  });

  it("每月 / 每 N 月", () => {
    const r: RecurrenceRule = { freq: "MONTHLY", interval: 1, anchorDate: "2026-09-01" };
    expect(nextOccurrence(r, "2026-09-01")).toBe("2026-10-01");
    expect(nextOccurrence({ ...r, interval: 3 }, "2026-09-01")).toBe("2026-12-01");
  });

  it("每年", () => {
    const r: RecurrenceRule = { freq: "YEARLY", interval: 1, anchorDate: "2026-09-15" };
    expect(nextOccurrence(r, "2026-09-15")).toBe("2027-09-15");
  });

  it("ONCE 返回 null", () => {
    const r: RecurrenceRule = { freq: "ONCE", interval: 1, anchorDate: "2026-09-15" };
    expect(nextOccurrence(r, "2026-09-15")).toBeNull();
    expect(firstOccurrence(r)).toBe("2026-09-15");
  });

  it("interval 为 0 或负数时按 1 处理，不会死循环", () => {
    const r: RecurrenceRule = { freq: "DAILY", interval: 0, anchorDate: "2026-09-15" };
    expect(nextOccurrence(r, "2026-09-15")).toBe("2026-09-16");
    expect(nextOccurrence({ ...r, interval: -5 }, "2026-09-15")).toBe("2026-09-16");
  });
});

describe("MONTHLY 的月底钳制 —— 与 time.ts 的 addMonthsClamped 呼应", () => {
  it("31 号：1/31 → 2/28 → 3/31（不退化成 28）", () => {
    const r: RecurrenceRule = {
      freq: "MONTHLY",
      interval: 1,
      anchorDate: "2026-01-31",
    };
    const feb = nextOccurrence(r, "2026-01-31");
    expect(feb).toBe("2026-02-28");
    // 关键：日号取自 anchorDate（31），所以三月能拿回 31 号
    expect(nextOccurrence(r, feb!)).toBe("2026-03-31");
  });

  it("闰年保留 29 号", () => {
    const r: RecurrenceRule = {
      freq: "MONTHLY",
      interval: 1,
      anchorDate: "2028-01-31",
    };
    expect(nextOccurrence(r, "2028-01-31")).toBe("2028-02-29");
  });

  it("1 号这种小日号不受影响", () => {
    const r: RecurrenceRule = { freq: "MONTHLY", interval: 1, anchorDate: "2026-01-01" };
    let cursor = "2026-01-01";
    for (let i = 0; i < 12; i += 1) cursor = nextOccurrence(r, cursor)!;
    expect(cursor).toBe("2027-01-01");
  });
});

describe("nextAfterCompletion —— 晚做要顺延（LAST_DONE）", () => {
  const care: RecurrenceRule & { anchorOn: "LAST_DONE" | "FIXED_SCHEDULE" } = {
    freq: "DAILY",
    interval: 14,
    anchorDate: "2026-09-01",
    anchorOn: "LAST_DONE",
  };

  it("准时做：下次 = 本次到期日 + 14 天", () => {
    expect(
      nextAfterCompletion(care, { completedDueOn: "2026-09-15", today: "2026-09-15" }),
    ).toBe("2026-09-29");
  });

  it("晚做 3 天：下次从今天算起，而不是从原到期日算起", () => {
    // 原定 9/15 做，拖到 9/18 才做 → 下次是 10/2，不是 9/29
    expect(
      nextAfterCompletion(care, { completedDueOn: "2026-09-15", today: "2026-09-18" }),
    ).toBe("2026-10-02");
  });

  it("提前做：仍以本次到期日为基准，不把周期往前拽", () => {
    expect(
      nextAfterCompletion(care, { completedDueOn: "2026-09-15", today: "2026-09-10" }),
    ).toBe("2026-09-29");
  });

  it("FIXED_SCHEDULE 返回 null（表示游标不动，钉死在日历上）", () => {
    expect(
      nextAfterCompletion(
        { ...care, anchorOn: "FIXED_SCHEDULE" },
        { completedDueOn: "2026-09-15", today: "2026-09-25" },
      ),
    ).toBeNull();
  });

  it("ONCE 返回 null", () => {
    expect(
      nextAfterCompletion(
        { ...care, freq: "ONCE" },
        { completedDueOn: "2026-09-15", today: "2026-09-18" },
      ),
    ).toBeNull();
  });
});

describe("describeRule", () => {
  it("间隔为 1 时说「每天/每周/每年」而不是「每 1 天」", () => {
    expect(describeRule({ freq: "DAILY", interval: 1, anchorDate: "2026-09-15" })).toBe("每天");
    expect(describeRule({ freq: "WEEKLY", interval: 1, anchorDate: "2026-09-15" })).toBe("每周");
    expect(describeRule({ freq: "YEARLY", interval: 1, anchorDate: "2026-09-15" })).toBe("每年");
  });

  it("每月带出日号", () => {
    expect(describeRule({ freq: "MONTHLY", interval: 1, anchorDate: "2026-09-01" })).toBe("每月 1 号");
  });

  it("间隔大于 1 时带数字", () => {
    expect(describeRule({ freq: "DAILY", interval: 14, anchorDate: "2026-09-15" })).toBe("每 14 天");
    expect(describeRule({ freq: "MONTHLY", interval: 2, anchorDate: "2026-09-15" })).toBe("每 2 个月");
  });

  it("仅一次", () => {
    expect(describeRule({ freq: "ONCE", interval: 1, anchorDate: "2026-09-15" })).toBe("仅一次");
  });
});