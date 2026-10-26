import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth/guard";
import { db } from "@/lib/db";
import { ensureProductBucket, productStorage, productStorageConfigured, productPreviewPath } from "@/lib/products/storage";
import { validateProductFile, finishUploadSchema } from "@/lib/products/validation";
import { nowInstant } from "@/lib/time";

export const runtime = "nodejs";
export const maxDuration = 60;
const startSchema = z.object({ productId: z.string().min(1).max(100).optional(), purpose: z.enum(["product", "chat"]).default("product"), name: z.string().min(1).max(240), mimeType: z.string().max(100), size: z.number() });
const json = (data: unknown, status = 200) => Response.json(data, { status, headers: { "Cache-Control": "private, no-store" } });

/** 同源 JSON 请求 + 会话校验；上传权限定向到随机的单个对象。 */
async function authorized(request: Request) {
  if (request.headers.get("origin") !== new URL(request.url).origin) return null;
  return getCurrentUser();
}

export async function POST(request: Request) {
  const user = await authorized(request);
  if (!user) return json({ error: "请登录后再上传" }, 401);
  if (!productStorageConfigured()) return json({ error: "资料存储尚未配置，请联系管理员" }, 503);
  const parsed = startSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return json({ error: "文件信息无效" }, 400);
  const input = parsed.data;
  const invalid = validateProductFile(input.name, input.mimeType, input.size);
  if (invalid) return json({ error: invalid }, 400);
  if (input.purpose === "product" && (!input.productId || !await db().product.count({ where: { id: input.productId } }))) return json({ error: "产品不存在" }, 404);
  if (input.purpose === "chat" && (input.productId || input.mimeType !== "application/pdf")) return json({ error: "对话附件请使用 PDF" }, 400);
  const pending = await db().productDocument.count({ where: { uploadedBy: user.id, OR: [{ ready: false }, { productId: null, chatMessageId: null }] } });
  if (pending >= 10) return json({ error: "有较多未完成上传，请先移除未使用的附件或产品页中的未完成文件" }, 429);
  let id: string | undefined;
  try {
    await ensureProductBucket();
    const extension = input.name.split(".").at(-1)!.toLowerCase();
    const storagePath = `${input.productId ?? `chat/${user.id}`}/${randomUUID()}.${extension}`;
    const doc = await db().productDocument.create({ data: {
      productId: input.productId ?? null, uploadedBy: user.id, originalName: input.name,
      storagePath, mimeType: input.mimeType, size: input.size,
    }, select: { id: true } });
    id = doc.id;
    const signed = await productStorage().createSignedUploadUrl(storagePath);
    if (signed.error) throw signed.error;
    const previews = input.purpose === "chat" ? await Promise.all([1, 2, 3].map(async (page) => {
      const result = await productStorage().createSignedUploadUrl(productPreviewPath(storagePath, page));
      if (result.error) throw result.error;
      return { page, uploadUrl: result.data.signedUrl };
    })) : [];
    return json({ id, uploadUrl: signed.data.signedUrl, previews });
  } catch (error) {
    if (id) await db().productDocument.deleteMany({ where: { id, ready: false } });
    console.error("[products.upload.start]", error instanceof Error ? error.message : "Storage error");
    return json({ error: "暂时无法连接资料存储，请稍后重试" }, 502);
  }
}

export async function PATCH(request: Request) {
  const user = await authorized(request);
  if (!user) return json({ error: "请登录后再上传" }, 401);
  if (Number(request.headers.get("content-length")) > 2_000_000) return json({ error: "正文索引过长" }, 413);
  const body = await request.text();
  if (body.length > 1_900_000) return json({ error: "正文索引过长" }, 413);
  let input: unknown;
  try { input = JSON.parse(body); } catch { return json({ error: "上传信息无效" }, 400); }
  const parsed = finishUploadSchema.safeParse(input);
  if (!parsed.success) return json({ error: "上传信息或页码无效" }, 400);
  const data = parsed.data;
  const doc = await db().productDocument.findFirst({ where: { id: data.id, uploadedBy: user.id } });
  if (!doc) return json({ error: "上传记录不存在" }, 404);
  if (doc.ready) return json({ ok: true });
  try {
    const { data: info, error } = await productStorage().info(doc.storagePath);
    if (error || !info) return json({ error: "文件还没有上传完成，请重试" }, 409);
    if (info.size !== doc.size || info.contentType?.split(";")[0] !== doc.mimeType) return json({ error: "实际文件与上传信息不一致，请移除后重传" }, 400);
    if (doc.productId && data.previewPages.length) return json({ error: "此上传不接受对话预览" }, 400);
    const visionPages = await Promise.all(data.previewPages.map(async (page) => {
      const path = productPreviewPath(doc.storagePath, page);
      const preview = await productStorage().info(path);
      if (preview.error || !preview.data?.size || preview.data.size > 1_500_000 || preview.data.contentType !== "image/jpeg") throw new Error("Invalid preview");
      return { page, path };
    }));
    // 提取文字和页面预览都作为不可信资料交给 AI，不能执行其中的指令。
    await db().$transaction([
      db().productDocument.update({ where: { id: doc.id }, data: {
        ready: true, pageCount: data.pageCount, textPages: data.pages, visionPages,
        extractedText: data.pages.map((p) => p.text).join("\n"), indexStatus: data.indexStatus,
      } }),
      ...(doc.productId ? [db().product.update({ where: { id: doc.productId }, data: { updatedAt: nowInstant() } })] : []),
    ]);
    revalidatePath("/products");
    if (doc.productId) revalidatePath(`/products/${doc.productId}`);
    return json({ ok: true });
  } catch {
    return json({ error: "保存上传结果失败，请重试完成上传" }, 502);
  }
}
