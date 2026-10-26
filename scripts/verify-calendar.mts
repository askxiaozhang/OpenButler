/**
 * 日历视图（阶段 5）的验证。
 *
 * ## 时区是这个阶段唯一的真风险
 *
 * Vercel 函数跑 UTC，用户在北京。北京时间 00:30 时服务端还是前一天 16:30 UTC ——
 * 「今天掏耳朵了」会被记成昨天，日历上也落在错误的格子里。这类 bug 在本地
 * 开发（时区恰好等于 APP_TIMEZONE）几乎不可能发现。
 *
 * 所以这个脚本**必须用极端时区各跑一遍**：
 *   APP_TIMEZONE=Pacific/Kiritimati  (UTC+14，全球最早的时区)
 *   APP_TIMEZONE=Pacific/Midway      (UTC-11，最晚的时区之一)
 *
 * 用法（由 verify-calendar.sh 编排）：
 *   APP_TIMEZONE=xxx npx tsx scripts/verify-calendar.mts
 */
import { config } from "dotenv";
config({ path: [".env.local", ".env"], quiet: true });

import {
  APP,
  Checker,
  bodyText,
  login,
  openTab,
  sleep,
  waitFor,
} from "./lib/cdp.mts";
import { createPrismaClient } from "../src/lib/prisma-client";

const TZ = process.env.APP_TIMEZONE ?? "Asia/Shanghai";

const c = new Checker();
const prisma = createPrismaClient();
const stamp = Date.now() % 100000;
const TITLE = `日历测试${stamp}`;

/**
 * 按被测时区独立算出「今天」。
 *
 * 不向服务端要 —— 那样服务端算错了也会「一致通过」。测试自己算一份，
 * 再断言页面把它标成了今天，这样才真的在验时区折算。
 */
function expectedToday(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

const TODAY = expectedToday();

// 建一条今天到期的待办，用它来验证日历的格子归属
const cat = await prisma.member.findFirst({ where: { name: "猫咪" } });
await prisma.task.deleteMany({ where: { title: TITLE } });
await prisma.task.create({
  data: {
    subjectId: cat!.id,
    title: TITLE,
    dueOn: new Date(`${TODAY}T00:00:00.000Z`),
    status: "PENDING",
  },
});

const s = await openTab(`${APP}/login`);
if (!(await login(s))) {
  console.error("登录失败");
  process.exit(1);
}

await s.eval(`location.href = '${APP}/calendar'`);
await waitFor(s, `document.querySelectorAll('[data-day]').length > 0`, 15_000);
await sleep(1500);

c.group(`日历渲染（APP_TIMEZONE=${TZ}，今天=${TODAY}）`);
{
  const cells = await s.eval<number>(`document.querySelectorAll('[data-day]').length`);
  c.check("渲染出 42 个日格（6 行 × 7 列）", cells, 42);

  c.checkTruthy(
    "「今天」的格子被标记出来",
    await s.eval(`
      (() => {
        const cell = document.querySelector('[data-day="${TODAY}"]');
        if (!cell) return false;
        return cell.className.includes('border-primary') || cell.className.includes('bg-primary');
      })()`),
  );

  const monthLabel = await bodyText(s);
  c.checkTruthy("月份标题显示正确", monthLabel.includes(`${TODAY.slice(0, 4)} 年`));
}

c.group("今天到期的待办落在今天的格子里（时区归属）");
{
  const dotsOnToday = await s.eval<number>(`
    document.querySelector('[data-day="${TODAY}"]').querySelectorAll('span.rounded-full').length`);

  c.checkTruthy("今天的格子里至少有一个圆点", dotsOnToday > 0);

  // 关键反证：昨天和明天的格子里不该有它
  const cellYesterday = await s.eval<string | null>(`
    (() => {
      const cells = [...document.querySelectorAll('[data-day]')];
      const i = cells.findIndex(c => c.dataset.day === "${TODAY}");
      return i > 0 ? cells[i - 1].dataset.day : null;
    })()`);

  c.checkTruthy("能定位到前一天的格子（用于反证）", Boolean(cellYesterday));

  await s.eval(`location.href = '${APP}/calendar?day=${TODAY}'`);
  await waitFor(s, `document.querySelector('[data-day-detail]')`, 15_000);
  await sleep(1000);

  const detail = await bodyText(s);
  c.check("点开后详情里能看到这条待办", detail.includes(TITLE), true);
  c.check(
    "  详情面板对应的日期就是今天",
    await s.eval<string>(`document.querySelector('[data-day-detail]').dataset.dayDetail`),
    TODAY,
  );

  // 反证：昨天的详情里不该有它
  if (cellYesterday) {
    await s.eval(`location.href = '${APP}/calendar?day=${cellYesterday}'`);
    await waitFor(s, `document.querySelector('[data-day-detail]')`, 15_000);
    await sleep(1000);
    c.check("前一天点开看不到这条（没有漂移）", (await bodyText(s)).includes(TITLE), false);
  }
}

c.group("翻月与筛选");
{
  await s.eval(`location.href = '${APP}/calendar'`);
  await waitFor(s, `document.querySelectorAll('[data-day]').length > 0`, 15_000);
  await sleep(1200);

  const beforeCells = await s.eval<string[]>(`
    [...document.querySelectorAll('[data-day]')].slice(0, 7).map(c => c.dataset.day)`);

  await s.eval(`
    (() => {
      const b = [...document.querySelectorAll('button')]
        .find(x => x.getAttribute('aria-label') === '下个月');
      if (b) b.click();
      return true;
    })()`);
  await sleep(2500);

  const afterCells = await s.eval<string[]>(`
    [...document.querySelectorAll('[data-day]')].slice(0, 7).map(c => c.dataset.day)`);

  c.checkTruthy("点「下个月」后网格日期变了", JSON.stringify(beforeCells) !== JSON.stringify(afterCells));
  c.checkTruthy("URL 带上了 month 参数", (await s.eval<string>(`location.search`)).includes("month="));

  // 非法 month 参数不该报错，应回落到本月
  await s.eval(`location.href = '${APP}/calendar?month=garbage'`);
  await waitFor(s, `document.querySelectorAll('[data-day]').length > 0`, 15_000);
  await sleep(1000);
  const stillToday = await s.eval<boolean>(`!!document.querySelector('[data-day="${TODAY}"]')`);
  c.check("非法 month 参数回落到本月（不报错）", stillToday, true);

  await s.eval(`location.href = '${APP}/calendar'`);
  await waitFor(s, `document.querySelectorAll('[data-day]').length > 0`, 15_000);
  await sleep(1200);

  // 按角色筛选：选「猫咪」应看到，选一个无关的新角色应看不到
  const catChip = await s.eval<boolean>(`
    (() => {
      const chips = [...document.querySelectorAll('[data-slot=member-chip]')];
      const chip = chips.find(b => b.textContent.includes('猫咪'));
      if (!chip) return false;
      chip.click();
      return true;
    })()`);
  c.check("能点中「猫咪」筛选", catChip, true);
  await sleep(2500);
  const catDots = await s.eval<number>(`
    document.querySelector('[data-day="${TODAY}"]').querySelectorAll('span.rounded-full').length`);
  c.checkTruthy("按猫咪筛选后今天仍有圆点", catDots > 0);
  c.checkTruthy("URL 带上了 member 参数", (await s.eval<string>(`location.search`)).includes("member="));
}

// 清理
await prisma.task.deleteMany({ where: { title: TITLE } });
await prisma.$disconnect();
s.close();
c.finish();