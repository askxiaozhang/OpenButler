import { after } from "next/server";
import { createQqChallenge, verifyQqSignature } from "@/lib/qq/signature";
import { normalizeQqEvent, processQqMessage } from "@/lib/qq/official";

export const runtime = "nodejs";
export const maxDuration = 30;

const MAX_BODY_BYTES = 256 * 1024;

export async function POST(request: Request): Promise<Response> {
  const secret = process.env.QQ_BOT_APP_SECRET?.trim();
  if (!secret) return Response.json({ error: "QQ bot is not configured" }, { status: 503 });

  const declaredLength = Number(request.headers.get("content-length") ?? 0);
  if (declaredLength > MAX_BODY_BYTES) return new Response("Payload too large", { status: 413 });
  const body = Buffer.from(await request.arrayBuffer());
  if (body.length > MAX_BODY_BYTES) return new Response("Payload too large", { status: 413 });

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(body.toString("utf8")) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (payload.op === 13) {
    const data = payload.d as { plain_token?: unknown; event_ts?: unknown } | undefined;
    if (typeof data?.plain_token !== "string" || typeof data.event_ts !== "string") {
      return Response.json({ error: "Invalid challenge" }, { status: 400 });
    }
    return Response.json(createQqChallenge(secret, data.plain_token, data.event_ts));
  }

  if (
    !verifyQqSignature({
      secret,
      timestamp: request.headers.get("x-signature-timestamp") ?? "",
      signature: request.headers.get("x-signature-ed25519") ?? "",
      body,
    })
  ) {
    return Response.json({ error: "Invalid signature" }, { status: 401 });
  }

  const message = normalizeQqEvent(payload);
  if (message) {
    after(async () => {
      try {
        await processQqMessage(message);
      } catch (error) {
        // 不记录消息正文、凭证和平台响应正文。
        console.error("[qq.webhook]", {
          errorType: error instanceof Error ? error.name : "UnknownError",
          messageId: message.messageId,
        });
      }
    });
  }

  // QQ 的事件确认应立即返回，模型解析和回复在 after() 中完成。
  return Response.json({ op: 12, d: 0 });
}
