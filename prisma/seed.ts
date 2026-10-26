import { config } from "dotenv";
config({ path: [".env.local", ".env"], quiet: true });
import { readBootstrapAccount } from "../src/lib/bootstrap";
import { hashPassword } from "../src/lib/auth/password";
import { createPrismaClient } from "../src/lib/prisma-client";

async function main() {
  const account = readBootstrapAccount(process.env);
  const prisma = createPrismaClient();
  try {
    if (await prisma.user.count()) {
      console.log("已有账号，跳过初始化；不会覆盖密码、权限或家庭资料。");
      return;
    }
    await prisma.user.create({ data: { username: account.username, displayName: account.displayName, passwordHash: await hashPassword(account.password), role: "ADMIN" } });
    console.log("初始管理员已创建。使用自行配置的账号和密码登录；未写入任何示例家庭资料。");
  } finally { await prisma.$disconnect(); }
}
main().catch(() => { console.error("初始化失败。请检查自己的数据库连接及 SEED_* 配置；密码至少 12 位。"); process.exitCode = 1; });
