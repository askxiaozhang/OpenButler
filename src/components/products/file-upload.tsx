"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Upload, LoaderCircle, CheckCircle2, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { uploadProductFile } from "@/lib/products/upload-client";

export function FileUpload({ productId, configured }: { productId: string; configured: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [results, setResults] = useState<{ name: string; error?: string }[]>([]);
  const router = useRouter();
  async function upload(files: FileList | null) {
    if (!files?.length || busy) return;
    setBusy(true); setResults([]);
    for (const original of Array.from(files)) {
      const file = original;
      try {
        await uploadProductFile(file, productId, setStatus);
        setResults((r) => [...r, { name: file.name }]);
      } catch (error) {
        setResults((r) => [...r, { name: file.name, error: error instanceof Error ? error.message : "上传失败，请重试" }]);
      }
      router.refresh();
    }
    setBusy(false); setStatus("");
    if (input.current) input.current.value = "";
    router.refresh();
  }
  return <div className="space-y-3">
    <div onDragOver={(e) => { e.preventDefault(); }} onDrop={(e) => { e.preventDefault(); if (configured && !busy) void upload(e.dataTransfer.files); }} className="rounded-xl border border-dashed bg-secondary/35 p-5 text-center">
      <Upload className="mx-auto mb-2.5 size-6 text-primary" strokeWidth={1.5} />
      <p className="text-sm font-medium">说明书、保修卡、使用截图，都放这里</p>
      <p className="mb-4 mt-1.5 text-xs leading-5 text-muted-foreground">支持 PDF、图片和 TXT，单个不超过 50 MB。也可拖入文件。</p>
      <input ref={input} type="file" multiple accept=".pdf,.png,.jpg,.jpeg,.webp,.txt" aria-label="选择产品资料" className="sr-only" tabIndex={-1} onChange={(e) => void upload(e.target.files)} disabled={busy || !configured} />
      <Button disabled={busy || !configured} onClick={() => input.current?.click()} variant="outline">{busy ? <LoaderCircle className="animate-spin" /> : <Upload />}{busy ? "正在上传…" : "选择文件上传"}</Button>
      {!configured && <p className="mt-3 text-xs text-muted-foreground">资料上传尚未配置，产品信息和笔记已可使用。</p>}
    </div>
    <div role="status" aria-live="polite" className="space-y-2">{status && <p className="break-words text-xs leading-5 text-primary">{status}</p>}{results.map((r, i) => <div key={i} className={`flex items-start gap-2 text-xs leading-5 ${r.error ? "text-destructive" : "text-primary"}`}>{r.error ? <AlertCircle className="mt-0.5 size-4 shrink-0" /> : <CheckCircle2 className="mt-0.5 size-4 shrink-0" />}<p className="min-w-0 break-words">{r.name}：{r.error || "已保存"}{r.error ? "。若下方出现未完成文件，可移除后重传。" : ""}</p></div>)}</div>
  </div>;
}
