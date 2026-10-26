import { describe, expect, it } from "vitest";
import { buildDuePushPayload } from "./service";

describe("buildDuePushPayload", () => {
  it("summarizes due tasks without overflowing a notification", () => {
    const payload = buildDuePushPayload(
      [
        { taskId: "1", title: "交物业费", dueOn: "2026-09-20", subjectName: null, assigneeName: "妈" },
        { taskId: "2", title: "给猫剪指甲", dueOn: "2026-09-20", subjectName: "猫咪", assigneeName: null },
        { taskId: "3", title: "电瓶车充电", dueOn: "2026-09-20", subjectName: null, assigneeName: null },
        { taskId: "4", title: "浇花", dueOn: "2026-09-20", subjectName: null, assigneeName: null },
      ],
      "2026-09-20",
    );
    expect(payload.title).toBe("有 4 项待办需要处理");
    expect(payload.body).toBe("妈：交物业费；猫咪：给猫剪指甲；电瓶车充电；另有 1 项");
    expect(payload.url).toBe("/tasks");
    expect(payload.badgeCount).toBe(4);
  });
});
