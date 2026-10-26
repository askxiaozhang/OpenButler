import { ChatPanel } from "@/components/chat/chat-panel";
import { QqConnectCard } from "@/components/chat/qq-connect-card";
import { ShortcutConnectCard } from "@/components/chat/shortcut-connect-card";
import { PageHeader } from "@/components/page-header";
import { requireUser } from "@/lib/auth/guard";
import { listWebChatMessages } from "@/lib/chat/service";
import { listQqBindings } from "@/lib/qq/pairing";
import { getShortcutCredential } from "@/lib/shortcut/credential";
import { productStorageConfigured } from "@/lib/products/storage";
import { db } from "@/lib/db";

export const maxDuration = 60;

export default async function ChatPage() {
  const user = await requireUser();
  const [messages, bindings, shortcutCredential, drafts] = await Promise.all([
    listWebChatMessages(user.id),
    listQqBindings(user.id),
    getShortcutCredential(user.id),
    db().productDocument.findMany({ where: { uploadedBy: user.id, productId: null, chatMessageId: null }, orderBy: { createdAt: "desc" }, take: 10, select: { id: true, originalName: true, size: true, ready: true } }),
  ]);
  const configured = Boolean(
    process.env.QQ_BOT_APP_ID?.trim() && process.env.QQ_BOT_APP_SECRET?.trim(),
  );
  const host =
    process.env.APP_URL?.replace(/\/$/, "") ??
    (process.env.VERCEL_PROJECT_PRODUCTION_URL
      ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
      : "http://localhost:3000");

  return (
    <>
      <PageHeader title="管家" subtitle="网页和 QQ，共用同一个家庭记忆" />
      <div className="mx-auto grid max-w-7xl gap-5 px-4 py-5 md:grid-cols-[minmax(0,1fr)_300px] md:px-7">
        <ChatPanel initialMessages={messages} attachmentsConfigured={productStorageConfigured()} initialDrafts={drafts.map((d) => ({ id: d.id, name: d.originalName, size: d.size, status: d.ready ? "ready" : "failed" }))} />
        <div className="space-y-5 md:sticky md:top-28 md:self-start">
          <ShortcutConnectCard
            endpointUrl={`${host}/api/shortcuts/chat`}
            initialCredential={shortcutCredential}
          />
          <QqConnectCard
            configured={configured}
            webhookUrl={`${host}/api/qq/webhook`}
            bindings={bindings}
          />
        </div>
      </div>
    </>
  );
}
