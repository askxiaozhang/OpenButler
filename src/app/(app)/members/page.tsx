import { PageHeader } from "@/components/page-header";
import { MemberList } from "@/components/members/member-list";
import { MemberFormDialog } from "@/components/members/member-form-dialog";
import { requireUser } from "@/lib/auth/guard";
import { db } from "@/lib/db";

export const metadata = { title: "角色管理 · Open家庭管家" };

export default async function MembersPage() {
  await requireUser();

  const members = await db().member.findMany({
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
  });

  const activeCount = members.filter((m) => !m.archivedAt).length;

  return (
    <>
      <PageHeader
        title="角色管理"
        subtitle="记录和待办都归属于某个角色"
        // 新建入口常驻在标题栏。放在分组内部的话，一旦两个分组都非空就再也
        // 找不到添加入口了 —— 这是很容易漏掉的一种「空状态才能用」缺陷。
        action={<MemberFormDialog nextSortOrder={activeCount} />}
      />
      <div className="p-4">
        <MemberList members={members} />
      </div>
    </>
  );
}