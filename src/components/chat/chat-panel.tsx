"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { ArrowUp, Check, CircleEllipsis, Sparkles, X, Paperclip, FileText, LoaderCircle } from "lucide-react";
import {
  cancelChatProposalAction,
  confirmChatProductAction,
  confirmChatProposalAction,
  sendChatMessageAction,
} from "@/actions/chat";
import { deleteProductDocument } from "@/actions/products";
import { uploadProductFile, ProductUploadError } from "@/lib/products/upload-client";
import { fileSizeLabel } from "@/lib/products/validation";
import { nowInstant } from "@/lib/time";
import { ChatProductCard } from "./product-import-card";
import type { ProductImportEdit } from "@/lib/products/import-types";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import type { ChatMessageView } from "@/lib/chat/service";

const SUGGESTIONS = [
  "猫咪今天剪指甲了，每 14 天一次",
  "周五提醒我交物业费",
  "今天有什么待办？",
];

type DraftAttachment = { id?: string; name: string; size: number; status: "uploading" | "ready" | "failed"; progress?: string };
export function ChatPanel({ initialMessages, attachmentsConfigured = false, initialDrafts = [] }: { initialMessages: ChatMessageView[]; attachmentsConfigured?: boolean; initialDrafts?: DraftAttachment[] }) {
  const [messages, setMessages] = useState(initialMessages);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [attachment, setAttachment] = useState<DraftAttachment | null>(initialDrafts[0] ?? null);
  const [draftQueue, setDraftQueue] = useState(initialDrafts.slice(1));
  const fileInput = useRef<HTMLInputElement>(null);
  const retryMessageId = useRef<string | null>(null);
  const uploadBusy = attachment?.status === "uploading";
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: messages.length > 1 ? "smooth" : "auto" });
  }, [messages, pending]);

  function send(value = text) {
    const trimmed = value.trim();
    if ((!trimmed && attachment?.status !== "ready") || pending || uploadBusy || attachment?.status === "failed") return;
    const messageText = trimmed || "帮我识别这份说明书，整理产品资料并入库。";
    const clientMessageId = retryMessageId.current ?? crypto.randomUUID();
    retryMessageId.current = clientMessageId;
    const optimistic: ChatMessageView = {
      id: `optimistic-${clientMessageId}`,
      role: "user",
      content: messageText,
      attachments: attachment?.id ? [{ id: attachment.id, name: attachment.name, size: attachment.size, productId: null }] : [],
      proposalStatus: null,
      createdAt: nowInstant().toISOString(),
    };
    setText("");
    setError(null);
    setMessages((current) => [...current, optimistic]);
    startTransition(async () => {
      try {
        const result = await sendChatMessageAction(messageText, clientMessageId, attachment?.id ? [attachment.id] : []);
        if (result.ok) { setMessages(result.data.messages); setAttachment(draftQueue[0] ?? null); setDraftQueue((q) => q.slice(1)); retryMessageId.current = null; }
        else {
          setMessages((current) => current.filter((item) => item.id !== optimistic.id));
          setError(result.error); setText(trimmed);
        }
      } catch {
        setMessages((current) => current.filter((item) => item.id !== optimistic.id));
        setError("发送没有完成，附件还保留着，请重试。"); setText(trimmed);
      }
    });
  }

  async function choosePdf(file: File | undefined) {
    if (!file || pending || uploadBusy || attachment) return;
    setError(null);
    setAttachment({ name: file.name, size: file.size, status: "uploading" });
    try {
      const uploaded = await uploadProductFile(file, null, (progress) => setAttachment({ name: file.name, size: file.size, status: "uploading", progress }));
      setAttachment({ ...uploaded, status: "ready" });
    } catch (e) {
      setAttachment({ id: e instanceof ProductUploadError ? e.documentId : undefined, name: file.name, size: file.size, status: "failed" });
      setError(e instanceof Error ? e.message : "附件上传失败");
    }
    if (fileInput.current) fileInput.current.value = "";
  }
  function removeAttachment() {
    if (pending || uploadBusy) return;
    if (!attachment?.id) { setAttachment(draftQueue[0] ?? null); setDraftQueue((q) => q.slice(1)); setError(null); return; }
    startTransition(async () => {
      try {
        const result = await deleteProductDocument(attachment.id!);
        if (!result.ok) { setError(result.error); return; }
        setAttachment(draftQueue[0] ?? null); setDraftQueue((q) => q.slice(1)); setError(null); retryMessageId.current = null;
      } catch { setError("附件暂时无法移除，请重试"); }
    });
  }
  function confirmProduct(messageId: string, input: ProductImportEdit) {
    if (pending || uploadBusy) return;
    setError(null);
    startTransition(async () => {
      try {
        const result = await confirmChatProductAction(messageId, input);
        if (result.ok) setMessages(result.data.messages);
        else setError(result.error);
      } catch { setError("产品尚未入库，请重试。"); }
    });
  }

  function resolveProposal(messageId: string, choice: "confirm" | "cancel") {
    if (pending || uploadBusy) return;
    setError(null);
    startTransition(async () => {
      try {
        const result = choice === "confirm"
          ? await confirmChatProposalAction(messageId)
          : await cancelChatProposalAction(messageId);
        if (result.ok) setMessages(result.data.messages);
        else setError(result.error);
      } catch { setError("操作没有完成，请重试。"); }
    });
  }

  return (
    <section className="flex min-h-[620px] flex-col overflow-hidden rounded-[1.75rem] border bg-card shadow-[0_14px_44px_rgba(51,72,57,0.08)] md:h-[calc(100dvh-8rem)] md:min-h-[680px]">
      <div className="flex items-center gap-3 border-b bg-[#f7f2e9]/75 px-5 py-4">
        <span className="flex size-10 items-center justify-center rounded-2xl bg-primary text-primary-foreground">
          <Sparkles className="size-5" strokeWidth={1.6} />
        </span>
        <div>
          <h2 className="text-sm font-semibold">家庭管家</h2>
          <p className="text-muted-foreground mt-0.5 text-xs">先理解，再确认；不会悄悄改动记录</p>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-6 md:px-7">
        {messages.length === 0 ? (
          <div className="mx-auto flex h-full max-w-md flex-col items-center justify-center py-12 text-center">
            <span className="flex size-16 items-center justify-center rounded-[1.5rem] bg-secondary text-primary">
              <Sparkles className="size-7" strokeWidth={1.4} />
            </span>
            <h3 className="mt-5 text-xl font-semibold">有什么要交给管家？</h3>
            <p className="text-muted-foreground mt-2 max-w-xs text-sm leading-6">
              记一件刚发生的事、安排提醒，或上传 PDF 说明书，让我整理产品资料。
            </p>
            <div className="mt-7 flex w-full flex-col gap-2">
              {SUGGESTIONS.map((suggestion) => (
                <button
                  key={suggestion}
                  type="button"
                  onClick={() => send(suggestion)}
                  className="hover:border-primary/30 hover:bg-secondary/60 rounded-2xl border bg-background px-4 py-3 text-left text-sm transition-colors"
                >
                  {suggestion}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="mx-auto max-w-2xl space-y-5">
            {messages.map((message) => (
              <div
                key={message.id}
                className={cn("flex", message.role === "user" ? "justify-end" : "justify-start")}
              >
                <div className={cn("max-w-[88%] md:max-w-[78%]", message.role === "assistant" && "flex gap-2.5")}>
                  {message.role === "assistant" ? (
                    <span className="mt-1 flex size-7 shrink-0 items-center justify-center rounded-xl bg-secondary text-primary">
                      <Sparkles className="size-3.5" />
                    </span>
                  ) : null}
                  <div>
                    <div
                      className={cn(
                        "whitespace-pre-wrap rounded-2xl px-4 py-3 text-sm leading-6",
                        message.role === "user"
                          ? "rounded-br-md bg-primary text-primary-foreground"
                          : "rounded-bl-md border bg-background",
                      )}
                    >
                      {message.content}
                    </div>
                    {message.attachments?.map((a) => <a key={a.id} href={`/api/products/documents/${a.id}/file`} target="_blank" rel="noopener noreferrer" className="mt-2 flex items-center gap-2 rounded-xl border bg-card px-3 py-2.5 text-xs text-primary"><FileText className="size-4 shrink-0" /><span className="min-w-0 break-words">{a.name}<span className="mt-0.5 block text-[11px] text-muted-foreground">{fileSizeLabel(a.size)} · {a.productId ? "已入资料库" : "对话附件"}</span></span></a>)}
                    {message.productImport ? <ChatProductCard proposal={message.productImport} status={message.proposalStatus} disabled={pending || uploadBusy} onConfirm={(input) => confirmProduct(message.id, input)} onCancel={() => resolveProposal(message.id, "cancel")} onRetry={() => send("重新识别说明书")} /> : message.role === "assistant" && message.proposalStatus ? (
                      <ProposalControls
                        status={message.proposalStatus}
                        disabled={pending || uploadBusy}
                        onConfirm={() => resolveProposal(message.id, "confirm")}
                        onCancel={() => resolveProposal(message.id, "cancel")}
                      />
                    ) : null}
                  </div>
                </div>
              </div>
            ))}
            {pending ? (
              <div className="flex items-center gap-2 pl-10 text-xs text-muted-foreground">
                <CircleEllipsis className="size-4 animate-pulse" /> 管家正在整理…
              </div>
            ) : null}
            <div ref={bottomRef} />
          </div>
        )}
      </div>

      <div className="border-t bg-card p-3 md:p-4">
        {error ? <p className="text-destructive mb-2 px-1 text-xs">{error}</p> : null}
        <div className="relative mx-auto max-w-2xl">
          {attachment && <div className="mb-2 flex items-center gap-2 rounded-xl border bg-secondary/50 px-3 py-2.5 text-xs" aria-live="polite">
            {uploadBusy ? <LoaderCircle className="size-4 shrink-0 animate-spin text-primary" /> : <FileText className="size-4 shrink-0 text-primary" />}
            <div className="min-w-0 flex-1"><p className="truncate font-medium">{attachment.name}</p><p className="mt-1 break-words text-[11px] text-muted-foreground">{attachment.status === "ready" ? "已上传 · 发送后由管家识别产品" : attachment.progress ?? "上传失败，请移除后重试"}</p></div>
            <Button type="button" size="icon-sm" variant="ghost" aria-label="移除 PDF 附件" disabled={pending || uploadBusy} onClick={removeAttachment}><X className="size-3.5" /></Button>
          </div>}
          <input ref={fileInput} type="file" accept=".pdf,application/pdf" aria-label="添加 PDF 说明书" className="sr-only" tabIndex={-1} disabled={pending || uploadBusy || Boolean(attachment) || !attachmentsConfigured} onChange={(e) => void choosePdf(e.target.files?.[0])} />
          {draftQueue.length > 0 && <p className="mb-2 text-[11px] text-muted-foreground">还有 {draftQueue.length} 份未发送附件，处理当前附件后会显示下一份。</p>}
          <div className="relative">
          <Textarea
            aria-label="发送给管家的消息"
            value={text}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault();
                send();
              }
            }}
            placeholder={attachment ? "可补充：这是客厅的产品，帮我整理并入库…" : "告诉管家一件事，或添加 PDF 说明书…"}
            rows={2}
            maxLength={500}
            disabled={pending || uploadBusy}
            className="min-h-[72px] resize-none rounded-2xl bg-background px-4 py-3 pr-14 text-base leading-6 md:text-sm"
          />
          <Button
            type="button"
            size="icon-lg"
            aria-label="发送"
            disabled={pending || uploadBusy || attachment?.status === "failed" || (!text.trim() && attachment?.status !== "ready")}
            onClick={() => send()}
            className="absolute right-3 bottom-3 rounded-xl"
          >
            <ArrowUp className="size-4" />
          </Button>
          </div>
          <div className="mt-2 flex items-center justify-between gap-2">
            <Button type="button" size="sm" variant="ghost" className="h-8 text-xs" aria-label="添加 PDF 附件" disabled={pending || uploadBusy || Boolean(attachment) || !attachmentsConfigured} onClick={() => fileInput.current?.click()}><Paperclip className="size-3.5" />添加 PDF</Button>
            <p className="text-[11px] text-muted-foreground">{attachmentsConfigured ? "每次一份 · 最大 50 MB" : "附件存储尚未配置"}</p>
          </div>
        </div>
      </div>
    </section>
  );
}

function ProposalControls({
  status,
  disabled,
  onConfirm,
  onCancel,
}: {
  status: ChatMessageView["proposalStatus"];
  disabled: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  if (status === "PENDING") {
    return (
      <div className="mt-2 flex gap-2">
        <Button type="button" size="sm" onClick={onConfirm} disabled={disabled}>
          <Check /> 确认保存
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onCancel} disabled={disabled}>
          <X /> 取消
        </Button>
      </div>
    );
  }
  return (
    <p className="text-muted-foreground mt-2 flex items-center gap-1.5 text-xs">
      {status === "CONFIRMED" ? <Check className="size-3.5" /> : <X className="size-3.5" />}
      {status === "CONFIRMED"
        ? "已保存"
        : status === "APPLYING"
          ? "正在保存"
          : "已取消"}
    </p>
  );
}
