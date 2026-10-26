import { z } from "zod";
import { isValidClockTime, isValidDateOnly } from "@/lib/time";

/**
 * 记录与待办的表单校验。
 *
 * 两者字段高度重合（都是「一条带角色和日期的事」），差别只在
 * `occurredOn`（已经发生）vs `dueOn`（将要发生）。共用一套基础规则，
 * 免得两边校验强度不知不觉跑偏。
 */

const dateOnly = z
  .string()
  .refine(isValidDateOnly, "日期格式要是 YYYY-MM-DD");

/**
 * 角色字段。
 *
 * 空字符串视为「未指定」而不是错误 —— 表单里「不选」是很正常的状态。
 * subject 与 assignee 都可空：只填 subject 是最常见的情况（「猫咪掏耳朵」），
 * 只填 assignee 出现在「提醒妈跟进房子」这类没有明确主体的事上。
 */
const optionalId = z
  .string()
  .trim()
  .transform((v) => (v === "" ? null : v))
  .nullable()
  .optional();

const baseFields = {
  subjectId: optionalId,
  assigneeId: optionalId,
  title: z.string().trim().min(1, "写点什么").max(120, "太长了，精简一下"),
  note: z
    .string()
    .trim()
    .max(2000)
    .transform((v) => (v === "" ? null : v))
    .nullable()
    .optional(),
};

export const recordInputSchema = z.object({
  ...baseFields,
  occurredOn: dateOnly,
});

export const taskInputSchema = z.object({
  ...baseFields,
  dueOn: dateOnly,
  reminderTime: z.string().refine((v) => !v || isValidClockTime(v), "时间格式要是 HH:mm").nullable().optional(),
});

export type RecordInput = z.infer<typeof recordInputSchema>;
export type TaskInput = z.infer<typeof taskInputSchema>;

export function recordInputFromForm(formData: FormData): unknown {
  return {
    subjectId: formData.get("subjectId") ?? "",
    assigneeId: formData.get("assigneeId") ?? "",
    title: formData.get("title"),
    note: formData.get("note") ?? "",
    occurredOn: formData.get("occurredOn"),
  };
}

export function taskInputFromForm(formData: FormData): unknown {
  return {
    subjectId: formData.get("subjectId") ?? "",
    assigneeId: formData.get("assigneeId") ?? "",
    title: formData.get("title"),
    note: formData.get("note") ?? "",
    dueOn: formData.get("dueOn"),
    reminderTime: formData.get("reminderTime") ?? null,
  };
}

/**
 * 校验「至少有一个角色」。
 *
 * 单独拿出来是因为它是跨字段规则，zod 的 object 级别 refine 写起来更绕，
 * 而在 action 里检查更直白 —— 出错时也能给出更具体的提示。
 *
 * 不过它其实是**软规则**：允许都不填（家里的事不一定都要归到某个人头上），
 * 但 UI 上会提示一句。这里只做「如果填了 assignee 就必须能有主体」之外的检查，
 * 所以实际上不拦。保留函数是为了给未来的硬规则留位置。
 */
export function hasAnyMember(input: {
  subjectId?: string | null;
  assigneeId?: string | null;
}): boolean {
  return Boolean(input.subjectId || input.assigneeId);
}