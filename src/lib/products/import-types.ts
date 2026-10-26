import { z } from "zod";
import { productSchema } from "./validation";

export const productEvidenceSchema = z.object({ page: z.number().int().min(1).max(10000), text: z.string().max(220) });
export const productImportSchema = z.object({
  kind: z.literal("PRODUCT_IMPORT"),
  documentId: z.string().min(1),
  product: productSchema,
  evidence: z.array(productEvidenceSchema).max(3),
  warning: z.string().max(600),
  recognized: z.boolean(),
  suggestedProduct: z.object({ id: z.string(), name: z.string() }).nullable(),
  savedProductId: z.string().nullable(),
});
export type ProductImportProposal = z.infer<typeof productImportSchema>;
export const productImportEditSchema = z.object({ product: productSchema, targetProductId: z.string().max(100).nullable() });
export type ProductImportEdit = z.infer<typeof productImportEditSchema>;
export function readProductImport(value: unknown): ProductImportProposal | null {
  const parsed = productImportSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}
export function normalizeProductIdentity(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
}
