"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import type { PDFDocumentProxy, RenderTask } from "pdfjs-dist";
import { ChevronLeft, ChevronRight, ExternalLink, LoaderCircle, Minus, Plus, RotateCw } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { loadPdfJs } from "@/lib/products/pdf-client";

export function DocumentReader({ id, name, mimeType, page, onPageChange }: {
  id: string; name: string; mimeType: string; page: number; onPageChange: (page: number) => void;
}) {
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    void fetch(`/api/products/documents/${id}/file?format=json`, { signal: controller.signal, cache: "no-store" })
      .then(async (r) => { const data = await r.json(); if (!r.ok) throw Error(data.error); return data.url as string; })
      .then(setUrl).catch((e) => { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : "暂时无法打开资料"); });
    return () => controller.abort();
  }, [id, attempt]);
  return <section className="overflow-hidden rounded-2xl border bg-card" aria-label="资料阅读器">
    <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3"><h3 className="min-w-0 flex-1 truncate text-sm font-medium" title={name}>{name}</h3><a href={`/api/products/documents/${id}/file`} target="_blank" rel="noopener noreferrer" className={buttonVariants({ variant: "ghost", size: "sm" })}><ExternalLink />单独打开</a></div>
    {error ? <div className="space-y-3 p-8 text-center"><p role="alert" className="text-sm text-destructive">{error}</p><Button variant="outline" onClick={() => { setError(""); setUrl(""); setAttempt((n) => n + 1); }}><RotateCw />重新加载</Button></div>
      : !url ? <p className="flex items-center justify-center gap-2 p-12 text-sm text-muted-foreground"><LoaderCircle className="size-4 animate-spin" />正在打开资料…</p>
      : mimeType === "application/pdf" ? <PdfPages key={`${id}-${attempt}`} url={url} page={page} onPageChange={onPageChange} />
      : mimeType.startsWith("image/") ? <div className="max-h-[75dvh] overflow-auto bg-muted/40 p-3"><Image src={url} alt={name} width={1600} height={1600} unoptimized className="mx-auto h-auto max-w-full" referrerPolicy="no-referrer" /></div>
      : <TextDocument url={url} />}
  </section>;
}

function TextDocument({ url }: { url: string }) {
  const [text, setText] = useState<string | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    void fetch(url, { signal: controller.signal }).then(async (r) => { if (!r.ok) throw Error(); return r.text(); }).then(setText).catch(() => { if (!controller.signal.aborted) setText("读取失败，请尝试单独打开。"); });
    return () => controller.abort();
  }, [url]);
  return <pre className="max-h-[70dvh] overflow-auto whitespace-pre-wrap break-words p-5 font-sans text-sm leading-7">{text ?? "正在读取…"}</pre>;
}

function PdfPages({ url, page, onPageChange }: { url: string; page: number; onPageChange: (page: number) => void }) {
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [zoom, setZoom] = useState(1);
  const [width, setWidth] = useState(600);
  const canvas = useRef<HTMLCanvasElement>(null);
  const container = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let stopped = false;
    let task: ReturnType<typeof import("pdfjs-dist").getDocument> | undefined;
    void loadPdfJs().then((pdfjs) => {
      if (stopped) return;
      task = pdfjs.getDocument({ url, useSystemFonts: true, cMapUrl: "/pdfjs/cmaps/", cMapPacked: true, standardFontDataUrl: "/pdfjs/standard_fonts/", wasmUrl: "/pdfjs/wasm/" });
      return task.promise;
    }).then((doc) => { if (!stopped && doc) setPdf(doc); }).catch(() => { if (!stopped) { setError("PDF 无法预览（文件可能已加密）。可以单独打开或下载后阅读。"); setLoading(false); } });
    return () => { stopped = true; void task?.destroy(); };
  }, [url]);
  useEffect(() => {
    if (!container.current) return;
    const observer = new ResizeObserver((entries) => setWidth(Math.max(240, entries[0].contentRect.width - 24)));
    observer.observe(container.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!pdf || !canvas.current) return;
    let cancelled = false;
    let render: RenderTask | undefined;
    // 加载/错误更新在异步回调内，离开页面会取消渲染并释放文档。
    void pdf.getPage(Math.min(pdf.numPages, Math.max(1, page))).then(async (pdfPage) => {
      if (cancelled || !canvas.current) return;
      setLoading(true); setError("");
      const natural = pdfPage.getViewport({ scale: 1 });
      const viewport = pdfPage.getViewport({ scale: Math.min(2, window.devicePixelRatio || 1) * Math.min(1.6, width / natural.width) * zoom });
      const target = canvas.current;
      target.width = viewport.width; target.height = viewport.height;
      render = pdfPage.render({ canvas: target, viewport });
      await render.promise;
      if (!cancelled) setLoading(false);
    }).catch((e) => { if (!cancelled && e?.name !== "RenderingCancelledException") { setError("这一页读取失败，请重试或单独打开。"); setLoading(false); } });
    return () => { cancelled = true; render?.cancel(); };
  }, [pdf, page, width, zoom]);
  const currentPage = Math.min(pdf?.numPages ?? page, Math.max(1, page));
  return <>
    <div className="flex flex-wrap items-center justify-between gap-2 border-b bg-secondary/30 px-3 py-2">
      <div className="flex items-center gap-1"><Button variant="ghost" size="icon" aria-label="上一页" disabled={!pdf || currentPage <= 1} onClick={() => onPageChange(currentPage - 1)}><ChevronLeft /></Button><label className="flex items-center gap-1.5 text-xs"><input aria-label="跳转页码" type="number" min={1} max={pdf?.numPages ?? 10000} value={currentPage} onChange={(e) => { const n = Number(e.target.value); if (pdf && n >= 1 && n <= pdf.numPages) onPageChange(n); }} className="h-8 w-14 rounded-md border bg-card px-2 text-center" /> / {pdf?.numPages ?? "—"} 页</label><Button variant="ghost" size="icon" aria-label="下一页" disabled={!pdf || currentPage >= pdf.numPages} onClick={() => onPageChange(currentPage + 1)}><ChevronRight /></Button></div>
      <div className="flex items-center gap-1"><Button variant="ghost" size="icon" aria-label="缩小" disabled={zoom <= 0.7} onClick={() => setZoom((z) => Math.max(0.7, z - 0.2))}><Minus /></Button><span className="w-10 text-center text-xs">{Math.round(zoom * 100)}%</span><Button variant="ghost" size="icon" aria-label="放大" disabled={zoom >= 2} onClick={() => setZoom((z) => Math.min(2, z + 0.2))}><Plus /></Button></div>
    </div>
    <div ref={container} className="relative max-h-[72dvh] min-h-60 overflow-auto bg-muted p-3">
      {loading && !error && <p role="status" className="absolute left-1/2 top-6 z-10 flex -translate-x-1/2 items-center gap-2 rounded-lg bg-card/95 px-3 py-2 text-xs"><LoaderCircle className="size-4 animate-spin" />正在加载…</p>}
      {error && <p role="alert" className="p-5 text-sm text-destructive">{error}</p>}
      <canvas ref={canvas} aria-label={`说明书第 ${currentPage} 页`} className="mx-auto bg-white shadow-sm" style={{ width: `${Math.round(width * zoom)}px`, maxWidth: "none", height: "auto" }} />
    </div>
  </>;
}
