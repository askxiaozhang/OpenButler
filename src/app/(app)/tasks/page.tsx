import { PageHeader } from "@/components/page-header";
import { MemberFilterChips } from "@/components/members/member-filter-chips";
import { EntryFormDialog } from "@/components/entries/entry-form-dialog";
import { TaskList } from "@/components/tasks/task-list";
import { requireUser } from "@/lib/auth/guard";
import { db } from "@/lib/db";
import { byMember, entryInclude, toTaskView } from "@/lib/queries";
import { today } from "@/lib/time";
import { ensureGenerated } from "@/lib/recurrence/engine";

export const metadata = { title: "待办 · Open家庭管家" };

export default async function TasksPage({ searchParams }: PageProps<"/tasks">) {
  await requireUser();

  const params = await searchParams;
  const memberId = typeof params.member === "string" ? params.member : undefined;

  // 服务端算「今天」，往下传。客户端一律不许自己算（CLAUDE.md 纪律 2）
  const todayStr = today();
  const generated = ensureGenerated();

  const [members, tasks] = await Promise.all([
    db().member.findMany({
      where: { archivedAt: null },
      orderBy: { sortOrder: "asc" },
    }),
    generated.then(() => db().task.findMany({
      where: byMember(memberId),
      include: entryInclude,
      orderBy: { dueOn: "asc" },
      // 上限保护：家庭场景不该有这么多待办，超了说明周期项没收敛
      take: 300,
    })),
  ]);

  const views = tasks.map(toTaskView);
  const activeMember = members.find((m) => m.id === memberId);

  return (
    <>
      <PageHeader
        title="待办"
        subtitle={activeMember ? `只看「${activeMember.name}」相关` : undefined}
        action={<EntryFormDialog kind="task" members={members} defaultDate={todayStr} />}
      />

      <div className="space-y-4 p-4">
        <MemberFilterChips members={members} activeId={memberId} />
        <TaskList
          tasks={views}
          today={todayStr}
          emptyHint={
            activeMember
              ? `「${activeMember.name}」名下没有待办。`
              : "还没有待办。用右上角「加待办」建一条。"
          }
        />
      </div>
    </>
  );
}
