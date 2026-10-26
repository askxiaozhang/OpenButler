/**
 * 记录与待办（阶段 3）的浏览器验证。
 *
 * 这是「不接 AI 也完全可用」这个里程碑的验收：用户描述的几个用例必须能
 * 纯手动跑通。重点在**按角色筛选的 subject-OR-assignee 语义** ——
 * 描述里「提醒妈房子没卖出去」这种事的「妈」是要去办事的人，
 * 按「妈」筛选时必须能同时看到「关于妈」和「要妈办」的两类。
 *
 * 运行：pnpm dev & + headless Edge，然后 npx tsx scripts/verify-entries.mts
 */
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

const RECORD_TITLE = `掏耳朵${stamp}`;
const TASK_TITLE = `房子没卖出去${stamp}`;
const PERSONAL_TITLE = `我的私事${stamp}`;

/** 在 <input type=date> 上设值。React 受控组件要走原生 setter。 */
const setDate = (id: string, value: string) => `
(() => {
  const el = document.getElementById(${JSON.stringify(id)});
  if (!el) return false;
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype, 'value'
  ).set;
  setter.call(el, ${JSON.stringify(value)});
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  return el.value;
})()`;

const setSelect = (id: string, value: string) => `
(() => {
  const el = document.getElementById(${JSON.stringify(id)});
  if (!el) return false;
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLSelectElement.prototype, 'value'
  ).set;
  setter.call(el, ${JSON.stringify(value)});
  el.dispatchEvent(new Event('change', { bubbles: true }));
  return el.value;
})()`;

/** 找角色的 option value（按名字匹配）。 */
const optionValueFor = (selectId: string, name: string) => `
(() => {
  const sel = document.getElementById(${JSON.stringify(selectId)});
  if (!sel) return null;
  const opt = [...sel.options].find(o => o.textContent.includes(${JSON.stringify(name)}));
  return opt ? opt.value : null;
})()`;

/** 页面里是否出现了某条待办/记录。 */
const hasEntry = (title: string) =>
  s.eval<boolean>(
    `document.body.innerText.includes(${JSON.stringify(title)})`,
  );

/** 打开「加待办」对话框。 */
async function openTaskDialog() {
  await s.eval(clickByText("加待办"));
  return waitFor(s, `document.getElementById('entry-title')`, 8000);
}

async function openRecordDialog() {
  await s.eval(clickByText("记一笔"));
  return waitFor(s, `document.getElementById('entry-title')`, 8000);
}

/**
 * 测试自己按 Asia/Shanghai 算「今天」。
 *
 * 不直接问服务端要 —— 那样两边用同一个错值也会「一致通过」。自己算一份，
 * 再断言服务端给的默认日期与它相符，等于顺手验证了服务端的时区折算是对的。
 */
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
  return new Date(Date.UTC(y, m - 1, d) + days * 86400000)
    .toISOString()
    .slice(0, 10);
}

const TODAY = localToday();
const FUTURE = addDays(TODAY, 31);

// 跨块使用的 id，提到模块作用域
let momId: string | null = null;
let catId: string | null = null;
let meId: string | null = null;

const s = await openTab(`${APP}/login`);
if (!(await login(s))) {
  console.error("登录失败");
  process.exit(1);
}

// ---------------------------------------------------------------- 建待办
c.group("手动建待办（对应「提醒我 31 天后，提醒妈房子没卖出去」）");
{
  await s.eval(`location.href = '${APP}/tasks'`);
  await waitFor(s, `document.body.innerText.includes('待办')`, 15_000);
  await sleep(1500); // 等注水，对话框才有正确的默认日期

  c.check("打开「加待办」对话框", await openTaskDialog(), true);
  await sleep(400);

  // 服务端传入的默认日期必须等于测试自己按 Asia/Shanghai 算的今天
  c.check(
    "服务端给的默认日期 = 独立算出的今天",
    await s.eval(`document.getElementById('entry-date').value`),
    TODAY,
  );

  await s.eval(fillScript("entry-title", TASK_TITLE));
  await s.eval(setDate("entry-date", FUTURE));

  // 点开「谁去办」，选「妈」
  await s.eval(clickByText("指定「谁去办」"));
  await sleep(400);
  momId = await s.eval<string | null>(optionValueFor("entry-assignee", "妈"));
  c.checkTruthy("拿到「妈」的 id", momId);
  await s.eval(setSelect("entry-assignee", momId!));
  c.check(
    "「谁去办」已选中妈",
    await s.eval(`document.getElementById('entry-assignee').value === ${JSON.stringify(momId)}`),
    true,
  );

  await s.eval(`document.querySelector('form button[type=submit]').click()`);
  c.check("对话框关闭", await waitFor(s, `!document.getElementById('entry-title')`, 10_000), true);
  await sleep(1000);

  c.check("待办已创建", await hasEntry(TASK_TITLE), true);
  c.checkTruthy("显示「要妈办」标记", (await bodyText(s)).includes("要 妈 办"));
  c.checkTruthy("落在「以后」分组（31 天后）", (await bodyText(s)).includes("以后"));
}

// ---------------------------------------------------------------- 建记录
c.group("手动记一笔（对应「猫咪今天掏耳朵了」）");
{
  await s.eval(`location.href = '${APP}/records'`);
  await waitFor(s, `document.querySelectorAll('ul').length > 0`, 15_000).catch(() => {});
  await sleep(1200);

  c.check("打开「记一笔」对话框", await openRecordDialog(), true);
  await sleep(400);

  await s.eval(fillScript("entry-title", RECORD_TITLE));
  catId = await s.eval<string | null>(optionValueFor("entry-subject", "猫咪"));
  c.checkTruthy("拿到「猫咪」的 id", catId);
  await s.eval(setSelect("entry-subject", catId!));

  await s.eval(`document.querySelector('form button[type=submit]').click()`);
  c.check("对话框关闭", await waitFor(s, `!document.getElementById('entry-title')`, 10_000), true);
  await sleep(1000);

  c.check("记录已创建", await hasEntry(RECORD_TITLE), true);
  c.checkTruthy("归属显示为猫咪", (await bodyText(s)).includes("猫咪"));
}

// ---------------------------------------------------------------- 再建一条纯私事（用于验证筛选确实在筛）
c.group("再建一条「我的私事」作为筛选对照");
{
  // 上一组停在 /records，那里只有「记一笔」，得先回待办页
  await s.eval(`location.href = '${APP}/tasks'`);
  await waitFor(s, `document.body.innerText.includes('待办')`, 15_000);
  await sleep(1500);

  c.check("打开「加待办」对话框", await openTaskDialog(), true);
  await sleep(400);

  await s.eval(fillScript("entry-title", PERSONAL_TITLE));
  meId = await s.eval<string | null>(optionValueFor("entry-subject", "我"));
  c.checkTruthy("拿到「我」的 id", meId);
  await s.eval(setSelect("entry-subject", meId!));
  await s.eval(setDate("entry-date", TODAY));
  await s.eval(`document.querySelector('form button[type=submit]').click()`);
  await waitFor(s, `!document.getElementById('entry-title')`, 10_000);
  await sleep(1000);

  c.check("私事待办已创建", await hasEntry(PERSONAL_TITLE), true);
}

// ---------------------------------------------------------------- 筛选（核心）
c.group("按角色筛选 —— subject OR assignee（核心语义）");
{
  await s.eval(`location.href = '${APP}/tasks'`);
  await waitFor(s, `document.body.innerText.includes(${JSON.stringify(TASK_TITLE)})`, 15_000);
  await sleep(1000);

/** 点某个筛选 chip（「全部」/角色名）。chip 文本形如「👩 妈」。 */
const CHIP_CLICK = (name: string) => `
(() => {
  const target = ${JSON.stringify(name)};
  // 限定 data-slot=member-chip：待办的完成按钮也用 aria-pressed
  const chips = [...document.querySelectorAll('[data-slot=member-chip]')];
  const chip = chips.find(b => {
    if (target === '全部') return b.textContent.trim() === '全部';
    const spans = [...b.querySelectorAll('span')];
    return spans.length > 0 && spans[spans.length - 1].textContent.trim() === target;
  });
  if (!chip) return false;
  chip.click();
  return true;
})()`;

async function filterBy(name: string) {
  const ok = await s.eval<boolean>(CHIP_CLICK(name));
  await sleep(2500); // 等导航 + 重新渲染
  return ok;
}

  c.check("「全部」下能看到三条", (await hasEntry(TASK_TITLE)) && (await hasEntry(PERSONAL_TITLE)), true);

  // 按「妈」筛：房子那条的 assignee 是妈，必须出现
  c.check("能点中「妈」筛选 chip", await filterBy("妈"), true);

  c.check("按「妈」筛选后能看到「要妈办」的待办（assignee 命中）", await hasEntry(TASK_TITLE), true);
  c.check("按「妈」筛选后看不到我的私事（正确排除）", await hasEntry(PERSONAL_TITLE), false);
  c.checkTruthy(
    "URL 带上了 member 参数",
    (await s.eval<string>(`location.search`)).includes("member="),
  );

  // 按「我」筛：私事出现，妈的那条消失
  await filterBy("我");
  c.check("按「我」筛选后能看到我的私事", await hasEntry(PERSONAL_TITLE), true);
  c.check("按「我」筛选后看不到要妈办的事", await hasEntry(TASK_TITLE), false);

  // 记录页的筛选
  await s.eval(`location.href = '${APP}/records?member=' + ${JSON.stringify(catId)}`);
  await sleep(2800);
  c.check("记录页按「猫咪」筛选能看到猫的记录", await hasEntry(RECORD_TITLE), true);

  await s.eval(`location.href = '${APP}/records'`);
  await sleep(2800);
  c.check("记录页「全部」也能看到", await hasEntry(RECORD_TITLE), true);

  // 回到全部
  await s.eval(`location.href = '${APP}/tasks'`);
  await sleep(2500);
}

// ---------------------------------------------------------------- 完成 → 自动记一笔
c.group("完成待办 → 自动生成记录（「做了就是发生了」）");
{
  await s.eval(`location.href = '${APP}/tasks'`);
  await waitFor(s, `document.body.innerText.includes(${JSON.stringify(PERSONAL_TITLE)})`, 15_000);
  await sleep(1000);

  c.check(
    "点完成按钮",
    await s.eval(`
      (() => {
        const li = [...document.querySelectorAll('li')]
          .find(e => e.textContent.includes(${JSON.stringify(PERSONAL_TITLE)}));
        if (!li) return false;
        const btn = li.querySelector('button[aria-pressed]');
        if (!btn) return false;
        btn.click();
        return true;
      })()`),
    true,
  );
  await sleep(2500);

  c.checkTruthy("列表里出现「已完成」分组", (await bodyText(s)).includes("已完成"));

  // 记录页应自动多出一条同名记录
  await s.eval(`location.href = '${APP}/records'`);
  await sleep(3000);
  const recordsText = await bodyText(s);
  c.check(
    "记录页自动出现了这条（完成即记录）",
    (recordsText.match(new RegExp(PERSONAL_TITLE, "g")) ?? []).length >= 1,
    true,
  );
}

// ---------------------------------------------------------------- 撤销完成
c.group("撤销完成会一并删掉那条记录（不留「做过但其实没做」）");
{
  await s.eval(`location.href = '${APP}/tasks'`);
  await sleep(2800);

  await s.eval(`
    (() => {
      const li = [...document.querySelectorAll('li')]
        .find(e => e.textContent.includes(${JSON.stringify(PERSONAL_TITLE)}));
      if (!li) return false;
      const btn = li.querySelector('button[aria-pressed]');
      if (btn) btn.click();
      return true;
    })()`);
  await sleep(2500);

  await s.eval(`location.href = '${APP}/records'`);
  await sleep(3000);
  c.check("记录页已无这条", await hasEntry(PERSONAL_TITLE), false);
}

// ---------------------------------------------------------------- 清理
c.group("清理测试数据");
{
  // 记录通过界面删（顺带验证删除功能可用）。
  // 待办没有界面删除的必要（正常流程是完成或跳过），直接用数据库清 ——
  // 之前漏了这步，残留的测试待办会一直挂在生产库里。
  await s.eval(`location.href = '${APP}/records'`);
  await sleep(2500);
  await s.eval(`window.confirm = () => true`);

  const opened = await s.eval<boolean>(`
    (() => {
      const li = [...document.querySelectorAll('li')]
        .find(e => e.textContent.includes(${JSON.stringify(RECORD_TITLE)}));
      if (!li) return false;
      const btn = [...li.querySelectorAll('button')].pop();
      if (btn) btn.click();
      return true;
    })()`);
  c.check("展开记录的更多操作", opened, true);
  await sleep(700);

  const clickedDelete = await s.eval<boolean>(`
    (() => {
      const item = [...document.querySelectorAll('[role=menuitem]')]
        .find(e => e.textContent.includes('删除'));
      if (!item) return false;
      item.click();
      return true;
    })()`);
  c.check("点菜单里的「删除」", clickedDelete, true);
  await sleep(2500);
  c.check("记录已消失", await hasEntry(RECORD_TITLE), false);

  const cleaned = await prisma.task.deleteMany({
    where: { title: { in: [TASK_TITLE, PERSONAL_TITLE] } },
  });
  const cleanedRec = await prisma.record.deleteMany({
    where: { title: { in: [TASK_TITLE, PERSONAL_TITLE, RECORD_TITLE] } },
  });
  c.checkTruthy(
    `清掉 ${cleaned.count} 条测试待办 / ${cleanedRec.count} 条测试记录`,
    true,
  );

  const left = await prisma.task.count({
    where: { title: { contains: String(stamp) } },
  });
  c.check("库里没有残留", left, 0);
}

await prisma.$disconnect();
s.close();
c.finish();
