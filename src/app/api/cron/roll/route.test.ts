import { afterEach, describe, expect, it, vi } from "vitest";
const mocked = vi.hoisted(() => ({ generate: vi.fn(), notify: vi.fn() }));
vi.mock("@/lib/recurrence/engine", () => ({ ensureGenerated: mocked.generate }));
vi.mock("@/lib/notify", () => ({ notifyDueTasks: mocked.notify }));
import { GET } from "./route";
afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });
describe("daily scheduler configuration", () => {
  it("cannot trigger notifications when no scheduler token was configured", async () => {
    vi.stubEnv("CRON_SECRET", "");
    const response = await GET(new Request("https://example.com/api/cron/roll"));
    expect(response.status).toBe(401); expect(mocked.notify).not.toHaveBeenCalled(); expect(mocked.generate).not.toHaveBeenCalled();
  });
  it("rejects a caller with a different token", async () => {
    vi.stubEnv("CRON_SECRET", "configured-owner-token");
    const response = await GET(new Request("https://example.com/api/cron/roll", { headers: { authorization: "Bearer another-token" } }));
    expect(response.status).toBe(401); expect(mocked.notify).not.toHaveBeenCalled();
  });
});
