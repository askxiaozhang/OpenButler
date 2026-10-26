import { describe, expect, it } from "vitest";
import { groupTasks, totalPending, type Groupable } from "./task-groups";

const TODAY = "2026-09-15"; // 周二

function task(dueOn: string, status: Groupable["status"] = "PENDING"): Groupable {
  return { dueOn, status };
}

describe("groupTasks", () => {
  it("按逾期 / 今天 / 本周 / 以后分组", () => {
    const g = groupTasks(
      [
        task("2026-09-10"), // 逾期
        task("2026-09-15"), // 今天
        task("2026-09-17"), // 本周内（周四是 9/17）
        task("2026-09-20"), // 本周日
        task("2026-09-21"), // 下周一 → 以后
        task("2026-10-01"), // 以后
      ],
      TODAY,
    );

    expect(g.overdue.map((t) => t.dueOn)).toEqual(["2026-09-10"]);
    expect(g.today.map((t) => t.dueOn)).toEqual(["2026-09-15"]);
    expect(g.thisWeek.map((t) => t.dueOn)).toEqual(["2026-09-17", "2026-09-20"]);
    expect(g.later.map((t) => t.dueOn)).toEqual(["2026-09-21", "2026-10-01"]);
  });

  it("本周的边界是周日，不是「七天后」", () => {
    // 2026-09-15 是周二，本周日是 9/20。9/21（下周一）属于「以后」。
    const g = groupTasks([task("2026-09-20"), task("2026-09-21")], TODAY);
    expect(g.thisWeek).toHaveLength(1);
    expect(g.later).toHaveLength(1);
  });

  it("周日当天，本周只剩它自己", () => {
    const g = groupTasks([task("2026-09-20"), task("2026-09-21")], "2026-09-20");
    expect(g.today.map((t) => t.dueOn)).toEqual(["2026-09-20"]);
    expect(g.thisWeek).toHaveLength(0);
    expect(g.later.map((t) => t.dueOn)).toEqual(["2026-09-21"]);
  });

  it("已完成的（DONE / SKIPPED）一律进 done，不参与逾期判断", () => {
    const g = groupTasks(
      [
        task("2026-09-01", "DONE"), // 早就过期但已完成
        task("2026-09-01", "SKIPPED"),
        task("2026-09-15", "DONE"),
      ],
      TODAY,
    );
    expect(g.done).toHaveLength(3);
    expect(g.overdue).toHaveLength(0);
    expect(g.today).toHaveLength(0);
  });

  it("逾期项按「逾期最久」排最前", () => {
    const g = groupTasks(
      [task("2026-09-14"), task("2026-09-01"), task("2026-09-10")],
      TODAY,
    );
    expect(g.overdue.map((t) => t.dueOn)).toEqual([
      "2026-09-01",
      "2026-09-10",
      "2026-09-14",
    ]);
  });

  it("已完成的按到期日倒序（最近做的在最上面）", () => {
    const g = groupTasks(
      [task("2026-09-01", "DONE"), task("2026-09-14", "DONE"), task("2026-09-08", "DONE")],
      TODAY,
    );
    expect(g.done.map((t) => t.dueOn)).toEqual([
      "2026-09-14",
      "2026-09-08",
      "2026-09-01",
    ]);
  });

  it("空列表不炸", () => {
    const g = groupTasks([], TODAY);
    expect(totalPending(g)).toBe(0);
    expect(g.done).toEqual([]);
  });

  it("跨年比较正确（字典序即时间序）", () => {
    const g = groupTasks(
      [task("2025-12-31"), task("2027-01-01")],
      "2026-01-15",
    );
    expect(g.overdue.map((t) => t.dueOn)).toEqual(["2025-12-31"]);
    expect(g.later.map((t) => t.dueOn)).toEqual(["2027-01-01"]);
  });
});

describe("totalPending", () => {
  it("不含已完成", () => {
    const g = groupTasks(
      [task("2026-09-01"), task("2026-09-15"), task("2026-09-01", "DONE")],
      TODAY,
    );
    expect(totalPending(g)).toBe(2);
  });
});