import { clockTimeFrom, toDateOnly, type DateOnly } from "./time";
import type { Member, Prisma, TaskStatus } from "@/generated/prisma/client";

/**
 * 查询条件的公共拼装。
 *
 * 抽出来的理由：`subject OR assignee` 这个筛选语义会在首页、待办页、记录页、
 * 日历页各写一遍。写漏一处的表现是「按妈筛选时，提醒妈办事的待办不出现」——
 * 这种缺失很隐蔽，用户只会觉得「少了点东西」，不一定报得出来。
 */

/**
 * 按角色筛选。
 *
 * 匹配 **subject 或 assignee**：「和妈有关的都给我看」是用户的直觉，
 * 而「关于妈的记录」和「要妈去办的事」都算和她有关。
 */
export function byMember(memberId?: string | null): Prisma.TaskWhereInput &
  Prisma.RecordWhereInput {
  if (!memberId) return {};
  return {
    OR: [{ subjectId: memberId }, { assigneeId: memberId }],
  };
}

/** 列表里展示一条记录/待办需要的关联数据。 */
export const entryInclude = {
  subject: true,
  assignee: true,
} satisfies Prisma.TaskInclude;

export type EntryWithMembers = Prisma.TaskGetPayload<{
  include: typeof entryInclude;
}>;

export type RecordWithMembers = Prisma.RecordGetPayload<{
  include: typeof entryInclude;
}>;

/**
 * 角色的展示名：优先用名字，没有则回落。
 *
 * 列表里 subject 和 assignee 都可能是 null，调用方到处写三元表达式容易漏。
 */
export function memberLabel(member: {
  emoji: string | null;
  name: string;
} | null): string {
  if (!member) return "";
  return member.emoji ? `${member.emoji} ${member.name}` : member.name;
}

// ---------------------------------------------------------------- 视图模型

/**
 * 往客户端传的待办形态：日期已转成 `DateOnly` 字符串。
 *
 * Prisma 的 `@db.Date` 读出来是 Date 对象，直接往 Client Component 传会经历
 * 序列化，且客户端一碰 `getFullYear()` 之类的本地 getter 就可能差一天。
 * 在服务端边界上一次性转成字符串，下游就再没有踩这个坑的机会
 * （CLAUDE.md 纪律 1 的执行点）。
 */
export interface TaskView {
  id: string;
  title: string;
  note: string | null;
  dueOn: DateOnly;
  reminderTime?: string | null;
  status: TaskStatus;
  subject: Member | null;
  assignee: Member | null;
  recurrenceId: string | null;
}

export interface RecordView {
  id: string;
  title: string;
  note: string | null;
  occurredOn: DateOnly;
  subject: Member | null;
  assignee: Member | null;
  recurrenceId: string | null;
}

export function toTaskView(task: EntryWithMembers): TaskView {
  return {
    id: task.id,
    title: task.title,
    note: task.note,
    dueOn: toDateOnly(task.dueOn),
    reminderTime: task.reminderAt ? clockTimeFrom(task.reminderAt) : null,
    status: task.status,
    subject: task.subject,
    assignee: task.assignee,
    recurrenceId: task.recurrenceId,
  };
}

export function toRecordView(record: RecordWithMembers): RecordView {
  return {
    id: record.id,
    title: record.title,
    note: record.note,
    occurredOn: toDateOnly(record.occurredOn),
    subject: record.subject,
    assignee: record.assignee,
    recurrenceId: record.recurrenceId,
  };
}