import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { decodeSession, encodeSession } from "./session-token";

/**
 * 这些测试锁住的是安全属性，不是实现细节 —— 改动 session-token.ts 后
 * 若这里变红，说明签名保护被削弱了，不要调测试去迁就实现。
 */

const REAL_SECRET = "test-secret-for-unit-tests-only-do-not-use-in-prod";

beforeEach(() => {
  process.env.AUTH_SECRET = REAL_SECRET;
});

afterEach(() => {
  delete process.env.AUTH_SECRET;
});

describe("encodeSession / decodeSession 往返", () => {
  it("签发的令牌能解出自己的 userId", () => {
    const token = encodeSession("user-123");
    expect(decodeSession(token)?.userId).toBe("user-123");
  });

  it("未过期的令牌带一个未来的 exp", () => {
    const payload = decodeSession(encodeSession("u"));
    expect(payload!.exp).toBeGreaterThan(Math.floor(Date.now() / 1000));
  });
});

describe("签名保护", () => {
  it("篡改签名会被拒", () => {
    const token = encodeSession("user-123");
    const tampered = `${token.slice(0, -3)}AAA`;
    expect(decodeSession(tampered)).toBeNull();
  });

  it("篡改载荷但沿用旧签名会被拒（签名覆盖整个载荷）", () => {
    // 这是最关键的一条：若实现里只对 userId 单独签名、或没覆盖 exp，
    // 攻击者就能把 exp 改成很远的未来来续命。
    const token = encodeSession("user-123");
    const signature = token.slice(token.lastIndexOf(".") + 1);

    for (const forged of [
      { userId: "admin", exp: Math.floor(Date.now() / 1000) + 99999 },
      { userId: "user-123", exp: Math.floor(Date.now() / 1000) + 99999 },
      { userId: "user-123", exp: 1 },
    ]) {
      const body = Buffer.from(JSON.stringify(forged)).toString("base64url");
      expect(decodeSession(`${body}.${signature}`)).toBeNull();
    }
  });

  it("换个 AUTH_SECRET 签的令牌会被拒（签名确实用了密钥）", () => {
    const token = encodeSession("user-123");
    process.env.AUTH_SECRET = "a-completely-different-secret-for-unit-tests";
    expect(decodeSession(token)).toBeNull();
  });

  it("没有 AUTH_SECRET 时抛错而不是静默签出弱令牌", () => {
    delete process.env.AUTH_SECRET;
    expect(() => encodeSession("u")).toThrow(/AUTH_SECRET/);
  });

  it("拒绝过短的自配会话密钥", () => {
    process.env.AUTH_SECRET = "too-short";
    expect(() => encodeSession("u")).toThrow(/AUTH_SECRET/);
  });
});

describe("过期", () => {
  it("已过期的令牌被拒", () => {
    expect(decodeSession(encodeSession("u", -10))).toBeNull();
  });

  it("ttl 为 0 视为已过期", () => {
    expect(decodeSession(encodeSession("u", 0))).toBeNull();
  });

  it("长期有效的令牌能解出", () => {
    expect(decodeSession(encodeSession("u", 60 * 60 * 24 * 365))?.userId).toBe("u");
  });
});

describe("畸形输入不应抛错", () => {
  it("各种垃圾值一律返回 null", () => {
    for (const bad of [
      "",
      ".",
      "no-dot-at-all",
      ".onlysignature",
      "onlybody.",
      "中文.签名",
      "eyJhIjoxfQ.", // 载荷合法但签名为空
    ]) {
      expect(decodeSession(bad)).toBeNull();
    }
  });

  it("载荷不是合法 JSON 时返回 null", () => {
    const body = Buffer.from("not json at all").toString("base64url");
    const token = `${body}.${signForTest(body)}`;
    expect(decodeSession(token)).toBeNull();
  });

  it("载荷 JSON 合法但字段类型不对时返回 null", () => {
    for (const payload of [
      { userId: 123, exp: 9999999999 },
      { userId: "u", exp: "9999999999" },
      { exp: 9999999999 },
      { userId: "u" },
    ]) {
      const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
      const token = `${body}.${signForTest(body)}`;
      expect(decodeSession(token)).toBeNull();
    }
  });
});

/**
 * 用与实现相同的算法签一个 body，用于构造「签名合法但载荷畸形」的用例。
 *
 * 这里刻意复制实现里的算法：要测的正是「签名对但载荷错」时解码器的反应，
 * 直接调用实现自己的签函数会绕开验证路径，测试就失去意义了。
 */
function signForTest(body: string): string {
  return createHmac("sha256", REAL_SECRET).update(body).digest("base64url");
}
