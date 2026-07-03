import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { defineSecret, defineString } from 'firebase-functions/params';
import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { CountryCode, Products, PlaidApi, Transaction as PlaidTransaction } from 'plaid';
import { getPlaidClient } from './plaidClient';
import { encryptToken, decryptToken, envelopeEncrypt, EncryptedValue } from './crypto';

initializeApp();

// Secrets: set with `firebase functions:secrets:set NAME` for deploy, or place
// in functions/.secret.local for the emulator. Never committed.
const plaidClientId = defineSecret('PLAID_CLIENT_ID');
const plaidSecret = defineSecret('PLAID_SECRET');
// Base64-encoded 32-byte key used to AES-256-GCM encrypt stored access tokens.
const tokenEncKey = defineSecret('TOKEN_ENC_KEY');

// Non-secret params: read from functions/.env (defaults applied below).
const plaidEnv = defineString('PLAID_ENV', { default: 'sandbox' });
const plaidWebhookUrl = defineString('PLAID_WEBHOOK_URL', { default: '' });

/**
 * Mint a short-lived Plaid Link token for the signed-in user. The browser uses
 * it to open Plaid Link; the token can only be created server-side because it
 * requires the Plaid secret.
 */
export const createLinkToken = onCall({ secrets: [plaidClientId, plaidSecret] }, async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'You must be signed in to connect a bank.');
  }

  const uid = request.auth.uid;
  const client = getPlaidClient(plaidClientId.value(), plaidSecret.value(), plaidEnv.value());
  const webhook = plaidWebhookUrl.value();

  try {
    const resp = await client.linkTokenCreate({
      user: { client_user_id: uid },
      client_name: 'Trackr',
      products: [Products.Transactions],
      country_codes: [CountryCode.Us],
      language: 'en',
      // Webhook is configured here so Plaid knows where to send ongoing sync
      // notifications once the webhook function exists. Omitted while unset.
      ...(webhook ? { webhook } : {}),
    });

    return { link_token: resp.data.link_token, expiration: resp.data.expiration };
  } catch (err: any) {
    const plaidError = err?.response?.data;
    console.error('linkTokenCreate failed:', plaidError || err);
    const message = plaidError?.error_message || err?.message || 'Failed to create link token.';
    throw new HttpsError('internal', message);
  }
});

/**
 * Exchange the short-lived public_token from Plaid Link for a long-lived
 * access_token, then store it (encrypted) so future syncs can run. Writes to
 * `users/{uid}/plaidItems/{itemId}`.
 */
export const exchangePublicToken = onCall(
  { secrets: [plaidClientId, plaidSecret, tokenEncKey] },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'You must be signed in to connect a bank.');
    }

    const uid = request.auth.uid;
    const publicToken = (request.data?.public_token ?? '').toString().trim();
    const institutionName = (request.data?.institution_name ?? '').toString().trim() || 'Unknown institution';

    if (!publicToken) {
      throw new HttpsError('invalid-argument', 'A public_token is required.');
    }

    const client = getPlaidClient(plaidClientId.value(), plaidSecret.value(), plaidEnv.value());

    try {
      const exchange = await client.itemPublicTokenExchange({ public_token: publicToken });
      const accessToken = exchange.data.access_token;
      const itemId = exchange.data.item_id;

      // Encrypt the access token before it ever touches the database. The key
      // lives only in Secret Manager, so a database read alone can't reveal it.
      const encryptedAccessToken = encryptToken(accessToken, tokenEncKey.value());

      const now = Date.now();
      await getFirestore().doc(`users/${uid}/plaidItems/${itemId}`).set({
        itemId,
        institutionName,
        accessToken: encryptedAccessToken,
        cursor: '', // empty until the first /transactions/sync
        status: 'active',
        createdAt: now,
        updatedAt: now,
      });

      // Reverse index (server-only; clients are denied by rules) so the webhook
      // can resolve item_id -> uid without scanning every user.
      await indexPlaidItem(itemId, uid);

      return { itemId, institutionName };
    } catch (err: any) {
      const plaidError = err?.response?.data;
      console.error('exchangePublicToken failed:', plaidError || err);
      const message = plaidError?.error_message || err?.message || 'Failed to link the bank account.';
      throw new HttpsError('internal', message);
    }
  },
);

// --- Transaction sync ---------------------------------------------------------

/** Read a user's plaintext RSA public key (SPKI base64) for envelope encryption. */
async function getUserPublicKey(uid: string): Promise<string | null> {
  const snap = await getFirestore().doc(`users/${uid}/meta/keys`).get();
  return snap.exists ? ((snap.data()?.publicKey as string) ?? null) : null;
}

/** Server-only item_id -> uid index so the webhook can find the owning user. */
async function indexPlaidItem(itemId: string, uid: string): Promise<void> {
  await getFirestore().doc(`plaidItemsByItem/${itemId}`).set({ uid, updatedAt: Date.now() });
}

/** Map a Plaid transaction onto the app's Transaction shape (as a plain object). */
function mapPlaidTransaction(t: PlaidTransaction): Record<string, unknown> {
  const now = Date.now();
  // Plaid convention: positive amount = money leaving the account (expense),
  // negative = money coming in (income).
  const type = t.amount < 0 ? 'income' : 'expense';
  return {
    type,
    amount: Math.abs(t.amount),
    date: t.date, // YYYY-MM-DD
    merchant: t.merchant_name || t.name || 'Unknown',
    createdAt: now,
    updatedAt: now,
    plaidTransactionId: t.transaction_id,
    plaidAccountId: t.account_id,
    plaidPersonalFinanceCategory: t.personal_finance_category?.primary,
    plaidPending: t.pending,
  };
}

/** Build the Firestore envelope document for a mapped transaction. */
function envelopeDoc(mapped: Record<string, unknown>, publicKey: string) {
  const env: EncryptedValue & { encryptedDEK: string } = envelopeEncrypt(JSON.stringify(mapped), publicKey);
  return {
    __envelope: true,
    encryptionVersion: 1,
    encryptedDEK: env.encryptedDEK,
    encryptedPayload: env.ciphertext,
    iv: env.iv,
    tag: env.tag,
    // Plaintext fields for Firestore ordering / dedup (never reveal amounts).
    date: mapped['date'],
    createdAt: mapped['createdAt'],
    updatedAt: mapped['updatedAt'],
    plaidTransactionId: mapped['plaidTransactionId'],
  };
}

interface SyncTotals {
  added: number;
  modified: number;
  removed: number;
}

/**
 * Sync one Plaid item: page through `transactionsSync` from the stored cursor,
 * envelope-encrypt each transaction to the user's public key, and write it under
 * the Plaid transaction_id (so re-runs and modifications are idempotent — that's
 * the dedup). The cursor is advanced in the same batch as the page's writes, so a
 * failure re-fetches rather than skips.
 */
async function syncItem(
  uid: string,
  itemDoc: FirebaseFirestore.QueryDocumentSnapshot,
  client: PlaidApi,
  tokenEncKeyValue: string,
  publicKey: string,
): Promise<SyncTotals> {
  const db = getFirestore();
  const item = itemDoc.data();
  const accessToken = decryptToken(item.accessToken as EncryptedValue, tokenEncKeyValue);
  const txCol = db.collection(`users/${uid}/transactions`);

  const totals: SyncTotals = { added: 0, modified: 0, removed: 0 };
  let cursor: string | undefined = item.cursor || undefined;
  let hasMore = true;

  while (hasMore) {
    const resp = await client.transactionsSync({ access_token: accessToken, cursor });
    const { added, modified, removed, next_cursor, has_more } = resp.data;

    const batch = db.batch();
    for (const t of [...added, ...modified]) {
      batch.set(txCol.doc(t.transaction_id), envelopeDoc(mapPlaidTransaction(t), publicKey));
    }
    for (const r of removed) {
      if (r.transaction_id) batch.delete(txCol.doc(r.transaction_id));
    }
    // Advance the cursor atomically with this page's writes.
    batch.set(itemDoc.ref, { cursor: next_cursor, status: 'active', updatedAt: Date.now() }, { merge: true });
    await batch.commit();

    totals.added += added.length;
    totals.modified += modified.length;
    totals.removed += removed.length;
    cursor = next_cursor;
    hasMore = has_more;
  }

  return totals;
}

/** Sync every Plaid item for a user. Used by the callable and the webhook. */
async function syncUser(
  uid: string,
  client: PlaidApi,
  tokenEncKeyValue: string,
): Promise<SyncTotals> {
  const publicKey = await getUserPublicKey(uid);
  if (!publicKey) {
    throw new HttpsError(
      'failed-precondition',
      'Unlock the app once to set up your encryption keys before syncing.',
    );
  }

  const db = getFirestore();
  const itemsSnap = await db.collection(`users/${uid}/plaidItems`).get();
  const totals: SyncTotals = { added: 0, modified: 0, removed: 0 };

  for (const itemDoc of itemsSnap.docs) {
    // Keep the reverse index fresh (covers items linked before it existed).
    await indexPlaidItem(itemDoc.id, uid);
    try {
      const r = await syncItem(uid, itemDoc, client, tokenEncKeyValue, publicKey);
      totals.added += r.added;
      totals.modified += r.modified;
      totals.removed += r.removed;
    } catch (err: any) {
      const plaidError = err?.response?.data;
      console.error(`sync failed for item ${itemDoc.id}:`, plaidError || err);
      const code = plaidError?.error_code;
      // ITEM_LOGIN_REQUIRED etc. → flag for the re-auth flow (later milestone).
      await itemDoc.ref.set(
        { status: code === 'ITEM_LOGIN_REQUIRED' ? 'login_required' : 'error', lastError: code || 'sync_failed', updatedAt: Date.now() },
        { merge: true },
      );
    }
  }

  return totals;
}

/**
 * Manually trigger a transaction sync for the signed-in user's linked banks.
 * (The webhook will call the same engine unattended in the next step.)
 */
export const syncTransactions = onCall(
  { secrets: [plaidClientId, plaidSecret, tokenEncKey] },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'You must be signed in to sync.');
    }
    const uid = request.auth.uid;
    const client = getPlaidClient(plaidClientId.value(), plaidSecret.value(), plaidEnv.value());
    return syncUser(uid, client, tokenEncKey.value());
  },
);
