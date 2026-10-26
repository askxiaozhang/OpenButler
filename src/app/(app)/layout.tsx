import { AppShell } from "@/components/app-shell";
import { requireUser } from "@/lib/auth/guard";

/**
 * 应用主布局。
 *
 * 这里是**真正的**身份校验点（proxy.ts 只做了 cookie 存在性检查）。
 * requireUser() 会验签 + 查库，失败直接重定向到 /login。
 */
export default async function AppLayout({ children }: LayoutProps<"/">) {
  const user = await requireUser();

  return (
    <AppShell userLabel={user.member?.name ?? user.displayName}>
      {children}
    </AppShell>
  );
}