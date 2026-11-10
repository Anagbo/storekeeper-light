# StoreKeeper Light

An offline-first React PWA for recording sales, expenses, and customer debts. Money is stored as integer pesewas to avoid floating-point rounding. The app keeps data in IndexedDB and can be installed from a supported mobile browser.

The dashboard shows live daily totals, a device-local editable shop name, and online/offline status. The transaction feed is virtualized and loads records in 50-item indexed cursor pages. The debt ledger loads active balances in 25-item pages. These queries use compound IndexedDB indexes and avoid loading the complete history into the UI.

Sales record the customer, phone, item, quantity, total price, and payment type. Selecting credit saves the sale and its customer debt together in one IndexedDB transaction. Voice entry recognizes common numeric and English number phrases, then fills sale or expense fields for review before saving. For example, “Afi bought 2 bags of cement for 180 GHS on credit” fills a GHS 180 sale, while “paid ten cedis for transport” fills a GHS 10 expense with “transport” as its note. When an expense phrase contains multiple likely amounts, the app avoids guessing and asks the trader to enter the amount manually; transcripts should always be reviewed before saving.

The debts ledger pages outstanding debts in descending amount order using the `[status+amountPesewas+id]` IndexedDB index. Customer names and phone numbers are saved locally and searchable by name prefix in the quick-sale form; selecting a customer fills in their phone number and shows their outstanding balance. Named sales and debt-ledger entries update the local customer list, and marking a debt paid updates its balance. WhatsApp reminders are prefilled with the saved shop name, customer's balance in GHS, and an MTN MoMo payment suggestion.

The dashboard's **View Weekly & Monthly Reports** button opens a financial overview modal for this week, this month, or a custom date range. It separates direct cash sales, collected debt payments, expenses, and newly extended credit; all amounts are calculated from locally stored transactions in integer pesewas and remain available offline.

Use the header settings button to download a JSON backup of products, customers, debts, suppliers, payments, and transactions, or restore one offline. Restore merges by record ID: rows not present in the backup are kept, and a backup row is not allowed to replace a newer local row when both have `updatedAt` timestamps. The restore validates IDs, rejects duplicate records and broken debt/payment references, and applies the merge in one IndexedDB transaction.

Sales, expenses, debt payments, and validation errors can play short synthesized audio cues and optional spoken confirmations using browser APIs. Feedback works offline and can be muted from the header settings; the preference is saved on the device.

The dashboard sync badge reports network state and local transaction/debt records not marked synced. Tapping it shows local sales/debt record counts and whether browser-persistent storage is enabled; supported browsers can be asked to retain the local database if storage is low.

## Local database

Dexie schema version 11 adds a local customer index and migrates existing customers from sale and debt history without removing the app's camelCase fields; version 8 adds an optional `ghanaCardNumber` to customer and debt records, version 9 adds optional installment-plan metadata to debts, version 10 adds local payment-detail records, version 11 indexes customer IDs on debt, payment, and transaction records for customer activity statements, and version 12 adds local supplier records. Product records include `default_price`, `unit`, and `category`; transactions include `total_amount`, `payment_method`, `customer_name`, `customer_phone`, `items_json`, `timestamp`, and `synced`; debts include `customer_name`, `customer_phone`, `total_owed`, `status`, `last_reminder_date`, `created_at`, and `synced`. Installment amounts, like other monetary amounts, are integer pesewas; schedule dates are date-only `YYYY-MM-DD` strings. Installment plans support weekly (7-day), bi-weekly (14-day), and monthly (30-day) cycles, with Start Today, Start Next Cycle, and manual date selection. Start Today records the first installment as a cash or MoMo receipt, subtracts it from the outstanding debt, and schedules the next due date one cycle later; Start Next Cycle records no receipt at debt creation. These records and balance changes are atomic and update cash and credit reporting without counting the initial payment twice. Installment payments are recorded in the existing transaction history and atomically update the debt balance and schedule. Supplier purchases store total, paid, and owed pesewas in transactions; supplier balances are derived from unpaid stock purchases less supplier payments, and a later supplier payment is a cash outflow but not a second purchase cost. Supplier records are included in backups but are not yet part of the configured cloud-sync protocol. Ghana Card numbers are optional, included in JSON backups/restores, and travel with debtor records when optional cloud sync is configured. Treat backups and sync destinations containing identity data as sensitive and secure them appropriately. Debt statuses use `unpaid` and `paid`; `debt_payment` is retained as an additional transaction type for payment history, and payment method may be null when the app does not capture it. Interfaces provide compile-time guidance; IndexedDB does not enforce runtime validation. New accounts are not seeded with sample products; existing products receive safe defaults rather than being replaced.

## POS screen review build

The high-contrast POS is the only app shell; the old dashboard and its modals have been removed and no flag is needed to turn the POS on. It uses the same IndexedDB database, so existing records stay. The current review slice wires Home, Menu, Sell and its sale receipt confirmation (Screens 15 and 30), itemized sales (Screen 20), My money, Today’s transactions, debt collection/payment detail, credit sales and installment setup (Screens 17–19, 31, and 34), the spent-money/supplier flow (Screens 44–46), and item management (Screens 39–42). Other destinations in `src/pos/routes.js` are registered and render an explicit not-yet-built screen rather than a blank route.

The POS route stack is in memory: screen actions push/back, while the bottom and desktop navigation switch tabs. It uses the Dexie transactions, debts, payments, customers, suppliers, and products tables. Cash and MoMo sales open a receipt confirmation with the saved total, item details, payment method, and sale time; the receipt can be shared from the device or copied where native sharing is unavailable, and the seller can finish or start a new sale. Itemized sales let the seller search and select catalog items, set and save a missing item price, adjust quantities, and carry the exact itemized total into cash, MoMo, or credit sales. Credit-sale setup lets the seller select a saved customer or add a new person, choose a due date or installment schedule, optionally collect the first installment immediately, and save the customer, debt, payment, and sale atomically. Customer contact details can be added or edited from debtor details, credit confirmation, payment receipts, Home, and the customer history view; valid Ghana mobile numbers enable call and WhatsApp actions. Item management searches, adds, edits, and removes local products; starter-list choices are added with blank prices, prices can be entered later, and removing an item marks it inactive so synced records are retained while past sale snapshots remain unchanged. Product edits and removals are marked pending for the existing product sync protocol. A collection writes one payment and income record per cash/MoMo part and updates the debt balance atomically. Undo is available for 10 seconds, appends reversal transactions, restores the prior debt/installment state, and excludes reversed collections from current financial summaries without deleting the original history. The payment confirmation previews the approved receipt and opens a WhatsApp share link when the customer has a valid Ghana mobile number. Home, My money, and Today’s transactions read summaries through Dexie live queries and calculate them with the shared financial module in `src/utils/financials.js`, with `src/pos/money.js` adapting those totals and handling debt priority/date labels. Today’s transactions also sorts the daily feed and filters sold, spent, and credit entries without changing the source records. Supplier balances are derived from stock expenses and supplier-payment transactions; supplier payments reduce cash but are not counted as another stock purchase. Supplier records are included in backups, but the configured cloud-sync protocol has not been extended to sync them. This phase adds the version 12 supplier table while retaining existing records and cloud-sync behavior. Existing products are not deleted; the old empty-catalog seeding logic has been removed, while older upgrades still fill missing safe defaults on product records.

## Run locally

```sh
npm install
npm run dev
```

The PWA is built with `vite-plugin-pwa`; its service worker and install manifest are generated during production builds. The plugin requires Node.js 20.19 or newer. Test the installed/offline experience with `npm run build` and `npm run preview` over HTTPS or localhost.

## Optional cloud sync

Set `VITE_SYNC_ENDPOINT` to a same-origin or CORS-enabled HTTPS endpoint before building. The app sends a JSON `POST` body shaped as `{ "schemaVersion": 2, "records": { "products": [], "transactions": [], "debts": [] } }` and an `Idempotency-Key` header derived deterministically from that exact batch. Each record has a stable ID and `syncStatus: "pending"` (with a matching `synced: false` field). The server must durably accept records transactionally and treat a repeated `Idempotency-Key` as the same request, returning the original acknowledgement rather than applying records twice. This is required because the foreground page and service worker can retry or overlap after a network timeout. The server must respond with JSON containing string/number ID arrays for every table, for example `{ "acknowledged": { "products": [], "transactions": ["id"], "debts": [] } }`. Only acknowledged records that have not changed since the request are marked synced locally. Return an empty array for a table with no accepted records; rejected records remain pending for a later retry. Payment-detail records are stored locally and included in device backups; they are not sent through the current cloud-sync endpoint.

Sync reconciliation is deliberately conservative. `transactions` are append-only: an existing ID with identical content is an idempotent retry, while an existing ID with different content is a conflict and must never overwrite the original event. `products` and `debts` are mutable projections: the server must require a version/precondition for updates and quarantine divergent updates for manual review rather than using device timestamps or last-write-wins. A conflict response should include a `conflicts` array per table alongside `acknowledged`; conflicted IDs must not be acknowledged or marked synced locally. Debt balances must be resolved from their financial events and approved corrections, not by accepting an arbitrary remote materialized balance.

The app retries on connection restoration, when the page becomes visible, and periodically while open. Each sync request has a 30-second deadline so a stalled Ghana mobile-data connection does not hold the sync loop indefinitely. Failed or partially acknowledged records remain pending and are retried without blocking entry or showing sync errors. Where the browser supports Background Sync, the service worker reads and uploads the IndexedDB queue itself, even when no app page is open; the browser controls when that event runs, and failed attempts are left for its retry mechanism. Other browsers sync while the app is open. Without an endpoint, all features remain available locally and the header says data is saved on this device.

Before enabling production sync or subscription lockout, follow the rollout and release gates in `docs/PROGRESS.md`. In particular, run `npm.cmd run test:reliability`, `npm.cmd run build`, and `git diff --check`; rehearse backup restore on a separate profile; verify Paystack recovery and offline reconciliation; and complete representative Ghana SIM/network and Android device checks. Keep subscription lockout disabled until subscription state is server-authoritative and recovery monitoring is available.

## WhatsApp Business reminders

The debt ledger retains **Open WhatsApp** for a user-reviewed, prefilled message. It can also send an approved WhatsApp Business template through the Vercel function at `api/whatsapp/reminder.js`; this requires internet access, a Supabase email-link sign-in, and an authorized account. A successful API response means Meta accepted the request, not that the recipient received or read it. Obtain customer opt-in before sending reminders.

Copy `.env.example` as a reference and configure the variables in Vercel (never use `VITE_` for server secrets):

- `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` are public Supabase project settings used by the app for email-link sign-in.
- `SUPABASE_URL` and `SUPABASE_ANON_KEY` are server-side settings used by the function to validate the access token.
- `WHATSAPP_ALLOWED_USER_IDS` is a comma-separated allowlist of Supabase user UUIDs permitted to send. This is required; ordinary signed-in users are denied unless explicitly listed.
- `WHATSAPP_ACCESS_TOKEN` and `WHATSAPP_PHONE_NUMBER_ID` are the Meta WhatsApp Cloud API credentials. Keep the token only in Vercel server-side environment variables.
- `WHATSAPP_GRAPH_API_VERSION` must be set to a currently supported Meta Graph API version (format `vNN.N`).
- `WHATSAPP_DEBT_TEMPLATE` defaults to `debt_reminder`; `WHATSAPP_TEMPLATE_LANGUAGE` defaults to `en`.

Create and get approval for a WhatsApp template whose body has exactly three text parameters, in this order: customer name, outstanding balance, shop name (for example, `Hello {{1}}, your balance with {{3}} is {{2}}.`). Set the template name and language to match the approved template in Meta. Configure Supabase email authentication and add the deployed app URL to its allowed redirect URLs. Have the shop owner sign in once, copy that user's UUID from Supabase Auth, and add it to `WHATSAPP_ALLOWED_USER_IDS`. Deploy the app to Vercel with the `api/` function and required environment settings. Vite's development server does not run Vercel functions, so use the existing **Open WhatsApp** fallback during local development.

## Paystack Mobile Money subscription

Subscription UI and payment-return verification are disabled by default. Set `VITE_ENABLE_SUBSCRIPTION=true` before building to show the Settings option and enable verification. If the variable is unset or set to `false`, no subscription UI or lockout is shown, and the PWA remains fully usable for free.

Configure `PAYSTACK_SECRET_KEY` as a server-only Vercel environment variable and set `APP_URL` to the deployed HTTPS app origin. For local function testing, use Vercel's local development server and sandbox credentials stored only in an ignored `.env.local`; never put the secret in a `VITE_` variable or commit it. Hosted checkout uses Paystack's returned authorization URL, so the public key is not needed in this redirect-based integration.

The checkout offers monthly, six-month, and yearly plans. Configure the authoritative server prices in integer pesewas:

```env
SUBSCRIPTION_MONTHLY_AMOUNT_PESEWAS=1500
SUBSCRIPTION_SIX_MONTHS_AMOUNT_PESEWAS=7500
SUBSCRIPTION_YEARLY_AMOUNT_PESEWAS=15000
```

Set the matching public display values before the Vite build, also in whole pesewas and equal to the server values (`src/config/plans.js` reads them; a value that is not a whole number of pesewas falls back to the default):

```env
VITE_SUBSCRIPTION_MONTHLY_AMOUNT_PESEWAS=1500
VITE_SUBSCRIPTION_SIX_MONTHS_AMOUNT_PESEWAS=7500
VITE_SUBSCRIPTION_YEARLY_AMOUNT_PESEWAS=15000
```

`VITE_SUBSCRIPTION_TRIAL_DAYS` controls the free trial from the first app launch. Set it to `30` for one month or `0` to disable the trial. The trial start date is stored in the device's IndexedDB, so clearing site data resets the local trial.

`FEATURE_SUBSCRIPTION_LOCKOUT` in `src/config/features.js` remains `false`; users are not blocked automatically, even when the subscription UI is enabled. The recorded expiry is stored in IndexedDB and can be altered or removed by a device owner. Do not enable payment lockout until a server-verifiable offline license and a rollout policy for existing users are in place.

Local `npm run dev` also routes `/api/subscription/initiate` and `/api/subscription/verify` to the same server handlers used by Vercel. Set `PAYSTACK_SECRET_KEY` in the ignored `.env.local`; `APP_URL` defaults to `http://localhost:5173` for local callbacks. These values are read by Vite's Node-side config and are not exposed as client environment variables.
