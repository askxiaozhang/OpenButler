import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const input = { text: "明天买牛奶", today: "2026-09-15", members: [] };

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv("DEEPSEEK_API_KEY", "test-key");
  vi.stubEnv("AI_MODEL", "deepseek-flash");
  vi.stubEnv("AI_ENABLED", "true");
  vi.stubEnv("AI_TIMEOUT_MS", "1000");
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function completion(message: object, finishReason: string) {
  return Response.json({
    id: "chat-test", object: "chat.completion", created: 1, model: "deepseek-flash",
    choices: [{ index: 0, message, finish_reason: finishReason }],
    usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
  });
}

describe("DeepSeek intake integration", () => {
  it("sends authenticated requests directly to DeepSeek and collects a tool proposal", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(completion({
        role: "assistant", content: null,
        tool_calls: [{ id: "call-1", type: "function", function: {
          name: "createTask", arguments: JSON.stringify({ title: "买牛奶", dueOn: "2026-09-16" }),
        } }],
      }, "tool_calls"))
      .mockResolvedValueOnce(completion({ role: "assistant", content: "已整理" }, "stop"));
    vi.stubGlobal("fetch", fetchMock);
    const { interpret } = await import("./intake");
    const result = await interpret(input);
    expect(result).toMatchObject({ ok: true, source: "ai", usedModel: "deepseek-flash",
      actions: [{ type: "createTask", title: "买牛奶", dueOn: "2026-09-16" }] });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    for (const [url, request] of fetchMock.mock.calls) {
      expect(url).toBe("https://api.deepseek.com/chat/completions");
      expect(new Headers(request.headers).get("authorization")).toBe("Bearer test-key");
      expect(JSON.parse(request.body)).toMatchObject({ model: "deepseek-flash", thinking: { type: "disabled" } });
    }
  });

  it("does not treat Vercel credentials as a DeepSeek key", async () => {
    vi.stubEnv("DEEPSEEK_API_KEY", " ");
    vi.stubEnv("VERCEL_OIDC_TOKEN", "legacy-token");
    vi.stubEnv("AI_GATEWAY_API_KEY", "legacy-key");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { interpret } = await import("./intake");
    expect(await interpret(input)).toMatchObject({ reason: "NO_API_KEY", draft: { rawText: input.text } });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("falls back after API rejection without retrying", async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json(
      { error: { message: "Rate limit", type: "rate_limit_error", code: "rate_limit" } }, { status: 429 },
    ));
    vi.stubGlobal("fetch", fetchMock);
    const { interpret } = await import("./intake");
    const result = await interpret(input);
    expect(result.ok ? result.degraded : result.reason).toBe("ERROR");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("cancels an in-flight request at the deadline and returns a timeout fallback", async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    vi.stubGlobal("fetch", vi.fn((_url, request) => {
      signal = request.signal;
      return new Promise((_resolve, reject) => {
        signal?.addEventListener("abort", () => reject(signal?.reason), { once: true });
      });
    }));
    const { interpret } = await import("./intake");
    const pending = interpret(input);
    await vi.advanceTimersByTimeAsync(1001);
    const result = await pending;
    expect(signal?.aborted).toBe(true);
    expect(result.ok ? result.degraded : result.reason).toBe("TIMEOUT");
  });

  it.each(["", "NaN", "-1", "0", "999999", "Infinity"])("bounds invalid timeout %s", async (value) => {
    vi.stubEnv("AI_TIMEOUT_MS", value);
    const { AI_TIMEOUT_MS } = await import("./config");
    expect(AI_TIMEOUT_MS).toBe(8000);
  });
});

it("preserves the model's explicit reminder clock time in the confirmation proposal", async () => {
  vi.stubGlobal("fetch", vi.fn()
    .mockResolvedValueOnce(completion({role:"assistant",content:null,tool_calls:[{
      id:"timed-1",type:"function",function:{name:"createTask",arguments:JSON.stringify({
        title:"取快递",dueOn:"2026-09-16",reminderTime:"15:30",
      })},
    }]},"tool_calls"))
    .mockResolvedValueOnce(completion({role:"assistant",content:"已整理"},"stop")));
  const {interpret} = await import("./intake");
  const result = await interpret({...input,text:"明天下午三点半提醒我取快递"});
  expect(result).toMatchObject({ok:true,source:"ai",actions:[{dueOn:"2026-09-16",reminderTime:"15:30"}]});
  if (result.ok) expect(result.summary).toContain("15:30 提醒");
});
