import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { defineSecret, defineString } from 'firebase-functions/params';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';

/**
 * Receipt scanning: one photo in, what's printed on it out.
 *
 * The browser shrinks the photo (1600px JPEG) and sends it here; this sends it
 * to OpenAI and returns the model's reading as JSON. The photo is never stored
 * or logged; it lives only for the length of this call. Only token counts are
 * logged, so the cost of a scan can be checked in the Functions logs.
 *
 * Setup (once):
 *   firebase functions:secrets:set OPENAI_API_KEY
 * The model can be changed without a code change via RECEIPT_MODEL in
 * functions/.env (default gpt-6-luna).
 *
 * The client (src/app/utils/receipt.ts → cleanScan) still checks every field:
 * this function only makes sure the answer is the JSON we asked for.
 */

const openaiKey = defineSecret('OPENAI_API_KEY');
const DEFAULT_MODEL = 'gpt-6-luna';
const receiptModel = defineString('RECEIPT_MODEL', { default: DEFAULT_MODEL });

/** Scans per person per day, as a guard against a runaway loop costing money. */
const DAILY_LIMIT = 40;
/** ~4 MB of image; the browser sends well under 1 MB. */
const MAX_IMAGE_CHARS = 5_600_000;

const INSTRUCTIONS = `You read photos of receipts from shops, restaurants and delivery apps (DoorDash, Uber Eats, Instacart, Grubhub) and report exactly what is printed.
- Money is integer cents: $12.50 is 1250. Every amount you return is positive.
- items: one entry per printed item line, at its printed price. If a line shows a quantity ("2 x Mandi 50.00", "3× Biryani US$41.97"), set quantity to it, totalCents to the line total, and unitPriceCents to the price of one. Otherwise quantity 1 and unitPriceCents null unless printed. Never take discounts off item prices, except a discount printed directly under one item, which belongs to that item.
- Never list subtotal, tax, tip, total, payment, card, change or balance lines as items.
- fees: every charge that is not an item, tax or tip, each with its printed name: delivery fee, service fee, small order fee, long distance fee, expanded range fee, regulatory response fee, bag fee, service charge.
- discounts: everything that lowers the total, each with its printed name: discounts, promotions, coupons, member savings, DashPass/Uber One savings, app credits (e.g. "DoorDash Credits"), gift cards.
- taxCents: all tax lines added together ("Estimated Tax" counts).
- tipCents: gratuity or tip, including a Dasher/driver tip or a handwritten tip; 0 if none. Ignore suggested-tip tables.
- totalCents: the final amount charged, after discounts and credits and including tip.
- date: YYYY-MM-DD. merchant: the restaurant or store (for a delivery app, the restaurant, not the app).
- Anything not on the receipt: null, or 0 / an empty list.
- If the image is not a receipt, set isReceipt false and leave everything else empty.
- confidence: 0 to 1, how sure you are that every number was read correctly.`;

const nullableCents = { type: ['integer', 'null'] };
/** A named fee or discount: "Service fee", 315. */
const NAMED_AMOUNTS = {
  type: 'array',
  items: {
    type: 'object',
    additionalProperties: false,
    required: ['name', 'cents'],
    properties: { name: { type: 'string' }, cents: { type: 'integer' } },
  },
};
const RECEIPT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['isReceipt', 'merchant', 'date', 'items', 'subtotalCents', 'fees', 'discounts', 'taxCents', 'tipCents', 'totalCents', 'confidence'],
  properties: {
    isReceipt: { type: 'boolean' },
    merchant: { type: ['string', 'null'] },
    date: { type: ['string', 'null'], description: 'YYYY-MM-DD' },
    items: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'quantity', 'unitPriceCents', 'totalCents'],
        properties: {
          name: { type: 'string' },
          quantity: { type: 'integer' },
          unitPriceCents: nullableCents,
          totalCents: { type: 'integer' },
        },
      },
    },
    subtotalCents: nullableCents,
    fees: NAMED_AMOUNTS,
    discounts: NAMED_AMOUNTS,
    taxCents: { type: 'integer' },
    tipCents: { type: 'integer' },
    totalCents: nullableCents,
    confidence: { type: 'number' },
  },
};

/** Counts today's scans for this person, refusing past the daily limit. */
async function takeQuota(uid: string): Promise<void> {
  const day = new Date().toISOString().slice(0, 10);
  // Outside users/{uid}, so the rules' catch-all keeps clients from resetting it.
  const ref = getFirestore().doc(`receiptScanUsage/${uid}`);
  await getFirestore().runTransaction(async tx => {
    const snap = await tx.get(ref);
    const count = snap.exists && snap.get('day') === day ? Number(snap.get('count')) || 0 : 0;
    if (count >= DAILY_LIMIT) {
      throw new HttpsError('resource-exhausted', `That's ${DAILY_LIMIT} scans today. The limit resets tomorrow.`);
    }
    tx.set(ref, { day, count: count + 1, updatedAt: FieldValue.serverTimestamp() });
  });
}

/** The text of the model's answer, or null if it refused or ran out of room. */
function outputText(body: any): string | null {
  if (body?.status && body.status !== 'completed') return null;
  for (const item of body?.output ?? []) {
    if (item?.type !== 'message') continue;
    for (const part of item.content ?? []) {
      if (part?.type === 'output_text' && typeof part.text === 'string') return part.text;
    }
  }
  return null;
}

export const scanReceipt = onCall(
  { secrets: [openaiKey], timeoutSeconds: 90, memory: '512MiB' },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Sign in to scan a receipt.');
    }
    const image = request.data?.image;
    if (typeof image !== 'string' || !/^data:image\/(jpeg|png|webp);base64,/.test(image)) {
      throw new HttpsError('invalid-argument', 'Send the receipt as a JPEG, PNG or WebP image.');
    }
    if (image.length > MAX_IMAGE_CHARS) {
      throw new HttpsError('invalid-argument', 'That image is too large. Try a smaller photo.');
    }

    await takeQuota(request.auth.uid);

    // The CLI fills in the default on deploy; fall back to it anywhere else.
    const model = receiptModel.value() || DEFAULT_MODEL;
    const started = Date.now();
    let res: Response;
    try {
      res = await fetch('https://api.openai.com/v1/responses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${openaiKey.value()}` },
        body: JSON.stringify({
          model,
          instructions: INSTRUCTIONS,
          input: [{
            role: 'user',
            content: [
              { type: 'input_text', text: 'Read this receipt.' },
              { type: 'input_image', image_url: image, detail: 'high' },
            ],
          }],
          text: { format: { type: 'json_schema', name: 'receipt', strict: true, schema: RECEIPT_SCHEMA } },
          max_output_tokens: 8000,
          store: false,
        }),
        signal: AbortSignal.timeout(80_000),
      });
    } catch (err: any) {
      console.error('scanReceipt: request failed', { model, name: err?.name });
      throw new HttpsError('unavailable', 'Could not reach the receipt reader. Try again in a moment.');
    }

    const body: any = await res.json().catch(() => null);
    if (!res.ok) {
      // Status and error code only: never the request, never the image.
      console.error('scanReceipt: OpenAI error', { model, status: res.status, code: body?.error?.code ?? null });
      if (res.status === 401) throw new HttpsError('failed-precondition', "Receipt scanning isn't set up yet (the OpenAI key is missing or wrong).");
      if (res.status === 429) throw new HttpsError('resource-exhausted', 'The receipt reader is busy. Try again in a minute.');
      throw new HttpsError('internal', 'The receipt reader had a problem. Try again.');
    }

    const usage = body?.usage ?? {};
    console.info('scanReceipt', {
      model,
      ms: Date.now() - started,
      inputTokens: usage.input_tokens ?? null,
      outputTokens: usage.output_tokens ?? null,
      reasoningTokens: usage.output_tokens_details?.reasoning_tokens ?? null,
    });

    const text = outputText(body);
    if (!text) {
      console.warn('scanReceipt: no answer', { model, status: body?.status ?? null, reason: body?.incomplete_details?.reason ?? null });
      throw new HttpsError('internal', "Couldn't read that receipt. Try a sharper, flatter photo.");
    }
    try {
      return JSON.parse(text);
    } catch {
      throw new HttpsError('internal', "Couldn't read that receipt. Try again.");
    }
  },
);
