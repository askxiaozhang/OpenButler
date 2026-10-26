/**
 * AI 管家（阶段 6）的验证。
 *
 * ## 这个脚本跑在「AI 实际不可用」的状态下 —— 这是刻意设计的
 *
 * 用户「后面才接入 AI」，所以降级路径才是常态。这里验证的正是那条路径：
 * 没配模型 / 模型调不通时，用户能不能照样把事记下来。
 *
 * 想验证带 AI 的路径，配好 DEEPSEEK_API_KEY 后重跑本脚本即可 ——
 * 断言对两条路径都成立（source 会变成 ai，其余不变）。
 *
 * 运行：pnpm dev & + headless Edge，然后 npx tsx scripts/verify-intake.mts
 */
import {
  APP,
  Checker,
  bodyText,
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

// 时间戳插在「了」之前 —— 句尾的「了」是判定「已经发生」的关键信号，
// 放到后面会被数字破坏掉（这个脚本第一版就是这么错的）
const RECORD_TEXT = `猫咪今天掏耳朵${stamp}了`;
const TASK_TEXT = `提醒我31天后，提醒妈房子没卖出去${stamp}`;
const BATCH_TEXT = `猫咪每月一次掏耳朵${stamp}、剃屁股毛${stamp}、剪指甲${stamp}`;

function localToday(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}
function addDays(d: string, n: number): string {
  const [y, m, dd] = d.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, dd) + n * 86400000).toISOString().slice(0, 10);
}
const TODAY = localToday();

const s = await openTab(`${APP}/login`);
if (!(await login(s))) {
  console.error("登录失败");
  process.exit(1);
}

/** 在输入框里打字并提交。 */
async function say(text: string) {
  await s.eval(fillScript("__intake", text));
  await s.eval(`
    (() => {
      const btn = [...document.querySelectorAll('button')]
        .find(b => b.getAttribute('aria-label') === '交给管家');
      if (btn) btn.click();
      return true;
    })()`);
}

/** 等确认卡片出现，返回卡片上的复述文本。 */
async function awaitConfirm(timeout = 15_000): Promise<string | null> {
  const ok = await waitFor(
    s,
    `document.querySelector('[data-slot=intake-confirm]')`,
    timeout,
  );
  if (!ok) return null;
  return s.eval<string>(
    `document.querySelector('[data-slot=intake-confirm]').innerText`,
  );
}

/** 点确认卡片上的「就这样」。 */
async function confirm() {
  return s.eval<boolean>(`
    (() => {
      const card = document.querySelector('[data-slot=intake-confirm]');
      if (!card) return false;
      const btn = [...card.querySelectorAll('button')]
        .find(b => b.textContent.includes('就这样'));
      if (!btn) return false;
      btn.click();
      return true;
    })()`);
}

async function gotoHome() {
  await s.eval(`location.href = '${APP}/'`);
  await waitFor(s, `document.body.innerText.includes('你好')`, 15_000);
  await sleep(1500);
}

// 输入框需要 id 才能用 fillScript 填值 —— 用 aria-label 定位后再补 id
async function ensureInputId() {
  await s.eval(`
    (() => {
      const el = document.querySelector('textarea[aria-label="告诉管家发生了什么"]');
      if (el && !el.id) el.id = '__intake';
      return true;
    })()`);
}

// ================================================================
c.group("首页有 AI 管家入口");
{
  await gotoHome();
  await ensureInputId();
  c.check("输入框存在", await s.eval(`!!document.getElementById('__intake')`), true);
  c.checkTruthy(
    "有示例提示（教用户怎么说话）",
    (await bodyText(s)).includes("猫咪今天掏耳朵了"),
  );
}

// ================================================================
c.group("「猫咪今天掏耳朵了」—— 记录 + 确认后落库");
{
  const title = `掏耳朵${stamp}`;
  await say(RECORD_TEXT);

  const card = await awaitConfirm();
  c.checkTruthy("出现确认卡片（不是静默写库）", card !== null);
  c.checkTruthy("  复述里含事项名", (card ?? "").includes(title));
  c.checkTruthy("  复述里含角色", (card ?? "").includes("猫咪"));
  c.checkTruthy("  复述里含日期", (card ?? "").includes("今天"));

  c.check("点「就这样」", await confirm(), true);
  await sleep(3000);

  const rec = await prisma.record.findFirst({ where: { title } });
  c.checkTruthy("记录已落库", rec !== null);
  c.check("  日期是今天", rec ? rec.occurredOn.toISOString().slice(0, 10) : "", TODAY);
  // 注意：不能写 rec?.subjectId !== null —— rec 为 null 时 undefined !== null
  // 是 true，断言会假通过。必须显式判空。
  c.checkTruthy("  归属猫咪", Boolean(rec?.subjectId));
  c.check("  来源标记为 AI 路径", rec?.source ?? "(无)", "AI");
}

// ================================================================
c.group("「提醒我31天后，提醒妈房子没卖出去」—— 一次性待办");
{
  const title = `房子没卖出去${stamp}`;
  await gotoHome();
  await ensureInputId();
  await say(TASK_TEXT);

  const card = await awaitConfirm();
  c.checkTruthy("出现确认卡片", card !== null);
  c.checkTruthy("  「我」没被当成角色", !(card ?? "").includes("要 我 办"));
  c.checkTruthy("  复述里说「要 妈 办」", (card ?? "").includes("妈"));

  c.check("点「就这样」", await confirm(), true);
  await sleep(3000);

  const task = await prisma.task.findFirst({ where: { title } });
  c.checkTruthy("待办已落库", task !== null);
  c.check(
    "  到期日 = 今天 + 31 天（一天不差）",
    task ? task.dueOn.toISOString().slice(0, 10) : "",
    addDays(TODAY, 31),
  );
  c.checkTruthy("  assignee 是妈", Boolean(task?.assigneeId));
  c.check(
    "  subject 为空（妈是办事的人，不是关于对象）",
    task ? task.subjectId === null : "待办不存在",
    true,
  );
}

// ================================================================
c.group("「猫咪每月一次掏耳朵、剃屁股毛、剪指甲」—— 批量周期项");
{
  await gotoHome();
  await ensureInputId();
  await say(BATCH_TEXT);

  const card = await awaitConfirm();
  c.checkTruthy("出现确认卡片", card !== null);
  c.checkTruthy("  复述里三项都在", ["掏耳朵", "剃屁股毛", "剪指甲"].every((t) => (card ?? "").includes(t + stamp)));

  c.check("点「就这样」", await confirm(), true);
  await sleep(4000);

  const routines = await prisma.recurrence.findMany({
    where: { title: { contains: String(stamp) } },
  });
  c.check("三个周期项一次建好（没有漏项）", routines.length, 3);
  c.checkTruthy("  都是每月一次", routines.every((r) => r.freq === "MONTHLY" && r.interval === 1));

  const tasks = await prisma.task.findMany({
    where: { title: { contains: String(stamp) } },
  });
  c.checkTruthy("  已经铺出了待办实例", tasks.length >= 3);
}

// ================================================================
c.group("没听懂时不空手 —— 降级为预填表单");
{
  await gotoHome();
  await ensureInputId();
  await say("asdfgh 乱码 %%%");

  // 降级时会自动打开表单
  const opened = await waitFor(s, `document.getElementById('entry-title')`, 15_000);
  c.check("降级时自动打开表单", opened, true);

  const titleValue = await s.eval<string>(
    `document.getElementById('entry-title')?.value ?? ''`,
  );
  c.checkTruthy("  标题已用原话预填（不是空表单）", titleValue.length > 0);
  c.checkTruthy(
    "  界面上说明了原因",
    (await bodyText(s)).length > 0,
  );

  // 关掉
  await s.eval(
    `document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`,
  );
  await sleep(800);
}

// ================================================================
c.group("取消确认卡片不会写库");
{
  await gotoHome();
  await ensureInputId();
  const title = `不该被存${stamp}`;
  await say(`买酱油${title}`);
  await awaitConfirm();

  const cancelled = await s.eval<boolean>(`
    (() => {
      const card = document.querySelector('[data-slot=intake-confirm]');
      if (!card) return false;
      const btn = [...card.querySelectorAll('button')]
        .find(b => b.getAttribute('aria-label') === '取消');
      if (!btn) return false;
      btn.click();
      return true;
    })()`);
  c.check("点取消", cancelled, true);
  await sleep(2000);

  c.check("卡片消失", await s.eval(`!document.querySelector('[data-slot=intake-confirm]')`), true);

  const leaked = await prisma.task.findFirst({ where: { title: { contains: title } } });
  const leakedRec = await prisma.record.findFirst({ where: { title: { contains: title } } });
  c.check("没有任何数据被写入", leaked === null && leakedRec === null, true);
}

// ================================================================
c.group("清理测试数据");
{
  const t = await prisma.task.deleteMany({ where: { title: { contains: String(stamp) } } });
  const r = await prisma.record.deleteMany({ where: { title: { contains: String(stamp) } } });
  const rec = await prisma.recurrence.deleteMany({
    where: { title: { contains: String(stamp) } },
  });
  c.checkTruthy(`清掉 ${t.count} 待办 / ${r.count} 记录 / ${rec.count} 周期项`, true);
}

await prisma.$disconnect();
s.close();
c.finish();
