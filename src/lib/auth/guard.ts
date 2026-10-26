import { cache } from "react";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { getSessionUserId } from "./session";
import type { Member, User, UserRole } from "@/generated/prisma/client";

/**
 * 真正的身份校验：验签 + 查库。
 *
 * 用 React 的 `cache()` 包一层，让同一个请求内的多次调用只查一次库 ——
 * 布局组件和页面组件往往都要读当前用户，没有这层会重复查询。
 */
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const userId = await getSessionUserId();
  if (!userId) return null;

  const user = await db().user.findUnique({
    where: { id: userId },
    include: { member: true },
  });

  // 会话签名有效但用户已删除或被管理员停用 —— 都当作未登录处理。
  if (!user || !user.active) return null;

  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    role: user.role,
    member: user.member,
  };
});

/** 需要登录的页面/动作调它。未登录直接跳登录页，调用方拿到的必然是非空用户。 */
export async function requireUser(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

/** 管理账号与密码属于高权限操作，所有 Server Action 也必须走这一层。 */
export async function requireAdmin(): Promise<CurrentUser> {
  const user = await requireUser();
  if (user.role !== "ADMIN") redirect("/");
  return user;
}

export interface CurrentUser {
  id: string;
  username: string;
  displayName: string;
  role: UserRole;
  /** 该账号关联的角色。宠物不登录，所以这里可能为 null。 */
  member: Member | null;
}

export type { User };
