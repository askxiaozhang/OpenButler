/**
 * 尚未实现的页面占位。
 *
 * 存在的意义是让导航结构在阶段 1 就能跑通 —— 点每个 Tab 都有东西，
 * 而不是撞上 404 让人分不清「还没做」和「坏了」。各阶段实现真实内容时删掉即可。
 */
export function ComingSoon({ note }: { note: string }) {
  return (
    <div className="p-4">
      <div className="border-muted-foreground/25 text-muted-foreground rounded-xl border border-dashed p-6 text-center text-sm">
        {note}
      </div>
    </div>
  );
}