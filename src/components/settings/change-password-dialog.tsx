"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { KeyRound } from "lucide-react";
import { changePassword } from "@/actions/account";
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

export function ChangePasswordDialog({ isDefaultPassword }: { isDefaultPassword: boolean }) {
  const [open, setOpen] = useState(false);

  const [state, formAction] = useActionState<ActionResult<void> | null, FormData>(
    changePassword,
    null,
  );

  // 成功后关窗。用「渲染期间调整 state」而非 useEffect（见 member-form-dialog 的同款说明）
  const [handled, setHandled] = useState(state);
  const [justSaved, setJustSaved] = useState(false);
  if (state !== handled) {
    setHandled(state);
    if (state?.ok) {
      setOpen(false);
      setJustSaved(true);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button
            variant={isDefaultPassword ? "default" : "outline"}
            className="h-11 w-full justify-start"
          >
            <KeyRound className="size-4" />
            {justSaved ? "密码已修改" : "修改密码"}
            {isDefaultPassword && !justSaved ? (
              <span className="ml-auto rounded bg-background/20 px-1.5 py-0.5 text-xs">
                还在用默认密码
              </span>
            ) : null}
          </Button>
        }
      />

      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>修改密码</DialogTitle>
          <DialogDescription>
            部署后站点在公网上，别一直用初始密码。
          </DialogDescription>
        </DialogHeader>

        <form action={formAction} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="pw-current">当前密码</Label>
            <Input
              id="pw-current"
              name="current"
              type="password"
              autoComplete="current-password"
              required
              className="h-11"
            />
            {state?.ok === false && state.fieldErrors?.current ? (
              <p className="text-destructive text-sm">
                {state.fieldErrors.current[0]}
              </p>
            ) : null}
          </div>

          <div className="space-y-2">
            <Label htmlFor="pw-next">新密码</Label>
            <Input
              id="pw-next"
              name="next"
              type="password"
              autoComplete="new-password"
              required
              className="h-11"
            />
            <p className="text-muted-foreground text-xs">至少 8 位，长一点比复杂一点管用。</p>
            {state?.ok === false && state.fieldErrors?.next ? (
              <p className="text-destructive text-sm">{state.fieldErrors.next[0]}</p>
            ) : null}
          </div>

          <div className="space-y-2">
            <Label htmlFor="pw-confirm">再输一遍</Label>
            <Input
              id="pw-confirm"
              name="confirm"
              type="password"
              autoComplete="new-password"
              required
              className="h-11"
            />
            {state?.ok === false && state.fieldErrors?.confirm ? (
              <p className="text-destructive text-sm">
                {state.fieldErrors.confirm[0]}
              </p>
            ) : null}
          </div>

          {state?.ok === false && !state.fieldErrors ? (
            <p role="alert" className="text-destructive text-sm">
              {state.error}
            </p>
          ) : null}

          <DialogFooter>
            <SubmitButton />
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" className="h-11 w-full" disabled={pending}>
      {pending ? "保存中…" : "保存"}
    </Button>
  );
}