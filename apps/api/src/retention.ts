import { execute, queryAll } from "./db.js";
import { receiptRetentionCutoff } from "./retention-policy.js";
import { deleteReceipt } from "./storage.js";

interface ExpiredReceipt {
  id: string;
  comprovante_path: string;
}

export async function purgeExpiredReceipts(now = new Date()): Promise<{
  checked: number;
  purged: number;
}> {
  const receipts = await queryAll<ExpiredReceipt>(
    `SELECT id, comprovante_path
       FROM payments
      WHERE comprovante_path IS NOT NULL
        AND paid_at IS NOT NULL
        AND paid_at <= ?
      ORDER BY paid_at
      LIMIT 1000`,
    receiptRetentionCutoff(now),
  );

  let purged = 0;
  for (const receipt of receipts) {
    await deleteReceipt(receipt.comprovante_path);
    const result = await execute(
      `UPDATE payments
          SET comprovante_path = NULL
        WHERE id = ? AND comprovante_path = ?`,
      receipt.id,
      receipt.comprovante_path,
    );
    purged += result.changes;
  }

  return { checked: receipts.length, purged };
}
