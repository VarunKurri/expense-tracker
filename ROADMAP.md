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
