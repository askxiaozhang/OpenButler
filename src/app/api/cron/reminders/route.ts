import { timingSafeEqual } from "node:crypto";
import { sendTimedReminders } from "@/lib/push/service";

export const runtime = "nodejs";
export const maxDuration = 60;

/** Supabase Cron 每分钟调用，签名密钥仅保存在服务器和数据库 Vault。 */
export async function POST(request: Request): Promise<Response> {
  const secret = process.env.REMINDER_CRON_SECRET?.trim();
  const actual = Buffer.from(request.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);
  if (!secret || actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    return Response.json({ ok: true, ...await sendTimedReminders() }, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    console.error("[cron.reminders]", { errorType: error instanceof Error ? error.name : "UnknownError" });
    return Response.json({ ok: false, error: "提醒推送失败，下一分钟重试" }, { status: 503 });
  }
}
