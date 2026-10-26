import { describe, expect, it } from "vitest";
import { MAX_FILE_SIZE, finishUploadSchema, productNoteSchema, validateProductFile } from "./validation";

describe("product library upload boundaries", () => {
  it("rejects files disguised by extensions and oversized files", () => {
    expect(validateProductFile("manual.pdf", "application/pdf", 100)).toBeNull();
    expect(validateProductFile("manual.PDF", "application/pdf", MAX_FILE_SIZE)).toBeNull();
    expect(validateProductFile("manual.html", "application/pdf", 100)).toBeTruthy();
    expect(validateProductFile("manual.pdf", "text/html", 100)).toBeTruthy();
    expect(validateProductFile("manual.pdf", "application/pdf", MAX_FILE_SIZE + 1)).toBeTruthy();
    expect(validateProductFile("manual.pdf", "application/pdf", -1)).toBeTruthy();
  });
  it("rejects invalid or duplicated indexed page references", () => {
    const base = { id: "doc1", pageCount: 2, indexStatus: "READY" };
    expect(finishUploadSchema.safeParse({ ...base, pages: [{ page: 1, text: "重置" }] }).success).toBe(true);
    expect(finishUploadSchema.safeParse({ ...base, pages: [{ page: 3, text: "wrong" }] }).success).toBe(false);
    expect(finishUploadSchema.safeParse({ ...base, pages: [{ page: 1, text: "a" }, { page: 1, text: "b" }] }).success).toBe(false);
  });
  it("bounds total indexed text without accepting an unbounded payload", () => {
    expect(finishUploadSchema.safeParse({ id: "d", pageCount: 4, indexStatus: "READY", pages: [1, 2, 3, 4].map((page) => ({ page, text: "a".repeat(100000) })) }).success).toBe(false);
  });
  it("requires a document when attaching a note to a page", () => {
    expect(productNoteSchema.safeParse({ productId: "p", content: "测试心得", documentId: null, pageNumber: 2 }).success).toBe(false);
    expect(productNoteSchema.safeParse({ productId: "p", content: "测试心得", documentId: "d", pageNumber: 2 }).success).toBe(true);
  });
});
