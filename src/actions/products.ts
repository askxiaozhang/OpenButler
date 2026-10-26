"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth/guard";
import { fail, ok, type ActionResult } from "@/lib/action-result";
import { productSchema, productNoteSchema } from "@/lib/products/validation";
import { productStorage, productPreviewPath } from "@/lib/products/storage";
import { persistProduct } from "@/lib/products/service";
import { nowInstant } from "@/lib/time";

function refresh(productId: string | null) {
  revalidatePath("/chat");
  if (!productId) return;
  revalidatePath("/products");
  revalidatePath(`/products/${productId}`);
}

export async function saveProduct(id: string | null, data: unknown): Promise<ActionResult<{ id: string }>> {
  const user = await requireUser();
  const parsed = productSchema.safeParse(data);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "请检查产品信息");
  try {
    const product = await persistProduct(db(), parsed.data, user.id, id);
    refresh(product.id);
    return ok(product);
  } catch { return fail("保存失败，请稍后重试"); }
}

export async function saveProductNote(id: string | null, data: unknown): Promise<ActionResult> {
  const user = await requireUser();
  const parsed = productNoteSchema.safeParse(data);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "请检查笔记内容");
  const input = parsed.data;
  try {
    if (!await db().product.count({ where: { id: input.productId } })) return fail("产品已不存在");
    if (input.documentId) {
      const doc = await db().productDocument.findFirst({ where: { id: input.documentId, productId: input.productId, ready: true }, select: { pageCount: true } });
      if (!doc || (input.pageNumber && (!doc.pageCount || input.pageNumber > doc.pageCount))) return fail("说明书或页码无效");
    }
    if (id) {
      const result = await db().productNote.updateMany({
        where: { id, productId: input.productId, ...(user.role === "ADMIN" ? {} : { authorId: user.id }) }, data: input,
      });
      if (!result.count) return fail("只能修改自己写的笔记");
    } else await db().productNote.create({ data: { ...input, authorId: user.id } });
    await db().product.update({ where: { id: input.productId }, data: { updatedAt: nowInstant() } });
    refresh(input.productId);
    return ok();
  } catch { return fail("保存笔记失败，请稍后重试"); }
}

export async function deleteProductNote(id: string): Promise<ActionResult> {
  const user = await requireUser();
  const note = await db().productNote.findUnique({ where: { id }, select: { productId: true, authorId: true } });
  if (!note || (note.authorId !== user.id && user.role !== "ADMIN")) return fail("只能删除自己写的笔记");
  await db().productNote.delete({ where: { id } });
  refresh(note.productId);
  return ok();
}

export async function deleteProductDocument(id: string): Promise<ActionResult> {
  const user = await requireUser();
  const doc = await db().productDocument.findUnique({ where: { id } });
  if (!doc || (doc.uploadedBy !== user.id && user.role !== "ADMIN")) return fail("只能删除自己上传的资料");
  try {
    const { error } = await productStorage().remove([doc.storagePath, ...[1, 2, 3].map((p) => productPreviewPath(doc.storagePath, p))]);
    if (error) return fail("文件删除失败，请重试");
    // 笔记保留，关联文件被删除后自动解除引用。
    await db().$transaction([
      db().productNote.updateMany({ where: { documentId: id }, data: { documentId: null, pageNumber: null } }),
      db().productDocument.delete({ where: { id } }),
    ]);
    refresh(doc.productId);
    return ok();
  } catch { return fail("删除失败，请稍后重试"); }
}
