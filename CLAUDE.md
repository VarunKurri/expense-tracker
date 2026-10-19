# Project Ground Rules for Claude Code

## Stack

- Angular 21 (standalone components, signals, new control flow `@if`/`@for`)
- Firebase (Firestore + Auth + Functions)
- `@angular/fire@19` + `firebase@11` (these specific versions — do NOT upgrade)
- Running on Windows + PowerShell
- User is a beginner to Angular; prioritize clarity over cleverness

## Critical constraints

- NEVER upgrade `firebase` past v11 or `@angular/fire` past v19 (breaks peer deps)
- When running npm commands, ALWAYS add `--legacy-peer-deps` flag
- Component class names follow Angular 21 convention: `Dashboard` not `DashboardComponent`
- File names follow Angular 21 convention: `dashboard.ts` not `dashboard.component.ts`
- Always use `runInInjectionContext` when calling Firebase APIs from observables (there is a known warning we work around)
- `import 'zone.js';` MUST be the first line of `src/main.ts`

## Workflow rules

- After every meaningful change, run `ng serve` (in a separate terminal if needed) and check for errors before moving on
- Commit to git after each working step so we have rollback points
- When completing a step in the tutorial, STOP and wait for user to verify before continuing
- Ask the user to share DevTools console errors if runtime issues appear
- Never invent Firebase config values — read them from `src/environments/environment.ts`

## Design system

Modelled on the Origin (useorigin.com) **product**, matched against screenshots
of the real app. **Not glassmorphic** — that was two designs ago. Do not
reintroduce blurred cards, coloured primary buttons, or green glow gradients.

Important: Origin's *marketing site* is near-black, but their **app is light**.
The app is what we copy. Do not "correct" this back to dark.

- All tokens live in `src/styles.scss`. Fonts load from `src/index.html`.
- **Light is the default.** Dark mode exists and must keep working.
- Three type voices:
  - `var(--font-ui)` Inter — all UI text, page titles, and **all figures**
  - `var(--font-mono)` Roboto Mono, **11px/500 UPPERCASE** — card labels, eyebrows, data
  - `var(--font-display)` Newsreader, weight 300 — **editorial moments only**
- The serif is a garnish, not the number style. Use it for insight/promo cards,
  empty states and onboarding — the way Origin uses "See where your money goes."
  Money always uses `.num-display` (sans semibold, hero figures) or `.fig`
  (sans with tabular figures, amounts in lists and tables) — never `.display`,
  and never the mono `.num`, which is the data voice for dates and counts. A
  mono amount reads as a different app.
- Signature headline pattern, for those editorial moments only:
  `<h2 class="display">See where <em>your money</em> goes.</h2>`
- Nearly every card is headed by a mono uppercase eyebrow with a trailing
  chevron — `.card-label` (`NET WORTH ›`, `SPENT IN SEPTEMBER ›`).
- **Colour discipline:** surfaces are white on a near-white canvas with hairline
  borders. Colour is a data signal only: `--blue` = the chart accent (spend
  areas, calendar heat), `--teal` = positive/income, `--red` = negative,
  `--forecast-grad` = projections (forecast cards, the projected area of a chart;
  never a card that also shows actual history — a projected line is dashed), `--cat-1..7` = category icon chips.
- **The UI accent is monochrome.** Selection, focus and "you are here" use
  `--accent` (= `--fg`) / `--accent-on` / `--accent-bg` / `--focus-ring`, never
  a palette colour: a selected pill is ink-filled, a focused field gets a
  neutral ring. Teal had leaked into these states, which made "selected" and
  "this is income" the same colour so neither meant anything on sight. If you
  reach for `--teal` or `--green` for a hover, focus, active or checked state,
  that is the bug.
- `color-scheme` is set per theme on `:root`, so browser-drawn controls (the
  date field's calendar button, native dropdowns, scrollbars) follow the app
  rather than the OS. Don't `filter: invert()` them.
- **Buttons are outlined, not filled.** `.btn-primary` is a white button with a
  `--line-strong` border, matching "Add account" / "Create budget" / "Save".
  `.btn-solid` (dark fill) exists for the rare high-emphasis CTA — use sparingly.
- Radii: `--radius-xs` 4px · `--radius-sm` 8px (inputs, buttons) · `--radius`
  14px (cards) · `--radius-pill` 999px (chips, tab pills).
- Cards use `var(--card-grad)`; inputs use `var(--input-grad)`.
- Shared classes: `.card`, `.btn-primary`, `.btn-solid`, `.btn-ghost`,
  `.btn-danger`, `.btn-add`, `.btn-row`, `.input` / `.input-field`, `.chip`,
  `.card-label`, `.card-link`, `.label-mono`, `.num`, `.fig`, `.num-display`, `.display`.
- A card's title is always the mono `.card-label` eyebrow — never a bold sans
  heading. "See all →" beside it is `.card-link` (no underline). Above the
  head's hairline sit only the eyebrow and its link or legend; a subtitle
  ("By total spend") goes below the hairline. A plain title is not a link when
  the card already has a "See all →".
- Anything that scrolls inside a rounded surface scrolls in an **inner**
  element (`.modal-body`, the transaction view's `.view-scroll`); the rounded
  outer box is `overflow: hidden`. Otherwise the scrollbar paints over the corner.
- **Actions are buttons, not underlined links.** "+ Add item" / "+ Add money
  back" use `.btn-add` (dashed, full width, under the list it adds to); a small
  action inside a row ("Show 2 settled") uses `.btn-row`. Prefer putting a
  row's secondary action in the dialog the row opens (as "Won't be repaid"
  sits in a person's repayment dialog) over stacking a button beside a chip.
  `.link-btn` is only for a link sitting inside a sentence.
- **A tappable row highlights, it doesn't underline.** Rows that open something
  (transactions, bills on Shared, people on a split) run to the card's edges and
  take `background: var(--bg-3)` on hover, like `.tx-row`.
- `.glass` / `.glass-strong` are legacy aliases for flat surfaces, kept only so
  un-converted templates still render. Do not use them in new markup.
- **Every form and dialog uses `<app-modal>`** (components/modal) — one shell:
  mono eyebrow title, scrolling body, pinned footer. Put the button row on an
  element marked `modal-footer` that is a **direct child** of `<app-modal>`
  (content projection only matches top-level nodes). Build the inside from the
  shared pieces in `styles.scss → FORMS`: `.form`, `.field`, `.label-sm`,
  `.label-optional`, `.field-hint`, `.field-error`, `.form-grid`,
  `.form-section` / `.form-section-title`, `.form-note`, `.input-affix`
  (`.input-affix.suffix` for a unit after the number), `.link-btn`,
  `.seg` / `.type-seg` / `.mini-seg`, `.toggle` / `.toggle-row`,
  `.icon-picks` / `.icon-opt`, `.swatches` / `.color-opt`, `.choice-grid` /
  `.choice`, `.modal-actions` / `.actions-right`. A form's own stylesheet
  should hold only what is genuinely unique to it. **Never redefine buttons,
  inputs, labels or toggles in a page stylesheet** — every form used to, and
  that is exactly how they drifted apart.
- Shared components worth reaching for before writing new markup:
  `app-spend-calendar` (month heat grid), `app-day-detail` (what one day cost),
  `app-transaction-view` (read-only transaction sheet), `app-transaction-form`,
  `app-month-picker` (`‹ Month ›` stepper with a jump-to-month grid — use it for
  any month selection rather than a row of month pills),
  `app-confirm`, `app-modal`, `app-toast`, `app-logo`, `app-icon`,
  `app-group-form` (create/edit a group: name, members, dates, simplify debts),
  `app-shared-bill-form` (a bill someone else paid: who paid, split, receipt; not a
  transaction, so not spending until you pay them back),
  `app-shared-bill-view` (the read-only sheet for one of those bills: tapping it
  opens this, never the form; Edit top right opens `app-shared-bill-form`. It
  shows only what the payer's bill says: paid by, shares, what you owe them),
  `app-transaction-picker` (pick one of your transactions: search by name or
  amount, likely matches first; Link income, Record repayment on Shared and
  Record a payment in a group all use it. Never a `<select>` of transactions),
  `app-receipt-attach` (a receipt photo: Take photo on phones/tablets, Upload
  everywhere, thumbnail → full size; in Edit a ✕ on the thumbnail removes it,
  on the details sheet it's read-only — `[editable]="false"`).
- A form opened from the details sheet must read the **live** transaction
  (`transactionService.transactions()` by id), never the copy the page passed
  in — that copy is stale the moment the sheet changes anything.
- A bill in a group (`split.groupId`) is settled across the whole group, Splitwise
  style: never show its per-bill "owes you" figures. The details sheet shows each
  person's share ("Their share") and a small "Open group" button. On Shared, a
  person's total is their bills outside groups plus what each group's settle-up
  plan has them paying you (`withGroups` in utils/shared.ts), shown as a row per
  group on their card; a repayment pays their bills first, then their groups.
- The split editors and builders take a payer (`paidBy` / `payerId`, default `ME`):
  the same editors serve your expenses and bills someone else paid (`SharedBill`,
  `users/{uid}/sharedBills`). Outside groups, what you owe on those shows on the
  payer's card on Shared, netted into one balance.
  Paying them back outside groups: the Shared card's "Record a payment" has a
  "Who paid" switch. "You paid them" links a bank payment (that expense gets
  `settlement: { personId }`, so it's spending) or records cash on the person
  (`SplitPerson.payments`). Both are `PaidOut` in `balancesByPerson`: they pay
  their bills off oldest first, and paying more flips the balance. When you
  owe nothing outside groups, it pays the group you owe them most in.
  Outside groups each person has **one balance**, as Splitwise keeps it: after
  your payments, what each of you owes the other evens out, oldest bills first
  on both sides (`nettedCents` on `BillShare` / `OwedBill`; `stillOwedCents`).
  So paying "the difference" settles both sides. A bill's details sheet shows
  the evened-out part too. Person cards list bills newest first (groups on top).
- Odd cents: when a bill doesn't divide evenly, whoever paid takes the extra
  cent first, then bill order, unless the split names who (`roundUpIds`,
  picked in the editors' "Odd cents" row, `split-odd-cents`). Splitwise picks
  per bill, so that choice is how a group matches it to the cent. The engine
  only ever gives the chosen people the cent their exact share already has a
  fraction of, so nobody is more than a cent from exact.
- A group credits each payment to whoever made it. Money back on a group
  expense that names nobody (an old reimbursement link) can only be credited
  by bill order, which is a guess: the group page lists those under "Who paid
  you?" until they're named, and marks the guessed rows in Payments. Payments
  between two friends live on the group (`Group.payments`); record them (or
  "Mark as paid" on a Settle up row) so the balances match Splitwise.
- Settling up with you in a group is against the **whole group**, never one
  bill: any member can pay any amount (less or more than suggested) and the
  balances follow. Money you got (a linked income, or cash) is spread over
  your group expenses as money back by `spreadReceived`, so it isn't income
  and your spending comes down to your share; the ledger gathers the parts
  back into one payment (`incomeId`, or cash's shared `batchId`). A bank
  payment you sent is that expense with `settlement` (spending). Cash you
  sent goes on `Group.payments`. "Remove from group" unlinks; the bank
  transaction itself stays.
- "Owed to you" / "You owe" right now (Shared, Analysis, Reports) all come from
  `SharedBalanceService`, so they can't disagree. A period's split figures
  (`splitTotals`) include group bills: for those, "for others" is what you paid
  beyond your share and "paid back" is the money back on it.
  Reports lists what's behind them: `splitBills` (one row per bill; the totals
  are `addUpSplitBills` of the same rows, so they can't disagree) and
  `splitPayments` (what came back, one row per payment).
- A settle-up payment (`Transaction.settlement`) counts in spending under the
  categories of the shares it paid for (your shares of bills others paid in
  that group, or that person's bills outside groups), not its own "Transfer"
  category: `settlementCategories` (utils/settlements.ts), applied through
  `MoneyRules.categoryParts` by `categoryTotals`, `budgetSpent`, the Reports
  drill-down and the Dashboard. Any new by-category sum must go through
  `categorySpend`, or a Venmo lands back in one lump.
- Linked banks (Plaid): "Manage accounts" on Accounts opens Plaid update mode with
  account selection on the **existing** item (`createReauthLinkToken` with
  `account_selection: true`), so a replaced or newly opened card is added without
  linking the bank twice (linking Chase again can break the old link). A new
  account on a bank that already has accounts is never auto-added: it's queued in
  `PlaidService.pendingNewAccounts` and the "New account at X" dialog asks whether
  it replaces one you have. A replaced card keeps its account: the old Plaid id
  moves to `Account.previousPlaidAccountIds` and every Plaid id lookup goes through
  `accountForPlaidId` (utils/plaid-accounts.ts). The `NEW_ACCOUNTS_AVAILABLE`
  webhook sets `newAccountsAvailable` on the item, shown as a chip on the bank row.
  A linked account's balance is the bank's: every sync stores Plaid's current
  balance (`Account.plaidBalance`) and `openingBalanceFor` (utils/finance.ts)
  works the opening balance out from it. Only an entry added by hand in the
  last few days (`addsToBankBalance`, `HAND_ADDED_DAYS`) moves the balance on
  top: the bank may not have it yet. An older hand-added entry is already in
  the bank's balance (usually something Plaid never sent), so it doesn't;
  `app-balance-check` lists them all. `AccountService.accounts()` already
  carries that opening balance, so the screens that add history to it land on
  the bank; `storedAccounts()` is the saved copy (TransactionService reads it).
  Never seed or hand-edit a linked account's opening balance: more history
  arriving later (a relink sends it all again) would move the balance.
  Linking a bank a second time gives every row a new Plaid id. A Plaid account
  matching an earlier link's account (same bank, type and last 4) carries on in
  that account (`sameBankAccount`, which also catches Chase renumbering an account on
  the same link, and `moveToLink`); copies already made, on either link,
  are folded back on sync (`linkedTwice`). The rows the second link sent again
  are paired by `relinkDuplicates` (utils/relink-duplicates.ts: only between two
  Plaid ids of one account, same amount and direction, within 3 days, never a
  copy you edited or linked) and reviewed in the Transactions duplicate review
  as `kind: 'relink'`; merging keeps the row you had and gives it the new ids.
  The server never overwrites or deletes a row you've edited (it can't read
  it): the bank's newer version waits beside it as `bankUpdate` and
  `bankUpdatePatch` (utils/bank-updates.ts) folds in the bank's amount, pending
  state and posted date while keeping your edits and date; a row the bank
  stops listing gets `bankRemoved` and is reviewed (`kind: 'removed'`, Keep or
  Remove, never in Merge all). Both are read beside the doc and never saved in
  it (`withoutBankSidecars`).
- Bank sync runs in the background: the webhook (as soon as the bank has
  news), `scheduledPlaidSync` (every 6 hours) and Sync all call `refreshItem`
  (functions): webhook URL, transactions, then `snapshotAccounts`, which saves
  the bank's balances and card statements on the item envelope-encrypted to
  your key (`accountsSnapshot`). The server can't write your encrypted
  accounts, so `PlaidService` applies each new snapshot when the app is open.
  A pending charge posts INTO its pending row's doc (doc ids never change, so
  notes, splits, categories and links made while pending stay);
  `users/{uid}/plaidTxIndex/{plaidId} -> { docId }` routes a Plaid id that
  lives in another doc (posted-into-pending, or a bank row you merged). A
  cancelled pending charge is removed even if edited.
  Pending is the bank's state, not the row's: each snapshot carries what the
  bank has as pending now and which posted id each pending one became
  (`recentPending`), and `settlePending` (utils/pending.ts, run by
  `PlaidService`) keeps the rows in step: still pending stays; posted as a
  separate row folds into the pending one (bank-linked, or matched: same
  account, same money or a tip on top at the same merchant, within 5 days);
  posted with nothing else stands down; dropped by the bank is cancelled.
- Dates: `date` is when you made the purchase (Plaid's authorized date, else
  its date) and is what spending goes by. `postedDate` is when the bank posted
  it, what statements go by: statement maths use `postedOn` / `postedBalanceOn`
  (utils/finance.ts). Pending rows (`plaidPending`, tagged `.pending-tag`) count
  as spending but are left out of every balance, as the bank leaves them out.
  `app-balance-check` on an account's page says where the balance comes from,
  what's pending, and checks the history against a statement (`checkStatement`).
- One income can pay back several purchases (`moneyBackSplits`): linking more
  re-spreads it with `spreadIncome`, oldest purchase first, any surplus on the
  newest. An income with some left over shows up when linking from a purchase.
- Test fakes shared by several specs live in `src/app/testing/` (e.g. `FakeGroups`, `FakeSharedBills`).
- Never centre a fixed panel with `transform`: it traps any pop-up inside it
  (the receipt viewer opened tiny inside the details sheet). Use `inset: 0;
  margin: auto; height: fit-content`.
- Small indicators on rows (notes, receipt) are `app-icon` line icons, never emoji.
  `app-transaction-view` is the **only** transaction view — Dashboard, Spending,
  Analysis and Transactions all render it, including reimbursement linking.
  Never fork a second copy: the three that existed before drifted, and only one
  of them had reimbursements, so the same transaction read differently
  depending on which screen you opened it from.
- Desktop-first, responsive down to mobile.
- Microcopy follows Origin: mono uppercase eyebrow → plain-English sentence
  headline → a calm sentence explaining *why it matters*. Never just a number.
- **No em dashes (U+2014) anywhere in the code**: not in UI copy, aria-labels,
  toasts, comments or tests. Rewrite the sentence with a comma, colon, full stop
  or parentheses rather than swapping in another dash. An empty value is a word
  ("None", "Not set"), never a dash. En dash ranges ("Oct 1 – Oct 31") and the
  minus sign "−" are fine.
- Forms scroll up and down only (`.modal-body` is `overflow-x: hidden`). iPhone
  Safari draws `<input type="date">` wider than its box and centred;
  `styles.scss` drops the native look on every date field (Chrome keeps its
  calendar button) so it fits and reads left. Don't give a date field its own
  width, and check a built selector when nesting SCSS near it.
- `tally-design-system.md` and `expense_tracker_design/tally/` describe the
  **previous** (Tally) design and are kept for reference only — they are not the
  current target.

## Secrets

- `ANTHROPIC_API_KEY` is stored as a Firebase Functions secret, NEVER hardcoded
- Never print API keys in logs or terminal output
- `OPENAI_API_KEY` (receipt scanning, `functions/src/receipt.ts`) is a Firebase
  Functions secret too: `firebase functions:secrets:set OPENAI_API_KEY`. The
  model is the `RECEIPT_MODEL` param (default `gpt-6-luna`). The function never
  stores or logs the photo — only token counts are logged.
- Receipt photos attached to expenses (`Transaction.receiptId`) live in
  `users/{uid}/receipts`, one encrypted document each (`ReceiptService`), shrunk
  in the browser to fit Firestore's 1 MiB (`utils/image.ts`). No Firebase
  Storage. They're fetched only when opened — never put a live listener on that
  collection, or every page load downloads every photo.

## File structure

```text
src/app/
  models/           interfaces only
  services/         Firebase + business logic
  pages/            routed pages
    dashboard/
    accounts/
    transactions/
    bills/
    budgets/
    analysis/
    forecast/       Analysis → Forecast tab: cash ahead (maths in utils/forecast.ts)
    shared/         who owes you, across every split bill (maths in utils/shared.ts, utils/splits.ts)
      group-detail/ one group (a trip, a flat): balances, simplify debts, payments, its bills (maths in utils/groups.ts)
    net-worth/      accounts + manual assets/debts (ManualAsset, dated valuations)
      loan-detail/  one loan: payments made/missed/to come (maths in utils/loans.ts)
  app.ts            shell with sidebar
  app.html
  app.scss
  app.config.ts     providers
  app.routes.ts
```

## When things break

- If `npm install` fails with ERESOLVE, add `--legacy-peer-deps`
- If Firestore complains about "different SDK", run `npm list firebase` to check for duplicate versions
- If a component renders blank, check the class name matches the route import
- If Zone.js errors appear, confirm `import 'zone.js';` is the first line of `main.ts`

## Git discipline

- Never force-push or rewrite history
- Always commit before destructive operations (file deletions, major refactors)
- Suggested commit message format: `part N: <what changed>`
