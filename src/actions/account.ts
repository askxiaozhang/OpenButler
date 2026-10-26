"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth/guard";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { fail, ok, type ActionResult } from "@/lib/action-result";

/**
 * 账号设置。
 *
 * 登录用户可以修改自己的密码；旧版共享弱口令仍被拒绝。
 */

const changePasswordSchema = z
  .object({
    current: z.string().min(1, "请输入当前密码"),
    next: z
      .string()
      .min(8, "新密码至少 8 位")
      .max(256)
      // 不强制大小写/符号 —— 家庭应用的密码强度靠长度更实际，
      // 强制复杂度只会让人写在便签上
      .refine((v) => v !== "family123", "别用默认密码"),
    confirm: z.string(),
  })
  .refine((v) => v.next === v.confirm, {
    message: "两次输入的新密码不一致",
    path: ["confirm"],
  });

export async function changePassword(
  _prev: ActionResult<void> | null,
  formData: FormData,
): Promise<ActionResult<void>> {
  const user = await requireUser();

  const parsed = changePasswordSchema.safeParse({
    current: formData.get("current"),
    next: formData.get("next"),
    confirm: formData.get("confirm"),
  });

  if (!parsed.success) {
    return fail("请检查填写的内容", parsed.error.flatten().fieldErrors);
  }

  const row = await db().user.findUnique({ where: { id: user.id } });
  if (!row) return fail("账号不存在");

  const okCurrent = await verifyPassword(parsed.data.current, row.passwordHash);
  if (!okCurrent) {
    return fail("当前密码不对", { current: ["当前密码不对"] });
  }

  await db().user.update({
    where: { id: user.id },
    data: { passwordHash: await hashPassword(parsed.data.next) },
  });

  revalidatePath("/settings");
  return ok();
}