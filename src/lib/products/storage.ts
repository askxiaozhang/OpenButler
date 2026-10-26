import { createClient } from "@supabase/supabase-js";
import { MAX_FILE_SIZE, PRODUCT_FILE_TYPES } from "./validation";

export const PRODUCT_BUCKET = "product-library";
export const productPreviewPath = (path: string, page: number) => `${path}.page-${page}.jpg`;
export function productStorageConfigured(): boolean {
  return Boolean(process.env.SUPABASE_URL?.trim() && (process.env.SUPABASE_SECRET_KEY?.trim() || process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()));
}

/** 只由服务端导入。私有文件的临时上传/阅读 URL 在鉴权后签发。 */
export function productStorage() {
  const url = process.env.SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SECRET_KEY?.trim() || process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) throw new Error("PRODUCT_STORAGE_NOT_CONFIGURED");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } }).storage.from(PRODUCT_BUCKET);
}

export async function ensureProductBucket(): Promise<void> {
  const url = process.env.SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SECRET_KEY?.trim() || process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) throw new Error("PRODUCT_STORAGE_NOT_CONFIGURED");
  const storage = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } }).storage;
  const { data, error } = await storage.getBucket(PRODUCT_BUCKET);
  if (data) {
    if (data.public) throw new Error("PRODUCT_BUCKET_MUST_BE_PRIVATE");
    return;
  }
  if (error && !["404", "400"].includes(String(error.status))) throw error;
  const created = await storage.createBucket(PRODUCT_BUCKET, {
    public: false, fileSizeLimit: MAX_FILE_SIZE, allowedMimeTypes: Object.keys(PRODUCT_FILE_TYPES),
  });
  if (created.error && !/already exists/i.test(created.error.message)) throw created.error;
}
