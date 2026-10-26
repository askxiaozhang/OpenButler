import { Prisma } from "@/generated/prisma/client";

/**
 * Server Action 的统一返回类型。
 *
 * 用「返回值」而不是「抛异常」表达失败：Server Action 抛出的异常在生产环境会被
 * Next 抹成一句 "An error occurred in the Server Components render"，
 * 用户看不到任何有用信息，排查也只能翻服务端日志。返回结构化的错误则能把
 * 「名字重复了」这类可预期的失败直接渲染到表单上。
 *
 * 异常只留给真正的意外（数据库连不上、代码 bug）。
 */
export type ActionResult<T = void> =
  | { ok: true; data: T }
  | { ok: false; error: string; fieldErrors?: Record<string, string[]> };

export function ok(): ActionResult<void>;
export function ok<T>(data: T): ActionResult<T>;
export function ok<T>(data?: T): ActionResult<T | undefined> {
  return { ok: true, data };
}

export function fail(
  error: string,
  fieldErrors?: Record<string, string[]>,
): ActionResult<never> {
  return { ok: false, error, fieldErrors };
}

/**
 * 从 P2002（唯一约束冲突）里榨出「是哪个约束被撞了」。
 *
 * ️ Prisma 7 配合 driver adapter 时 **`meta.target` 不再存在** —— 约束名藏在
 * `meta.driverAdapterError.cause.constraint.index`（形如 `Member_name_key`），
 * 原始报文在 `cause.originalMessage` 里。按 Prisma 5/6 的形状写会拿不到任何
 * 线索，最后拼出一个空字符串错误（「 已存在」），既难看又没用。
 *
 * 这里把两种形状都兜住，将来换回原生引擎也不会突然失灵。
 */
function uniqueConstraintIdentifiers(
  e: Prisma.PrismaClientKnownRequestError,
): string[] {
  const meta = e.meta as Record<string, unknown> | undefined;
  if (!meta) return [];

  const out: string[] = [];

  // Prisma 5/6：meta.target 是字段名数组或字符串
  if (Array.isArray(meta.target)) out.push(...meta.target.map(String));
  else if (typeof meta.target === "string") out.push(meta.target);

  // Prisma 7 + driver adapter
  const adapterError = meta.driverAdapterError as
    | { cause?: { constraint?: { index?: string }; originalMessage?: string } }
    | undefined;
  const cause = adapterError?.cause;
  if (cause?.constraint?.index) out.push(cause.constraint.index);
  if (cause?.originalMessage) out.push(cause.originalMessage);

  return out;
}

/**
 * 把 Prisma 的错误翻译成人话。
 *
 * `uniqueMessages` 按字段名给出定制文案，比如角色表传
 * `{ name: "这个名字已经被占用了" }`。键会拿去做大小写不敏感的子串匹配，
 * 所以 `Member_name_key` 能命中 `name`。
 */
export function fromPrismaError(
  e: unknown,
  context: string,
  uniqueMessages: Record<string, string> = {},
): ActionResult<never> {
  if (e instanceof Prisma.PrismaClientKnownRequestError) {
    if (e.code === "P2002") {
      const identifiers = uniqueConstraintIdentifiers(e).map((s) => s.toLowerCase());
      for (const [field, message] of Object.entries(uniqueMessages)) {
        if (identifiers.some((id) => id.includes(field.toLowerCase()))) {
          return fail(message);
        }
      }
      return fail("这个内容已经存在了，换一个试试");
    }
    if (e.code === "P2025") return fail("记录不存在，可能已被删除");
    if (e.code === "P2003") return fail("关联的记录不存在");
  }

  console.error(`[${context}]`, e);
  return fail("操作失败，请稍后重试");
}