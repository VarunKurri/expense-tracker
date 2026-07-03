# Trackr Roadmap

This checklist focuses on making Trackr faster, easier, and more efficient for daily use. Mark items as complete as they ship, and add notes or links under each item when implementation starts.

## Recently Completed

- [x] Add Firebase Auth with Google, email/password sign-in, sign-up, and password reset.
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

- [ ] Add encrypted export and restore.
  - Why: users need confidence that they can back up or move their finance history.
  - Done when: export creates encrypted JSON/CSV backup and restore validates schema before importing.

- [ ] Add encryption passphrase rotation.
  - Why: users may need to change the vault passphrase without losing data.
  - Done when: authenticated users can re-encrypt all records with a new passphrase after confirming the old one.

- [ ] Add recovery guidance for forgotten passphrases.
  - Why: account password reset cannot recover encrypted finance records.
  - Done when: settings clearly explain the tradeoff and offer safe reset/export options where possible.

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

- [ ] Add the zero-knowledge envelope encryption foundation.
  - Why: automatic background sync needs the server to write encrypted transactions without ever holding a key that can decrypt user data.
  - Done when: each user has an RSA keypair (public key stored in plaintext at `users/{uid}/meta/keys`, private key wrapped by a master key), the existing passphrase-encrypted data migrates with no bulk re-encryption (the current passphrase-derived key is adopted as the master key), and the client `decryptDoc` handles both symmetric (`__encrypted`) and envelope (`__envelope`) documents. Passphrase unlock keeps working throughout.

- [ ] Add passkey (WebAuthn PRF) unlock with passphrase fallback.
  - Why: keep the zero-knowledge guarantee (a client-only secret must unlock the private key) while removing passphrase friction.
  - Done when: users can register and unlock via a passkey using the WebAuthn PRF extension (HKDF-derived key wraps the master key), the passphrase remains a working fallback, and browsers without PRF support fall back to the passphrase cleanly.

- [x] Add the initial transaction sync via /transactions/sync.
  - Why: after linking, the existing history and balances should appear without manual entry.
  - Done when: a sync function pulls added/modified/removed transactions via `transactionsSync`, **envelope-encrypts each transaction to the user's public key**, writes them into the user's Firestore `transactions` collection with plaintext sort fields (`date`, `createdAt`, `updatedAt`) plus `plaidTransactionId`, and persists the returned cursor only after each page's writes succeed.
  - Verified: `syncTransactions` callable (`functions/src/index.ts`) pages `transactionsSync` from the stored cursor, envelope-encrypts each transaction to the user's public key, and writes it under the Plaid `transaction_id` (idempotent dedup); cursor advances in the same batch as the page writes. A "🔄 Sync transactions" button (`PlaidService.syncTransactions` + Accounts page) triggers it. Confirmed in sandbox: 42 transactions synced, decrypted in the app, stored as ciphertext (`__envelope`) in Firestore; account link/categorization deferred to their own milestones.

- [ ] Add a webhook endpoint for ongoing transaction sync.
  - Why: Plaid notifies the app when new transactions are available so data stays current without polling.
  - Done when: a deployed HTTPS webhook verifies Plaid requests, looks up the affected item, and runs the same envelope-encrypting incremental sync **unattended** (using the server-usable access token) from the stored cursor; `PLAID_WEBHOOK_URL` is set to the deployed URL so `createLinkToken` registers it.

- [ ] Add transaction dedup logic.
  - Why: Plaid-sourced transactions must not double up with manual entries or repeated syncs.
  - Done when: transactions carry a `plaidTransactionId` and sync/import skip rows whose Plaid id already exists.

- [ ] Add auto-categorization from Plaid categories with manual override.
  - Why: imported transactions should land in the user's existing categories instead of an unrelated taxonomy.
  - Done when: Plaid's `personal_finance_category` maps onto the existing seeded categories, unmapped items fall back to Other, and the user can still re-categorize any transaction. Note: because the server cannot read the user's encrypted categories, this mapping runs **client-side** after decrypt (Plaid's `personal_finance_category` is carried in the encrypted payload); the browser assigns `categoryId` and re-encrypts.

- [ ] Add connected-accounts management UI.
  - Why: users need to see which banks are linked and be able to disconnect them.
  - Done when: a settings/accounts view lists linked institutions and supports disconnecting an item (removing it at Plaid and in Firestore).

- [ ] Add error handling for expired/revoked items and failed syncs.
  - Why: bank logins expire or get revoked, and syncs can fail; users need a clear path back to working state.
  - Done when: items needing re-auth surface an update/re-link flow, and failed syncs report a clear status instead of failing silently.

- [ ] Harden Plaid secrets and the zero-knowledge encryption model.
  - Why: Plaid keys and user financial data are sensitive; the server must be able to fetch from Plaid without ever being able to decrypt user data.
  - Done when: `PLAID_CLIENT_ID`, `PLAID_SECRET`, `PLAID_ENV`, and the token encryption key are provided via Functions secrets/env; the Plaid access token is AES-256-GCM encrypted with a server key (the one item the server must decrypt to call Plaid); and all user financial data is envelope-encrypted such that the server stores only the user's public key and never a usable private key (the private key never leaves the client unwrapped).
