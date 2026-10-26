@AGENTS.md

# Family Note 开发约定

- Next.js 16 / React 19 / Prisma 7。改动前读取已安装依赖的对应文档。
- 日期计算统一走 `src/lib/time.ts`；Client Component 的“今天”由服务端传入。
- AI 只生成提案；生活记录、待办、产品建档必须经用户确认并调用共享保存逻辑。
- 数据库配置集中于 `src/lib/db-url.ts`，Prisma 实例由 `src/lib/prisma-client.ts` / `db.ts` 创建。
- 一套实例对应一个家庭；不要假设多租户隔离。认证、文件权限和私有存储边界不可绕过。
- 没有固定线上项目、数据库、机器人或域名；所有配置由部署者填写。
- 不读取 / 上传生产资料进行测试，不提交环境文件或日志。
- 提交前执行 README 中的测试与发布检查。
