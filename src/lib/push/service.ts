import webpush from "web-push";
import { sendQqTaskReminder } from "@/lib/qq/reminders";
import { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { fromDateOnly, nowInstant, today, toDateOnly, clockTimeFrom } from "@/lib/time";
import type { DueItem, Notifier } from "@/lib/notify";

export interface BrowserPushSubscription {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

export function isWebPushConfigured(): boolean {
  return Boolean(
    process.env.WEB_PUSH_VAPID_PUBLIC_KEY?.trim() &&
      process.env.WEB_PUSH_VAPID_PRIVATE_KEY?.trim(),
  );
}

export async function savePushSubscription(
  userId: string,
  subscription: BrowserPushSubscription,
): Promise<void> {
  await db().pushSubscription.upsert({
    where: { endpoint: subscription.endpoint },
    create: {
      userId,
      endpoint: subscription.endpoint,
      p256dh: subscription.keys.p256dh,
      auth: subscription.keys.auth,
    },
    update: {
      userId,
      p256dh: subscription.keys.p256dh,
      auth: subscription.keys.auth,
      lastUsedAt: nowInstant(),
    },
  });
}

export async function removePushSubscription(userId: string, endpoint: string): Promise<void> {
  await db().pushSubscription.deleteMany({ where: { userId, endpoint } });
}

export async function sendTestPush(userId: string): Promise<number> {
  configureWebPush();
  const subscriptions = await db().pushSubscription.findMany({ where: { userId } });
  let sent = 0;
  for (const subscription of subscriptions) {
    try {
      await send(subscription, {
        title: "家庭管家通知已开启",
        body: "以后有到期待办，我会在这里提醒你。",
        tag: "family-note-test",
        url: "/tasks",
        badgeCount: 0,
      });
      sent += 1;
    } catch (error) {
      await handlePushFailure(subscription.id, error);
    }
  }
  return sent;
}

export const webPushNotifier: Notifier = {
  id: "web-push",
  isEnabled: isWebPushConfigured,
  send: sendDueTaskPush,
};

export function buildDuePushPayload(items: DueItem[], date = today()) {
  const labels = items.slice(0, 3).map((item) => {
    const owner = item.assigneeName ?? item.subjectName;
    return owner ? `${owner}：${item.title}` : item.title;
  });
  const remaining = Math.max(0, items.length - labels.length);
  return {
    title: items.length === 1 ? "有 1 项待办需要处理" : `有 ${items.length} 项待办需要处理`,
    body: `${labels.join("；")}${remaining ? `；另有 ${remaining} 项` : ""}`,
    tag: items.length === 1 ? `family-note-task-${items[0].taskId}-${date}` : `family-note-due-${date}`,
    url: "/tasks",
    badgeCount: items.length,
  };
}

async function sendDueTaskPush(items: DueItem[]): Promise<void> {
  configureWebPush();
  const sentOn = today();
  const subscriptions = await db().pushSubscription.findMany({ where: { user: { active: true } } });
  let failed = false;

  for (const subscription of subscriptions) {
    const claimed: string[] = [];
    const claimedItems: DueItem[] = [];
    for (const item of items) {
      try {
        const delivery = await db().pushDelivery.create({
          data: {
            subscriptionId: subscription.id,
            taskId: item.taskId,
            sentOn: fromDateOnly(sentOn),
          },
          select: { id: true },
        });
        claimed.push(delivery.id);
        claimedItems.push(item);
      } catch (error) {
        if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") {
          throw error;
        }
      }
    }
    if (!claimedItems.length) continue;

    try {
      await send(subscription, buildDuePushPayload(claimedItems, sentOn));
    } catch (error) {
      // 临时失败时释放幂等占位，让下一次 cron 可以重试。
      await db().pushDelivery.deleteMany({ where: { id: { in: claimed } } });
      failed = true;
      await handlePushFailure(subscription.id, error);
    }
  }
  if (failed) throw new Error("部分设备推送失败，等待调度重试");
}

/** 由分钟调度触发。逐设备去重成功后才标记任务，临时失败保留重试资格。 */
export async function sendTimedReminders(): Promise<{ processed: number }> {
  const tasks = await db().task.findMany({
    where: { status: "PENDING", reminderAt: { lte: nowInstant() }, OR: [{ reminderSentAt: null }, { qqReminderSentAt: null }] },
    include: { subject: true, assignee: true },
    orderBy: { reminderAt: "asc" },
    take: 100,
  });
  let processed = 0;
  let failed = false;
  for (const task of tasks) {
    const updates: { reminderSentAt?: Date; qqReminderSentAt?: Date } = {};
    if (!task.reminderSentAt) {
      try {
        if (isWebPushConfigured()) {
          await sendDueTaskPush([{
            taskId: task.id, title: `${clockTimeFrom(task.reminderAt!)} ${task.title}`,
            dueOn: toDateOnly(task.dueOn),
            subjectName: task.subject?.name ?? null, assigneeName: task.assignee?.name ?? null,
          }]);
        }
        updates.reminderSentAt = nowInstant();
      } catch { failed = true; }
    }
    if (!task.qqReminderSentAt) {
      try {
        await sendQqTaskReminder({ ...task, reminderAt: task.reminderAt! });
        updates.qqReminderSentAt = nowInstant();
      } catch { failed = true; }
    }
    if (Object.keys(updates).length) {
      await db().task.updateMany({
        where: { id: task.id, status: "PENDING", reminderAt: task.reminderAt },
        data: updates,
      });
    }
    processed += 1;
  }
  if (failed) throw new Error("部分提醒推送失败，等待下一分钟重试");
  return { processed };
}

function configureWebPush() {
  const publicKey = process.env.WEB_PUSH_VAPID_PUBLIC_KEY?.trim();
  const privateKey = process.env.WEB_PUSH_VAPID_PRIVATE_KEY?.trim();
  if (!publicKey || !privateKey) throw new Error("Web Push is not configured");
  const subject = process.env.WEB_PUSH_SUBJECT?.trim() || process.env.APP_URL?.trim();
  if (!subject) throw new Error("Configure your own WEB_PUSH_SUBJECT or APP_URL");
  webpush.setVapidDetails(
    subject,
    publicKey,
    privateKey,
  );
}

async function send(
  subscription: { endpoint: string; p256dh: string; auth: string },
  payload: ReturnType<typeof buildDuePushPayload>,
) {
  await webpush.sendNotification(
    {
      endpoint: subscription.endpoint,
      keys: { p256dh: subscription.p256dh, auth: subscription.auth },
    },
    JSON.stringify(payload),
    { TTL: 6 * 60 * 60, urgency: "normal" },
  );
}

async function handlePushFailure(subscriptionId: string, error: unknown) {
  const statusCode = (error as { statusCode?: unknown })?.statusCode;
  if (statusCode === 404 || statusCode === 410) {
    await db().pushSubscription.deleteMany({ where: { id: subscriptionId } });
    return;
  }
  console.error("[web-push]", {
    subscriptionId,
    statusCode: typeof statusCode === "number" ? statusCode : null,
    errorType: error instanceof Error ? error.name : "UnknownError",
  });
}
