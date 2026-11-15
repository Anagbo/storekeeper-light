# StoreKeeper POS progress

Status audit: 3 Nov 2026. This records the working tree at the time of review, including existing uncommitted changes. The brief and its Decisions section are the product source of truth; the HTML files are visual references only.

## Decisions

- Build the POS beside the legacy app and ship the POS as the only app shell (no POS flag); keep the existing sync behavior until a backend migration is decided.
- Keep Dexie/IndexedDB as the local data store. Its current schema is version 12.
- Keep the settled brief decisions: additive rollout with backup/restore, 10-second collection undo, append-only financial corrections, no starter-product seeding for new shops, and the specified Ghana Card validation.
- Screens 35/36 are driven by `src/data/starter-items.json` (version 2), loaded as data via `src/db/starterItems.js` (merge, core/more, search). Screen 35 shows popular categories first, then "More categories" grouped by `group`. Merge de-duplicates by case-insensitive name; core wins over more. "Something else" alone skips the starter list and opens New item (setup completes on save).
- The screen status below describes implementation presence and visible behavior, not acceptance sign-off. Several screens have not had component or end-to-end testing.
- Paystack subscription state and callback verification are shared through `src/hooks/useSubscription.js`; both the legacy shell and `src/pos/PosApp.jsx` consume the hook, and the subscription section is available in new POS Settings when `VITE_ENABLE_SUBSCRIPTION=true`. Monthly, six-month, and yearly plans use server-authoritative, environment-configured prices. A first-launch trial is configurable through `VITE_SUBSCRIPTION_TRIAL_DAYS` and is persisted locally before lockout begins. The shared backup modal is backup-only by default; the legacy shell explicitly opts into its compatibility subscription entry point and retains lockout behavior, while the new POS remains Settings-first. Subscription journey contracts now cover Settings-to-modal wiring, plan selection, callback propagation, and server verification. README now documents the complete deployment and environment configuration.

## Reliability task ledger

The reliability programme is dependency-ordered. A task is marked **done** only after its implementation or analysis, tests, documentation, and validation evidence are complete.

| Order | Task | Status | Depends on |
|---:|---|---|---|
| 1 | Map reliability boundaries | **done** | — |
| 2 | Harden Paystack payment recovery | **done** | 1 |
| 3 | Fix subscription billing dates | **done** | 1 |
| 4 | Harden trial and time policy | **done** | 1 |
| 5 | Test transaction atomicity | **done** | 1 |
| 6 | Harden offline sync idempotency | **done** | 1 |
| 7 | Define reconciliation conflicts | **done** | 6 |
| 8 | Validate backup recovery | **done** | 1 |
| 9 | Run Ghana network matrix | **done** | 2, 5 |
| 10 | Build complete reliability test suite | **done** | 2–9 |
| 11 | Document rollout and release gates | **done** | 10 |
| 12 | Execute final reliability acceptance | **blocked** | 11 |

### Reliability Task 6 — Offline sync idempotency (done)

- Added `src/lib/syncPayload.js` to normalize pending-record order and derive a compact SHA-256 `Idempotency-Key` from the exact sync batch.
- Foreground sync and service-worker background sync now send the same key for the same snapshot. A retry after a timeout, page restart, or foreground/service-worker overlap can therefore be deduplicated by the server.
- Existing local acknowledgement protection remains in place: a record is marked synced only when it is still pending and its `updatedAt` matches the submitted version. Partial acknowledgements leave unacknowledged records pending.
- Updated the cloud-sync contract in `README.md`: the endpoint must durably process a batch transactionally and replay the original acknowledgement for a repeated `Idempotency-Key`.
- Added tests for deterministic payload ordering, identical retry keys, and changed-version key separation.
- Validation: focused sync/atomicity tests, full test suite, production build, and `git diff --check`.

### Reliability Task 7 — Reconciliation conflict policy (done)

- Added `src/lib/syncConflicts.js` with the shared policy and classifier:
  - `transactions` are append-only; exact duplicate retries are acknowledged, divergent same-ID payloads are conflicts.
  - `products` and `debts` are mutable but never last-write-wins; divergent versions require manual review.
- Documented the server response contract: conflicted IDs are returned under per-table `conflicts` and are not included in `acknowledged`, so they remain pending locally.
- Debt balances must be reconciled from financial events and approved corrections rather than trusting a remote materialized balance.
- Added tests for new records, idempotent retries, immutable transaction conflicts, and mutable-record conflicts.

### Reliability Task 8 — Backup recovery validation (done)

- Backup validation now rejects duplicate IDs within a table and broken debt/payment references before any local write begins.
- Restore remains one IndexedDB read/write transaction, so a failed bulk write does not leave a partial restore.
- A backup with an older `updatedAt` cannot overwrite newer local data; records without comparable timestamps retain the existing merge behavior for legacy compatibility.
- Existing backup coverage and new tests cover supported formats, legacy optional tables, payment details, debt adjustments, duplicate IDs, broken references, and stale-backup protection.
- Subscription and trial settings remain intentionally device-local and are not included in merchant data backups; restoring business records does not silently transfer access state between devices.

### Reliability Task 9 — Ghana network and device matrix (done)

Automated protocol coverage now exercises the conditions that can be reproduced without carrier hardware:

| Condition | Expected behavior | Coverage |
|---|---|---|
| Offline or connection drop | Keep records pending; retry on reconnect/visibility/interval | Existing foreground and Background Sync paths |
| Slow or stalled mobile data | Abort a sync request after 30 seconds; retain the batch for retry | `tests/syncNetworkMatrix.test.js` |
| HTTP 408/425/429/5xx | Treat as transient and retry with the same idempotency key | `tests/syncNetworkMatrix.test.js` |
| HTTP 4xx validation/auth failure | Do not classify as a transient network failure | `tests/syncNetworkMatrix.test.js` |
| Timeout after server commit | Replay the same batch key; server deduplicates it | `tests/syncPayload.test.js`, sync contract |
| Partial acknowledgement | Mark only acknowledged, unchanged records synced | `src/hooks/useSync.js`, `src/sw.js` |
| Foreground/service-worker overlap | Same exact snapshot produces the same idempotency key | `tests/syncPayload.test.js` |

Physical handset checks remain release-gate work: MTN/Vodafone/Telecel SIMs, 2G/3G/4G transitions, airplane-mode toggling, captive portals, browser suspension, power loss during a write, and low-storage conditions must be executed on representative Android devices before production rollout.

### Reliability Task 10 — Complete reliability test suite (done)

The repeatable command is:

```sh
npm.cmd run test:reliability
```

It runs the complete `tests/` suite and therefore includes the reliability layers together:

| Layer | Primary coverage |
|---|---|
| Transaction atomicity | `runTransactionWithTimeout.test.js`, sales, debt, installment, supplier, and undo tests |
| Financial consistency | `consistency.test.js`, money and ledger tests |
| Backup recovery | `backup.test.js`, migration and restore coverage |
| Sync idempotency | `syncPayload.test.js`, `syncConflicts.test.js`, `syncNetworkMatrix.test.js` |
| Payment recovery and dates | `subscription.test.js` |
| Route and flow contracts | POS route, sell-flow, debt, receipt, and transaction-feed tests |

The suite is intentionally the full test directory rather than a separate reduced subset, preventing a reliability change from passing only because unrelated integration tests were omitted. The current baseline is **319 tests, 0 failures**; production build and `git diff --check` are release prerequisites alongside this command.

### Reliability Task 11 — Rollout and release gates (done)

Every release must pass these gates in order:

1. **Configuration review**
   - Confirm Paystack secret variables exist only in the server environment.
   - Confirm subscription prices and durations match the approved Ghana pricing.
   - Confirm `VITE_SUBSCRIPTION_TRIAL_DAYS` is intentional for the release.
   - Keep `VITE_ENABLE_SUBSCRIPTION` off in production; enable it only when subscription monetization launches.
   - Confirm `VITE_SYNC_ENDPOINT` uses HTTPS and the sync server implements idempotency keys, transactional acceptance, acknowledgements, and conflicts.
2. **Data-safety rehearsal**
   - Export a backup from a representative device.
   - Restore it onto a separate test device or clean browser profile.
   - Verify products, sales, debts, customers, payments, suppliers, debt adjustments, and installment schedules.
   - Confirm a stale backup cannot replace newer local data.
3. **Automated validation**
   - Run `npm.cmd run test:reliability` with zero failures.
   - Run `npm.cmd run build` successfully.
   - Run `git diff --check`.
4. **Payment and offline acceptance**
   - Verify Paystack redirect loss, reload, reconnect retry, manual verification, duplicate verification, and early renewal behavior.
   - Verify offline sale/debt/collection entry, power-loss recovery, sync timeout, partial acknowledgement, conflict quarantine, and foreground/service-worker overlap.
5. **Ghana device/network acceptance**
   - Test representative MTN, Vodafone/Telecel, and other available Ghana SIMs across 2G/3G/4G transitions.
   - Test airplane mode, captive portals, intermittent data, browser suspension, low storage, and device clock rollback.
6. **Controlled rollout**
   - Enable the POS and sync endpoints for internal users first.
   - Monitor pending sync counts, conflict counts, failed payment verifications, backup restores, and client errors.
   - Expand gradually only after the internal cohort completes real sales and collections without unresolved financial discrepancies.

Rollback means disabling the POS or sync feature flags, stopping new subscription lockout enforcement, and preserving local data for later export. Never delete local IndexedDB data as a rollback step.

### Reliability Task 12 — Final reliability acceptance

**Automated acceptance completed on 6 Nov 2026:**

- `npm.cmd run test:reliability`: **319 passed, 0 failed**
- `npm.cmd run build`: passed, including service-worker generation
- `git diff --check`: passed
- Reliability ledger tasks 1–11: complete

**Go/no-go: blocked pending field evidence.** This environment cannot execute the required production-like deployment and representative Ghana handset/carrier checks. Before enabling production subscription lockout or broad sync rollout, record evidence for MTN, Vodafone/Telecel, 2G/3G/4G transitions, airplane mode, captive portals, browser suspension, power loss during a write, low storage, and Paystack redirect loss/recovery. Keep `VITE_ENABLE_SUBSCRIPTION` off and treat the release as internal-only until those checks pass.

## Screens 15–47

| # | Screen | Status | Where / current state |
|---|---|---|---|
| 15 | Sell | done | `src/pos/Sell.jsx`; cash/MoMo completes directly to 30, Owe opens 17, Split opens 16, and Add items carries the typed amount into 20. |
| 16 | Pay part by part | done | `src/pos/PaymentSplit.jsx`; shared Cash/MoMo fields, Done only when paid parts equal the total, and Owe routes the remainder to the credit flow. |
| 17 | Who owes you? | done | `src/pos/CreditScreens.jsx` |
| 18 | When will they pay? | done | `src/pos/CreditScreens.jsx` |
| 19 | A little at a time | done | `src/pos/CreditScreens.jsx` |
| 20 | Sell with items | done | `src/pos/SellWithItems.jsx`; carries an `Other amount` / `From Sell` line with no product ID, supports removing it, and Next opens 55. |
| 21 | How do you want to sell? | done | `src/pos/SetupScreens.jsx`; loads and saves `sellMode` (`numbers` or `items`) in IndexedDB settings, and Continue advances only after a choice. |
| 22 | Home | done | `src/pos/Home.jsx` |
| 23 | Menu | done | `src/pos/Menu.jsx` |
| 24 | Today’s transactions | done | `src/pos/TodaysTransactions.jsx` |
| 25 | Collect payment | done | `src/pos/DebtCollection.jsx` (`CollectPayment`) |
| 26 | Collect: pay part | done | `src/pos/DebtCollection.jsx` (`CollectPayPart`) |
| 27 | Collect: part by part | done | `src/pos/DebtCollection.jsx` (`CollectPartByPart`); its own route reuses the Cash/MoMo split fields shared with screen 16 and requires exact reconciliation. |
| 28 | Payment received | done | `src/pos/DebtCollection.jsx` (`PaymentReceived`) |
| 29 | Debtor detail (on-time) | done | `src/pos/DebtCollection.jsx` (`DebtorDetail`), data-derived state |
| 30 | Sale recorded | done | `src/pos/SaleRecorded.jsx`; shows the same itemized lines, including `Other amount`, and the recorded payment parts. |
| 31 | Credit saved | done | `src/pos/CreditScreens.jsx` |
| 32 | People who owe you | done | `src/pos/DebtCollection.jsx` |
| 33 | My money | partial | `src/pos/MyMoney.jsx`; week/month totals and balances exist, but profit views are not implemented and spending breakdown is unavailable. |
| 34 | New person | done | `src/pos/CreditScreens.jsx`, reuses the existing customer/Ghana Card validation. |
| 35 | What do you sell? | done | `src/pos/SetupScreens.jsx`; popular tiles, "Find your business" category search, More categories › (51), multi-select shared with 51, Something else; "Something else" only goes to New item. |
| 36 | Your starter list | done | `src/pos/ItemScreens.jsx`; core ticked, Show more for unticked extras, "Continue · N items" counts ticked only, "Skip, I’ll add items later". My items > Add from starter list searches all items. |
| 37 | How much is {item}? | done | `src/pos/SetupScreens.jsx` |
| 38 | How many {item}? | done | `src/pos/SetupScreens.jsx` |
| 39 | My items | done | `src/pos/ItemScreens.jsx` |
| 40 | Edit item | partial | `src/pos/ItemScreens.jsx`; edit/delete are present, but cost-price support is not. |
| 41 | New item | partial | `src/pos/ItemScreens.jsx`; item creation is present, but cost-price support is not. |
| 42 | Delete item? | done | `src/pos/ItemScreens.jsx` |
| 43 | Debtor detail (late) | done | Same data-derived `DebtorDetail` screen as 29 in `src/pos/DebtCollection.jsx`. |
| 44 | Spent money | done | `src/pos/SupplierScreens.jsx` |
| 45 | Stock on credit | done | `src/pos/SupplierScreens.jsx` |
| 46 | You owe suppliers | done | `src/pos/SupplierScreens.jsx` |
| 51 | More categories | done | `MoreCategories` in `src/pos/SetupScreens.jsx`; grouped chips, Done › returns to 35. |
| 52 | Your starter list (grouped) | done | `YourStarterListGrouped` via `StarterList` in `src/pos/ItemScreens.jsx`; used when several categories have a combined core list over 30 items (`STARTER_GROUP_THRESHOLD`). Per-category heading, count, first 3 items, Show all N ›. |
| 55 | Review and pay | done | `src/pos/ReviewAndPay.jsx`; reviews the carried amount and item lines, then completes cash/MoMo sales through the existing sale save path or routes Owe/Split to the existing flows. |
| 47 | Settings: profit tools | partial | `src/pos/SettingsScreens.jsx`; profit controls are unavailable, so the two brief settings switches are not implemented. |

## Screens next

Ready for manual testing: first-time setup **21 → 35 → 36**, plus the updated sale split and collection split flows. The mode is persisted; category selection filters the starter items, and setup remains limited to an empty new shop. Verify setup Back/Skip/Continue paths and persisted setup completion on device.

## Database migrations and consistency

Dexie schema and upgrade handlers are in `src/db/db.js`, versions 1–12:

1. v1 creates products, transactions, and debts.
2. v2 adds transaction/debt indexes.
3. v3 adds the debt `amountPesewas` index.
4. v4 adds legacy-compatible fields/indexes and backfills product, transaction, and debt fields, including normalizing active debt status.
5. v5 adds customers and backfills them from debt and transaction records.
6. v6 normalizes stored payment methods.
7. v7 adds settings.
8. v8 adds default Ghana Card fields to debts and customers.
9. v9 adds installment-plan fields/defaults and a due-date index.
10. v10 adds payments.
11. v11 adds customer IDs/indexes to transactions, debts, and payments.
12. v12 adds suppliers and supplier IDs/indexes to transactions.

Dexie runs applicable forward upgrades when an older local database is opened. No evidence in the repository establishes whether these migrations have run against real merchant data; no real-data rehearsal or per-migration test is present. The migrations are not shown to have explicit reverse handlers. Backup/restore exists and has tests.

There is no general invariant checker/report that runs after migrations and sync. Tests cover particular rules (for example split totals, debt balances, installment reconciliation, supplier balances, and money summaries), but those are not a full post-migration or cross-ledger consistency audit.

## Tests

After the migration and consistency changes, `npm.cmd test` passed: **210 tests, 0 failures**. Test files are in `tests/`; coverage includes money/financial summaries, sales and credit, collections and undo, installments, suppliers/expenses, item validation and sale lines, customer/Ghana Card/contact/history, receipts and WhatsApp reminders, backup/restore, migration upgrades, read-only consistency checks, POS route-graph checks, sell-mode persistence, starter-item merge/core-more/search/"Something else only" rules, transaction feed, audio feedback, and subscription endpoints.

### WP5 conformance completion — 7 Nov 2026

- Added `tests/wp5.contract.test.js`, which validates wiring screen/component coverage, navigation-target resolution, shared state screens (16/27, 29/43, 33/48/49, 40/50, 36/52, 69/70), prototype-only Demo control exclusion, GH₵ source conformance, and responsive/touch-size guardrails.
- Completed the MoMo contract screens 57 and 58 with waiting and OTP-code states. Telecel requests now enter the code state; other requests enter the waiting state, and no payment is recorded before confirmation.
- Extended `POS_ROUTES`/`POS_LINKS` to cover MoMo, settings, and subscription route reachability from the POS graph.
- Replaced user-facing GHS labels/messages/receipt output with GH₵ while retaining `GHS` only for API currency/parser compatibility and environment variable names.
- Validation: `npm.cmd test` passed, WP5 contract and route tests passed (20 tests), `npm.cmd run build` passed, and `git diff --check` passed.
- Browser screenshot comparison at 390×844, 360, and 320 widths remains a manual release check; automated WP5 coverage provides static responsive guardrails but does not replace device/browser evidence. Real Paystack webhook/status verification also remains outside this local validation run.

| Screen | Controls in contract | Implemented | Contract test | E2E journey | Deviations |
|---|---|---|---|---|---|
| 15, 16, 17, 18, 19, 20, 55 | Sell, split, credit, installment, itemized review/payment controls | Yes | Yes | A–E source/route regressions | Browser click-through still required |
| 21–24, 32–47, 51–54 | Setup, home/menu, debtor, supplier, review, settings and correction controls | Yes/partial by existing feature flags | Yes | A, G–L route coverage | Existing profit-tool and correction surfaces retain their prior data-driven implementation |
| 25–28 | Collection, split collection, received, undo/details/receipt controls | Yes | Yes | F route and ledger tests | Paystack confirmation requires provider environment |
| 29–31, 43 | Debtor states and sale/credit result controls | Yes | Yes | E/G/L regressions | Shared components serve both contract states |
| 56–60 | MoMo request, waiting/OTP, failure and setup controls | Yes | Yes | M structural route coverage | Real Paystack charge/webhook integration is not locally verifiable |
| 61–63 | MoMo choice/direct/settings controls | Yes | Yes | M structural route coverage | Merchant fee decision recorded: merchant bears fee |
| 64–70 | Plan payment method, cash/direct MoMo/phone request and result states | Yes | Yes | Subscription route tests | Server confirmation remains required for production |

Not covered: component/render tests for every screen, full clickable route-walk tests, end-to-end journeys A–K, browser/offline acceptance tests, migration-upgrade tests, real-data migration rehearsal, or a full consistency report. The POS route test checks declared graph reachability and selected source strings, not every UI control.

Run tests with `npm.cmd test` in Windows PowerShell (or `npm test` in a shell where the npm script shim is permitted). Build command: `npm.cmd run build`.

## Steps 5–9 rollout log

### Step 5 — Receipt templates (done, behind a flag)

- Templates: `src/pos/receiptTemplates.js` implements the brief's proposed sale receipt (screen 30, and credit-saved screen 31) and payment receipt (screen 28). Only lines that apply appear (no Owed line on a cash sale, no Next payment line without a plan, no zero-value Cash/MoMo part).
- Privacy: builders take only shop name, customer first name as entered, amounts, dates and item lines. Phone numbers and Ghana Card numbers are never read; the phone is used only to build the `wa.me` link. Tests assert neither appears in any sample.
- Flag: `VITE_ENABLE_POS_RECEIPTS` (`FEATURE_FLAGS.SHOW_POS_RECEIPTS`, default off) is the single flag for all three receipts (this is also Step 6's single flag; there are no per-receipt flags). Off keeps the previous receipt text. On also adds a Send receipt link on Credit saved (needs a valid phone, as for collections). `recordCreditSale` now also returns the saved `saleTransaction`.
- Tests: `tests/receiptTemplates.test.js` (exact-text samples, applicable-lines, reconciliation errors, flag on/off). Full suite: 205 pass, 0 fail; `npm.cmd run build` succeeds.
- Approval still needed: the sample outputs below (shop "Ama's Shop"):

```text
1. Cash only
Receipt from Ama's Shop
2 Nov 2026, 9:30 AM
Bread × 2: GHS 10.00
Water × 1: GHS 3.00
Total: GHS 13.00
Paid: Cash GHS 13.00
Thank you!

2. Split credit
Receipt from Ama's Shop
2 Nov 2026, 9:30 AM
Total: GHS 80.00
Paid: Cash GHS 20.00, MoMo GHS 30.00
Owed: GHS 30.00, pay by 15 Nov 2026
Thank you!

3. Installment collection
Payment received by Ama's Shop
3 Nov 2026, 2:05 PM
From: Ama Owusu
Amount: GHS 12.50 (Cash GHS 5.00, MoMo GHS 7.50)
Still owed: GHS 8.75
Next payment: GHS 3.00 on 10 Nov 2026
Thank you!
```

- Credit-sale correction: the Credit saved receipt now uses the recorded initial payment parts rather than the portion allocated to the new sale. A sale of GH₵25 with an existing balance and a GH₵100 payment split as GH₵40 cash/GH₵60 MoMo now shows the full payment and resulting balance. The "See details" action is full-width below the share actions on narrow screens.
- Installment-date correction: credit-sale results now include the final active installment schedule after payment reconciliation. Receipts use that persisted schedule, so completed cycles advance the next date, partial cycles keep the existing date, and cleared balances omit the Next payment line.
- Contact-save correction: Credit saved now forwards the existing contact persistence callback into the contact editor. The previous missing prop caused `onSaveCustomerContact is not a function` when saving a new contact.

### Step 6 — Single receipt feature flag (done)

- All new receipt templates use `FEATURE_FLAGS.SHOW_POS_RECEIPTS`, backed by `VITE_ENABLE_POS_RECEIPTS`.
- There are no separate cash-sale, split-credit, collection, or credit-saved receipt flags. The flag defaults to off, preserving the existing receipt text until the templates are enabled.
- Added a guard test that ensures the feature configuration exposes exactly one receipt-specific flag.

### Step 7 — Shared money module and ledger alignment (done)

- `src/lib/money.js` is now the shared POS money API for formatting, transaction retrieval, financial totals, and outstanding debt totals.
- Home, Today’s transactions, My money, and debt collection read their totals through the shared money API; the existing POS helper remains only for POS-specific period/debtor presentation logic.
- Added a common-ledger test covering the four surfaces’ money-in, spending, credit, cash-left, and outstanding-debt values. The test confirms that all totals are derived from the same ledger records.

### Step 8 — Migration tests and read-only consistency checker (done)

- Added upgrade tests that create real v1 and v11 IndexedDB schemas, open them with the current v12 schema, and verify preserved data, new tables, and the v12 supplier index.
- Added `checkLedgerConsistency()` in `src/utils/consistency.js`. It reads transactions, debts, payments, customers, and suppliers, returns structured issues and totals, and never writes, repairs, or deletes data.
- The checker reports invalid amounts, broken customer/debt/supplier/payment/transaction references, customer balance mismatches, installment schedule mismatches, invalid supplier balances, financial-summary failures, and summary mismatches.
- Added clean-ledger, intentionally inconsistent-ledger, v1-upgrade, and v11-upgrade tests.

## Owed tab

The Owed tab and debtor detail are native POS screens; the old debt page is gone and its parity audit is retired.

### Owed migration task status

- **Task 1 — ledger contract: defined and approved.** `task.md` now
  defines the debt-balance equation, the `debt_adjustment` event, shared
  database operations, validation rules, and transaction/conflict semantics.
  No new behavior or schema change was started until approval.
- The existing `src/db/debtLedger.js` extraction is provisional mechanical
  work from the earlier task attempt. It remains as a compatibility layer until
  the legacy editor is migrated to the approved correction contract.
- **Task 2 — shared database operations: implemented and approved.**
  `src/db/debtLedger.js` now provides customer resolution, customer-balance
  recalculation, atomic profile updates, stale-edit checks, and atomic balance
  correction records. The transaction type definitions include
  `debt_adjustment`. The legacy editor still uses compatibility wrappers;
  switching it to correction-reason and profile-edit behavior is a later task.
- **Task 3 — append-only debt adjustments: implemented, awaiting approval.**
  Corrections now store before/after balances, deltas, reason codes, reason
  notes, and debt snapshots in non-cash `debt_adjustment` transactions while
  updating the materialized debt and recalculating the customer total in one
  transaction. Zero-balance corrections are rejected in favor of collection.
  Eight focused debt-ledger tests pass; the full suite passes with **218 tests,
  0 failures**. Financial-summary tests confirm upward and downward
  corrections do not create cash or income.
- **Task 4 — customer-total recalculation: implemented, awaiting approval.**
  The shared `recalculateCustomerDebtBalance()` operation is now used by the
  existing credit-sale, add-on, collection, and collection-undo lifecycle
  through `refreshCustomerDebtBalance()`. Totals are derived from all unpaid
  debts rather than maintained only by deltas. Debt lifecycle tests pass, the
  full suite passes with **218 tests, 0 failures**, and the production build
  succeeds.
- **Task 5 — identity and contact normalization: implemented, awaiting
  approval.** `saveCustomerContact()` now uses the shared profile operation.
  Customer resolution prefers stable IDs and falls back to normalized names;
  legacy name-only debts are linked during profile updates. Phone numbers are
  normalized consistently, and empty phone/Ghana Card values explicitly clear
  active debt snapshots while leaving paid historical debt snapshots unchanged.
  Focused identity/contact tests pass, the full suite passes with **219 tests,
  0 failures**, and the production build succeeds.
- **Task 6 — installment corrections: implemented, awaiting approval.**
  `reconcileInstallmentBalanceCorrection()` now validates the existing plan,
  preserves completed payments, preserves valid partial-payment carry and due
  dates, and recalculates remaining and total installment counts after a
  balance correction. Invalid schedules and unsafe carry values abort the
  correction. Installment-focused tests pass, the full suite passes with
  **222 tests, 0 failures**, and the production build succeeds.
- **Task 7 — legacy editor migration: implemented, awaiting approval.** The
  legacy debt editor now separates append-only **Correct Balance** from
  **Edit Contact**. Balance corrections require a reason and optional
  explanation, use stale-edit protection, and keep collection as the only
  balance-clearing path. Contact edits use the shared profile operation and
  support explicit clearing. The full suite passes with **222 tests, 0
  failures**, and the production build succeeds.
- **Task 8 — ledger consumers: implemented, awaiting approval.** Customer
  history and both transaction-feed surfaces now display balance corrections
  with signed deltas. The consistency checker includes adjustment deltas in
  debt-balance equations and reports malformed adjustment records. Financial
  and POS cash totals remain unchanged because adjustments are non-cash.
  Focused tests pass, the full suite passes with **225 tests, 0 failures**,
  and the production build succeeds.
- **Task 9 — persistence boundaries: implemented, awaiting approval.**
  Backup validation and restore preserve adjustment records, debt/customer
  links, signed deltas, before/after snapshots, and correction metadata.
  Transaction sync already transmits the complete transaction record and
  acknowledges it by ID, so adjustments are synchronized as records rather
  than replayed as income. POS transaction rendering now labels corrections
  without adding them to money totals. The full suite passes with **226
  tests, 0 failures**, and the production build succeeds.
- **Task 10 — regression gate: passed, awaiting manual legacy-flow testing.**
  The full suite passes with **226 tests, 0 failures**, the production build
  succeeds, and the working-tree diff passes `git diff --check`. Consistency
  coverage includes clean, corrected, collected, inconsistent, and
  adjustment-aware ledgers. No schema migration was required because
  `debt_adjustment` uses the existing transaction table and indexes.
- **Task 11 — POS Owed experience: implemented and approved.**
  Replaced the POS Owed route's legacy ledger screen with a grouped
  `PeopleWhoOweYou` list that uses stable customer IDs and normalized-name
  fallback, sorts by total outstanding balance, supports search, and routes
  customers to `DebtorDetail`. Single-debt customers can collect directly;
  customers with multiple debts are sent to detail first. POS debtor detail
  now supports shared contact editing, collection, history, and append-only
  balance correction with stale-edit protection. Focused grouping and route
  tests pass, the full suite passes with **228 tests, 0 failures**, and the
  production build succeeds. POS detail history now labels corrections as
  **Balance corrected** with a signed delta instead of misclassifying them as
  credit. All nine manual POS validation points were completed and confirmed.
  A follow-up fix now snapshots the debt version when the POS correction form
  opens, so live-query refreshes cannot bypass stale-edit protection. The
  follow-up was manually reproduced across two app tabs and confirmed to
  reject the stale save without overwriting the concurrent payment. **Task 11
  is complete and approved.**

## Differences and open questions

- `src/config/features.js` has no POS flag, one receipt flag (`VITE_ENABLE_POS_RECEIPTS`) plus the subscription flag; it does not gate individual screen groups as requested in the rollout section.
- Setup entry checks that the shop has no products, transactions, debts, customers, or suppliers, as well as no completed-setup preference; this is intentionally stricter than checking only sales and products to protect existing merchants with debt/contact data.
- Profit estimate/item-cost views, settings switches, and item cost-price fields are absent. `MyMoney` currently says the spending breakdown is unavailable.
- Receipt generation is wired in the current POS even though the Decisions section says to present the proposed receipt text for approval before wiring it. The proposed templates are now implemented behind `VITE_ENABLE_POS_RECEIPTS` (Step 5); confirm approval of the samples before enabling it.
- Sync/server migration remains the separate, undecided phase described in the brief. No live server migration or real merchant-data rehearsal is evidenced here.
- No migration execution history or access to real device databases was available for this audit.

## Modular task approval log

- **M01 — Repair the unused debt-edit compatibility helper: approved 4 Nov
  2026.** Confirmed there were no source callers of `updateDebtDetails()`.
  Removed the obsolete direct-write helper rather than preserving a path that
  bypassed the approved append-only correction contract. Added a regression
  assertion that the helper is no longer exported. The focused debt-ledger
  suite passes: **13 tests, 0 failures**.
- **M02 — Extract a reusable POS add-debt entry point: approved 4 Nov 2026.**
  Added `src/utils/addDebt.js` with shared add-debt preparation and persistence
  through `recordCreditSale()`. The add-debt flow uses that shared
  entry point while preserving customer, contact, Ghana Card, note, and
  installment behavior. Focused add-debt and debt-lifecycle tests pass:
  **29 tests, 0 failures**; the production build succeeds.
- **M03 — Add the POS `+ Add debt` route and action: approved 4 Nov 2026.**
  Added the POS `AddDebt` route, action from `PeopleWhoOweYou`, customer
  suggestions, contact/Ghana Card/note fields, standard and installment debt
  entry, and return-to-list refresh through the shared M02 persistence
  operation. POS route and add-debt tests pass: **13 tests, 0 failures**; the
  production build succeeds.
- **M04 — Add POS add-debt behavior tests: approved 4 Nov 2026.** Added
  coverage for Owed-to-Add debt routing, standard and installment persistence,
  invalid-input no-write behavior, and normalized duplicate-customer
  prevention. The focused M04 suite passes: **18 tests, 0 failures**.
- **M05 — Define the bounded Owed-list query contract: approved 4 Nov 2026.**
  Added a bounded, descending unpaid-debt page query with a stable
  amount-and-ID cursor, explicit page-size validation, and structured
  `hasMore`/`nextCursor` results. Added coverage for multi-page loading,
  legacy balances, paid-record exclusion, and invalid cursors. The focused
  Owed query suite passes: **4 tests, 0 failures**.
- **M06 — Implement Owed-list `Show more`: approved 4 Nov 2026.** Replaced
  the unbounded Owed-list debt read with the bounded M05 page query, added
  incremental `Show more` loading, preserved grouping and sorting across
  loaded pages, and reset additional pages when the live first page changes.
  Focused Owed/M06 tests pass: **5 tests, 0 failures**; the production build
  succeeds.
- **M07 — Decide debtor item-description behavior: approved 4 Nov 2026.**
  The new debtor detail experience will show item descriptions when available,
  with a clear fallback for older records without a usable description. The
  full legacy debt list remains excluded from the new detail view.
- **M08 — Implement debtor item-description parity: approved 4 Nov 2026.**
  Added defensive item-description extraction for credit and debt-add-on
  history events, displaying usable descriptions in `DebtorDetail` and a
  clear fallback when older records have no usable description. Focused
  item-description tests pass: **2 tests, 0 failures**; the production build
  succeeds.
- **M09 — Add POS Owed route and action coverage: approved 4 Nov 2026.**
  Added focused coverage for Owed-to-detail and Owed-to-collection journeys,
  including preservation of customer and representative debt identifiers.
  The combined POS/Owed route suite passes: **20 tests, 0 failures**.
- **M10 — Decide WhatsApp Business scope: approved 4 Nov 2026.** The new POS
  flow will retain only the direct WhatsApp link for valid phone numbers and
  will not add the legacy WhatsApp Business/server reminder capability. The
  legacy flow remains separate until final rollout verification.
- **M11 — Apply WhatsApp Business decision: approved 4 Nov 2026.** Verified
  that POS debtor detail retains only the direct `wa.me` reminder link,
  rejects invalid reminder details, and exposes no WhatsApp Business/server
  action. The legacy Business/server implementation remains separate.
  Focused WhatsApp tests pass: **11 tests, 0 failures**; the production build
  succeeds.
- **M12 — Manual legacy-flow verification: approved 4 Nov 2026.** User
  confirmed that all listed legacy scenarios passed, including debt/contact
  editing, balance corrections, validation, collection variants and undo,
  multi-debt handling, history, and financial totals.
- **Revised R01 — Implement `recordManualDebt`: implemented, awaiting
  approval 4 Nov 2026.** Added a ledger-only manual debt operation that
  appends a `manual_debt` credit event, updates the outstanding debt
  snapshot, creates no sale record, item lines, or payment, and leaves
  financial totals unchanged. History recognizes the event as “Added to
  debt” without a sign, including optional notes and timestamp ordering.
  Focused manual-debt, ledger, history, and financial tests pass:
  **32 tests, 0 failures**; the production build succeeds.
- **Revised R01 — `recordManualDebt` approved 4 Nov 2026.** The operation
  passed focused ledger, history, and financial validation and is approved as
  the persistence boundary for Journey L.
- **Revised R02 — Journey L: implemented, awaiting approval.** The Owed tab's
  Add debt action now enters the component-based customer picker and amount
  flow, with Taken on date, optional note, inherited terms, and the existing
  payment-plan screen. Debtor detail exposes `+ Add to debt`; manual saves
  call `recordManualDebt` and navigate to a manual-debt confirmation without
  creating a sale. The legacy AddDebt route remains reachable as a fallback.
  Full local validation passes: **all Node tests, production build, and
  `git diff --check`**.
- **Adaptive installment reconciliation: implemented, awaiting approval 4 Nov
  2026.** Manual Add debt and normal credit sales now share replacement-plan
  reconciliation. Any supported frequency or installment amount can change
  while preserving completed-installment history, partial-payment carry, and
  the anchored due-date rule. A partial payment advances the schedule only
  after a complete installment amount is collected; late unpaid cycles are not
  forgiven. Focused partial-payment, manual-debt, credit-sale, and plan-change
  tests pass, including adversarial late-payment, catch-up, frequency-transition,
  carry-conversion, malformed-plan, and overflow cases. The full Node suite,
  production build, and `git diff --check` also pass.
- **Screen 53 invalid-plan error handling: implemented, awaiting approval 4 Nov
  2026.** Invalid inherited installment terms are now detected before save and
  shown as a visible correction message instead of rendering an unusable plan.
  Manual debt save failures are caught and displayed to the user rather than
  becoming uncaught promise errors in DevTools. Shared plan validation now
  rejects installment amounts that exceed the current debt balance.
