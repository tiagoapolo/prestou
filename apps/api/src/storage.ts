import { createClient } from "@supabase/supabase-js";
import { config } from "./config.js";

const storageClient = createClient(
  config.supabase.url,
  config.supabase.serviceRoleKey,
  { auth: { persistSession: false, autoRefreshToken: false } },
);

export async function saveReceipt(
  objectPath: string,
  bytes: Buffer,
  contentType: string,
): Promise<string> {
  const { error } = await storageClient.storage
    .from(config.supabase.receiptsBucket)
    .upload(objectPath, bytes, { contentType, upsert: false });
  if (error) throw error;
  return objectPath;
}

export async function signedReceiptUrl(objectPath: string): Promise<string> {
  const { data, error } = await storageClient.storage
    .from(config.supabase.receiptsBucket)
    .createSignedUrl(objectPath, config.supabase.signedUrlTtlSeconds);
  if (error) throw error;
  return data.signedUrl;
}

export async function deleteReceipt(objectPath: string): Promise<void> {
  await deleteReceipts([objectPath]);
}

export async function deleteReceipts(objectPaths: string[]): Promise<void> {
  for (let start = 0; start < objectPaths.length; start += 1_000) {
    const { error } = await storageClient.storage
      .from(config.supabase.receiptsBucket)
      .remove(objectPaths.slice(start, start + 1_000));
    if (error) throw error;
  }
}
