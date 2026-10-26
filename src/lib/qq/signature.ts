import {
  createPrivateKey,
  createPublicKey,
  sign as signEd25519,
  verify as verifyEd25519,
} from "node:crypto";

// RFC 8410 Ed25519 PKCS#8：固定头 + 32 字节 seed。
const ED25519_PKCS8_PREFIX = Buffer.from("302e020100300506032b657004220420", "hex");
const MAX_CLOCK_SKEW_SECONDS = 300;

export function verifyQqSignature(input: {
  secret: string;
  timestamp: string;
  body: Buffer;
  signature: string;
  nowMs?: number;
}): boolean {
  try {
    const timestamp = Number(input.timestamp);
    const nowMs = input.nowMs ?? Date.now();
    if (!Number.isInteger(timestamp)) return false;
    if (Math.abs(nowMs / 1000 - timestamp) > MAX_CLOCK_SKEW_SECONDS) return false;
    const key = createPublicKey(privateKey(input.secret));
    return verifyEd25519(
      null,
      Buffer.concat([Buffer.from(input.timestamp), input.body]),
      key,
      Buffer.from(input.signature, "hex"),
    );
  } catch {
    return false;
  }
}

export function createQqChallenge(
  secret: string,
  plainToken: string,
  eventTimestamp: string,
): { plain_token: string; signature: string } {
  const signature = signEd25519(
    null,
    Buffer.from(`${eventTimestamp}${plainToken}`),
    privateKey(secret),
  ).toString("hex");
  return { plain_token: plainToken, signature };
}

function privateKey(secret: string) {
  if (!secret) throw new Error("QQ_BOT_APP_SECRET is required");
  const source = Buffer.from(secret);
  const seed = Buffer.alloc(32);
  for (let i = 0; i < seed.length; i += 1) seed[i] = source[i % source.length];
  return createPrivateKey({
    key: Buffer.concat([ED25519_PKCS8_PREFIX, seed]),
    format: "der",
    type: "pkcs8",
  });
}
