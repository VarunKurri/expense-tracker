import { onCall, onRequest, HttpsError } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';
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
 * valid; the user just re-authenticates at their bank. No new exchange needed;
 * Plaid clears the item's error state once update-mode Link completes.
 *
 * With `account_selection: true` it also lets the user choose which accounts
 * the item shares ("Manage accounts"): how a replaced card, or any new
 * account, gets added to an existing connection instead of linking the bank a
 * second time (which, for Chase, can invalidate the existing item).
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
    const accountSelection = request.data?.account_selection === true;

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
        ...(accountSelection ? { update: { account_selection_enabled: true } } : {}),
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
// Plaid category values that indicate money moving between the user's own
// accounts (e.g. a credit card payment) rather than real spending/earning.
// TRANSFER_IN/TRANSFER_OUT cover most internal transfers; generic LOAN_PAYMENTS
// is left alone (could be a real loan, not a transfer) except for the specific
// credit-card-payment detailed subtype.
function isInternalTransferCategory(primary: string | undefined, detailed: string | undefined): boolean {
  if (primary === 'TRANSFER_IN' || primary === 'TRANSFER_OUT') return true;
  if (detailed === 'LOAN_PAYMENTS_CREDIT_CARD_PAYMENT') return true;
  return false;
}

function mapPlaidTransaction(t: PlaidTransaction, itemId: string): Record<string, unknown> {
  const now = Date.now();
  // Plaid convention: positive amount = money leaving the account (expense),
  // negative = money coming in (income).
  const type = t.amount < 0 ? 'income' : 'expense';
  const pfcPrimary = t.personal_finance_category?.primary;
  const pfcDetailed = t.personal_finance_category?.detailed;
  return {
    type,
    amount: Math.abs(t.amount),
    // authorized_date is the day the purchase actually happened; date is when it
    // posted (can lag by a few days, or a purchase could still be cancelled before
    // posting). Prefer authorized_date, falling back to date when Plaid doesn't
    // supply one (common for some institutions/pending rows).
    date: t.authorized_date ?? t.date, // YYYY-MM-DD
    // When it posted, which is what a statement goes by. A pending row hasn't
    // (its `date` is when it happened), so it has none yet.
    ...(t.pending ? {} : { postedDate: t.date }),
    merchant: t.merchant_name || t.name || 'Unknown',
    createdAt: now,
    updatedAt: now,
    plaidTransactionId: t.transaction_id,
    plaidItemId: itemId,
    plaidAccountId: t.account_id,
    plaidPersonalFinanceCategory: pfcPrimary,
    plaidPending: t.pending,
    isInternalTransfer: isInternalTransferCategory(pfcPrimary, pfcDetailed),
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
 * Sync one Plaid item: page through `transactionsSync` from the stored cursor
 * and write each transaction, envelope-encrypted to the user's public key.
 *
 * Where a transaction lives: normally the doc named after its Plaid id. Two
 * things move that, recorded in `plaidTxIndex/{plaidId} -> { docId }` (server
 * written, plus the app when you merge a duplicate):
 *  - a pending charge that posts arrives as a new posted id (with
 *    pending_transaction_id) plus `removed: [pendingId]`. The posted version
 *    goes INTO the pending row's doc, so the doc never changes and anything
 *    you did while it was pending (notes, a split, a category, a repayment
 *    linked to it) stays with it;
 *  - a bank row you merged into your own entry.
 *
 * A row you've edited is re-encrypted with your key, so the server can't read
 * or merge it: the bank's version waits beside it as `bankUpdate` and the app
 * folds in the bank's figures. A removed row is deleted (a cancelled pending
 * charge is simply gone); one you'd edited gets `bankRemoved` and the app
 * decides (a cancelled pending row goes, anything else is asked about).
 * Removals are done after every page, so a pending id that posted on a later
 * page is never mistaken for a cancellation.
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
  const indexCol = db.collection(`users/${uid}/plaidTxIndex`);

  const totals: ItemSyncTotals = { added: 0, modified: 0, removed: 0 };
  let cursor: string | undefined = item.cursor || undefined;
  let hasMore = true;
  // Pending ids whose row took its posted version: their removal isn't a cancellation.
  const postedOver = new Set<string>();
  const removedIds: string[] = [];

  while (hasMore) {
    const resp = await client.transactionsSync({ access_token: accessToken, cursor });
    const { added, modified, removed, next_cursor, has_more } = resp.data;
    const incoming = [...added, ...modified];

    const home = await homesFor(indexCol, [
      ...incoming.map(t => t.transaction_id),
      ...incoming.map(t => t.pending_transaction_id).filter((id): id is string => !!id),
    ]);
    const docIdFor = (id: string) => home.get(id) ?? id;
    const wanted = incoming.map(t => home.get(t.transaction_id)
      ?? (t.pending_transaction_id ? docIdFor(t.pending_transaction_id) : t.transaction_id));
    // Their own docs too, in case the posted one already stands alone.
    const docs = await docStates(txCol, [...wanted, ...incoming.map(t => t.transaction_id)]);

    const batch = db.batch();
    incoming.forEach((t, i) => {
      let target = wanted[i];
      // The pending row is gone (or never came): the posted one stands on its own.
      if (target !== t.transaction_id && !docs.get(target)?.exists) target = t.transaction_id;
      const envelope = envelopeDoc(mapPlaidTransaction(t, itemDoc.id), publicKey);
      if (docs.get(target)?.edited) {
        batch.set(txCol.doc(target), { bankUpdate: envelope }, { merge: true });
      } else {
        batch.set(txCol.doc(target), envelope);
      }
      if (target !== t.transaction_id) {
        batch.set(indexCol.doc(t.transaction_id), { docId: target });
        if (t.pending_transaction_id && target === docIdFor(t.pending_transaction_id)) {
          postedOver.add(t.pending_transaction_id);
          batch.set(indexCol.doc(t.pending_transaction_id), { docId: target, postedAs: t.transaction_id });
        }
      }
    });
    // Advance the cursor atomically with this page's writes.
    batch.set(itemDoc.ref, { cursor: next_cursor, status: 'active', updatedAt: Date.now() }, { merge: true });
    await batch.commit();

    removedIds.push(...removed.map(r => r.transaction_id).filter((id): id is string => !!id));
    totals.added += added.length;
    totals.modified += modified.length;
    totals.removed += removed.length;
    cursor = next_cursor;
    hasMore = has_more;
  }

  let gone = removedIds.filter(id => !postedOver.has(id));
  if (gone.length > 0) {
    const home = await homesFor(indexCol, gone);
    gone = gone.filter(id => !home.posted?.has(id));
    const targets = gone.map(id => home.get(id) ?? id);
    const docs = await docStates(txCol, targets);
    let batch = db.batch();
    let n = 0;
    for (let i = 0; i < gone.length; i++) {
      const state = docs.get(targets[i]);
      if (state?.exists) {
        if (state.edited) batch.set(txCol.doc(targets[i]), { bankRemoved: true }, { merge: true });
        else batch.delete(txCol.doc(targets[i]));
      }
      if (home.has(gone[i])) batch.delete(indexCol.doc(gone[i]));
      if (++n % 200 === 0) { await batch.commit(); batch = db.batch(); }
    }
    await batch.commit();
  }

  return totals;
}

/**
 * Plaid ids that live in another doc (see syncItem), as id -> docId. A
 * pending id whose row took its posted version is in `posted`: removing that
 * pending id later is the bank tidying up, not a cancellation.
 */
async function homesFor(
  indexCol: FirebaseFirestore.CollectionReference, ids: string[],
): Promise<Map<string, string> & { posted?: Set<string> }> {
  const unique = [...new Set(ids)];
  const out: Map<string, string> & { posted?: Set<string> } = new Map();
  out.posted = new Set();
  for (let i = 0; i < unique.length; i += 300) {
    const snaps = await getFirestore().getAll(...unique.slice(i, i + 300).map(id => indexCol.doc(id)));
    for (const snap of snaps) {
      if (!snap.exists) continue;
      const docId = snap.data()?.['docId'] as string | undefined;
      if (docId) out.set(snap.id, docId);
      if (snap.data()?.['postedAs']) out.posted.add(snap.id);
    }
  }
  return out;
}

/** Whether each doc exists, and whether you've edited it (no longer the envelope the bank wrote). */
async function docStates(txCol: FirebaseFirestore.CollectionReference, ids: string[]): Promise<Map<string, { exists: boolean; edited: boolean }>> {
  const unique = [...new Set(ids)];
  const out = new Map<string, { exists: boolean; edited: boolean }>();
  for (let i = 0; i < unique.length; i += 300) {
    const snaps = await getFirestore().getAll(...unique.slice(i, i + 300).map(id => txCol.doc(id)));
    for (const snap of snaps) out.set(snap.id, { exists: snap.exists, edited: snap.exists && !snap.data()?.['__envelope'] });
  }
  return out;
}

/**
 * The item's accounts (balances and card statement details), saved beside
 * the item envelope-encrypted to the user's key. The app's accounts are
 * encrypted with a key the server never has, so it can't update them itself:
 * the app applies this copy whenever it changes, so balances and card
 * payments stay current without anyone pressing Sync.
 */
async function snapshotAccounts(
  itemDoc: FirebaseFirestore.DocumentSnapshot, client: PlaidApi, tokenEncKeyValue: string, publicKey: string,
): Promise<void> {
  const accessToken = decryptToken(itemDoc.data()!.accessToken as EncryptedValue, tokenEncKeyValue);
  const accounts = await loadPlaidAccounts(client, accessToken, itemDoc.id);
  const pending = await recentPending(client, accessToken).catch(err => {
    console.warn(`pending list failed for item ${itemDoc.id}:`, err?.response?.data?.error_code || err?.message);
    return null;
  });
  const env = envelopeEncrypt(JSON.stringify({ accounts, ...(pending ? { pending } : {}) }), publicKey);
  const now = Date.now();
  await itemDoc.ref.set({
    accountsSnapshot: {
      __envelope: true, encryptionVersion: 1,
      encryptedDEK: env.encryptedDEK, encryptedPayload: env.ciphertext, iv: env.iv, tag: env.tag,
    },
    accountsSnapshotAt: now,
  }, { merge: true });
}

/**
 * What the bank has as pending right now (last 30 days), and which posted
 * transaction each pending one became. Pending is the bank's state, not
 * something a row should remember: the app shows Pending only for what's in
 * this list, and folds a posted transaction into the row that was pending
 * (some banks never link the two, so the app also matches them itself).
 */
async function recentPending(client: PlaidApi, accessToken: string) {
  const end = new Date();
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - 30);
  const windowStart = start.toISOString().slice(0, 10);
  const pendingIds: string[] = [];
  const postedFrom: Record<string, string> = {};
  let offset = 0;
  let total = Infinity;
  while (offset < total) {
    const resp = await client.transactionsGet({
      access_token: accessToken, start_date: windowStart, end_date: end.toISOString().slice(0, 10),
      options: { count: 500, offset },
    });
    total = resp.data.total_transactions;
    for (const t of resp.data.transactions) {
      if (t.pending) pendingIds.push(t.transaction_id);
      else if (t.pending_transaction_id) postedFrom[t.pending_transaction_id] = t.transaction_id;
    }
    if (resp.data.transactions.length === 0) break;
    offset += resp.data.transactions.length;
  }
  return { windowStart, pendingIds, postedFrom };
}

/** Point the item's webhooks at this app (items linked before the webhook existed never got them). */
async function ensureWebhook(itemDoc: FirebaseFirestore.DocumentSnapshot, client: PlaidApi, tokenEncKeyValue: string): Promise<void> {
  const url = plaidWebhookUrl.value();
  if (!url || itemDoc.data()?.['webhookUrl'] === url) return;
  const accessToken = decryptToken(itemDoc.data()!.accessToken as EncryptedValue, tokenEncKeyValue);
  await client.itemWebhookUpdate({ access_token: accessToken, webhook: url });
  await itemDoc.ref.set({ webhookUrl: url }, { merge: true });
}

/** Everything a bank needs to be current: its webhook, its transactions, its balances. */
async function refreshItem(
  uid: string, itemDoc: FirebaseFirestore.DocumentSnapshot, client: PlaidApi, tokenEncKeyValue: string, publicKey: string,
): Promise<ItemSyncTotals> {
  await ensureWebhook(itemDoc, client, tokenEncKeyValue).catch(err =>
    console.warn(`webhook update failed for item ${itemDoc.id}:`, err?.response?.data || err?.message));
  const totals = await syncItem(uid, itemDoc, client, tokenEncKeyValue, publicKey);
  await snapshotAccounts(itemDoc, client, tokenEncKeyValue, publicKey).catch(err =>
    console.warn(`account snapshot failed for item ${itemDoc.id}:`, err?.response?.data || err?.message));
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
      const r = await refreshItem(uid, itemDoc, client, tokenEncKeyValue, publicKey);
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
 * Background sync, so the app is current without pressing Sync: every few
 * hours each linked bank's transactions and balances are refreshed (the
 * webhook does it as soon as the bank has news; this catches anything a
 * webhook missed, and banks that never send one).
 */
export const scheduledPlaidSync = onSchedule(
  { schedule: 'every 6 hours', secrets: [plaidClientId, plaidSecret, tokenEncKey], timeoutSeconds: 540 },
  async () => {
    const client = getPlaidClient(plaidClientId.value(), plaidSecret.value(), plaidEnv.value());
    const items = await getFirestore().collectionGroup('plaidItems').get();
    const uids = new Set(items.docs.map(d => d.ref.parent.parent?.id).filter((id): id is string => !!id));
    for (const uid of uids) {
      try {
        const totals = await syncUser(uid, client, tokenEncKey.value());
        console.log('Scheduled sync for', uid, totals);
      } catch (err: any) {
        console.warn('Scheduled sync skipped for', uid, err?.message || err);
      }
    }
  },
);

/**
 * Ask Plaid to proactively re-poll the institution right now, outside its normal
 * polling cadence. Useful when a user suspects transactions are missing, e.g. an
 * institution that only just posted data, or as a way to confirm whether a low
 * transaction count is a timing issue vs. a real limit on how much history that
 * institution shares. Plaid fires TRANSACTIONS/DEFAULT_UPDATE (and
 * SYNC_UPDATES_AVAILABLE) via our existing webhook once the refresh completes, so
 * no separate sync call is needed here: just trigger and wait for the webhook.
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

    const results: { itemId: string; institutionName: string; ok: boolean; error?: string; errorCode?: string }[] = [];
    for (const itemDoc of itemsSnap.docs) {
      const institutionName = (itemDoc.data()?.institutionName as string) || 'Your bank';
      try {
        const accessToken = decryptToken(itemDoc.data()!.accessToken as EncryptedValue, tokenEncKey.value());
        await client.transactionsRefresh({ access_token: accessToken });
        results.push({ itemId: itemDoc.id, institutionName, ok: true });
      } catch (err: any) {
        const data = err?.response?.data;
        const message = data?.display_message || data?.error_message || err?.message || 'Refresh failed.';
        const errorCode: string | undefined = data?.error_code;
        console.error(`transactionsRefresh failed for item ${itemDoc.id}:`, data || err);
        // A login problem means syncing is broken too: show Reconnect for it.
        if (errorCode && REAUTH_ERROR_CODES.has(errorCode)) {
          await itemDoc.ref.set(
            { status: statusForErrorCode(errorCode), lastError: errorCode, updatedAt: Date.now() }, { merge: true });
        }
        results.push({ itemId: itemDoc.id, institutionName, ok: false, error: message, ...(errorCode ? { errorCode } : {}) });
      }
    }
    return { results };
  },
);

/** The accounts under an item, with balances and (for cards) statement details. */
async function loadPlaidAccounts(client: PlaidApi, accessToken: string, itemId: string) {
  const resp = await client.accountsGet({ access_token: accessToken });

  // Liabilities (min payment, due date, statement date) is a separate call and a
  // separate consent scope. Items linked before Liabilities was requested at Link
  // time will fail here (e.g. PRODUCT_NOT_READY / no access). That's expected for
  // not-yet-relinked items, so we degrade gracefully rather than fail the whole call.
  type CreditInfo = {
    min: number | null;
    dueDay: number | null;
    statementDay: number | null;
    statementBalance: number | null; // last closed statement balance: what's actually due
    dueDate: string | null;          // exact next payment due date (YYYY-MM-DD)
    statementIssueDate: string | null; // last statement close date, for paid detection
    lastPaymentDate: string | null;    // when the last payment posted
    lastPaymentAmount: number | null;  // how much the last payment was
    isOverdue: boolean | null;         // Plaid's own overdue flag (authoritative)
  };
  const creditByAccountId = new Map<string, CreditInfo>();
  try {
    const liab = await client.liabilitiesGet({ access_token: accessToken });
    const creditList = liab.data.liabilities?.credit ?? [];
    // Diagnostic: shows exactly what statement/cycle data each institution returns
    // (e.g. confirms whether Discover ever provides Liabilities). Safe: no amounts
    // of user spending, just statement metadata for the linked cards.
    console.log(`liabilitiesGet item ${itemId}: ${creditList.length} credit account(s):`,
      JSON.stringify(creditList.map(c => ({
        account_id: c.account_id,
        last_statement_balance: c.last_statement_balance,
        last_statement_issue_date: c.last_statement_issue_date,
        next_payment_due_date: c.next_payment_due_date,
        is_overdue: c.is_overdue,
      }))));
    for (const c of creditList) {
      if (!c.account_id) continue;
      creditByAccountId.set(c.account_id, {
        min: c.minimum_payment_amount ?? null,
        dueDay: dayOfMonth(c.next_payment_due_date),
        statementDay: dayOfMonth(c.last_statement_issue_date),
        statementBalance: c.last_statement_balance ?? null,
        dueDate: c.next_payment_due_date ?? null,
        statementIssueDate: c.last_statement_issue_date ?? null,
        lastPaymentDate: c.last_payment_date ?? null,
        lastPaymentAmount: c.last_payment_amount ?? null,
        isOverdue: c.is_overdue ?? null,
      });
    }
  } catch (err: any) {
    console.warn('liabilitiesGet unavailable (item may need re-link for this product):', err?.response?.data?.error_code || err?.message);
  }

  return resp.data.accounts.map(a => {
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
      statement_balance: credit?.statementBalance ?? null,
      payment_due_date: credit?.dueDate ?? null,
      statement_issue_date: credit?.statementIssueDate ?? null,
      last_payment_date: credit?.lastPaymentDate ?? null,
      last_payment_amount: credit?.lastPaymentAmount ?? null,
      is_overdue: credit?.isOverdue ?? null,
    };
  });
}

/**
 * Return the accounts held under a linked Plaid item (name, mask, type, balance)
 * so the client can auto-create matching app accounts. Not stored server-side;
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
      return { accounts: await loadPlaidAccounts(client, accessToken, itemId) };
    } catch (err: any) {
      const plaidError = err?.response?.data;
      console.error('getPlaidAccounts failed:', plaidError || err);
      throw new HttpsError('internal', plaidError?.error_message || err?.message || 'Failed to load bank accounts.');
    }
  },
);

/**
 * Disconnect a linked bank: remove the item at Plaid (stops billing/syncs), then
 * delete its stored data: the plaidItems doc, the reverse index, and every
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

    // Look up this item's Plaid account_ids *before* removing the item, because the
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
 * find the owning user, and run the same envelope-encrypting sync unattended,
 * with no browser required. PLAID_WEBHOOK_URL must point here and be registered on the
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
            const totals = await refreshItem(uid, itemDoc, client, tokenEncKey.value(), publicKey);
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
          ).catch(() => {}); // best-effort: don't let a status-flag failure break the ack
        }
      }
    }

    // New statement details (a card's balance due, due date): refresh the
    // account snapshot so Credit card payments update on their own.
    if (webhook_type === 'LIABILITIES' && item_id) {
      try {
        const uid = await uidForItem(item_id);
        const publicKey = uid ? await getUserPublicKey(uid) : null;
        if (uid && publicKey) {
          const itemDoc = await getFirestore().doc(`users/${uid}/plaidItems/${item_id}`).get();
          if (itemDoc.exists) await snapshotAccounts(itemDoc, client, tokenEncKey.value(), publicKey);
        }
      } catch (err) {
        console.error('Webhook LIABILITIES handling failed for', item_id, err);
      }
    }

    // ITEM webhooks report the item's health directly, independent of any sync
    // attempt. This is how Plaid tells us proactively that re-auth is needed
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
          } else if (webhook_code === 'NEW_ACCOUNTS_AVAILABLE') {
            // A new account (a replaced card, say) the user hasn't shared with
            // us yet. Flag it; "Manage accounts" in the app adds it.
            await itemRef.set({ newAccountsAvailable: true, updatedAt: Date.now() }, { merge: true });
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

// Receipt scanning (OpenAI): see receipt.ts.
export { scanReceipt } from './receipt';
