import { z } from "zod";
import { isValidClockTime, isValidDateOnly } from "@/lib/time";

/**
 * 周期项表单校验。
 *
 * `anchorOn` 的默认值由快捷预设决定（护理类 → LAST_DONE，账单类 → FIXED_SCHEDULE），
 * 但**数据层保持显式** —— 启发式只活在 UI 的预设按钮和 AI 解析里，
 * 存进库的永远是用户看得见、可修改的值。
 */

export const FREQS = ["DAILY", "WEEKLY", "MONTHLY", "YEARLY"] as const;
export const ANCHORS = ["LAST_DONE", "FIXED_SCHEDULE"] as const;

export const routineInputSchema = z.object({
  subjectId: z.string().trim().min(1, "必须选一个角色"),
  assigneeId: z
    .string()
    .trim()
    .transform((v) => (v === "" ? null : v))
    .nullable()
    .optional(),
  title: z.string().trim().min(1, "写点什么").max(60, "周期项名字短一点"),
  note: z
    .string()
    .trim()
    .max(2000)
    .transform((v) => (v === "" ? null : v))
    .nullable()
    .optional(),
  reminderTime: z.string().refine((v) => !v || isValidClockTime(v), "时间格式要是 HH:mm").nullable().optional(),
  freq: z.enum(FREQS),
  interval: z.coerce.number().int().min(1, "间隔至少 1").max(365, "间隔太大了"),
  anchorOn: z.enum(ANCHORS),
  /** 首次发生日。也是 MONTHLY 取日号的依据。 */
  startOn: z.string().refine(isValidDateOnly, "日期格式要是 YYYY-MM-DD"),
});

export type RoutineInput = z.infer<typeof routineInputSchema>;

export function routineInputFromForm(formData: FormData): unknown {
  return {
    subjectId: formData.get("subjectId"),
    assigneeId: formData.get("assigneeId") ?? "",
    title: formData.get("title"),
    note: formData.get("note") ?? "",
    freq: formData.get("freq"),
    interval: formData.get("interval") ?? 1,
    anchorOn: formData.get("anchorOn"),
    startOn: formData.get("startOn"),
    reminderTime: formData.get("reminderTime") || null,
  };
}

/**
 * 常用周期的快捷预设。
 *
 * 直接让用户填「freq + interval」两个下拉太抽象了 ——「每 14 天」「每月一次」
 * 这种说法才是人脑里的形态。预设按钮一点就把两个字段都设好。
 */
export const FREQ_PRESETS = [
  { label: "每 14 天", freq: "DAILY" as const, interval: 14, anchorOn: "LAST_DONE" as const },
  // 标签刻意不写「每月 1 号」—— 具体是几号由下面的「起始日」决定，
  // 选 18 号就会变成每月 18 号。写死日号的标签会骗人。
  { label: "每月一次", freq: "MONTHLY" as const, interval: 1, anchorOn: "LAST_DONE" as const },
  { label: "每 30 天", freq: "DAILY" as const, interval: 30, anchorOn: "LAST_DONE" as const },
  { label: "每周", freq: "WEEKLY" as const, interval: 1, anchorOn: "LAST_DONE" as const },
  { label: "每月固定日", freq: "MONTHLY" as const, interval: 1, anchorOn: "FIXED_SCHEDULE" as const },
  { label: "每 3 个月", freq: "MONTHLY" as const, interval: 3, anchorOn: "LAST_DONE" as const },
] as const;

/**
 * 按标题猜锚点语义。
 *
 * 账单类的事（交房租、缴物业费）应该钉死在日历上；护理类（掏耳朵、剪指甲）
 * 应该从完成日顺延。
 *
 * ⚠️ 这只是**表单预填的启发式**，用户随时能改，且从不写进数据层。
 * 判断错了的代价是多点一下，不是数据错乱。
 */
const FIXED_SCHEDULE_HINTS = ["交", "缴", "账单", "房租", "房贷", "物业", "还款", "续费", "订阅", "年检", "保险"];

export function guessAnchorOn(title: string): "LAST_DONE" | "FIXED_SCHEDULE" {
  return FIXED_SCHEDULE_HINTS.some((h) => title.includes(h))
    ? "FIXED_SCHEDULE"
    : "LAST_DONE";
}