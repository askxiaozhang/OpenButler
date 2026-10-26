import { PageHeader } from "@/components/page-header";
import { RoutineFormDialog } from "@/components/routines/routine-form-dialog";
import { RoutineList, type RoutineView } from "@/components/routines/routine-list";
import { requireUser } from "@/lib/auth/guard";
import { db } from "@/lib/db";
import { ensureGenerated } from "@/lib/recurrence/engine";
import { toDateOnly, today } from "@/lib/time";

export const metadata = { title: "周期事项 · Open家庭管家" };

export default async function RoutinesPage() {
  await requireUser();

  const todayStr = today();

  // 读路径先补齐实例 —— 新加的周期项立刻能看到排期，不用等下一次读别的页面
  await ensureGenerated();

  const [members, recurrences] = await Promise.all([
    db().member.findMany({
      where: { archivedAt: null },
      orderBy: { sortOrder: "asc" },
    }),
    db().recurrence.findMany({
      include: {
        subject: true,
        assignee: true,
        _count: { select: { tasks: true, records: true } },
      },
      orderBy: [{ active: "desc" }, { createdAt: "asc" }],
      take: 200,
    }),
  ]);

  const views: RoutineView[] = recurrences.map((r) => ({
    id: r.id,
    title: r.title,
    note: r.note,
    freq: r.freq,
    interval: r.interval,
    anchorOn: r.anchorOn,
    anchorDate: toDateOnly(r.anchorDate),
    reminderTime: r.reminderTime,
    nextCursorOn: toDateOnly(r.nextCursorOn),
    lastDoneOn: r.lastDoneOn ? toDateOnly(r.lastDoneOn) : null,
    active: r.active,
    subject: r.subject,
    assignee: r.assignee,
    taskCount: r._count.tasks,
    recordCount: r._count.records,
  }));

  return (
    <>
      <PageHeader
        title="周期事项"
        subtitle="做完一次自动排下一次"
        action={
          <RoutineFormDialog members={members} defaultDate={todayStr} />
        }
      />
      <div className="p-4">
        <RoutineList
          routines={views}
          members={members}
          today={todayStr}
          defaultDate={todayStr}
        />
      </div>
    </>
  );
}