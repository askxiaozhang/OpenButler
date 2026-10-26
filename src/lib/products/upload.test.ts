import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
const mock = vi.hoisted(() => ({ user: vi.fn(), count: vi.fn(), pending: vi.fn(), find: vi.fn(), create: vi.fn(), update: vi.fn(), transaction: vi.fn(), info: vi.fn(), sign: vi.fn() }));
vi.mock("@/lib/auth/guard", () => ({ getCurrentUser: mock.user }));
vi.mock("@/lib/db", () => ({ db: () => ({ product: { count: mock.count, update: vi.fn() }, productDocument: { count: mock.pending, findFirst: mock.find, create: mock.create, update: mock.update }, $transaction: mock.transaction }) }));
vi.mock("./storage", () => ({ productPreviewPath: (path: string, page: number) => `${path}.page-${page}.jpg`, productStorageConfigured: () => true, ensureProductBucket: vi.fn(), productStorage: () => ({ info: mock.info, createSignedUploadUrl: mock.sign }) }));
import { POST, PATCH } from "@/app/api/products/uploads/route";
const origin = "https://home.example";
function request(method: string, body: unknown, requestOrigin = origin) { return new Request(origin + "/api/products/uploads", { method, headers: { origin: requestOrigin, "content-type": "application/json" }, body: JSON.stringify(body) }); }
beforeEach(() => {
  vi.clearAllMocks();
  mock.user.mockResolvedValue({ id: "u1" }); mock.count.mockResolvedValue(1); mock.pending.mockResolvedValue(0);
  mock.find.mockResolvedValue({ id: "d1", productId: "p1", uploadedBy: "u1", ready: false, storagePath: "p1/file.pdf", mimeType: "application/pdf", size: 512 });
  mock.info.mockResolvedValue({ data: { size: 512, contentType: "application/pdf" }, error: null });
});
describe("private product file upload authorization", () => {
  it("denies anonymous and cross-origin upload requests before signing URLs", async () => {
    mock.user.mockResolvedValue(null);
    expect((await POST(request("POST", {}))).status).toBe(401);
    mock.user.mockResolvedValue({ id: "u1" });
    expect((await POST(request("POST", {}, "https://unrelated.example"))).status).toBe(401);
    expect(mock.sign).not.toHaveBeenCalled();
  });
  it("does not mark files as ready when actual stored bytes differ", async () => {
    mock.info.mockResolvedValue({ data: { size: 1000, contentType: "application/pdf" }, error: null });
    expect((await PATCH(request("PATCH", { id: "d1", pages: [], pageCount: 1, indexStatus: "NO_TEXT" }))).status).toBe(400);
    expect(mock.transaction).not.toHaveBeenCalled();
  });
  it("only finalizes the current user's pending upload", async () => {
    mock.find.mockResolvedValue(null);
    expect((await PATCH(request("PATCH", { id: "other-user-document", pages: [], pageCount: 1, indexStatus: "NO_TEXT" }))).status).toBe(404);
    expect(mock.find).toHaveBeenCalledWith({ where: { id: "other-user-document", uploadedBy: "u1" } });
    expect(mock.info).not.toHaveBeenCalled();
  });
  it("stores a verified object and indexed pages together", async () => {
    const result = await PATCH(request("PATCH", { id: "d1", pages: [{ page: 2, text: "长按十秒重置" }], pageCount: 2, indexStatus: "READY" }));
    expect(result.status).toBe(200);
    expect(mock.update).toHaveBeenCalledWith({ where: { id: "d1" }, data: { ready: true, pageCount: 2, textPages: [{ page: 2, text: "长按十秒重置" }], visionPages: [], extractedText: "长按十秒重置", indexStatus: "READY" } });
    expect(mock.transaction).toHaveBeenCalledOnce();
  });
  it("stages a chat PDF without creating a product first", async () => {
    mock.create.mockResolvedValue({ id: "d1" });
    mock.sign.mockResolvedValue({ data: { signedUrl: "https://storage.example/scoped-upload" }, error: null });
    const result = await POST(request("POST", { purpose: "chat", name: "manual.pdf", mimeType: "application/pdf", size: 512 }));
    expect(result.status).toBe(200);
    expect(mock.count).not.toHaveBeenCalled();
    expect(mock.create.mock.calls[0][0].data).toMatchObject({ productId: null, uploadedBy: "u1" });
    expect((await result.json()).previews).toHaveLength(3);
  });
  it("only records verified previews at server-generated paths", async () => {
    mock.find.mockResolvedValue({ id: "d1", productId: null, uploadedBy: "u1", ready: false, storagePath: "chat/u1/file.pdf", mimeType: "application/pdf", size: 512 });
    mock.info.mockResolvedValueOnce({ data: { size: 512, contentType: "application/pdf" }, error: null })
      .mockResolvedValueOnce({ data: { size: 1234, contentType: "image/jpeg" }, error: null });
    const result = await PATCH(request("PATCH", { id: "d1", pages: [], pageCount: 1, previewPages: [1], indexStatus: "NO_TEXT", maliciousPath: "other-user/private.pdf" }));
    expect(result.status).toBe(200);
    expect(mock.info.mock.calls[1][0]).toBe("chat/u1/file.pdf.page-1.jpg");
    expect(mock.update.mock.calls[0][0].data.visionPages).toEqual([{ page: 1, path: "chat/u1/file.pdf.page-1.jpg" }]);
  });
  it("rejects an oversized preview instead of sending it to the vision model", async () => {
    mock.find.mockResolvedValue({ id: "d1", productId: null, uploadedBy: "u1", ready: false, storagePath: "chat/u1/file.pdf", mimeType: "application/pdf", size: 512 });
    mock.info.mockResolvedValueOnce({ data: { size: 512, contentType: "application/pdf" }, error: null })
      .mockResolvedValueOnce({ data: { size: 2_000_000, contentType: "image/jpeg" }, error: null });
    expect((await PATCH(request("PATCH", { id: "d1", pages: [], pageCount: 1, previewPages: [1], indexStatus: "NO_TEXT" }))).status).toBe(502);
    expect(mock.transaction).not.toHaveBeenCalled();
  });
});
