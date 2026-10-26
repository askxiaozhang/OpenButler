import { describe, expect, it } from "vitest";
import { readBootstrapAccount } from "./bootstrap";

describe("administrator bootstrap", () => {
  it("requires an owner-provided password instead of a shared default", () => {
    expect(() => readBootstrapAccount({})).toThrow("Invalid SEED_*");
    expect(() => readBootstrapAccount({ SEED_PASSWORD: "short" })).toThrow();
  });
  it("accepts only explicit strong-length credentials without including secrets in errors", () => {
    const password = "example-only-password";
    expect(readBootstrapAccount({ SEED_PASSWORD: password })).toEqual({ username: "admin", displayName: "管理员", password });
    expect(() => readBootstrapAccount({ SEED_USERNAME: "invalid user", SEED_PASSWORD: password })).toThrow(/^Invalid SEED_\*/);
  });
});
