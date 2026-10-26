import { beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ message: vi.fn(), claim: vi.fn(), document: vi.fn(), attach: vi.fn(), product: vi.fn(), target: vi.fn(), update: vi.fn(), reply: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: () => ({ $transaction: async (fn: (tx: unknown) => unknown) => fn({ chatMessage: { findFirst: m.message, updateMany: m.claim, update: m.update, create: m.reply }, productDocument: { findFirst: m.document, updateMany: m.attach }, product: { create: m.product, findUnique: m.target, update: vi.fn() } }) }) }));
vi.mock("@/lib/products/recognize", () => ({ recognizeProduct: vi.fn() }));
import { confirmProductImport } from "./product-import";
const fields = { name: "扫地机器人", brand: "测试", model: "R1", category: "家电", description: "" };
const proposal = { kind: "PRODUCT_IMPORT", documentId: "d1", product: fields, evidence: [], warning: "", recognized: true, suggestedProduct: null, savedProductId: null };
beforeEach(() => {
  vi.clearAllMocks(); m.message.mockResolvedValue({ id: "m1", sessionId: "s1", proposal });
  m.claim.mockResolvedValue({ count: 1 }); m.document.mockResolvedValue({ id: "d1" });
  m.attach.mockResolvedValue({ count: 1 }); m.product.mockResolvedValue({ id: "p1" });
});
describe("confirmed chat product imports", () => {
  it("never imports a proposal owned by another account", async () => {
    m.message.mockResolvedValue(null);
    expect(await confirmProductImport("other", "m1")).toBeNull();
    expect(m.message.mock.calls[0][0].where.session).toEqual({ userId: "other" });
    expect(m.product).not.toHaveBeenCalled();
  });
  it("does not create another product if a concurrent click already claimed the proposal", async () => {
    m.claim.mockResolvedValue({ count: 0 });
    expect(await confirmProductImport("u1", "m1")).toBeNull();
    expect(m.product).not.toHaveBeenCalled();
  });
  it("requires the same user's unassigned file in the same chat session", async () => {
    m.document.mockResolvedValue(null);
    await expect(confirmProductImport("u1", "m1")).rejects.toThrow("PDF");
    expect(m.document.mock.calls[0][0].where).toMatchObject({ uploadedBy: "u1", productId: null, ready: true, chatMessage: { sessionId: "s1" } });
    expect(m.product).not.toHaveBeenCalled();
  });
  it("creates a product and attaches the original stored PDF without uploading it again", async () => {
    await confirmProductImport("u1", "m1");
    expect(m.product).toHaveBeenCalledWith({ data: { ...fields, authorId: "u1" }, select: { id: true } });
    expect(m.attach.mock.calls[0][0].data).toEqual({ productId: "p1" });
    expect(m.update.mock.calls[0][0].data).toMatchObject({ proposalStatus: "CONFIRMED", proposal: { savedProductId: "p1" } });
  });
  it("adds a PDF to an existing product without overwriting its information", async () => {
    m.target.mockResolvedValue({ id: "existing" });
    await confirmProductImport("u1", "m1", { product: fields, targetProductId: "existing" });
    expect(m.product).not.toHaveBeenCalled();
    expect(m.attach.mock.calls[0][0].data).toEqual({ productId: "existing" });
  });
});
