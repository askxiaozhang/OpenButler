"use server";

import { z } from "zod";
import { fail, ok, type ActionResult } from "@/lib/action-result";
import { requireUser } from "@/lib/auth/guard";
import {
  isWebPushConfigured,
  removePushSubscription,
  savePushSubscription,
  sendTestPush,
} from "@/lib/push/service";

const subscriptionSchema = z.object({
  endpoint: z.string().url().max(4096),
  keys: z.object({
    p256dh: z.string().min(20).max(512),
    auth: z.string().min(8).max(256),
  }),
});

export async function savePushSubscriptionAction(input: unknown): Promise<ActionResult> {
  const user = await requireUser();
  if (!isWebPushConfigured()) return fail("服务器还没有配置通知推送");
  const parsed = subscriptionSchema.safeParse(input);
  if (!parsed.success) return fail("浏览器返回的通知订阅无效");
  try {
    await savePushSubscription(user.id, parsed.data);
    return ok();
  } catch (error) {
    console.error("[push.subscribe]", error);
    return fail("开启通知失败，请稍后重试");
  }
}

export async function removePushSubscriptionAction(endpoint: string): Promise<ActionResult> {
  const user = await requireUser();
  if (!endpoint || endpoint.length > 4096) return fail("通知订阅无效");
  try {
    await removePushSubscription(user.id, endpoint);
    return ok();
  } catch (error) {
    console.error("[push.unsubscribe]", error);
    return fail("关闭通知失败，请稍后重试");
  }
}

export async function sendTestPushAction(): Promise<ActionResult<{ sent: number }>> {
  const user = await requireUser();
  if (!isWebPushConfigured()) return fail("服务器还没有配置通知推送");
  try {
    const sent = await sendTestPush(user.id);
    return sent ? ok({ sent }) : fail("这台设备还没有开启通知");
  } catch (error) {
    console.error("[push.test]", error);
    return fail("测试通知发送失败，请稍后重试");
  }
}
