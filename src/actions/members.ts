"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth/guard";
import { fail, fromPrismaError, ok, type ActionResult } from "@/lib/action-result";
import { nowInstant } from "@/lib/time";
import { memberInputFromForm, memberInputSchema } from "@/lib/validation/member";
import type { Member } from "@/generated/prisma/client";

/**
 * 角色的增删改。
 *
 * 每个 action 都以 `requireUser()` 开头 —— Server Action 是可以被直接调用的
 * HTTP 端点，不能假设调用方一定经过了页面。少了这一步，未登录的人也能改数据。
 */

function revalidateMemberSurfaces() {
  // 角色出现在多个页面（首页角色条、筛选 chips、日历配色），改一处要全刷
  revalidatePath("/", "layout");
}

/**
 * 新建角色。
 *
 * 第一个参数是 `useActionState` 要求的「上一次结果」。由 `updateMember.bind()`
 * 和这里的签名保持一致，表单那边就不用写类型断言了。
 */
export async function createMember(
  _prev: ActionResult<Member> | null,
  formData: FormData,
): Promise<ActionResult<Member>> {
  await requireUser();

  const parsed = memberInputSchema.safeParse(memberInputFromForm(formData));
  if (!parsed.success) {
    return fail("请检查填写的内容", parsed.error.flatten().fieldErrors);
  }

  const { name, aliases, kind, emoji, color, sortOrder } = parsed.data;

  try {
    const member = await db().member.create({
      data: {
        name,
        aliases,
        kind,
        emoji: emoji || null,
        color: color || null,
        sortOrder,
      },
    });
    revalidateMemberSurfaces();
    return ok(member);
  } catch (e) {
    return fromPrismaError(e, "createMember", { name: "这个名字已经被占用了" });
  }
}

/** 编辑角色。`id` 通过 `updateMember.bind(null, id)` 预绑定。 */
export async function updateMember(
  id: string,
  _prev: ActionResult<Member> | null,
  formData: FormData,
): Promise<ActionResult<Member>> {
  await requireUser();

  const parsed = memberInputSchema.safeParse(memberInputFromForm(formData));
  if (!parsed.success) {
    return fail("请检查填写的内容", parsed.error.flatten().fieldErrors);
  }

  const { name, aliases, kind, emoji, color, sortOrder } = parsed.data;

  try {
    const member = await db().member.update({
      where: { id },
      data: { name, aliases, kind, emoji: emoji || null, color: color || null, sortOrder },
    });
    revalidateMemberSurfaces();
    return ok(member);
  } catch (e) {
    return fromPrismaError(e, "updateMember", { name: "这个名字已经被占用了" });
  }
}

/**
 * 归档（软删除）。
 *
 * 不真删：角色身上挂着历史记录和周期项，硬删会让这些数据变成孤儿，
 * 「猫咪去年掏过几次耳朵」这类问题就再也答不上来了。
 * 归档后角色不再出现在下拉和筛选里，但历史完整保留。
 */
export async function archiveMember(id: string): Promise<ActionResult<Member>> {
  await requireUser();

  const target = await db().member.findUnique({ where: { id } });
  if (!target) return fail("角色不存在");

  // 至少要留一个可用角色，否则新建记录时没有归属可选
  const activeCount = await db().member.count({ where: { archivedAt: null } });
  if (activeCount <= 1) {
    return fail("至少要保留一个角色");
  }

  try {
    const member = await db().member.update({
      where: { id },
      data: { archivedAt: nowInstant() },
    });
    revalidateMemberSurfaces();
    return ok(member);
  } catch (e) {
    return fromPrismaError(e, "archiveMember");
  }
}

export async function restoreMember(id: string): Promise<ActionResult<Member>> {
  await requireUser();
  try {
    const member = await db().member.update({
      where: { id },
      data: { archivedAt: null },
    });
    revalidateMemberSurfaces();
    return ok(member);
  } catch (e) {
    return fromPrismaError(e, "restoreMember");
  }
}

/**
 * 调整排序：把某个角色上移/下移一格。
 *
 * ## 为什么不是「交换两个 sortOrder」
 *
 * 交换值看起来简单，但只要出现并列（两个角色同序号）就会崩：
 * 交换后并列依然存在，`findFirst({ sortOrder: { gt: x } })` 找到的邻居
 * 每次可能不同，顺序变得不稳定 —— 表现是「点了几次上移，列表纹丝不动」。
 *
 * 并列是很容易产生的：seed 灌数据时 sortOrder 都是 0。
 *
 * 所以这里改成**按当前显示顺序整表重排**，写回 0,1,2… 的连续序号。
 * 既躲开并列问题，也顺带把已有的重复序号自愈掉。
 */
export async function moveMember(
  id: string,
  direction: "up" | "down",
): Promise<ActionResult<void>> {
  await requireUser();

  const current = await db().member.findUnique({
    where: { id },
    select: { kind: true, archivedAt: true },
  });
  if (!current || current.archivedAt) return fail("角色不存在");

  /*
   * 只在**同类型内**移动。
   *
   * 界面是按「人 / 宠物」分组的，如果这里跨类型交换全局序号，会出现
   * 「点了下移但列表纹丝不动」—— 因为两个角色分属不同分组，各自组内的
   * 相对顺序没变。用户只会觉得按钮坏了。
   * （这个 bug 是回归测试抓出来的。）
   *
   * 顺序要和界面完全一致（sortOrder 相同则按创建时间），
   * 否则「上移」在用户眼里可能变成「下移」。
   */
  const ordered = await db().member.findMany({
    where: { archivedAt: null, kind: current.kind },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    select: { id: true, sortOrder: true },
  });

  const index = ordered.findIndex((m) => m.id === id);
  if (index === -1) return fail("角色不存在");

  const target = direction === "up" ? index - 1 : index + 1;
  if (target < 0 || target >= ordered.length) return ok(); // 已经在端点，静默成功

  // 在数组里换位置，然后整体重排序号
  const reordered = [...ordered];
  [reordered[index], reordered[target]] = [reordered[target], reordered[index]];

  /*
   * 序号从 0 开始连续分配。
   *
   * 但两类角色共用同一个 sortOrder 空间 —— 如果人从 0 排、宠物也从 0 排，
   * 全局查询（比如设置页列出全部角色）的顺序会变得随机。
   * 所以按类型错开：人从 0 开始，宠物从一个足够大的偏移开始。
   */
  const base = current.kind === "PERSON" ? 0 : 1000;

  await db().$transaction(
    reordered
      .map((m, i) =>
        m.sortOrder === base + i
          ? null // 序号没变的不写，减少无谓的 UPDATE
          : db().member.update({
              where: { id: m.id },
              data: { sortOrder: base + i },
            }),
      )
      .filter((op): op is NonNullable<typeof op> => op !== null),
  );

  revalidateMemberSurfaces();
  return ok();
}
