import type { Prisma } from "@/generated/prisma/client";
import type { z } from "zod";
import { productSchema } from "./validation";

/** 手动表单与 AI 确认共用同一个产品保存入口。 */
export async function persistProduct(client: Pick<Prisma.TransactionClient, "product">, input: z.infer<typeof productSchema>, authorId: string, id: string | null = null) {
  const data = productSchema.parse(input);
  return id
    ? client.product.update({ where: { id }, data, select: { id: true } })
    : client.product.create({ data: { ...data, authorId }, select: { id: true } });
}
