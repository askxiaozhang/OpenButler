"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/lib/db";
import { verifyPassword } from "@/lib/auth/password";
import { createSession, destroySession } from "@/lib/auth/session";

export interface LoginState {
  error?: string;
}

const loginSchema = z.object({
  username: z.string().trim().min(1).max(64),
  password: z.string().min(1).max(256),
  next: z.string().optional(),
});

export async function login(
  _prev: LoginState,
  formData: FormData,
): Promise<LoginState> {
  const parsed = loginSchema.safeParse({
    username: formData.get("username"),
    password: formData.get("password"),
    next: formData.get("next") ?? undefined,
  });

  if (!parsed.success) {
    return { error: "请输入用户名和密码" };
  }

  const { username, password, next } = parsed.data;

  const user = await db().user.findUnique({ where: { username } });

  // 用户不存在时也要跑一次哈希校验，让两条分支耗时接近。
  // 否则「用户不存在」会立刻返回，可以通过响应时间枚举出有哪些用户名。
  // 这里用一个固定的假哈希，保证耗时不泄露信息。
  const passwordOk = user
    ? await verifyPassword(password, user.passwordHash)
    : await verifyPassword(password, DUMMY_HASH);

  // 停用账号沿用同一条错误文案，避免外部人据此枚举账号状态。
  if (!user || !user.active || !passwordOk) {
    return { error: "用户名或密码不正确" };
  }

  await createSession(user.id);

  // 只接受站内相对路径，防开放重定向（`next=//evil.com` 是协议相对 URL）
  const target =
    next && next.startsWith("/") && !next.startsWith("//") ? next : "/";
  redirect(target);
}

export async function logout(): Promise<void> {
  await destroySession();
  redirect("/login");
}

/**
 * 一个格式合法但永不匹配的哈希，用于「用户不存在」分支的等时比较。
 * 对应明文是一个随机字符串，没人知道，所以永远不会验证通过。
 */
const DUMMY_HASH =
  "scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
