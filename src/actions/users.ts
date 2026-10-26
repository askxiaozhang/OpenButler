"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth/guard";
import { hashPassword } from "@/lib/auth/password";
import { fail, fromPrismaError, ok, type ActionResult } from "@/lib/action-result";

const usernameSchema = z
  .string()
  .trim()
  .min(3, "用户名至少 3 个字符")
  .max(64, "用户名不能超过 64 个字符")
  .regex(/^[a-zA-Z0-9_.-]+$/, "用户名只能用字母、数字、点、下划线或短横线");

const displayNameSchema = z.string().trim().min(1, "请输入称呼").max(20, "称呼不能超过 20 个字符");
const passwordSchema = z.string().min(8, "密码至少 8 位").max(256, "密码不能超过 256 位");

const createUserSchema = z
  .object({
    username: usernameSchema,
    displayName: displayNameSchema,
    password: passwordSchema,
    confirm: z.string(),
    memberId: z.string().cuid().optional(),
  })
  .refine((value) => value.password === value.confirm, {
    message: "两次输入的密码不一致",
    path: ["confirm"],
  });

const updateUserSchema = z
  .object({
    username: usernameSchema,
    displayName: displayNameSchema,
    password: z.string().max(256, "密码不能超过 256 位"),
    confirm: z.string(),
    memberId: z.string().cuid().optional(),
    active: z.boolean(),
  })
  .superRefine((value, ctx) => {
    if (value.password.length > 0 && value.password.length < 8) {
      ctx.addIssue({ code: "custom", path: ["password"], message: "密码至少 8 位" });
    }
    if (value.password.length > 0 && value.password !== value.confirm) {
      ctx.addIssue({ code: "custom", path: ["confirm"], message: "两次输入的密码不一致" });
    }
  });

function value(formData: FormData, name: string): string {
  const raw = formData.get(name);
  return typeof raw === "string" ? raw : "";
}

function optionalMemberId(formData: FormData): string | undefined {
  const memberId = value(formData, "memberId");
  return memberId || undefined;
}

async function ensureEligibleMember(memberId?: string) {
  if (!memberId) return true;
  const member = await db().member.findFirst({
    where: { id: memberId, kind: "PERSON", archivedAt: null },
    select: { id: true },
  });
  return Boolean(member);
}

function revalidateUserSurfaces() {
  revalidatePath("/users");
  revalidatePath("/settings");
}

/** 管理员创建家人的普通登录账号。绝不返回 passwordHash 给客户端。 */
export async function createUser(
  _prev: ActionResult<void> | null,
  formData: FormData,
): Promise<ActionResult<void>> {
  await requireAdmin();

  const parsed = createUserSchema.safeParse({
    username: value(formData, "username"),
    displayName: value(formData, "displayName"),
    password: value(formData, "password"),
    confirm: value(formData, "confirm"),
    memberId: optionalMemberId(formData),
  });
  if (!parsed.success) return fail("请检查填写的内容", parsed.error.flatten().fieldErrors);

  if (!(await ensureEligibleMember(parsed.data.memberId))) {
    return fail("关联角色不可用", { memberId: ["只能关联未归档的“人”角色"] });
  }

  try {
    await db().user.create({
      data: {
        username: parsed.data.username,
        displayName: parsed.data.displayName,
        passwordHash: await hashPassword(parsed.data.password),
        memberId: parsed.data.memberId ?? null,
        role: "MEMBER",
      },
    });
    revalidateUserSurfaces();
    return ok();
  } catch (error) {
    return fromPrismaError(error, "createUser", {
      username: "这个用户名已经被使用了",
      memberId: "这个角色已经关联了其他账号",
    });
  }
}

/** 编辑普通账号；管理员自身的密码仍通过“我的 → 修改密码”完成。 */
export async function updateUser(
  id: string,
  _prev: ActionResult<void> | null,
  formData: FormData,
): Promise<ActionResult<void>> {
  await requireAdmin();

  const parsed = updateUserSchema.safeParse({
    username: value(formData, "username"),
    displayName: value(formData, "displayName"),
    password: value(formData, "password"),
    confirm: value(formData, "confirm"),
    memberId: optionalMemberId(formData),
    active: formData.get("active") === "on",
  });
  if (!parsed.success) return fail("请检查填写的内容", parsed.error.flatten().fieldErrors);

  const target = await db().user.findUnique({ where: { id }, select: { role: true } });
  if (!target) return fail("账号不存在");
  if (target.role === "ADMIN") return fail("管理员账号请在“我的”页面修改密码");

  if (!(await ensureEligibleMember(parsed.data.memberId))) {
    return fail("关联角色不可用", { memberId: ["只能关联未归档的“人”角色"] });
  }

  try {
    await db().user.update({
      where: { id },
      data: {
        username: parsed.data.username,
        displayName: parsed.data.displayName,
        memberId: parsed.data.memberId ?? null,
        active: parsed.data.active,
        ...(parsed.data.password
          ? { passwordHash: await hashPassword(parsed.data.password) }
          : {}),
      },
    });
    revalidateUserSurfaces();
    return ok();
  } catch (error) {
    return fromPrismaError(error, "updateUser", {
      username: "这个用户名已经被使用了",
      memberId: "这个角色已经关联了其他账号",
    });
  }
}
