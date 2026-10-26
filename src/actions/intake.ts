"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth/guard";
import { fail, ok, type ActionResult } from "@/lib/action-result";
import { interpret } from "@/lib/ai/intake";
import { applyIntakeActions } from "@/lib/ai/apply";
import type { IntakeAction, IntakeResult } from "@/lib/ai/types";
import { today } from "@/lib/time";

/**
 * AI 管家的两个入口。
 *
 * ## 为什么落库要拆成「解析」和「确认」两步
 *
 * LLM 解析是非确定性的。把「妈」误判成「猫咪」然后**静默写进家庭记录**，
 * 信任一次就没了 —— 而且用户往往过很久才发现，那时已经分不清哪些是错的。
 * 多一次点击成本极低，体验上反而更像「管家在跟你确认」。
 *
 * ## 为什么手动表单也走同一个 confirmIntake
 *
 * 这是「没配 API key 时功能完全不受影响」的**结构性**保证：
 * 不是两条代码路径，是同一条路径的两个入口。
 * AI 和降级表单产出的都是 `IntakeAction[]`，落库逻辑只有一份。
 */

export async function interpretAction(text: string): Promise<IntakeResult> {
  // 必须校验身份 —— Server Action 是可以被直接调用的 HTTP 端点
  await requireUser();

  const members = await db().member.findMany({
    where: { archivedAt: null },
    orderBy: { sortOrder: "asc" },
    select: { id: true, name: true, aliases: true, kind: true },
  });

  return interpret({
    text,
    // 服务端算「今天」—— 解析器不自己算日期（CLAUDE.md 纪律 1）
    today: today(),
    members,
  });
}

/** 用户在确认卡片上点了「就这样」。 */
export async function confirmIntake(
  actions: IntakeAction[],
): Promise<ActionResult<{ created: number }>> {
  const user = await requireUser();

  if (!Array.isArray(actions) || actions.length === 0) {
    return fail("没有要保存的内容");
  }

  // 上限保护：确认卡片最多也就几张，真收到几十条说明前端出了问题
  if (actions.length > 20) {
    return fail("一次最多处理 20 条");
  }

  try {
    const created = await applyIntakeActions(actions, user.id);
    revalidatePath("/", "layout");
    return ok({ created });
  } catch (e) {
    console.error("[confirmIntake]", e);
    return fail("保存失败，请稍后重试");
  }
}
