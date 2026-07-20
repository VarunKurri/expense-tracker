import { onCall, onRequest, HttpsError } from 'firebase-functions/v2/https';
import { defineSecret, defineString } from 'firebase-functions/params';
import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { CountryCode, Products, PlaidApi, Transaction as PlaidTransaction } from 'plaid';
import { createHash } from 'crypto';
import { importJWK, jwtVerify, decodeProtectedHeader } from 'jose';
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

  // How much history to request, in days. Plaid supports 1..730 (24 months).
  const raw = Math.floor(Number(request.data?.days_requested));
  const daysRequested = Number.isFinite(raw) ? Math.min(730, Math.max(1, raw)) : 90;

  try {
    const resp = await client.linkTokenCreate({
      user: { client_user_id: uid },
      client_name: 'Trackr',
      products: [Products.Transactions, Products.Liabilities],
      country_codes: [CountryCode.Us],
      language: 'en',
      transactions: { days_requested: daysRequested },
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

/**
 * Mint a Link token in Plaid's "update mode" for an item that needs re-auth
 * (expired/revoked login). Passing the item's existing access_token instead of
 * `products` puts Link into update mode: same item_id, same access_token stays
 * valid — the user just re-authenticates at their bank. No new exchange needed;
 * Plaid clears the item's error state once update-mode Link completes.
 */
export const createReauthLinkToken = onCall(
  { secrets: [plaidClientId, plaidSecret, tokenEncKey] },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'You must be signed in.');
    }
    const uid = request.auth.uid;
    const itemId = (request.data?.item_id ?? '').toString().trim();
    if (!itemId) throw new HttpsError('invalid-argument', 'An item_id is required.');

    const itemSnap = await getFirestore().doc(`users/${uid}/plaidItems/${itemId}`).get();
    if (!itemSnap.exists) throw new HttpsError('not-found', 'That linked bank was not found.');

    const client = getPlaidClient(plaidClientId.value(), plaidSecret.value(), plaidEnv.value());
    const webhook = plaidWebhookUrl.value();

    try {
      const accessToken = decryptToken(itemSnap.data()!.accessToken as EncryptedValue, tokenEncKey.value());
      const resp = await client.linkTokenCreate({
        user: { client_user_id: uid },
        client_name: 'Trackr',
        country_codes: [CountryCode.Us],
        language: 'en',
        access_token: accessToken,
        ...(webhook ? { webhook } : {}),
      });
      return { link_token: resp.data.link_token, expiration: resp.data.expiration };
    } catch (err: any) {
      const plaidError = err?.response?.data;
      console.error('createReauthLinkToken failed:', plaidError || err);
      throw new HttpsError('internal', plaidError?.error_message || err?.message || 'Failed to start reconnection.');
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

/** Extract the day-of-month (1-31) from a Plaid ISO date string, matching the
 *  app's Account.statementClosingDay/paymentDueDay (day-of-month, not a full date). */
function dayOfMonth(isoDate: string | null | undefined): number | null {
  if (!isoDate) return null;
  const day = Number(isoDate.slice(8, 10));
  return Number.isFinite(day) && day >= 1 && day <= 31 ? day : null;
}

/** Map a Plaid transaction onto the app's Transaction shape (as a plain object). */
function mapPlaidTransaction(t: PlaidTransaction, itemId: string): Record<string, unknown> {
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
    plaidItemId: itemId,
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
    // Plaintext fields for Firestore ordering / dedup / cleanup (never reveal amounts).
    date: mapped['date'],
    createdAt: mapped['createdAt'],
    updatedAt: mapped['updatedAt'],
    plaidTransactionId: mapped['plaidTransactionId'],
    plaidItemId: mapped['plaidItemId'],
  };
}

interface ItemSyncTotals {
  added: number;
  modified: number;
  removed: number;
}

interface SyncTotals extends ItemSyncTotals {
  failed: { itemId: string; institutionName: string; status: string }[];
}

/** Plaid item error codes that mean "user must re-authenticate at their bank". */
const REAUTH_ERROR_CODES = new Set([
  'ITEM_LOGIN_REQUIRED',
  'PENDING_EXPIRATION',
  'USER_PERMISSION_REVOKED',
  'USER_ACCOUNT_REVOKED',
  'PENDING_DISCONNECT',
]);

function statusForErrorCode(code: string | undefined): 'login_required' | 'error' {
  return code && REAUTH_ERROR_CODES.has(code) ? 'login_required' : 'error';
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
  itemDoc: FirebaseFirestore.DocumentSnapshot,
  client: PlaidApi,
  tokenEncKeyValue: string,
  publicKey: string,
): Promise<ItemSyncTotals> {
  const db = getFirestore();
  const item = itemDoc.data();
  if (!item) return { added: 0, modified: 0, removed: 0 };
  const accessToken = decryptToken(item.accessToken as EncryptedValue, tokenEncKeyValue);
  const txCol = db.collection(`users/${uid}/transactions`);

  const totals: ItemSyncTotals = { added: 0, modified: 0, removed: 0 };
  let cursor: string | undefined = item.cursor || undefined;
  let hasMore = true;

  while (hasMore) {
    const resp = await client.transactionsSync({ access_token: accessToken, cursor });
    const { added, modified, removed, next_cursor, has_more } = resp.data;

    const batch = db.batch();
    for (const t of [...added, ...modified]) {
      batch.set(txCol.doc(t.transaction_id), envelopeDoc(mapPlaidTransaction(t, itemDoc.id), publicKey));
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
  const totals: SyncTotals = { added: 0, modified: 0, removed: 0, failed: [] };

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
      const status = statusForErrorCode(code);
      await itemDoc.ref.set(
        { status, lastError: code || 'sync_failed', updatedAt: Date.now() },
        { merge: true },
      );
      const institutionName = (itemDoc.data()?.institutionName as string) || 'Your bank';
      totals.failed.push({ itemId: itemDoc.id, institutionName, status });
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

/**
 * Ask Plaid to proactively re-poll the institution right now, outside its normal
 * polling cadence. Useful when a user suspects transactions are missing — e.g. an
 * institution that only just posted data, or as a way to confirm whether a low
 * transaction count is a timing issue vs. a real limit on how much history that
 * institution shares. Plaid fires TRANSACTIONS/DEFAULT_UPDATE (and
 * SYNC_UPDATES_AVAILABLE) via our existing webhook once the refresh completes, so
 * no separate sync call is needed here — just trigger and wait for the webhook.
 */
export const refreshPlaidItems = onCall(
  { secrets: [plaidClientId, plaidSecret, tokenEncKey] },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'You must be signed in.');
    }
    const uid = request.auth.uid;
    const client = getPlaidClient(plaidClientId.value(), plaidSecret.value(), plaidEnv.value());
    const db = getFirestore();
    const itemsSnap = await db.collection(`users/${uid}/plaidItems`).get();

    const results: { itemId: string; institutionName: string; ok: boolean; error?: string }[] = [];
    for (const itemDoc of itemsSnap.docs) {
      const institutionName = (itemDoc.data()?.institutionName as string) || 'Your bank';
      try {
        const accessToken = decryptToken(itemDoc.data()!.accessToken as EncryptedValue, tokenEncKey.value());
        await client.transactionsRefresh({ access_token: accessToken });
        results.push({ itemId: itemDoc.id, institutionName, ok: true });
      } catch (err: any) {
        const message = err?.response?.data?.error_message || err?.message || 'Refresh failed.';
        console.error(`transactionsRefresh failed for item ${itemDoc.id}:`, err?.response?.data || err);
        results.push({ itemId: itemDoc.id, institutionName, ok: false, error: message });
      }
    }
    return { results };
  },
);

/**
 * Return the accounts held under a linked Plaid item (name, mask, type, balance)
 * so the client can auto-create matching app accounts. Not stored server-side —
 * the client owns (and encrypts) the app accounts.
 */
export const getPlaidAccounts = onCall(
  { secrets: [plaidClientId, plaidSecret, tokenEncKey] },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'You must be signed in.');
    }
    const uid = request.auth.uid;
    const itemId = (request.data?.item_id ?? '').toString().trim();
    if (!itemId) throw new HttpsError('invalid-argument', 'An item_id is required.');

    const itemSnap = await getFirestore().doc(`users/${uid}/plaidItems/${itemId}`).get();
    if (!itemSnap.exists) throw new HttpsError('not-found', 'That linked bank was not found.');

    try {
      const client = getPlaidClient(plaidClientId.value(), plaidSecret.value(), plaidEnv.value());
      const accessToken = decryptToken(itemSnap.data()!.accessToken as EncryptedValue, tokenEncKey.value());
      const resp = await client.accountsGet({ access_token: accessToken });

      // Liabilities (min payment, due date, statement date) is a separate call and a
      // separate consent scope. Items linked before Liabilities was requested at Link
      // time will fail here (e.g. PRODUCT_NOT_READY / no access) — that's expected for
      // not-yet-relinked items, so we degrade gracefully rather than fail the whole call.
      const creditByAccountId = new Map<string, { min: number | null; dueDay: number | null; statementDay: number | null }>();
      try {
        const liab = await client.liabilitiesGet({ access_token: accessToken });
        for (const c of liab.data.liabilities?.credit ?? []) {
          if (!c.account_id) continue;
          creditByAccountId.set(c.account_id, {
            min: c.minimum_payment_amount ?? null,
            dueDay: dayOfMonth(c.next_payment_due_date),
            statementDay: dayOfMonth(c.last_statement_issue_date),
          });
        }
      } catch (err: any) {
        console.warn('liabilitiesGet unavailable (item may need re-link for this product):', err?.response?.data?.error_code || err?.message);
      }

      return {
        accounts: resp.data.accounts.map(a => {
          const credit = creditByAccountId.get(a.account_id);
          return {
            account_id: a.account_id,
            name: a.name,
            official_name: a.official_name ?? null,
            mask: a.mask ?? null,
            type: a.type,
            subtype: a.subtype ?? null,
            current_balance: a.balances?.current ?? null,
            credit_limit: a.balances?.limit ?? null,
            minimum_payment: credit?.min ?? null,
            payment_due_day: credit?.dueDay ?? null,
            statement_closing_day: credit?.statementDay ?? null,
          };
        }),
      };
    } catch (err: any) {
      const plaidError = err?.response?.data;
      console.error('getPlaidAccounts failed:', plaidError || err);
      throw new HttpsError('internal', plaidError?.error_message || err?.message || 'Failed to load bank accounts.');
    }
  },
);

/**
 * Disconnect a linked bank: remove the item at Plaid (stops billing/syncs), then
 * delete its stored data — the plaidItems doc, the reverse index, and every
 * transaction tagged with this item_id.
 */
export const disconnectPlaidItem = onCall(
  { secrets: [plaidClientId, plaidSecret, tokenEncKey] },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'You must be signed in.');
    }
    const uid = request.auth.uid;
    const itemId = (request.data?.item_id ?? '').toString().trim();
    if (!itemId) throw new HttpsError('invalid-argument', 'An item_id is required.');

    const db = getFirestore();
    const itemRef = db.doc(`users/${uid}/plaidItems/${itemId}`);
    const itemSnap = await itemRef.get();
    if (!itemSnap.exists) throw new HttpsError('not-found', 'That linked bank was not found.');

    const client = getPlaidClient(plaidClientId.value(), plaidSecret.value(), plaidEnv.value());
    const accessToken = decryptToken(itemSnap.data()!.accessToken as EncryptedValue, tokenEncKey.value());

    // Look up this item's Plaid account_ids *before* removing the item — the
    // access token stops working right after itemRemove. These back up the
    // plaidItemId filter below in case any transaction is missing that field.
    let accountIds: string[] = [];
    try {
      const accountsResp = await client.accountsGet({ access_token: accessToken });
      accountIds = accountsResp.data.accounts.map(a => a.account_id);
    } catch (err: any) {
      console.warn('accountsGet failed (continuing with plaidItemId-only cleanup):', err?.response?.data || err?.message);
    }

    // Best-effort remove at Plaid (ignore if already gone / token invalid).
    try {
      await client.itemRemove({ access_token: accessToken });
    } catch (err: any) {
      console.warn('itemRemove failed (continuing cleanup):', err?.response?.data || err?.message);
    }

    // Delete this item's synced transactions. Primary filter is the plaintext
    // plaidItemId field; a second query on plaidAccountId (chunked to Firestore's
    // 10-value `in` limit) catches any doc where plaidItemId is missing/stale, so
    // a partial write or older sync doesn't leave orphaned transactions behind.
    const txCol = db.collection(`users/${uid}/transactions`);
    const toDelete = new Map<string, FirebaseFirestore.DocumentReference>();

    const byItem = await txCol.where('plaidItemId', '==', itemId).get();
    for (const doc of byItem.docs) toDelete.set(doc.ref.path, doc.ref);

    for (let i = 0; i < accountIds.length; i += 10) {
      const chunk = accountIds.slice(i, i + 10);
      const byAccount = await txCol.where('plaidAccountId', 'in', chunk).get();
      for (const doc of byAccount.docs) toDelete.set(doc.ref.path, doc.ref);
    }

    let removedTx = 0;
    let batch = db.batch();
    for (const ref of toDelete.values()) {
      batch.delete(ref);
      removedTx++;
      if (removedTx % 400 === 0) {
        await batch.commit();
        batch = db.batch();
      }
    }
    batch.delete(itemRef);
    batch.delete(db.doc(`plaidItemsByItem/${itemId}`));
    await batch.commit();

    return { removed: true, removedTransactions: removedTx };
  },
);

// --- Webhook (ongoing background sync) ----------------------------------------

/** Resolve which user owns a Plaid item via the server-only reverse index. */
async function uidForItem(itemId: string): Promise<string | null> {
  const snap = await getFirestore().doc(`plaidItemsByItem/${itemId}`).get();
  return snap.exists ? ((snap.data()?.uid as string) ?? null) : null;
}

/**
 * Verify a Plaid webhook is genuine: the `plaid-verification` header is a JWT
 * (ES256) signed by Plaid; we fetch the matching key, verify the signature and
 * freshness, then confirm the JWT's request_body_sha256 matches the raw body.
 */
async function verifyPlaidWebhook(
  token: string | undefined,
  rawBody: Buffer,
  client: PlaidApi,
): Promise<boolean> {
  if (!token) return false;
  try {
    const header = decodeProtectedHeader(token);
    if (header.alg !== 'ES256' || !header.kid) return false;

    const keyResp = await client.webhookVerificationKeyGet({ key_id: header.kid });
    const jwk = keyResp.data.key;
    const publicKey = await importJWK({ kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y } as any, 'ES256');

    const { payload } = await jwtVerify(token, publicKey, { algorithms: ['ES256'], maxTokenAge: '5 min' });

    const bodyHash = createHash('sha256').update(rawBody).digest('hex');
    return (payload as Record<string, unknown>)['request_body_sha256'] === bodyHash;
  } catch (err) {
    console.error('Plaid webhook verification failed:', err);
    return false;
  }
}

/**
 * Plaid calls this when new transaction data is available. We verify the request,
 * find the owning user, and run the same envelope-encrypting sync unattended —
 * no browser required. PLAID_WEBHOOK_URL must point here and be registered on the
 * item (createLinkToken sets it on new links).
 */
export const plaidWebhook = onRequest(
  { secrets: [plaidClientId, plaidSecret, tokenEncKey] },
  async (req, res) => {
    if (req.method !== 'POST') {
      res.status(405).send('Method not allowed');
      return;
    }

    const client = getPlaidClient(plaidClientId.value(), plaidSecret.value(), plaidEnv.value());

    const verified = await verifyPlaidWebhook(
      req.header('plaid-verification'),
      req.rawBody,
      client,
    );
    if (!verified) {
      res.status(401).send('invalid signature');
      return;
    }

    const { webhook_type, webhook_code, item_id } = req.body ?? {};
    console.log('Plaid webhook:', webhook_type, webhook_code, item_id);

    if (webhook_type === 'TRANSACTIONS' && item_id) {
      const uid = await uidForItem(item_id);
      try {
        const publicKey = uid ? await getUserPublicKey(uid) : null;
        if (uid && publicKey) {
          const itemDoc = await getFirestore().doc(`users/${uid}/plaidItems/${item_id}`).get();
          if (itemDoc.exists) {
            const totals = await syncItem(uid, itemDoc, client, tokenEncKey.value(), publicKey);
            console.log('Webhook sync complete for', item_id, totals);
          }
        } else {
          console.warn('Webhook: no user/public key for item', item_id);
        }
      } catch (err: any) {
        console.error('Webhook sync failed for', item_id, err);
        if (uid) {
          const code = err?.response?.data?.error_code;
          await getFirestore().doc(`users/${uid}/plaidItems/${item_id}`).set(
            { status: statusForErrorCode(code), lastError: code || 'sync_failed', updatedAt: Date.now() },
            { merge: true },
          ).catch(() => {}); // best-effort — don't let a status-flag failure break the ack
        }
      }
    }

    // ITEM webhooks report the item's health directly, independent of any sync
    // attempt — this is how Plaid tells us proactively that re-auth is needed
    // (or that it recovered) rather than us only discovering it on next sync.
    if (webhook_type === 'ITEM' && item_id) {
      try {
        const uid = await uidForItem(item_id);
        if (uid) {
          const itemRef = getFirestore().doc(`users/${uid}/plaidItems/${item_id}`);
          if (webhook_code === 'LOGIN_REPAIRED') {
            await itemRef.set({ status: 'active', lastError: null, updatedAt: Date.now() }, { merge: true });
          } else if (webhook_code === 'ERROR') {
            const code = req.body?.error?.error_code as string | undefined;
            await itemRef.set(
              { status: statusForErrorCode(code), lastError: code || 'item_error', updatedAt: Date.now() },
              { merge: true },
            );
          } else if (webhook_code === 'PENDING_EXPIRATION' || webhook_code === 'PENDING_DISCONNECT') {
            await itemRef.set(
              { status: 'login_required', lastError: webhook_code, updatedAt: Date.now() },
              { merge: true },
            );
          }
          // Other ITEM codes (e.g. WEBHOOK_UPDATE_ACKNOWLEDGED) need no status change.
        }
      } catch (err) {
        console.error('Webhook ITEM handling failed for', item_id, err);
      }
    }

    // Always ack so Plaid does not retry a request we have accepted.
    res.status(200).send('ok');
  },
);
