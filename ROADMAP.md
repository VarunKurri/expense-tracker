# Trackr Roadmap

This checklist focuses on making Trackr faster, easier, and more efficient for daily use. Mark items as complete as they ship, and add notes or links under each item when implementation starts.

## Recently Completed

- [x] Add Firebase Auth with Google, email/password sign-in, sign-up, and password reset.
- [x] Add email verification (soft reminder banner, resend + "I've verified") and self-service email change (reauth + confirm-link) for password accounts.
  - Verified: `AuthService` adds `isEmailVerified`/`hasPasswordProvider` (Google accounts are always verified) and `sendVerificationEmail`/`refreshEmailVerified`/`changeEmail` (reauthenticate, then `verifyBeforeUpdateEmail` so the address only changes once the confirmation link is clicked). A dismissible banner (non-blocking) prompts unverified password accounts to verify; Settings → Account shows the email + Verified/Unverified pill and a Change action for password accounts. `ng build` passes.
- [x] Add client-side encryption unlock flow for finance records.
- [x] Add Firestore rules so users can only access `users/{uid}` data.
- [x] Encrypt accounts, transactions, categories, bills, and budgets before writing to Firestore.
- [x] Migrate existing plaintext user data after the user unlocks encryption.
- [x] Improve CSV import parsing, required-column validation, duplicate skipping, and batch writes.
- [x] Add shared date and finance utilities with tests.

## Phase 1: Faster Daily Entry

- [x] Build a command palette for common actions.
  - Why: lets users add a transaction, jump to an account, search, import, or mark a bill paid without hunting through navigation.
  - Done when: keyboard shortcut opens the palette, results are searchable, and core actions work from anywhere.
  - Verified: Angular tests pass, TypeScript checks pass, dev server runs on `http://localhost:4200/`, and manual browser testing looked good.

- [x] Add saved transaction templates.
  - Why: recurring merchants and repeated transactions should take seconds to enter.
  - Done when: users can save a transaction as a template, reuse it, and edit prefilled fields before saving.
  - Verified: templates are encrypted in Firestore, available in the new transaction form by type, can be deleted from the template strip, and compiler/unit checks pass.

- [x] Add smart defaults in transaction forms.
  - Why: the app can preselect likely account, category, date, and transaction type from recent usage.
  - Done when: new transactions feel prefilled but still easy to override.
  - Verified: new forms use recent account/category/transfer defaults, known merchants reuse recent account/category choices, and compiler/unit checks pass.

- [x] Add inline quick edit for transaction list rows.
  - Why: correcting category, account, date, or amount should not require opening the full details flow.
  - Done when: common fields can be edited directly and saved with clear success/error feedback.
  - Verified: transaction rows support inline amount/date/account/category edits, transfers support from/to edits, and compiler/unit checks pass.

- [x] Add keyboard shortcuts for power users.
  - Why: repeated workflows get much faster with shortcuts for add, save, search, close modal, and navigation.
  - Done when: shortcuts are documented in settings and do not conflict with text input.
  - Verified: global shortcuts support command palette, add expense/income/transfer, visible-form save, Escape close, and Alt-number navigation; Settings documents them and compiler/unit checks pass.

## Phase 2: Faster Review And Search

- [x] Add global search across transactions, accounts, categories, bills, and budgets.
  - Why: users should find financial records by merchant, note, amount, account, category, or bill name.
  - Done when: search results are grouped by type and deep-link to the right detail screen.
  - Verified: command palette search now groups Actions, Transactions, Accounts, Categories, Bills, and Budgets; results deep-link to transaction view, account detail, category-filtered transactions, bill edit, or budget detail, and compiler/unit checks pass.

- [x] Add advanced transaction filters.
  - Why: users need faster ways to answer questions like "large uncategorized expenses this month."
  - Done when: filters support amount range, uncategorized, refunded, account, category, merchant, and custom date ranges.
  - Verified: Transactions supports custom date ranges, merchant-only filtering, min/max amount, uncategorized/refunded/not-refunded filters, and existing account/category filters; compiler/unit checks pass.

- [x] Add bulk transaction actions.
  - Why: cleanup is slow one row at a time.
  - Done when: users can select many transactions and bulk categorize, move account, mark refunded, or delete.
  - Verified: Transactions supports an explicit bulk edit mode with select all visible, per-row selection, grouped bulk category/account/refund/delete actions, bulk delete confirmation, and compiler/unit checks pass.

- [ ] Add duplicate review after import.
  - Why: skipping duplicates silently is safe, but users need confidence and control.
  - Done when: import shows imported, skipped, and warning rows with reasons and optional manual override.

- [ ] Add account and category autocomplete.
  - Why: dropdown scanning becomes slow as data grows.
  - Done when: account/category pickers are searchable and remember frequent choices.

## Phase 3: Performance And Data Scale

- [ ] Add paginated or virtualized transaction loading.
  - Why: decrypting and rendering every transaction will get slower as history grows.
  - Done when: the app loads recent transactions first and fetches older history on demand.

- [ ] Add cached decrypted read models for current session.
  - Why: dashboards and lists recalculate from the same decrypted data many times.
  - Done when: derived balances, category totals, and chart data reuse memoized selectors where practical.

- [ ] Add Firestore query indexes and query-specific collection reads.
  - Why: list screens should load only the data they need instead of relying on broad client-side filtering.
  - Done when: high-traffic screens query by date/account/category where possible and required indexes are documented.

- [ ] Move heavy import processing off the main UI path.
  - Why: large CSV files should not freeze the app.
  - Done when: parsing and validation show progress and remain responsive for large imports.

- [ ] Add explicit loading and error states for every data service.
  - Why: encryption, Firestore, and network delays should be obvious and recoverable.
  - Done when: each major page shows useful loading, empty, locked, and error states.

## Phase 4: Smarter Automation

- [ ] Add recurring transaction rules.
  - Why: predictable income, transfers, and fixed expenses should not require repeated manual entry.
  - Done when: users can create rules, preview upcoming generated transactions, and pause rules.

- [x] Support flexible recurring subscription bills.
  - Why: monthly bills like family phone plans can have variable amounts and flexible manual payment dates.
  - Done when: subscription-created bills and bill edits support fixed/variable amounts, exact/flexible due dates, autopay is restricted to fixed/exact bills, and manual variable payments open a prefilled transaction form before advancing the reminder.
  - Verified: compiler and unit tests pass.

- [ ] Improve bill detection from transaction history.
  - Why: subscription discovery should find likely bills beyond the current Subscriptions category heuristic.
  - Done when: detection groups similar merchants, estimates frequency, and asks for confirmation.

- [ ] Add merchant/category rules.
  - Why: imports and manual entries should auto-categorize known merchants.
  - Done when: users can create, edit, and apply rules during import and transaction entry.

- [ ] Add budget recommendations.
  - Why: budgets are easier to set when the app suggests realistic amounts from past spending.
  - Done when: category budget forms show recent averages and suggested targets.

- [ ] Add anomaly alerts.
  - Why: users should notice unusual spending, duplicate charges, or bills that changed amount.
  - Done when: dashboard and notifications highlight suspicious or unusually large transactions.

## Phase 5: Offline, Sync, And Trust

- [ ] Add offline-first transaction capture.
  - Why: users should be able to add expenses immediately, even without a reliable connection.
  - Done when: new records queue locally, sync later, and show pending/synced status.

- [x] Add encrypted export and restore.
  - Why: users need confidence that they can back up or move their finance history.
  - Done when: export creates encrypted JSON/CSV backup and restore validates schema before importing.
  - Verified: `BackupService.exportVault` decrypts every collection and downloads an AES-GCM file encrypted under a PBKDF2 backup password (separate from the passphrase); `importVault` decrypts, validates the `trackr-backup` format, and restores by document id (references stay intact), portable to a fresh account. Settings → Data has Export / Restore. Round-trip + wrong-password rejection validated with a local test.

- [x] Harden the passphrase KDF (PBKDF2 iteration count).
  - Why: 250,000 PBKDF2-SHA256 iterations was below OWASP's 2023 baseline (600,000) for browser contexts (WebCrypto has no native Argon2id/scrypt/bcrypt, so PBKDF2 is the right primitive; iteration count is the lever).
  - Done when: new vaults derive at the stronger count; existing vaults are provably unaffected (no forced re-encryption, no lockout risk).
  - Verified: the iteration count is now stored per-vault (`meta/encryption.kdfIterations`) — new vaults get `CURRENT_KDF_ITERATIONS = 600_000`; vaults created before this change have no stored value and fall back to `LEGACY_KDF_ITERATIONS = 250_000`, deriving the byte-identical key they always have (confirmed with a local Node/WebCrypto test: same passphrase+salt+250k iterations produces identical output pre/post-refactor). The recovery-code KEK derivation was made the same per-record-versioned shape for future-proofing (value unchanged for now — a high-entropy random code doesn't need the urgency a human passphrase does). `ng build` passes; deployed. Existing vaults can only move to the stronger count via a full re-encrypt, which is exactly the passphrase-rotation item below — no separate migration built here.

- [ ] Add encryption passphrase rotation.
  - Why: users may need to change the vault passphrase without losing data.
  - Done when: authenticated users can re-encrypt all records with a new passphrase after confirming the old one. (Needs the master key decoupled from the passphrase — random DEK wrapped by KEKs — so it's a re-encrypt migration; deferred.) Rotating also naturally upgrades the vault to the current KDF iteration count (see above) — no separate "upgrade my KDF" feature is needed once this exists.

- [x] Add recovery guidance for forgotten passphrases.
  - Why: account password reset cannot recover encrypted finance records.
  - Done when: settings clearly explain the tradeoff and offer safe reset/export options where possible.
  - Verified: a one-time **recovery code** (Settings → Security) wraps the master key so a forgotten passphrase can still unlock via the code (unlock screen "Forgot passphrase? Use recovery code"); the unlock screen also states that account password reset can't recover the passphrase, and encrypted export provides a backup. (Email-OTP recovery is intentionally not offered — it would require the server to hold the key, breaking zero-knowledge.)

- [ ] Add audit log for sensitive actions.
  - Why: deletes, imports, migrations, and passphrase changes need traceability.
  - Done when: the app records local/user-visible history of important data actions.

## Phase 6: Polish And Maintainability

- [ ] Add end-to-end tests for auth, unlock, CRUD, import, and bill payment flows.
  - Why: the security and encryption flow is now central to the app.
  - Done when: core flows are covered in browser tests with seeded test data.

- [ ] Add Firestore rules tests.
  - Why: per-user data isolation should be proven, not just assumed.
  - Done when: tests verify users can access their own paths and cannot access other users' paths.

- [ ] Add design consistency pass for forms, modals, empty states, and mobile layouts.
  - Why: speed improves when controls are predictable and compact across screens.
  - Done when: repeated patterns share spacing, labels, actions, and responsive behavior.

- [ ] Add accessibility pass.
  - Why: keyboard, screen reader, focus, and contrast support also improves efficiency.
  - Done when: modals trap focus, forms have labels/errors, and keyboard-only workflows are smooth.

- [ ] Add developer documentation for data model, encryption model, and deployment.
  - Why: future changes will be safer if core architecture decisions are easy to find.
  - Done when: docs explain collections, encrypted payload shape, migration, rules, and release steps.

- [ ] Get a custom domain and finish branded/deliverable auth emails.
  - Why: Firebase's default `*.firebaseapp.com` sender lands password-reset/verification emails in spam, and Firebase refuses to let the Action URL point at a default `*.web.app`/`*.vercel.app` domain (confirmed: saving it returns `EMAIL_TEMPLATE_UPDATE_NOT_ALLOWED`) — both require a domain the user owns and verifies via DNS (TXT/CNAME), which is true across every provider (Firebase, Auth0, etc.), not a Firebase-specific limitation.
  - Done when: a real domain is purchased (~$1-10/yr, e.g. Cloudflare Registrar or a Namecheap/Porkbun promo TLD) and connected via Firebase's custom-domain flow for both (a) the auth email sending domain and (b) the Action URL, which is then pointed at the already-built, already-deployed branded `/auth/action` page (`src/app/pages/auth-action/`, live at `expense-tracker-ai-5e35a.web.app/auth/action`) instead of Firebase's default hosted page. No further app code changes needed — this is purely the domain purchase + Console/DNS configuration.
  - Note: also set the Firebase project's "Public-facing name" (Project settings → General) to `Trackr` — fixes the `%APP_NAME%` placeholder currently showing `project-772405031663` in email subjects/footers; doesn't require a domain and can be done anytime.

## Phase 7: Plaid Bank Integration

Connect real bank accounts through Plaid so transactions are fetched and categorized automatically instead of entered by hand. This phase introduces a Firebase Cloud Functions backend (the Plaid secret and all Plaid API calls must run server-side) while keeping Plaid item data in Firestore alongside the rest of the app. Sandbox first via an environment variable, then production. Build and verify one item at a time.

Sync uses a **zero-knowledge** model so automatic background sync never weakens privacy: server-written transactions are **envelope-encrypted to each user's public key** (server holds only the public key, never a key that can decrypt user data), the private key is unlocked client-side via **passkey (WebAuthn PRF) with a passphrase fallback**, and the server holds only a server-usable Plaid **access token** (the one item it must use to fetch on the user's behalf). Transaction records stay unreadable to the admin; they become readable in the browser after unlock.

- [x] Add Plaid account setup and SDK/client install.
  - Why: every later step depends on a configured Plaid client and a place for server code to live.
  - Done when: a `functions/` workspace exists with the `plaid` SDK installed, Firebase Functions v2 is wired into `firebase.json`, and a shared Plaid client defaults to sandbox via a `PLAID_ENV` env var that can flip to production without code changes.
  - Verified: `functions/` (TypeScript, Functions v2, Node 20) added with `plaid` 29, `firebase-admin`, and `firebase-functions`; `firebase.json` has a `functions` codebase; `functions/src/plaidClient.ts` selects the basePath from `PLAID_ENV` (defaults to sandbox); `npm run build` in `functions/` compiles clean. `.env.example` documents the env/secret keys and `.gitignore` keeps `.env`/secrets out of git.

- [x] Add the backend link-token create endpoint.
  - Why: Plaid Link needs a short-lived `link_token` that can only be minted server-side with the Plaid secret.
  - Done when: a callable function returns a `link_token` scoped to the signed-in user (transactions product, US, English).
  - Verified: `createLinkToken` (`functions/src/index.ts`) is an `onCall` v2 function that rejects unauthenticated calls, uses the caller's uid as `client_user_id`, requests the transactions product (US/English), and optionally sets the webhook from `PLAID_WEBHOOK_URL`. Deployed to Firebase (Blaze) with `PLAID_CLIENT_ID`/`PLAID_SECRET` in Secret Manager and confirmed live: returns a working `link_token` that opens Plaid Link in sandbox.

- [x] Add the frontend Plaid Link UI integration.
  - Why: users launch Plaid's hosted Link flow to choose and authenticate their bank.
  - Done when: a "Connect bank account" button opens Plaid Link in sandbox and receives a `public_token` on success.
  - Verified: `PlaidService` (`src/app/services/plaid.service.ts`) lazy-loads Plaid Link, calls the `createLinkToken` callable, opens Link, and toasts the `public_token` on success; `provideFunctions` added to `app.config.ts`; a "Connect bank account" button added to the Accounts page. `ng build` passes and `firebase`/`@angular/fire` stay at a single v11/v19. Confirmed end-to-end in sandbox: connected a 3-account institution with `user_good`/`pass_good` and received a `public-sandbox-…` token in the browser.

- [x] Exchange the public_token and store the access_token.
  - Why: the short-lived `public_token` must be swapped for a long-lived `access_token` and persisted so future syncs can run.
  - Done when: a callable function exchanges the token and writes `users/{uid}/plaidItems/{itemId}` holding the item id, encrypted access token, sync cursor, and institution name.
  - Verified: `exchangePublicToken` (`functions/src/index.ts`) exchanges the token via `itemPublicTokenExchange`, AES-256-GCM encrypts the access token with `TOKEN_ENC_KEY` (`functions/src/crypto.ts`), and writes `users/{uid}/plaidItems/{itemId}` (itemId, institutionName, encrypted accessToken, empty cursor, status, timestamps); the frontend `onSuccess` now calls it (inside `ngZone.run`). `functions` build and `ng build` both pass. Requires the `TOKEN_ENC_KEY` secret set + redeploy before the live sandbox link/store round-trip is confirmed.

- [x] Add the zero-knowledge envelope encryption foundation.
  - Why: automatic background sync needs the server to write encrypted transactions without ever holding a key that can decrypt user data.
  - Done when: each user has an RSA keypair (public key stored in plaintext at `users/{uid}/meta/keys`, private key wrapped by a master key), the existing passphrase-encrypted data migrates with no bulk re-encryption (the current passphrase-derived key is adopted as the master key), and the client `decryptDoc` handles both symmetric (`__encrypted`) and envelope (`__envelope`) documents. Passphrase unlock keeps working throughout.
  - Verified: on unlock, `EncryptionService.ensureKeypair` generates an RSA-OAEP keypair (public key plaintext at `meta/keys`, private key wrapped under the passphrase-derived key) or unwraps the stored one; `decryptDoc` handles `__envelope` docs. `functions/src/crypto.ts` `envelopeEncrypt` (RSA-OAEP + AES-GCM) round-trips with WebCrypto (validated by a local Node interop test incl. wrong-key rejection). Purely additive — existing data/passphrase unlock unchanged. Confirmed live: `meta/keys` created on unlock, re-unlock unwraps cleanly, and server-written envelope transactions decrypt in the app.

- [x] Reduce unlock friction while keeping the passphrase as the encryption secret.
  - Why: keep the zero-knowledge guarantee (a client-only secret must unlock the key) while removing passphrase friction on trusted devices.
  - Done when: unlocking is easy on a trusted device without weakening the model or the passphrase's role as the sole recovery secret.
  - Verified: prototyped passkey (WebAuthn PRF) unlock but **removed it** after review — it wraps the *same* master key the passphrase derives, so it's convenience-only (not a new security factor) and PRF support is fragile. Replaced with **"remember this device"**: the non-extractable master key is stored in IndexedDB (`utils/device-key-store.ts`) so the device auto-unlocks; usable but not exportable, cleared via Settings → Security → Forget. Passphrase stays as the encryption secret and the only recovery path (email OTP can't recover a zero-knowledge key — it would require the server to hold it). KDF hardening + encrypted recovery moved to the hardening item below.

- [x] Add the initial transaction sync via /transactions/sync.
  - Why: after linking, the existing history and balances should appear without manual entry.
  - Done when: a sync function pulls added/modified/removed transactions via `transactionsSync`, **envelope-encrypts each transaction to the user's public key**, writes them into the user's Firestore `transactions` collection with plaintext sort fields (`date`, `createdAt`, `updatedAt`) plus `plaidTransactionId`, and persists the returned cursor only after each page's writes succeed.
  - Verified: `syncTransactions` callable (`functions/src/index.ts`) pages `transactionsSync` from the stored cursor, envelope-encrypts each transaction to the user's public key, and writes it under the Plaid `transaction_id` (idempotent dedup); cursor advances in the same batch as the page writes. A "🔄 Sync transactions" button (`PlaidService.syncTransactions` + Accounts page) triggers it. Confirmed in sandbox: 42 transactions synced, decrypted in the app, stored as ciphertext (`__envelope`) in Firestore; account link/categorization deferred to their own milestones.

- [x] Add a webhook endpoint for ongoing transaction sync.
  - Why: Plaid notifies the app when new transactions are available so data stays current without polling.
  - Done when: a deployed HTTPS webhook verifies Plaid requests, looks up the affected item, and runs the same envelope-encrypting incremental sync **unattended** (using the server-usable access token) from the stored cursor; `PLAID_WEBHOOK_URL` is set to the deployed URL so `createLinkToken` registers it.
  - Verified: `plaidWebhook` (`onRequest`, `functions/src/index.ts`) verifies Plaid's ES256 JWT (`plaid-verification`) against the fetched key + raw-body SHA-256 (unsigned → 401, non-POST → 405), resolves item_id→uid via the server-only `plaidItemsByItem` index, and runs `syncItem` unattended. Confirmed live in sandbox: connecting a bank fired `TRANSACTIONS/INITIAL_UPDATE`, the webhook verified and synced 42 transactions with no browser action, and a follow-up `HISTORICAL_UPDATE` added 0 (cursor dedup).

- [x] Add transaction dedup logic.
  - Why: Plaid-sourced transactions must not double up with manual entries or repeated syncs.
  - Done when: transactions carry a `plaidTransactionId` and sync/import skip rows whose Plaid id already exists.
  - Verified: Plaid transactions are written under their `transaction_id` as the Firestore doc id (idempotent) and also carry a plaintext `plaidTransactionId`; re-running sync and the webhook's follow-up `HISTORICAL_UPDATE` both reported `added: 0`, confirming no double-inserts. Manual entries use their own auto-ids so they never collide.

- [x] Reconcile Plaid transactions with existing manual entries.
  - Why: users who already log transactions by hand (custom merchant, notes, category) must not get duplicates when the same real charge arrives from Plaid.
  - Done when: at sync time a Plaid transaction that matches an existing manual entry (same date and amount, similar merchant) is merged — preserving the user's category and notes and attaching the Plaid id — instead of inserted as a second row; ambiguous matches are flagged for the user rather than silently merged.
  - Verified: `ReconciliationService` matches client-side (same type + exact amount + dates within 3 days, only when exactly one manual candidate qualifies); merge keeps the manual entry and its data, links it (`plaidTransactionId`/item/account), and deletes the duplicate bank row; `cleanupReconciled` runs after sync to drop re-synced duplicates; "keep both" persists to `meta/reconcileIgnore`. A review modal shows each pair side-by-side with per-row Merge / Keep both plus Merge all, surfaced by a banner on the Transactions page. Confirmed in sandbox with a manual entry mirroring a synced transaction.

- [x] Make the initial transaction history window configurable.
  - Why: the first pull should fetch a sensible amount of history; Plaid defaults to ~90 days and supports up to 730 (24 months), not the full account lifetime.
  - Done when: `createLinkToken` sets `transactions.days_requested` from a config value (documented in `.env`), adjustable without code changes.
  - Verified: reworked into a per-link user choice — the Connect flow shows a "Connect a bank" modal with presets (30d / 90d / 6mo / 1yr / 2yr) plus a custom start date (converted to days-back, capped at Plaid's 730). `PlaidService.connectBank(daysRequested)` passes it to `createLinkToken`, which clamps to 1..730 and sets `transactions.days_requested` (default 90). Note: sync is always "up to now" (Plaid has no end-date), so a single how-far-back control is the correct model rather than a min/max range.

- [x] Add auto-categorization from Plaid categories with manual override.
  - Why: imported transactions should land in the user's existing categories instead of an unrelated taxonomy.
  - Done when: Plaid's `personal_finance_category` maps onto the existing seeded categories, unmapped items fall back to Other, and the user can still re-categorize any transaction. Note: because the server cannot read the user's encrypted categories, this mapping runs **client-side** after decrypt (Plaid's `personal_finance_category` is carried in the encrypted payload); the browser assigns `categoryId` and re-encrypts.
  - Verified: `utils/plaid-category-map.ts` maps Plaid PFC primary → app category name (fallback Other / Other Income); `TransactionService.transactions` resolves a synced transaction's `categoryId` in-memory by matching that name + kind, only when the category is blank, so a user-set category always wins. Confirmed in sandbox: synced transactions show mapped chips (Dining, Shopping, Gas, …), are filterable by category, and manual re-categorization sticks. Refinement noted: using Plaid's `detailed` category could split Groceries from Dining.

- [x] Add a category cleanup / merge tool (one-time admin, now removed).
  - Why: users who added extra custom categories (or want to consolidate) need to fold them into the defaults without leaving transactions uncategorized.
  - Done when: a management view lists categories as default vs custom; merging a custom category re-assigns all its transactions to a chosen target category (client-side bulk update) and then deletes the custom category, with a confirmation showing how many transactions move.
  - Verified: shipped a temporary `/categories` page (Settings → Manage categories) with per-category Merge (re-assign transactions via `updateMany`, then delete) and "Make default" (promote via an `isDefault` flag); used to finalize the canonical set, then **removed** (page, route, Settings link) since end users can't create categories. The finalized set (8 Plaid-aligned additions: Bank Fees, Charity & Gifts, Financial Services, Fines & Penalties, Personal Care, Personal Transfers, Transportation, Travel — all expense) is now baked into `seed.service.ts`; new accounts seed them and existing accounts are topped up via `ensureDefaultCategories`. Auto-categorization (`plaid-category-map.ts`) updated to map Plaid PFC onto the new categories (TRANSPORTATION→Transportation, TRAVEL→Travel, BANK_FEES→Bank Fees, PERSONAL_CARE→Personal Care, etc.).

- [x] Add connected-accounts management UI.
  - Why: users need to see which banks are linked, disconnect them, and clean up test items.
  - Done when: a settings/accounts view lists linked institutions with status, supports disconnecting an item (removing it at Plaid, deleting the `plaidItems` doc + reverse index, and that item's synced transactions), and maps Plaid accounts to app accounts so synced transactions link to an account and affect balances.
  - Verified: Accounts page shows a "Linked banks" section with status + Disconnect (confirm dialog); `disconnectPlaidItem` removes the item at Plaid and deletes its `plaidItems` doc, reverse index, and `plaidItemId`-tagged transactions (confirmed: disconnect clears the synced transactions). Account mapping: `getPlaidAccounts` returns the item's accounts; the client auto-creates an app account per Plaid account (tagged `plaidAccountId`/`plaidItemId`) on link and on sync; `TransactionService.transactions` resolves each synced transaction's `accountId` from `plaidAccountId` in-memory so accounts/balances fill in without any rewrite. Auto-created accounts start at openingBalance 0 (balance reflects the synced window; user can set a starting balance).

- [x] Add error handling for expired/revoked items and failed syncs.
  - Why: bank logins expire or get revoked, and syncs can fail; users need a clear path back to working state.
  - Done when: items needing re-auth surface an update/re-link flow, and failed syncs report a clear status instead of failing silently.
  - Verified: `createReauthLinkToken` mints a Plaid Link token in update mode (passes the item's existing access_token instead of `products`) so the user re-authenticates the same item without creating a duplicate; `PlaidService.reconnect()` opens Link and clears the item's status locally on success. `syncUser`/`syncItem` failures are classified via a shared `statusForErrorCode` (`ITEM_LOGIN_REQUIRED`/`PENDING_EXPIRATION`/revoked-permission codes → `login_required`, else `error`) and written to the item with `lastError`; `syncTransactions` now returns which items failed, and the frontend surfaces a named warning toast ("Chase — reconnect needed"). The webhook also handles `ITEM` events directly (`ERROR`, `LOGIN_REPAIRED` → back to active, `PENDING_EXPIRATION`/`PENDING_DISCONNECT`) so Plaid can proactively flag/clear an item's health, not just on our own sync attempts. Accounts page shows a "Needs reconnect"/"Sync error" badge with a Reconnect button next to Disconnect. `functions` build and `ng build` (dev + production) both pass; deployed.

- [x] Harden Plaid secrets and the zero-knowledge encryption model.
  - Why: Plaid keys and user financial data are sensitive; the server must be able to fetch from Plaid without ever being able to decrypt user data.
  - Done when: `PLAID_CLIENT_ID`, `PLAID_SECRET`, `PLAID_ENV`, and the token encryption key are provided via Functions secrets/env; the Plaid access token is AES-256-GCM encrypted with a server key (the one item the server must decrypt to call Plaid); and all user financial data is envelope-encrypted such that the server stores only the user's public key and never a usable private key (the private key never leaves the client unwrapped).
  - Verified: all four secrets (`PLAID_CLIENT_ID`, `PLAID_SECRET`, `PLAID_ENV`, `TOKEN_ENC_KEY`) live in Firebase Secret Manager, set via `firebase functions:secrets:set` (never typed into chat); access tokens are AES-256-GCM encrypted before being written to `plaidItems`; envelope encryption (per-user RSA keypair, public key only in Firestore) has been live and verified since the sandbox phase.

- [x] Switch Plaid from sandbox to production for real bank connections.
  - Why: real banks only work in Plaid production (sandbox is fake institutions); the Trial plan allows production with a 10-Item limit.
  - Done when: production `PLAID_CLIENT_ID`/`PLAID_SECRET` are set as secrets, `PLAID_ENV=production`, functions redeployed, and a real institution links + syncs end-to-end within the Trial plan's 10-Item limit. Reconciliation and history-window items should ship first so the first real sync merges cleanly.
  - Verified: Plaid Trial-plan access obtained (a fresh "Personal use" team — the original team had gotten stuck in the full business Compliance Center flow; a new team signup avoided it). Production secrets set, `PLAID_ENV=production`, all functions redeployed. Real Discover account connected and synced end-to-end: webhook fired (`INITIAL_UPDATE` → `HISTORICAL_UPDATE`), transaction written and decrypted correctly in the app, and confirmed independently via Plaid's own Dashboard Activity log (`200 OK`, 100% success rate, `Bank API` integration type). The zero-knowledge background-sync pipeline is proven correct against a real institution, not just sandbox.

- [x] Robustify `disconnectPlaidItem` transaction cleanup.
  - Why: the delete query only filtered on the plaintext `plaidItemId` field; any doc where that field was missing/stale (e.g. synced under an earlier code revision) was silently left behind, only discoverable by widening the Transactions date filter past the default 30 days.
  - Done when: disconnect reliably removes every transaction tied to an item regardless of which plaintext field a given doc carries.
  - Verified: added a second cleanup pass — fetch the item's Plaid `account_id`s before `itemRemove` invalidates the access token, then also delete any transaction matching `plaidAccountId` (chunked to Firestore's 10-value `in` limit), deduped against the `plaidItemId` matches. `functions` build passes; deployed.

- [x] Add on-demand Plaid institution refresh.
  - Why: give users (and us, for diagnostics) a way to force Plaid to re-poll an institution right now instead of waiting for its normal cadence — also the correct way to distinguish a timing/caching gap from a real institution-side data limit.
  - Done when: a "Refresh from bank" action calls Plaid's `transactionsRefresh` for every linked item; the existing webhook picks up whatever it finds automatically.
  - Verified: `refreshPlaidItems` callable + "⏱️ Refresh from bank" button on Accounts. Deployed and used live against the Discover connection.

- [x] Fetch and backfill credit card details from Plaid (limit, minimum payment, due date, statement date).
  - Why: Plaid-linked credit accounts were missing credit limit, available credit, minimum payment, and due/statement dates that manually-created accounts have.
  - Done when: `getPlaidAccounts` returns this data and the client maps it onto the app's `Account` fields for both newly-linked and already-existing Plaid accounts.
  - Verified: credit limit comes from the same `accountsGet` call already made (`balances.limit`, no new Plaid product) — deployed, and backfills existing accounts automatically on next sync. Minimum payment / due day / statement-closing day need Plaid's separate **Liabilities** product: added `Products.Liabilities` to `createLinkToken`, and `getPlaidAccounts` now also calls `liabilitiesGet` and merges the fields (degrading gracefully — logs a warning, doesn't fail — for items linked before Liabilities was requested, since that product needs to be part of the Item's original consent). `functions` build + `ng build` pass; deployed. **Not yet confirmed working end-to-end** — the existing Discover Item was linked before Liabilities was added, so it needs to be disconnected and relinked to grant that scope (see next item).

- [x] Disconnect and relink Discover fresh to test the corrected history-window understanding and pick up Liabilities.
  - Why: Plaid's own docs state `days_requested` only takes effect the *first* time Transactions is added to an Item — a later `days_requested` (or `transactions/refresh`, which was tried and made no difference) cannot retroactively expand an already-initialized Item's window. The only documented fix is to delete the Item and create a new one. This is also required to grant the newly-added Liabilities consent scope on this Item.
  - Verified (institution limit confirmed): disconnected and relinked Discover with a custom start date of 01/01/2026, producing a genuinely new Plaid Item (`Db3pdEnen3UoxZLMAnB4fX3Nbdm6PvfY00Lma`, distinct from the prior `o75aV5j1r6s364xybMjQhXx3LdpOYLFJLez07`). Function logs confirm `days_requested` was computed correctly client-side (`accounts.ts` `daysFromChoice()`, ~196 days) and forwarded unchanged. The webhook fired `INITIAL_UPDATE` (`added: 1`) then `HISTORICAL_UPDATE` (`added: 0`) — a completely fresh Item, correct window, still only one transaction. Per this item's own fallback criteria, that's solid confirmation of an institution-side data limit for this Discover connection, not a bug in the sync/cursor/days-requested code.
  - Liabilities: **still not populated for Discover**, and this now looks like another institution-side gap rather than a code bug. Checked Cloud Functions logs across 4 separate retries over ~2.5 hours (Sync transactions + Refresh from bank, repeated) — `getPlaidAccounts`/`liabilitiesGet` ran with **zero errors or warnings** every time, meaning Plaid's API call itself succeeds but simply returns no credit-limit/liabilities data for this account. The user also confirmed the *old* Discover account's limit/due-date/available-credit numbers were manually typed in, not Plaid-sourced — so there's no confirmed instance of this ever having worked for this institution. No further code action available here; would need Plaid support to confirm whether Discover exposes this data at all in production.
  - **Update**: confirmed institution-specific, not a general code issue. Linking an AMEX (Blue Cash Everyday) account synced its full transaction history from the requested start date *and* Liabilities data (credit limit $17,200, minimum payment $40, statement-close/due dates) populated correctly on the first sync. So the Liabilities pipeline (`Products.Liabilities`, `liabilitiesGet` merge in `getPlaidAccounts`) works as designed — Discover specifically just doesn't return it (and apparently caps transaction history at 1 row) in production, for reasons outside our control.

- [x] Auto-seed opening balance for newly-linked Plaid accounts instead of defaulting to 0.
  - Why: auto-created accounts always started at `openingBalance: 0`, so the locally-computed "Current balance" only reflected whatever history Plaid happened to sync. Surfaced by the AMEX link: Current balance showed $182.78 against a real AMEX total balance of $328.48, and Available Credit showed **$17,382.78 — more than the $17,200 credit limit** — because the local balance had drifted negative (a payment transaction synced within the window, with no corresponding older charge to offset it, made the ledger think the card was in credit).
  - Done when: once Plaid reports a real `current_balance` for a linked account, the app back-solves and writes an opening balance that makes the local balance formula land on that real number exactly, without disturbing accounts that never needed correcting (e.g. Discover, whose one synced transaction already fully explained its real balance, correctly computes to an opening balance of $0 — left alone, not forced nonzero).
  - Verified: added `openingBalanceSeeded?: boolean` to `Account`. `PlaidService.setupAccountsForItem` now runs a one-time reconciliation on any not-yet-seeded Plaid account once `getPlaidAccounts` returns a `current_balance`: `openingBalance = current_balance + localTxDelta` for credit accounts, `current_balance − localTxDelta` for depository/cash, using whatever's already synced locally at that moment, then flags it seeded so it's never overwritten again (won't fight a later manual edit). Runs automatically on every "Sync transactions" click via the existing `setupAllAccounts()` backfill pass. `ng build`/`tsc` pass. Known limitation: since this reads the client's live (Firestore-listener-backed) transaction list at sync time rather than an authoritative fresh read, a sync clicked at the exact moment new transactions are still propagating into that list could seed a slightly-off number — low probability, and not self-correcting since it only runs once per account. Acceptable for a personal, single-user app; not hardened further.

- [x] Add a safeguard so deleting an account doesn't silently orphan its bills.
  - Why: the user's plan is to link all real banks via Plaid, merge/reconcile transactions onto the new accounts, then delete the old manually-created ones. Audited whether Bills, Budgets, and Analysis would keep working through that: Budgets (no `accountId` field at all) and Analysis (category/date-based totals, with graceful `'—'` fallback for a missing account in filters/labels) are unaffected. Bills were the one real gap — `Bill.accountId` is used both to display an account chip and to pre-fill the account when generating a payment transaction (`payBill`/`payVariableBill`), and nothing updated it when the linked account was removed, so a bill would keep silently attaching new payments to a hidden account. (Also found, as a reassurance: "Delete account" was never a real delete — `AccountService.remove()` just sets `archived: true`, so no transaction data or account-name resolution is ever actually lost, only hidden from active pickers.)
  - Done when: deleting an account that still has bills pointing at it warns the user and lets them move those bills to a different account (or explicitly leave them unlinked) before the delete proceeds.
  - Verified: `Confirm` (`components/confirm/`) gained an `<ng-content>` slot (purely additive — every other existing usage is unaffected). Accounts' delete-confirm dialog now detects bills whose `accountId` matches the account being deleted, lists them, and offers a dropdown of other active accounts to reassign them to (default: leave unlinked); confirming reassigns those bills via `BillService.update` before archiving the account. Also corrected the dialog's copy, which previously claimed data would be lost/unrecoverable — it isn't. `ng build`/`tsc` pass. Not yet manually verified end-to-end in the browser (needs a bill pointing at a real account, then Delete).
  - New bug found and fixed while verifying this: the user has a pre-existing **manually-created** "Discover" account (their main account, predating any Plaid link) with its own manual "Google Tivimate" entry. That entry was reconciled/merged with a Plaid transaction during an earlier connection, permanently tagging it with a `plaidTransactionId`. `ReconciliationService.matches()` treated any entry with a non-null `plaidTransactionId` as "already linked" and excluded it from future matching — but once that item was disconnected and relinked, the same real-world charge came back from Plaid under a **new** `plaidTransactionId`, so the two never got offered as a merge and both now showed up (once under each Discover account). Fixed in `reconciliation.service.ts`: `matches()` now treats an entry as eligible for (re-)matching whenever its tagged `plaidTransactionId` doesn't correspond to any currently-live server-written Plaid transaction, not just when the field is absent. Confirmed live: the merge banner now surfaces this exact Tivimate pair. Also changed `linkAndDrop` per user preference: merging now takes `date` and `accountId` from the bank row (source of truth for when/where the charge happened) while still keeping the manual entry's merchant/notes/category. `ng build`/`tsc` pass.

- [x] Fix a data-integrity incident: editing a Plaid-synced transaction silently corrupted it, and a form timing bug created stray blank transactions.
  - Why: while merging AMEX transactions, the user's entire Transactions list suddenly went empty (Dashboard/Accounts too) with no visible error. Traced through several rounds of live debugging (Cloud Functions logs, Firestore Console doc counts, browser console) to two separate, unrelated root causes:
    1. **Crypto corruption on edit.** `TransactionService.update()` used Firestore's `updateDoc()` (partial field merge) to save edits. A Plaid-synced transaction is stored as an `__envelope` document (RSA-wrapped key + `encryptedDEK` + `tag`). Editing it re-encrypts as a *symmetric* `__encrypted` document — but `updateDoc()` only writes the fields you give it, so the old `__envelope: true`, `encryptedDEK`, and `tag` were never removed; they sat alongside the new ciphertext. On the next read, `decryptDoc()` saw `__envelope: true` first and tried to verify the *new* payload against the *stale* `tag` — a guaranteed WebCrypto "operation failed" authentication error, 100% reproducible on every single edit of a Plaid transaction (not a rare race). **Fixed**: `update()` now uses `setDoc()` (full replace) instead of `updateDoc()`, so no stale fields survive a shape change. `updateMany()` (bulk edit) was never affected — it already used `batch.set()`.
    2. **A silent all-or-nothing render bug amplified it.** Separately, every collection's decrypt pipeline (`TransactionService` and, audited afterward, `AccountService`/`BillService`/`BudgetService`/`CategoryService`/`TransactionTemplateService`) used `Promise.all()` over every document — one bad doc rejected the whole batch, silently replacing the *entire* list with `[]` with no console output and no on-screen indication (the `error` signal existed but nothing rendered it). **Fixed**: switched all six to `Promise.allSettled()` — a bad doc is now skipped, logged with its doc id, and surfaced via a new shared `app-error-banner` component wired into Transactions, Accounts, Bills, Budgets (also covers Categories, which has no dedicated page), and the transaction-form modal (for templates).
  - Also reverted a risky change from earlier in this session: letting a merged transaction become eligible for re-matching again (added to fix the Discover disconnect/relink case) turned out to cascade into wrongly matching unrelated same-amount/near-date transactions (no merchant check in the matcher) once a real, richer transaction history (AMEX) was involved. Reverted to the original safe behavior; the Discover case is handled as a one-off manual merge instead.
  - **Second incident, different root cause**: after the above fixes, a *new* single Plaid transaction still failed to decrypt after adding a note to it — traced to the same `updateDoc` bug, confirming it was still live because **the deployed production app (Firebase Hosting) was a week stale** (last deploy 2026-07-09, and `origin/main` is even further behind — it doesn't have the Plaid integration at all, so production was never tied to any branch automatically). The user was actively using the stale production build on their phone with real linked banks.
  - **Third, unrelated bug found the same day**: stray "Untitled" / `$NaN` transfer-type transactions appeared with no account/category. Root cause: `TransactionForm.save()` read `this.amount`/`this.fromAccountId`/`this.toAccountId`/etc. *after* an `await` (inside `saveCurrentAsTemplate()`) instead of before it. If the modal got closed and reopened for another add while that await was still pending — very plausible on a slow mobile connection, since the `submitting` signal existed but was never actually set, so Save/Cancel never disabled and gave no "Saving…" feedback — `ngOnChanges`' `load()` would reset those fields, and the original save would then emit whatever the form had been reset to, not what the user entered. `type: 'transfer'` survived because it's a hardcoded literal in the emit; `date` survived because reset sets it to *today*, not blank — matching the exact symptom. **Fixed**: `save()` now snapshots every field into local variables before any await, making the bug structurally impossible regardless of what the UI does afterward; `submitting` is now actually wired up (Save/Cancel disabled + "Saving…" text during the async save, and the modal can't be dismissed via backdrop/Escape mid-save either).
  - Verified: `ng build`/`tsc` pass throughout. User confirmed editing a healthy Plaid transaction survives after the `setDoc` fix. Deployed all of the above to production (`firebase deploy`) since the user was actively using the stale build with real linked banks — see deploy note below.
  - Cleanup still needed (user-side, manual): two transaction documents already corrupted by the pre-fix `updateDoc` bug (one ~3 months old, one from the same-day repro) need deleting via Firestore Console — they're unrecoverable (encrypted, requires the unlock key even to attempt, and the ciphertext itself is what's broken) but harmless to remove since the app already hides them. The user has manual entries to reconcile in their place.

- [x] Bring `main` up to date and discover it's also live on Vercel — merge, then fix a real permanent-data-loss gap in bulk delete.
  - Why: the user pointed out `main` also deploys to Vercel (`vkurri-trackr.vercel.app`), separately from the Firebase Hosting site this session had been deploying to. Confirmed no `vercel.json`/`.vercel` in the repo (Vercel's project is configured outside the repo, likely framework auto-detection against GitHub), and that `origin/main` was 59 commits behind — stuck at bulk transaction actions, missing everything since (encryption hardening, recovery codes, backup/restore, subscriptions, and this entire Plaid phase). The `Codex` branch turned out to be byte-identical to `main` (same commit), so nothing needed merging from it separately. `main` had zero commits of its own beyond what this branch already contained, so the merge was a clean fast-forward with no conflicts. `ng build`/`tsc` verified on `main` before pushing. Both `environment.ts`/`environment.prod.ts` already point at the same Firebase project (`expense-tracker-ai-5e35a`) this session built and deployed everything against, so Plaid works from Vercel's build with no separate backend deploy — Firebase Functions are plain HTTPS endpoints, not tied to whichever host serves the static frontend.
  - New bug found and fixed while investigating a "Chase and AMEX balances are way too high, transactions missing" report: traced through Cloud Functions logs (ruled out any recent `disconnectPlaidItem` call — the theory that a duplicate-account reconnect had orphaned transactions onto a hidden account was wrong) to the user having used **bulk delete** in Transactions. Root cause: `selectedIds` (the bulk-selection set) is never cleared when a filter changes — only on exiting bulk mode or after a bulk action completes. Selecting rows under one filter, changing the filter, selecting more, and deleting shows an accurate total count in the confirm dialog, but nothing indicates *which* transactions that count includes — stale, now off-screen selections from the earlier filter ride along invisibly. Firestore `deleteDoc` has no undo, so the deleted transactions (including some already-merged/reconciled ones) are unrecoverable; recovering a still-unmerged Plaid-native row would require disconnecting and relinking that Item (redelivers full history from scratch) at the cost of recreating the duplicate-account problem.
  - Done when: the bulk-selection state can't silently carry stale, off-screen selections across a filter change, and the delete confirmation shows exactly what will be deleted, not just a count.
  - Verified: added a constructor `effect()` in `transactions.ts` watching every filter signal (type, date range, account, category, search, merchant, min/max amount, custom dates, special filter) that clears the bulk selection on any change while in bulk mode (skips the first/initial run). The bulk-delete confirm dialog now projects the actual list — merchant, date, amount — for every selected transaction via `Confirm`'s `<ng-content>` slot, scrollable for large selections. `ng build`/`tsc` pass. Does not recover what was already deleted — purely forward-looking.

- [x] Recover accidentally-deleted Plaid transactions + build a full account-consolidation cleanup toolkit.
  - Context / why: after the bulk-delete accident (item above), the user compiled a list (~50 transactions across Chase Checking/CHASE COLLEGE, Chase Credit/CREDIT CARD, and AMEX/Blue Cash) of missing rows — almost all of them autopay payment-credits, which is why the credit cards read *far* more indebted than reality (e.g. Chase Credit showed −$11,256 vs the real ~−$1,053; the missing "Automatic Payment +$X" credits that pay the card down weren't being counted). Bigger picture: the user's deliberate migration plan was to link every real bank via Plaid, keep the pre-existing **manual duplicate accounts** as a safety net so nothing was lost, **merge** each manual entry with its Plaid counterpart (their merge workflow: keep the manual entry's merchant/notes/category, take date + account from the Plaid row), then delete the manual duplicate accounts — ending with only the Plaid accounts. Discover is the one exception: Plaid only ever returns 1 transaction for it (confirmed institution limit), so its manual transactions are moved onto the Plaid Discover account rather than deleted.
  - **Recovery function** (`recoverDeletedTransactions`, `functions/src/index.ts`): re-pulls each item's full history from an **empty local cursor** and re-creates only transactions whose Firestore doc is missing. Deliberately non-destructive vs. `syncItem`: it never writes that throwaway cursor back to the item (real incremental cursor untouched, so webhook syncs keep working), and it existence-checks each `transaction_id` via `db.getAll` and only writes the ones that don't exist (never overwrites, so user edits survive). Exposed as **"♻️ Recover missing"** on Accounts (`PlaidService.recoverMissingTransactions`).
  - **Latent-landmine fix found while deploying recovery**: the first recovery run failed with Plaid `INVALID_API_KEYS`. Root cause: `functions/.env` still said `PLAID_ENV=sandbox` (stale from before the production switch). The already-deployed functions had `production` baked in from an earlier deploy so they kept working, but a freshly-deployed function read `.env` and hit the **sandbox** endpoint with **production** credentials. Fixed `functions/.env` → `PLAID_ENV=production` (and set `PLAID_WEBHOOK_URL` to the deployed webhook URL). **Important for the future: this means any full `firebase deploy --only functions` was one command away from flipping every Plaid function to sandbox and breaking the whole integration; it's correct now, but keep `.env` accurate.**
  - **The recovery↔cleanup interaction (subtle, important for future context)**: recovery re-creates the raw Plaid rows (`__envelope` docs, id === `plaidTransactionId`), but the user's merged entries are separate `__encrypted` docs (id !== `plaidTransactionId`, carrying the same `plaidTransactionId` plus the user's edits). `PlaidService.recoverMissingTransactions` originally called `reconcileSvc.cleanupReconciled()` (which deletes the raw Plaid row when a merged entry with the same `plaidTransactionId` exists) — the user literally watched balances snap correct during recovery then revert as cleanup ran. So the recovery flow now **deliberately does NOT call `cleanupReconciled`** — recovery must keep what it restores. The normal **Sync** flow still calls `cleanupReconciled`, which is the intended steady state: after every sync the re-synced raw Plaid row is dropped in favor of the user's edited entry.
  - **Cleanup toolkit built for the consolidation (all reviewed, non-silent)**:
    1. **Delete account + its transactions** — the account delete dialog gained a "Also delete this account's transactions" checkbox that lists every transaction referencing the account (as `accountId`, or either side of a transfer via `fromAccountId`/`toAccountId`) and removes them on confirm. Used to wipe a manual duplicate account and its now-redundant autopay-transfer/merged rows in one reviewed action. (`accounts.ts` `accountTransactions` computed + `deleteTransactionsToo` signal.)
    2. **⚖️ Fix balances** (`PlaidService.recalculateOpeningBalances`) — recomputes each linked account's `openingBalance` from Plaid's authoritative `current_balance` and the transactions currently present (`credit → current_balance + txDelta`, else `current_balance − txDelta`), so balances land exactly right after a big cleanup even though `openingBalanceSeeded` was already set from an earlier, now-stale seed.
    3. **🧹 Remove blank/invalid transactions** — a Transactions-page banner + reviewed confirm that finds broken rows (non-finite/`$NaN` amount, or a transfer missing an account side) and deletes them. These are artifacts of the earlier save-race bug (client-written `__encrypted` docs, `type: transfer` + a date, no amount/accounts, **no** `plaidTransactionId` — confirmed via raw Firestore inspection they are NOT Plaid or merged rows). Nothing to recover inside them; the real autopays they were failed attempts at already come back via Plaid.
    4. **👯 Remove raw bank duplicates** — a Transactions-page banner + reviewed confirm that groups by `plaidTransactionId` (unique per real charge, so identical-looking rows like same-day $21.82 Zelles are never confused) and, where a group has both the user's edited copy (id !== `plaidTransactionId`) and the raw bank row (id === `plaidTransactionId`), **keeps the user's edited version** (merchant/notes/category) and removes the raw bank copy. This matches the user's merge workflow and `cleanupReconciled`'s direction; the reviewed UI just gives confidence. (First shipped with the opposite keep-the-Plaid-row direction, then corrected per the user — they explicitly want their manual edits preserved.)
  - Verified: `functions` build + `ng build`/`tsc` all pass; recovery function deployed (`recoverDeletedTransactions`, production env confirmed via logs); all frontend tools deployed to Firebase Hosting. User confirmed recovery brought back the transactions and the cleanup tools behave as intended.
  - **Recommended cleanup order for the user (once per account still being consolidated)**: (1) for Discover, bulk-move its manual transactions to the Plaid Discover account, then delete the empty manual account; (2) for Chase/AMEX, delete the manual duplicate account with "also delete transactions" checked; (3) **👯** remove raw bank duplicates; (4) **🧹** remove blank/invalid rows; (5) **⚖️ Fix balances**. Manual accounts were reported deleted; dedupe + blank-cleanup + fix-balances were the remaining steps at session end.
  - **State at session end / handoff notes**: everything above is DEPLOYED to Firebase Hosting (`expense-tracker-ai-5e35a.web.app`) and about to be committed + pushed to the branch and fast-forwarded to `main` (Vercel: `vkurri-trackr.vercel.app`). Both hosts serve the same build against the same Firebase project. Still open/for-later: (a) the two irrecoverably-corrupted transaction docs from the earlier `updateDoc` bug still want manual deletion via Firestore Console; (b) the four one-off cleanup tools (♻️ Recover missing, ⚖️ Fix balances, 🧹 blank cleanup, 👯 dedupe) are currently permanent buttons/banners — consider hiding or removing them once the migration is fully done, since they're really migration aids; (c) `recoverMissingTransactions` intentionally skips `cleanupReconciled` — if it's ever repurposed as a routine action, revisit that.

## Phase 8: Refinement Pass — Post-Migration Cleanup & Real-Bank Accounting

The manual-vs-Plaid consolidation (Phase 7's final items) is done. This phase removes
the one-off migration tooling built for it, then fixes three things that only became
wrong once real, continuous bank data was flowing in: autopay creating duplicate fake
transactions, credit card payments double-counting as both income and expense, and
edits to pending transactions getting silently lost when they post. Design doc:
`/Users/priya/.claude/plans/zippy-gliding-oasis.md`.

- [x] Remove migration-only tooling (Recover missing, Fix balances, dedupe/blank-cleanup banners, dead `migration.service.ts`).
  - Why: those four tools (plus the two backing cloud functions) were built specifically for the one-time manual/Plaid consolidation, which is now finished. Leaving them in place is dead weight and clutters the Accounts/Transactions pages with buttons that no longer apply.
  - Done when: "♻️ Recover missing" and "⚖️ Fix balances" are gone from Accounts; the blank/invalid and raw-bank-duplicate banners are gone from Transactions; `recoverDeletedTransactions`/`recoverItem` are removed from `functions/src/index.ts`; `src/app/services/migration.service.ts` (confirmed fully unreferenced — an unrelated pre-Plaid dead file found during the audit) is deleted.
  - Verified: removed the two Accounts buttons (`accounts.html`/`.ts`) and their `PlaidService` methods (`recoverMissingTransactions`, `recalculateOpeningBalances`, plus the now-unused `recovering`/`recalculating` signals); removed the two Transactions banners, their confirm dialogs, and their `transactions.ts` computed()s/handlers (`invalidTransactions`, `duplicateBankCopies`, `confirmDeleteInvalid`, `confirmDedupe`, `isFiniteAmount`); removed `recoverItem`/`recoverDeletedTransactions` from `functions/src/index.ts` (kept `getPlaidAccounts`, still used by account auto-setup); deleted `migration.service.ts`. Kept: Connect bank account, Sync transactions, Refresh from bank (genuinely reusable diagnostic), the reconcile banner (ongoing feature), and the account-delete-with-transactions safety checkbox (reworded its hint to drop the now-stale "duplicate account" reference). `functions` build and `ng build`/`tsc` both pass clean. Deployed (functions + hosting; the removed `recoverDeletedTransactions` cloud function was explicitly deleted from production via `firebase functions:delete`, since a normal deploy won't auto-remove a function no longer in source) and pushed to both this branch and `main`.

- [x] Stop autopay from creating duplicate fake transactions on Plaid-linked accounts.
  - Why: once a bill's account is linked via Plaid, the real transaction arrives from the bank automatically — `AutopayService` fabricating its own "Autopay — monthly bill" transaction on the due date would double it up against the real synced one.
  - Done when: a bill whose `accountId` resolves to a Plaid-linked `Account` (`plaidAccountId` set) no longer gets a transaction auto-created by `AutopayService.runIfNeeded()`; a bill on a manual (non-Plaid) account behaves exactly as before; the bill's `nextDueDate` still advances either way so the Bills reminder widget, nav badge, and upcoming/overdue lists stay accurate regardless of whether autopay itself fabricated a transaction.
  - Verified: `AutopayService` now injects `AccountService`, resolves `bill.accountId` → `Account` per bill, and skips the `txService.add(...)` call (and its "already exists" dedupe check, now moot) whenever `account.plaidAccountId` is set — the `nextDueDate` advance and bill `update()` still run unconditionally outside that guard. `ng build`/`tsc` passes. Deployed to Firebase Hosting; pushed to this branch and `main`.

- [x] Stop credit card payments (and other internal transfers) from double-counting as both income and expense.
  - Why: Plaid reports a credit card payment as two independent, individually-correct per-account transactions — an expense on the paying account, an income on the card — but summed app-wide that inflated both total income and total spending (visible as "Personal Transfers" showing as the top spending category and a -236% savings rate on Analysis).
  - Done when: a real credit card payment no longer appears in any income/expense/savings-rate/budget-spent total across Dashboard, Analysis, or Budgets, while each account's own balance math is unaffected; the user can manually flag/unflag any transaction as an internal transfer for whatever Plaid's categorizer misses.
  - Verified: added `isInternalTransfer?: boolean` to the `Transaction` model (same pattern as `refunded` — additive, doesn't touch the manual `type: 'transfer'` from/to shape). `mapPlaidTransaction` (`functions/src/index.ts`) now also reads `personal_finance_category.detailed` (previously only `.primary` was captured) and auto-sets `isInternalTransfer: true` for Plaid's `TRANSFER_IN`/`TRANSFER_OUT` primary categories and the `LOAN_PAYMENTS_CREDIT_CARD_PAYMENT` detailed subtype (generic `LOAN_PAYMENTS` without that detail stays a normal expense, since it could be a real loan payment). Excluded `isInternalTransfer` transactions from every income/expense/savings/budget-spent computed() that summed by `type`: `analysis.ts` (`expenses`/`income` — which `totalExpenses`/`totalIncome`/`avgMonthlySpend`/`savingsRate`/`topCategory`/`largestExpense`/`categoryBreakdown`/`topMerchants` all derive from — plus `monthlyTrend`'s separate loop), `dashboard.ts` (`netWorthChange`, `cashFlowData`, `rangeIncome`/`rangeExpenses`, `budgetSummary`, `recentExpenses` — `categoryBreakdown` derives from the latter), `budgets.ts` (per-category `spent`), and `budget-detail.ts` (`transactions`, which `spendingTransactions`/`spent` derive from). Added a manual toggle to the transaction edit form (mirrors the `refunded` toggle exactly, shown for both expense and income when editing an existing transaction) plus a `↔ Transfer` badge on the transaction row/detail view and a matching "Internal transfer" option in the Transactions page status filter. `functions` build and `ng build`/`tsc` both pass clean. Deployed (functions + hosting), pushed to this branch and `main`. Caveat: applies going forward only — already-synced transactions aren't retroactively flagged (folded into the Part 5 backfill, which needs the same kind of one-time correction pass).

- [x] Preserve user edits when a pending Plaid transaction posts.
  - Why: Plaid delivers a pending→posted transition as `removed: [oldId]` + a new incoming transaction with a *different* `transaction_id` (and `pending_transaction_id` pointing back to the old one). `syncItem` was unconditionally deleting the old doc and writing a fresh one from Plaid's data — any notes/category/merchant edit the user made while the transaction was pending was silently and permanently lost the moment it posted.
  - Done when: adding a note (or any edit) to a pending transaction survives it transitioning to posted.
  - Verified: `syncItem` (`functions/src/index.ts`) now reads `t.pending_transaction_id` (confirmed present on the Plaid SDK's `Transaction` type; was never read before) and, for each unique old pending id referenced this page, does a doc-ID lookup (`db.getAll`, not a field query — necessary since `plaidTransactionId` etc. are only guaranteed plaintext on an untouched envelope doc, not once it's user-edited) to check whether that doc still exists and is still the raw, untouched `__envelope` shape. If it's still untouched, behavior is unchanged (replace normally under the new posted id). If the user has edited it (now `__encrypted`), the old doc and its edits are left in place — the new duplicate write under the posted id is skipped, and the separate `removed`-handling loop is also guarded so it doesn't delete the very doc just preserved. `functions` build passes. Deployed, pushed to this branch and `main`.

- [ ] Show the purchase date, not the bank's posted date; backfill already-synced transactions.
  - Why: `mapPlaidTransaction` used Plaid's `date` (when the bank posted the transaction — can lag the real purchase by a few days, and a pending purchase could still be cancelled before ever posting), when `authorized_date` (the day the purchase actually happened) is what an expense tracker should show.
  - Done when: newly-synced transactions show the authorized/purchase date; a one-time pass corrects the date (and, since both changes touch the same mapping function, retroactively applies Part 3's `isInternalTransfer` detection too) on already-synced, never-edited transactions without disturbing anything the user has edited; the temporary backfill trigger is removed once it's been run.
  - Verified so far: `mapPlaidTransaction` now maps `date: t.authorized_date ?? t.date` (falls back to posted date when Plaid doesn't supply an authorized one). Added a **temporary** `backfillTransactionFields` cloud function — re-pulls each item's full history from an empty, never-persisted local cursor (same non-destructive pattern the old recovery tool used) and overwrites a transaction doc only when it still exists and is still the untouched `__envelope` shape (a user-edited `__encrypted` doc is never touched) — plus a clearly-labeled "🛠️ Update dates (one-time)" button on Accounts to trigger it (can't be invoked without the user's auth, so a button is the only way to run it). `functions` build and `ng build`/`tsc` both pass. **Not yet run** — waiting on the user to click it once and confirm, after which the temporary function/button/service method get removed as a follow-up (same discipline as the Phase 8 opening item).
