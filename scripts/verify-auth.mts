/**
 * 鉴权链路的实库验证脚本（需要数据库在跑）。
 *
 * 单测覆盖不到的部分：真实 scrypt 哈希的校验、等时性、脏数据容错。
 * 运行：npx tsx scripts/verify-auth.mts
 */
import { config } from "dotenv";
config({ path: [".env.local", ".env"], quiet: true });

import { createPrismaClient } from "../src/lib/prisma-client";
import { hashPassword, verifyPassword } from "../src/lib/auth/password";

const prisma = createPrismaClient();

// 密码从环境变量读 —— 生产上线前会把 seed 的默认口令换掉，
// 写死的值在那之后会让这里全部失败（看起来像鉴权坏了，其实只是密码变了）
const USERNAME = process.env.VERIFY_USERNAME ?? "admin";
const PASSWORD = process.env.VERIFY_PASSWORD ?? "";
if (!PASSWORD) throw new Error("Set VERIFY_PASSWORD for your independent test account");

let failures = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const ok = actual === expected;
  if (!ok) failures += 1;
  console.log(`${ok ? "✓" : "✗"} ${label}: ${actual}${ok ? "" : ` (期望 ${expected})`}`);
}

const user = await prisma.user.findUnique({ where: { username: USERNAME } });
if (!user) throw new Error("seed 用户不存在，先跑 pnpm db:seed");

check("正确密码", await verifyPassword(PASSWORD, user.passwordHash), true);
check("错误密码", await verifyPassword("wrongpass", user.passwordHash), false);
check("空密码", await verifyPassword("", user.passwordHash), false);

// 往返：新哈希能被自己验证，且中文/emoji 不因编码而失败
const fresh = await hashPassword("测试密码🔒");
check("新哈希自验证", await verifyPassword("测试密码🔒", fresh), true);
check("新哈希错密码", await verifyPassword("测试密码", fresh), false);

// Unicode 规范化：不同输入法产出的组合字符应视为同一密码
check(
  "NFKC 归一化",
  await verifyPassword("café", await hashPassword("café")),
  true,
);

// 脏数据不应该抛错（数据库里出现坏行不该让登录接口 500）
check("脏哈希", await verifyPassword("x", "garbage"), false);
check("空哈希", await verifyPassword("x", ""), false);
check("截断哈希", await verifyPassword("x", "scrypt$16384$8$1$AAA"), false);

// salt 必须随机
check("盐随机", (await hashPassword("same")) !== (await hashPassword("same")), true);

// 等时性：用户不存在的分支不应显著更快（防用户名枚举）
const DUMMY =
  "scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";

// 先跑两次热身 —— scrypt 首次调用有 JIT 与内存分配的开销，
// 不热身的话第一次测量会明显偏慢，比值失真（这条断言之前就是这么假失败的）
await verifyPassword(PASSWORD, user.passwordHash);
await verifyPassword(PASSWORD, DUMMY);

const t0 = performance.now();
await verifyPassword(PASSWORD, user.passwordHash);
const t1 = performance.now();
await verifyPassword(PASSWORD, DUMMY);
const t2 = performance.now();
const realMs = t1 - t0;
const dummyMs = t2 - t1;
const ratio = Math.max(realMs, dummyMs) / Math.min(realMs, dummyMs);
check(
  `等时性 (真实=${realMs.toFixed(0)}ms 假=${dummyMs.toFixed(0)}ms 比值=${ratio.toFixed(2)})`,
  ratio < 1.5,
  true,
);

await prisma.$disconnect();

if (failures > 0) {
  console.error(`\n${failures} 项失败`);
  process.exit(1);
}
console.log("\n全部通过");