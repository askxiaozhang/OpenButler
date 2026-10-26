"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { BookOpen, Download, FileText, Search, Trash2, StickyNote, Upload } from "lucide-react";
import { deleteProductDocument } from "@/actions/products";
import { FileUpload } from "./file-upload";
import { ProductNotes, type NoteView } from "./product-notes";
import { Button, buttonVariants } from "@/components/ui/button";
import { fileSizeLabel, textSnippet, type TextPage } from "@/lib/products/validation";
import { cn } from "@/lib/utils";

const DocumentReader = dynamic(() => import("./document-reader").then((m) => m.DocumentReader), { ssr: false, loading: () => <p className="rounded-xl border p-10 text-center text-sm text-muted-foreground">正在打开阅读器…</p> });
export type DocumentView = { id: string; originalName: string; mimeType: string; size: number; ready: boolean; uploadedBy: string; pageCount: number | null; indexStatus: string };
export function ProductWorkspace({ productId, documents, notes, configured, userId, admin, initialDocumentId, initialPage, query }: {
  productId: string; documents: DocumentView[]; notes: NoteView[]; configured: boolean; userId: string; admin: boolean;
  initialDocumentId: string | null; initialPage: number; query: string;
}) {
  const [selectedId, setSelectedId] = useState(initialDocumentId);
  const [page, setPage] = useState(initialPage);
  const [search, setSearch] = useState(query);
  const [indexed, setIndexed] = useState<{ id: string; pages: TextPage[] } | null>(null);
  const [error, setError] = useState("");
  const [indexError, setIndexError] = useState("");
  const [pending, start] = useTransition();
  const reader = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const ready = documents.filter((d) => d.ready);
  const selected = ready.find((d) => d.id === selectedId) ?? ready[0] ?? null;
  const documentId = selected?.id;
  useEffect(() => {
    if (!documentId) return;
    const controller = new AbortController();
    void fetch(`/api/products/documents/${documentId}/index`, { signal: controller.signal })
      .then(async (r) => { if (!r.ok) throw Error(); return r.json(); })
      .then((pages: TextPage[]) => { setIndexed({ id: documentId, pages }); setIndexError(""); })
      .catch(() => { if (!controller.signal.aborted) setIndexError("正文索引暂时读取失败，可继续阅读或刷新重试。"); });
    return () => controller.abort();
  }, [documentId]);
  const normalizedSearch = search.trim().toLocaleLowerCase();
  const hits = indexed?.id === documentId && normalizedSearch ? indexed.pages.filter((p) => p.text.toLocaleLowerCase().includes(normalizedSearch)) : [];
  function jump(id: string, nextPage: number) {
    setSelectedId(id); setPage(nextPage); setError("");
    reader.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }
  function remove(doc: DocumentView) {
    if (!window.confirm(`删除「${doc.originalName}」？已写的笔记会保留。`)) return;
    setError("");
    start(async () => {
      try {
        const result = await deleteProductDocument(doc.id);
        if (!result.ok) setError(result.error);
        else { if (selectedId === doc.id) { setSelectedId(null); setPage(1); } router.refresh(); }
      } catch { setError("删除失败，请重试"); }
    });
  }
  return <div className="space-y-6">
    <div className="grid items-start gap-5 lg:grid-cols-[240px_minmax(0,1fr)] xl:grid-cols-[260px_minmax(0,1fr)]">
      <aside className="space-y-4" aria-label="产品资料列表">
        <div className="rounded-2xl border bg-card p-4"><h2 className="mb-4 flex items-center gap-2 font-semibold"><FileText className="size-4 text-primary" />产品资料 <span className="ml-auto text-xs font-normal text-muted-foreground">{ready.length} 份</span></h2>
          {documents.length ? <ul className="space-y-2">{documents.map((doc) => <li key={doc.id} className={cn("rounded-xl p-3", selected?.id === doc.id ? "bg-secondary" : "bg-muted/40")}>
            <button type="button" disabled={!doc.ready} onClick={() => jump(doc.id, 1)} aria-current={selected?.id === doc.id ? "true" : undefined} className="w-full text-left disabled:opacity-60"><span className="block break-words text-sm leading-6">{doc.originalName}</span><span className="mt-1 block text-[11px] text-muted-foreground">{fileSizeLabel(doc.size)}{doc.pageCount ? ` · ${doc.pageCount} 页` : ""}{!doc.ready ? " · 未完成上传" : ""}</span></button>
            <div className="mt-2 flex items-center justify-between">{doc.ready ? <a aria-label={`下载 ${doc.originalName}`} href={`/api/products/documents/${doc.id}/file?download=1`} className="flex items-center gap-1 text-xs text-primary"><Download className="size-3" />下载</a> : <span className="text-[11px] text-muted-foreground">移除后可重新上传</span>}{(doc.uploadedBy === userId || admin) && <Button variant="ghost" size="icon-sm" aria-label={`删除 ${doc.originalName}`} disabled={pending} onClick={() => remove(doc)}><Trash2 className="size-3.5" /></Button>}</div>
          </li>)}</ul> : <p className="text-sm leading-6 text-muted-foreground">还没有资料。先上传一份说明书。</p>}
        </div>
        <details open={!ready.length} className="rounded-xl border bg-card p-3">
          <summary className="flex cursor-pointer items-center gap-2 text-sm font-medium text-primary"><Upload className="size-4" />上传更多资料</summary>
          <div className="mt-3"><FileUpload productId={productId} configured={configured} /></div>
        </details>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      </aside>
      <div ref={reader} className="min-w-0 scroll-mt-28 space-y-4">
        {selected ? <>
          <div className="rounded-xl border bg-card p-3">
            <label className="flex items-center gap-2 text-sm"><Search className="size-4 shrink-0 text-muted-foreground" /><input aria-label="搜索当前资料正文" type="search" maxLength={120} placeholder="在当前资料里查找关键词…" value={search} onChange={(e) => setSearch(e.target.value)} className="h-8 min-w-0 flex-1 bg-transparent outline-none focus-visible:ring-2 focus-visible:ring-ring" /></label>
            {indexError && <p className="mt-2 text-xs text-muted-foreground">{indexError}</p>}
            {normalizedSearch && <div className="mt-2 max-h-48 space-y-2 overflow-y-auto border-t pt-3">{indexed?.id !== documentId ? <p className="text-xs text-muted-foreground">正在读取正文索引…</p> : hits.length ? hits.slice(0, 40).map((hit) => <button key={hit.page} className="block w-full rounded-lg bg-secondary/70 p-3 text-left text-xs leading-6 hover:bg-secondary" onClick={() => setPage(hit.page)}><span className="font-medium text-primary">第 {hit.page} 页 · </span>{textSnippet(hit.text, search.trim())}</button>) : <p className="text-xs text-muted-foreground">当前资料未找到这个关键词，可换一份资料，或查看下方笔记。</p>}</div>}
          </div>
          <DocumentReader key={selected.id} id={selected.id} name={selected.originalName} mimeType={selected.mimeType} page={page} onPageChange={setPage} />
          {selected.indexStatus === "NO_TEXT" && <p className="text-xs leading-6 text-muted-foreground">这份文件未提取到文字，可能是扫描版。可以正常阅读并记笔记，暂不支持图片文字搜索。</p>}
          {selected.indexStatus === "PARTIAL" && <p className="text-xs leading-6 text-muted-foreground">文件较长，已索引前 30 万字（最多 1000 页）。完整内容可在阅读器或下载后查看。</p>}
          {selected.indexStatus === "FAILED" && <p className="text-xs leading-6 text-muted-foreground">文件已保存，但正文提取失败。可尝试单独打开，产品信息和笔记仍可搜索。</p>}
        </> : <div className="flex min-h-72 flex-col items-center justify-center rounded-2xl border bg-card p-8 text-center"><BookOpen className="mb-4 size-10 text-primary/60" strokeWidth={1.3} /><h2 className="font-medium">留住说明书，也留住自己的经验</h2><p className="mt-2 max-w-sm text-sm leading-7 text-muted-foreground">上传后可在这里翻阅资料。还没找到说明书，也可以先在下面记下使用心得。</p></div>}
        <div className="flex items-center gap-2 text-xs text-muted-foreground"><StickyNote className="size-3.5" />阅读到有用的地方，在下方写笔记并关联当前页。</div>
        <ProductNotes productId={productId} notes={notes} document={selected} page={page} onJump={jump} userId={userId} admin={admin} />
      </div>
    </div>
    <Link href="/products" className={buttonVariants({ variant: "ghost", size: "sm" })}>返回全部产品</Link>
  </div>;
}
