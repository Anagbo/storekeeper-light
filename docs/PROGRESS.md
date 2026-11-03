# StoreKeeper POS progress

Status audit: 3 Nov 2026. This records the working tree at the time of review, including existing uncommitted changes. The brief and its Decisions section are the product source of truth; the HTML files are visual references only.

## Decisions

- Build the POS beside the legacy app and gate the POS entry point with `VITE_ENABLE_POS_SCREENS`; keep the existing sync behavior until a backend migration is decided.
- Keep Dexie/IndexedDB as the local data store. Its current schema is version 12.
- Keep the settled brief decisions: additive rollout with backup/restore, 10-second collection undo, append-only financial corrections, no starter-product seeding for new shops, and the specified Ghana Card validation.
- Screens 35/36 are driven by `src/data/starter-items.json` (version 2), loaded as data via `src/db/starterItems.js` (merge, core/more, search). Screen 35 shows popular categories first, then "More categories" grouped by `group`. Merge de-duplicates by case-insensitive name; core wins over more. "Something else" alone skips the starter list and opens New item (setup completes on save).
- The screen status below describes implementation presence and visible behavior, not acceptance sign-off. Several screens have not had component or end-to-end testing.

## Screens 15–47

| # | Screen | Status | Where / current state |
|---|---|---|---|
| 15 | Sell | done | `src/pos/Sell.jsx` |
| 16 | Pay part by part | done | `src/pos/PaymentSplit.jsx`; shared Cash/MoMo fields, Done only when paid parts equal the total, and Owe routes the remainder to the credit flow. |
| 17 | Who owes you? | done | `src/pos/CreditScreens.jsx` |
| 18 | When will they pay? | done | `src/pos/CreditScreens.jsx` |
| 19 | A little at a time | done | `src/pos/CreditScreens.jsx` |
| 20 | Sell with items | done | `src/pos/SellWithItems.jsx` |
| 21 | How do you want to sell? | done | `src/pos/SetupScreens.jsx`; loads and saves `sellMode` (`numbers` or `items`) in IndexedDB settings, and Continue advances only after a choice. |
| 22 | Home | done | `src/pos/Home.jsx` |
| 23 | Menu | done | `src/pos/Menu.jsx` |
| 24 | Today’s transactions | done | `src/pos/TodaysTransactions.jsx` |
| 25 | Collect payment | done | `src/pos/DebtCollection.jsx` (`CollectPayment`) |
| 26 | Collect: pay part | done | `src/pos/DebtCollection.jsx` (`CollectPayPart`) |
| 27 | Collect: part by part | done | `src/pos/DebtCollection.jsx` (`CollectPartByPart`); its own route reuses the Cash/MoMo split fields shared with screen 16 and requires exact reconciliation. |
| 28 | Payment received | done | `src/pos/DebtCollection.jsx` (`PaymentReceived`) |
| 29 | Debtor detail (on-time) | done | `src/pos/DebtCollection.jsx` (`DebtorDetail`), data-derived state |
| 30 | Sale recorded | done | `src/pos/SaleRecorded.jsx` |
| 31 | Credit saved | done | `src/pos/CreditScreens.jsx` |
| 32 | People who owe you | done | Existing `src/components/DebtLedger.jsx` |
| 33 | My money | partial | `src/pos/MyMoney.jsx`; week/month totals and balances exist, but profit views are not implemented and spending breakdown is unavailable. |
| 34 | New person | done | `src/pos/CreditScreens.jsx`, reuses the existing customer/Ghana Card validation. |
| 35 | What do you sell? | done | `src/pos/SetupScreens.jsx`; popular tiles, "Find your business" category search, More categories ? (51), multi-select shared with 51, Something else; "Something else" only goes to New item. |
| 36 | Your starter list | done | `src/pos/ItemScreens.jsx`; core ticked, Show more for unticked extras, "Continue ? N items" counts ticked only, "Skip, I?ll add items later". My items > Add from starter list searches all items. |
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
| 51 | More categories | done | `MoreCategories` in `src/pos/SetupScreens.jsx`; grouped chips, Done ? returns to 35. |
| 52 | Your starter list (grouped) | done | `YourStarterListGrouped` via `StarterList` in `src/pos/ItemScreens.jsx`; used when several categories have a combined core list over 30 items (`STARTER_GROUP_THRESHOLD`). Per-category heading, count, first 3 items, Show all N ?. |
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

After the setup and split-payment changes, `npm.cmd test` passed: **196 tests, 0 failures**. Test files are in `tests/`; coverage includes money/financial summaries, sales and credit, collections and undo, installments, suppliers/expenses, item validation and sale lines, customer/Ghana Card/contact/history, receipts and WhatsApp reminders, backup/restore, POS route-graph checks, sell-mode persistence, starter-item merge/core-more/search/"Something else only" rules, transaction feed, audio feedback, and subscription endpoints.

Not covered: component/render tests for every screen, full clickable route-walk tests, end-to-end journeys A–K, browser/offline acceptance tests, migration-upgrade tests, real-data migration rehearsal, or a full consistency report. The POS route test checks declared graph reachability and selected source strings, not every UI control.

Run tests with `npm.cmd test` in Windows PowerShell (or `npm test` in a shell where the npm script shim is permitted). Build command: `npm.cmd run build`.

## Differences and open questions

- `src/config/features.js` has one POS flag (`VITE_ENABLE_POS_SCREENS`) plus the subscription flag; it does not gate individual screen groups as requested in the rollout section.
- Setup entry checks that the shop has no products, transactions, debts, customers, or suppliers, as well as no completed-setup preference; this is intentionally stricter than checking only sales and products to protect existing merchants with debt/contact data.
- Profit estimate/item-cost views, settings switches, and item cost-price fields are absent. `MyMoney` currently says the spending breakdown is unavailable.
- Receipt generation is wired in the current POS even though the Decisions section says to present the proposed receipt text for approval before wiring it. Confirm whether the proposed templates are approved.
- Sync/server migration remains the separate, undecided phase described in the brief. No live server migration or real merchant-data rehearsal is evidenced here.
- No migration execution history or access to real device databases was available for this audit.
