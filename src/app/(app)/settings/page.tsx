import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { logout } from "@/actions/auth";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ChangePasswordDialog } from "@/components/settings/change-password-dialog";
import { AppInstallCard } from "@/components/settings/app-install-card";
import { PushSettingsCard } from "@/components/settings/push-settings-card";
import { requireUser } from "@/lib/auth/guard";
import { verifyPassword } from "@/lib/auth/password";
import { db } from "@/lib/db";
import { isAiEnabled, AI_MODEL } from "@/lib/ai/config";

export const metadata = { title: "我的 · 家庭管家" };

/** 兼容旧版部署：检测历史弱口令。新安装要求自行配置至少 12 位密码。 */
const DEFAULT_SEED_PASSWORD = "family123";

export default async function SettingsPage() {
  const user = await requireUser();

  const [row, memberCount, routineCount] = await Promise.all([
    db().user.findUnique({ where: { id: user.id }, select: { passwordHash: true } }),
    db().member.count({ where: { archivedAt: null } }),
    db().recurrence.count({ where: { active: true } }),
  ]);

  // 校验一次初始口令是否还在用。scrypt 大约 30ms，而这个页面访问频率极低，
  // 换来的是一条能防止「带着弱口令上线」的提醒，值。
  const stillDefault = row
    ? await verifyPassword(DEFAULT_SEED_PASSWORD, row.passwordHash)
    : false;

  const aiOn = isAiEnabled();

  return (
    <>
      <PageHeader title="我的" />

      <div className="space-y-4 p-4">
        <Card>
          <CardContent className="flex items-center gap-3 pt-6">
            <span className="text-2xl">{user.member?.emoji ?? "👤"}</span>
            <div className="min-w-0">
              <p className="truncate font-medium">
                {user.member?.name ?? user.displayName}
              </p>
              <p className="text-muted-foreground truncate text-sm">@{user.username}</p>
            </div>
          </CardContent>
        </Card>

        <ChangePasswordDialog isDefaultPassword={stillDefault} />

        <AppInstallCard />

        <PushSettingsCard
          configured={Boolean(
            process.env.WEB_PUSH_VAPID_PUBLIC_KEY?.trim() &&
              process.env.WEB_PUSH_VAPID_PRIVATE_KEY?.trim(),
          )}
          publicKey={process.env.WEB_PUSH_VAPID_PUBLIC_KEY?.trim() ?? ""}
        />

        <section className="space-y-2">
          <h2 className="text-muted-foreground text-sm font-medium">家里的设置</h2>
          <nav className="divide-y overflow-hidden rounded-xl border">
            <Row href="/products" label="产品资料库" hint="说明书与使用笔记" />
            <Row href="/members" label="角色管理" hint={`${memberCount} 个角色`} />
            <Row href="/routines" label="周期事项" hint={`${routineCount} 项进行中`} />
            {user.role === "ADMIN" ? (
              <Row href="/users" label="账号管理" hint="添加和维护家人账号" />
            ) : null}
          </nav>
        </section>

        <section className="space-y-2">
          <h2 className="text-muted-foreground text-sm font-medium">AI 管家</h2>
          <div className="rounded-xl border px-4 py-3 text-sm">
            {aiOn ? (
              <>
                <p>已配置 DeepSeek</p>
                <p className="text-muted-foreground mt-0.5 text-xs">
                  当前用 <code>{AI_MODEL}</code> 解析你说的话。
                </p>
              </>
            ) : (
              <>
                <p>还没接入模型</p>
                <p className="text-muted-foreground mt-0.5 text-xs">
                  现在用本地的中文解析器理解你说的话，功能不受影响 ——
                  它认得「每 14 天」「31 天后」「提醒妈」这些说法。
                  想换成真模型，在环境变量里配上 <code>DEEPSEEK_API_KEY</code> 即可。
                </p>
              </>
            )}
          </div>
        </section>

        <form action={logout}>
          <Button type="submit" variant="outline" className="h-11 w-full">
            退出登录
          </Button>
        </form>
      </div>
    </>
  );
}

function Row({
  href,
  label,
  hint,
}: {
  href: string;
  label: string;
  hint: string;
}) {
  return (
    <Link
      href={href}
      className="hover:bg-accent flex items-center justify-between gap-3 px-4 py-3 text-sm"
    >
      <span>{label}</span>
      <span className="text-muted-foreground flex items-center gap-2 text-xs">
        {hint}
        <ChevronRight className="size-4" />
      </span>
    </Link>
  );
}
