import { formatRelativeZh, formatZhFull, type DateOnly } from "@/lib/time";
import { cn } from "@/lib/utils";
import type { DayEntry } from "./calendar-grid";

/**
 * 某一天的详情。
 *
 * 做成服务端渲染的面板（由 URL 的 `?day=` 驱动）而不是客户端 Sheet：
 * 日期详情本来就要查库，走 URL 参数能直接由 Server Component 取数，
 * 少一层客户端状态，也天然可分享、可前进后退。
 */
export function DayDetail({
  day,
  today,
  entries,
}: {
  day: DateOnly;
  today: DateOnly;
  entries: DayEntry[];
}) {
  const tasks = entries.filter((e) => e.kind === "task");
  const records = entries.filter((e) => e.kind === "record");

  return (
    <section
      data-day-detail={day}
      className="bg-card space-y-3 rounded-xl border p-4"
    >
      <header className="flex items-baseline justify-between gap-2">
        <h2 className="text-sm font-medium">{formatZhFull(day)}</h2>
        <span className="text-muted-foreground text-xs">
          {formatRelativeZh(day, today)}
        </span>
      </header>

      {entries.length === 0 ? (
        <p className="text-muted-foreground text-sm">这天没有安排。</p>
      ) : null}

      {tasks.length > 0 ? (
        <div className="space-y-1.5">
          <h3 className="text-muted-foreground text-xs font-medium">
            待办 {tasks.length}
          </h3>
          <ul className="space-y-1.5">
            {tasks.map((e) => (
              <li key={e.id} className="flex items-start gap-2 text-sm">
                <span
                  className={cn(
                    "mt-1.5 size-2 shrink-0 rounded-full",
                    e.status !== "PENDING" && "opacity-40",
                  )}
                  style={{ backgroundColor: e.memberColor ?? "var(--muted-foreground)" }}
                />
                <span
                  className={cn(
                    "min-w-0 flex-1",
                    e.status !== "PENDING" && "text-muted-foreground line-through",
                  )}
                >
                  {e.title}
                </span>
                {e.memberName ? (
                  <span className="text-muted-foreground shrink-0 text-xs">
                    {e.memberEmoji} {e.memberName}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {records.length > 0 ? (
        <div className="space-y-1.5">
          <h3 className="text-muted-foreground text-xs font-medium">
            记录 {records.length}
          </h3>
          <ul className="space-y-1.5">
            {records.map((e) => (
              <li key={e.id} className="flex items-start gap-2 text-sm">
                <span
                  className="mt-1.5 size-2 shrink-0 rounded-full"
                  style={{ backgroundColor: e.memberColor ?? "var(--muted-foreground)" }}
                />
                <span className="min-w-0 flex-1">{e.title}</span>
                {e.memberName ? (
                  <span className="text-muted-foreground shrink-0 text-xs">
                    {e.memberEmoji} {e.memberName}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}