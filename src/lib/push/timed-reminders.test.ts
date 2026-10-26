import { beforeEach, describe, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => ({
  tasks: vi.fn(), mark: vi.fn(), subscriptions: vi.fn(), claim: vi.fn(), release: vi.fn(),
  remove: vi.fn(), send: vi.fn(),
}));
vi.mock("@/lib/db", () => ({db: () => ({
  task: {findMany: mock.tasks, updateMany: mock.mark},
  pushSubscription: {findMany: mock.subscriptions, deleteMany: mock.remove},
  pushDelivery: {create: mock.claim, deleteMany: mock.release},
})}));
vi.mock("@/lib/qq/reminders", () => ({sendQqTaskReminder:vi.fn().mockResolvedValue(undefined)}));
vi.mock("web-push", () => ({default: {setVapidDetails: vi.fn(), sendNotification: mock.send}}));
import { sendTimedReminders } from "./service";
import { fromDateOnly, reminderInstant } from "@/lib/time";

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("WEB_PUSH_VAPID_PUBLIC_KEY", "test-public");
  vi.stubEnv("WEB_PUSH_VAPID_PRIVATE_KEY", "test-private");
  vi.stubEnv("WEB_PUSH_SUBJECT", "https://example.com");
  mock.tasks.mockResolvedValue([{
    id:"task1",title:"取快递",dueOn:fromDateOnly("2026-10-20"),
    reminderAt:reminderInstant("2026-10-20","15:00"),subject:null,assignee:null,
  }]);
  mock.subscriptions.mockResolvedValue([{id:"sub1",endpoint:"https://push.example.test",p256dh:"key",auth:"auth"}]);
  mock.claim.mockResolvedValue({id:"delivery1"});
  mock.send.mockResolvedValue({statusCode:201});
  mock.mark.mockResolvedValue({count:1});
});

describe("timed reminders", () => {
  it("queries only pending, due, unsent tasks and marks after delivery", async () => {
    expect(await sendTimedReminders()).toEqual({processed:1});
    expect(mock.tasks.mock.calls[0][0].where).toMatchObject({status:"PENDING",OR:[{reminderSentAt:null},{qqReminderSentAt:null}],reminderAt:{lte:expect.any(Date)}});
    expect(JSON.parse(mock.send.mock.calls[0][1]).body).toContain("15:00 取快递");
    expect(mock.mark).toHaveBeenCalledOnce();
    expect(mock.send.mock.invocationCallOrder[0]).toBeLessThan(mock.mark.mock.invocationCallOrder[0]);
  });
  it("releases failed delivery for retry without marking the task sent", async () => {
    mock.send.mockRejectedValue({statusCode:503});
    const log = vi.spyOn(console,"error").mockImplementation(() => {});
    await expect(sendTimedReminders()).rejects.toThrow("重试");
    expect(mock.release).toHaveBeenCalledWith({where:{id:{in:["delivery1"]}}});
    expect(mock.mark.mock.calls[0][0].data).not.toHaveProperty("reminderSentAt");
    expect(mock.mark.mock.calls[0][0].data).toHaveProperty("qqReminderSentAt");
    log.mockRestore();
  });
  it("does not send completed, future or already processed tasks returned by the filter", async () => {
    mock.tasks.mockResolvedValue([]);
    expect(await sendTimedReminders()).toEqual({processed:0});
    expect(mock.send).not.toHaveBeenCalled();
  });
});

it("QQ failure does not undo a successful browser push", async () => {
  const { sendQqTaskReminder }=await import("@/lib/qq/reminders");
  vi.mocked(sendQqTaskReminder).mockRejectedValueOnce(new Error("temporary QQ failure"));
  await expect(sendTimedReminders()).rejects.toThrow("重试");
  expect(mock.send).toHaveBeenCalledOnce();
  expect(mock.mark.mock.calls[0][0].data).toHaveProperty("reminderSentAt");
  expect(mock.mark.mock.calls[0][0].data).not.toHaveProperty("qqReminderSentAt");
});

it("retrying QQ does not resend a browser notification already delivered", async () => {
  mock.tasks.mockResolvedValue([{
    id:"task1",title:"取快递",dueOn:fromDateOnly("2026-10-20"),
    reminderAt:reminderInstant("2026-10-20","15:00"),subject:null,assignee:null,
    reminderSentAt:reminderInstant("2026-10-20","15:00"),qqReminderSentAt:null,
  }]);
  await sendTimedReminders();
  expect(mock.send).not.toHaveBeenCalled();
  expect(mock.mark.mock.calls[0][0].data).toHaveProperty("qqReminderSentAt");
});
