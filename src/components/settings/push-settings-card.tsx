"use client";

import { useEffect, useState, useTransition } from "react";
import { Bell, BellOff, Check, LoaderCircle, Send, Smartphone } from "lucide-react";
import {
  removePushSubscriptionAction,
  savePushSubscriptionAction,
  sendTestPushAction,
} from "@/actions/push";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

type InstallState = "checking" | "ios-browser" | "ready" | "unsupported";

export function PushSettingsCard({
  configured,
  publicKey,
}: {
  configured: boolean;
  publicKey: string;
}) {
  const [installState, setInstallState] = useState<InstallState>("checking");
  const [subscription, setSubscription] = useState<PushSubscription | null>(null);
  const [permission, setPermission] = useState<NotificationPermission>("default");
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    async function initialize() {
      // 等一个微任务再同步浏览器状态，避免 effect 本身产生级联渲染。
      await Promise.resolve();
      if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
        setInstallState("unsupported");
        return;
      }
      const ios = /iPhone|iPad|iPod/i.test(navigator.userAgent);
      const standalone =
        window.matchMedia("(display-mode: standalone)").matches ||
        Boolean((navigator as Navigator & { standalone?: boolean }).standalone);
      setInstallState(ios && !standalone ? "ios-browser" : "ready");
      setPermission(Notification.permission);

      const registration = await navigator.serviceWorker.ready;
      setSubscription(await registration.pushManager.getSubscription());
    }
    void initialize();
  }, []);

  function enable() {
    setMessage(null);
    startTransition(async () => {
      try {
        const nextPermission = await Notification.requestPermission();
        setPermission(nextPermission);
        if (nextPermission !== "granted") {
          setMessage("没有获得通知权限。可以在 iPhone 设置 → 通知 → Open家庭管家中重新开启。");
          return;
        }
        const registration = await navigator.serviceWorker.ready;
        const current =
          (await registration.pushManager.getSubscription()) ??
          (await registration.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: base64UrlToBytes(publicKey),
          }));
        const json = current.toJSON();
        const result = await savePushSubscriptionAction({
          endpoint: current.endpoint,
          keys: { p256dh: json.keys?.p256dh, auth: json.keys?.auth },
        });
        if (!result.ok) {
          setMessage(result.error);
          return;
        }
        setSubscription(current);
        setMessage("通知已开启。每天上午 9 点会提醒到期和逾期待办。");
      } catch (error) {
        console.error("[push.enable]", error);
        setMessage("开启通知失败，请确认已从主屏幕图标打开Open家庭管家。");
      }
    });
  }

  function disable() {
    if (!subscription) return;
    setMessage(null);
    startTransition(async () => {
      const endpoint = subscription.endpoint;
      await subscription.unsubscribe();
      const result = await removePushSubscriptionAction(endpoint);
      if (!result.ok) setMessage(result.error);
      else {
        setSubscription(null);
        setMessage("这台设备的通知已关闭。");
      }
    });
  }

  function test() {
    setMessage(null);
    startTransition(async () => {
      const result = await sendTestPushAction();
      setMessage(result.ok ? "测试通知已发送，请查看通知中心。" : result.error);
    });
  }

  const enabled = Boolean(subscription && permission === "granted");

  return (
    <Card>
      <CardContent className="space-y-4 pt-6">
        <div className="flex items-start gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-2xl bg-[#eee9fb] text-[#63529b]">
            {enabled ? <Bell className="size-5" /> : <Smartphone className="size-5" />}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between gap-3">
              <p className="font-medium">待办通知</p>
              <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <span className={`size-2 rounded-full ${enabled ? "bg-emerald-500" : "bg-stone-300"}`} />
                {enabled ? "已开启" : "未开启"}
              </span>
            </div>
            <p className="text-muted-foreground mt-1 text-xs leading-5">
              每天上午 9 点提醒到期与逾期内容，点通知直接打开待办。
            </p>
          </div>
        </div>

        {!configured ? (
          <p className="rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-900">服务器通知功能尚未配置。</p>
        ) : installState === "ios-browser" ? (
          <div className="rounded-xl bg-secondary/60 px-3 py-3 text-xs leading-6">
            <p className="font-medium">先安装到 iPhone 主屏幕</p>
            <p className="text-muted-foreground mt-1">
              Safari 中点“分享” → “添加到主屏幕” → 打开“作为 Web App”，再从新图标进入“我的”开启通知。
            </p>
          </div>
        ) : installState === "unsupported" ? (
          <p className="rounded-xl bg-secondary/60 px-3 py-2 text-xs">当前浏览器不支持推送通知。</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {enabled ? (
              <>
                <Button type="button" size="sm" variant="outline" onClick={test} disabled={pending}>
                  {pending ? <LoaderCircle className="animate-spin" /> : <Send />}
                  发送测试通知
                </Button>
                <Button type="button" size="sm" variant="ghost" onClick={disable} disabled={pending}>
                  <BellOff />
                  关闭这台设备
                </Button>
              </>
            ) : (
              <Button type="button" size="sm" onClick={enable} disabled={pending || installState === "checking"}>
                {pending ? <LoaderCircle className="animate-spin" /> : <Bell />}
                开启通知
              </Button>
            )}
          </div>
        )}

        {message ? (
          <p className="flex items-start gap-2 text-xs leading-5 text-muted-foreground">
            {enabled ? <Check className="mt-0.5 size-3.5 shrink-0 text-emerald-600" /> : null}
            {message}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}

function base64UrlToBytes(value: string): Uint8Array<ArrayBuffer> {
  const padded = `${value}${"=".repeat((4 - (value.length % 4)) % 4)}`
    .replace(/-/g, "+")
    .replace(/_/g, "/");
  const raw = window.atob(padded);
  const bytes = new Uint8Array(raw.length);
  for (let index = 0; index < raw.length; index += 1) bytes[index] = raw.charCodeAt(index);
  return bytes;
}
