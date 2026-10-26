import { PageHeader } from "@/components/page-header";
import { MemberFilterChips } from "@/components/members/member-filter-chips";
import { EntryFormDialog } from "@/components/entries/entry-form-dialog";
import { RecordList } from "@/components/records/record-list";
import { requireUser } from "@/lib/auth/guard";
import { db } from "@/lib/db";
import { byMember, entryInclude, toRecordView } from "@/lib/queries";
import { today } from "@/lib/time";

export const metadata = { title: "记录 · Open家庭管家" };

export default async function RecordsPage({
  searchParams,
}: PageProps<"/records">) {
  await requireUser();

  const params = await searchParams;
  const memberId = typeof params.member === "string" ? params.member : undefined;

  const todayStr = today();

  const [members, records] = await Promise.all([
    db().member.findMany({
      where: { archivedAt: null },
      orderBy: { sortOrder: "asc" },
    }),
    db().record.findMany({
      where: byMember(memberId),
      include: entryInclude,
      // 记录会一直累积，按天倒序取最近一屏足够
      orderBy: [{ occurredOn: "desc" }, { occurredAt: "desc" }],
      take: 100,
    }),
  ]);

  const views = records.map(toRecordView);
  const activeMember = members.find((m) => m.id === memberId);

  return (
    <>
      <PageHeader
        title="记录"
        subtitle={activeMember ? `只看「${activeMember.name}」相关` : undefined}
        action={<EntryFormDialog kind="record" members={members} defaultDate={todayStr} />}
      />

      <div className="space-y-4 p-4">
        <MemberFilterChips members={members} activeId={memberId} />
        <RecordList
          records={views}
          today={todayStr}
          emptyHint={
            activeMember
              ? `「${activeMember.name}」名下还没有记录。`
              : "还没有记录。用右上角「记一笔」开始。"
          }
        />
        {records.length >= 100 ? (
          <p className="text-muted-foreground text-center text-xs">
            只显示最近 100 条
          </p>
        ) : null}
      </div>
    </>
  );
}