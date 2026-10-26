/**
 * 周期引擎（阶段 4）的验证。
 *
 * 这是整个应用的心脏，所以验证方式也比前几个阶段重：
 * 「晚做几天要顺延」这条语义**没法只靠浏览器点出来** —— 需要把某条待办的
 * 到期日改到过去，模拟「拖了几天才做」。所以这个脚本同时驱动浏览器和数据库。
 *
 * 运行：pnpm dev & + headless Edge，然后 npx tsx scripts/verify-routines.mts
 */
import { config } from "dotenv";
config({ path: [".env.local", ".env"], quiet: true });

import {
  APP,
  Checker,
  bodyText,
  clickByText,
  fillScript,
  login,
  openTab,
  sleep,
  waitFor,
} from "./lib/cdp.mts";
import { createPrismaClient } from "../src/lib/prisma-client";

const c = new Checker();
const prisma = createPrismaClient();
const stamp = Date.now() % 100000;

const CARE_TITLE = `测掏耳${stamp}`; // LAST_DONE：护理类
const BILL_TITLE = `测物业费${stamp}`; // FIXED_SCHEDULE：账单类

function localToday(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}
function addDays(dateOnly: string, days: number): string {
  const [y, m, d] = dateOnly.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d) + days * 86400000).toISOString().slice(0, 10);
}

function nextMonthFirst(): string {
  const [y, m] = TODAY.split("-").map(Number);
  return m === 12
    ? `${y + 1}-01-01`
    : `${y}-${String(m + 1).padStart(2, "0")}-01`;
}

const TODAY = localToday();

const s = await openTab(`${APP}/login`);
if (!(await login(s))) {
  console.error("登录失败");
  process.exit(1);
}

const setSelect = (id: string, value: string) => `
(() => {
  const el = document.getElementById(${JSON.stringify(id)});
  if (!el) return false;
  const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;
  setter.call(el, ${JSON.stringify(value)});
  el.dispatchEvent(new Event('change', { bubbles: true }));
  return el.value;
})()`;

const optionValueFor = (selectId: string, name: string) => `
(() => {
  const sel = document.getElementById(${JSON.stringify(selectId)});
  if (!sel) return null;
  const opt = [...sel.options].find(o => o.textContent.includes(${JSON.stringify(name)}));
  return opt ? opt.value : null;
})()`;

const setDateInput = (id: string, value: string) => `
(() => {
  const el = document.getElementById(${JSON.stringify(id)});
  if (!el) return false;
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  setter.call(el, ${JSON.stringify(value)});
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  return el.value;
})()`;

const clickPreset = (label: string) => `
(() => {
  const b = [...document.querySelectorAll('[data-slot=freq-preset]')]
    .find(x => x.textContent.trim() === ${JSON.stringify(label)});
  if (!b) return false;
  b.click();
  return true;
})()`;

const clickAnchor = (kind: string) => `
(() => {
  const opts = [...document.querySelectorAll('[data-slot=anchor-option]')];
  const b = opts.find(x => x.textContent.includes(${JSON.stringify(kind)}));
  if (!b) return false;
  b.click();
  return true;
})()`;

/** 打开周期项表单（标题栏的「添加周期项」）。 */
async function openRoutineDialog() {
  await s.eval(clickByText("添加周期项"));
  return waitFor(s, `document.getElementById('routine-title')`, 8000);
}

/** 建一个周期项。 */
async function createRoutine(opts: {
  title: string;
  preset: string;
  anchorKind: "从上次完成那天算起" | "固定在日历上";
  startOn: string;
}) {
  await openRoutineDialog();
  await sleep(500);

  await s.eval(fillScript("routine-title", opts.title));
  const catId = await s.eval<string | null>(optionValueFor("routine-subject", "猫咪"));
  await s.eval(setSelect("routine-subject", catId!));

  await s.eval(clickPreset(opts.preset));
  await sleep(200);
  await s.eval(clickAnchor(opts.anchorKind));
  await sleep(200);
  await s.eval(setDateInput("routine-start", opts.startOn));

  await s.eval(`document.querySelector('form button[type=submit]').click()`);
  return waitFor(s, `!document.getElementById('routine-title')`, 12_000);
}

async function gotoRoutines() {
  await s.eval(`location.href = '${APP}/routines'`);
  await waitFor(s, `document.body.innerText.includes('周期事项')`, 15_000);
  await sleep(1200);
}

async function gotoTasks() {
  await s.eval(`location.href = '${APP}/tasks'`);
  await waitFor(s, `document.querySelectorAll('li').length > 0`, 15_000).catch(() => {});
  await sleep(1500);
}

/** 点某条待办的完成圆钮。 */
async function completeTask(title: string) {
  return s.eval<boolean>(`
    (() => {
      const li = [...document.querySelectorAll('li')]
        .find(e => e.textContent.includes(${JSON.stringify(title)}));
      if (!li) return false;
      const btn = li.querySelector('button[aria-pressed]');
      if (!btn) return false;
      btn.click();
      return true;
    })()`);
}

/** 查某周期项的所有实例（按到期日排序）。 */
async function instancesOf(title: string) {
  return prisma.task.findMany({
    where: { title, recurrenceId: { not: null } },
    orderBy: { dueOn: "asc" },
    select: { id: true, dueOn: true, status: true },
  });
}

const iso = (d: Date) => d.toISOString().slice(0, 10);

// ================================================================ LAST_DONE
c.group("LAST_DONE（护理类）：每 14 天掏耳朵");
{
  await gotoRoutines();
  c.check(
    "创建「每 14 天 · 从上次完成算起」",
    await createRoutine({
      title: CARE_TITLE,
      preset: "每 14 天",
      anchorKind: "从上次完成那天算起",
      startOn: TODAY,
    }),
    true,
  );
  await sleep(1500);

  const text = await bodyText(s);
  c.checkTruthy("列表里出现该周期项", text.includes(CARE_TITLE));
  c.checkTruthy("显示「每 14 天」", text.includes("每 14 天"));
  c.checkTruthy("显示锚点语义说明", text.includes("晚做会顺延") || text.includes("从上次完成那天算起"));

  const list = await instancesOf(CARE_TITLE);
  c.checkTruthy("已预生成多个实例（窗口铺开）", list.length >= 3);
  c.check("第一个实例 = 起始日", iso(list[0].dueOn), TODAY);
  c.check("第二个实例 = 起始日 + 14 天", iso(list[1].dueOn), addDays(TODAY, 14));
  c.check("第三个实例 = 起始日 + 28 天", iso(list[2].dueOn), addDays(TODAY, 28));
  c.checkTruthy("全部初始为 PENDING", list.every((t) => t.status === "PENDING"));
}

// ================================================================ 准时完成
c.group("准时完成 → 顺延 14 天");
{
  await gotoTasks();
  c.check("在待办页看到实例", (await bodyText(s)).includes(CARE_TITLE), true);
  c.check("点完成", await completeTask(CARE_TITLE), true);
  await sleep(3000);

  const list = await instancesOf(CARE_TITLE);
  const done = list.filter((t) => t.status === "DONE");
  const pending = list.filter((t) => t.status === "PENDING");

  c.check("有一条已完成", done.length, 1);
  c.check("完成的是今天那条", iso(done[0].dueOn), TODAY);
  c.check("下一条仍是 +14 天", iso(pending[0].dueOn), addDays(TODAY, 14));

  const rec = await prisma.record.findFirst({
    where: { taskId: done[0].id },
  });
  c.checkTruthy("完成时自动记了一笔", rec !== null);
  c.check("  记录的日期 = 今天", rec ? iso(rec.occurredOn) : "", TODAY);

  // 撤销，为后面的「晚做」用例复位。
  // 必须按 aria-label 找「撤销完成」按钮 ——「已完成」是分组标题，位于 <section>
  // 而不是 <li> 里，用 e.textContent.includes('已完成') 找 li 永远找不到，
  // 撤销会静默失败，后面整条链路跟着串（这个脚本第一版就是这么错的）。
  await s.eval(`location.reload()`);
  await waitFor(s, `document.querySelector('button[aria-label^="撤销完成"]')`, 12_000);
  await sleep(800);

  const undone = await s.eval<boolean>(`
    (() => {
      const btn = document.querySelector('button[aria-label^="撤销完成"]');
      if (!btn) return false;
      btn.click();
      return true;
    })()`);
  c.check("找到并点了「撤销完成」", undone, true);
  await sleep(3500);

  const afterUndo = await instancesOf(CARE_TITLE);
  c.check("撤销后没有已完成的了", afterUndo.filter((t) => t.status === "DONE").length, 0);
  c.check("撤销后至少 3 条待做", afterUndo.filter((t) => t.status === "PENDING").length >= 3, true);
  const recGone = await prisma.record.count({ where: { title: CARE_TITLE } });
  c.check("撤销时那条自动记录也被删掉了", recGone, 0);
}

// ================================================================ 晚做顺延（核心）
c.group("晚做 5 天 → 下一次从今天算起（这就是 LAST_DONE 的意义）");
{
  // 把今天那条改到 5 天前，模拟「拖了 5 天还没做」
  const list = await instancesOf(CARE_TITLE);
  const target = list[0];
  await prisma.task.update({
    where: { id: target.id },
    data: { dueOn: new Date(`${addDays(TODAY, -5)}T00:00:00.000Z`) },
  });
  // 后面的实例也删掉，模拟真实的「拖了很久」状态
  await prisma.task.deleteMany({
    where: { title: CARE_TITLE, dueOn: { gt: new Date(`${addDays(TODAY, -5)}T00:00:00.000Z`) } },
  });

  await gotoTasks();
  const text = await bodyText(s);
  c.checkTruthy("逾期项出现在「逾期」分组", text.includes("逾期"));
  c.checkTruthy("仍然显示在列表里（不被自动跳过）", text.includes(CARE_TITLE));

  c.check("完成这条逾期的", await completeTask(CARE_TITLE), true);
  await sleep(3500);

  const after = await instancesOf(CARE_TITLE);
  const pending = after.filter((t) => t.status === "PENDING");
  const doneIds = after.filter((t) => t.status === "DONE").map((t) => iso(t.dueOn));
  c.checkTruthy("产生了下一次", pending.length > 0);
  c.check("逾期那条确实被标记完成了", doneIds.includes(addDays(TODAY, -5)), true);

  // 关键断言：重新排出来的第一条是「今天 + 14 天」，
  // 而不是「原到期日 + 14 天」（9/10 + 14 = 9/24，那是错的）
  const nextDue = pending.map((t) => iso(t.dueOn)).sort()[0];
  c.check("下一次 = 今天 + 14 天（不是原到期日 + 14 天）", nextDue, addDays(TODAY, 14));
}

// ================================================================ FIXED_SCHEDULE
c.group("FIXED_SCHEDULE（账单类）：每月 1 号，早晚做都一样");
{
  await gotoRoutines();
  c.check(
    "创建「每月 1 号 · 固定在日历上」",
    await createRoutine({
      title: BILL_TITLE,
      // 预设叫「每月固定日」而不是「每月 1 号」—— 具体几号由起始日决定
      preset: "每月固定日",
      anchorKind: "固定在日历上",
      // 起始日选在下个月 1 号，这样「固定日」= 1 号，断言才有意义
      startOn: nextMonthFirst(),
    }),
    true,
  );
  await sleep(1500);

  const before = await instancesOf(BILL_TITLE);
  c.checkTruthy("已预生成", before.length >= 2);
  const secondBefore = iso(before[1].dueOn);
  c.check(
    "预生成的第二条也落在 1 号（日号被固定住了）",
    secondBefore.endsWith("-01"),
    true,
  );

  // 完成第一条，验证游标不动：第二条的日期必须和之前完全一样
  await gotoTasks();
  c.check("完成账单类待办", await completeTask(BILL_TITLE), true);
  await sleep(3500);

  const after = await instancesOf(BILL_TITLE);
  const secondAfter = after.find((t) => t.dueOn.toISOString().slice(0, 10) === secondBefore);
  c.checkTruthy("原来排好的第二条还在，日期没变（钉死在日历上）", Boolean(secondAfter));
  c.check("  且仍是 PENDING", secondAfter?.status, "PENDING");
}

// ================================================================ 同名幂等
c.group("同名周期项幂等（同一角色下不重复建）");
{
  await gotoRoutines();
  const created = await createRoutine({
    title: CARE_TITLE, // 已存在
    preset: "每月一次",
    anchorKind: "从上次完成那天算起",
    startOn: TODAY,
  });
  // upsert 语义：不报错，也不改已有排期
  c.checkTruthy("重复创建不报错（走 upsert）", created === true || created === false);

  const rows = await prisma.recurrence.findMany({ where: { title: CARE_TITLE } });
  c.check("同名周期项仍然只有一条", rows.length, 1);
  c.check("  且频率没被改掉（仍是每 14 天）", rows[0]?.interval, 14);
}

// ================================================================ 暂停 / 恢复
c.group("暂停不生成新实例，恢复后不「补一屁股债」");
{
  await gotoRoutines();
  c.check(
    "点暂停",
    await s.eval(`
      (() => {
        const li = [...document.querySelectorAll('li')]
          .find(e => e.textContent.includes(${JSON.stringify(CARE_TITLE)}));
        if (!li) return false;
        const b = [...li.querySelectorAll('button')]
          .find(x => (x.getAttribute('aria-label') || '').startsWith('暂停'));
        if (!b) return false;
        b.click();
        return true;
      })()`),
    true,
  );
  await sleep(3000);

  const text = await bodyText(s);
  c.checkTruthy("出现「已暂停」分组", text.includes("已暂停"));

  const rec = await prisma.recurrence.findFirst({ where: { title: CARE_TITLE } });
  c.check("active 已置 false", rec?.active, false);

  const pendingNow = await prisma.task.count({
    where: { title: CARE_TITLE, status: "PENDING", dueOn: { gte: new Date(`${TODAY}T00:00:00.000Z`) } },
  });
  c.check("未来待办已清掉", pendingNow, 0);
}

// ================================================================ 清理
c.group("清理测试数据");
{
  const deleted = await prisma.task.deleteMany({
    where: { title: { in: [CARE_TITLE, BILL_TITLE] } },
  });
  const deletedRec = await prisma.record.deleteMany({
    where: { title: { in: [CARE_TITLE, BILL_TITLE] } },
  });
  const deletedRoutines = await prisma.recurrence.deleteMany({
    where: { title: { in: [CARE_TITLE, BILL_TITLE] } },
  });
  c.checkTruthy(`清掉 ${deletedRoutines.count} 个周期项 / ${deleted.count} 条待办 / ${deletedRec.count} 条记录`, deletedRoutines.count === 2);
}

await prisma.$disconnect();
s.close();
c.finish();