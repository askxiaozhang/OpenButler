import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { ProductForm } from "@/components/products/product-form";
import { ProductWorkspace } from "@/components/products/product-workspace";
import { requireUser } from "@/lib/auth/guard";
import { db } from "@/lib/db";
import { productStorageConfigured } from "@/lib/products/storage";
import { formatZhShort, todayFrom } from "@/lib/time";

export const metadata = { title: "产品手记 · Open家庭管家" };
export default async function ProductPage({ params, searchParams }: {
  params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser();
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const q = typeof query.q === "string" ? query.q.trim().slice(0, 120) : "";
  const product = await db().product.findUnique({ where: { id }, include: {
    documents: { where: { OR: [{ ready: true }, { uploadedBy: user.id }, ...(user.role === "ADMIN" ? [{}] : [])] }, orderBy: { createdAt: "asc" },
      select: { id: true, originalName: true, mimeType: true, size: true, ready: true, uploadedBy: true, pageCount: true, indexStatus: true } },
    notes: { where: q ? { content: { contains: q, mode: "insensitive" } } : {}, orderBy: { createdAt: "desc" }, take: 200,
      select: { id: true, content: true, documentId: true, pageNumber: true, authorId: true, createdAt: true, author: { select: { displayName: true } } } },
  } });
  if (!product) notFound();
  const matching = q ? await db().productDocument.findFirst({ where: { productId: id, ready: true, extractedText: { contains: q, mode: "insensitive" } }, select: { id: true } }) : null;
  const requestedDoc = typeof query.document === "string" ? query.document : null;
  const initialDocumentId = product.documents.find((d) => d.ready && d.id === requestedDoc)?.id ?? matching?.id ?? product.documents.find((d) => d.ready)?.id ?? null;
  const initialDoc = product.documents.find((d) => d.id === initialDocumentId);
  const page = Math.min(initialDoc?.pageCount ?? 1, Math.max(1, Math.floor(Number(query.page) || 1)));
  return <>
    <PageHeader title={product.name} subtitle={[product.brand, product.model, product.category].filter(Boolean).join(" · ") || "产品资料与使用手记"} action={<ProductForm product={product} />} />
    <div className="mx-auto max-w-6xl space-y-5 p-4 md:p-7">
      <Link href="/products" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-primary"><ArrowLeft className="size-4" />产品资料库</Link>
      {product.description && <p className="whitespace-pre-wrap break-words rounded-xl bg-secondary/60 px-4 py-3 text-sm leading-7">{product.description}</p>}
      {q && <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border px-4 py-3 text-sm"><p>正在查找“{q}”：下方显示匹配的笔记，正文可按页查找。</p><Link href={`/products/${id}`} className="font-medium text-primary">查看全部笔记</Link></div>}
      <ProductWorkspace key={`${id}-${q}`} productId={id} documents={product.documents} notes={product.notes.map((n) => ({ id: n.id, content: n.content, documentId: n.documentId, pageNumber: n.pageNumber, authorId: n.authorId, author: n.author?.displayName ?? "家人", date: formatZhShort(todayFrom(n.createdAt)) }))} configured={productStorageConfigured()} userId={user.id} admin={user.role === "ADMIN"} initialDocumentId={initialDocumentId} initialPage={page} query={q} />
    </div>
  </>;
}
