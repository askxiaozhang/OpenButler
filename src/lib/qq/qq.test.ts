import { describe, expect, it } from "vitest";
import { normalizeQqEvent } from "./official";
import { createQqChallenge, verifyQqSignature } from "./signature";

describe("QQ official webhook", () => {
  it("verifies the Ed25519 signature over timestamp + raw body", () => {
    const secret = "test-app-secret";
    const timestamp = "1789869600";
    const body = Buffer.from('{"op":0,"t":"C2C_MESSAGE_CREATE"}');
    const signature = createQqChallenge(secret, body.toString(), timestamp).signature;

    expect(
      verifyQqSignature({
        secret,
        timestamp,
        body,
        signature,
        nowMs: Number(timestamp) * 1000,
      }),
    ).toBe(true);
    expect(
      verifyQqSignature({
        secret,
        timestamp,
        body: Buffer.from("tampered"),
        signature,
        nowMs: Number(timestamp) * 1000,
      }),
    ).toBe(false);
  });

  it("rejects signatures outside the five minute replay window", () => {
    const secret = "test-app-secret";
    const timestamp = "1789869600";
    const body = Buffer.from("{}");
    const signature = createQqChallenge(secret, body.toString(), timestamp).signature;

    expect(
      verifyQqSignature({
        secret,
        timestamp,
        body,
        signature,
        nowMs: (Number(timestamp) + 301) * 1000,
      }),
    ).toBe(false);
  });

  it("normalizes private and group messages and removes the leading mention", () => {
    expect(
      normalizeQqEvent({
        op: 0,
        t: "C2C_MESSAGE_CREATE",
        d: { id: "m1", content: "今天记一笔", author: { user_openid: "u1" } },
      }),
    ).toMatchObject({ openId: "u1", groupId: null, messageId: "m1", text: "今天记一笔" });

    expect(
      normalizeQqEvent({
        op: 0,
        t: "GROUP_AT_MESSAGE_CREATE",
        d: {
          id: "m2",
          group_openid: "g1",
          content: " <@!bot> 猫咪今天剪指甲了",
          author: { member_openid: "member1" },
        },
      }),
    ).toMatchObject({
      openId: "member1",
      groupId: "g1",
      messageId: "m2",
      text: "猫咪今天剪指甲了",
    });
  });
});

it("uses proactive group messages without reusing any incoming message ID", async () => {
  const { vi } = await import("vitest");
  vi.stubEnv("QQ_BOT_APP_ID","test-app");
  vi.stubEnv("QQ_BOT_APP_SECRET","test-secret");
  const fetchMock=vi.fn()
    .mockResolvedValueOnce(Response.json({access_token:"test-token"}))
    .mockResolvedValueOnce(Response.json({id:"out1"}));
  vi.stubGlobal("fetch",fetchMock);
  try {
    const {sendQqGroupMessage}=await import("./official");
    await sendQqGroupMessage("group1","到点提醒");
    expect(fetchMock.mock.calls[1][0]).toContain("/v2/groups/group1/messages");
    const payload=JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(payload).toMatchObject({content:"到点提醒",msg_type:0});
    expect(payload).not.toHaveProperty("msg_id");
    expect(payload).not.toHaveProperty("event_id");
  }finally{vi.unstubAllGlobals();vi.unstubAllEnvs();}
});

it("sends group mentions in Markdown instead of a literal plain text tag", async () => {
  const { vi } = await import("vitest");
  vi.stubEnv("QQ_BOT_APP_ID", "test-app");
  vi.stubEnv("QQ_BOT_APP_SECRET", "test-secret");
  const fetchMock = vi.fn()
    .mockResolvedValueOnce(Response.json({ access_token: "test-token" }))
    .mockResolvedValueOnce(Response.json({ id: "out2" }));
  vi.stubGlobal("fetch", fetchMock);
  try {
    const { sendQqGroupMessage } = await import("./official");
    const text = '家庭管家 · 到点提醒\n<qqbot-at-user id="member1" /> 示例成员：记录日常事件';
    await sendQqGroupMessage("group1", text, { markdown: true });
    const payload = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(payload).toMatchObject({ msg_type: 2, markdown: { content: text } });
    expect(payload).not.toHaveProperty("content");
    expect(payload).not.toHaveProperty("msg_id");
    expect(payload).not.toHaveProperty("event_id");
  } finally { vi.unstubAllGlobals(); vi.unstubAllEnvs(); }
});
