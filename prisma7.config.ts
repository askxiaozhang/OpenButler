// Prisma 7 把 datasource url 从 schema.prisma 挪到了这里。
// 注意文件名带 `7` —— 这是 Prisma 自己生成的名字，不是笔误。
//
// 为什么手动 load 环境变量而不是 `import "dotenv/config"`：
// Next.js 的优先级是 .env.local > .env，而 `vercel env pull` 写的是 .env.local。
// 只 import dotenv/config 会读 .env，拿不到从 Vercel 拉下来的真实连接串。
import { config } from "dotenv";

config({ path: [".env.local", ".env"], quiet: true });

import { defineConfig } from "prisma/config";
import { cliDatabaseUrl } from "./src/lib/db-url";

/**
 * 解析迁移用的连接串。
 *
 * 找不到时返回 undefined 而不是抛错 —— `prisma generate` 根本不需要连接串，
 * 却会因为这里抛错而失败，进而让整个构建挂掉。构建环境缺一个数据库变量
 * 不该导致「代码编译不过」。
 *
 * 真正需要连库的命令（migrate / db push / studio）拿不到 URL 时，
 * Prisma 自己会报一个清楚的错，不需要我们提前抛。
 */
function safeCliUrl(): string | undefined {
  try {
    return cliDatabaseUrl();
  } catch {
    return undefined;
  }
}

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    // 迁移走会话模式，不走事务模式 —— Supavisor 的事务模式不支持迁移所需的
    // 会话级操作。
    url: safeCliUrl(),
  },
});