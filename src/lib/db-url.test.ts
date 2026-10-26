import { afterEach, describe, expect, it, vi } from "vitest";
import { directDatabaseUrl, pooledDatabaseUrl, sslConfig } from "./db-url";
afterEach(() => vi.unstubAllEnvs());
describe("self-hosted database configuration", () => {
  it("ignores empty template values and uses the owner's configured URL", () => {
    vi.stubEnv("POSTGRES_PRISMA_URL", ""); vi.stubEnv("POSTGRES_URL", "");
    vi.stubEnv("DATABASE_URL", "owner-configured-runtime");
    vi.stubEnv("POSTGRES_URL_NON_POOLING", ""); vi.stubEnv("DATABASE_URL_UNPOOLED", "owner-configured-migrations");
    expect(pooledDatabaseUrl()).toBe("owner-configured-runtime");
    expect(directDatabaseUrl()).toBe("owner-configured-migrations");
  });
  it("verifies remote certificates by default and keeps loopback connections local", () => {
    vi.stubEnv("PG_CA_CERT", ""); vi.stubEnv("PG_TLS_REJECT_UNAUTHORIZED", "true");
    expect(sslConfig("postgresql://remote.example.com/app")).toEqual({ rejectUnauthorized: true });
    expect(sslConfig("postgresql://user@localhost:5432/app")).toBe(false);
  });
});
