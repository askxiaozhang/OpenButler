"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth/guard";
import { fail, ok, type ActionResult } from "@/lib/action-result";
import {
  cancelProposalByMessage,
  confirmProposalByMessage,
  handleChatMessage,
  listWebChatMessages,
  webChatScope,
  type ChatMessageView,
} from "@/lib/chat/service";
import { createPairingCode, removeQqBinding } from "@/lib/qq/pairing";
import { productImportEditSchema } from "@/lib/products/import-types";

export async function sendChatMessageAction(
  text: string,
  clientMessageId: string,
  attachmentIds: string[] = [],
): Promise<ActionResult<{ messages: ChatMessageView[] }>> {
  const user = await requireUser();
  if (!/^[a-zA-Z0-9-]{8,80}$/.test(clientMessageId)) return fail("消息标识无效，请重试");
  if (!Array.isArray(attachmentIds) || attachmentIds.length > 1 || attachmentIds.some((id) => typeof id !== "string" || !/^[a-zA-Z0-9-]{8,100}$/.test(id))) return fail("附件信息无效");

  try {
    await handleChatMessage({
      userId: user.id,
      channel: "WEB",
      scope: webChatScope(user.id),
      text,
      sourceKey: `web:${user.id}:${clientMessageId}`,
      attachmentIds,
    });
    return ok({ messages: await listWebChatMessages(user.id) });
  } catch (error) {
    console.error("[chat.send]", error);
    return fail("管家暂时没有回应，请稍后再试");
  }
}

export async function confirmChatProductAction(messageId: string, input: unknown): Promise<ActionResult<{ messages: ChatMessageView[] }>> {
  const user = await requireUser();
  const parsed = productImportEditSchema.safeParse(input);
  if (!parsed.success) return fail("请检查产品名称、品牌和型号");
  try {
    const result = await confirmProposalByMessage(user.id, messageId, parsed.data);
    if (!result.ok) return fail(result.error);
    revalidatePath("/products");
    revalidatePath("/chat");
    return ok({ messages: await listWebChatMessages(user.id) });
  } catch {
    return fail("入库失败，识别结果和附件仍保留着。请确认文件没有被移除后重试。");
  }
}

export async function confirmChatProposalAction(
  messageId: string,
): Promise<ActionResult<{ messages: ChatMessageView[] }>> {
  const user = await requireUser();
  const result = await confirmProposalByMessage(user.id, messageId);
  if (!result.ok) return fail(result.error);
  revalidatePath("/", "layout");
  return ok({ messages: await listWebChatMessages(user.id) });
}

export async function cancelChatProposalAction(
  messageId: string,
): Promise<ActionResult<{ messages: ChatMessageView[] }>> {
  const user = await requireUser();
  const result = await cancelProposalByMessage(user.id, messageId);
  if (!result.ok) return fail(result.error);
  return ok({ messages: await listWebChatMessages(user.id) });
}

export async function createQqPairingCodeAction(): Promise<
  ActionResult<{ code: string; expiresAt: string }>
> {
  const user = await requireUser();
  try {
    return ok(await createPairingCode(user.id));
  } catch (error) {
    console.error("[qq.pairing.create]", error);
    return fail("暂时无法生成绑定码，请稍后再试");
  }
}

export async function removeQqBindingAction(bindingId: string): Promise<ActionResult> {
  const user = await requireUser();
  if (!(await removeQqBinding(user.id, bindingId))) return fail("这个 QQ 连接不存在");
  revalidatePath("/chat");
  return ok();
}

/** 开启时会向选定群发送测试消息，验证 QQ 的主动发言权限。 */
export async function setQqGroupRemindersAction(bindingId: string, enabled: boolean): Promise<ActionResult> {
  const user = await requireUser();
  try {
    const { setQqGroupReminders } = await import("@/lib/qq/reminders");
    const result = await setQqGroupReminders(user.id, bindingId, enabled);
    revalidatePath("/chat");
    return result.ok ? ok() : fail(result.error);
  } catch {
    return fail("群提醒设置失败，请稍后重试");
  }
}
