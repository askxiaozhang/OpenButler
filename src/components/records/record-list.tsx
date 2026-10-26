import { RecordItem } from "./record-item";
import { formatZh, formatRelativeZh, type DateOnly } from "@/lib/time";
import type { RecordView } from "@/lib/queries";

/**
 * 记录流（Server Component）。
 *
 * 按天分组而不是按条平铺 —— 「猫咪今天掏耳朵了」和「昨天剪指甲了」在视觉上
 * 归到各自的日期下，比一串时间戳更容易扫。同一天内按写入顺序倒序。
 */
export function RecordList({
  records,
  today,
  emptyHint = "还没有记录。",
}: {
  records: RecordView[];
  today: DateOnly;
  emptyHint?: string;
}) {
  if (records.length === 0) {
    return (
      <p className="text-muted-foreground border-muted-foreground/25 rounded-xl border border-dashed p-6 text-center text-sm">
        {emptyHint}
      </p>
    );
  }

  // 已经按 occurredOn 倒序取回来了，这里只需保持顺序地分组
  const byDay = new Map<DateOnly, RecordView[]>();
  for (const r of records) {
    const list = byDay.get(r.occurredOn);
    if (list) list.push(r);
    else byDay.set(r.occurredOn, [r]);
  }

  return (
    <div className="space-y-5">
      {[...byDay.entries()].map(([day, items]) => (
        <section key={day} className="space-y-2">
          <h2 className="text-muted-foreground flex items-baseline gap-2 text-sm font-medium">
            {formatZh(day)}
            <span className="text-xs opacity-60">{formatRelativeZh(day, today)}</span>
          </h2>

          <ul className="divide-y overflow-hidden rounded-xl border">
            {items.map((r) => (
              <RecordItem key={r.id} record={r} />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}