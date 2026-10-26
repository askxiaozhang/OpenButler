import { endOfWeek } from "./time";
import type { DateOnly } from "./time";

/**
 * 待办分组。
 *
 * 纯函数，`today` 由调用方传入而不是内部算 —— 这样可测，也强制调用方想清楚
 * 「以哪一天为基准」（见 CLAUDE.md 纪律 1）。
 *
 * 逾期项**不做任何自动处理**：漏做的护理项就该一直红着提醒你，
 * 自动跳过等于帮你把事忘了。
 */

export interface Groupable {
  dueOn: DateOnly;
  status: "PENDING" | "DONE" | "SKIPPED";
}

export interface TaskGroups<T extends Groupable> {
  overdue: T[];
  today: T[];
  thisWeek: T[];
  later: T[];
  done: T[];
}

export function groupTasks<T extends Groupable>(
  tasks: T[],
  today: DateOnly,
): TaskGroups<T> {
  const weekEnd = endOfWeek(today);

  const groups: TaskGroups<T> = {
    overdue: [],
    today: [],
    thisWeek: [],
    later: [],
    done: [],
  };

  for (const task of tasks) {
    if (task.status !== "PENDING") {
      groups.done.push(task);
      continue;
    }

    if (task.dueOn < today) groups.overdue.push(task);
    else if (task.dueOn === today) groups.today.push(task);
    else if (task.dueOn <= weekEnd) groups.thisWeek.push(task);
    else groups.later.push(task);
  }

  // 逾期最久的排最前 —— 那是你最该面对的一条
  groups.overdue.sort((a, b) => (a.dueOn < b.dueOn ? -1 : 1));
  groups.today.sort((a, b) => (a.dueOn < b.dueOn ? -1 : 1));
  groups.thisWeek.sort((a, b) => (a.dueOn < b.dueOn ? -1 : 1));
  groups.later.sort((a, b) => (a.dueOn < b.dueOn ? -1 : 1));
  // 已完成的按到期日倒序，最近做的在最上面
  groups.done.sort((a, b) => (a.dueOn > b.dueOn ? -1 : 1));

  return groups;
}

/** 有待办要处理的分组（不含 done），按紧急度排列。 */
export function pendingGroups<T extends Groupable>(groups: TaskGroups<T>) {
  return [
    { key: "overdue", label: "逾期", tone: "danger" as const, items: groups.overdue },
    { key: "today", label: "今天", tone: "primary" as const, items: groups.today },
    { key: "thisWeek", label: "本周", tone: "normal" as const, items: groups.thisWeek },
    { key: "later", label: "以后", tone: "muted" as const, items: groups.later },
  ];
}

export function totalPending<T extends Groupable>(groups: TaskGroups<T>): number {
  return (
    groups.overdue.length +
    groups.today.length +
    groups.thisWeek.length +
    groups.later.length
  );
}