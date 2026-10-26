"use client";

import Link, { useLinkStatus } from "next/link";
import { usePathname } from "next/navigation";
import {
  CalendarDays,
  BookOpen,
  Heart,
  Leaf,
  House,
  ListTodo,
  LoaderCircle,
  MessageCircleMore,
  NotebookPen,
  Settings,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * 移动端底部 Tab / 桌面端左侧栏。
 *
 * 同一个数组渲染两套布局：`<md` 时底部固定 Tab（拇指够得着），`≥md` 时
 * 变成左侧竖排导航。比写两套组件少一半维护量。
 */

const NAV = [
  { href: "/", label: "首页", icon: House },
  { href: "/chat", label: "管家", icon: MessageCircleMore },
  { href: "/tasks", label: "待办", icon: ListTodo },
  { href: "/calendar", label: "日历", icon: CalendarDays },
  { href: "/records", label: "记录", icon: NotebookPen },
  { href: "/settings", label: "我的", icon: Settings },
] as const;

function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** 未完成预加载时也立即反馈点击；图标尺寸固定，避免导航跳动。 */
function NavIcon({ icon: Icon, className }: { icon: LucideIcon; className: string }) {
  const { pending } = useLinkStatus();
  return pending ? (
    <LoaderCircle aria-label="正在切换" className={cn(className, "motion-safe:animate-spin text-primary")} />
  ) : (
    <Icon aria-hidden="true" className={className} />
  );
}

export function AppShell({
  children,
  userLabel,
}: {
  children: React.ReactNode;
  userLabel: string;
}) {
  const pathname = usePathname();

  return (
    <div className="flex min-h-dvh flex-1 flex-col md:flex-row">
      {/* 桌面端侧栏 */}
      <aside className="bg-sidebar text-sidebar-foreground sticky top-0 hidden h-dvh w-60 shrink-0 flex-col px-5 py-8 md:flex lg:w-64">
        <Link href="/" className="mb-12 flex items-center gap-3 px-2" aria-label="家庭管家首页">
          <span className="flex size-11 items-center justify-center rounded-2xl bg-sidebar-primary text-sidebar-primary-foreground">
            <House className="size-6" strokeWidth={1.6} />
          </span>
          <span><span className="block text-lg font-semibold tracking-wider">家庭管家</span><span className="mt-1 block text-[10px] tracking-[0.22em] text-sidebar-foreground/60">OUR LITTLE HOME</span></span>
        </Link>
        <p className="mb-4 px-3 text-[11px] tracking-widest text-sidebar-foreground/50">家的日常</p>

        <nav className="flex flex-1 flex-col gap-2">
          {NAV.map(({ href, label, icon: Icon }) => {
            const active = isActive(pathname, href);
            return (
              <Link
                key={href}
                href={href}
                // 高频入口预取完整数据，其余入口预取 loading 壳，避免同时查询所有页面。
                prefetch={href === "/" || href === "/chat" || href === "/tasks" ? true : null}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex items-center gap-3.5 rounded-xl px-4 py-3.5 text-sm transition-colors",
                  active
                    ? "bg-sidebar-primary text-sidebar-primary-foreground font-semibold"
                    : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                )}
              >
                <NavIcon icon={Icon} className="size-4" />
                {label}
              </Link>
            );
          })}
        </nav>

        <Link href="/products" aria-current={isActive(pathname, "/products") ? "page" : undefined} className={cn("mb-4 flex items-center gap-3.5 rounded-xl px-4 py-3.5 text-sm", isActive(pathname, "/products") ? "bg-sidebar-primary text-sidebar-primary-foreground font-semibold" : "text-sidebar-foreground/70 hover:bg-sidebar-accent")}>
          <BookOpen className="size-4" />产品资料库
        </Link>

        <div className="mb-6 rounded-2xl border border-sidebar-border p-4">
          <Leaf className="mb-3 size-5 text-sidebar-primary" strokeWidth={1.5} />
          <p className="text-sm leading-6 text-sidebar-foreground/90">小事有人记，<br />日子更从容。</p>
        </div>
        <div className="flex items-center gap-3 border-t border-sidebar-border px-2 pt-5">
          <span className="flex size-9 items-center justify-center rounded-full bg-sidebar-accent"><Heart className="size-4" /></span>
          <div className="min-w-0"><p className="truncate text-sm font-medium">{userLabel}</p><p className="mt-0.5 text-[11px] text-sidebar-foreground/55">欢迎回家</p></div>
        </div>
      </aside>

      {/* 主内容区。底部留出 Tab Bar 的高度，否则最后一条会被挡住 */}
      <main className="app-content min-w-0 flex-1 pb-[calc(6rem+env(safe-area-inset-bottom))] md:pb-8">
        {children}
      </main>

      {/* 移动端底部 Tab Bar */}
      <nav className="bg-card/95 fixed inset-x-3 bottom-[max(0.65rem,env(safe-area-inset-bottom))] z-40 flex rounded-[1.5rem] border p-1.5 shadow-[0_4px_24px_#244b3b12] backdrop-blur-md md:hidden">
        {NAV.map(({ href, label, icon: Icon }) => {
          const active = isActive(pathname, href);
          return (
            <Link
              key={href}
              href={href}
              prefetch={href === "/" || href === "/chat" || href === "/tasks" ? true : null}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex min-w-0 flex-1 flex-col items-center gap-1.5 rounded-2xl px-1 py-2.5 text-[11px] transition-colors",
                active ? "bg-secondary text-primary font-semibold" : "text-muted-foreground hover:bg-muted/70",
              )}
            >
              <NavIcon icon={Icon} className={cn("size-5", active && "stroke-[2.5]")} />
              {label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
