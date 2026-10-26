import { PageHeader } from "@/components/page-header";
import { EntryFormDialog } from "@/components/entries/entry-form-dialog";
import {
  CalendarGrid,
  type DayEntry,
  type EntriesByDay,
} from "@/components/calendar/calendar-grid";
import { DayDetail } from "@/components/calendar/day-detail";
import { requireUser } from "@/lib/auth/guard";
import { db } from "@/lib/db";
import { byMember, entryInclude } from "@/lib/queries";
import { ensureGenerated } from "@/lib/recurrence/engine";
import {
  endOfMonth,
  endOfWeek,
  fromDateOnly,
  isValidDateOnly,
  startOfMonth,
  startOfWeek,
  toDateOnly,
  today,
} from "@/lib/time";

export const metadata = { title: "日历 · 家庭管家" };

/**
 * 日历页。
 *
 * `?month=YYYY-MM` 驱动翻月、`?member=` 驱动筛选、`?day=` 驱动日期详情 ——
 * 全部走 URL，好处是服务端能直接按范围取数（不用先拉全部再在客户端过滤），
 * 而且这些状态天然可分享、可前进后退。
 */
export default async function CalendarPage({
  searchParams,
}: PageProps<"/calendar">) {
  await requireUser();

  const params = await searchParams;
  const todayStr = today();

  await ensureGenerated();

  // 月份参数校验：非法值一律回落到本月，不报错 —— 用户手改 URL 不该看到错误页
  const monthParam = typeof params.month === "string" ? params.month : undefined;
  const month =
    monthParam && /^\d{4}-\d{2}$/.test(monthParam) ? `${monthParam}-01` : todayStr;

  const memberId = typeof params.member === "string" ? params.member : undefined;
  const dayParam = typeof params.day === "string" ? params.day : undefined;
  const selectedDay = dayParam && isValidDateOnly(dayParam) ? dayParam : undefined;

  const monthStart = startOfMonth(month);
  // 网格会显示上月末和次月初的补位格子，取数范围要对齐整格，
  // 否则点那些格子会显示「这天没有安排」，而实际上是有事的
  const gridStart = startOfWeek(monthStart);
  const gridEnd = endOfWeek(endOfMonth(monthStart));

  const [members, tasks, records] = await Promise.all([
    db().member.findMany({
      where: { archivedAt: null },
      orderBy: { sortOrder: "asc" },
    }),
    db().task.findMany({
      where: {
        ...byMember(memberId),
        dueOn: { gte: fromDateOnly(gridStart), lte: fromDateOnly(gridEnd) },
      },
      include: entryInclude,
      orderBy: { dueOn: "asc" },
      take: 500,
    }),
    db().record.findMany({
      where: {
        ...byMember(memberId),
        occurredOn: { gte: fromDateOnly(gridStart), lte: fromDateOnly(gridEnd) },
      },
      include: entryInclude,
      orderBy: { occurredOn: "asc" },
      take: 500,
    }),
  ]);

  // 按天索引。日期的比较与分组全部在 DateOnly 字符串上做（字典序即时间序）
  const entries: EntriesByDay = {};

  function push(day: string, entry: DayEntry) {
    (entries[day] ??= []).push(entry);
  }

  for (const t of tasks) {
    push(toDateOnly(t.dueOn), {
      id: t.id,
      title: t.title,
      kind: "task",
      status: t.status,
      memberName: t.subject?.name ?? t.assignee?.name ?? null,
      memberColor: t.subject?.color ?? t.assignee?.color ?? null,
      memberEmoji: t.subject?.emoji ?? t.assignee?.emoji ?? null,
    });
  }

  for (const r of records) {
    push(toDateOnly(r.occurredOn), {
      id: r.id,
      title: r.title,
      kind: "record",
      memberName: r.subject?.name ?? r.assignee?.name ?? null,
      memberColor: r.subject?.color ?? r.assignee?.color ?? null,
      memberEmoji: r.subject?.emoji ?? r.assignee?.emoji ?? null,
    });
  }

  return (
    <>
      <PageHeader
        title="日历"
        subtitle="一眼看清这个月家里有什么事"
        action={<EntryFormDialog kind="task" members={members} defaultDate={todayStr} />}
      />

      <div className="space-y-4 p-4">
        <CalendarGrid
          month={month}
          today={todayStr}
          entries={entries}
          members={members}
          activeMemberId={memberId}
        />

        {selectedDay ? (
          <DayDetail
            day={selectedDay}
            today={todayStr}
            entries={entries[selectedDay] ?? []}
          />
        ) : (
          <p className="text-muted-foreground text-center text-xs">
            点某一天看当天安排
          </p>
        )}
      </div>
    </>
  );
}