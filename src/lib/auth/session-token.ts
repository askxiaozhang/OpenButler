import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * 会话令牌的签发与验证 —— **纯函数，不 import `next/headers`**。
 *
 * 独立成模块的理由和 db-url.ts 一样：`next/headers` 只在请求上下文里可用，
 * 一旦被顶层 import，这个模块就没法在普通 Node 脚本（集成测试、CLI）里用。
 * 把纯逻辑摘出来，应用和脚本就能共用同一份实现 —— 否则测试里只能复制一遍
 * 签名算法，那份副本一旦和实现脱节，测试就变成了自说自话。
 */

export const SESSION_COOKIE_NAME = "fn_session";
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30; // 30 天

interface SessionPayload {
  userId: string;
  /** Unix 秒 */
  exp: number;
}

function secret(): string {
  const value = process.env.AUTH_SECRET;
  if (!value || value.length < 32) {
    throw new Error(
      "AUTH_SECRET 必须配置为至少 32 字符的随机密钥。生成一个：\n" +
        `  node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"\n` +
        "然后写进 .env.local（生产环境用 `vercel env add AUTH_SECRET`）。",
    );
  }
  return value;
}

function sign(body: string): string {
  return createHmac("sha256", secret()).update(body).digest("base64url");
}

/** 恒定时间比较，避免通过响应耗时逐字节爆破签名。 */
function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/**
 * 签发会话令牌。
 *
 * 载荷只放 userId 和过期时间 —— cookie 是签名而非加密的，客户端能读出内容，
 * 所以不放任何敏感信息。
 */
export function encodeSession(
  userId: string,
  ttlSeconds = SESSION_MAX_AGE_SECONDS,
): string {
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  const body = Buffer.from(JSON.stringify({ userId, exp })).toString("base64url");
  return `${body}.${sign(body)}`;
}

/** 验签 + 检查过期。失败一律返回 null，不区分「签名错」和「已过期」。 */
export function decodeSession(token: string): SessionPayload | null {
  const dot = token.lastIndexOf(".");
  if (dot <= 0) return null;

  const body = token.slice(0, dot);
  const signature = token.slice(dot + 1);
  if (!safeEqual(signature, sign(body))) return null;

  try {
    const payload = JSON.parse(
      Buffer.from(body, "base64url").toString("utf8"),
    ) as SessionPayload;

    if (typeof payload.userId !== "string" || typeof payload.exp !== "number") {
      return null;
    }
    if (payload.exp * 1000 < Date.now()) return null;

    return payload;
  } catch {
    return null;
  }
}
