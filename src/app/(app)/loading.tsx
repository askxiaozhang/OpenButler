/** 页面数据未返回时先切换内容区，共享导航保持可用。 */
export default function Loading() {
  return (
    <section role="status" aria-label="正在加载页面" className="motion-safe:animate-pulse">
      <span className="sr-only">正在加载页面…</span>
      <div aria-hidden="true">
        <div className="border-b px-4 pt-[calc(0.75rem+env(safe-area-inset-top))] pb-3">
          <div className="bg-muted h-7 w-24 rounded" />
        </div>
        <div className="space-y-4 p-4">
          <div className="flex gap-2">
            {[0, 1, 2].map((item) => (
              <div key={item} className="bg-muted h-8 w-16 rounded-full" />
            ))}
          </div>
          {[0, 1, 2].map((item) => (
            <div key={item} className="space-y-3 rounded-xl border p-4">
              <div className="bg-muted h-4 w-2/3 rounded" />
              <div className="bg-muted h-3 w-1/3 rounded" />
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
