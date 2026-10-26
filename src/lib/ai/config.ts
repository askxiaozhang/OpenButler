/** DeepSeek 服务端配置。未填 key 时继续使用本地解析器和预填表单。 */
export function isAiEnabled(): boolean {
  if (process.env.AI_ENABLED === "false") return false;
  return Boolean(process.env.DEEPSEEK_API_KEY?.trim());
}

export const AI_MODEL = process.env.AI_MODEL?.trim() || "deepseek-flash";
export const DEEPSEEK_BASE_URL = "https://api.deepseek.com";

/**
 * 超时（毫秒）。
 *
 * 超时后立刻降级到正则解析，不让用户干等 —— 家庭的场景是「顺手记一下」，
 * 等 30 秒不如立刻给个能改的表单。
 */
const configuredTimeout = Number(process.env.AI_TIMEOUT_MS);
export const AI_TIMEOUT_MS =
  Number.isFinite(configuredTimeout) && configuredTimeout >= 1000 && configuredTimeout <= 30000
    ? configuredTimeout
    : 8000;

/** 模型最多走几步 tool call。解析任务够用，也是防跑飞的护栏。 */
export const AI_MAX_STEPS = 5;

/** 禁用时的原因，透传给 UI 好让话术准确。 */
export function disabledReason(): "NO_API_KEY" | "DISABLED" {
  return process.env.AI_ENABLED === "false" ? "DISABLED" : "NO_API_KEY";
}
