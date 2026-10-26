"use client";

import { useState, useTransition } from "react";
import { setTaskReminder } from "@/actions/tasks";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import type { TaskView } from "@/lib/queries";

export function TaskReminderDialog({task, open, onOpenChange}: {
  task: TaskView; open: boolean; onOpenChange(open: boolean): void;
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  function save(form: FormData) {
    setError(null);
    start(async () => {
      const result = await setTaskReminder(task.id, String(form.get("dueOn")), String(form.get("reminderTime") ?? ""));
      if (result.ok) onOpenChange(false);
      else setError(result.error);
    });
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>设置提醒</DialogTitle>
          <DialogDescription>{task.title} · 按家庭时区提醒</DialogDescription>
        </DialogHeader>
        <form action={save} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor={`reminder-date-${task.id}`}>日期</Label>
            <Input id={`reminder-date-${task.id}`} type="date" name="dueOn" required defaultValue={task.dueOn} />
          </div>
          <div className="space-y-2">
            <Label htmlFor={`reminder-time-${task.id}`}>提醒时间</Label>
            <Input id={`reminder-time-${task.id}`} type="time" name="reminderTime" step={60} defaultValue={task.reminderTime ?? ""} />
            <p className="text-muted-foreground text-xs">清空时间可取消定时提醒，改为每日汇总。请先在“我的”开启通知。</p>
          </div>
          {error ? <p role="alert" className="text-destructive text-sm">{error}</p> : null}
          <DialogFooter><Button type="submit" disabled={pending}>{pending ? "保存中…" : "保存提醒"}</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
