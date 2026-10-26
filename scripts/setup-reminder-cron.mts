/** 将分钟调度保存在现有 Supabase 中，不依赖电脑在线或 Vercel 付费计划。 */
import { config } from "dotenv";
config({ path: ".env.local", quiet: true });
import { db } from "../src/lib/db";

const secret = process.env.REMINDER_CRON_SECRET?.trim();
const appUrl = process.env.APP_URL?.replace(/\/$/, "");
if (!secret || !appUrl?.startsWith("https://")) throw new Error("缺少 REMINDER_CRON_SECRET 或 HTTPS APP_URL");
try {
  await db().$executeRawUnsafe('CREATE EXTENSION IF NOT EXISTS pg_cron');
  await db().$executeRawUnsafe('CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions');
  const rows = await db().$queryRaw<{ id: string }[]>`SELECT id::text FROM vault.secrets WHERE name = 'family_note_reminder_cron_secret'`;
  if (rows.length) {
    await db().$queryRaw`SELECT vault.update_secret(${rows[0].id}::uuid, ${secret}, 'family_note_reminder_cron_secret')::text`;
  } else {
    await db().$queryRaw`SELECT vault.create_secret(${secret}, 'family_note_reminder_cron_secret')::text`;
  }
  // URL 是公开部署地址；密钥由运行时读取 Vault，绝不写进 cron.job.command。
  const urlLiteral = `${appUrl}/api/cron/reminders`.replace(/'/g, "''");
  const command = `SELECT net.http_post(
    url := '${urlLiteral}',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization',
      'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'family_note_reminder_cron_secret')),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  ) WHERE EXISTS (
    SELECT 1 FROM public."Task" WHERE status = 'PENDING' AND "reminderAt" <= (now() AT TIME ZONE 'UTC') AND ("reminderSentAt" IS NULL OR "qqReminderSentAt" IS NULL)
  )`;
  await db().$queryRaw`SELECT cron.schedule('family-note-timed-reminders', '* * * * *', ${command})`;
  console.log('已启用 Supabase 每分钟提醒检查，只有存在到期提醒时才请求推送接口。');
} finally {
  await db().$disconnect();
}
