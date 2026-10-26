import { tool } from "ai";
import { z } from "zod";
import type { ActionCollector } from "./collector";
import type { MemberRef } from "./types";
import type { DateOnly } from "@/lib/time";

/**
 * AI 管家的 tool 集合。
 *
 * ⚠️ **所有 execute 只往 collector 推提案，绝不写数据库。**
 * 见 collector.ts 与 types.ts 里关于「AI 只出计划」的说明。
 *
 * API 备注（AI SDK 7 实测确认）：用的是 `inputSchema`，**不是** v5 时代的
 * `parameters` —— 用 `parameters` 会被类型检查直接拒绝。这个坑在 v6 改名后
 * 一直存在，凭记忆写必错。
 */

const DATE_ONLY_DESC = "YYYY-MM-DD 格式的本地日期";

const reminderTimeSchema = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/).optional().describe("用户明确指定的提醒时间，24 小时制 HH:mm；下午3点=15:00，晚上八点半=20:30。未指定时间则省略，不得猜测");

const routineSchema = z.object({
  reminderTime: reminderTimeSchema,
  freq: z
    .enum(["DAILY", "WEEKLY", "MONTHLY", "YEARLY"])
    .describe("周期单位。护理类如「每14天」用 DAILY + interval=14"),
  interval: z.number().int().min(1).default(1).describe("每 N 个周期单位"),
  anchorOn: z
    .enum(["LAST_DONE", "FIXED_SCHEDULE"])
    .default("LAST_DONE")
    .describe(
      "LAST_DONE：从上次完成那天算起，晚了会顺延（护理类，如掏耳朵/剪指甲）。" +
        "FIXED_SCHEDULE：钉死在日历上，早晚做都一样（账单类，如交房租/还信用卡）",
    ),
});

export function buildTools(
  collector: ActionCollector,
  members: MemberRef[],
  today: DateOnly,
) {
  const dateHint = `用户说「今天」就是 ${today}。`;

  return {
    /**
     * 记录一件已经发生的事，可带出后续周期。
     * 覆盖「猫咪今天掏耳朵了（每14天一次）」。
     */
    createRecord: tool({
      description:
        "记录一件**已经发生**的事。如果用户话里隐含了周期（「每14天」「每月一次」），" +
        "一并给出 followUp 规则。" +
        dateHint,
      inputSchema: z.object({
        memberName: z.string().describe("这件事关于谁，用角色列表里的名字"),
        assigneeName: z.string().optional().describe("谁去办。多数情况不填"),
        title: z
          .string()
          .describe("简短事项名。去掉时间、角色、触发词后的核心词，如「掏耳朵」"),
        occurredOn: z.string().describe(`发生日期，${DATE_ONLY_DESC}`),
        note: z.string().optional(),
        followUp: routineSchema.optional().describe("隐含的周期规则，没有就别填"),
      }),
      execute: async (input) => {
        collector.pushRecord(input);
        return { collected: true, title: input.title };
      },
    }),

    /**
     * 一次性待办。覆盖「提醒我31天后，提醒妈房子没卖出去」。
     */
    createTask: tool({
      description:
        "创建一个一次性的待办（没有周期）。用户说「提醒我 X 天后…」「记得…」时用这个。" +
        dateHint,
      inputSchema: z.object({
        memberName: z.string().optional().describe("这件事关于谁。没提到就不填"),
        assigneeName: z.string().optional().describe("谁去办，如「提醒妈」里的妈"),
        title: z.string().describe("简短事项名，去掉时间和角色后的核心词"),
        dueOn: z.string().describe(`到期日期，${DATE_ONLY_DESC}`),
        reminderTime: reminderTimeSchema,
        note: z.string().optional(),
      }),
      execute: async (input) => {
        collector.pushTask(input);
        return { collected: true, title: input.title };
      },
    }),

    /**
     * 批量定义周期项。
     *
     * **必须批量**：用户在一句话里列了多件事时（「猫咪每月一次掏耳朵、剃屁股毛、
     * 剪指甲、扽」），拆成多次调用会让后几项被截断或漏掉 —— 模型的输出有长度
     * 限制，多轮 tool call 里靠后的那些最容易丢。
     */
    createRoutines: tool({
      description:
        "一次定义一个或多个**周期性**事项（每隔一段时间就要做一次的事）。" +
        "用户在一句话里列了多件事时，**必须用这一个工具一次调用**，不要拆成多次。" +
        "用户说「每月一次」「每14天」这类重复性说法时用这个，而不是 createTask。",
      inputSchema: z.object({
        memberName: z.string().describe("这些周期项属于谁"),
        items: z
          .array(
            z.object({
              title: z.string().describe("事项名，如「掏耳朵」"),
              reminderTime: reminderTimeSchema,
              freq: z
                .enum(["DAILY", "WEEKLY", "MONTHLY", "YEARLY"])
                .describe("周期单位"),
              interval: z.number().int().min(1).default(1).describe("每 N 个周期单位"),
              anchorOn: z
                .enum(["LAST_DONE", "FIXED_SCHEDULE"])
                .default("LAST_DONE")
                .describe("护理类用 LAST_DONE，账单类用 FIXED_SCHEDULE"),
              startOn: z
                .string()
                .describe(`第一次的日期。用户没说明就用 ${today}`),
            }),
          )
          .min(1)
          .describe("所有事项都要列在这里，一个都不能少"),
      }),
      execute: async (input) => {
        collector.pushRoutines({
          memberName: input.memberName,
          items: input.items.map((i) => ({
            title: i.title,
            freq: i.freq,
            interval: i.interval,
            anchorOn: i.anchorOn,
            startOn: i.startOn,
            reminderTime: i.reminderTime,
          })),
        });
        return { collected: true, count: input.items.length };
      },
    }),

    /**
     * 列出角色。模型需要在解析前知道有哪些角色可用 ——
     * 直接作为 tool 暴露，比把角色列表硬塞进 prompt 更灵活。
     */
    listMembers: tool({
      description: "列出当前所有角色（人和宠物）。解析前如果不确定有哪些角色，先调这个。",
      inputSchema: z.object({}),
      // 直接闭包捕获 members，不去翻 collector 的私有字段 —— 那样写
      // 一旦 collector 内部结构调整就会静默失效
      execute: async () => ({
        members: members.map((m) => ({
          name: m.name,
          别名: m.aliases,
          类型: m.kind === "PET" ? "宠物" : "人",
        })),
      }),
    }),
  };
}

export type ButlerTools = ReturnType<typeof buildTools>;