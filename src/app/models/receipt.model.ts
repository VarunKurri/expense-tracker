/**
 * A photo of a receipt, attached to a transaction (`Transaction.receiptId`).
 *
 * Kept in its own collection, `users/{uid}/receipts`, encrypted like every
 * other document — and never in the transaction itself, so the transaction
 * list never downloads photos. A receipt is fetched only when it's opened.
 */
export interface ReceiptImage {
  id?: string;
  /** The photo as a JPEG data URL, shrunk to fit one Firestore document. */
  image: string;
  width: number;
  height: number;
  createdAt: number;
}
