"use client";

import { useOptimistic, useState, useTransition } from "react";
import { Bell, Check, MoreHorizontal, SkipForward, Trash2, Undo2 } from "lucide-react";
import { completeTask, deleteTask, skipTask, uncompleteTask } from "@/actions/tasks";
import { TaskReminderDialog } from "./task-reminder-dialog";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { formatRelativeZh, type DateOnly } from "@/lib/time";
import type { TaskView } from "@/lib/queries";

/**
 * 一条待办。
 *
 * 勾选用 `useOptimistic` 先本地划掉，再等服务端确认 —— 家庭场景经常在信号
 * 不好的地方点（厨房、阳台），等一次往返才变灰会让人以为没点上而重复点。
 *
 * 逾期项标红但不做任何自动处理：漏做的护理项就该一直红着提醒你。
 */
export function TaskItem({
  task,
  today,
  showRelativeDate = true,
}: {
  task: TaskView;
  /** 服务端算好的「今天」。客户端不许自己算（CLAUDE.md 纪律 2） */
  today: DateOnly;
  showRelativeDate?: boolean;
}) {
  const [pending, start] = useTransition();
  const [reminderOpen, setReminderOpen] = useState(false);
  const [optimisticDone, setOptimisticDone] = useOptimistic(task.status === "DONE");

  const isDone = optimisticDone;
  const isOverdue = !isDone && task.status === "PENDING" && task.dueOn < today;
  const dueOn = task.dueOn;

  function toggle() {
    start(async () => {
      setOptimisticDone(!isDone);
      if (isDone) await uncompleteTask(task.id);
      else await completeTask(task.id);
    });
  }

  return (
    <li
      data-task-id={task.id}
      className={cn(
        "flex items-start gap-3 px-4 py-4 transition-colors hover:bg-secondary/30",
        pending && "opacity-70",
      )}
    >
      {/* 整块可点，触摸目标远大于 44px */}
      <button
        type="button"
        onClick={toggle}
        aria-label={isDone ? `撤销完成「${task.title}」` : `完成「${task.title}」`}
        aria-pressed={isDone}
        className={cn(
          "relative mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full border-2 transition-colors before:absolute before:-inset-3 before:content-['']",
          isDone
            ? "border-primary bg-primary text-primary-foreground"
            : "border-muted-foreground/40 hover:border-primary",
        )}
      >
        {isDone ? <Check className="size-3.5" strokeWidth={3} /> : null}
      </button>

      <div className="min-w-0 flex-1">
        <p
          className={cn(
            "text-sm font-medium leading-6",
            isDone && "text-muted-foreground line-through",
          )}
        >
          {task.title}
        </p>

        {task.note ? (
          <p className="text-muted-foreground mt-0.5 truncate text-xs">{task.note}</p>
        ) : null}

        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
          {showRelativeDate ? (
            <span
              className={cn(
                "text-muted-foreground",
                isOverdue && "text-destructive font-medium",
              )}
            >
              {formatRelativeZh(dueOn, today)}
            </span>
          ) : null}

          {task.reminderTime ? <span className="text-primary font-medium">{task.reminderTime} 提醒</span> : null}

          {task.subject ? (
            <span className="text-muted-foreground">
              {task.subject.emoji ?? "👤"} {task.subject.name}
            </span>
          ) : null}

          {/* 「谁去办」用不同的样式区分，免得和「关于谁」混为一谈 */}
          {task.assignee ? (
            <span className="bg-muted rounded px-1.5 py-0.5">
              要 {task.assignee.name} 办
            </span>
          ) : null}
        </div>
      </div>

      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={`「${task.title}」的更多操作`}
              className="size-10 shrink-0"
            />
          }
        >
          <MoreHorizontal className="size-4" />
        </DropdownMenuTrigger>

        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={toggle}>
            {isDone ? (
              <>
                <Undo2 className="size-4" />
                撤销完成
              </>
            ) : (
              <>
                <Check className="size-4" />
                标记完成
              </>
            )}
          </DropdownMenuItem>

          {!isDone && task.status === "PENDING" ? (
            <DropdownMenuItem
              onClick={() => start(async () => void (await skipTask(task.id)))}
            >
              <SkipForward className="size-4" />
              这次跳过
            </DropdownMenuItem>
          ) : null}

          {task.status === "PENDING" ? (
            <DropdownMenuItem onClick={() => setReminderOpen(true)}><Bell className="size-4" />设置提醒</DropdownMenuItem>
          ) : null}

          <DropdownMenuSeparator />

          <DropdownMenuItem
            variant="destructive"
            onClick={() => {
              if (!confirm(`删除「${task.title}」？已完成的历史记录会一并删掉。`)) return;
              start(async () => void (await deleteTask(task.id)));
            }}
          >
            <Trash2 className="size-4" />
            删除
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <TaskReminderDialog task={task} open={reminderOpen} onOpenChange={setReminderOpen} />
    </li>
  );
}