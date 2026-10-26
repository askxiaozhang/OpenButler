import { randomUUID } from "node:crypto";
import { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { clockTimeFrom, formatZh, minutesAfter, nowInstant, toDateOnly } from "@/lib/time";
import { QqApiError, sendQqGroupMessage } from "./official";

export function isQqConfigured(): boolean {
  return Boolean(process.env.QQ_BOT_APP_ID?.trim() && process.env.QQ_BOT_APP_SECRET?.trim());
}

export function qqReminderError(error: unknown): string {
  if (error instanceof QqApiError) {
    switch (error.code) {
      case 40034105:
        return "QQ 拒绝主动消息（40034105）。请由群主或管理员在 QQ 群机器人管理中开启主动消息/主动发言，并检查开放平台权限，再点击测试。";
      case 40054002:
        return "机器人在群内被禁言（40054002），请解除禁言后重新测试。";
      case 11255:
        return "机器人已无法访问该群（11255），请重新加群并绑定。";
      case 22009:
        return "QQ 消息发送超频（22009），请稍后重试。";
      case 40034090:
        return "QQ 拒绝 Markdown 消息（40034090），请检查开放平台的 Markdown 消息权限，群成员 @ 需要此消息格式。";
      default:
        return `QQ 消息发送失败（${error.code ?? error.status}），请稍后重试。`;
    }
  }
  return "QQ 暂时无法连接，请稍后重试。";
}

/** 测试成功才启用；只允许操作当前账号拥有的绑定。 */
export async function setQqGroupReminders(userId: string, bindingId: string, enabled: boolean) {
  const binding = await db().qqBinding.findFirst({ where: { id: bindingId, userId } });
  if (!binding?.groupId) return { ok: false as const, error: "这个群连接不存在" };
  if (!enabled) {
    await db().qqBinding.updateMany({
      where: { id: bindingId, userId }, data: { remindersEnabled: false, remindersEnabledAt: null },
    });
    return { ok: true as const };
  }
  if (!isQqConfigured()) return { ok: false as const, error: "服务器还没有配置 QQ 机器人" };
  try {
    await sendQqGroupMessage(binding.groupId,
      "家庭管家：主动提醒已连接。之后，家庭中设置了具体提醒时间的待办会在到点时发送到本群，手机通知也会继续发送。");
    await db().qqBinding.updateMany({
      where: { id: bindingId, userId },
      data: {
        remindersEnabled: true, remindersEnabledAt: nowInstant(),
        reminderLastError: null, reminderLastSentAt: nowInstant(),
      },
    });
    return { ok: true as const };
  } catch (error) {
    const message = qqReminderError(error);
    await db().qqBinding.updateMany({
      where: { id: bindingId, userId },
      data: { remindersEnabled: false, reminderLastError: message },
    });
    return { ok: false as const, error: message };
  }
}

interface ReminderTask {
  id: string;
  title: string;
  dueOn: Date;
  reminderAt: Date;
  subject: { name: string } | null;
  assignee: { id: string; name: string } | null;
}

/** 与浏览器通知独立投递。权限失败暂停该群，不反复重试。 */
export async function sendQqTaskReminder(task: ReminderTask): Promise<void> {
  if (!isQqConfigured()) return;
  const bindings = await db().qqBinding.findMany({
    where: {
      groupId: { not: null }, remindersEnabled: true,
      remindersEnabledAt: { lte: task.reminderAt }, user: { active: true },
    },
    distinct: ["groupId"],
    select: { groupId: true },
  });
  let failed = false;
  for (const binding of bindings) {
    const groupId = binding.groupId!;
    const claimToken = randomUUID();
    const leaseUntil = minutesAfter(nowInstant(), 2);
    let deliveryId: string;
    try {
      const created = await db().qqReminderDelivery.create({
        data: { groupId, taskId: task.id, reminderAt: task.reminderAt, claimToken, leaseUntil },
      });
      deliveryId = created.id;
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") throw error;
      const existing = await db().qqReminderDelivery.findUniqueOrThrow({
        where: { groupId_taskId_reminderAt: { groupId, taskId: task.id, reminderAt: task.reminderAt } },
      });
      if (existing.sentAt) continue;
      const reclaimed = await db().qqReminderDelivery.updateMany({
        where: { id: existing.id, sentAt: null, leaseUntil: { lt: nowInstant() } },
        data: { claimToken, leaseUntil },
      });
      if (!reclaimed.count) { failed = true; continue; }
      deliveryId = existing.id;
    }
    // 发前再检查：用户可能刚完成待办或关闭了群提醒。
    const [pending, enabled] = await Promise.all([
      db().task.count({ where: { id: task.id, status: "PENDING", reminderAt: task.reminderAt } }),
      db().qqBinding.count({ where: { groupId, remindersEnabled: true, user: { active: true } } }),
    ]);
    if (!pending || !enabled) {
      await db().qqReminderDelivery.deleteMany({ where: { id: deliveryId, claimToken } });
      continue;
    }
    try {
      const mentionOpenId = await findAssigneeQqOpenId(groupId, task.assignee?.id);
      const text = buildQqReminderText(task, mentionOpenId);
      if (mentionOpenId) {
        await sendQqGroupMessage(groupId, text, { markdown: true });
      } else {
        await sendQqGroupMessage(groupId, text);
      }
      await db().qqReminderDelivery.updateMany({
        where: { id: deliveryId, claimToken }, data: { sentAt: nowInstant() },
      });
      await db().qqBinding.updateMany({
        where: { groupId, remindersEnabled: true }, data: { reminderLastSentAt: nowInstant(), reminderLastError: null },
      });
    } catch (error) {
      await db().qqReminderDelivery.deleteMany({ where: { id: deliveryId, claimToken, sentAt: null } });
      const terminal = error instanceof QqApiError && [40034105, 40054002, 11255].includes(error.code ?? 0);
      await db().qqBinding.updateMany({
        where: { groupId, remindersEnabled: true },
        data: { reminderLastError: qqReminderError(error), ...(terminal ? { remindersEnabled: false } : {}) },
      });
      if (!terminal) failed = true;
    }
  }
  if (failed) throw new Error("部分 QQ 群提醒尚未发送，等待重试");
}

/** QQ 成员标识按群隔离：其他群或私聊的绑定不能拿来 @。 */
export async function findAssigneeQqOpenId(groupId: string, memberId?: string): Promise<string | null> {
  if (!memberId) return null;
  const binding = await db().qqBinding.findFirst({
    where: {
      groupId,
      user: { active: true, memberId, member: { archivedAt: null } },
    },
    orderBy: { createdAt: "desc" },
    select: { openId: true },
  });
  // 只允许服务端保存的 OpenID 进入 QQ 标签属性；无有效绑定时正常发送文字。
  return binding && /^[A-Za-z0-9_-]{1,128}$/.test(binding.openId) ? binding.openId : null;
}

export function buildQqReminderText(task: ReminderTask, mentionOpenId: string | null = null): string {
  const owner = task.assignee?.name ?? task.subject?.name;
  const mention = mentionOpenId && /^[A-Za-z0-9_-]{1,128}$/.test(mentionOpenId) ? `<qqbot-at-user id="${mentionOpenId}" /> ` : "";
  return `家庭管家 · 到点提醒\n${formatZh(toDateOnly(task.dueOn))} ${clockTimeFrom(task.reminderAt)}\n${mention}${owner ? `${owner}：` : ""}${task.title}\n\n办好后可以打开家庭管家标记完成。`;
}
