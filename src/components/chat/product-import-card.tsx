"use client";

import Link from "next/link";
import { useId, useState } from "react";
import { BookOpen, Check, FileText, RotateCw, X } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import type { ProductImportEdit, ProductImportProposal } from "@/lib/products/import-types";
import type { ProposalStatusValue } from "@/lib/chat/service";

export function ChatProductCard({ proposal, status, disabled, onConfirm, onCancel, onRetry }: {
  proposal: ProductImportProposal; status: ProposalStatusValue | null; disabled: boolean;
  onConfirm: (input: ProductImportEdit) => void; onCancel: () => void; onRetry: () => void;
}) {
  const id = useId();
  const [fields, setFields] = useState(proposal.product);
  const [reuse, setReuse] = useState(Boolean(proposal.suggestedProduct));
  const active = status === "PENDING";
  const locked = !active || disabled || reuse;
  const values = active ? fields : proposal.product;
  const update = (field: keyof typeof fields, value: string) => setFields((p) => ({ ...p, [field]: value }));
  return <section className="mt-3 w-full min-w-0 rounded-2xl border bg-card p-4" aria-label="说明书识别结果">
    <div className="mb-4 flex items-center gap-2 text-sm font-semibold text-primary"><BookOpen className="size-4" />{status === "CONFIRMED" ? "产品资料已入库" : "产品资料卡"}</div>
    {proposal.warning && <p className="mb-4 rounded-lg bg-secondary/70 px-3 py-2 text-xs leading-6 text-muted-foreground">{proposal.warning}</p>}
    {active && proposal.suggestedProduct && <label className="mb-4 flex cursor-pointer items-start gap-2 rounded-xl bg-secondary/60 p-3 text-xs leading-6"><input type="checkbox" checked={reuse} onChange={(e) => setReuse(e.target.checked)} disabled={disabled} className="mt-1 accent-primary" /><span>已找到同品牌、同型号产品「{proposal.suggestedProduct.name}」。归入该产品，保留已有信息；取消勾选则新建一份档案。</span></label>}
    <form onSubmit={(e) => { e.preventDefault(); onConfirm({ product: fields, targetProductId: reuse ? proposal.suggestedProduct?.id ?? null : null }); }} className="space-y-3">
      <div className="space-y-1.5"><Label htmlFor={`${id}-name`}>产品名称</Label><Input id={`${id}-name`} aria-label="识别的产品名称" value={values.name} onChange={(e) => update("name", e.target.value)} readOnly={locked} required maxLength={120} className="h-10" /></div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5"><Label htmlFor={`${id}-brand`}>品牌</Label><Input id={`${id}-brand`} aria-label="识别的品牌" value={values.brand} onChange={(e) => update("brand", e.target.value)} readOnly={locked} maxLength={80} placeholder="未识别，可补充" className="h-10" /></div>
        <div className="space-y-1.5"><Label htmlFor={`${id}-model`}>型号</Label><Input id={`${id}-model`} aria-label="识别的型号" value={values.model} onChange={(e) => update("model", e.target.value)} readOnly={locked} maxLength={100} placeholder="未识别，可补充" className="h-10" /></div>
      </div>
      <div className="space-y-1.5"><Label htmlFor={`${id}-category`}>分类</Label><Input id={`${id}-category`} aria-label="识别的分类" value={values.category} onChange={(e) => update("category", e.target.value)} readOnly={locked} maxLength={40} className="h-10" /></div>
      <div className="space-y-1.5"><Label htmlFor={`${id}-description`}>产品说明</Label><Textarea id={`${id}-description`} aria-label="识别的产品说明" value={values.description} onChange={(e) => update("description", e.target.value)} readOnly={locked} maxLength={4000} className="min-h-20 text-sm leading-6" /></div>
      {proposal.evidence.length > 0 && <details className="rounded-lg bg-muted/60 px-3 py-2"><summary className="cursor-pointer text-xs text-muted-foreground">查看说明书中的识别依据</summary><ul className="mt-2 space-y-2 text-xs leading-6">{proposal.evidence.map((e, i) => <li key={i}><a className="text-primary underline underline-offset-2" href={`/api/products/documents/${proposal.documentId}/file#page=${e.page}`} target="_blank" rel="noopener noreferrer">第 {e.page} 页</a> · {e.text}</li>)}</ul></details>}
      {active ? <div className="flex flex-wrap gap-2 pt-1"><Button type="submit" size="sm" className="h-9" disabled={disabled || !fields.name.trim()}><Check />{reuse ? "确认归入" : "确认入库"}</Button><Button type="button" size="sm" className="h-9" variant="outline" onClick={onRetry} disabled={disabled}><RotateCw />重新识别</Button><Button type="button" size="sm" className="h-9" variant="ghost" onClick={onCancel} disabled={disabled}><X />取消</Button></div>
        : proposal.savedProductId ? <Link href={`/products/${proposal.savedProductId}`} className={buttonVariants({ variant: "secondary", className: "mt-1 h-10 w-full" })}><BookOpen />查看产品与说明书</Link>
        : <p className="text-xs text-muted-foreground">{status === "APPLYING" ? "正在入库…" : "这张资料卡已取消"}</p>}
      <a href={`/api/products/documents/${proposal.documentId}/file`} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5 text-xs text-primary"><FileText className="size-3.5" />查看上传的 PDF</a>
    </form>
  </section>;
}
