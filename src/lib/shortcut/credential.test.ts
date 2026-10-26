import { describe, expect, it } from "vitest";
import {
  createShortcutToken,
  hashShortcutToken,
  readBearerToken,
  shortcutTokenHint,
} from "./credential";

describe("shortcut credential", () => {
  it("creates URL-safe high-entropy tokens", () => {
    const first = createShortcutToken();
    const second = createShortcutToken();
    expect(first).toMatch(/^fn[a-f0-9]{64}$/);
    expect(second).not.toBe(first);
    expect(hashShortcutToken(first)).toMatch(/^[a-f0-9]{64}$/);
    expect(shortcutTokenHint(first)).toBe(`${first.slice(0, 7)}…${first.slice(-4)}`);
  });

  it("accepts only a well-formed Bearer token", () => {
    const token = createShortcutToken();
    expect(readBearerToken(`Bearer ${token}`)).toBe(token);
    expect(readBearerToken(`bearer   ${token}`)).toBe(token);
    expect(readBearerToken(token)).toBeNull();
    expect(readBearerToken("Bearer fn_too-short")).toBeNull();
    expect(readBearerToken(null)).toBeNull();
  });
});
