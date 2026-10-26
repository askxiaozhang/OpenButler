"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth/guard";
import { fail, ok, type ActionResult } from "@/lib/action-result";
import { recordInputFromForm, recordInputSchema } from "@/lib/validation/entry";
import { fromDateOnly } from "@/lib/time";
import type { Record as RecordModel } from "@/generated/prisma/client";

/**
 * 记录（已经发生的事）的增删改。
 *
 * 记录是不可变的历史：编辑只允许改标题和备注，**不允许改 occurredOn 到别的角色名下**
 * 那种「重写历史」的操作也做不了 —— 这类需求应该用「删掉重记」表达，
 * 让日志本身保持诚实。
 */

function revalidateRecordSurfaces() {
  revalidatePath("/", "layout");
}

export async function createRecord(
  _prev: ActionResult<RecordModel> | null,
  formData: FormData,
): Promise<ActionResult<RecordModel>> {
  const user = await requireUser();

  const parsed = recordInputSchema.safeParse(recordInputFromForm(formData));
  if (!parsed.success) {
    return fail("请检查填写的内容", parsed.error.flatten().fieldErrors);
  }

  const { subjectId, assigneeId, title, note, occurredOn } = parsed.data;

  try {
    const record = await db().record.create({
      data: {
        subjectId: subjectId ?? null,
        assigneeId: assigneeId ?? null,
        title,
        note,
        occurredOn: fromDateOnly(occurredOn),
        source: "MANUAL",
        authorId: user.id,
      },
    });
    revalidateRecordSurfaces();
    return ok(record);
  } catch (e) {
    console.error("[createRecord]", e);
    return fail("创建失败，请稍后重试");
  }
}

/** 改标题/备注/日期。不动角色归属之外的关系。 */
export async function updateRecord(
  id: string,
  _prev: ActionResult<RecordModel> | null,
  formData: FormData,
): Promise<ActionResult<RecordModel>> {
  await requireUser();

  const parsed = recordInputSchema.safeParse(recordInputFromForm(formData));
  if (!parsed.success) {
    return fail("请检查填写的内容", parsed.error.flatten().fieldErrors);
  }

  const { subjectId, assigneeId, title, note, occurredOn } = parsed.data;

  try {
    const record = await db().record.update({
      where: { id },
      data: {
        subjectId: subjectId ?? null,
        assigneeId: assigneeId ?? null,
        title,
        note,
        occurredOn: fromDateOnly(occurredOn),
      },
    });
    revalidateRecordSurfaces();
    return ok(record);
  } catch (e) {
    console.error("[updateRecord]", e);
    return fail("保存失败，请稍后重试");
  }
}

export async function deleteRecord(id: string): Promise<ActionResult<void>> {
  await requireUser();
  try {
    await db().record.delete({ where: { id } });
    revalidateRecordSurfaces();
    return ok();
  } catch (e) {
    console.error("[deleteRecord]", e);
    return fail("删除失败");
  }
}