/**
 * HTTP 层的鉴权链路验证（需要 dev server 在跑）。
 *
 * 覆盖 proxy.ts → requireUser() 这一整条路径：cookie 存在性检查、验签、
 * 过期判断、查库确认用户存在。这些用单测覆盖不到，因为它们横跨了
 * 边缘层的 proxy 和请求层的 React Server Component。
 *
 * 运行：pnpm dev &  然后  npx tsx scripts/verify-http.mts
 */
import { config } from "dotenv";
config({ path: [".env.local", ".env"], quiet: true });

import { createPrismaClient } from "../src/lib/prisma-client";
import { encodeSession, SESSION_COOKIE_NAME } from "../src/lib/auth/session-token";

const BASE = process.env.VERIFY_BASE_URL ?? "http://localhost:3000";

const prisma = createPrismaClient();

let failures = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const ok = actual === expected;
  if (!ok) failures += 1;
  console.log(`${ok ? "✓" : "✗"} ${label}: ${actual}${ok ? "" : ` (期望 ${expected})`}`);
}

/** 带指定 cookie 请求，返回状态码、Location 和响应体。 */
async function get(path: string, cookie?: string) {
  const res = await fetch(`${BASE}${path}`, {
    redirect: "manual",
    headers: cookie ? { cookie } : {},
  });
  return {
    status: res.status,
    location: res.headers.get("location") ?? "",
    body: res.status === 200 ? await res.text() : "",
  };
}

const admin = await prisma.user.findUnique({ where: { username: "admin" } });
if (!admin) throw new Error("seed 用户不存在，先跑 pnpm db:seed");

const cookieName = SESSION_COOKIE_NAME;

// 1. 无 cookie：应被 proxy 拦下
{
  const r = await get("/");
  check("无 cookie 访问 / 的状态码", r.status, 307);
  check("  重定向到 /login", new URL(r.location, BASE).pathname, "/login");
}

// 2. 无 cookie 访问深层路径：应带上 next 参数
{
  const r = await get("/tasks");
  const loc = new URL(r.location, BASE);
  check("无 cookie 访问 /tasks 的重定向路径", loc.pathname, "/login");
  check("  带 next 参数", loc.searchParams.get("next"), "/tasks");
}

// 3. 合法 cookie：应放行并渲染首页
{
  const r = await get("/", `${cookieName}=${encodeSession(admin.id)}`);
  check("合法 cookie 访问 / 的状态码", r.status, 200);
  check("  渲染出首页内容", r.body.includes("成员") || r.body.includes("家庭"), true);
  check("  渲染出了角色名", r.body.includes("猫咪"), true);
}

// 4. 合法 cookie 访问其他页面
{
  const r = await get("/tasks", `${cookieName}=${encodeSession(admin.id)}`);
  check("合法 cookie 访问 /tasks 的状态码", r.status, 200);
}

// 5. 签名被篡改：应被拒
{
  const token = encodeSession(admin.id);
  const tampered = `${token.slice(0, -3)}AAA`;
  const r = await get("/", `${cookieName}=${tampered}`);
  check("篡改签名后的状态码", r.status, 307);
}

// 6. 载荷被篡改（换成另一个 userId 但保留原签名）：应被拒
{
  const token = encodeSession(admin.id);
  const forgedBody = Buffer.from(
    JSON.stringify({ userId: "someone-else", exp: Math.floor(Date.now() / 1000) + 9999 }),
  ).toString("base64url");
  const forged = `${forgedBody}.${token.slice(token.lastIndexOf(".") + 1)}`;
  const r = await get("/", `${cookieName}=${forged}`);
  check("伪造载荷但沿用旧签名的状态码", r.status, 307);
}

// 7. 已过期：应被拒
{
  const expired = encodeSession(admin.id, -10);
  const r = await get("/", `${cookieName}=${expired}`);
  check("过期 cookie 的状态码", r.status, 307);
}

// 8. 签名合法但用户已被删除：应由 requireUser 拦下（proxy 这一层会放行）
{
  const ghost = encodeSession("nonexistent-user-id");
  const r = await get("/", `${cookieName}=${ghost}`);
  check("用户不存在的状态码", r.status, 307);
}

// 9. 垃圾 cookie 值：不应 500
{
  const r = await get("/", `${cookieName}=garbage`);
  check("垃圾 cookie 的状态码", r.status, 307);
}

// 10. 登录页在未登录时应可访问（不能被 proxy 自己拦住造成死循环）
{
  const r = await get("/login");
  check("未登录可访问 /login", r.status, 200);
  check("  含登录表单", r.body.includes("用户名") && r.body.includes("密码"), true);
}

await prisma.$disconnect();

if (failures > 0) {
  console.error(`\n${failures} 项失败`);
  process.exit(1);
}
console.log("\n全部通过");