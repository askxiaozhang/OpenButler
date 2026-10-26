/**
 * 极简 CDP 客户端 —— 够用就好，不引入 puppeteer。
 *
 * 抽成模块是因为每个阶段的浏览器验证都要用同一套：开标签页、求值、等条件成立。
 * 复制四遍的话，改一处要改四处。
 *
 * 启动浏览器：
 *   "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge" \
 *     --headless=new --remote-debugging-port=9222 --remote-allow-origins='*' \
 *     --user-data-dir=/tmp/edge-test-profile about:blank &
 */

// 自己加载环境变量，这样任何 import 本模块的脚本都能拿到 VERIFY_PASSWORD，
// 不用每个脚本各自记得配一遍（漏配的表现是「登录失败」，很难联想到是缺变量）
import { config } from "dotenv";
config({ path: [".env.local", ".env"], quiet: true });

const CDP = process.env.CDP_URL ?? "http://localhost:9222";

export const APP = process.env.VERIFY_BASE_URL ?? "http://localhost:3000";

/** 极简断言。返回累计失败数由调用方决定怎么用。 */
export class Checker {
  failures = 0;
  #group = "";

  group(name: string) {
    this.#group = name;
    console.log(`\n── ${name} ──`);
  }

  check(label: string, actual: unknown, expected: unknown) {
    const ok = actual === expected;
    if (!ok) this.failures += 1;
    console.log(
      `${ok ? "✓" : ""} ${label}: ${fmt(actual)}${ok ? "" : ` (期望 ${fmt(expected)})`}`,
    );
  }

  checkTruthy(label: string, actual: unknown) {
    const ok = Boolean(actual);
    if (!ok) this.failures += 1;
    console.log(`${ok ? "✓" : "✗"} ${label}: ${fmt(actual)}`);
  }

  finish() {
    if (this.failures > 0) {
      console.error(`\n${this.failures} 项失败`);
      process.exit(1);
    }
    console.log("\n全部通过");
  }
}

function fmt(v: unknown): string {
  const s = JSON.stringify(v);
  return s === undefined ? String(v) : s.length > 160 ? `${s.slice(0, 157)}…` : s;
}

interface CdpTarget {
  id: string;
  webSocketDebuggerUrl: string;
}

let nextId = 1;

export class Session {
  private ws: WebSocket;
  private pending = new Map<number, (value: unknown) => void>();

  private constructor(ws: WebSocket) {
    this.ws = ws;
    ws.addEventListener("message", (event) => {
      const msg = JSON.parse(String(event.data)) as {
        id?: number;
        result?: unknown;
        error?: unknown;
      };
      if (msg.id != null && this.pending.has(msg.id)) {
        const resolve = this.pending.get(msg.id)!;
        this.pending.delete(msg.id);
        resolve(msg.error ? { __error: msg.error } : msg.result);
      }
    });
  }

  static async open(wsUrl: string): Promise<Session> {
    const ws = new WebSocket(wsUrl);
    await new Promise<void>((resolve, reject) => {
      ws.addEventListener("open", () => resolve(), { once: true });
      ws.addEventListener("error", () => reject(new Error("CDP 连接失败")), {
        once: true,
      });
    });
    const s = new Session(ws);
    await s.send("Runtime.enable");
    await s.send("Page.enable");
    await s.send("Network.enable");
    return s;
  }

  send(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
    const id = nextId++;
    return new Promise((resolve) => {
      this.pending.set(id, resolve);
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  /** 求值一个表达式并取回 JSON 结果。表达式抛错会向上抛。 */
  async eval<T>(expression: string): Promise<T> {
    const res = (await this.send("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true,
    })) as {
      result?: { value?: T };
      exceptionDetails?: { exception?: { description?: string } };
      __error?: unknown;
    };

    if (res.exceptionDetails) {
      throw new Error(
        res.exceptionDetails.exception?.description ?? "页面求值抛错",
      );
    }
    if (res.__error) throw new Error(JSON.stringify(res.__error));
    return res.result?.value as T;
  }

  close() {
    this.ws.close();
  }
}

/** 开新标签页并连上它。 */
export async function openTab(url: string): Promise<Session> {
  const res = await fetch(`${CDP}/json/new?${encodeURIComponent(url)}`, {
    method: "PUT",
  });
  if (!res.ok) throw new Error(`开标签页失败：${res.status}`);
  const target = (await res.json()) as CdpTarget;
  return Session.open(target.webSocketDebuggerUrl);
}

/** 轮询直到条件成立或超时。 */
export async function waitFor(
  session: Session,
  expression: string,
  timeoutMs = 10_000,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      if (await session.eval<boolean>(`!!(${expression})`)) return true;
    } catch {
      // 求值期间页面正在导航会抛错，忽略继续等
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  return false;
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * 往受控输入框里填值。
 *
 * 直接 `input.value = x` 不会触发 React 的 onChange —— React 在 input 元素上
 * 覆写了自己的 value setter 来追踪状态。必须拿到原生 setter 绕过它，
 * 再手动派发 input 事件，React 才会收到变更。
 *
 * 对 `<textarea>` 要用 HTMLTextAreaElement 的原型，原型拿错了会静默失效。
 */
export function fillScript(id: string, value: string): string {
  return `
(() => {
  const el = document.getElementById(${JSON.stringify(id)});
  if (!el) return false;
  const proto = el instanceof HTMLTextAreaElement
    ? window.HTMLTextAreaElement.prototype
    : window.HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
  setter.call(el, ${JSON.stringify(value)});
  el.dispatchEvent(new Event('input', { bubbles: true }));
  return true;
})()`;
}

/** 按可见文本点按钮/链接。 */
export function clickByText(text: string, selector = "button"): string {
  return `
(() => {
  const els = [...document.querySelectorAll(${JSON.stringify(selector)})];
  const el = els.find(e => (e.textContent || '').trim().includes(${JSON.stringify(text)}));
  if (!el) return false;
  el.click();
  return true;
})()`;
}

/** 清空浏览器 cookie，保证用例之间互不影响。 */
export async function clearCookies(session: Session) {
  await session.send("Network.clearBrowserCookies");
}

/**
 * 登录并等待跳转到首页。返回是否成功。
 *
 * 密码从环境变量读 —— 别硬编码。生产上线前会把 seed 的默认口令换掉，
 * 写死的值会让整套验证脚本在那之后全部失败（而且看起来像功能坏了，
 * 实际只是密码变了）。在 .env.local 里设 VERIFY_PASSWORD 即可。
 */
export async function login(
  session: Session,
  username = process.env.VERIFY_USERNAME ?? "admin",
  password = process.env.VERIFY_PASSWORD ?? "",
): Promise<boolean> {
  if (!password) throw new Error("Set VERIFY_PASSWORD for your independent test account");
  await clearCookies(session);
  await session.eval(`location.href = '${APP}/login'`);
  // 超时给得宽：dev server 冷启动时首屏要现编译，10 秒不够
  if (!(await waitFor(session, "document.getElementById('username')", 40_000))) {
    return false;
  }
  await sleep(1500); // 等 React 注水完成

  await session.eval(fillScript("username", username));
  await session.eval(fillScript("password", password));
  await session.eval(`document.querySelector('form button[type=submit]').click()`);

  return waitFor(session, `location.pathname === '/'`, 30_000);
}

/** 页面可见文本，用于内容断言。 */
export const bodyText = (session: Session) =>
  session.eval<string>("document.body.innerText");