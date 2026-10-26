import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@/generated/prisma/client";
import { fromDateOnly, reminderInstant } from "@/lib/time";

const mock = vi.hoisted(() => ({
  groups: vi.fn(), binding: vi.fn(), updateBinding: vi.fn(), enabled: vi.fn(), pending: vi.fn(),
  create: vi.fn(), existing: vi.fn(), claim: vi.fn(), remove: vi.fn(), send: vi.fn(),
}));
vi.mock("@/lib/db", () => ({db:() => ({
  qqBinding: {findMany:mock.groups,findFirst:mock.binding,updateMany:mock.updateBinding,count:mock.enabled},
  qqReminderDelivery: {create:mock.create,findUniqueOrThrow:mock.existing,updateMany:mock.claim,deleteMany:mock.remove},
  task: {count:mock.pending},
})}));
vi.mock("./official", () => ({
  sendQqGroupMessage: mock.send,
  QqApiError: class QqApiError extends Error {
    constructor(public status: number, public code:number|null){super("QQ error");}
  },
}));
import { QqApiError } from "./official";
import { buildQqReminderText, findAssigneeQqOpenId, sendQqTaskReminder, setQqGroupReminders } from "./reminders";

const task = {id:"task1",title:"取快递",dueOn:fromDateOnly("2026-10-20"),reminderAt:reminderInstant("2026-10-20","15:00")!,subject:null,assignee:null};
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("QQ_BOT_APP_ID","test-id");vi.stubEnv("QQ_BOT_APP_SECRET","test-secret");
  mock.groups.mockResolvedValue([{groupId:"group1"}]);
  mock.binding.mockResolvedValue({id:"binding1",groupId:"group1"});
  mock.create.mockResolvedValue({id:"delivery1"});
  mock.enabled.mockResolvedValue(1);mock.pending.mockResolvedValue(1);
  mock.send.mockResolvedValue(undefined);mock.claim.mockResolvedValue({count:1});
});

describe("QQ group timed reminders", () => {
  it("sends only to enabled, active bound groups and records success", async () => {
    await sendQqTaskReminder(task);
    expect(mock.groups.mock.calls[0][0]).toMatchObject({
      where:{remindersEnabled:true,remindersEnabledAt:{lte:task.reminderAt},user:{active:true}},distinct:["groupId"],
    });
    expect(mock.send).toHaveBeenCalledWith("group1",expect.stringContaining("15:00"));
    expect(mock.claim.mock.calls[0][0].data).toHaveProperty("sentAt");
  });
  it("does not send a second time when the group delivery already succeeded", async () => {
    mock.create.mockRejectedValue(new Prisma.PrismaClientKnownRequestError("duplicate",{code:"P2002",clientVersion:"7"}));
    mock.existing.mockResolvedValue({id:"delivery1",sentAt:task.reminderAt});
    await sendQqTaskReminder(task);
    expect(mock.send).not.toHaveBeenCalled();
  });
  it("pauses groups denied proactive permission without an infinite retry loop", async () => {
    mock.send.mockRejectedValue(new QqApiError(400,40034105));
    await sendQqTaskReminder(task);
    expect(mock.updateBinding.mock.calls[0][0].data).toMatchObject({remindersEnabled:false,reminderLastError:expect.stringContaining("40034105")});
    expect(mock.remove).toHaveBeenCalled();
  });
  it("leaves transient failures for the next minute", async () => {
    mock.send.mockRejectedValue(new QqApiError(503,null));
    await expect(sendQqTaskReminder(task)).rejects.toThrow("等待重试");
    expect(mock.updateBinding.mock.calls[0][0].data).not.toHaveProperty("remindersEnabled");
  });
  it("does not enable a group if its actual test send is rejected", async () => {
    mock.send.mockRejectedValue(new QqApiError(400,40034105));
    const result=await setQqGroupReminders("user1","binding1",true);
    expect(mock.binding).toHaveBeenCalledWith({where:{id:"binding1",userId:"user1"}});
    expect(result).toMatchObject({ok:false,error:expect.stringContaining("40034105")});
  });
  it("does not send if the task was completed just before delivery", async () => {
    mock.pending.mockResolvedValue(0);
    await sendQqTaskReminder(task);
    expect(mock.send).not.toHaveBeenCalled();
  });
});


describe("QQ reminder mentions", () => {
  it("looks up only the assignee account binding in the destination group", async () => {
    mock.binding.mockResolvedValue({openId:"BABY_GROUP_OPENID"});
    await sendQqTaskReminder({...task,assignee:{id:"example-member",name:"示例成员"}});
    expect(mock.binding).toHaveBeenCalledWith({
      where:{groupId:"group1",user:{active:true,memberId:"example-member",member:{archivedAt:null}}},
      orderBy:{createdAt:"desc"},select:{openId:true},
    });
    expect(mock.send).toHaveBeenCalledWith("group1",expect.stringContaining('<qqbot-at-user id="BABY_GROUP_OPENID" />'),{markdown:true});
  });
  it("sends a normal reminder when the assignee is not bound in that group", async () => {
    mock.binding.mockResolvedValue(null);
    await sendQqTaskReminder({...task,assignee:{id:"example-member",name:"示例成员"}});
    expect(mock.send.mock.calls[0][1]).not.toContain("qqbot-at-user");
    expect(mock.send.mock.calls[0][1]).toContain("示例成员：取快递");
  });
  it("does not mention anyone just because the task is about them", async () => {
    await sendQqTaskReminder({...task,subject:{name:"示例成员"}});
    expect(mock.binding).not.toHaveBeenCalled();
    expect(mock.send.mock.calls[0][1]).not.toContain("qqbot-at-user");
  });
  it("does not allow malformed IDs to inject extra mention tags", async () => {
    mock.binding.mockResolvedValue({openId:'bad" /><qqbot-at-everyone /'});
    expect(await findAssigneeQqOpenId("group1","example-member")).toBeNull();
    expect(buildQqReminderText(task,'bad" /><qqbot-at-everyone /')).not.toContain("qqbot-at");
  });
});
