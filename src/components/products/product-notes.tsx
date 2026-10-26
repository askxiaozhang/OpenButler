"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Bookmark, Check, NotebookPen, Pencil, Trash2 } from "lucide-react";
import { saveProductNote, deleteProductNote } from "@/actions/products";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

export type NoteView = { id: string; content: string; documentId: string | null; pageNumber: number | null; authorId: string | null; author: string; date: string };
export function ProductNotes({ productId, notes, document, page, onJump, userId, admin }: {
  productId: string; notes: NoteView[]; document: { id: string; originalName: string; pageCount: number | null } | null;
  page: number; onJump: (id: string, page: number) => void; userId: string; admin: boolean;
}) {
  const [content, setContent] = useState("");
  const [editing, setEditing] = useState<NoteView | null>(null);
  const [attach, setAttach] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const router = useRouter();
  function submit(e: React.FormEvent) {
    e.preventDefault(); setError(""); setSaved(false);
    start(async () => {
      try {
        const result = await saveProductNote(editing?.id ?? null, {
          productId, content,
          documentId: editing ? editing.documentId : attach ? document?.id ?? null : null,
          pageNumber: editing ? editing.documentId ? editing.pageNumber : null : attach && document?.pageCount ? page : null,
        });
        if (!result.ok) { setError(result.error); return; }
        setContent(""); setEditing(null); setSaved(true); router.refresh();
      } catch { setError("保存失败，笔记还在输入框里，请重试"); }
    });
  }
  function remove(note: NoteView) {
    if (!window.confirm("删除这条笔记？")) return;
    start(async () => {
      try {
        const result = await deleteProductNote(note.id);
        if (!result.ok) setError(result.error);
        else { if (editing?.id === note.id) { setEditing(null); setContent(""); } router.refresh(); }
      } catch { setError("删除失败，请重试"); }
    });
  }
  return <section className="space-y-4 rounded-2xl border bg-card p-4 md:p-5" aria-label="产品笔记">
    <div className="flex items-center gap-2"><NotebookPen className="size-5 text-primary" /><h2 className="font-semibold">使用手记</h2><span className="ml-auto text-xs text-muted-foreground">家人共享</span></div>
    <form onSubmit={submit} className="space-y-3">
      {editing && <div className="flex items-center justify-between text-xs text-primary"><span>正在修改笔记</span><button type="button" onClick={() => { setEditing(null); setContent(""); setError(""); }}>取消修改</button></div>}
      <Textarea aria-label="使用笔记内容" value={content} maxLength={10000} onChange={(e) => { setContent(e.target.value); setSaved(false); }} className="min-h-28" placeholder="记下好用的设置、操作步骤，或下次别再踩的坑…" required />
      {!editing && document && <label className="flex cursor-pointer items-start gap-2 text-xs leading-5 text-muted-foreground"><input type="checkbox" checked={attach} onChange={(e) => setAttach(e.target.checked)} className="mt-0.5 accent-primary" /><span>关联「{document.originalName}」{document.pageCount ? `第 ${page} 页` : ""}</span></label>}
      <div className="flex items-center justify-between gap-2"><span role="status" className="flex items-center gap-1 text-xs text-primary">{saved && <><Check className="size-3.5" />笔记已保存</>}</span><Button type="submit" disabled={pending || !content.trim()} size="sm" className="h-9">{pending ? "正在保存…" : editing ? "保存修改" : "记下来"}</Button></div>
    </form>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    {notes.length ? <div className="space-y-5 border-t pt-4">{notes.map((note) => <article key={note.id} className="space-y-2">
      <p className="whitespace-pre-wrap break-words text-sm leading-7">{note.content}</p>
      {note.documentId && <button type="button" onClick={() => onJump(note.documentId!, note.pageNumber ?? 1)} className="flex max-w-full items-center gap-1.5 text-xs text-primary hover:underline"><Bookmark className="size-3 shrink-0" />{note.pageNumber ? `查看说明书第 ${note.pageNumber} 页` : "查看关联资料"}</button>}
      <div className="flex items-center gap-2 text-[11px] text-muted-foreground"><span>{note.author} · {note.date}</span>{(note.authorId === userId || admin) && <div className="ml-auto flex"><Button aria-label="修改笔记" title="修改笔记" size="icon-sm" variant="ghost" disabled={pending} onClick={() => { setEditing(note); setContent(note.content); setSaved(false); setError(""); }}><Pencil className="size-3.5" /></Button><Button aria-label="删除笔记" title="删除笔记" size="icon-sm" variant="ghost" disabled={pending} onClick={() => remove(note)}><Trash2 className="size-3.5" /></Button></div>}</div>
    </article>)}</div> : <p className="border-t pt-4 text-sm leading-6 text-muted-foreground">还没有笔记。把说明书里最有用的一步，变成自己的经验。</p>}
    {notes.length >= 200 && <p className="text-xs text-muted-foreground">当前显示最新 200 条笔记，可在资料库搜索关键词查找更早的笔记。</p>}
  </section>;
}
