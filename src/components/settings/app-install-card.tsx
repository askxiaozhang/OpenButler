"use client";

import { useState, useTransition } from "react";
import { Check, Download, LoaderCircle, Smartphone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { usePwa } from "@/components/pwa/pwa-provider";

export function AppInstallCard() {
  const { canInstall, installed, platform, install } = usePwa();
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function runInstall() {
    setMessage(null);
    startTransition(async () => {
      const accepted = await install();
      setMessage(accepted ? "Open家庭管家已安装，可以从桌面或应用列表打开。" : "已取消安装。需要时可以再点一次。");
    });
  }

  return (
    <Card>
      <CardContent className="space-y-4 pt-6">
        <div className="flex items-start gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-2xl bg-[#e7f2e9] text-[#316245]">
            <Smartphone className="size-5" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between gap-3">
              <p className="font-medium">安装Open家庭管家 App</p>
              {installed ? (
                <span className="flex items-center gap-1 text-xs text-emerald-700"><Check className="size-3.5" />已安装</span>
              ) : null}
            </div>
            <p className="text-muted-foreground mt-1 text-xs leading-5">
              安装后独立运行，没有浏览器地址栏，并支持桌面图标、角标和通知。
            </p>
          </div>
        </div>

        {!installed && platform === "android" ? (
          canInstall ? (
            <Button type="button" size="sm" onClick={runInstall} disabled={pending}>
              {pending ? <LoaderCircle className="animate-spin" /> : <Download />}
              安装到安卓手机
            </Button>
          ) : (
            <div className="rounded-xl bg-secondary/60 px-3 py-3 text-xs leading-6">
              用 Chrome 打开本站，点右上角菜单，再选“安装应用”或“添加到主屏幕”。
            </div>
          )
        ) : null}

        {!installed && platform === "ios" ? (
          <div className="rounded-xl bg-secondary/60 px-3 py-3 text-xs leading-6">
            Safari 中点“分享” → “添加到主屏幕” → 打开“作为 Web App”。
          </div>
        ) : null}

        {!installed && platform === "other" && canInstall ? (
          <Button type="button" size="sm" onClick={runInstall} disabled={pending}>
            {pending ? <LoaderCircle className="animate-spin" /> : <Download />}
            安装应用
          </Button>
        ) : null}

        {message ? <p className="text-muted-foreground text-xs">{message}</p> : null}
      </CardContent>
    </Card>
  );
}
