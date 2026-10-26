import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-4 p-6 text-center">
      <div className="text-4xl">🏠</div>
      <h1 className="text-lg font-medium">这里没有东西</h1>
      <p className="text-muted-foreground text-sm">页面可能已经被移动或删掉了。</p>
      <Button
        render={
          <Link href="/" className="h-10 px-4">
            回首页
          </Link>
        }
      />
    </main>
  );
}