import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { productStorage, productPreviewPath } from "@/lib/products/storage";
import { recognizeProduct } from "@/lib/products/recognize";
import { normalizeProductIdentity, readProductImport, type ProductImportEdit, type ProductImportProposal } from "@/lib/products/import-types";
import { persistProduct } from "@/lib/products/service";
import { nowInstant } from "@/lib/time";

export async function proposeProductImport(input: { userId: string; sessionId: string; documentId: string; text: string; previous?: ProductImportProposal }) {
  const doc = await db().productDocument.findFirst({ where: { id: input.documentId, uploadedBy: input.userId, ready: true, productId: null, chatMessage: { sessionId: input.sessionId } } });
  if (!doc) throw new Error("附件不存在或已入库，请重新选择 PDF");
  const previewPages = z.array(z.object({ page: z.number().int().min(1).max(3), path: z.string() })).max(3).safeParse(doc.visionPages);
  const images: { page: number; url: string }[] = [];
  for (const p of previewPages.success ? previewPages.data : []) {
    if (p.path !== productPreviewPath(doc.storagePath, p.page)) continue;
    try {
      const signed = await productStorage().createSignedUrl(p.path, 600);
      if (signed.data && !signed.error) images.push({ page: p.page, url: signed.data.signedUrl });
    } catch { /* 正文识别仍可继续。 */ }
  }
  const recognized = await recognizeProduct({ name: doc.originalName, pages: doc.textPages, text: doc.extractedText, pageCount: doc.pageCount, images, instruction: input.text, previous: input.previous?.product });
  let suggestedProduct: { id: string; name: string } | null = null;
  if (recognized.product.brand && recognized.product.model) {
    const existing = await db().product.findMany({ select: { id: true, name: true, brand: true, model: true }, take: 1000 });
    const matches = existing.filter((p) => normalizeProductIdentity(p.brand) === normalizeProductIdentity(recognized.product.brand) && normalizeProductIdentity(p.model) === normalizeProductIdentity(recognized.product.model));
    if (matches.length === 1) suggestedProduct = { id: matches[0].id, name: matches[0].name };
  }
  const proposal: ProductImportProposal = { kind: "PRODUCT_IMPORT", documentId: doc.id, ...recognized, suggestedProduct, savedProductId: null };
  const reply = recognized.recognized ? "我已读取说明书，整理了下面的产品资料。核对后点“确认入库”，PDF 会一起归档。也可以直接告诉我要改哪里。" : "说明书附件已保留。请核对下方信息，或点“重新识别”让我再读一次。";
  await db().$transaction([
    db().chatMessage.updateMany({ where: { sessionId: input.sessionId, proposalStatus: "PENDING" }, data: { proposalStatus: "CANCELLED" } }),
    db().chatMessage.create({ data: { sessionId: input.sessionId, role: "ASSISTANT", content: reply, proposal: proposal as unknown as Prisma.InputJsonValue, proposalStatus: "PENDING" } }),
  ]);
  return reply;
}

/** 确认、创建产品、移动附件归属、标记已保存，在一个事务内完成；重复点击不会重复建档。 */
export async function confirmProductImport(userId: string, messageId: string, edit?: ProductImportEdit): Promise<string | null> {
  return db().$transaction(async (tx) => {
    const message = await tx.chatMessage.findFirst({ where: { id: messageId, proposalStatus: "PENDING", session: { userId } }, select: { id: true, sessionId: true, proposal: true } });
    if (!message) return null;
    const proposal = readProductImport(message.proposal);
    if (!proposal) throw new Error("产品资料提案无效");
    const claimed = await tx.chatMessage.updateMany({ where: { id: message.id, proposalStatus: "PENDING", session: { userId } }, data: { proposalStatus: "APPLYING" } });
    if (!claimed.count) return null;
    const doc = await tx.productDocument.findFirst({ where: { id: proposal.documentId, uploadedBy: userId, ready: true, productId: null, chatMessage: { sessionId: message.sessionId } }, select: { id: true } });
    if (!doc) throw new Error("PDF 已移除或已经归档，请重新上传");
    const targetId = edit ? edit.targetProductId : proposal.suggestedProduct?.id ?? null;
    const fields = edit?.product ?? proposal.product;
    let productId: string;
    if (targetId) {
      const target = await tx.product.findUnique({ where: { id: targetId }, select: { id: true } });
      if (!target) throw new Error("原产品已不存在，请选择新建产品");
      productId = target.id;
      await tx.product.update({ where: { id: productId }, data: { updatedAt: nowInstant() } });
    } else productId = (await persistProduct(tx, fields, userId)).id;
    const attached = await tx.productDocument.updateMany({ where: { id: doc.id, uploadedBy: userId, productId: null }, data: { productId } });
    if (!attached.count) throw new Error("附件已被处理，请刷新查看");
    await tx.chatMessage.update({ where: { id: message.id }, data: { proposalStatus: "CONFIRMED", proposal: { ...proposal, product: fields, savedProductId: productId } as unknown as Prisma.InputJsonValue } });
    const reply = targetId ? "已归入已有产品，PDF 说明书已保存。可以打开资料库查阅或记笔记。" : "产品档案已建立，PDF 说明书也一起保存了。可以打开资料库查阅或记笔记。";
    await tx.chatMessage.create({ data: { sessionId: message.sessionId, role: "ASSISTANT", content: reply } });
    return reply;
  }, { timeout: 15000 });
}
