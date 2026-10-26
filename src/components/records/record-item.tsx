"use client";

import { useTransition } from "react";
import { MoreHorizontal, Trash2 } from "lucide-react";
import { deleteRecord } from "@/actions/records";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import type { RecordView } from "@/lib/queries";

/**
 * 一条记录。
 *
 * 记录是不可变的历史，所以这里只提供「删除」而没有「编辑」—— 记错了就删掉重记，
 * 比允许原地改写更能让日志保持诚实。真需要改标题的场景很罕见，
 * 而「改完之后不知道哪条是原始记录」的代价更大。
 */
export function RecordItem({ record }: { record: RecordView }) {
  const [pending, start] = useTransition();

  return (
    <li
      data-record-id={record.id}
      className={cn("flex items-start gap-2 px-3 py-3", pending && "opacity-60")}
    >
      <div className="min-w-0 flex-1">
        <p className="text-sm leading-snug">{record.title}</p>

        {record.note ? (
          <p className="text-muted-foreground mt-0.5 text-xs">{record.note}</p>
        ) : null}

        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
          {record.subject ? (
            <span className="text-muted-foreground">
              {record.subject.emoji ?? "👤"} {record.subject.name}
            </span>
          ) : null}

          {record.assignee ? (
            <span className="bg-muted rounded px-1.5 py-0.5">
              要 {record.assignee.name} 办
            </span>
          ) : null}

          {record.recurrenceId ? (
            <span className="text-muted-foreground/70">周期项</span>
          ) : null}
        </div>
      </div>

      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={`「${record.title}」的更多操作`}
              className="shrink-0"
            />
          }
        >
          <MoreHorizontal className="size-4" />
        </DropdownMenuTrigger>

        <DropdownMenuContent align="end">
          <DropdownMenuItem
            variant="destructive"
            onClick={() => {
              if (!confirm(`删除记录「${record.title}」？`)) return;
              start(async () => void (await deleteRecord(record.id)));
            }}
          >
            <Trash2 className="size-4" />
            删除
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </li>
  );
}