import { createHash, randomInt } from "node:crypto";
import { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { expiresInMinutes } from "@/lib/chat/service";
import { nowInstant } from "@/lib/time";

const PAIRING_TTL_MINUTES = 10;

export interface QqIdentity {
  openId: string;
  groupId: string | null;
}

export interface QqBindingView {
  id: string;
  label: string;
  createdAt: string;
  isGroup: boolean;
  remindersEnabled: boolean;
  reminderLastError: string | null;
}

export function qqIdentityKey(identity: QqIdentity): string {
  return identity.groupId
    ? `group:${identity.groupId}:${identity.openId}`
    : `private:${identity.openId}`;
}

export async function createPairingCode(userId: string): Promise<{
  code: string;
  expiresAt: string;
}> {
  // 一个账号同一时刻只保留一枚可用短码，减少误绑定的窗口。
  await db().qqPairingCode.deleteMany({ where: { userId, consumedAt: null } });

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
    const expiresAt = expiresInMinutes(PAIRING_TTL_MINUTES);
    try {
      await db().qqPairingCode.create({
        data: { userId, codeHash: hashCode(code), expiresAt },
      });
      return { code, expiresAt: expiresAt.toISOString() };
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") {
        throw error;
      }
    }
  }
  throw new Error("无法生成不重复的绑定码");
}

export async function consumePairingCode(
  code: string,
  identity: QqIdentity,
): Promise<{ ok: true; displayName: string } | { ok: false; error: string }> {
  if (!/^\d{6}$/.test(code)) return { ok: false, error: "绑定码应为 6 位数字。" };

  return db().$transaction(async (tx) => {
    const row = await tx.qqPairingCode.findUnique({
      where: { codeHash: hashCode(code) },
      include: { user: { select: { active: true, displayName: true } } },
    });
    if (!row || row.consumedAt || row.expiresAt <= nowInstant() || !row.user.active) {
      return { ok: false as const, error: "绑定码无效或已过期，请在网页重新生成。" };
    }

    const claimed = await tx.qqPairingCode.updateMany({
      where: { id: row.id, consumedAt: null, expiresAt: { gt: nowInstant() } },
      data: { consumedAt: nowInstant() },
    });
    if (!claimed.count) {
      return { ok: false as const, error: "绑定码已经使用，请在网页重新生成。" };
    }

    await tx.qqBinding.upsert({
      where: { lookupKey: qqIdentityKey(identity) },
      create: {
        lookupKey: qqIdentityKey(identity),
        openId: identity.openId,
        groupId: identity.groupId,
        userId: row.userId,
      },
      update: {
        openId: identity.openId,
        groupId: identity.groupId,
        userId: row.userId,
        lastUsedAt: nowInstant(),
      },
    });
    return { ok: true as const, displayName: row.user.displayName };
  });
}

export async function findQqUser(identity: QqIdentity) {
  const binding = await db().qqBinding.findUnique({
    where: { lookupKey: qqIdentityKey(identity) },
    include: { user: { select: { id: true, active: true, displayName: true } } },
  });
  if (!binding?.user.active) return null;
  await db().qqBinding.update({
    where: { id: binding.id },
    data: { lastUsedAt: nowInstant() },
  });
  return binding.user;
}

export async function listQqBindings(userId: string): Promise<QqBindingView[]> {
  const rows = await db().qqBinding.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    select: { id: true, groupId: true, openId: true, createdAt: true, remindersEnabled: true, reminderLastError: true },
  });
  return rows.map((row) => ({
    id: row.id,
    label: row.groupId
      ? `群聊 · ${shortId(row.groupId)} · ${shortId(row.openId)}`
      : `QQ 私聊 · ${shortId(row.openId)}`,
    createdAt: row.createdAt.toISOString(),
    isGroup: Boolean(row.groupId),
    remindersEnabled: row.remindersEnabled,
    reminderLastError: row.reminderLastError,
  }));
}

export async function removeQqBinding(userId: string, bindingId: string): Promise<boolean> {
  const result = await db().qqBinding.deleteMany({ where: { id: bindingId, userId } });
  return result.count > 0;
}

function hashCode(code: string): string {
  return createHash("sha256").update(code).digest("hex");
}

function shortId(value: string): string {
  return value.length <= 12 ? value : `${value.slice(0, 6)}…${value.slice(-4)}`;
}
