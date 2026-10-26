"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { ChevronDown, Pencil, Plus } from "lucide-react";
import { createRoutine, updateRoutine } from "@/actions/routines";
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
import { FREQ_PRESETS, guessAnchorOn } from "@/lib/validation/routine";
import type { ActionResult } from "@/lib/action-result";
import type { DateOnly } from "@/lib/time";
import type { AnchorOn, Freq, Member, Recurrence } from "@/generated/prisma/client";

/**
 * 编辑时传进来的值。
 *
 * 刻意不用完整的 `Recurrence` —— 表单只需要这几个字段，要求调用方补一个
 * 完整的 Prisma 行（还要伪造 createdAt / updatedAt）会把两边耦死。
 */
export interface RoutineFormValue {
  id: string;
  subjectId: string;
  assigneeId: string | null;
  title: string;
  note: string | null;
  freq: Freq;
  interval: number;
  anchorOn: AnchorOn;
  anchorDate: DateOnly;
  reminderTime?: string | null;
}

/**
 * 周期项表单。
 *
 * 核心是让「每 14 天」这种说法能一键设好 —— 直接让用户填 freq + interval
 * 两个下拉太抽象了。预设按钮之外仍可手动调，两者写的是同一组隐藏字段。
 */
export function RoutineFormDialog({
  members,
  defaultDate,
  routine,
  trigger,
}: {
  members: Member[];
  /** 服务端传入的「今天」 */
  defaultDate: DateOnly;
  routine?: RoutineFormValue;
  trigger?: React.ReactNode;
}) {
  const isEdit = Boolean(routine);
  const [open, setOpen] = useState(false);

  const [freq, setFreq] = useState<string>(routine?.freq ?? "DAILY");
  const [interval, setInterval] = useState<number>(routine?.interval ?? 14);
  const [anchorOn, setAnchorOn] = useState<string>(
    routine?.anchorOn ?? "LAST_DONE",
  );
  const [showAssignee, setShowAssignee] = useState(false);
  /** 用户手动改过锚点之后就不再自动猜了，否则会把他改的值冲掉 */
  const [anchorTouched, setAnchorTouched] = useState(isEdit);

  const action = isEdit ? updateRoutine.bind(null, routine!.id) : createRoutine;

  const [state, formAction] = useActionState<ActionResult<Recurrence> | null, FormData>(
    action as (
      prev: ActionResult<Recurrence> | null,
      formData: FormData,
    ) => Promise<ActionResult<Recurrence>>,
    null,
  );

  const [handled, setHandled] = useState(state);
  if (state !== handled) {
    setHandled(state);
    if (state?.ok) setOpen(false);
  }

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (!next) setShowAssignee(false);
  }

  /** 标题变化时猜一次锚点语义（账单类钉死，护理类顺延）。 */
  function onTitleChange(value: string) {
    if (anchorTouched) return;
    setAnchorOn(guessAnchorOn(value));
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger
        render={
          trigger ? (
            (trigger as React.ReactElement)
          ) : (
            <Button size={isEdit ? "icon-sm" : "default"} variant={isEdit ? "ghost" : "default"}>
              {isEdit ? (
                <Pencil className="size-4" />
              ) : (
                <>
                  <Plus className="size-4" />
                  添加周期项
                </>
              )}
            </Button>
          )
        }
      />

      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{isEdit ? "编辑周期项" : "添加周期项"}</DialogTitle>
          <DialogDescription>
            像「猫咪掏耳朵」这种每隔一段时间就要做一次的事。做完一次会自动排下一次。
          </DialogDescription>
        </DialogHeader>

        <form action={formAction} className="space-y-4">
          {/* 隐藏字段：预设按钮和手动调节都写到这里，提交时只有一个来源 */}
          <input type="hidden" name="freq" value={freq} />
          <input type="hidden" name="interval" value={interval} />
          <input type="hidden" name="anchorOn" value={anchorOn} />

          <div className="space-y-2">
            <Label htmlFor="routine-title">做什么</Label>
            <Input
              id="routine-title"
              name="title"
              defaultValue={routine?.title ?? ""}
              placeholder="比如：掏耳朵"
              maxLength={60}
              required
              className="h-11"
              onChange={(e) => onTitleChange(e.target.value)}
            />
            {state?.ok === false && state.fieldErrors?.title ? (
              <p className="text-destructive text-sm">{state.fieldErrors.title[0]}</p>
            ) : null}
          </div>

          <div className="space-y-2">
            <Label htmlFor="routine-subject">关于谁</Label>
            <select
              id="routine-subject"
              name="subjectId"
              defaultValue={routine?.subjectId ?? ""}
              required
              className="border-input bg-background h-11 w-full rounded-lg border px-3 text-sm"
            >
              <option value="">选一个角色</option>
              {members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.emoji ?? "👤"} {m.name}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-2">
            <Label>多久一次</Label>
            <div className="flex flex-wrap gap-1.5">
              {FREQ_PRESETS.map((p) => {
                const active =
                  freq === p.freq && interval === p.interval && anchorOn === p.anchorOn;
                return (
                  <button
                    key={p.label}
                    type="button"
                    aria-pressed={active}
                    data-slot="freq-preset"
                    onClick={() => {
                      setFreq(p.freq);
                      setInterval(p.interval);
                      setAnchorOn(p.anchorOn);
                      setAnchorTouched(true);
                    }}
                    className={cn(
                      "rounded-full border px-3 py-1.5 text-sm transition-colors",
                      active
                        ? "border-primary bg-primary text-primary-foreground font-medium"
                        : "text-muted-foreground hover:bg-accent",
                    )}
                  >
                    {p.label}
                  </button>
                );
              })}
            </div>

            <div className="flex items-center gap-2 pt-1">
              <span className="text-muted-foreground text-sm">每</span>
              <Input
                type="number"
                min={1}
                max={365}
                value={interval}
                aria-label="间隔数量"
                onChange={(e) => {
                  setInterval(Math.max(1, Number(e.target.value) || 1));
                  setAnchorTouched(true);
                }}
                className="h-9 w-20"
              />
              <select
                value={freq}
                aria-label="周期单位"
                onChange={(e) => {
                  setFreq(e.target.value);
                  setAnchorTouched(true);
                }}
                className="border-input bg-background h-9 rounded-lg border px-2 text-sm"
              >
                <option value="DAILY">天</option>
                <option value="WEEKLY">周</option>
                <option value="MONTHLY">个月</option>
                <option value="YEARLY">年</option>
              </select>
            </div>
          </div>

          <div className="space-y-2">
            <Label>下次从哪天算起</Label>
            <div className="grid gap-1.5">
              {(
                [
                  ["LAST_DONE", "从上次完成那天算起", "护理类。晚做几天，下次自动顺延"],
                  ["FIXED_SCHEDULE", "固定在日历上", "账单类。早晚做都一样，下次还是那天"],
                ] as const
              ).map(([value, label, hint]) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={anchorOn === value}
                  data-slot="anchor-option"
                  onClick={() => {
                    setAnchorOn(value);
                    setAnchorTouched(true);
                  }}
                  className={cn(
                    "rounded-lg border px-3 py-2 text-left transition-colors",
                    anchorOn === value
                      ? "border-primary bg-primary/10"
                      : "hover:bg-accent",
                  )}
                >
                  <span className="block text-sm font-medium">{label}</span>
                  <span className="text-muted-foreground block text-xs">{hint}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="routine-start">
              {anchorOn === "FIXED_SCHEDULE" ? "从哪个月开始" : "第一次是哪天"}
            </Label>
            <Input
              id="routine-start"
              name="startOn"
              type="date"
              defaultValue={routine ? routine.anchorDate : defaultDate}
              required
              className="h-11"
            />
            {anchorOn === "FIXED_SCHEDULE" ? (
              <p className="text-muted-foreground text-xs">
                这里选的「日号」会固定下来。选 1 号，以后每月都是 1 号。
              </p>
            ) : null}
          </div>

          <div className="space-y-2">
            <Label htmlFor="routine-reminder-time">每次提醒时间（可选）</Label>
            <Input id="routine-reminder-time" name="reminderTime" type="time" step={60} defaultValue={routine?.reminderTime ?? ""} className="h-11" />
            {state?.ok === false && state.fieldErrors?.reminderTime ? <p className="text-destructive text-sm">{state.fieldErrors.reminderTime[0]}</p> : null}
          </div>

          {showAssignee ? (
            <div className="space-y-2">
              <Label htmlFor="routine-assignee">谁去办（可选）</Label>
              <select
                id="routine-assignee"
                name="assigneeId"
                defaultValue={routine?.assigneeId ?? ""}
                className="border-input bg-background h-11 w-full rounded-lg border px-3 text-sm"
              >
                <option value="">不指定</option>
                {members.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.emoji ?? "👤"} {m.name}
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setShowAssignee(true)}
              className="text-muted-foreground hover:text-foreground flex items-center gap-1 text-sm"
            >
              <ChevronDown className="size-3.5" />
              指定「谁去办」
            </button>
          )}

          <div className="space-y-2">
            <Label htmlFor="routine-note">备注（可选）</Label>
            <Textarea id="routine-note" name="note" rows={2} defaultValue={routine?.note ?? ""} />
          </div>

          {state?.ok === false && !state.fieldErrors ? (
            <p role="alert" className="text-destructive text-sm">
              {state.error}
            </p>
          ) : null}

          <DialogFooter>
            <SubmitButton isEdit={isEdit} />
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function SubmitButton({ isEdit }: { isEdit: boolean }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" className="h-11 w-full" disabled={pending}>
      {pending ? "保存中…" : isEdit ? "保存" : "添加"}
    </Button>
  );
}
