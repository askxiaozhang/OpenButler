import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client";
import { pooledDatabaseUrl, sslConfig, stripSslParams } from "./db-url";

/**
 * 建一个 Prisma 客户端。
 *
 * 用相对路径 import（而不是 `@/` 别名），这样 `prisma/seed.ts` 和 `scripts/*.mts`
 * 在 tsx 下也能直接用 —— 那些脚本不走 Next 的路径解析。入口统一在这里，
 * 否则各处各自 new 一个，迟早会出现「应用连得上、脚本连不上」的错配。
 */
export function createPrismaClient(): PrismaClient {
  const url = pooledDatabaseUrl();
  const adapter = new PrismaPg({
    connectionString: stripSslParams(url),
    ssl: sslConfig(url),
  });
  return new PrismaClient({ adapter });
}