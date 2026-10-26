import { Leaf } from "lucide-react";
import { TaskItem } from "./task-item";
import { groupTasks, pendingGroups, totalPending } from "@/lib/task-groups";
import type { DateOnly } from "@/lib/time";
import type { TaskView } from "@/lib/queries";
import { cn } from "@/lib/utils";

/**
 * 待办列表（Server Component）。
 *
 * 分组在服务端算好 —— 这样「今天」只有一个来源（服务端的 APP_TIMEZONE），
 * 客户端不参与任何日期判断。
 */
export function TaskList({
  tasks,
  today,
  emptyHint = "没有待办。",
  showDone = true,
}: {
  tasks: TaskView[];
  today: DateOnly;
  emptyHint?: string;
  showDone?: boolean;
}) {
  const groups = groupTasks(tasks, today);
  const sections = pendingGroups(groups);
  const pendingCount = totalPending(groups);

  if (pendingCount === 0 && (!showDone || groups.done.length === 0)) {
    return (
      <div className="bg-card flex flex-col items-center rounded-2xl border px-6 py-12 text-center">
        <div className="bg-secondary text-primary mb-5 flex size-16 items-center justify-center rounded-full">
          <Leaf className="size-7" strokeWidth={1.4} aria-hidden="true" />
        </div>
        <p className="text-base font-medium">给生活留一点空白</p>
        <p className="text-muted-foreground mt-2 max-w-xs text-sm leading-6">{emptyHint}</p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {sections
        .filter((s) => s.items.length > 0)
        .map((section) => (
          <section key={section.key} className="space-y-2">
            <h2
              className={cn(
                "flex items-center gap-2.5 px-1 text-sm font-semibold",
                section.tone === "danger" ? "text-destructive" : "text-muted-foreground",
              )}
            >
              {section.label}
              <span className="bg-secondary text-secondary-foreground rounded-full px-2 py-0.5 text-xs">{section.items.length}</span>
            </h2>

            <ul className="divide-y overflow-hidden rounded-2xl border bg-card">
              {section.items.map((task) => (
                <TaskItem
                  key={task.id}
                  task={task}
                  today={today}
                  // 分组标题已经说了时间，行内再重复一遍「今天」是噪音
                  showRelativeDate={section.key === "later" || section.key === "overdue"}
                />
              ))}
            </ul>
          </section>
        ))}

      {showDone && groups.done.length > 0 ? (
        <section className="space-y-2">
          <h2 className="text-muted-foreground text-sm font-medium">
            已完成
            <span className="ml-1.5 opacity-60">{groups.done.length}</span>
          </h2>
          <ul className="divide-y overflow-hidden rounded-2xl border bg-card opacity-70">
            {groups.done.slice(0, 10).map((task) => (
              <TaskItem key={task.id} task={task} today={today} />
            ))}
          </ul>
          {groups.done.length > 10 ? (
            <p className="text-muted-foreground text-xs">
              只显示最近 10 条，其余在「记录」页
            </p>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}