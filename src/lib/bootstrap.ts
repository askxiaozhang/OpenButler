import { z } from "zod";
const schema = z.object({
  username: z.string().trim().min(1).max(64).regex(/^[a-zA-Z0-9_.-]+$/),
  displayName: z.string().trim().min(1).max(80),
  password: z.string().min(12).max(256),
});
/** No shared/default password, and no secrets in validation error messages. */
export function readBootstrapAccount(env: Record<string, string | undefined>) {
  const parsed = schema.safeParse({ username: env.SEED_USERNAME || "admin", displayName: env.SEED_DISPLAY_NAME || "管理员", password: env.SEED_PASSWORD });
  if (!parsed.success) throw new Error("Invalid SEED_* configuration: set an administrator password with at least 12 characters.");
  return parsed.data;
}
