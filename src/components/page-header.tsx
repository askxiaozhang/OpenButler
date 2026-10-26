/**
 * 页面标题栏。移动端顶部会贴到状态栏，所以用 safe-area padding 顶开。
 */
export function PageHeader({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <header className="bg-background/95 sticky top-0 z-30 border-b border-border/70 px-5 pt-[calc(1.25rem+env(safe-area-inset-top))] pb-5 backdrop-blur-md">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="truncate text-2xl font-semibold tracking-tight md:text-[28px]">
            {title}
          </h1>
          {subtitle ? (
            <p className="text-muted-foreground mt-1.5 text-xs md:text-sm">
              {subtitle}
            </p>
          ) : null}
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>
    </header>
  );
}