import { createClient } from "@supabase/supabase-js";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { config } from "./config.js";
import { databaseMode } from "./db.js";

const storageClient =
  config.supabase.url && config.supabase.serviceRoleKey
    ? createClient(config.supabase.url, config.supabase.serviceRoleKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      })
    : null;

export const isCloudStorageEnabled = databaseMode === "postgres";

export async function saveReceipt(
  objectPath: string,
  bytes: Buffer,
  contentType: string,
): Promise<string> {
  if (!isCloudStorageEnabled) {
    const localPath = join(config.uploadsDir, objectPath.replaceAll("/", "-"));
    await writeFile(localPath, bytes);
    return localPath;
  }
  if (!storageClient) throw new Error("Supabase Storage não configurado");

  const { error } = await storageClient.storage
    .from(config.supabase.receiptsBucket)
    .upload(objectPath, bytes, { contentType, upsert: false });
  if (error) throw error;
  return objectPath;
}

export async function readLocalReceipt(path: string): Promise<Buffer> {
  return readFile(path);
}

export async function signedReceiptUrl(objectPath: string): Promise<string> {
  if (!storageClient) throw new Error("Supabase Storage não configurado");
  const { data, error } = await storageClient.storage
    .from(config.supabase.receiptsBucket)
    .createSignedUrl(objectPath, config.supabase.signedUrlTtlSeconds);
  if (error) throw error;
  return data.signedUrl;
}
