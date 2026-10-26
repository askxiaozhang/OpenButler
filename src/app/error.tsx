"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

/**
 * 全局错误边界。
 *
 * 生产环境 Next 会把服务端异常的详情抹掉，只留一句 "An error occurred"。
 * 这里给用户一个能自己走出来的出口（重试 / 回首页），而不是只看到一片红。
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const router = useRouter();

  useEffect(() => {
    // digest 是服务端错误在日志里的对应标识 —— 有了它才能去 Vercel 日志里捞到原文
    console.error("[app error]", error.digest ?? "", error.message);
  }, [error]);

  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-4 p-6 text-center">
      <div className="text-4xl">😵</div>
      <h1 className="text-lg font-medium">出了点问题</h1>
      <p className="text-muted-foreground max-w-sm text-sm">
        页面没能正常加载。若刚刚更新过应用，请刷新页面后再试；若仍持续发生，再检查网络或数据库连接。
      </p>
      {error.digest ? (
        <p className="text-muted-foreground/70 font-mono text-xs">
          错误编号 {error.digest}
        </p>
      ) : null}
      <div className="flex gap-2">
        <Button onClick={reset} className="h-10">
          重试
        </Button>
        <Button
          variant="outline"
          className="h-10"
          onClick={() => router.push("/")}
        >
          回首页
        </Button>
      </div>
    </main>
  );
}
