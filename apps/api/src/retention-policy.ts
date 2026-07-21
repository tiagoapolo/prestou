export const RECEIPT_RETENTION_DAYS = 90;

export function receiptRetentionCutoff(now: Date): string {
  const cutoff = new Date(now);
  cutoff.setUTCDate(cutoff.getUTCDate() - RECEIPT_RETENTION_DAYS);
  return cutoff.toISOString();
}
