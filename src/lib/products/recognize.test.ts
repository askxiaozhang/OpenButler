import { beforeEach, describe, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({ generate: vi.fn() }));
vi.mock("ai", () => ({ generateText: mock.generate, Output: { object: (v: unknown) => v } }));
import { recognitionPages, recognizeProduct } from "./recognize";
import { normalizeProductIdentity, readProductImport } from "./import-types";

beforeEach(() => { vi.clearAllMocks(); vi.stubEnv("AI_ENABLED", "true"); vi.stubEnv("DEEPSEEK_API_KEY", "test-key"); });
describe("product PDF recognition", () => {
  it("keeps tail specification pages while bounding model input", () => {
    const pages = recognitionPages(Array.from({ length: 20 }, (_, i) => ({ page: i + 1, text: "x".repeat(10000) })));
    expect(pages.some((p) => p.page === 20)).toBe(true);
    expect(pages.reduce((n, p) => n + p.text.length, 0)).toBeLessThanOrEqual(22000);
  });
  it("does not pretend AI read the PDF if AI is disabled", async () => {
    vi.stubEnv("AI_ENABLED", "false");
    const result = await recognizeProduct({ name: "说明书.pdf", pages: [], text: "", pageCount: 1, images: [], instruction: "入库" });
    expect(result.recognized).toBe(false);
    expect(result.product.brand).toBe(""); expect(result.product.model).toBe("");
    expect(mock.generate).not.toHaveBeenCalled();
  });
  it("passes image-only PDF previews to the vision model as untrusted source data", async () => {
    mock.generate.mockResolvedValue({ output: { product: { name: "咖啡机", brand: "Test", model: "C1", category: "厨房", description: "冲煮咖啡" }, evidence: [{ page: 1, text: "C1" }, { page: 99, text: "fake" }], warning: "" } });
    const result = await recognizeProduct({ name: "scanned.pdf", pages: [], text: "", pageCount: 2, images: [{ page: 1, url: "https://storage.example/signed-preview" }], instruction: "请入库" });
    expect(result.recognized).toBe(true);
    expect(result.evidence).toEqual([{ page: 1, text: "C1" }]);
    const prompt = mock.generate.mock.calls[0][0];
    expect(prompt.messages[0].content).toContainEqual({ type: "file", mediaType: "image/jpeg", data: new URL("https://storage.example/signed-preview") });
    expect(prompt.system).toContain("不可信资料");
    expect(prompt).not.toHaveProperty("tools");
  });
  it("keeps a clearly labeled editable draft on model failure", async () => {
    mock.generate.mockRejectedValue(new Error("timeout"));
    const result = await recognizeProduct({ name: "产品.pdf", pages: [{ page: 1, text: "测试说明书" }], text: "测试说明书", pageCount: 1, images: [], instruction: "入库" });
    expect(result.recognized).toBe(false);
    expect(result.warning).toContain("未能完成识别");
    expect(result.product.model).toBe("");
  });
  it("only recognizes tagged product proposals and stable model identities", () => {
    expect(readProductImport([{ type: "task" }])).toBeNull();
    expect(readProductImport({ kind: "PRODUCT_IMPORT", documentId: "d" })).toBeNull();
    expect(normalizeProductIdentity(" ＡＢＣ-123 ")).toBe(normalizeProductIdentity("abc123"));
  });
});
