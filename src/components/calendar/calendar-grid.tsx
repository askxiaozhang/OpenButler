"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  addDays,
  endOfMonth,
  endOfWeek,
  formatZhFull,
  shiftMonth,
  startOfMonth,
  startOfWeek,
  type DateOnly,
} from "@/lib/time";
import { cn } from "@/lib/utils";
import type { Member } from "@/generated/prisma/client";

/**
 * 月历网格。
 *
 * ## 时区纪律（重要）
 *
 * 这个组件**不自己算「今天」**，`today` 由 Server Component 作为 prop 传入。
 * 如果在这里调 `new Date()`，服务端（UTC）和客户端（浏览器时区）会渲染出
 * 不同的「今天」，直接导致 hydration mismatch —— 而且只在半夜复现。
 *
 * 组件内所有日期运算都通过 `time.ts` 的纯函数在 `DateOnly` 字符串上做，
 * 字符串没有时区概念，也就不可能漂移。
 */

export interface DayEntry {
  id: string;
  title: string;
  kind: "task" | "record";
  status?: "PENDING" | "DONE" | "SKIPPED";
  memberName: string | null;
  memberColor: string | null;
  memberEmoji: string | null;
}

/** 按日期索引的条目。key 是 DateOnly。 */
export type EntriesByDay = Record<string, DayEntry[]>;

const WEEKDAYS = ["一", "二", "三", "四", "五", "六", "日"] as const;

export function CalendarGrid({
  month, // DateOnly，任意一天，会归一化到月初
  today,
  entries,
  members,
  activeMemberId,
}: {
  month: DateOnly;
  today: DateOnly;
  entries: EntriesByDay;
  members: Member[];
  activeMemberId?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, start] = useTransition();

  const monthStart = startOfMonth(month);
  const gridStart = startOfWeek(monthStart);
  const gridEnd = endOfWeek(endOfMonth(monthStart));

  // 6 行 × 7 列固定，避免月份切换时高度跳动
  const cells: DateOnly[] = [];
  for (let d = gridStart; d <= gridEnd; d = addDays(d, 1)) {
    cells.push(d);
  }
  while (cells.length < 42) cells.push(addDays(cells[cells.length - 1], 1));

  function goToMonth(target: DateOnly) {
    const params = new URLSearchParams(searchParams);
    params.set("month", target.slice(0, 7)); // YYYY-MM
    start(() => router.replace(`${pathname}?${params.toString()}`, { scroll: false }));
  }

  /** 回本月。 */
  function goToday() {
    const params = new URLSearchParams(searchParams);
    params.delete("month");
    start(() => router.replace(`${pathname}?${params.toString()}`, { scroll: false }));
  }

  function selectMember(id?: string) {
    const params = new URLSearchParams(searchParams);
    if (id) params.set("member", id);
    else params.delete("member");
    params.delete("day");
    start(() => router.replace(`${pathname}?${params.toString()}`, { scroll: false }));
  }

  return (
    <div className={cn("rounded-2xl border bg-card p-4 space-y-4 md:p-6", pending && "opacity-60")}>
      <div className="flex items-center justify-between">
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="上个月"
          onClick={() => goToMonth(shiftMonth(monthStart, -1))}
        >
          <ChevronLeft className="size-4" />
        </Button>

        <button
          type="button"
          onClick={goToday}
          className="text-base font-semibold hover:underline"
          title="回到本月"
        >
          {monthStart.slice(0, 4)} 年 {Number(monthStart.slice(5, 7))} 月
        </button>

        {/* 用 shiftMonth 而不是 endOfMonth：九月的月末是 09-30，
            取前 7 位仍是 "2026-09"，根本翻不了月 —— 这个 bug 被
            时区验证脚本抓出来过 */}
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="下个月"
          onClick={() => goToMonth(shiftMonth(monthStart, 1))}
        >
          <ChevronRight className="size-4" />
        </Button>
      </div>

      {/* 角色筛选。日历上「谁的事」比列表里更直观 —— 圆点颜色一眼能分辨 */}
      <div className="-mx-4 flex gap-2 overflow-x-auto px-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <button
          type="button"
          aria-pressed={!activeMemberId}
          data-slot="member-chip"
          onClick={() => selectMember(undefined)}
          className={cn(
            "h-10 shrink-0 rounded-full border px-3 text-xs transition-colors",
            !activeMemberId
              ? "border-primary bg-primary text-primary-foreground font-medium"
              : "text-muted-foreground hover:bg-accent",
          )}
        >
          全部
        </button>
        {members.map((m) => (
          <button
            key={m.id}
            type="button"
            aria-pressed={activeMemberId === m.id}
            data-slot="member-chip"
            onClick={() => selectMember(m.id)}
            style={
              activeMemberId === m.id && m.color
                ? { backgroundColor: m.color, borderColor: m.color }
                : undefined
            }
            className={cn(
              "flex h-10 shrink-0 items-center gap-1 rounded-full border px-3 text-xs transition-colors",
              activeMemberId === m.id
                ? "border-primary bg-primary text-primary-foreground font-medium"
                : "text-muted-foreground hover:bg-accent",
            )}
          >
            <span>{m.emoji ?? ""}</span>
            <span>{m.name}</span>
          </button>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-px text-center">
        {WEEKDAYS.map((w) => (
          <div key={w} className="text-muted-foreground py-1 text-xs">
            {w}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-1">
        {cells.map((day) => {
          const inMonth = day >= monthStart && day <= endOfMonth(monthStart);
          const isToday = day === today;
          const dayEntries = entries[day] ?? [];

          return (
            <button
              key={day}
              type="button"
              data-day={day}
              aria-label={formatZhFull(day)}
              onClick={() => {
                const params = new URLSearchParams(searchParams);
                params.set("day", day);
                start(() =>
                  router.replace(`${pathname}?${params.toString()}`, { scroll: false }),
                );
              }}
              className={cn(
                "flex min-h-11 aspect-square max-h-24 flex-col items-center justify-center rounded-xl border p-1 transition-colors",
                inMonth ? "border-transparent" : "border-transparent opacity-30",
                isToday && "border-primary/60 bg-primary/10",
                "hover:bg-accent",
              )}
            >
              <span
                className={cn(
                  "text-sm leading-6",
                  isToday && "text-primary font-semibold",
                )}
              >
                {Number(day.slice(8, 10))}
              </span>

              {/* 最多 3 个圆点，多出来的用 +N 表示 —— 格子太小，再多也看不清 */}
              <span className="mt-0.5 flex flex-wrap justify-center gap-0.5">
                {dayEntries.slice(0, 3).map((e) => (
                  <span
                    key={`${e.kind}-${e.id}`}
                    className={cn(
                      "size-1.5 rounded-full",
                      e.kind === "task" && e.status !== "PENDING" && "opacity-40",
                    )}
                    style={{
                      backgroundColor: e.memberColor ?? "var(--muted-foreground)",
                    }}
                  />
                ))}
                {dayEntries.length > 3 ? (
                  <span className="text-muted-foreground text-[9px] leading-none">
                    +{dayEntries.length - 3}
                  </span>
                ) : null}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}