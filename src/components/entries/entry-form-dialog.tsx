"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { ChevronDown, Plus } from "lucide-react";
import { createRecord } from "@/actions/records";
import { createTask } from "@/actions/tasks";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import type { ActionResult } from "@/lib/action-result";
import type { DateOnly } from "@/lib/time";
import type { Member } from "@/generated/prisma/client";

/**
 * 记录 / 待办的通用录入表单。
 *
 * 两者字段几乎一样，差别只在日期字段名（occurredOn vs dueOn）和默认日期 ——
 * 拆成两个组件会让「加了备注字段但只改了一边」这类不一致迟早发生。
 *
 * ## 为什么用原生 select / input[type=date]
 *
 * 手机上会唤起系统选择器（滚轮 / 日历），比自定义下拉更符合直觉、命中区域更大，
 * 老人用起来也没障碍。自定义组件的视觉优势在这个场景不值这个代价。
 */

export interface EntryDefaults {
  title?: string;
  note?: string;
  subjectId?: string | null;
  assigneeId?: string | null;
  date?: DateOnly;
  reminderTime?: string | null;
}

export function EntryFormDialog({
  kind,
  members,
  defaultDate,
  defaultSubjectId,
  defaults,
  open: controlledOpen,
  onOpenChange,
  trigger,
}: {
  kind: "record" | "task";
  members: Member[];
  /** 由 Server Component 传入的「今天」。客户端一律不许自己算（见 CLAUDE.md 纪律 2） */
  defaultDate: DateOnly;
  defaultSubjectId?: string;
  /**
   * 预填值。降级路径（AI 不可用 / 快速解析结果）用它把用户的原话
   * 和一些猜出来的字段填进去 —— 用户拿到的永远不是空表单。
   */
  defaults?: EntryDefaults;
  /** 受控打开。不传则自己管（标题栏按钮那种用法）。 */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  trigger?: React.ReactNode;
}) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const isControlled = controlledOpen !== undefined;
  const open = isControlled ? controlledOpen : uncontrolledOpen;

  const [showAssignee, setShowAssignee] = useState(
    Boolean(defaults?.assigneeId),
  );

  const isRecord = kind === "record";
  const action = isRecord ? createRecord : createTask;

  const [state, formAction] = useActionState<ActionResult<unknown> | null, FormData>(
    action as (
      prev: ActionResult<unknown> | null,
      formData: FormData,
    ) => Promise<ActionResult<unknown>>,
    null,
  );

  // 成功后关窗。用「渲染期间调整 state」而非 useEffect —— effect 里同步
  // setState 会多一次渲染，lint 也不允许（见 member-form-dialog 的同款处理）
  const [handled, setHandled] = useState(state);
  if (state !== handled) {
    setHandled(state);
    if (state?.ok) setOpen(false);
  }

  function setOpen(next: boolean) {
    if (!isControlled) setUncontrolledOpen(next);
    onOpenChange?.(next);
  }

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (!next) setShowAssignee(Boolean(defaults?.assigneeId));
  }

  const label = isRecord ? "记一笔" : "加待办";
  const dateLabel = isRecord ? "发生日期" : "到期日";
  const dateName = isRecord ? "occurredOn" : "dueOn";

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      {isControlled ? null : (
        <DialogTrigger
          render={
            trigger ? (
              (trigger as React.ReactElement)
            ) : (
              <Button size="sm" className="h-10 px-3">
                <Plus className="size-4" />
                {label}
              </Button>
            )
          }
        />
      )}

      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{isRecord ? "记一笔" : "加个待办"}</DialogTitle>
          <DialogDescription>
            {isRecord
              ? "已经发生的事。填上周期规则后，完成时会自动排下一次。"
              : "将来要做的事。到期那天会出现在待办和日历上。"}
          </DialogDescription>
        </DialogHeader>

        <form action={formAction} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="entry-title">
              {isRecord ? "发生了什么" : "要做什么"}
            </Label>
            <Input
              id="entry-title"
              name="title"
              defaultValue={defaults?.title ?? ""}
              placeholder={isRecord ? "比如：掏耳朵" : "比如：提醒妈房子没卖出去"}
              maxLength={120}
              required
              className="h-11"
            />
            {state?.ok === false && state.fieldErrors?.title ? (
              <p className="text-destructive text-sm">{state.fieldErrors.title[0]}</p>
            ) : null}
          </div>

          <div className="space-y-2">
            <Label htmlFor="entry-subject">
              {isRecord ? "这是关于谁的事" : "这件事关于谁"}
            </Label>
            <select
              id="entry-subject"
              name="subjectId"
              defaultValue={defaults?.subjectId ?? defaultSubjectId ?? ""}
              className="border-input bg-background h-11 w-full rounded-lg border px-3 text-sm"
            >
              <option value="">不指定</option>
              {members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.emoji ?? "👤"} {m.name}
                  {m.kind === "PET" ? "（宠物）" : ""}
                </option>
              ))}
            </select>
          </div>

          {/* 「谁去办」默认折叠：绝大多数记录只关心「关于谁」，
              一直显示两个角色下拉会让表单显得很重 */}
          {showAssignee ? (
            <div className="space-y-2">
              <Label htmlFor="entry-assignee">谁去办</Label>
              <select
                id="entry-assignee"
                name="assigneeId"
                defaultValue={defaults?.assigneeId ?? ""}
                className="border-input bg-background h-11 w-full rounded-lg border px-3 text-sm"
              >
                <option value="">不指定</option>
                {members.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.emoji ?? "👤"} {m.name}
                  </option>
                ))}
              </select>
              {!isRecord ? <p className="text-muted-foreground text-xs">该角色已在目标群绑定 QQ 时，定时群提醒会自动 @对应成员。</p> : null}
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setShowAssignee(true)}
              className="text-muted-foreground hover:text-foreground flex items-center gap-1 text-sm"
            >
              <ChevronDown className="size-3.5" />
              指定「谁去办」（比如「提醒妈…」）
            </button>
          )}

          <div className="space-y-2">
            <Label htmlFor="entry-date">{dateLabel}</Label>
            <Input
              id="entry-date"
              name={dateName}
              type="date"
              defaultValue={defaults?.date ?? defaultDate}
              required
              className="h-11"
            />
            {state?.ok === false &&
            (state.fieldErrors?.occurredOn || state.fieldErrors?.dueOn) ? (
              <p className="text-destructive text-sm">
                {(state.fieldErrors.occurredOn ?? state.fieldErrors.dueOn)![0]}
              </p>
            ) : null}
          </div>

          {!isRecord ? (
            <div className="space-y-2">
              <Label htmlFor="entry-reminder-time">提醒时间（可选）</Label>
              <Input id="entry-reminder-time" name="reminderTime" type="time" step={60} defaultValue={defaults?.reminderTime ?? ""} className="h-11" />
              <p className="text-muted-foreground text-xs">按家庭时区提醒；不选时间则加入每日待办汇总。请先在“我的”开启通知。</p>
              {state?.ok === false && state.fieldErrors?.reminderTime ? <p className="text-destructive text-sm">{state.fieldErrors.reminderTime[0]}</p> : null}
            </div>
          ) : null}

          <div className="space-y-2">
            <Label htmlFor="entry-note">备注（可选）</Label>
            <Textarea
              id="entry-note"
              name="note"
              rows={2}
              maxLength={2000}
              defaultValue={defaults?.note ?? ""}
            />
          </div>

          {state?.ok === false && !state.fieldErrors ? (
            <p role="alert" className="text-destructive text-sm">
              {state.error}
            </p>
          ) : null}

          <DialogFooter>
            <SubmitButton label={label} />
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" className={cn("h-11 w-full")} disabled={pending}>
      {pending ? "保存中…" : label}
    </Button>
  );
}
