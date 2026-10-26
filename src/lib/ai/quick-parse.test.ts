import { describe, expect, it } from "vitest";
import { buildDraft, findMembers, parseChineseNumber, parseDate, parseFrequency, quickParse } from "./quick-parse";
import type { MemberRef } from "./types";

/**
 * 快速解析器的测试。
 *
 * ⚠️ 文件末尾那组「用户的原始用例」是**产品需求本身**，不是普通测试数据。
 * 用户描述需求时给的就是那几句话，它们必须能被解析对 —— 改动解析器后
 * 这组红了，说明产品能力退化了，不要去调测试迁就实现。
 */

const TODAY = "2026-09-15";

const MEMBERS: MemberRef[] = [
  { id: "me", name: "我", aliases: ["自己", "本人"], kind: "PERSON" },
  { id: "mom", name: "妈", aliases: ["妈妈", "老妈", "母亲"], kind: "PERSON" },
  { id: "cat", name: "猫咪", aliases: ["猫", "猫猫", "主子"], kind: "PET" },
];

const parse = (text: string) => quickParse({ text, members: MEMBERS, today: TODAY });

describe("parseChineseNumber", () => {
  it("阿拉伯数字原样返回", () => {
    expect(parseChineseNumber("31")).toBe(31);
    expect(parseChineseNumber("0")).toBe(0);
  });

  it("单字", () => {
    expect(parseChineseNumber("三")).toBe(3);
    expect(parseChineseNumber("两")).toBe(2);
  });

  it("十位", () => {
    expect(parseChineseNumber("十")).toBe(10);
    expect(parseChineseNumber("十二")).toBe(12);
    expect(parseChineseNumber("二十")).toBe(20);
    expect(parseChineseNumber("二十三")).toBe(23);
    expect(parseChineseNumber("三十一")).toBe(31);
  });

  it("非法输入返回 null 而不是抛错", () => {
    expect(parseChineseNumber("abc")).toBeNull();
    expect(parseChineseNumber("三a")).toBeNull();
  });
});

describe("parseDate", () => {
  it("固定相对日", () => {
    expect(parseDate("今天掏耳朵了", TODAY)?.date).toBe("2026-09-15");
    expect(parseDate("明天要交作业", TODAY)?.date).toBe("2026-09-16");
    expect(parseDate("后天", TODAY)?.date).toBe("2026-09-17");
    expect(parseDate("大后天", TODAY)?.date).toBe("2026-09-18");
    expect(parseDate("昨天做的", TODAY)?.date).toBe("2026-09-14");
  });

  it("「大后天」不会被「后天」抢先匹配", () => {
    expect(parseDate("大后天", TODAY)?.matched).toBe("大后天");
    expect(parseDate("大后天", TODAY)?.date).toBe("2026-09-18");
  });

  it("N 天后（阿拉伯数字与中文数字都要支持）", () => {
    expect(parseDate("31天后", TODAY)?.date).toBe("2026-10-16");
    expect(parseDate("三十一天后", TODAY)?.date).toBe("2026-10-16");
    expect(parseDate("3 天以后", TODAY)?.date).toBe("2026-09-18");
    expect(parseDate("两周后", TODAY)?.date).toBe("2026-09-29");
    expect(parseDate("一个月后", TODAY)?.date).toBe("2026-10-15");
  });

  it("没有日期表达时返回 null", () => {
    expect(parseDate("掏耳朵", TODAY)).toBeNull();
  });
});

describe("parseFrequency", () => {
  it("每 N 天", () => {
    const hit = parseFrequency("每14天掏耳朵");
    expect(hit?.freq).toBe("DAILY");
    expect(hit?.interval).toBe(14);
  });

  it("中文数字间隔", () => {
    expect(parseFrequency("每两周")?.interval).toBe(2);
    expect(parseFrequency("每三天")?.interval).toBe(3);
  });

  it("每月 / 每月一次 / 每个月", () => {
    for (const text of ["每月一次掏耳朵", "每个月掏耳朵", "每月掏耳朵"]) {
      const hit = parseFrequency(text);
      expect(hit?.freq).toBe("MONTHLY");
      expect(hit?.interval).toBe(1);
    }
  });

  it("每 N 个月", () => {
    const hit = parseFrequency("每3个月体检");
    expect(hit?.freq).toBe("MONTHLY");
    expect(hit?.interval).toBe(3);
  });

  it("每周 / 每天 / 每年", () => {
    expect(parseFrequency("每周三倒垃圾")?.freq).toBe("WEEKLY");
    expect(parseFrequency("每天喂猫")?.freq).toBe("DAILY");
    expect(parseFrequency("每年体检一次")?.freq).toBe("YEARLY");
  });

  it("没有周期表达时返回 null", () => {
    expect(parseFrequency("掏耳朵")).toBeNull();
  });
});

describe("findMembers —— 最长别名优先", () => {
  it("「老妈」必须优先于「妈」，不能切成「老」+ 妈", () => {
    const hit = findMembers("提醒老妈交物业费", MEMBERS);
    expect(hit.matched).toContain("老妈");
    expect(hit.assigneeId).toBe("mom");
  });

  it("「提醒X」→ X 是 assignee 而不是 subject", () => {
    const hit = findMembers("提醒妈交物业费", MEMBERS);
    expect(hit.assigneeId).toBe("mom");
    expect(hit.subjectId).toBeNull();
  });

  it("没有「提醒」时 → 是 subject", () => {
    const hit = findMembers("猫咪掏耳朵了", MEMBERS);
    expect(hit.subjectId).toBe("cat");
    expect(hit.assigneeId).toBeNull();
  });

  it("没提到任何角色时都为 null", () => {
    const hit = findMembers("交物业费", MEMBERS);
    expect(hit.subjectId).toBeNull();
    expect(hit.assigneeId).toBeNull();
  });
});

// ================================================================
// 用户的原始用例 —— 这几句是产品需求本身，红了就是能力退化
// ================================================================

describe("用户的原始用例", () => {
  describe("「猫咪今天掏耳朵了」", () => {
    const r = parse("猫咪今天掏耳朵了");

    it("识别为「记录」而不是待办（句尾的「了」是关键信号）", () => {
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.actions[0].type).toBe("createRecord");
    });

    it("主体是猫咪", () => {
      if (!r.ok) return;
      const a = r.actions[0];
      if (a.type !== "createRecord") return;
      expect(a.subjectId).toBe("cat");
    });

    it("标题是「掏耳朵」（角色、时间、句尾「了」都被剔除）", () => {
      if (!r.ok) return;
      const a = r.actions[0];
      if (a.type !== "createRecord") return;
      expect(a.title).toBe("掏耳朵");
    });

    it("日期是今天", () => {
      if (!r.ok) return;
      const a = r.actions[0];
      if (a.type !== "createRecord") return;
      expect(a.occurredOn).toBe(TODAY);
    });

    it("复述里带上三个要素", () => {
      if (!r.ok) return;
      expect(r.summary).toContain("掏耳朵");
      expect(r.summary).toContain("猫咪");
      expect(r.summary).toContain("今天");
    });
  });

  describe("「提醒我31天后，提醒妈房子没卖出去」", () => {
    const r = parse("提醒我31天后，提醒妈房子没卖出去");

    it("识别为「待办」而不是记录", () => {
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.actions[0].type).toBe("createTask");
    });

    it("assignee 是妈（「提醒妈」的妈是要去办事的人）", () => {
      if (!r.ok) return;
      const a = r.actions[0];
      if (a.type !== "createTask") return;
      expect(a.assigneeId).toBe("mom");
    });

    it("到期日是 31 天后 —— 一天都不能差", () => {
      if (!r.ok) return;
      const a = r.actions[0];
      if (a.type !== "createTask") return;
      expect(a.dueOn).toBe("2026-10-16");
    });

    it("标题是「房子没卖出去」（「提醒我」和「提醒妈」两个触发词都要剔除）", () => {
      if (!r.ok) return;
      const a = r.actions[0];
      if (a.type !== "createTask") return;
      expect(a.title).toBe("房子没卖出去");
    });
  });

  describe("「猫咪每月一次掏耳朵、剃屁股毛、剪指甲、扽」", () => {
    const r = parse("猫咪每月一次掏耳朵、剃屁股毛、剪指甲、扽");

    it("识别为批量周期项（而不是只取第一个）", () => {
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.actions[0].type).toBe("createRoutines");
    });

    it("四项一个不少 —— 拆成多次调用时后几项很容易被漏掉", () => {
      if (!r.ok) return;
      const a = r.actions[0];
      if (a.type !== "createRoutines") return;
      expect(a.items.map((i) => i.title)).toEqual([
        "掏耳朵",
        "剃屁股毛",
        "剪指甲",
        "扽",
      ]);
    });

    it("全部是每月一次", () => {
      if (!r.ok) return;
      const a = r.actions[0];
      if (a.type !== "createRoutines") return;
      expect(a.items.every((i) => i.freq === "MONTHLY" && i.interval === 1)).toBe(true);
    });

    it("都归属猫咪", () => {
      if (!r.ok) return;
      const a = r.actions[0];
      if (a.type !== "createRoutines") return;
      expect(a.subjectId).toBe("cat");
    });
  });

  describe("「猫咪每14天掏耳朵」", () => {
    const r = parse("猫咪每14天掏耳朵");

    // 说了「每14天」是在**定义一件反复发生的事**，不是一次性待办 ——
    // 所以归到周期项，而不是建一条待办再挂个规则
    it("识别为周期项", () => {
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.actions[0].type).toBe("createRoutines");
    });

    it("识别出 14 天周期", () => {
      if (!r.ok) return;
      const a = r.actions[0];
      if (a.type !== "createRoutines") return;
      expect(a.items[0].freq).toBe("DAILY");
      expect(a.items[0].interval).toBe(14);
    });

    it("护理类默认用 LAST_DONE（晚做要顺延）", () => {
      if (!r.ok) return;
      const a = r.actions[0];
      if (a.type !== "createRoutines") return;
      expect(a.items[0].anchorOn).toBe("LAST_DONE");
    });

    it("标题是「掏耳朵」", () => {
      if (!r.ok) return;
      const a = r.actions[0];
      if (a.type !== "createRoutines") return;
      expect(a.items[0].title).toBe("掏耳朵");
    });
  });

  describe("「每月1号交物业费」（没提是谁的事）", () => {
    const r = parse("每月1号交物业费");

    // 没提角色就建不成周期项（周期项必须有归属），但「每月 1 号」这层
    // 信息不能丢 —— 走待办路径并带上 followUp，用户在确认卡片补个角色即可
    it("降级为待办，但保留周期信息", () => {
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      const a = r.actions[0];
      expect(a.type).toBe("createTask");
      if (a.type !== "createTask") return;
      expect(a.followUp).toBeDefined();
    });

    it("账单类默认钉在日历上（FIXED_SCHEDULE）", () => {
      if (!r.ok) return;
      const a = r.actions[0];
      if (a.type !== "createTask") return;
      expect(a.followUp?.anchorOn).toBe("FIXED_SCHEDULE");
    });

    it("周期是每月", () => {
      if (!r.ok) return;
      const a = r.actions[0];
      if (a.type !== "createTask") return;
      expect(a.followUp?.freq).toBe("MONTHLY");
      expect(a.followUp?.interval).toBe(1);
    });

    it("起始日对齐到 1 号（否则「1 号」就白说了）", () => {
      if (!r.ok) return;
      const a = r.actions[0];
      if (a.type !== "createTask") return;
      expect(a.followUp?.startOn.endsWith("-01")).toBe(true);
    });

    it("标题是「交物业费」", () => {
      if (!r.ok) return;
      const a = r.actions[0];
      if (a.type !== "createTask") return;
      expect(a.title).toBe("交物业费");
    });
  });
});

describe("永久不死路 —— 再离谱的输入也要产出可用草稿", () => {
  const cases = [
    "",
    "   ",
    "？？？",
    "asdfgh",
    "了了了了",
    "提醒",
    "每",
    "🐱🐱🐱",
    "今天",
  ];

  it.each(cases)("对 %j 不抛错且能给出草稿", (text) => {
    const draft = buildDraft({ text, members: MEMBERS, today: TODAY });
    expect(draft).toBeTruthy();
    expect(typeof draft.title).toBe("string");
    expect(draft.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(["record", "task"]).toContain(draft.kind);
  });

  it("空输入也不会崩", () => {
    expect(() => parse("")).not.toThrow();
    expect(() => parse("   ")).not.toThrow();
  });

  it("没提到角色时保持 null，由用户在表单里补", () => {
    const r = parse("买酱油");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const a = r.actions[0];
    if (a.type !== "createTask") return;
    expect(a.subjectId).toBeNull();
    expect(a.assigneeId).toBeNull();
    expect(a.title).toBe("买酱油");
  });

  it("降级草稿保留原文，方便用户对照", () => {
    const draft = buildDraft({ text: "随便说点什么", members: MEMBERS, today: TODAY });
    expect(draft.rawText).toBe("随便说点什么");
    expect(draft.title.length).toBeGreaterThan(0);
  });
});
describe("指定时间提醒", () => {
  it.each([
    ["明天下午三点提醒我取快递", "2026-09-16", "15:00", "取快递"],
    ["今晚八点半提醒我吃药", "2026-09-15", "20:30", "吃药"],
    ["后天 09:15 提醒我交电费", "2026-09-17", "09:15", "交电费"],
    ["明天凌晨十二点零五分提醒我出门", "2026-09-16", "00:05", "出门"],
  ])("%s", (text, dueOn, reminderTime, title) => {
    const result = parse(text);
    expect(result).toMatchObject({ ok: true, actions: [{ type: "createTask", dueOn, reminderTime, title }] });
    if (result.ok) expect(result.summary).toContain(`${reminderTime} 提醒`);
    expect(buildDraft({text, members: MEMBERS, today: TODAY})).toMatchObject({reminderTime});
  });

  it("周期项的每一次均保留钟点", () => {
    const result = parse("猫咪每天晚上八点提醒喂药");
    expect(result).toMatchObject({ok:true,actions:[{type:"createRoutines",items:[{reminderTime:"20:00"}]}]});
  });
});
