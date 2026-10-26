import { randomUUID } from "node:crypto";
import { z } from "zod";
import { handleChatMessage } from "@/lib/chat/service";
import { authenticateShortcutToken, readBearerToken } from "@/lib/shortcut/credential";

export const runtime = "nodejs";
export const maxDuration = 30;

const MAX_BODY_BYTES = 8 * 1024;

const bodySchema = z.object({
  text: z.string().trim().min(1).max(500),
  requestId: z.string().min(8).max(80).regex(/^[A-Za-z0-9-]+$/).optional(),
});

export async function POST(request: Request): Promise<Response> {
  const token = readBearerToken(request.headers.get("authorization"));
  if (!token) return jsonError("快捷指令密钥无效", 401);

  const user = await authenticateShortcutToken(token);
  if (!user) return jsonError("快捷指令密钥已失效，请在网页重新生成", 401);

  const declaredLength = Number(request.headers.get("content-length") ?? 0);
  if (declaredLength > MAX_BODY_BYTES) return jsonError("请求内容太长", 413);

  let rawBody: unknown;
  try {
    const body = await request.arrayBuffer();
    if (body.byteLength > MAX_BODY_BYTES) return jsonError("请求内容太长", 413);
    rawBody = JSON.parse(new TextDecoder().decode(body));
  } catch {
    return jsonError("请求内容不是有效的 JSON", 400);
  }
  const parsed = bodySchema.safeParse(rawBody);
  if (!parsed.success) return jsonError("请说一句 500 字以内的话", 400);

  try {
    const requestId = parsed.data.requestId ?? randomUUID();
    const result = await handleChatMessage({
      userId: user.id,
      channel: "SHORTCUT",
      scope: `shortcut:${user.id}`,
      text: parsed.data.text,
      sourceKey: `shortcut:${user.id}:${requestId}`,
    });
    return json(
      {
        ok: true,
        reply: result.duplicate ? "这句话已经处理过了。" : result.reply,
      },
      200,
    );
  } catch (error) {
    console.error("[shortcut.chat]", {
      errorType: error instanceof Error ? error.name : "UnknownError",
      userId: user.id,
    });
    return jsonError("管家暂时没有回应，请稍后再试", 503);
  }
}

function jsonError(error: string, status: number): Response {
  return json({ ok: false, error }, status);
}

function json(body: Record<string, unknown>, status: number): Response {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}
