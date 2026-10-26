"use server";

import { revalidatePath } from "next/cache";
import { fail, ok, type ActionResult } from "@/lib/action-result";
import { requireUser } from "@/lib/auth/guard";
import {
  createOrRotateShortcutCredential,
  revokeShortcutCredential,
  type ShortcutCredentialView,
} from "@/lib/shortcut/credential";

export async function createShortcutCredentialAction(): Promise<
  ActionResult<{ token: string; credential: ShortcutCredentialView }>
> {
  const user = await requireUser();
  try {
    const result = await createOrRotateShortcutCredential(user.id);
    revalidatePath("/chat");
    return ok(result);
  } catch (error) {
    console.error("[shortcut.credential.create]", error);
    return fail("暂时无法生成快捷指令密钥，请稍后再试");
  }
}

export async function revokeShortcutCredentialAction(): Promise<ActionResult> {
  const user = await requireUser();
  try {
    await revokeShortcutCredential(user.id);
    revalidatePath("/chat");
    return ok();
  } catch (error) {
    console.error("[shortcut.credential.revoke]", error);
    return fail("暂时无法停用快捷指令，请稍后再试");
  }
}
