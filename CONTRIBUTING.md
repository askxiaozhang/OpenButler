# 贡献指南

1. Fork 后使用自己的测试数据库和 `.env.local`，从 `.env.example` 配置。
2. 不附带真实用户、家庭资料、QQ群身份、上传文件或生产资源标识；示例使用虚构数据。
3. 修改后执行 `pnpm test`、`pnpm lint`、`pnpm typecheck`、`pnpm build`、`pnpm check:release`。
4. 数据结构修改需增加 Prisma 迁移。新表继续开启 RLS，避免匿名 / Supabase authenticated 角色绕过应用登录。
5. 日历与时间逻辑统一使用 `src/lib/time.ts`；AI 只生成提案，经确认入口保存。
6. PR 描述说明行为变化和验证结果。不要提交本地 `.env`、数据库导出、日志、截图或测试账号密码。

提交代码即表示同意按本项目 MIT License 发布所贡献的代码。
