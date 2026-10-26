"use client";

import { useState, useTransition } from "react";
import { Check, Copy, KeyRound, LoaderCircle, Mic2, RefreshCw, Trash2, Watch } from "lucide-react";
import {
  createShortcutCredentialAction,
  revokeShortcutCredentialAction,
} from "@/actions/shortcut";
import { Button } from "@/components/ui/button";
import type { ShortcutCredentialView } from "@/lib/shortcut/credential";

export function ShortcutConnectCard({
  endpointUrl,
  initialCredential,
}: {
  endpointUrl: string;
  initialCredential: ShortcutCredentialView | null;
}) {
  const [credential, setCredential] = useState(initialCredential);
  const [token, setToken] = useState<string | null>(null);
  const [copied, setCopied] = useState<"url" | "token" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function createCredential() {
    setError(null);
    startTransition(async () => {
      const result = await createShortcutCredentialAction();
      if (result.ok) {
        setCredential(result.data.credential);
        setToken(result.data.token);
      } else {
        setError(result.error);
      }
    });
  }

  function revoke() {
    setError(null);
    startTransition(async () => {
      const result = await revokeShortcutCredentialAction();
      if (result.ok) {
        setCredential(null);
        setToken(null);
      } else {
        setError(result.error);
      }
    });
  }

  async function copy(value: string, kind: "url" | "token") {
    await navigator.clipboard.writeText(value);
    setCopied(kind);
    window.setTimeout(() => setCopied(null), 1800);
  }

  return (
    <aside className="space-y-4 rounded-[1.5rem] border bg-card p-5 shadow-[0_10px_30px_rgba(51,72,57,0.06)]">
      <div className="flex items-start justify-between gap-3">
        <div className="flex gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-2xl bg-[#eee9fb] text-[#63529b]">
            <Mic2 className="size-5" />
          </span>
          <div>
            <h2 className="text-sm font-semibold">Siri 与 Apple Watch</h2>
            <p className="text-muted-foreground mt-1 text-xs leading-5">抬腕或唤醒 Siri，直接告诉Open家庭管家。</p>
          </div>
        </div>
        <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <span className={`size-2 rounded-full ${credential ? "bg-emerald-500" : "bg-stone-300"}`} />
          {credential ? "已启用" : "未启用"}
        </span>
      </div>

      {!credential ? (
        <div className="rounded-2xl bg-secondary/55 p-4 text-xs leading-6">
          <p className="font-medium">先生成专用密钥</p>
          <p className="text-muted-foreground mt-1">密钥只供你的快捷指令使用，可以随时停用。</p>
          <Button type="button" size="sm" className="mt-3" onClick={createCredential} disabled={pending}>
            {pending ? <LoaderCircle className="animate-spin" /> : <KeyRound />}
            生成密钥
          </Button>
        </div>
      ) : (
        <>
          <div className="rounded-2xl bg-secondary/55 p-4 text-xs leading-6">
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium">当前密钥</span>
              <code>{token ?? credential.tokenHint}</code>
            </div>
            {token ? (
              <div className="mt-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-amber-900">
                现在复制保存。离开本页后只显示缩略值。
              </div>
            ) : null}
            <div className="mt-3 flex flex-wrap gap-2">
              {token ? (
                <Button type="button" size="sm" variant="outline" onClick={() => copy(token, "token")}>
                  {copied === "token" ? <Check /> : <Copy />}
                  复制密钥
                </Button>
              ) : null}
              <Button type="button" size="sm" variant="outline" onClick={createCredential} disabled={pending}>
                {pending ? <LoaderCircle className="animate-spin" /> : <RefreshCw />}
                重新生成
              </Button>
              <Button type="button" size="sm" variant="ghost" onClick={revoke} disabled={pending}>
                <Trash2 />
                停用
              </Button>
            </div>
          </div>

          <details className="rounded-2xl border px-4 py-3 text-xs" open={Boolean(token)}>
            <summary className="cursor-pointer select-none font-medium">在 iPhone 上创建快捷指令</summary>
            <ol className="text-muted-foreground mt-3 list-decimal space-y-2 pl-4 leading-5">
              <li>新建快捷指令，命名为“Open家庭管家”。</li>
              <li>添加“听写文本”。</li>
              <li>添加“获取 URL 内容”，方法选 POST，请求正文选 JSON。</li>
              <li>JSON 增加文本字段 <code>text</code>，值选“听写的文本”。</li>
              <li>请求头增加 <code>Authorization</code>，值填 <code>Bearer 空格+密钥</code>。</li>
              <li>从返回结果取 <code>reply</code>，再添加“朗读文本”。</li>
              <li>在快捷指令详情中打开“在 Apple Watch 上显示”。</li>
            </ol>
            <button
              type="button"
              className="text-muted-foreground mt-3 flex w-full items-center justify-between gap-3 rounded-xl border bg-background px-3 py-2 text-left"
              onClick={() => copy(endpointUrl, "url")}
            >
              <span className="min-w-0 truncate font-mono text-[10px]">{endpointUrl}</span>
              {copied === "url" ? <Check className="size-3.5 shrink-0" /> : <Copy className="size-3.5 shrink-0" />}
            </button>
          </details>

          <div className="flex items-start gap-2 rounded-2xl border px-3 py-2.5 text-xs leading-5 text-muted-foreground">
            <Watch className="mt-0.5 size-4 shrink-0" />
            <p>对 Siri 说“Open家庭管家”，或把它加入手表表盘。要保存提案，再运行一次并说“确认”。</p>
          </div>
        </>
      )}
      {error ? <p className="text-destructive text-xs">{error}</p> : null}
    </aside>
  );
}
