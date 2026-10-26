"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { KeyRound, Pencil, Plus, ShieldCheck, UserRound } from "lucide-react";
import { createUser, updateUser } from "@/actions/users";
import { Badge } from "@/components/ui/badge";
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

type UserRow = {
  id: string;
  username: string;
  displayName: string;
  role: "ADMIN" | "MEMBER";
  active: boolean;
  memberId: string | null;
  member: { name: string; emoji: string | null } | null;
};

type MemberOption = {
  id: string;
  name: string;
  emoji: string | null;
  user: { id: string } | null;
};

export function UserManagement({ users, members }: { users: UserRow[]; members: MemberOption[] }) {
  const admins = users.filter((user) => user.role === "ADMIN");
  const membersOnly = users.filter((user) => user.role === "MEMBER");

  return (
    <div className="space-y-6">
      <section className="rounded-xl border bg-muted/30 p-4 text-sm">
        <div className="flex items-start gap-3">
          <ShieldCheck className="mt-0.5 size-5 text-primary" />
          <div>
            <p className="font-medium">管理员负责发放账号</p>
            <p className="text-muted-foreground mt-1 text-xs leading-5">
              普通用户能使用家庭管家，但不能进入账号管理。新建账号后，把用户名和你设置的初始密码私下发给家人即可。
            </p>
          </div>
        </div>
      </section>

      <UserGroup title="管理员" users={admins} members={members} />
      <UserGroup
        title="普通用户"
        users={membersOnly}
        members={members}
        action={<UserFormDialog members={members} />}
        emptyHint="还没有普通账号。点击“添加账号”后就能把登录信息发给家人。"
      />
    </div>
  );
}

function UserGroup({
  title,
  users,
  members,
  action,
  emptyHint,
}: {
  title: string;
  users: UserRow[];
  members: MemberOption[];
  action?: React.ReactNode;
  emptyHint?: string;
}) {
  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-muted-foreground text-sm font-medium">
          {title} {users.length > 0 ? <span className="ml-1 opacity-60">{users.length}</span> : null}
        </h2>
        {action}
      </div>

      {users.length === 0 ? (
        <p className="text-muted-foreground border-muted-foreground/25 rounded-xl border border-dashed p-4 text-center text-sm">
          {emptyHint}
        </p>
      ) : (
        <ul className="divide-y overflow-hidden rounded-xl border">
          {users.map((user) => (
            <li key={user.id} className="flex items-center gap-3 px-4 py-3">
              <span className="bg-secondary flex size-10 shrink-0 items-center justify-center rounded-full text-lg">
                {user.member?.emoji ?? <UserRound className="size-4" />}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="truncate text-sm font-medium">{user.displayName}</p>
                  {user.role === "ADMIN" ? <Badge variant="secondary">管理员</Badge> : null}
                  {!user.active ? <Badge variant="outline">已停用</Badge> : null}
                </div>
                <p className="text-muted-foreground truncate text-xs">
                  @{user.username}
                  {user.member ? ` · ${user.member.name}` : " · 未关联角色"}
                </p>
              </div>
              {user.role === "MEMBER" ? <UserFormDialog user={user} members={members} /> : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function UserFormDialog({ user, members }: { user?: UserRow; members: MemberOption[] }) {
  const isEdit = Boolean(user);
  const [open, setOpen] = useState(false);
  const action = isEdit ? updateUser.bind(null, user!.id) : createUser;
  const [state, formAction] = useActionState<ActionResult<void> | null, FormData>(action, null);
  const [handled, setHandled] = useState(state);

  if (state !== handled) {
    setHandled(state);
    if (state?.ok) setOpen(false);
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          isEdit ? (
            <Button variant="ghost" size="icon-sm" aria-label={`编辑 ${user!.displayName}`}>
              <Pencil className="size-4" />
            </Button>
          ) : (
            <Button>
              <Plus className="size-4" />添加账号
            </Button>
          )
        }
      />
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{isEdit ? "编辑普通账号" : "添加普通账号"}</DialogTitle>
          <DialogDescription>
            {isEdit
              ? "不填写新密码就保持原密码；停用后该账号无法登录。"
              : "请设置一个由家人自己保管的初始密码，至少 8 位。"}
          </DialogDescription>
        </DialogHeader>
        <form action={formAction} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor={`${isEdit ? user!.id : "new"}-displayName`}>称呼</Label>
            <Input
              id={`${isEdit ? user!.id : "new"}-displayName`}
              name="displayName"
              defaultValue={user?.displayName ?? ""}
              placeholder="比如：妈妈"
              required
              className="h-11"
            />
            <FieldError state={state} field="displayName" />
          </div>
          <div className="space-y-2">
            <Label htmlFor={`${isEdit ? user!.id : "new"}-username`}>用户名</Label>
            <Input
              id={`${isEdit ? user!.id : "new"}-username`}
              name="username"
              defaultValue={user?.username ?? ""}
              placeholder="例如 mama"
              autoComplete="username"
              required
              className="h-11"
            />
            <p className="text-muted-foreground text-xs">仅字母、数字、点、下划线或短横线。</p>
            <FieldError state={state} field="username" />
          </div>
          <div className="space-y-2">
            <Label htmlFor={`${isEdit ? user!.id : "new"}-member`}>关联角色</Label>
            <select
              id={`${isEdit ? user!.id : "new"}-member`}
              name="memberId"
              defaultValue={user?.memberId ?? ""}
              className="border-input bg-background h-11 w-full rounded-lg border px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              <option value="">暂不关联</option>
              {members.map((member) => {
                const takenByOther = member.user && member.user.id !== user?.id;
                return (
                  <option key={member.id} value={member.id} disabled={Boolean(takenByOther)}>
                    {member.emoji ?? "👤"} {member.name}{takenByOther ? "（已关联）" : ""}
                  </option>
                );
              })}
            </select>
            <FieldError state={state} field="memberId" />
          </div>
          <div className="space-y-2">
            <Label htmlFor={`${isEdit ? user!.id : "new"}-password`}>
              {isEdit ? "重设密码（可选）" : "初始密码"}
            </Label>
            <Input
              id={`${isEdit ? user!.id : "new"}-password`}
              name="password"
              type="password"
              autoComplete="new-password"
              required={!isEdit}
              className="h-11"
            />
            <FieldError state={state} field="password" />
          </div>
          <div className="space-y-2">
            <Label htmlFor={`${isEdit ? user!.id : "new"}-confirm`}>确认密码</Label>
            <Input
              id={`${isEdit ? user!.id : "new"}-confirm`}
              name="confirm"
              type="password"
              autoComplete="new-password"
              required={!isEdit}
              className="h-11"
            />
            <FieldError state={state} field="confirm" />
          </div>
          {isEdit ? (
            <label className="flex items-center gap-2 rounded-lg border px-3 py-3 text-sm">
              <input type="checkbox" name="active" defaultChecked={user!.active} className="size-4 accent-primary" />
              允许此账号登录
            </label>
          ) : null}
          {state?.ok === false && !state.fieldErrors ? (
            <p role="alert" className="text-destructive text-sm">{state.error}</p>
          ) : null}
          <DialogFooter>
            <SubmitButton isEdit={isEdit} />
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function FieldError({ state, field }: { state: ActionResult<void> | null; field: string }) {
  const message = state?.ok === false ? state.fieldErrors?.[field]?.[0] : undefined;
  return message ? <p className="text-destructive text-sm">{message}</p> : null;
}

function SubmitButton({ isEdit }: { isEdit: boolean }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" className="h-11 w-full" disabled={pending}>
      <KeyRound className="size-4" />
      {pending ? "保存中…" : isEdit ? "保存修改" : "创建账号"}
    </Button>
  );
}
