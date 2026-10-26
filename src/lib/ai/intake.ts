import { runIntake, TimeoutError } from "./agent";
import { AI_MODEL, disabledReason, isAiEnabled } from "./config";
import { buildDraft, buildSummary, quickParse } from "./quick-parse";
import { fallbackMessage, type IntakeResult, type MemberRef } from "./types";
import type { DateOnly } from "@/lib/time";

/**
 * AI 管家的**唯一对外门面**。UI 只调 `interpret()`，不直接碰 agent 或 quick-parse。
 *
 * ## 契约：永远返回可用结果，永不抛错给 UI
 *
 * 四层兜底，每一层都落到正则解析器，并且都产出一个**预填好的表单草稿**：
 *
 * 1. 没配 key / 明确关掉  → 直接走正则
 * 2. 超时                → 走正则，话术说明是超时
 * 3. 报错（模型挂/接口限流/key 配错）→ 走正则，话术说明不可用
 * 4. AI 跑通但没解析出东西 → 走正则
 *
 * 只判断「key 存不存在」是不够的 —— key 配错、模型下线、接口限流都会让
 * 请求失败，而这些恰恰是用户最难自己排查的情况。所以每一层都要兜住，
 * 并且把原因一路透传到 UI。
 */
export async function interpret(input: {
  text: string;
  /** 「今天」，由 Server Component 传入 */
  today: DateOnly;
  members: MemberRef[];
}): Promise<IntakeResult> {
  const { text, today, members } = input;

  /**
   * 降级到手动表单。
   *
   * 只在正则也解析不出东西时才走到这里 —— 正则能解析的话，用它比给用户
   * 一张单条表单好得多（「猫咪每月一次掏耳朵、剃屁股毛、剪指甲」正则能
   * 一次建 4 条周期项，丢掉可惜）。
   */
  const rules = (reason: Parameters<typeof fallbackMessage>[0]): IntakeResult => ({
    ok: false,
    source: "none",
    reason,
    draft: buildDraft({ text, members, today }),
    message: fallbackMessage(reason),
  });

  if (!isAiEnabled()) {
    return rules(disabledReason());
  }

  // 空输入没必要打扰模型
  if (!text.trim()) {
    return rules("NO_ACTIONS");
  }

  try {
    const result = await runIntake({ text, today, members });
    const actions = result.collector.getActions();

    if (actions.length === 0) {
      // 模型跑通了但什么都没解析出来。有时候正则反而能认出来
      // （比如模型把「每14天」理解成了别的东西），所以仍然走一次正则，
      // 能救回来就用正则的结果。
      return fromRulesOr("NO_ACTIONS");
    }

    // 角色名没对上时，模型那句话的复述会不准，用本地生成的更可靠
    const summary = buildSummary(actions, members, today);

    return {
      ok: true,
      source: "ai",
      actions,
      summary: summary || result.text || "已解析",
      usedModel: AI_MODEL,
    };
  } catch (error) {
    // 结构化日志：key 配错、模型下线、账户余额不足这类问题用户自己很难查，
    // 服务端日志是他唯一的线索
    logAiFailure(error, { text, model: AI_MODEL });

    // 关键：AI 失败不等于要丢给用户一张空表单。正则解析器在这种句子上
    // 命中率不低，能用就用 —— 只是把失败原因一并带出去，让 UI 说明情况。
    return fromRulesOr(error instanceof TimeoutError ? "TIMEOUT" : "ERROR");
  }

  /**
   * AI 没给出结果时，用正则顶上；正则也不行才退回手动表单。
   *
   * 带 `degraded` 标记，UI 据此提示「AI 暂时不可用，用的是本地理解」。
   */
  function fromRulesOr(reason: Parameters<typeof fallbackMessage>[0]): IntakeResult {
    const fallback = quickParse({ text, members, today });
    // recognized 为 false 说明正则也只是照抄了原话，不算解析成功 ——
    // 这时给确认卡片反而误导，老实用手动表单
    if (fallback.ok && fallback.actions.length > 0 && fallback.recognized) {
      return { ...fallback, degraded: reason };
    }
    return rules(reason);
  }
}

function logAiFailure(error: unknown, context: { text: string; model: string }) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(
    `[ai.intake] ${error instanceof Error ? error.name : "Error"}: ${message}`,
    { model: context.model, inputLength: context.text.length },
  );
}