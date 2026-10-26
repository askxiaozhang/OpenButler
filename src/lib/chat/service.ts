import { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { applyIntakeActions } from "@/lib/ai/apply";
import { interpret } from "@/lib/ai/intake";
import type { IntakeAction } from "@/lib/ai/types";
import { formatZh, nowInstant, toDateOnly, today } from "@/lib/time";
import { readProductImport, type ProductImportProposal, type ProductImportEdit } from "@/lib/products/import-types";
import { confirmProductImport, proposeProductImport } from "./product-import";

const MAX_MESSAGE_LENGTH = 500;
const HISTORY_LIMIT = 80;

export type ChatChannelValue = "WEB" | "SHORTCUT" | "QQ_PRIVATE" | "QQ_GROUP";
export type ProposalStatusValue = "PENDING" | "APPLYING" | "CONFIRMED" | "CANCELLED";

export interface ChatMessageView {
  id: string;
  role: "user" | "assistant";
  content: string;
  proposalStatus: ProposalStatusValue | null;
  createdAt: string;
  attachments?: { id: string; name: string; size: number; productId: string | null }[];
  productImport?: ProductImportProposal | null;
}

export interface HandleChatInput {
  userId: string;
  channel: ChatChannelValue;
  scope: string;
  text: string;
  /** 浏览器 UUID 或 QQ message id，用于防止平台重试造成重复写入。 */
  sourceKey: string;
  attachmentIds?: string[];
}

export interface HandleChatResult {
  reply: string;
  duplicate: boolean;
}

const messageSelect = {
  id: true,
  role: true,
  content: true,
  proposalStatus: true,
  createdAt: true,
  proposal: true,
  attachments: { select: { id: true, originalName: true, size: true, productId: true } },
} satisfies Prisma.ChatMessageSelect;

export function webChatScope(userId: string): string {
  return `web:${userId}`;
}

export async function listWebChatMessages(userId: string): Promise<ChatMessageView[]> {
  const session = await db().chatSession.findUnique({
    where: { scope: webChatScope(userId) },
    select: {
      messages: {
        orderBy: { createdAt: "desc" },
        take: HISTORY_LIMIT,
        select: messageSelect,
      },
    },
  });
  return (session?.messages ?? []).reverse().map(toView);
}

export async function handleChatMessage(input: HandleChatInput): Promise<HandleChatResult> {
  const attachmentIds = input.attachmentIds ?? [];
  if (attachmentIds.length > 1 || (attachmentIds.length && (input.channel !== "WEB" || input.scope !== webChatScope(input.userId)))) throw new Error("附件来源无效");
  const text = input.text.trim() || (attachmentIds.length ? "帮我识别这份说明书，整理产品资料并入库。" : "");
  if (!text) return { reply: "说点什么吧。", duplicate: false };
  if (text.length > MAX_MESSAGE_LENGTH) {
    return { reply: `一条消息最多 ${MAX_MESSAGE_LENGTH} 个字，请分开发给我。`, duplicate: false };
  }

  const incoming = await createIncomingMessage({ ...input, text });
  if (!incoming) return { reply: "", duplicate: true };

  if (attachmentIds.length) {
    const reply = await proposeProductImport({ userId: input.userId, sessionId: incoming.sessionId, documentId: attachmentIds[0], text });
    return { reply, duplicate: false };
  }

  if (isConfirm(text)) {
    const result = await confirmLatestProposal(input.userId, incoming.sessionId);
    if (result) return { reply: result, duplicate: false };
    const reply = "现在没有待确认的内容。你可以直接告诉我一件事或一个安排。";
    await createAssistantMessage(incoming.sessionId, reply);
    return { reply, duplicate: false };
  }

  if (isCancel(text)) {
    const reply = await cancelLatestProposal(input.userId, incoming.sessionId);
    await createAssistantMessage(incoming.sessionId, reply);
    return { reply, duplicate: false };
  }

  // 对当前产品提案继续纠正信息，复用已上传的同一份说明书。
  if (/(重新识别|再识别|品牌|型号|产品名称|名称改|名字|这是|其实|改成|改为)/.test(text)) {
    const pending = await db().chatMessage.findFirst({ where: { sessionId: incoming.sessionId, proposalStatus: "PENDING", session: { userId: input.userId } }, orderBy: { createdAt: "desc" }, select: { proposal: true } });
    const previous = readProductImport(pending?.proposal);
    if (previous) {
      const reply = await proposeProductImport({ userId: input.userId, sessionId: incoming.sessionId, documentId: previous.documentId, text, previous });
      return { reply, duplicate: false };
    }
    if (/(重新识别|再识别)/.test(text)) {
      const attachment = await db().productDocument.findFirst({ where: { uploadedBy: input.userId, productId: null, ready: true, chatMessage: { sessionId: incoming.sessionId } }, orderBy: { createdAt: "desc" }, select: { id: true } });
      const reply = attachment
        ? await proposeProductImport({ userId: input.userId, sessionId: incoming.sessionId, documentId: attachment.id, text })
        : "没有可重新识别的说明书，请先添加一份 PDF 附件。";
      if (!attachment) await createAssistantMessage(incoming.sessionId, reply);
      return { reply, duplicate: false };
    }
  }

  // 新话题会替换同一会话里尚未确认的旧提案，避免后来一句“确认”保存错内容。
  await db().chatMessage.updateMany({
    where: { sessionId: incoming.sessionId, proposalStatus: "PENDING" },
    data: { proposalStatus: "CANCELLED" },
  });

  const directReply = await answerReadOnlyQuestion(text);
  if (directReply) {
    await createAssistantMessage(incoming.sessionId, directReply);
    return { reply: directReply, duplicate: false };
  }

  const members = await db().member.findMany({
    where: { archivedAt: null },
    orderBy: { sortOrder: "asc" },
    select: { id: true, name: true, aliases: true, kind: true },
  });
  const parsed = await interpret({ text, today: today(), members });

  if (!parsed.ok) {
    const reply = `${parsed.message}\n你可以说得更具体些，例如“猫咪今天剪指甲了”或“周五提醒我交物业费”。`;
    await createAssistantMessage(incoming.sessionId, reply);
    return { reply, duplicate: false };
  }

  const reply = `我理解为：${parsed.summary}\n\n确认后才会保存。回复“确认”保存，回复“取消”放弃。`;
  await db().chatMessage.create({
    data: {
      sessionId: incoming.sessionId,
      role: "ASSISTANT",
      content: reply,
      proposal: parsed.actions as unknown as Prisma.InputJsonValue,
      proposalStatus: "PENDING",
    },
  });
  return { reply, duplicate: false };
}

export async function confirmProposalByMessage(
  userId: string,
  proposalMessageId: string,
  productEdit?: ProductImportEdit,
): Promise<{ ok: true; reply: string } | { ok: false; error: string }> {
  const message = await db().chatMessage.findFirst({
    where: {
      id: proposalMessageId,
      role: "ASSISTANT",
      proposalStatus: "PENDING",
      session: { userId },
    },
    select: { id: true, sessionId: true },
  });
  if (!message) return { ok: false, error: "这条内容已经处理过了" };

  const reply = await confirmClaimedProposal(userId, message.id, message.sessionId, productEdit);
  return reply ? { ok: true, reply } : { ok: false, error: "这条内容已经处理过了" };
}

export async function cancelProposalByMessage(
  userId: string,
  proposalMessageId: string,
): Promise<{ ok: true; reply: string } | { ok: false; error: string }> {
  const message = await db().chatMessage.findFirst({
    where: { id: proposalMessageId, proposalStatus: "PENDING", session: { userId } },
    select: { id: true, sessionId: true },
  });
  if (!message) return { ok: false, error: "这条内容已经处理过了" };

  const changed = await db().chatMessage.updateMany({
    where: { id: message.id, proposalStatus: "PENDING" },
    data: { proposalStatus: "CANCELLED" },
  });
  if (!changed.count) return { ok: false, error: "这条内容已经处理过了" };

  const reply = "好，这条没有保存。";
  await createAssistantMessage(message.sessionId, reply);
  return { ok: true, reply };
}

async function createIncomingMessage(input: HandleChatInput & { text: string }) {
  try {
    return await db().$transaction(async (tx) => {
      const session = await tx.chatSession.upsert({
        where: { scope: input.scope },
        create: { scope: input.scope, channel: input.channel, userId: input.userId },
        update: { channel: input.channel, userId: input.userId },
        select: { id: true },
      });
      const message = await tx.chatMessage.create({
        data: {
          sessionId: session.id,
          role: "USER",
          content: input.text,
          sourceKey: input.sourceKey,
        },
        select: { id: true, sessionId: true },
      });
      for (const id of input.attachmentIds ?? []) {
        const attached = await tx.productDocument.updateMany({
          where: { id, uploadedBy: input.userId, ready: true, productId: null, chatMessageId: null },
          data: { chatMessageId: message.id },
        });
        if (!attached.count) throw new Error("附件不存在、未上传完成或已用于其他消息");
      }
      return message;
    }, { timeout: 15000 });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return null;
    }
    throw error;
  }
}

async function confirmLatestProposal(userId: string, sessionId: string): Promise<string | null> {
  const proposal = await db().chatMessage.findFirst({
    where: { sessionId, proposalStatus: "PENDING", session: { userId } },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });
  if (!proposal) return null;
  return confirmClaimedProposal(userId, proposal.id, sessionId);
}

async function confirmClaimedProposal(
  userId: string,
  proposalMessageId: string,
  sessionId: string,
  productEdit?: ProductImportEdit,
): Promise<string | null> {
  const savedProposal = await db().chatMessage.findFirst({ where: { id: proposalMessageId, sessionId, session: { userId } }, select: { proposal: true } });
  if (readProductImport(savedProposal?.proposal)) return confirmProductImport(userId, proposalMessageId, productEdit);
  const claimed = await db().chatMessage.updateMany({
    where: {
      id: proposalMessageId,
      sessionId,
      proposalStatus: "PENDING",
      session: { userId },
    },
    data: { proposalStatus: "APPLYING" },
  });
  if (!claimed.count) return null;

  const proposal = await db().chatMessage.findUnique({
    where: { id: proposalMessageId },
    select: { proposal: true },
  });

  try {
    const actions = proposal?.proposal as unknown as IntakeAction[] | null;
    if (!actions) throw new Error("提案内容不存在");
    const created = await applyIntakeActions(actions, userId);
    await db().chatMessage.update({
      where: { id: proposalMessageId },
      data: { proposalStatus: "CONFIRMED" },
    });
    const reply = created > 0 ? `好，已经记下 ${created} 条。` : "这件事已经处理过了。";
    await createAssistantMessage(sessionId, reply);
    return reply;
  } catch (error) {
    console.error("[chat.confirm]", error);
    await db().chatMessage.update({
      where: { id: proposalMessageId },
      data: { proposalStatus: "PENDING" },
    });
    const reply = "保存时出了点问题，内容还留着，请稍后再确认一次。";
    await createAssistantMessage(sessionId, reply);
    return reply;
  }
}

async function cancelLatestProposal(userId: string, sessionId: string): Promise<string> {
  const proposal = await db().chatMessage.findFirst({
    where: { sessionId, proposalStatus: "PENDING", session: { userId } },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });
  if (!proposal) return "现在没有待取消的内容。";
  await db().chatMessage.update({
    where: { id: proposal.id },
    data: { proposalStatus: "CANCELLED" },
  });
  return "好，这条没有保存。";
}

async function createAssistantMessage(sessionId: string, content: string) {
  return db().chatMessage.create({
    data: { sessionId, role: "ASSISTANT", content },
    select: messageSelect,
  });
}

async function answerReadOnlyQuestion(text: string): Promise<string | null> {
  const normalized = text.replace(/[？?！!。\s]/g, "");

  if (/^(你好|在吗|嗨|hi|hello|帮助|怎么用|你会什么)$/i.test(normalized)) {
    return "我可以帮你记下发生过的事、安排待办和周期提醒，也能查看待办与最近记录。\n\n例如：\n• 猫咪今天剪指甲了，每 14 天一次\n• 周五提醒我交物业费\n• 今天有什么待办";
  }

  const asksTasks =
    /^(待办|任务|安排|查看待办|看看待办|今天有什么|今天要做什么|最近要做什么)$/.test(
      normalized,
    ) || /^(查看|看看|查询|查一下|有哪些).*(待办|任务|安排)$/.test(normalized);
  if (asksTasks) {
    const rows = await db().task.findMany({
      where: { status: "PENDING" },
      orderBy: [{ dueOn: "asc" }, { createdAt: "asc" }],
      take: 10,
      include: { subject: true, assignee: true },
    });
    if (!rows.length) return "现在没有未完成的待办，家里一切清爽。";
    return [
      `目前有 ${rows.length}${rows.length === 10 ? "+" : ""} 条待办：`,
      ...rows.map((item, index) => {
        const who = item.subject?.name ?? item.assignee?.name;
        return `${index + 1}. ${formatZh(toDateOnly(item.dueOn))} · ${who ? `${who} · ` : ""}${item.title}`;
      }),
    ].join("\n");
  }

  const asksRecords =
    /^(记录|最近记录|查看记录|看看记录|最近做过什么)$/.test(normalized) ||
    /^(查看|看看|查询|查一下).*(记录|做过什么)$/.test(normalized);
  if (asksRecords) {
    const rows = await db().record.findMany({
      orderBy: [{ occurredOn: "desc" }, { occurredAt: "desc" }],
      take: 10,
      include: { subject: true, assignee: true },
    });
    if (!rows.length) return "还没有生活记录。告诉我一件刚发生的事，我会先和你确认。";
    return [
      "最近记录：",
      ...rows.map((item, index) => {
        const who = item.subject?.name ?? item.assignee?.name;
        return `${index + 1}. ${formatZh(toDateOnly(item.occurredOn))} · ${who ? `${who} · ` : ""}${item.title}`;
      }),
    ].join("\n");
  }

  return null;
}

function isConfirm(text: string): boolean {
  return /^(确认|确定|保存|就这样|好的|好|ok|okay)[。！!\s]*$/i.test(text);
}

function isCancel(text: string): boolean {
  return /^(取消|算了|不要|不保存)[。！!\s]*$/.test(text);
}

function toView(message: {
  id: string;
  role: "USER" | "ASSISTANT";
  content: string;
  proposalStatus: ProposalStatusValue | null;
  createdAt: Date;
  proposal?: unknown;
  attachments?: { id: string; originalName: string; size: number; productId: string | null }[];
}): ChatMessageView {
  return {
    id: message.id,
    role: message.role === "USER" ? "user" : "assistant",
    content: message.content,
    proposalStatus: message.proposalStatus,
    createdAt: message.createdAt.toISOString(),
    attachments: message.attachments?.map((a) => ({ id: a.id, name: a.originalName, size: a.size, productId: a.productId })) ?? [],
    productImport: readProductImport(message.proposal),
  };
}

/** 供 pairing 服务使用，避免业务代码直接读取系统时钟。 */
export function expiresInMinutes(minutes: number): Date {
  const value = nowInstant();
  value.setTime(value.getTime() + minutes * 60_000);
  return value;
}
