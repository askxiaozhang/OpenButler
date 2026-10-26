import { cookies } from "next/headers";
import {
  SESSION_COOKIE_NAME,
  SESSION_MAX_AGE_SECONDS,
  decodeSession,
  encodeSession,
} from "./session-token";

/**
 * 会话 cookie 的读写。真正的签/验逻辑在 `session-token.ts`（纯函数、可测），
 * 这里只负责和 Next.js 的 cookies() 打交道。
 *
 * 为什么用签名 cookie 而不是数据库 session 表：一个家庭 2-5 个用户，
 * 会话不需要服务端撤销能力，也不需要考虑登录设备管理。签名 cookie 省掉
 * 一张表和每次请求的一次查询，且在 Vercel 的多实例间天然共享。
 */

export { SESSION_COOKIE_NAME } from "./session-token";

export async function createSession(userId: string): Promise<void> {
  const store = await cookies();
  store.set(SESSION_COOKIE_NAME, encodeSession(userId), {
    httpOnly: true, // 禁止 JS 读取，防 XSS 窃取
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax", // 兼顾 CSRF 防护与「从外部链接跳回来仍保持登录」
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS,
  });
}

export async function destroySession(): Promise<void> {
  const store = await cookies();
  store.delete(SESSION_COOKIE_NAME);
}

/**
 * 读当前会话的 userId。只验签，**不查库** —— 查库交给 guard.ts 的 requireUser()。
 *
 * 这个分工是刻意的：proxy.ts（原 middleware）在每个请求上都会跑、且可能部署到
 * CDN 节点，不适合连数据库。廉价的「cookie 存不存在」判断放在那里，
 * 真正的身份校验放在布局组件里。
 */
export async function getSessionUserId(): Promise<string | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE_NAME)?.value;
  if (!token) return null;
  return decodeSession(token)?.userId ?? null;
}