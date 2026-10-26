import Link from "next/link";
import { ArrowRight, BookOpen, CalendarDays, Heart, ListTodo } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { TaskList } from "@/components/tasks/task-list";
import { EntryFormDialog } from "@/components/entries/entry-form-dialog";
import { IntakeBox } from "@/components/intake/intake-box";
import { requireUser } from "@/lib/auth/guard";
import { db } from "@/lib/db";
import { entryInclude, toTaskView } from "@/lib/queries";
import { formatZh, fromDateOnly, today } from "@/lib/time";
import { groupTasks } from "@/lib/task-groups";
import { ensureGenerated } from "@/lib/recurrence/engine";

export default async function HomePage() {
  const user = await requireUser();
  const todayStr = today();

  // 周期补齐与角色读取并行；依赖周期实例的查询仍需等待补齐完成。
  const generated = ensureGenerated();

  const [members, allTasks, upcomingCount] = await Promise.all([
    db().member.findMany({
      where: { archivedAt: null },
      orderBy: { sortOrder: "asc" },
    }),
    generated.then(() => db().task.findMany({
      where: {
        status: "PENDING",
        // 首页只关心「现在该做的」：逾期 + 今天，再往后就不必占版面
        dueOn: { lte: fromDateOnly(todayStr) },
      },
      include: entryInclude,
      orderBy: { dueOn: "asc" },
      take: 100,
    })),
    generated.then(() => db().task.count({
      where: {
        status: "PENDING",
        dueOn: { gt: fromDateOnly(todayStr) },
      },
    })),
  ]);

  const tasks = allTasks.map(toTaskView);
  const groups = groupTasks(tasks, todayStr);
  const dueCount = groups.overdue.length + groups.today.length;

  return (
    <>
      <PageHeader
        title={`你好，${user.member?.name ?? user.displayName}`}
        subtitle={formatZh(todayStr)}
        action={
          <EntryFormDialog kind="task" members={members} defaultDate={todayStr} />
        }
      />

      <div className="space-y-7 p-4">
        <div className="grid grid-cols-3 divide-x rounded-2xl border bg-card py-5">
          {[
            { label: "今日待办", value: dueCount, href: "/tasks", icon: ListTodo },
            { label: "之后的安排", value: upcomingCount, href: "/calendar", icon: CalendarDays },
            { label: "家庭成员", value: members.length, href: "/members", icon: Heart },
          ].map(({ label, value, href, icon: Icon }) => (
            <Link key={label} href={href} className="group px-3 text-center sm:px-6 sm:text-left">
              <span className="text-muted-foreground flex items-center justify-center gap-2 text-xs sm:justify-start">
                <Icon className="hidden size-3.5 sm:block" aria-hidden="true" />{label}
              </span>
              <span className="mt-2 block text-2xl font-semibold tabular-nums tracking-tight group-hover:text-primary md:text-3xl">{value}</span>
            </Link>
          ))}
        </div>

        <div className="grid items-start gap-7 xl:grid-cols-[minmax(0,1fr)_280px]">
          <div className="min-w-0 space-y-7">
            <IntakeBox members={members} today={todayStr} />
            <section className="space-y-4">
              <div className="flex items-center justify-between gap-3 px-1">
                <h2 className="text-base font-semibold">今天的安排</h2>
                <Link href="/tasks" prefetch className="text-muted-foreground hover:text-primary flex items-center gap-1 text-xs">
                  全部待办 <ArrowRight className="size-3.5" />
                </Link>
              </div>
              <TaskList tasks={tasks} today={todayStr} showDone={false}
                emptyHint="今天没有到期的待办。享受一点闲暇，或记下接下来的安排。" />
            </section>
          </div>

          <aside className="space-y-5" aria-label="家庭概览">
            <Link href="/products" className="group block rounded-2xl border bg-card p-5">
              <BookOpen className="mb-3 size-6 text-primary" strokeWidth={1.5} />
              <h2 className="text-sm font-semibold">产品资料库</h2>
              <p className="mt-2 text-xs leading-6 text-muted-foreground">说明书和使用心得，想用的时候找得到。</p>
              <span className="mt-3 flex items-center gap-1 text-xs font-medium text-primary">查阅或上传资料 <ArrowRight className="size-3.5" /></span>
            </Link>
            <section className="rounded-2xl border bg-card p-5">
              <div className="mb-5 flex items-center justify-between">
                <h2 className="text-sm font-semibold">家里的伙伴</h2>
                <Link href="/members" className="text-muted-foreground hover:text-primary text-xs">管理</Link>
              </div>
              <div className="space-y-4">
                {members.map((member) => (
                  <Link key={member.id} href={`/tasks?member=${member.id}`} className="group flex items-center gap-3">
                    <span className="bg-secondary flex size-11 shrink-0 items-center justify-center rounded-2xl text-xl">{member.emoji ?? "👤"}</span>
                    <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{member.name}</span><span className="text-muted-foreground mt-0.5 block text-xs">{member.kind === "PET" ? "家里的小可爱" : "一起照顾这个家"}</span></span>
                    <ArrowRight className="text-muted-foreground/50 size-3.5 transition-transform group-hover:translate-x-0.5" />
                  </Link>
                ))}
                {members.length === 0 ? <p className="text-muted-foreground text-sm leading-6">先添加家人或宠物，让每件事都有归属。</p> : null}
              </div>
            </section>
            <Link href="/calendar" className="group block rounded-2xl border border-[#ebddc9] bg-[#f4ebdd] p-5">
              <CalendarDays className="mb-4 size-6 text-[#936c47]" strokeWidth={1.5} />
              <h2 className="text-sm font-semibold text-[#70583d]">给之后的日子留个提醒</h2>
              <p className="mt-2 text-xs leading-6 text-[#806c54]">{upcomingCount > 0 ? `有 ${upcomingCount} 件事在后面等着。打开日历，看看接下来的安排。` : "护理、纪念日、生活琐事，放进日历就不怕忘记。"}</p>
              <span className="mt-4 flex items-center gap-1 text-xs font-medium text-[#70583d]">看看日历 <ArrowRight className="size-3.5" /></span>
            </Link>
          </aside>
        </div>
      </div>
    </>
  );
}
