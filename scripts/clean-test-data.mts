/**
 * 清理验证脚本留下的测试数据。
 *
 * ## 为什么需要这个
 *
 * 验证脚本各自都有清理逻辑，但只要**任何一次运行失败**（断言挂了、超时了、
 * 浏览器崩了），清理那一步就不会执行，残留数据留在库里。下一次运行就会
 * 被这些残留干扰 —— 表现是「点恢复恢复错了角色」「排序点了没反应」
 * 这类看起来像功能 bug 的现象，排查起来非常费劲（我为此浪费了不少时间）。
 *
 * 所以：**每次跑验证之前，先无条件清一遍**。
 *
 * 只删测试数据 —— 判定依据是标题/名字里带脚本生成的时间戳或固定前缀，
 * 不会碰用户真实录入的内容。
 *
 * 用法：npx tsx scripts/clean-test-data.mts
 */
import { config } from "dotenv";
config({ path: [".env.local", ".env"], quiet: true });

import { createPrismaClient } from "../src/lib/prisma-client";

const prisma = createPrismaClient();

/**
 * 测试数据的特征。
 *
 * 都是脚本里写死的字面前缀 + 时间戳。刻意用 `startsWith`/正则的精确形态，
 * 不用宽泛的 `contains('测试')` —— 万一用户真的记了一条「测试猫咪体重」，
 * 不该被误删。
 */
const TITLE_PATTERNS = [
  /^测试宠\d+/, // 角色管理
  /^测掏耳\d+/, // 周期引擎（护理类）
  /^测物业费\d+/, // 周期引擎（账单类）
  /^掏耳朵\d+$/, // 记录与待办
  /^房子没卖出去\d+/, // 记录与待办
  /^我的私事\d+$/, // 记录与待办
  /^日历测试\d+$/, // 日历
  /^调试逾期项$/, // 调试脚本
  /^不该被存\d+$/, // AI 管家（取消不写库）
  /^买酱油不该被存\d+$/, // AI 管家
  /^随便说点什么$/, // 解析器兜底用例
];

const matches = (s: string) => TITLE_PATTERNS.some((re) => re.test(s));

async function main() {
  const [members, recurrences, tasks, records] = await Promise.all([
    prisma.member.findMany({ select: { id: true, name: true } }),
    prisma.recurrence.findMany({ select: { id: true, title: true } }),
    prisma.task.findMany({ select: { id: true, title: true } }),
    prisma.record.findMany({ select: { id: true, title: true } }),
  ]);

  const dirty = {
    members: members.filter((m) => matches(m.name)).map((m) => m.id),
    recurrences: recurrences.filter((r) => matches(r.title)).map((r) => r.id),
    tasks: tasks.filter((t) => matches(t.title)).map((t) => t.id),
    records: records.filter((r) => matches(r.title)).map((r) => r.id),
  };

  const total =
    dirty.members.length + dirty.recurrences.length + dirty.tasks.length + dirty.records.length;

  if (total === 0) {
    console.log("没有需要清理的测试数据。");
    return;
  }

  // 顺序很重要：先删挂在周期项上的，再删周期项本身，
  // 否则会因为外键约束失败
  await prisma.record.deleteMany({ where: { id: { in: dirty.records } } });
  await prisma.task.deleteMany({ where: { id: { in: dirty.tasks } } });
  await prisma.recurrence.deleteMany({ where: { id: { in: dirty.recurrences } } });
  await prisma.member.deleteMany({ where: { id: { in: dirty.members } } });

  console.log(
    `清掉 ${dirty.members.length} 个角色 / ${dirty.recurrences.length} 个周期项 / ` +
      `${dirty.tasks.length} 条待办 / ${dirty.records.length} 条记录`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());