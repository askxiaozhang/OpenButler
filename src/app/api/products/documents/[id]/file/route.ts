import { getCurrentUser } from "@/lib/auth/guard";
import { db } from "@/lib/db";
import { productStorage } from "@/lib/products/storage";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "请先登录" }, { status: 401 });
  const { id } = await context.params;
  const doc = await db().productDocument.findFirst({ where: { id, ready: true, OR: [{ productId: { not: null } }, { uploadedBy: user.id }] }, select: { storagePath: true, originalName: true } });
  if (!doc) return Response.json({ error: "资料不存在或尚未上传完成" }, { status: 404 });
  try {
    const download = new URL(request.url).searchParams.get("download") === "1";
    const { data, error } = await productStorage().createSignedUrl(doc.storagePath, 3600, download ? { download: doc.originalName } : undefined);
    if (error || !data) throw error;
    const headers = { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" };
    if (new URL(request.url).searchParams.get("format") === "json") return Response.json({ url: data.signedUrl }, { headers });
    return new Response(null, { status: 302, headers: { ...headers, Location: data.signedUrl } });
  } catch { return Response.json({ error: "暂时无法打开资料，请稍后重试" }, { status: 502 }); }
}
