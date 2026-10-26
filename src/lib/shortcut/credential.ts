import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { db } from "@/lib/db";
import { nowInstant } from "@/lib/time";

const TOKEN_PREFIX = "fn";
// 新密钥只用字母数字：iPhone 镜像的硬件键盘输入可能吞掉 `_`。
// 同时继续接受已经生成的旧版 base64url 密钥，避免现有快捷指令失效。
const TOKEN_PATTERN = /^(?:fn[a-f0-9]{64}|fn_[A-Za-z0-9_-]{43})$/;

export interface ShortcutCredentialView {
  tokenHint: string;
  createdAt: string;
  lastUsedAt: string | null;
}

export function createShortcutToken(): string {
  return `${TOKEN_PREFIX}${randomBytes(32).toString("hex")}`;
}

export function hashShortcutToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function shortcutTokenHint(token: string): string {
  return `${token.slice(0, 7)}…${token.slice(-4)}`;
}

export function readBearerToken(header: string | null): string | null {
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  if (!match || !TOKEN_PATTERN.test(match[1])) return null;
  return match[1];
}

export async function createOrRotateShortcutCredential(userId: string): Promise<{
  token: string;
  credential: ShortcutCredentialView;
}> {
  const token = createShortcutToken();
  const createdAt = nowInstant();
  const row = await db().shortcutCredential.upsert({
    where: { userId },
    create: {
      userId,
      tokenHash: hashShortcutToken(token),
      tokenHint: shortcutTokenHint(token),
      createdAt,
    },
    update: {
      tokenHash: hashShortcutToken(token),
      tokenHint: shortcutTokenHint(token),
      createdAt,
      lastUsedAt: null,
    },
    select: { tokenHint: true, createdAt: true, lastUsedAt: true },
  });
  return { token, credential: toView(row) };
}

export async function getShortcutCredential(
  userId: string,
): Promise<ShortcutCredentialView | null> {
  const row = await db().shortcutCredential.findUnique({
    where: { userId },
    select: { tokenHint: true, createdAt: true, lastUsedAt: true },
  });
  return row ? toView(row) : null;
}

export async function revokeShortcutCredential(userId: string): Promise<void> {
  await db().shortcutCredential.deleteMany({ where: { userId } });
}

export async function authenticateShortcutToken(token: string) {
  if (!TOKEN_PATTERN.test(token)) return null;
  const tokenHash = hashShortcutToken(token);
  const row = await db().shortcutCredential.findUnique({
    where: { tokenHash },
    include: { user: { select: { id: true, active: true, displayName: true } } },
  });
  if (!row?.user.active) return null;

  // 即使数据库或日志意外泄露，服务端也没有可直接调用接口的明文密钥。
  const expected = Buffer.from(row.tokenHash, "hex");
  const actual = Buffer.from(tokenHash, "hex");
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;

  await db().shortcutCredential.update({
    where: { id: row.id },
    data: { lastUsedAt: nowInstant() },
  });
  return row.user;
}

function toView(row: {
  tokenHint: string;
  createdAt: Date;
  lastUsedAt: Date | null;
}): ShortcutCredentialView {
  return {
    tokenHint: row.tokenHint,
    createdAt: row.createdAt.toISOString(),
    lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
  };
}
