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

- [ ] Add encryption passphrase rotation.
  - Why: users may need to change the vault passphrase without losing data.
  - Done when: authenticated users can re-encrypt all records with a new passphrase after confirming the old one. (Needs the master key decoupled from the passphrase — random DEK wrapped by KEKs — so it's a re-encrypt migration; deferred.)

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

- [ ] Harden Plaid secrets and the zero-knowledge encryption model.
  - Why: Plaid keys and user financial data are sensitive; the server must be able to fetch from Plaid without ever being able to decrypt user data.
  - Done when: `PLAID_CLIENT_ID`, `PLAID_SECRET`, `PLAID_ENV`, and the token encryption key are provided via Functions secrets/env; the Plaid access token is AES-256-GCM encrypted with a server key (the one item the server must decrypt to call Plaid); and all user financial data is envelope-encrypted such that the server stores only the user's public key and never a usable private key (the private key never leaves the client unwrapped).

- [ ] Switch Plaid from sandbox to production for real bank connections.
  - Why: real banks only work in Plaid production (sandbox is fake institutions); the Trial plan allows production with a 10-Item limit.
  - Done when: production `PLAID_CLIENT_ID`/`PLAID_SECRET` are set as secrets, `PLAID_ENV=production`, functions redeployed, and a real institution links + syncs end-to-end within the Trial plan's 10-Item limit. Reconciliation and history-window items should ship first so the first real sync merges cleanly.
