"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { Plus, Pencil } from "lucide-react";
import { createMember, updateMember } from "@/actions/members";
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
import type { ActionResult } from "@/lib/action-result";
import {
  MEMBER_COLORS,
  MEMBER_EMOJIS,
  type MemberInput,
} from "@/lib/validation/member";
import { cn } from "@/lib/utils";
import type { Member } from "@/generated/prisma/client";

/** 编辑时传入 member；新建时不传。 */
export function MemberFormDialog({
  member,
  nextSortOrder = 0,
  trigger,
}: {
  member?: Member;
  nextSortOrder?: number;
  trigger?: React.ReactNode;
}) {
  const isEdit = Boolean(member);
  const [open, setOpen] = useState(false);

  const [emoji, setEmoji] = useState(member?.emoji ?? "🙂");
  const [color, setColor] = useState(member?.color ?? MEMBER_COLORS[0]);
  const [kind, setKind] = useState<"PERSON" | "PET">(member?.kind ?? "PERSON");

  // 编辑时把 id 预绑定到 action 的第一个参数上
  const action = isEdit ? updateMember.bind(null, member!.id) : createMember;

  const [state, formAction] = useActionState<ActionResult<Member> | null, FormData>(
    action,
    null,
  );

  /**
   * 成功后关窗。
   *
   * 用「渲染期间调整 state」而不是 useEffect —— effect 里同步 setState 会
   * 触发一次多余的渲染（lint 也会报 set-state-in-effect）。这里靠
   * `state !== handled` 保证每个结果只处理一次，不会死循环。
   *
   * 不能在 action 里直接关窗：action 跑在服务端，拿不到客户端状态。
   */
  const [handled, setHandled] = useState(state);
  if (state !== handled) {
    setHandled(state);
    if (state?.ok) setOpen(false);
  }

  /**
   * 关窗时把临时状态复位成 props。
   *
   * 放在事件处理里而不是 useEffect：effect 每次依赖变化都会跑，
   * 而这里只在「关闭」这一个时刻需要复位，用事件表达更准确，
   * 也避免了一次多余的渲染。
   */
  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (!next) {
      setEmoji(member?.emoji ?? "🙂");
      setColor(member?.color ?? MEMBER_COLORS[0]);
      setKind(member?.kind ?? "PERSON");
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger
        render={
          trigger ? (
            (trigger as React.ReactElement)
          ) : (
            <Button size={isEdit ? "icon-sm" : "default"} variant={isEdit ? "ghost" : "default"}>
              {isEdit ? <Pencil className="size-4" /> : <><Plus className="size-4" />添加角色</>}
            </Button>
          )
        }
      />

      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{isEdit ? "编辑角色" : "添加角色"}</DialogTitle>
          <DialogDescription>
            人和宠物都算角色。宠物不需要登录账号，但记录可以归属到它。
          </DialogDescription>
        </DialogHeader>

        <form action={formAction} className="space-y-5">
          {!isEdit ? <input type="hidden" name="sortOrder" value={nextSortOrder} /> : null}
          <input type="hidden" name="emoji" value={emoji} />
          <input type="hidden" name="color" value={color} />
          <input type="hidden" name="kind" value={kind} />

          <div className="space-y-2">
            <Label htmlFor="member-name">名字</Label>
            <Input
              id="member-name"
              name="name"
              defaultValue={member?.name ?? ""}
              placeholder="比如：猫咪"
              maxLength={20}
              required
              className="h-11"
            />
            {state?.ok === false && state.fieldErrors?.name ? (
              <p className="text-destructive text-sm">{state.fieldErrors.name[0]}</p>
            ) : null}
          </div>

          <div className="space-y-2">
            <Label>类型</Label>
            <div className="grid grid-cols-2 gap-2">
              {(
                [
                  ["PERSON", "人", "👤"],
                  ["PET", "宠物", "🐾"],
                ] as const
              ).map(([value, label, icon]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setKind(value)}
                  aria-pressed={kind === value}
                  className={cn(
                    "flex h-11 items-center justify-center gap-2 rounded-lg border text-sm transition-colors",
                    kind === value
                      ? "border-primary bg-primary/10 font-medium"
                      : "text-muted-foreground hover:bg-accent",
                  )}
                >
                  <span>{icon}</span>
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <Label>图标</Label>
            <div className="flex flex-wrap gap-1.5">
              {MEMBER_EMOJIS.map((e) => (
                <button
                  key={e}
                  type="button"
                  onClick={() => setEmoji(e)}
                  aria-label={`选择图标 ${e}`}
                  aria-pressed={emoji === e}
                  className={cn(
                    "size-9 rounded-lg border text-lg transition-colors",
                    emoji === e ? "border-primary bg-primary/10" : "hover:bg-accent",
                  )}
                >
                  {e}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <Label>颜色</Label>
            <div className="flex flex-wrap gap-2">
              {MEMBER_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setColor(c)}
                  aria-label={`选择颜色 ${c}`}
                  aria-pressed={color === c}
                  style={{ backgroundColor: c }}
                  className={cn(
                    "size-8 rounded-full transition-transform",
                    color === c
                      ? "ring-foreground ring-2 ring-offset-2 ring-offset-background"
                      : "hover:scale-110",
                  )}
                />
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="member-aliases">别名（可选）</Label>
            <Input
              id="member-aliases"
              name="aliases"
              defaultValue={member?.aliases.join("、") ?? ""}
              placeholder="妈妈、老妈"
              className="h-11"
            />
            <p className="text-muted-foreground text-xs">
              用逗号或顿号分隔。AI 管家和快速解析器靠这些别名认出你指的是谁。
            </p>
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

/** 供类型推断用，避免上面的 bind 断言被 tree-shaking 掉类型。 */
export type { MemberInput };