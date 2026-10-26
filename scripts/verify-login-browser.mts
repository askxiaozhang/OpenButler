/**
 * 登录流程的浏览器验证。
 *
 * 为什么必须用浏览器：登录表单是 React 19 `useActionState` 的渐进增强形式，
 * HTML 里没有 action ID，提交依赖客户端运行时。用 curl 伪造 POST 测不了，
 * 而这段「表单 → Server Action → 跳转」的接线恰恰是用户碰到的第一件事。
 *
 * 运行：pnpm dev & + headless Edge，然后 npx tsx scripts/verify-login-browser.mts
 */
import {
  APP,
  Checker,
  clearCookies,
  fillScript,
  login,
  openTab,
  sleep,
  waitFor,
} from "./lib/cdp.mts";

const c = new Checker();

// 从环境变量读（cdp.mts 负责加载 .env.local）——
// 生产上线前把 seed 默认口令换过，硬编码的密码会让这里全部失败
const USER = process.env.VERIFY_USERNAME ?? "admin";
const PASS = process.env.VERIFY_PASSWORD ?? "";
if (!PASS) throw new Error("Set VERIFY_PASSWORD for your independent test account");

const s = await openTab(`${APP}/login`);

/** 打开登录页并等 React 注水完成。 */
async function freshLoginPage() {
  await clearCookies(s);
  await s.eval(`location.href = '${APP}/login'`);
  if (!(await waitFor(s, "document.getElementById('username')", 40_000))) {
    throw new Error("登录页没渲染出来");
  }
  await sleep(1500);
}

// ---------------------------------------------------------------- 错误密码
c.group("错误密码");
{
  await freshLoginPage();
  await s.eval(fillScript("username", USER));
  await s.eval(fillScript("password", "definitely-wrong-password"));
  await s.eval(`document.querySelector('form button[type=submit]').click()`);

  // 作用域限定在表单内 —— Next 的 next-route-announcer 也带 role=alert
  // 且内容为空，全局选会先命中它，断言拿到空字符串
  const ALERT = `form [role=alert]`;
  // 注意 waitFor 接的是 JS 表达式不是 CSS 选择器 ——
  // 直接传选择器会被包成 `!!(form [role=alert])`，那是语法错误
  c.check(
    "显示错误提示",
    await waitFor(s, `document.querySelector('${ALERT}')`, 10_000),
    true,
  );
  c.check(
    "  文案是人话",
    await s.eval<string>(`document.querySelector('${ALERT}')?.textContent ?? ''`),
    "用户名或密码不正确",
  );
  c.check("  仍停在登录页", await s.eval<string>("location.pathname"), "/login");
}

// ---------------------------------------------------------------- 正确密码
c.group("正确密码");
{
  if (!(await login(s, USER, PASS))) {
    console.error("用 VERIFY_PASSWORD 登录失败 —— 检查 .env.local 里的值是否与库里一致");
    process.exit(1);
  }
  c.check("跳转到首页", await s.eval<string>("location.pathname"), "/");

  const body = await s.eval<string>("document.body.innerText");
  c.checkTruthy("渲染出问候语", body.includes("你好"));
  c.checkTruthy("渲染出角色「猫咪」", body.includes("猫咪"));
  c.checkTruthy("渲染出角色「妈」", body.includes("妈"));
  c.checkTruthy("底部 Tab / 侧栏含「待办」", body.includes("待办"));
  c.checkTruthy("首页有 AI 管家输入框", body.includes("说点什么") || body.includes("猫咪今天掏耳朵了"));

  c.check(
    "会话 cookie 对 JS 不可见（HttpOnly）",
    await s.eval<string>(
      `document.cookie.includes('fn_session') ? 'visible' : 'not-visible-to-js'`,
    ),
    "not-visible-to-js",
  );

  await s.eval(`location.href = '${APP}/tasks'`);
  c.check("登录后可访问 /tasks", await waitFor(s, `location.pathname === '/tasks'`, 15_000), true);
}

// ---------------------------------------------------------------- 登出
c.group("登出");
{
  await s.eval(`location.href = '${APP}/settings'`);
  c.check(
    "设置页可访问",
    await waitFor(s, `document.body.innerText.includes('退出登录')`, 15_000),
    true,
  );

  await s.eval(
    `[...document.querySelectorAll('button')].find(b => b.textContent.includes('退出登录')).click()`,
  );
  c.check("登出后回到登录页", await waitFor(s, `location.pathname === '/login'`, 15_000), true);

  await s.eval(`location.href = '${APP}/tasks'`);
  c.check(
    "登出后 /tasks 被拦回登录页",
    await waitFor(s, `location.pathname === '/login'`, 15_000),
    true,
  );
}

// ---------------------------------------------------------------- PWA
c.group("PWA（可加到主屏）");
{
  await s.eval(`location.href = '${APP}/login'`);
  await sleep(1500);

  const hasManifest = await s.eval<boolean>(
    `!!document.querySelector('link[rel=manifest]')`,
  );
  c.check("页面声明了 manifest", hasManifest, true);

  const themeColor = await s.eval<string | null>(
    `document.querySelector('meta[name="theme-color"]')?.getAttribute('content') ?? null`,
  );
  c.check("声明了 theme-color（影响手机状态栏配色）", themeColor, "#0a0a0a");
}

s.close();
c.finish();