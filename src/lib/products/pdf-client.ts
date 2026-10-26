import { MAX_INDEX_CHARS, type TextPage } from "./validation";

export async function loadPdfJs() {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = `/pdfjs/pdf.worker-${pdfjs.version}.min.mjs`;
  return pdfjs;
}
export interface FileTextIndex {
  pages: TextPage[];
  pageCount: number | null;
  indexStatus: "READY" | "PARTIAL" | "NO_TEXT" | "FAILED" | "NONE";
}
export interface PdfPreview { page: number; blob: Blob }

/** 设备上提取文字；对话附件额外生成前 3 页的受限预览，供模型读扫描件。 */
export async function extractFileContent(file: File, withPreview = false): Promise<{ index: FileTextIndex; previews: PdfPreview[] }> {
  if (file.type === "text/plain") {
    const text = await file.text();
    return { index: { pages: [{ page: 1, text: text.slice(0, MAX_INDEX_CHARS) }], pageCount: 1, indexStatus: text.length > MAX_INDEX_CHARS ? "PARTIAL" : text.trim() ? "READY" : "NO_TEXT" }, previews: [] };
  }
  const empty: FileTextIndex = { pages: [], pageCount: null, indexStatus: "NONE" };
  if (file.type !== "application/pdf") return { index: empty, previews: [] };
  let task: import("pdfjs-dist").PDFDocumentLoadingTask | undefined;
  try {
    const pdfjs = await loadPdfJs();
    task = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()), useSystemFonts: true, cMapUrl: "/pdfjs/cmaps/", cMapPacked: true, standardFontDataUrl: "/pdfjs/standard_fonts/", wasmUrl: "/pdfjs/wasm/" });
    const pdf = await task.promise;
    const pages: TextPage[] = [];
    const previews: PdfPreview[] = [];
    let remaining = MAX_INDEX_CHARS;
    let truncated = false;
    for (let page = 1; page <= Math.min(pdf.numPages, 1000); page++) {
      const pdfPage = await pdf.getPage(page);
      const content = await pdfPage.getTextContent();
      const raw = content.items.map((item) => "str" in item ? item.str + (item.hasEOL ? "\n" : " ") : "").join("");
      const text = raw.slice(0, Math.min(100_000, remaining));
      truncated ||= raw.length > text.length;
      pages.push({ page, text });
      remaining -= text.length;
      if (withPreview && page <= 3) {
        const canvas = document.createElement("canvas");
        try {
          const natural = pdfPage.getViewport({ scale: 1 });
          const viewport = pdfPage.getViewport({ scale: Math.min(2, 1280 / Math.max(natural.width, natural.height)) });
          canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
          await pdfPage.render({ canvas, viewport }).promise;
          const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.8));
          if (blob && blob.size <= 1_500_000) previews.push({ page, blob });
        } catch { /* 正文可读时，预览失败不阻止入库。 */ }
        finally { canvas.width = 0; canvas.height = 0; }
      }
      pdfPage.cleanup();
      if (remaining <= 0 && (!withPreview || page >= Math.min(3, pdf.numPages))) break;
    }
    const hasText = pages.some((p) => p.text.trim());
    return { index: { pages, pageCount: pdf.numPages, indexStatus: !hasText ? "NO_TEXT" : truncated || remaining <= 0 || pdf.numPages > 1000 ? "PARTIAL" : "READY" }, previews };
  } catch {
    return { index: { pages: [], pageCount: null, indexStatus: "FAILED" }, previews: [] };
  } finally { await task?.destroy(); }
}

export async function extractFileText(file: File): Promise<FileTextIndex> {
  return (await extractFileContent(file)).index;
}
