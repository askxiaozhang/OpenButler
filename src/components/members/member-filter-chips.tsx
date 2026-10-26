"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import { cn } from "@/lib/utils";
import type { Member } from "@/generated/prisma/client";

/**
 * 角色筛选。
 *
 * 状态放在 URL 的 `?member=<id>` 里而不是组件 state —— 这样筛选结果可以被
 * 分享、被前进后退、被服务端直接读到（不用先渲染全部再在客户端过滤）。
 * 代价是每次点击要走一次导航，用 `useTransition` 让过渡期间不出 loading 闪烁。
 *
 * 匹配语义是 **subject 或 assignee**（见 lib/queries.ts 的 byMember）。
 */
export function MemberFilterChips({
  members,
  activeId,
}: {
  members: Member[];
  activeId?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, start] = useTransition();

  function select(id?: string) {
    const params = new URLSearchParams(searchParams);
    if (id) params.set("member", id);
    else params.delete("member");

    // 换筛选条件时把分页游标清掉，否则会停在一个新条件下的越界页
    params.delete("cursor");

    start(() => {
      router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    });
  }

  return (
    <div
      className={cn(
        // 横向滚动而不是换行：手机上角色多了也不会把内容区挤下去
        "-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
        pending && "opacity-60",
      )}
    >
      <Chip selected={!activeId} onClick={() => select(undefined)}>
        全部
      </Chip>
      {members.map((m) => (
        <Chip
          key={m.id}
          selected={activeId === m.id}
          onClick={() => select(m.id)}
          color={m.color}
        >
          <span>{m.emoji ?? "👤"}</span>
          <span>{m.name}</span>
        </Chip>
      ))}
    </div>
  );
}

function Chip({
  children,
  selected,
  onClick,
  color,
}: {
  children: React.ReactNode;
  selected: boolean;
  onClick: () => void;
  color?: string | null;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      // 待办的完成按钮也用 aria-pressed，加一个槽位名把两类东西区分开，
      // 否则「所有 aria-pressed 按钮」这种选择器会同时抓到它们
      data-slot="member-chip"
      style={color ? { borderLeftColor: color, borderLeftWidth: 3 } : undefined}
      className={cn(
        "flex h-10 shrink-0 items-center gap-1.5 rounded-full border px-3 text-sm transition-colors",
        selected
          ? "border-primary bg-primary text-primary-foreground font-medium"
          : "bg-card text-muted-foreground hover:bg-accent hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}