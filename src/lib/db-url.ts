/**
 * 数据库连接串解析与 TLS 配置。
 *
 * 单独成模块（不 import 任何 Next.js 的东西）是因为 `prisma/seed.ts` 在 tsx 下
 * 运行，也要用同一套逻辑 —— 变量名或 TLS 配置认错了会出现「应用能跑、seed 连不上」
 * 这种很难查的不一致。
 *
 * ## 为什么是一长串 ?? 而不是一个变量名
 *
 * 数据库由 Vercel Marketplace 集成供应，注入的变量名随供应商和集成版本变化
 * （Neon 注入 DATABASE_URL*，Supabase 注入 POSTGRES_*）。写死一个名字的话，
 * 换个供应商就要改代码。这里按优先级兜底，任何一家注入进来都能直接用。
 *
 * ⚠️ 实际注入的变量名以 `vercel env ls` 的输出为准，别照抄注释。
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** 运行时用：走连接池，适合 Serverless 的高并发短连接。 */
export function pooledDatabaseUrl(): string {
  const url =
    // Supabase 集成注入的池化串（Supavisor，端口 6543）
    process.env.POSTGRES_PRISMA_URL?.trim() ||
    process.env.POSTGRES_URL?.trim() ||
    // Neon 集成注入的名字
    process.env.DATABASE_URL?.trim() ||
    // 本地开发兜底
    process.env.LOCAL_DATABASE_URL?.trim();

  if (!url) throw new Error(missingUrlMessage());
  return url;
}

/**
 * 迁移用：必须走会话模式。
 *
 * Supavisor 的**事务模式**（6543）不支持迁移所需的会话级操作，用它跑 migrate
 * 会失败。Supabase 的 session pooler（5432）可以。
 *
 * 注意不要用 Direct connection（`db.<ref>.supabase.co:5432`）—— Supabase
 * 新项目的直连只有 AAAA 记录（IPv6 only），Vercel 函数没有 IPv6 出口，连不上。
 */
export function directDatabaseUrl(): string {
  const url =
    process.env.POSTGRES_URL_NON_POOLING?.trim() ||
    process.env.DATABASE_URL_UNPOOLED?.trim() ||
    process.env.POSTGRES_URL?.trim() ||
    process.env.DATABASE_URL?.trim() ||
    process.env.LOCAL_DATABASE_URL?.trim();

  if (!url) throw new Error(missingUrlMessage());
  return url;
}

function missingUrlMessage(): string {
  return [
    "缺少数据库连接串。",
    "本地开发：运行 `vercel env pull .env.local` 从 Vercel 拉取。",
    "或在 .env.local 里手动设置 LOCAL_DATABASE_URL。",
  ].join("\n");
}

// ---------------------------------------------------------------- TLS

export function isLocalDatabase(url: string): boolean {
  return /@(localhost|127\.0\.0\.1|\[::1\])[:/]/.test(url);
}

/** 可以放进项目根目录的 CA 证书文件名（Supabase 的叫这个名字）。 */
const CA_CERT_FILENAME = "prod-ca-2021.crt";

/** 远程连接默认验证 TLS；自签 CA 通过 PG_CA_CERT 或本地证书文件配置。 */
export function sslConfig(url: string): false | { rejectUnauthorized: boolean; ca?: string } {
  if (isLocalDatabase(url)) return false;

  const ca = process.env.PG_CA_CERT?.trim() || readCaCertIfPresent();
  if (ca) return { rejectUnauthorized: true, ca };

  if (process.env.PG_TLS_REJECT_UNAUTHORIZED === "false") {
    warnOnceAboutUnverifiedTls();
    return { rejectUnauthorized: false };
  }
  return { rejectUnauthorized: true };
}

function readCaCertIfPresent(): string | undefined {
  try {
    const file = join(process.cwd(), CA_CERT_FILENAME);
    if (existsSync(file)) return readFileSync(file, "utf8");
  } catch {
    // 拿不到就当没有，走第 3 档
  }
  return undefined;
}

let warned = false;

function warnOnceAboutUnverifiedTls() {
  if (warned) return;
  warned = true;
  console.warn(
    [
      "",
      "⚠️  数据库连接已加密，但未验证服务器证书。",
      "    链路可被中间人截获。要消除此风险：",
      "      Supabase 面板 → Project Settings → Database → SSL Configuration",
      `      下载 CA 证书，保存为项目根目录的 ${CA_CERT_FILENAME}`,
      "    放好后无需改代码，重启即可自动启用完整验证。",
      "",
    ].join("\n"),
  );
}

/**
 * 给 Prisma CLI（migrate / db push / studio）用的连接串。
 *
 * CLI 是 Rust 实现的，TLS 行为跟 libpq 一致 —— `sslmode=require` 能正常握手，
 * 不会像 node-postgres 那样因为 Supabase 的自签 CA 失败。所以这里直接补
 * `sslmode=require` 就行，不用走上面那套 sslConfig。
 */
export function cliDatabaseUrl(): string {
  const url = directDatabaseUrl();
  if (isLocalDatabase(url)) return url;
  if (/[?&]sslmode=/.test(url)) return url;
  return `${url}${url.includes("?") ? "&" : "?"}sslmode=require`;
}

/**
 * 去掉连接串里的 ssl 相关参数。
 *
 * 我们通过 pg 的 `ssl` 选项显式控制 TLS，若连接串里同时带 sslmode，
 * 两者会打架（pg 解析连接串的结果可能覆盖显式选项），行为变得难以预测。
 * 统一由 sslConfig() 说了算。
 */
export function stripSslParams(url: string): string {
  const [base, query] = url.split("?");
  if (!query) return url;
  const kept = query
    .split("&")
    .filter((p) => p && !/^(sslmode|sslrootcert|sslcert|sslkey|uselibpqcompat)=/.test(p));
  return kept.length ? `${base}?${kept.join("&")}` : base;
}