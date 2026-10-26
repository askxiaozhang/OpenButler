import type { AnchorOn, Freq } from "@/generated/prisma/client";
import type { DateOnly } from "@/lib/time";

/**
 * AI 管家与 UI 之间的**唯一契约**。
 *
 * ## 核心设计：AI 只出「计划」，不直接写库
 *
 * `interpret()` 是纯函数式的 —— 它把一句话变成一组 `IntakeAction` 提案，
 * 由用户确认后才走 `confirmIntake()` 落库。
 *
 * 为什么不让 AI 直接写：
 * - LLM 解析是非确定性的。把「妈」误判成「猫咪」然后**静默写进家庭记录**，
 *   信任一次就没了 —— 而且用户往往过很久才发现，那时已经分不清哪些是错的。
 * - 多一次点击的成本极低，体验上反而更像「管家在跟你确认」。
 * - tool executor 因此保持纯粹（不碰数据库、不做事务），整个模块可单元测试。
 *
 * ## 三条路径汇成一个入口
 *
 * AI 解析、正则快速解析、手动表单 —— 产出的都是同一个 `IntakeAction[]`，
 * 落库都走同一个 `confirmIntake()`。这是「没配 API key 时功能完全不受影响」的
 * 结构性保证：不是两条代码路径，是同一条路径的三个入口。
 */

export interface RoutineInput {
  title: string;
  freq: Exclude<Freq, "ONCE">;
  interval: number;
  anchorOn: AnchorOn;
  /** 首次发生日 */
  startOn: DateOnly;
  reminderTime?: string | null;
}

export type IntakeAction =
  | {
      type: "createRecord";
      subjectId: string | null;
      assigneeId: string | null;
      title: string;
      note?: string | null;
      occurredOn: DateOnly;
      /** 隐含的周期规则，比如「猫咪今天掏耳朵了（每 14 天）」 */
      followUp?: RoutineInput;
    }
  | {
      type: "createTask";
      subjectId: string | null;
      assigneeId: string | null;
      title: string;
      note?: string | null;
      dueOn: DateOnly;
      reminderTime?: string | null;
      /**
       * 隐含的周期规则。
       *
       * 之所以待办也带 followUp：说了「每月 1 号交物业费」但没提是给谁办的，
       * 就建不成周期项（周期项必须有归属角色）。这时保留周期信息、走待办路径，
       * 用户在确认卡片上补一个角色，`confirmIntake` 就会顺势把它升格成周期项。
       * 丢掉这层信息的话，用户说的「每月」就白说了。
       */
      followUp?: RoutineInput;
    }
  | {
      type: "createRoutines";
      subjectId: string;
      items: RoutineInput[];
    }
  | { type: "completeTask"; taskId: string; title: string }
  | { type: "reschedule"; taskId: string; title: string; dueOn: DateOnly };

/**
 * 降级原因。
 *
 * 必须细分到这一步，因为用户看到的话术完全不同：
 * 「还没配 key」是要去设置，「key 配错了」是要排查，「没听懂」是要换个说法。
 * 笼统地报「AI 不可用」会让人无从下手。
 */
export type FallbackReason =
  | "NO_API_KEY" // 没配 DEEPSEEK_API_KEY
  | "DISABLED" // AI_ENABLED=false
  | "TIMEOUT" // 模型响应太慢
  | "ERROR" // 模型挂了 / 接口限流 / key 配错
  | "NO_ACTIONS"; // AI 跑通了但没解析出任何东西

/**
 * 降级时给客户端的手动表单预填载荷。
 *
 * 这是「永远不会出现死路」的具体含义：即使 AI 完全不可用，
 * 用户拿到的也是一张**已经填好一部分**的表单，而不是空表单。
 */
export interface ManualDraft {
  /** 用户的原话，保留下来方便对照 */
  rawText: string;
  kind: "record" | "task";
  title: string;
  subjectId: string | null;
  assigneeId: string | null;
  date: DateOnly;
  reminderTime?: string | null;
  routine?: RoutineInput;
}

export type IntakeResult =
  | {
      ok: true;
      /** 哪个路径解析出来的 —— 用于诊断，也用于在 UI 上给出不同的措辞 */
      source: "ai" | "rules";
      actions: IntakeAction[];
      /** 给用户看的一句话复述：「记录『掏耳朵』· 归属 猫咪 · 14 天后提醒」 */
      summary: string;
      usedModel?: string;
      /**
       * 有值时表示：AI 本来该干活但失败了，这份结果是本地解析器顶上的。
       *
       * 区分「AI 解析的」和「AI 挂了、本地顶上的」很重要 —— 后者要让用户
       * 知道确认前多看一眼，也让「为什么没走 AI」这件事有迹可循。
       */
      degraded?: FallbackReason;
    }
  | {
      ok: false;
      source: "none";
      reason: FallbackReason;
      draft: ManualDraft;
      message: string;
    };

/** 解析时需要的角色信息（由调用方查好传进来，避免在解析器里查库）。 */
export interface MemberRef {
  id: string;
  name: string;
  aliases: string[];
  kind: "PERSON" | "PET";
}

/** 降级原因的默认话术。 */
export function fallbackMessage(reason: FallbackReason): string {
  switch (reason) {
    case "NO_API_KEY":
      return "AI 管家还没启用（未配置模型），已按你的话自动填好表单，确认一下就行。";
    case "DISABLED":
      return "AI 管家已关闭，已按你的话自动填好表单，确认一下就行。";
    case "TIMEOUT":
      return "AI 响应太慢，已先用本地的理解填好表单。";
    case "ERROR":
      return "AI 暂时不可用，已先用本地的理解填好表单。";
    case "NO_ACTIONS":
      return "没太听懂这句话，已按字面意思填好表单，你可以改一改。";
  }
}