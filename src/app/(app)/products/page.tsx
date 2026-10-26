import Link from "next/link";
import { BookOpen, Search, ArrowUpRight, FileText, NotebookPen, PackageOpen, X } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { ProductForm } from "@/components/products/product-form";
import { requireUser } from "@/lib/auth/guard";
import { db } from "@/lib/db";
import type { Prisma } from "@/generated/prisma/client";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export const metadata = { title: "产品资料库 · Open家庭管家" };
const PAGE_SIZE = 24;
export default async function ProductsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireUser();
  const params = await searchParams;
  const q = typeof params.q === "string" ? params.q.trim().slice(0, 120) : "";
  const category = typeof params.category === "string" ? params.category.slice(0, 40) : "";
  const page = Math.max(1, Math.min(10000, Number(params.page) || 1));
  const text = { contains: q, mode: "insensitive" as const };
  const where: Prisma.ProductWhereInput = {
    ...(category ? { category } : {}),
    ...(q ? { OR: [ { name: text }, { brand: text }, { model: text }, { category: text }, { description: text },
      { notes: { some: { content: text } } },
      { documents: { some: { ready: true, OR: [{ originalName: text }, { extractedText: text }] } } },
    ] } : {}),
  };
  const [products, total, categories] = await Promise.all([
    db().product.findMany({ where, orderBy: [{ updatedAt: "desc" }, { id: "asc" }], skip: (Math.floor(page) - 1) * PAGE_SIZE, take: PAGE_SIZE,
      select: { id: true, name: true, brand: true, model: true, category: true, description: true,
        _count: { select: { documents: { where: { ready: true } }, notes: true } } } }),
    db().product.count({ where }),
    db().product.findMany({ where: { category: { not: "" } }, distinct: ["category"], select: { category: true }, orderBy: { category: "asc" } }),
  ]);
  const href = (next: { category?: string; page?: number }) => `/products?${new URLSearchParams({ ...(q ? { q } : {}), ...(next.category ?? category ? { category: next.category ?? category } : {}), ...(next.page ? { page: String(next.page) } : {}) })}`;
  return <>
    <PageHeader title="产品资料库" subtitle="说明书、使用心得，想用的时候找得到。" action={<ProductForm />} />
    <div className="mx-auto max-w-6xl space-y-6 p-4 md:p-7">
      <section className="flex items-center gap-4 rounded-2xl bg-secondary/70 px-5 py-5">
        <BookOpen className="hidden size-9 shrink-0 text-primary sm:block" strokeWidth={1.4} />
        <div><h2 className="text-base font-medium">给家里的每件东西，留一本使用手记。</h2><p className="mt-1.5 text-sm leading-6 text-muted-foreground">上传说明书，记下好用的设置和踩过的坑。下次遇到问题，搜一下就能想起来。</p></div>
      </section>
      <form action="/products" role="search" className="flex gap-2">
        {category && <input type="hidden" name="category" value={category} />}
        <div className="relative flex-1"><Search aria-hidden className="absolute left-3.5 top-3.5 size-4 text-muted-foreground" /><input aria-label="搜索产品、说明书正文和笔记" name="q" type="search" defaultValue={q} maxLength={120} placeholder="搜产品、型号、说明书正文或笔记…" className="h-11 w-full rounded-xl border bg-card pl-10 pr-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring" /></div>
        <button type="submit" className={buttonVariants({ className: "h-11" })}>查找</button>
      </form>
      {categories.length > 0 && <nav aria-label="产品分类" className="flex flex-wrap gap-2">
        <Link href={href({ category: "" })} aria-current={!category ? "page" : undefined} className={cn("rounded-lg px-3 py-2 text-sm", !category ? "bg-primary text-primary-foreground" : "bg-secondary text-muted-foreground")}>全部</Link>
        {categories.map((c) => <Link key={c.category} href={href({ category: c.category })} aria-current={category === c.category ? "page" : undefined} className={cn("rounded-lg px-3 py-2 text-sm", category === c.category ? "bg-primary text-primary-foreground" : "bg-secondary text-muted-foreground")}>{c.category}</Link>)}
      </nav>}
      <div className="flex items-center justify-between text-sm text-muted-foreground"><p>{q ? `“${q}” 的搜索结果` : "家里的产品"} · {total} 件</p>{(q || category) && <Link href="/products" className="flex items-center gap-1 text-primary"><X className="size-3.5" />清除筛选</Link>}</div>
      {products.length ? <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {products.map((p) => <Link key={p.id} href={`/products/${p.id}${q ? `?q=${encodeURIComponent(q)}` : ""}`} className="group flex min-h-52 flex-col rounded-2xl border bg-card p-5 transition-colors hover:border-primary/45 focus-visible:outline-2 focus-visible:outline-primary">
          <div className="mb-4 flex items-center justify-between"><span className="flex size-10 items-center justify-center rounded-xl bg-secondary"><BookOpen className="size-5 text-primary" strokeWidth={1.5} /></span><ArrowUpRight className="size-4 text-muted-foreground group-hover:text-primary" /></div>
          <h2 className="break-words text-lg font-semibold">{p.name}</h2><p className="mt-1 text-sm text-muted-foreground">{[p.brand, p.model].filter(Boolean).join(" · ") || "尚未填写品牌和型号"}</p>
          {p.description && <p className="mt-3 line-clamp-2 text-sm leading-6 text-muted-foreground">{p.description}</p>}
          <div className="mt-auto flex flex-wrap items-center gap-x-4 gap-y-2 pt-5 text-xs text-muted-foreground"><span className="flex items-center gap-1.5"><FileText className="size-3.5" />{p._count.documents} 份资料</span><span className="flex items-center gap-1.5"><NotebookPen className="size-3.5" />{p._count.notes} 条笔记</span>{p.category && <span className="ml-auto rounded-md bg-muted px-2 py-1">{p.category}</span>}</div>
        </Link>)}
      </div> : <section className="rounded-2xl border border-dashed px-5 py-14 text-center"><PackageOpen className="mx-auto mb-4 size-10 text-muted-foreground" strokeWidth={1.3} /><h2 className="font-medium">{q || category ? "没有找到相关产品" : "从第一份说明书开始"}</h2><p className="mx-auto mb-5 mt-2 max-w-sm text-sm leading-6 text-muted-foreground">{q || category ? "换个关键词试试，或清除分类筛选。" : "添加一个产品，再上传 PDF 或图片。以后不记得怎么用，就回来看看。"}</p>{!q && !category && <ProductForm />}</section>}
      {total > PAGE_SIZE && <nav aria-label="资料库分页" className="flex items-center justify-center gap-4">{page > 1 && <Link className={buttonVariants({ variant: "outline" })} href={href({ page: page - 1 })}>上一页</Link>}<span className="text-sm text-muted-foreground">第 {Math.floor(page)} / {Math.ceil(total / PAGE_SIZE)} 页</span>{page * PAGE_SIZE < total && <Link className={buttonVariants({ variant: "outline" })} href={href({ page: page + 1 })}>下一页</Link>}</nav>}
    </div>
  </>;
}
