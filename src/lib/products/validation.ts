import { z } from "zod";

export const MAX_FILE_SIZE = 50 * 1024 * 1024;
export const MAX_INDEX_CHARS = 300_000;
export const PRODUCT_FILE_TYPES = {
  "application/pdf": ["pdf"],
  "image/jpeg": ["jpg", "jpeg"],
  "image/png": ["png"],
  "image/webp": ["webp"],
  "text/plain": ["txt"],
} as const;

export const productSchema = z.object({
  name: z.string().trim().min(1, "请填写产品名称").max(120),
  brand: z.string().trim().max(80).default(""),
  model: z.string().trim().max(100).default(""),
  category: z.string().trim().max(40).default(""),
  description: z.string().trim().max(4000).default(""),
});

export function validateProductFile(name: string, mime: string, size: number): string | null {
  if (!Number.isSafeInteger(size) || size <= 0 || size > MAX_FILE_SIZE) return "单个文件需大于 0 且不超过 50 MB";
  const extensions = PRODUCT_FILE_TYPES[mime as keyof typeof PRODUCT_FILE_TYPES] as readonly string[] | undefined;
  if (!extensions?.includes(name.split(".").at(-1)?.toLowerCase() ?? "")) return "支持 PDF、JPG、PNG、WebP 和 TXT 文件";
  if (name.length > 240 || /[\x00-\x1f]/.test(name)) return "文件名过长或包含无效字符";
  return null;
}

export const textPageSchema = z.object({
  page: z.number().int().min(1).max(10000),
  text: z.string().max(100_000),
});
export type TextPage = z.infer<typeof textPageSchema>;
export const finishUploadSchema = z.object({
  id: z.string().min(1).max(100),
  pageCount: z.number().int().min(1).max(10000).nullable(),
  pages: z.array(textPageSchema).max(1000),
  indexStatus: z.enum(["READY", "PARTIAL", "NO_TEXT", "FAILED", "NONE"]),
  previewPages: z.array(z.number().int().min(1).max(3)).max(3).default([]),
}).refine((v) => v.pages.reduce((n, p) => n + p.text.length, 0) <= MAX_INDEX_CHARS, "提取的正文过长")
  .refine((v) => new Set(v.pages.map((p) => p.page)).size === v.pages.length && v.pages.every((p) => !v.pageCount || p.page <= v.pageCount), "页码无效")
  .refine((v) => new Set(v.previewPages).size === v.previewPages.length && v.previewPages.every((p) => v.pageCount && p <= v.pageCount), "预览页码无效");

export const productNoteSchema = z.object({
  productId: z.string().min(1).max(100),
  documentId: z.string().max(100).nullable(),
  pageNumber: z.number().int().min(1).max(10000).nullable(),
  content: z.string().trim().min(1, "请先写一点笔记").max(10000, "笔记最多 10000 字"),
}).refine((v) => !v.pageNumber || Boolean(v.documentId), "页码需要关联说明书");

export function fileSizeLabel(size: number): string {
  return size >= 1024 * 1024 ? `${(size / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(size / 1024))} KB`;
}

export function textSnippet(text: string, query: string, radius = 65): string {
  const normalized = text.replace(/\s+/g, " ");
  const pos = normalized.toLocaleLowerCase().indexOf(query.toLocaleLowerCase());
  const start = Math.max(0, pos - radius);
  return `${start ? "…" : ""}${normalized.slice(start, Math.max(0, pos) + query.length + radius)}${normalized.length > Math.max(0, pos) + query.length + radius ? "…" : ""}`;
}
