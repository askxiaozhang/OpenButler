/**
 * 改某个账号的密码（命令行用）。
 *
 * 场景：部署到公网前把 seed 的默认口令换掉 —— 而这时还没有登录界面能用
 * （或者不想为了改密码先登录一次）。
 *
 * 用法：
 *   npx tsx scripts/set-password.mts <用户名> <新密码>
 *   npx tsx scripts/set-password.mts <用户名> --generate
 */
import { config } from "dotenv";
config({ path: [".env.local", ".env"], quiet: true });

import { randomInt } from "node:crypto";
import { hashPassword } from "../src/lib/auth/password";
import { createPrismaClient } from "../src/lib/prisma-client";

/**
 * 排除容易看错的字符（0/O、1/l/I）。
 * 密码要念给家人听或者手输到手机上的，可读性比熵值重要一点。
 */
const ALPHABET = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function generatePassword(length = 16): string {
  let out = "";
  for (let i = 0; i < length; i += 1) {
    out += ALPHABET[randomInt(ALPHABET.length)];
  }
  return out;
}

const [username, ...rest] = process.argv.slice(2);
if (!username) {
  console.error("用法：npx tsx scripts/set-password.mts <用户名> [新密码|--generate]");
  process.exit(1);
}

const password = rest[0] === "--generate" || rest.length === 0 ? generatePassword() : rest[0];

if (password.length < 8) {
  console.error("密码至少 8 位");
  process.exit(1);
}

const prisma = createPrismaClient();

const user = await prisma.user.findUnique({ where: { username } });
if (!user) {
  console.error(`没有这个账号：${username}`);
  process.exit(1);
}

await prisma.user.update({
  where: { id: user.id },
  data: { passwordHash: await hashPassword(password) },
});

await prisma.$disconnect();

console.log(`账号 ${username} 的密码已更新。`);
console.log("");
console.log(`  新密码：${password}`);
console.log("");
console.log("建议存进密码管理器。登录后也可以在「我的 → 修改密码」里再换。");