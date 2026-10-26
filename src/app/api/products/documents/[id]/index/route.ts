import { getCurrentUser } from "@/lib/auth/guard";
import { db } from "@/lib/db";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "请先登录" }, { status: 401 });
  const { id } = await context.params;
  const doc = await db().productDocument.findFirst({ where: { id, ready: true, OR: [{ productId: { not: null } }, { uploadedBy: user.id }] }, select: { textPages: true } });
  if (!doc) return Response.json({ error: "资料不存在" }, { status: 404 });
  return Response.json(doc.textPages, { headers: { "Cache-Control": "private, no-store" } });
}
