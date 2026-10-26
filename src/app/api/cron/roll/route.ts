import { NextResponse } from "next/server";
import { ensureGenerated } from "@/lib/recurrence/engine";
import { notifyDueTasks } from "@/lib/notify";
import { addDays, nowInstant, today } from "@/lib/time";

/**
 * 每天把周期实例的生成窗口往前滚。
 *
 * ## 这是加速器，不是正确性依赖
 *
 * 即使这个接口**从不被调用**，应用也是正确的 —— 所有读路径都会先调
 * `ensureGenerated()` 惰性补齐。cron 的作用只是让「早上打开就看到今天该做什么」
 * 这件事不需要用户先触发一次读取。
 *
 * 这个设计比「纯靠 cron 生成」好的地方在于：cron 挂了、超时了、Vercel 抽风了，
 * 用户完全无感。而纯 cron 方案一旦漏跑，那段时间的提醒就永久丢了。
 *
 * ## 为什么这是全项目唯一的 Route Handler
 *
 * Vercel Cron 只能打 URL，不能调 Server Action。其余所有数据变更都走
 * Server Actions（端到端类型安全，不用手写 fetch + 解析）。
 */

// 每天跑一次就够，不需要缓存
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  // Vercel Cron 会带上 CRON_SECRET 作为 Bearer token（配了的话）
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const startedAt = nowInstant();
  const todayStr = today();

  try {
    // 窗口前滚到 60 天后（ensureGenerated 内部会再和 HORIZON_DAYS 取小）
    const generated = await ensureGenerated(addDays(todayStr, 60));
    const notified = await notifyDueTasks(todayStr);

    const result = {
      ok: true,
      today: todayStr,
      generated,
      notified,
      ms: nowInstant().getTime() - startedAt.getTime(),
    };

    console.log("[cron/roll]", JSON.stringify(result));
    return NextResponse.json(result);
  } catch (e) {
    console.error("[cron/roll] 失败", e);
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "unknown" },
      { status: 500 },
    );
  }
}

function isAuthorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;

  if (!secret?.trim()) return false;

  const header = request.headers.get("authorization");
  return header === `Bearer ${secret}`;
}