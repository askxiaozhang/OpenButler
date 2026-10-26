import { handleChatMessage } from "@/lib/chat/service";
import { consumePairingCode, findQqUser, qqIdentityKey } from "./pairing";

export interface QqIncomingMessage {
  openId: string;
  groupId: string | null;
  messageId: string;
  text: string;
}

type QqEventPayload = {
  op?: number;
  t?: string;
  d?: {
    id?: string;
    content?: string;
    group_openid?: string;
    author?: { user_openid?: string; member_openid?: string };
  };
};

export function normalizeQqEvent(payload: QqEventPayload): QqIncomingMessage | null {
  if (payload.op !== 0) return null;
  const group = payload.t === "GROUP_AT_MESSAGE_CREATE";
  if (!group && payload.t !== "C2C_MESSAGE_CREATE") return null;
  const data = payload.d;
  const openId = group ? data?.author?.member_openid : data?.author?.user_openid;
  if (!data?.id || !openId) return null;
  return {
    openId,
    groupId: group ? (data.group_openid ?? null) : null,
    messageId: data.id,
    text: (data.content ?? "").replace(/^\s*<@!?[^>]+>\s*/, "").trim(),
  };
}

export async function processQqMessage(message: QqIncomingMessage): Promise<void> {
  const identity = { openId: message.openId, groupId: message.groupId };
  const bind = /^(?:\/bind|绑定)\s+(\d{6})\s*$/i.exec(message.text);
  if (bind) {
    const result = await consumePairingCode(bind[1], identity);
    await sendQqReply(
      message,
      result.ok
        ? `已连接到家庭管家账号「${result.displayName}」。现在可以直接告诉我家里的事了。`
        : result.error,
    );
    return;
  }

  if (/^\/(?:whoami|id)$/i.test(message.text)) {
    await sendQqReply(
      message,
      `QQ 身份：${message.openId}\n场景：${message.groupId ? `群聊 ${message.groupId}` : "私聊"}`,
    );
    return;
  }

  const user = await findQqUser(identity);
  if (!user) {
    await sendQqReply(
      message,
      "这个 QQ 还没有连接家庭账号。请先在家庭管家的“管家”页生成 6 位绑定码，再发送：/bind 123456",
    );
    return;
  }

  if (!message.text) {
    await sendQqReply(message, "请在 @我 后写上要告诉管家的内容。");
    return;
  }

  const result = await handleChatMessage({
    userId: user.id,
    channel: message.groupId ? "QQ_GROUP" : "QQ_PRIVATE",
    scope: `qq:${qqIdentityKey(identity)}`,
    text: message.text,
    sourceKey: `qq:${message.groupId ?? "private"}:${message.messageId}`,
  });
  if (!result.duplicate && result.reply) await sendQqReply(message, result.reply);
}

export class QqApiError extends Error {
  constructor(public readonly status: number, public readonly code: number | null) {
    super(`QQ message failed: ${status}, code ${code ?? "unknown"}`);
    this.name = "QqApiError";
  }
}

export async function sendQqReply(target: QqIncomingMessage, text: string): Promise<void> {
  return sendQqMessage(target, text);
}

/** 主动群消息不携带 msg_id/event_id，不能复用已经过期的用户消息。 */
export async function sendQqGroupMessage(groupId: string, text: string, options?: { markdown: boolean }): Promise<void> {
  if (!groupId) throw new Error("缺少 QQ 群标识");
  return sendQqMessage({ groupId, openId: "" }, text, options?.markdown);
}

async function sendQqMessage(
  target: { groupId: string | null; openId: string; messageId?: string },
  text: string,
  markdown = false,
): Promise<void> {
  const appId = process.env.QQ_BOT_APP_ID?.trim();
  const secret = process.env.QQ_BOT_APP_SECRET?.trim();
  if (!appId || !secret) throw new Error("QQ bot credentials are not configured");

  const tokenResponse = await fetch("https://bots.qq.com/app/getAppAccessToken", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ appId, clientSecret: secret }),
    signal: AbortSignal.timeout(10_000),
    cache: "no-store",
  });
  if (!tokenResponse.ok) throw new Error(`QQ token request failed: ${tokenResponse.status}`);
  const tokenData = (await tokenResponse.json()) as { access_token?: string };
  if (!tokenData.access_token) throw new Error("QQ token response has no access_token");

  const sandbox = process.env.QQ_BOT_SANDBOX?.trim().toLowerCase() === "true";
  const base = sandbox ? "https://sandbox.api.sgroup.qq.com" : "https://api.sgroup.qq.com";
  const kind = target.groupId ? "groups" : "users";
  const identifier = target.groupId ?? target.openId;
  const url = `${base}/v2/${kind}/${encodeURIComponent(identifier)}/messages`;

  const parts = splitMessage(text, 1800).slice(0, 4);
  for (let index = 0; index < parts.length; index += 1) {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `QQBot ${tokenData.access_token}`,
        "x-union-appid": appId,
      },
      body: JSON.stringify({
        // 群成员 @ 标签需要 Markdown 渲染；普通文本会把标签原样显示。
        ...(markdown
          ? { msg_type: 2, markdown: { content: parts[index] } }
          : { msg_type: 0, content: parts[index] }),
        msg_id: target.messageId,
        msg_seq: index + 1,
      }),
      signal: AbortSignal.timeout(10_000),
      cache: "no-store",
    });
    if (!response.ok) {
      let code: unknown;
      try {
        code = ((await response.json()) as { code?: unknown }).code;
      } catch {
        code = undefined;
      }
      console.error("[qq.send]", { status: response.status, code, target: kind });
      throw new QqApiError(response.status, typeof code === "number" ? code : null);
    }
  }
}

function splitMessage(text: string, maxLength: number): string[] {
  const parts: string[] = [];
  let rest = text.trim();
  while (rest.length > maxLength) {
    let end = rest.lastIndexOf("\n", maxLength);
    if (end < Math.floor(maxLength * 0.5)) end = maxLength;
    parts.push(rest.slice(0, end));
    rest = rest.slice(end).trimStart();
  }
  if (rest) parts.push(rest);
  return parts.length ? parts : ["收到。"];
}
