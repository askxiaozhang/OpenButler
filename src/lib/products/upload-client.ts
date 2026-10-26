import { extractFileContent } from "./pdf-client";
import { validateProductFile, fileSizeLabel } from "./validation";

export class ProductUploadError extends Error {
  constructor(message: string, public documentId?: string) { super(message); }
}
export function normalizeProductFile(original: File): File {
  const inferred = ({ pdf: "application/pdf", txt: "text/plain", jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp" } as Record<string, string>)[original.name.split(".").at(-1)?.toLowerCase() ?? ""];
  return original.type ? original : new File([original], original.name, { type: inferred || "application/octet-stream" });
}
function directUpload(url: string, file: Blob, progress?: (percent: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url); xhr.timeout = 300_000;
    xhr.setRequestHeader("Content-Type", file.type);
    xhr.setRequestHeader("cache-control", "max-age=3600");
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) progress?.(Math.round(e.loaded * 100 / e.total)); };
    xhr.onerror = () => reject(new Error("上传连接中断，请检查网络后重试"));
    xhr.ontimeout = () => reject(new Error("上传超时，请重试"));
    xhr.onload = () => xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error("文件上传失败，请重试"));
    xhr.send(file);
  });
}

export async function uploadProductFile(original: File, productId: string | null, status: (text: string) => void): Promise<{ id: string; name: string; size: number }> {
  const file = normalizeProductFile(original);
  const invalid = validateProductFile(file.name, file.type, file.size);
  if (invalid) throw new ProductUploadError(invalid);
  if (!productId && file.type !== "application/pdf") throw new ProductUploadError("请添加 PDF 说明书");
  let id: string | undefined;
  try {
    status(`正在准备 ${file.name}（${fileSizeLabel(file.size)}）`);
    const start = await fetch("/api/products/uploads", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ productId: productId ?? undefined, purpose: productId ? "product" : "chat", name: file.name, size: file.size, mimeType: file.type }) });
    const ticket = await start.json();
    if (!start.ok) throw new Error(ticket.error || "无法开始上传");
    id = ticket.id;
    await directUpload(ticket.uploadUrl, file, (percent) => status(`正在上传 ${file.name} · ${percent}%`));
    status(productId ? "正在提取正文，方便以后搜索…" : "正在读取说明书，并生成页面预览…");
    const { index, previews } = await extractFileContent(file, !productId);
    for (const preview of previews) {
      const target = ticket.previews?.find((p: { page: number }) => p.page === preview.page);
      if (!target) throw new Error("预览上传信息无效");
      status(`正在上传第 ${preview.page} 页预览…`);
      await directUpload(target.uploadUrl, preview.blob);
    }
    status("正在保存附件…");
    const finish = await fetch("/api/products/uploads", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ id, ...index, previewPages: previews.map((p) => p.page) }) });
    const result = await finish.json();
    if (!finish.ok) throw new Error(result.error || "保存上传结果失败");
    return { id: id!, name: file.name, size: file.size };
  } catch (error) { throw new ProductUploadError(error instanceof Error ? error.message : "上传失败，请重试", id); }
}
