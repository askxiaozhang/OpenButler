"use client";

import { useRef, useState, useTransition } from "react";
import { ArrowUp, Check, Pencil, Sparkles, X } from "lucide-react";
import { confirmIntake, interpretAction } from "@/actions/intake";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { EntryFormDialog } from "@/components/entries/entry-form-dialog";
import type { IntakeResult } from "@/lib/ai/types";
import type { DateOnly } from "@/lib/time";
import type { Member } from "@/generated/prisma/client";

/**
 * AI 管家入口。
 *
 * ## 关键交互：先看一遍，再落库
 *
 * 解析结果先渲染成一张确认卡片（「我理解为：记录『掏耳朵』· 关于 猫咪 · 今天」），
 * 用户点确认才写库。多一次点击，换来的是「AI 不会偷偷把错的东西写进家庭记录」。
 *
 * ## 降级时不空手
 *
 * AI 不可用/没听懂时，**不是弹一个错误就完了**，而是直接用用户的原话
 * 预填一张表单。用户拿到的永远不是空白 —— 这是「功能完全不受影响」的落点。
 */

const EXAMPLES = [
  "猫咪今天掏耳朵了",
  "提醒我31天后，提醒妈房子没卖出去",
  "猫咪每月一次掏耳朵、剃屁股毛、剪指甲",
];

export function IntakeBox({
  members,
  today,
}: {
  members: Member[];
  /** 服务端算好的「今天」。客户端不许自己算（CLAUDE.md 纪律 2） */
  today: DateOnly;
}) {
  const [text, setText] = useState("");
  const [result, setResult] = useState<IntakeResult | null>(null);
  const [parsing, startParse] = useTransition();
  const [confirming, startConfirm] = useTransition();
  const [done, setDone] = useState<string | null>(null);
  const [fallbackOpen, setFallbackOpen] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  function reset() {
    setText("");
    setResult(null);
    setDone(null);
  }

  function submit(value: string) {
    const trimmed = value.trim();
    if (!trimmed || parsing) return;

    startParse(async () => {
      const r = await interpretAction(trimmed);
      setResult(r);
      // 降级时直接开表单 —— 不让用户再点一次「去手动填」
      if (!r.ok) setFallbackOpen(true);
    });
  }

  function confirm() {
    if (!result?.ok) return;
    startConfirm(async () => {
      const r = await confirmIntake(result.actions);
      if (r.ok) {
        setDone(
          result.source === "ai"
            ? `已记下 ${r.data.created} 条`
            : `已记下 ${r.data.created} 条（用的是本地理解）`,
        );
        setResult(null);
        setText("");
      }
    });
  }

  const busy = parsing || confirming;

  return (
    <section className="space-y-4 rounded-[1.5rem] border border-[#dce5d3] bg-[#edf3e5] p-5 md:p-7">
      <div className="flex items-center gap-3">
        <span className="bg-primary text-primary-foreground flex size-10 shrink-0 items-center justify-center rounded-xl"><Sparkles className="size-5" strokeWidth={1.5} /></span>
        <div><h2 className="text-lg font-semibold">随手记，交给管家</h2><p className="text-muted-foreground mt-1 text-xs leading-5">一句话，记下发生的事和之后的安排。</p></div>
      </div>
      <div className="relative">
        <Textarea
          ref={inputRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            // 回车提交，Shift+回车换行 —— 手机上还是点按钮更顺手
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              submit(text);
            }
          }}
          placeholder="说点什么，比如「猫咪今天掏耳朵了」"
          rows={3}
          maxLength={500}
          disabled={busy}
          aria-label="告诉管家发生了什么"
          className="min-h-[132px] resize-none rounded-2xl border-white bg-white px-4 py-4 pr-14 text-base leading-7 shadow-none placeholder:text-muted-foreground/70"
        />
        <Button
          type="button"
          size="icon-sm"
          aria-label="交给管家"
          disabled={busy || !text.trim()}
          onClick={() => submit(text)}
          className="absolute right-3 bottom-3 size-10 rounded-xl"
        >
          <ArrowUp className="size-5" />
        </Button>
      </div>

      {/* 示例：让用户一眼看懂该怎么说话 */}
      {!result && !done ? (
        <div className="flex flex-wrap gap-1.5">
          {EXAMPLES.map((ex) => (
            <button
              key={ex}
              type="button"
              disabled={busy}
              onClick={() => {
                setText(ex);
                inputRef.current?.focus();
              }}
              className="text-muted-foreground hover:bg-card hover:text-foreground rounded-xl border border-primary/10 bg-white/50 px-3 py-2 text-left text-xs leading-5 transition-colors"
            >
              {ex}
            </button>
          ))}
        </div>
      ) : null}

      {parsing ? (
        <p className="text-muted-foreground text-sm">管家正在理解…</p>
      ) : null}

      {done ? (
        <div
          role="status"
          className="border-primary/30 bg-primary/5 flex items-center gap-2 rounded-lg border px-3 py-2 text-sm"
        >
          <Check className="text-primary size-4 shrink-0" />
          <span className="flex-1">{done}</span>
          <Button variant="ghost" size="icon-sm" aria-label="知道了" onClick={reset}>
            <X className="size-3.5" />
          </Button>
        </div>
      ) : null}

      {/* 确认卡片：解析成功时，用户先看一眼再落库 */}
      {result?.ok ? (
        <div
          data-slot="intake-confirm"
          className="bg-card space-y-3 rounded-xl border p-3"
        >
          <div className="space-y-1">
            <p className="text-muted-foreground text-xs">
              {result.source === "ai" ? "管家理解为" : "我理解为"}
            </p>
            <p className="text-sm">{result.summary}</p>
          </div>

          {/*
            降级说明。三种情况要分清楚，因为用户能做的事完全不同：
            - 没配 key → 去设置里配
            - 调用失败 → 去查（可能是余额/信用卡/模型下线）
            - 没听懂 → 换个说法
          */}
          {result.source === "rules" ? (
            <p className="text-muted-foreground text-xs">
              {degradedHint(result.degraded)}
            </p>
          ) : null}

          <div className="flex gap-2">
            <Button
              type="button"
              disabled={busy}
              onClick={confirm}
              className="h-10 flex-1"
            >
              <Check className="size-4" />
              {confirming ? "保存中…" : "就这样"}
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() => setFallbackOpen(true)}
              className="h-10"
            >
              <Pencil className="size-4" />
              改改
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="取消"
              disabled={busy}
              onClick={reset}
              className="size-10"
            >
              <X className="size-4" />
            </Button>
          </div>
        </div>
      ) : null}

      {/* 降级提示 */}
      {result && !result.ok ? (
        <div
          role="status"
          className="text-muted-foreground flex items-start gap-2 rounded-lg border px-3 py-2 text-sm"
        >
          <span className="flex-1">{result.message}</span>
          <Button variant="ghost" size="icon-sm" aria-label="知道了" onClick={reset}>
            <X className="size-3.5" />
          </Button>
        </div>
      ) : null}

      {/*
        手动表单。AI 路径和手动路径最终都落到同一组 Server Action ——
        这是「没配 key 功能不受影响」的结构性保证，不是两条代码路径。
      */}
      <EntryFormDialog
        kind={result && !result.ok ? result.draft.kind : "task"}
        members={members}
        defaultDate={today}
        open={fallbackOpen}
        onOpenChange={(next) => {
          setFallbackOpen(next);
          if (!next) setResult(null);
        }}
        defaults={
          result
            ? result.ok
              ? actionsToDefaults(result, today)
              : {
                  title: result.draft.title,
                  subjectId: result.draft.subjectId,
                  assigneeId: result.draft.assigneeId,
                  date: result.draft.date,
                  reminderTime: result.draft.reminderTime,
                  note: result.draft.rawText,
                }
            : undefined
        }
      />
    </section>
  );
}

/** 降级时给用户的说明。不同原因下用户该做的事完全不同。 */
function degradedHint(reason: string | undefined): string {
  switch (reason) {
    case "NO_API_KEY":
      return "AI 管家还没启用（没配模型），这是按本地理解填的 —— 确认前可以先看一眼。";
    case "DISABLED":
      return "AI 管家已关闭，这是按本地理解填的。";
    case "TIMEOUT":
      return "AI 响应太慢，改用本地理解。确认前可以先看一眼。";
    case "ERROR":
      return "AI 暂时调不通（模型服务暂时不可用），改用本地理解填的。确认前可以先看一眼。";
    case "NO_ACTIONS":
      return "AI 没太听懂，这是按字面理解填的。";
    default:
      return "这是按本地理解填的 —— 确认前可以先看一眼。";
  }
}

/**
 * 把「改改」时的第一个 action 转成表单预填值。
 *
 * 只取第一条 —— 表单一次只能改一条。多条时用户在「改改」里改完第一条，
 * 剩下的仍会通过确认卡片落库（这里刻意不隐藏这一点，因为多条的典型场景
 * 是批量建周期项，那种情况本来也没什么可改的）。
 */
function actionsToDefaults(
  result: Extract<IntakeResult, { ok: true }>,
  today: DateOnly,
) {
  const first = result.actions[0];
  if (!first) return undefined;

  switch (first.type) {
    case "createRecord":
      return {
        title: first.title,
        subjectId: first.subjectId,
        assigneeId: first.assigneeId,
        date: first.occurredOn,
      };
    case "createTask":
      return {
        title: first.title,
        subjectId: first.subjectId,
        assigneeId: first.assigneeId,
        date: first.dueOn,
        reminderTime: first.reminderTime,
      };
    case "createRoutines":
      return {
        title: first.items[0]?.title ?? "",
        subjectId: first.subjectId,
        date: first.items[0]?.startOn ?? today,
      };
    default:
      return undefined;
  }
}
