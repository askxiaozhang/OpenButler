"use client";

import { useTransition } from "react";
import { Pause, Play, Trash2 } from "lucide-react";
import {
  deactivateRoutine,
  deleteRoutine,
  reactivateRoutine,
} from "@/actions/routines";
import { Button } from "@/components/ui/button";
import { RoutineFormDialog } from "./routine-form-dialog";
import { describeAnchor, describeRule } from "@/lib/recurrence/rules";
import { formatRelativeZh, formatZh, type DateOnly } from "@/lib/time";
import { cn } from "@/lib/utils";
import type { Member, Recurrence } from "@/generated/prisma/client";

export interface RoutineView {
  id: string;
  title: string;
  note: string | null;
  freq: Recurrence["freq"];
  interval: number;
  anchorOn: Recurrence["anchorOn"];
  anchorDate: DateOnly;
  reminderTime?: string | null;
  nextCursorOn: DateOnly;
  lastDoneOn: DateOnly | null;
  active: boolean;
  subject: Member | null;
  assignee: Member | null;
  taskCount: number;
  recordCount: number;
}

/**
 * 周期项列表。
 *
 * 每条展示「多久一次 + 下次从哪天算起」两件事 —— 后者是这个应用里最容易被
 * 误解的设定（「晚做了几天到底会不会顺延」），所以在列表上就把语义写清楚，
 * 而不是藏在编辑弹窗里。
 */
export function RoutineList({
  routines,
  members,
  today,
  defaultDate,
}: {
  routines: RoutineView[];
  members: Member[];
  today: DateOnly;
  defaultDate: DateOnly;
}) {
  const active = routines.filter((r) => r.active);
  const paused = routines.filter((r) => !r.active);

  return (
    <div className="space-y-6">
      <section className="space-y-2">
        <h2 className="text-muted-foreground text-sm font-medium">
          进行中
          {active.length > 0 ? (
            <span className="ml-1.5 opacity-60">{active.length}</span>
          ) : null}
        </h2>

        {active.length === 0 ? (
          <p className="text-muted-foreground border-muted-foreground/25 rounded-xl border border-dashed p-4 text-center text-sm">
            还没有周期项。像「猫咪掏耳朵」这种每隔一段时间要做的事，
            建一条之后做完会自动排下一次。
          </p>
        ) : (
          <ul className="divide-y overflow-hidden rounded-xl border">
            {active.map((r) => (
              <RoutineRow
                key={r.id}
                routine={r}
                members={members}
                today={today}
                defaultDate={defaultDate}
              />
            ))}
          </ul>
        )}
      </section>

      {paused.length > 0 ? (
        <section className="space-y-2">
          <h2 className="text-muted-foreground text-sm font-medium">已暂停</h2>
          <ul className="divide-y overflow-hidden rounded-xl border opacity-70">
            {paused.map((r) => (
              <RoutineRow
                key={r.id}
                routine={r}
                members={members}
                today={today}
                defaultDate={defaultDate}
              />
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

function RoutineRow({
  routine,
  members,
  today,
  defaultDate,
}: {
  routine: RoutineView;
  members: Member[];
  today: DateOnly;
  defaultDate: DateOnly;
}) {
  const [pending, start] = useTransition();

  return (
    <li
      data-routine-id={routine.id}
      className={cn("flex items-start gap-3 px-3 py-3", pending && "opacity-60")}
    >
      <span
        className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-full text-lg"
        style={{
          backgroundColor: routine.subject?.color
            ? `${routine.subject.color}22`
            : undefined,
        }}
      >
        {routine.subject?.emoji ?? "🔁"}
      </span>

      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{routine.title}</p>

        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
          <span className="bg-muted rounded px-1.5 py-0.5">
            {describeRule({
              freq: routine.freq,
              interval: routine.interval,
              anchorDate: routine.anchorDate,

            })}
          </span>

          {routine.reminderTime ? <span className="text-primary">{routine.reminderTime} 提醒</span> : null}

          {routine.subject ? (
            <span className="text-muted-foreground">{routine.subject.name}</span>
          ) : null}

          {routine.assignee ? (
            <span className="text-muted-foreground">要 {routine.assignee.name} 办</span>
          ) : null}
        </div>

        <p className="text-muted-foreground mt-1 text-xs">
          {routine.active
            ? `下次 ${formatZh(routine.nextCursorOn)}`
            : "已暂停，不再生成新的待办"}
          {routine.lastDoneOn ? (
            <> · 上次 {formatRelativeZh(routine.lastDoneOn, today)}做的</>
          ) : null}
          {routine.recordCount > 0 ? <> · 已记录 {routine.recordCount} 次</> : null}
        </p>

        <p className="text-muted-foreground/70 mt-0.5 text-xs">
          {describeAnchor(routine.anchorOn)}
        </p>
      </div>

      <div className="flex shrink-0 items-center">
        <RoutineFormDialog
          members={members}
          defaultDate={defaultDate}
          routine={{
            id: routine.id,
            subjectId: routine.subject?.id ?? "",
            assigneeId: routine.assignee?.id ?? null,
            title: routine.title,
            note: routine.note,
            freq: routine.freq,
            interval: routine.interval,
            anchorOn: routine.anchorOn,
            anchorDate: routine.anchorDate,
              reminderTime: routine.reminderTime,
          }}
        />

        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          disabled={pending}
          aria-label={routine.active ? `暂停「${routine.title}」` : `恢复「${routine.title}」`}
          onClick={() =>
            start(async () => {
              if (routine.active) await deactivateRoutine(routine.id);
              else await reactivateRoutine(routine.id);
            })
          }
        >
          {routine.active ? <Pause className="size-3.5" /> : <Play className="size-3.5" />}
        </Button>

        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          disabled={pending}
          aria-label={`删除「${routine.title}」`}
          onClick={() => {
            if (
              !confirm(
                `彻底删除「${routine.title}」？\n\n这会一并删掉它的 ${routine.taskCount} 条待办和 ${routine.recordCount} 条历史记录。\n如果只是想让它别再提醒，用「暂停」就好。`,
              )
            ) {
              return;
            }
            start(async () => void (await deleteRoutine(routine.id)));
          }}
        >
          <Trash2 className="size-3.5" />
        </Button>
      </div>
    </li>
  );
}