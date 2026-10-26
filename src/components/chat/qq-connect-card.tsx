"use client";

import { useState, useTransition } from "react";
import { Check, Copy, Link2, LoaderCircle, MessageCircleMore, Trash2 } from "lucide-react";
import { createQqPairingCodeAction, removeQqBindingAction, setQqGroupRemindersAction } from "@/actions/chat";
import { Button } from "@/components/ui/button";
import type { QqBindingView } from "@/lib/qq/pairing";

export function QqConnectCard({
  configured,
  webhookUrl,
  bindings,
}: {
  configured: boolean;
  webhookUrl: string;
  bindings: QqBindingView[];
}) {
  const [pairing, setPairing] = useState<{ code: string; expiresAt: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function createCode() {
    setError(null);
    startTransition(async () => {
      const result = await createQqPairingCodeAction();
      if (result.ok) setPairing(result.data);
      else setError(result.error);
    });
  }

  function toggleReminders(id: string, enabled: boolean) {
    setError(null);
    startTransition(async () => {
      const result = await setQqGroupRemindersAction(id, enabled);
      if (!result.ok) setError(result.error);
    });
  }

  function remove(id: string) {
    setError(null);
    startTransition(async () => {
      const result = await removeQqBindingAction(id);
      if (!result.ok) setError(result.error);
    });
  }

  return (
    <aside className="space-y-4 rounded-[1.5rem] border bg-card p-5 shadow-[0_10px_30px_rgba(51,72,57,0.06)]">
      <div className="flex items-start justify-between gap-3">
        <div className="flex gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-2xl bg-[#e7f2e9] text-[#316245]">
            <MessageCircleMore className="size-5" />
          </span>
          <div>
            <h2 className="text-sm font-semibold">连接 QQ</h2>
            <p className="text-muted-foreground mt-1 text-xs leading-5">私聊或群里 @机器人，都能告诉管家。</p>
          </div>
        </div>
        <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <span className={`size-2 rounded-full ${configured ? "bg-emerald-500" : "bg-amber-400"}`} />
          {configured ? "已启用" : "待配置"}
        </span>
      </div>

      {configured ? (
        <>
          <div className="rounded-2xl bg-secondary/55 p-4 text-xs leading-6">
            <p className="font-medium">首次连接</p>
            <p className="text-muted-foreground mt-1">生成短码后，在 QQ 私聊或目标群里发送：</p>
            {pairing ? (
              <div className="mt-3 flex items-center justify-between rounded-xl border bg-card px-3 py-2.5">
                <code className="text-base font-semibold tracking-[0.18em]">/bind {pairing.code}</code>
                <button
                  type="button"
                  aria-label="复制绑定指令"
                  className="text-muted-foreground hover:text-foreground p-1"
                  onClick={async () => {
                    await navigator.clipboard.writeText(`/bind ${pairing.code}`);
                    setCopied(true);
                  }}
                >
                  {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
                </button>
              </div>
            ) : null}
            <Button type="button" size="sm" className="mt-3" onClick={createCode} disabled={pending}>
              {pending ? <LoaderCircle className="animate-spin" /> : <Link2 />}
              {pairing ? "重新生成" : "生成 6 位绑定码"}
            </Button>
            {pairing ? <p className="text-muted-foreground mt-2">短码 10 分钟内有效，使用一次后失效。</p> : null}
          </div>

          {bindings.length ? (
            <div>
              <p className="mb-2 text-xs font-medium">已连接</p>
              <div className="space-y-2">
                {bindings.map((binding) => (
                  <div key={binding.id} className="rounded-xl border px-3 py-2.5 text-xs">
                    <div className="flex items-center justify-between">
                    <span className="min-w-0 truncate">{binding.label}</span>
                    <button
                      type="button"
                      aria-label="解除连接"
                      className="text-muted-foreground hover:text-destructive ml-2 p-1"
                      onClick={() => remove(binding.id)}
                      disabled={pending}
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                    </div>
                    {binding.isGroup ? (
                      <div className="mt-3 space-y-2 border-t pt-3">
                        <p className="font-medium">群定时提醒 · {binding.remindersEnabled ? "已开启" : "未开启"}</p>
                        <p className="text-muted-foreground leading-5">开启后，家庭中设置了具体时间的待办会主动发送到本群。指定“谁去办”且该角色已在本群绑定 QQ 时，会自动 @对应成员。手机通知也会继续发送。</p>
                        <Button type="button" size="sm" variant="outline" disabled={pending}
                          onClick={() => toggleReminders(binding.id, !binding.remindersEnabled)}>
                          {pending ? <LoaderCircle className="animate-spin" /> : null}
                          {binding.remindersEnabled ? "关闭本群提醒" : "发送测试并开启"}
                        </Button>
                        {binding.reminderLastError ? <p className="text-destructive leading-5">{binding.reminderLastError}</p> : null}
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </>
      ) : (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-xs leading-6 text-amber-900">
          服务器还没有启用 QQ 机器人。配置完成后，这里会自动出现绑定入口。
        </div>
      )}

      <details className="text-xs text-muted-foreground">
        <summary className="cursor-pointer select-none">QQ 平台回调地址</summary>
        <button
          type="button"
          className="mt-2 block w-full truncate rounded-xl border bg-background px-3 py-2 text-left font-mono text-[11px]"
          onClick={() => navigator.clipboard.writeText(webhookUrl)}
          title="点击复制"
        >
          {webhookUrl}
        </button>
      </details>
      {error ? <p className="text-destructive text-xs">{error}</p> : null}
    </aside>
  );
}
