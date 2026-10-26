import { z } from "zod";

/**
 * 角色表单的校验。
 *
 * 放在独立模块是因为表单（客户端）和 Server Action（服务端）都要用同一套规则 ——
 * 客户端校验为了体验，服务端校验为了安全，两边规则必须一致，否则会出现
 * 「前端说没问题、后端报错」或更糟的「前端拦住了合法输入」。
 */

export const MEMBER_KINDS = ["PERSON", "PET"] as const;

/** 预设色板。存在数据库里的是十六进制字符串，这里只是给 UI 一组好看的默认值。 */
export const MEMBER_COLORS = [
  "#38bdf8", // 天蓝
  "#f472b6", // 粉
  "#f59e0b", // 琥珀
  "#34d399", // 翠绿
  "#a78bfa", // 紫
  "#fb7185", // 玫瑰
  "#facc15", // 黄
  "#94a3b8", // 灰蓝
] as const;

/** 常用 emoji 快捷选择。也允许手输任意 emoji。 */
export const MEMBER_EMOJIS = [
  "🙂", "👩", "👨", "👵", "👴", "👧", "👦", "🐱", "🐶", "🐰", "🐹", "🐦", "🐢", "🐠",
] as const;

/**
 * 别名输入：用户在一个输入框里用逗号/顿号/空格分隔，这里切成数组。
 *
 * 支持中英文逗号和顿号 —— 中文输入法下打「，」很自然，为此报错很烦人。
 */
export function parseAliases(input: string): string[] {
  return Array.from(
    new Set(
      input
        .split(/[,，、\s]+/)
        .map((s) => s.trim())
        .filter(Boolean),
    ),
  );
}

const hexColor = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/, "颜色要形如 #38bdf8");

export const memberInputSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "名字不能为空")
    .max(20, "名字最多 20 个字"),
  aliases: z.array(z.string().trim().min(1).max(20)).max(20, "别名最多 20 个"),
  kind: z.enum(MEMBER_KINDS),
  emoji: z.string().trim().max(8).optional().or(z.literal("")),
  color: hexColor.optional().or(z.literal("")),
  sortOrder: z.coerce.number().int().min(0).max(9999).default(0),
});

export type MemberInput = z.infer<typeof memberInputSchema>;

/** 从 FormData 解析角色表单。 */
export function memberInputFromForm(formData: FormData): unknown {
  return {
    name: formData.get("name"),
    aliases: parseAliases(String(formData.get("aliases") ?? "")),
    kind: formData.get("kind") ?? "PERSON",
    emoji: formData.get("emoji") ?? "",
    color: formData.get("color") ?? "",
    sortOrder: formData.get("sortOrder") ?? 0,
  };
}