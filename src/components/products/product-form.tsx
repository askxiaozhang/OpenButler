"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Pencil, LoaderCircle } from "lucide-react";
import { saveProduct } from "@/actions/products";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";

export type ProductFields = { id: string; name: string; brand: string; model: string; category: string; description: string };
export function ProductForm({ product }: { product?: ProductFields }) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  const [pending, start] = useTransition();
  const router = useRouter();
  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(event.currentTarget));
    setError("");
    start(async () => {
      try {
        const result = await saveProduct(product?.id ?? null, values);
        if (!result.ok) { setError(result.error); return; }
        setOpen(false);
        if (!product) router.push(`/products/${result.data.id}`);
        else router.refresh();
      } catch { setError("暂时无法保存，请重试"); }
    });
  }
  return <Dialog open={open} onOpenChange={(v) => { if (!pending) { setOpen(v); setError(""); } }}>
    <DialogTrigger render={<Button variant={product ? "outline" : "default"} />}>
      {product ? <Pencil /> : <Plus />}{product ? "编辑产品" : "添加产品"}
    </DialogTrigger>
    <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-lg">
      <DialogHeader><DialogTitle>{product ? "编辑产品" : "添加一个产品"}</DialogTitle><DialogDescription>把说明书和使用心得放在一起，家人也能随时查阅。</DialogDescription></DialogHeader>
      <form onSubmit={submit} className="space-y-4">
        <div className="space-y-2"><Label htmlFor="product-name">产品名称 *</Label><Input id="product-name" name="name" className="h-11" required maxLength={120} defaultValue={product?.name} placeholder="例如：客厅扫地机器人" /></div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-2"><Label htmlFor="product-brand">品牌</Label><Input id="product-brand" name="brand" className="h-11" maxLength={80} defaultValue={product?.brand} placeholder="例如：石头" /></div>
          <div className="space-y-2"><Label htmlFor="product-model">型号</Label><Input id="product-model" name="model" className="h-11" maxLength={100} defaultValue={product?.model} placeholder="例如：G20S" /></div>
        </div>
        <div className="space-y-2"><Label htmlFor="product-category">分类</Label><Input id="product-category" name="category" className="h-11" maxLength={40} defaultValue={product?.category} placeholder="家电、数码、厨房、工具…" /></div>
        <div className="space-y-2"><Label htmlFor="product-description">补充说明</Label><Textarea id="product-description" name="description" maxLength={4000} defaultValue={product?.description} placeholder="放在哪里、购买信息，或你希望记住的事情" /></div>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <Button type="submit" disabled={pending} className="h-11 w-full">{pending && <LoaderCircle className="animate-spin" />}{pending ? "正在保存…" : product ? "保存修改" : "添加并上传资料"}</Button>
      </form>
    </DialogContent>
  </Dialog>;
}
