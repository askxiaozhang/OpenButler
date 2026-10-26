import { generateText, stepCountIs } from "ai";
import { createDeepSeek } from "@ai-sdk/deepseek";
import { ActionCollector } from "./collector";
import { buildSystemPrompt } from "./prompt";
import { buildTools } from "./tools";
import { AI_MAX_STEPS, AI_MODEL, AI_TIMEOUT_MS, DEEPSEEK_BASE_URL } from "./config";
import type { MemberRef } from "./types";
import type { DateOnly } from "@/lib/time";

/**
 * 跑一次 LLM 解析。
 *
 * 用 `generateText` + `stopWhen`，**不用 `ToolLoopAgent`** —— 后者是给
 * 可复用的对话式 agent 准备的（要配 useChat、要维护会话状态）。
 * 我们这里是一次性解析，一次调用就结束。将来真要做对话式管家时，
 * 把同一组 tool 包进 ToolLoopAgent 即可升级，tools.ts 不用动。
 *
 * API 备注（AI SDK 7 实测确认）：
 * - tool 定义用 `inputSchema`（v5 的 `parameters` 已被移除）
 * - 步数限制用 `stopWhen: stepCountIs(n)`（v5 的 `maxSteps` 已被移除）
 */

export class TimeoutError extends Error {
  constructor() {
    super(`AI 解析超过 ${AI_TIMEOUT_MS}ms`);
    this.name = "TimeoutError";
  }
}

export interface RunIntakeResult {
  collector: ActionCollector;
  /** 模型自己说的一句话，用于复述 */
  text: string;
  usedModel: string;
  steps: number;
}

export async function runIntake(input: {
  text: string;
  today: DateOnly;
  members: MemberRef[];
}): Promise<RunIntakeResult> {
  const collector = new ActionCollector(input.members);
  const tools = buildTools(collector, input.members, input.today);
  const deepseek = createDeepSeek({
    baseURL: DEEPSEEK_BASE_URL,
    apiKey: process.env.DEEPSEEK_API_KEY?.trim(),
  });
  const controller = new AbortController();

  const result = await withTimeout(
    generateText({
      model: deepseek(AI_MODEL),
      system: buildSystemPrompt({ today: input.today, members: input.members }),
      prompt: input.text,
      tools,
      stopWhen: stepCountIs(AI_MAX_STEPS),
      // 解析任务不需要创造力，压低温度让同样的输入得到同样的结果
      temperature: 0,
      providerOptions: { deepseek: { thinking: { type: "disabled" } } },
      // 交互式解析失败后直接降级，避免 SDK 重试延长等待。
      maxRetries: 0,
      abortSignal: controller.signal,
    }),
    AI_TIMEOUT_MS,
    controller,
  );

  return {
    collector,
    text: result.text,
    usedModel: AI_MODEL,
    steps: result.steps?.length ?? 0,
  };
}

/**
 * 给 promise 套一个超时。
 *
 * 必须显式超时而不是靠 fetch 的默认行为：接口卡住时默认要等很久，
 * 而用户只是想顺手记一句话。超时后立刻降级到正则解析，体验上几乎无感。
 */
function withTimeout<T>(promise: PromiseLike<T>, ms: number, controller: AbortController): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      const error = new TimeoutError();
      reject(error);
      controller.abort(error);
    }, ms);
    Promise.resolve(promise).then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}
