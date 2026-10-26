import { PrismaClient } from "@/generated/prisma/client";
import { createPrismaClient } from "./prisma-client";

/**
 * 数据库连接。
 *
 * ## 为什么是惰性初始化
 *
 * `next build` 会 import 每一个模块来收集路由信息。如果在模块顶层就
 * `new PrismaClient()`，构建时会立刻去连库 —— 而构建环境里往往还没有
 * 注入连接串，于是整个构建因为一个无关的环境变量而失败。
 * 把初始化推迟到第一次真正查询时，构建就与数据库解耦了。
 *
 * ## 为什么不用 JS Proxy 包装
 *
 * `export const db = new Proxy(...)` 这种写法看着更优雅，但会破坏依赖库的
 * 属性探测（它们常用 `'findMany' in client` 或读 Symbol 来识别对象），
 * 表现为「没有任何报错，但请求永远挂起」。用普通函数最安全。
 *
 * ## 为什么用 pg adapter 而不是 Neon 专用的那个
 *
 * `@prisma/adapter-pg` 对任何 Postgres 都适用（Supabase、Neon、本地 Docker…），
 * 换供应商时不用改代码。代价是失去 Neon 的 WebSocket/HTTP 特化，
 * 但对本项目这种低频访问完全没有影响。
 */

const globalForPrisma = globalThis as unknown as {
  __familyNotePrisma?: PrismaClient;
};

/** 生产环境的单例。模块只执行一次，所以模块级变量就够了。 */
let moduleScopedClient: PrismaClient | undefined;

export function db(): PrismaClient {
  // 开发环境下 Next 的模块热替换会反复执行本模块，所以实例挂在 globalThis 上
  // 复用；生产环境模块只执行一次，模块级变量就够了。
  // 两条路径都必须保证「每个进程只有一个客户端」，否则每次 db() 调用都会新建
  // 一个连接池，很快把数据库的连接数吃满。
  const cached =
    process.env.NODE_ENV !== "production"
      ? globalForPrisma.__familyNotePrisma
      : moduleScopedClient;

  if (cached) return cached;

  const client = createPrismaClient();
  if (process.env.NODE_ENV !== "production") {
    globalForPrisma.__familyNotePrisma = client;
  } else {
    moduleScopedClient = client;
  }
  return client;
}