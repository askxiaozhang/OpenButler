"use client";

import { useTransition } from "react";
import { Archive, ArrowDown, ArrowUp, RotateCcw } from "lucide-react";
import {
  archiveMember,
  moveMember,
  restoreMember,
} from "@/actions/members";
import { Button } from "@/components/ui/button";
import { MemberFormDialog } from "./member-form-dialog";
import { cn } from "@/lib/utils";
import type { Member } from "@/generated/prisma/client";

/**
 * 角色列表，按「人 / 宠物」分组。
 *
 * 分组是这个页面的重点 —— 用户描述需求时反复强调「按角色看」，
 * 而人和宠物的差异不只是标签：宠物不会有登录账号，将来还会有品种、
 * 疫苗这类专属字段。列表先把这条界线画清楚。
 */
export function MemberList({ members }: { members: Member[] }) {
  const active = members.filter((m) => !m.archivedAt);
  const archived = members.filter((m) => m.archivedAt);

  const people = active.filter((m) => m.kind === "PERSON");
  const pets = active.filter((m) => m.kind === "PET");

  return (
    <div className="space-y-6">
      <MemberGroup
        title="人"
        icon="👤"
        members={people}
        emptyHint="还没有人。用右上角的「添加角色」建「我」「妈」。"
      />
      <MemberGroup
        title="宠物"
        icon="🐾"
        members={pets}
        emptyHint="还没有宠物。猫咪也算一个角色，护理记录可以归属到它。"
      />

      {archived.length > 0 ? (
        <section className="space-y-2">
          <h2 className="text-muted-foreground text-sm font-medium">
            已归档
          </h2>
          <p className="text-muted-foreground text-xs">
            归档的角色不再出现在筛选和下拉里，但历史记录仍然完整保留。
          </p>
          <ul className="divide-y overflow-hidden rounded-xl border">
            {archived.map((m) => (
              <li
                key={m.id}
                data-member-id={m.id}
                className="flex items-center gap-3 px-4 py-3 opacity-60"
              >
                <span className="text-xl">{m.emoji ?? "👤"}</span>
                {/* 与活跃行保持同样的 <p> 结构：标记不一致会让样式和选择器
                    都要写两套，改一处忘一处 */}
                <p className="flex-1 truncate text-sm">{m.name}</p>
                <RestoreButton id={m.id} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

function MemberGroup({
  title,
  icon,
  members,
  emptyHint,
}: {
  title: string;
  icon: string;
  members: Member[];
  emptyHint: string;
}) {
  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between">
        <h2 className="text-muted-foreground text-sm font-medium">
          {icon} {title}
          {members.length > 0 ? (
            <span className="ml-1.5 opacity-60">{members.length}</span>
          ) : null}
        </h2>
      </div>

      {members.length === 0 ? (
        <p className="text-muted-foreground border-muted-foreground/25 rounded-xl border border-dashed p-4 text-center text-sm">
          {emptyHint}
        </p>
      ) : (
        <ul className="divide-y overflow-hidden rounded-xl border">
          {members.map((m, i) => (
            <li key={m.id} data-member-id={m.id} className="flex items-center gap-3 px-3 py-2.5">
              <span
                className="flex size-9 shrink-0 items-center justify-center rounded-full text-lg"
                style={{ backgroundColor: m.color ? `${m.color}22` : undefined }}
              >
                {m.emoji ?? "👤"}
              </span>

              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{m.name}</p>
                {m.aliases.length > 0 ? (
                  <p className="text-muted-foreground truncate text-xs">
                    {m.aliases.join("、")}
                  </p>
                ) : null}
              </div>

              <div className="flex shrink-0 items-center">
                <MoveButton
                  id={m.id}
                  direction="up"
                  disabled={i === 0}
                />
                <MoveButton
                  id={m.id}
                  direction="down"
                  disabled={i === members.length - 1}
                />
                <MemberFormDialog member={m} />
                <ArchiveButton id={m.id} name={m.name} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function MoveButton({
  id,
  direction,
  disabled,
}: {
  id: string;
  direction: "up" | "down";
  disabled: boolean;
}) {
  const [pending, start] = useTransition();
  const Icon = direction === "up" ? ArrowUp : ArrowDown;

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      disabled={disabled || pending}
      aria-label={direction === "up" ? "上移" : "下移"}
      onClick={() => start(async () => void (await moveMember(id, direction)))}
      className={cn(disabled && "opacity-30")}
    >
      <Icon className="size-3.5" />
    </Button>
  );
}

function ArchiveButton({ id, name }: { id: string; name: string }) {
  const [pending, start] = useTransition();

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      disabled={pending}
      aria-label={`归档 ${name}`}
      onClick={() => {
        if (!confirm(`归档「${name}」？历史记录会保留，但它不再出现在筛选和下拉里。`)) {
          return;
        }
        start(async () => void (await archiveMember(id)));
      }}
    >
      <Archive className="size-3.5" />
    </Button>
  );
}

function RestoreButton({ id }: { id: string }) {
  const [pending, start] = useTransition();
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      disabled={pending}
      onClick={() => start(async () => void (await restoreMember(id)))}
    >
      <RotateCcw className="size-3.5" />
      恢复
    </Button>
  );
}