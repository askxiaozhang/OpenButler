import { db } from "@/lib/db";
import { entryInclude } from "@/lib/queries";
import { fromDateOnly, today, type DateOnly } from "@/lib/time";
import { webPushNotifier } from "@/lib/push/service";

/**
 * 提醒送达的扩展点。
 *
 * 第一版只做「站内待办 + 日历视图」—— 打开应用就能看到，零外部依赖。
 * 这个接口存在的意义是：将来加 Web Push / 微信机器人 / 邮件时，
 * **不用改数据模型，也不用改生成逻辑**，只要加一个 Notifier 实现塞进数组。
 *
 * `Recurrence.timeOfDay` 和 `Task.dueOn` 已经在库里了，推送需要的信息都齐。
 */

export interface Notifier {
  id: string;
  isEnabled(): boolean;
  send(items: DueItem[]): Promise<void>;
}

export interface DueItem {
  taskId: string;
  title: string;
  dueOn: DateOnly;
  subjectName: string | null;
  assigneeName: string | null;
}

/**
 * 站内提醒（空实现）。
 *
 * 它什么都不做 —— 因为「站内提醒」的送达方式就是「待办列表里能看到它」，
 * 而列表是读时实时查的，不需要推送。放在这里是为了让 notifiers 数组
 * 不是空的，将来的实现有个参照。
 */
export const inAppNotifier: Notifier = {
  id: "in-app",
  isEnabled: () => true,
  send: async () => {},
};

export const notifiers: Notifier[] = [inAppNotifier, webPushNotifier];

/** 今天到期的待办（含逾期未处理的）。 */
export async function collectDueItems(date: DateOnly = today()): Promise<DueItem[]> {
  const tasks = await db().task.findMany({
    where: {
      status: "PENDING",
      reminderAt: null,
      // 逾期的一并带上：漏做的护理项本来就该一直提醒
      dueOn: { lte: fromDateOnly(date) },
    },
    include: entryInclude,
    orderBy: { dueOn: "asc" },
    take: 200,
  });

  return tasks.map((t) => ({
    taskId: t.id,
    title: t.title,
    dueOn: t.dueOn.toISOString().slice(0, 10),
    subjectName: t.subject?.name ?? null,
    assigneeName: t.assignee?.name ?? null,
  }));
}

/**
 * 把所有到期项推给所有启用的渠道。
 *
 * 单个渠道失败不影响其他渠道 —— 将来加了微信推送后，微信挂了不该
 * 让 Web Push 也发不出去。
 */
export async function notifyDueTasks(date?: DateOnly): Promise<number> {
  const items = await collectDueItems(date);
  if (items.length === 0) return 0;

  for (const notifier of notifiers) {
    if (!notifier.isEnabled()) continue;
    try {
      await notifier.send(items);
    } catch (e) {
      console.error(`[notify] ${notifier.id} 发送失败`, e);
    }
  }

  return items.length;
}
