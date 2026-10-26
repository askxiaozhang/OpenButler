/**
 * 角色管理（阶段 2）的浏览器验证。
 *
 * 运行前需要 dev server + headless Edge：
 *   pnpm dev &
 *   "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge" \
 *     --headless=new --remote-debugging-port=9222 --remote-allow-origins='*' \
 *     --user-data-dir=/tmp/edge-test-profile about:blank &
 *   npx tsx scripts/verify-members.mts
 *
 * ⚠️ 两条踩过的坑，改这个脚本时别重蹈：
 *
 * 1. 等待条件必须等到「真实内容」。用 `innerText.includes('角色管理')` 会命中
 *    上一页或未渲染完的骨架，断言全变假阳性 —— 第一版就是这么骗过我的。
 * 2. 别断言绝对数量。上一次失败运行会在库里留下数据，绝对数量随即失真；
 *    改成「名字在不在、在已归档区之前还是之后」这类相对断言，才可重复运行。
 */
import {
  APP,
  Checker,
  clickByText,
  fillScript,
  login,
  openTab,
  sleep,
  waitFor,
} from "./lib/cdp.mts";

const c = new Checker();

// 名字带时间戳，跑一次建一个，不会撞唯一约束
const NAME = `测试宠${Date.now() % 100000}`;
const RENAMED = `${NAME}改名`;

const s = await openTab(`${APP}/login`);
if (!(await login(s))) {
  console.error("登录失败，后续无法进行");
  process.exit(1);
}

/** 导航到角色页并等到真实列表渲染出来。 */
async function gotoMembers() {
  await s.eval(`location.href = '${APP}/members'`);
  const ready = await waitFor(
    s,
    `document.querySelectorAll('li').length > 0`,
    15_000,
  );
  if (!ready) throw new Error("/members 没有渲染出角色列表");
  await sleep(400); // 等注水
}

/**
 * 判断某个角色是否处于「已归档」区。
 *
 * 靠名字与「已归档」标题在页面文本里的先后位置判断 —— 比数 li 数量稳，
 * 不受历史残留数据影响。
 */
async function archiveStateOf(name: string): Promise<"active" | "archived" | "absent"> {
  // 用「名字格」的精确文本比对，不用全文子串搜索 ——
  // 改名后的「测试宠41788改名」包含原名的子串，子串匹配会让「旧名字消失」
  // 这条断言永远失败（测试自己骗自己）。
  return s.eval<"active" | "archived" | "absent">(`
    (() => {
      const li = [...document.querySelectorAll('li')].find(row => {
        const nameEl = row.querySelector('p');
        return nameEl && nameEl.textContent.trim() === ${JSON.stringify(name)};
      });
      if (!li) return 'absent';
      const archivedSection = [...document.querySelectorAll('section')]
        .find(sec => sec.textContent.includes('已归档'));
      return (archivedSection && archivedSection.contains(li)) ? 'archived' : 'active';
    })()`);
}

/** 点某一行里的按钮。slot='edit' 取 dialog-trigger，'archive' 取最后一个。 */
function clickRowButton(name: string, slot: "edit" | "archive"): Promise<boolean> {
  return s.eval<boolean>(`
    (() => {
      const li = [...document.querySelectorAll('li')]
        .find(e => e.textContent.includes(${JSON.stringify(name)}));
      if (!li) return false;
      const btn = ${JSON.stringify(slot)} === 'edit'
        ? li.querySelector('[data-slot=dialog-trigger]')
        : [...li.querySelectorAll('button')].pop();
      if (!btn) return false;
      btn.click();
      return true;
    })()`);
}

/** 等对话框关闭。 */
const awaitDialogClosed = () =>
  waitFor(s, `!document.getElementById('member-name')`, 10_000);

// ---------------------------------------------------------------- 列表与分组
c.group("列表与分组");
{
  await gotoMembers();
  const text = await s.eval<string>("document.body.innerText");

  c.checkTruthy("含「人」分组", text.includes("👤 人"));
  c.checkTruthy("含「宠物」分组", text.includes(" 宠物"));
  c.checkTruthy("含种子角色「我」", text.includes("我"));
  c.checkTruthy("含种子角色「妈」", text.includes("妈"));
  c.checkTruthy("含种子角色「猫咪」", text.includes("猫咪"));
  c.checkTruthy("展示了「妈」的别名", text.includes("妈妈、老妈"));
  c.checkTruthy("展示了「猫咪」的别名", text.includes("猫、猫猫、主子"));

  // 作用域限定在 li 内 —— 标题栏的「添加角色」也是 dialog-trigger，不限定会数多
  c.check(
    "每个活跃角色都有编辑按钮",
    await s.eval(`document.querySelectorAll('li [data-slot=dialog-trigger]').length >= 3`),
    true,
  );
  c.check(
    "新建入口常驻标题栏（不依赖空状态）",
    await s.eval(
      `[...document.querySelectorAll('button')].some(b => b.textContent.includes('添加角色'))`,
    ),
    true,
  );
  c.check("测试角色此刻不存在", await archiveStateOf(NAME), "absent");
}

// ---------------------------------------------------------------- 新建
c.group("新建角色");
{
  await s.eval(clickByText("添加角色"));
  c.check("对话框打开", await waitFor(s, `document.getElementById('member-name')`), true);
  await sleep(400);

  await s.eval(fillScript("member-name", NAME));
  await s.eval(fillScript("member-aliases", "小测、测试"));

  // 类型按钮文本是「🐾 宠物」
  await s.eval(`
    (() => {
      const btn = [...document.querySelectorAll('button[type=button]')]
        .find(b => b.textContent.includes('宠物'));
      if (!btn) return false;
      btn.click();
      return true;
    })()`);
  await sleep(200);

  await s.eval(`document.querySelector('form button[type=submit]').click()`);
  c.check("提交后对话框关闭", await awaitDialogClosed(), true);
  await sleep(800);

  c.check("新角色已创建", await archiveStateOf(NAME), "active");
  c.check(
    "归到了「宠物」分组",
    await s.eval(`
      (() => {
        const sec = [...document.querySelectorAll('section')]
          .find(x => x.textContent.includes('宠物'));
        return !!sec && sec.textContent.includes(${JSON.stringify(NAME)});
      })()`),
    true,
  );
  c.checkTruthy(
    "别名已保存",
    await s.eval(`
      (() => {
        const li = [...document.querySelectorAll('li')]
          .find(e => e.textContent.includes(${JSON.stringify(NAME)}));
        return li?.textContent.includes('小测');
      })()`),
  );
}

// ---------------------------------------------------------------- 重名校验
c.group("重名校验（唯一约束要说人话，而不是漏出 Prisma 报错）");
{
  await s.eval(clickByText("添加角色"));
  await waitFor(s, `document.getElementById('member-name')`);
  await sleep(400);

  await s.eval(fillScript("member-name", "猫咪")); // 已存在
  await s.eval(`document.querySelector('form button[type=submit]').click()`);

  // 作用域限定在对话框内 —— Next 的 next-route-announcer 也带 role=alert
  const ALERT = `[role=dialog] [role=alert]`;
  c.check("显示了错误提示", await waitFor(s, `document.querySelector('${ALERT}')`, 8000), true);
  c.check(
    "  文案是人话",
    await s.eval<string>(`document.querySelector('${ALERT}')?.textContent ?? ''`),
    "这个名字已经被占用了",
  );
  c.check("  对话框保持打开以便修改", await s.eval(`!!document.getElementById('member-name')`), true);

  // 关窗
  await s.eval(`
    (() => {
      const btn = [...document.querySelectorAll('[role=dialog] button')]
        .find(b => (b.getAttribute('aria-label') || '').includes('关闭'));
      if (btn) { btn.click(); return 'clicked'; }
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      return 'escape';
    })()`);
  await sleep(800);
  c.check("对话框已关闭", await s.eval(`!document.getElementById('member-name')`), true);
}

// ---------------------------------------------------------------- 编辑
c.group("编辑角色");
{
  await gotoMembers();

  c.check("点开编辑对话框", await clickRowButton(NAME, "edit"), true);
  await waitFor(s, `document.getElementById('member-name')`);
  await sleep(500);

  c.check("预填了原名", await s.eval<string>(`document.getElementById('member-name').value`), NAME);
  c.check(
    "预填了别名",
    await s.eval<string>(`document.getElementById('member-aliases').value`),
    "小测、测试",
  );

  await s.eval(fillScript("member-name", RENAMED));
  await s.eval(`document.querySelector('form button[type=submit]').click()`);
  await awaitDialogClosed();
  await sleep(800);

  c.check("改名生效", await archiveStateOf(RENAMED), "active");
  c.check("旧名字消失", await archiveStateOf(NAME), "absent");
}

// ---------------------------------------------------------------- 归档与恢复
c.group("归档与恢复");
{
  await gotoMembers();
  // confirm() 会阻塞 headless 页面，打桩成「确定」
  await s.eval(`window.confirm = () => true`);

  c.check("点归档按钮", await clickRowButton(RENAMED, "archive"), true);
  await sleep(2800);

  c.check("归档后落入已归档区", await archiveStateOf(RENAMED), "archived");

  c.check("点恢复按钮", await s.eval(clickByText("恢复")), true);
  await sleep(2800);

  c.check("恢复后回到活跃区", await archiveStateOf(RENAMED), "active");
}

// ---------------------------------------------------------------- 排序
c.group("排序（同类型内上移/下移）");
{
  await gotoMembers();

  /**
   * 读页面上「人」这个分组里的顺序。
   *
   * ⚠️ 必须限定在分组内读 —— 界面是按「人 / 宠物」分组渲染的，
   * 全局读 li 的话，同类型内换了位置可能完全看不出来（跨组的部分掩盖了变化）。
   * 这也是「点下移没反应」那个 bug 的判据本身。
   */
  const peopleOrder = () =>
    s.eval<string[]>(`
      (() => {
        const sec = [...document.querySelectorAll('section')]
          .find(x => x.textContent.includes('人'));
        if (!sec) return [];
        return [...sec.querySelectorAll('li p:first-child')].map(p => p.textContent.trim());
      })()`);

  const before = await peopleOrder();
  c.checkTruthy("「人」分组里至少两个角色（否则无从排序）", before.length >= 2);

  c.check(
    "点第一行可用的「下移」",
    await s.eval(`
      (() => {
        const btn = [...document.querySelectorAll('button[aria-label="下移"]')]
          .find(b => !b.disabled);
        if (!btn) return false;
        btn.click();
        return true;
      })()`),
    true,
  );
  await sleep(2800);

  const after = await peopleOrder();
  c.checkTruthy(
    `顺序确实变了（${before.join(",")} → ${after.join(",")}）`,
    JSON.stringify(before) !== JSON.stringify(after),
  );

  // 压回原样，别污染后面的用例
  await s.eval(`
    (() => {
      const btn = [...document.querySelectorAll('button[aria-label="上移"]')]
        .find(b => !b.disabled);
      if (btn) btn.click();
      return true;
    })()`);
  await sleep(2500);

  const restored = await peopleOrder();
  c.checkTruthy("移回后恢复原顺序", JSON.stringify(restored) === JSON.stringify(before));
}

// ---------------------------------------------------------------- 清理
c.group("清理测试数据");
{
  await gotoMembers();
  await s.eval(`window.confirm = () => true`);
  await clickRowButton(RENAMED, "archive");
  await sleep(2800);
  c.check("测试角色已归档", await archiveStateOf(RENAMED), "archived");
}

s.close();
c.finish();