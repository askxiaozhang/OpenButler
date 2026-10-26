import { PageHeader } from "@/components/page-header";
import { UserManagement } from "@/components/users/user-management";
import { requireAdmin } from "@/lib/auth/guard";
import { db } from "@/lib/db";

export const metadata = { title: "账号管理 · 家庭管家" };

export default async function UsersPage() {
  await requireAdmin();

  const [users, members] = await Promise.all([
    db().user.findMany({
      select: {
        id: true,
        username: true,
        displayName: true,
        role: true,
        active: true,
        memberId: true,
        member: { select: { name: true, emoji: true } },
      },
      orderBy: [{ role: "asc" }, { createdAt: "asc" }],
    }),
    db().member.findMany({
      where: { kind: "PERSON", archivedAt: null },
      select: { id: true, name: true, emoji: true, user: { select: { id: true } } },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    }),
  ]);

  return (
    <>
      <PageHeader title="账号管理" subtitle="创建家人的登录账号，随时重设密码或停用账号" />
      <div className="p-4">
        <UserManagement users={users} members={members} />
      </div>
    </>
  );
}
