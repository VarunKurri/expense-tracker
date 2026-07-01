import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { defineSecret, defineString } from 'firebase-functions/params';
import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { CountryCode, Products } from 'plaid';
import { getPlaidClient } from './plaidClient';
import { encryptToken } from './crypto';

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
        cursor: '', // empty until the first /transactions/sync (next milestone)
        status: 'active',
        createdAt: now,
        updatedAt: now,
      });

      return { itemId, institutionName };
    } catch (err: any) {
      const plaidError = err?.response?.data;
      console.error('exchangePublicToken failed:', plaidError || err);
      const message = plaidError?.error_message || err?.message || 'Failed to link the bank account.';
      throw new HttpsError('internal', message);
    }
  },
);
