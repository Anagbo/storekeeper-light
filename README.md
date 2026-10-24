# StoreKeeper Light

An offline-first React PWA for recording sales, expenses, and customer debts. Money is stored as integer pesewas to avoid floating-point rounding. The app keeps data in IndexedDB and can be installed from a supported mobile browser.

The dashboard shows live daily totals, a device-local editable shop name, and online/offline status. The transaction feed is virtualized and loads records in 50-item indexed cursor pages. The debt ledger loads active balances in 25-item pages. These queries use compound IndexedDB indexes and avoid loading the complete history into the UI.

Sales record the customer, phone, item, quantity, total price, and payment type. Selecting credit saves the sale and its customer debt together in one IndexedDB transaction. Voice entry recognizes common numeric and English number phrases, then fills sale or expense fields for review before saving. For example, “Afi bought 2 bags of cement for 180 GHS on credit” fills a GHS 180 sale, while “paid ten cedis for transport” fills a GHS 10 expense with “transport” as its note. When an expense phrase contains multiple likely amounts, the app avoids guessing and asks the trader to enter the amount manually; transcripts should always be reviewed before saving.

The debts ledger pages outstanding debts in descending amount order using the `[status+amountPesewas+id]` IndexedDB index. Customer names and phone numbers are saved locally and searchable by name prefix in the quick-sale form; selecting a customer fills in their phone number and shows their outstanding balance. Named sales and debt-ledger entries update the local customer list, and marking a debt paid updates its balance. WhatsApp reminders are prefilled with the saved shop name, customer's balance in GHS, and an MTN MoMo payment suggestion.

The dashboard's **View Weekly & Monthly Reports** button opens a financial overview modal for this week, this month, or a custom date range. It separates direct cash sales, collected debt payments, expenses, and newly extended credit; all amounts are calculated from locally stored transactions in integer pesewas and remain available offline.

Use the header settings button to download a JSON backup of products, customers, debts, and transactions, or restore one offline. Restore merges by record ID: matching rows are replaced by the backup copy, while rows not present in the backup are kept.

Sales, expenses, debt payments, and validation errors can play short synthesized audio cues and optional spoken confirmations using browser APIs. Feedback works offline and can be muted from the header settings; the preference is saved on the device.

The dashboard sync badge reports network state and local transaction/debt records not marked synced. Tapping it shows local sales/debt record counts and whether browser-persistent storage is enabled; supported browsers can be asked to retain the local database if storage is low.

## Local database

Dexie database version 5 adds a local customer index and migrates existing customers from sale and debt history without removing the app's camelCase fields. Product records include `default_price`, `unit`, and `category`; transactions include `total_amount`, `payment_method`, `customer_name`, `customer_phone`, `items_json`, `timestamp`, and `synced`; debts include `customer_name`, `customer_phone`, `total_owed`, `status`, `last_reminder_date`, `created_at`, and `synced`. Monetary amounts are integer pesewas in both the current app fields and these schema fields. Debt statuses use `unpaid` and `paid`; `debt_payment` is retained as an additional transaction type for payment history, and payment method may be null when the app does not capture it. Interfaces provide compile-time guidance; IndexedDB does not enforce runtime validation. On upgrade, an empty product catalog is seeded with sample cooking oil, rice, cement, and soft drinks (prices are sample GHS prices stored in pesewas). Existing products receive editable-safe defaults rather than being replaced.

## Run locally

```sh
npm install
npm run dev
```

The PWA is built with `vite-plugin-pwa`; its service worker and install manifest are generated during production builds. The plugin requires Node.js 20.19 or newer. Test the installed/offline experience with `npm run build` and `npm run preview` over HTTPS or localhost.

## Optional cloud sync

Set `VITE_SYNC_ENDPOINT` to a same-origin or CORS-enabled HTTPS endpoint before building. The app sends a JSON `POST` body shaped as `{ "schemaVersion": 2, "records": { "products": [], "transactions": [], "debts": [] } }`. Each record has a stable ID and `syncStatus: "pending"` (with a matching `synced: false` field). The server must durably accept records and respond with JSON containing string/number ID arrays for every table, for example `{ "acknowledged": { "products": [], "transactions": ["id"], "debts": [] } }`. Only acknowledged records that have not changed since the request are marked synced locally. Return an empty array for a table with no accepted records; rejected records remain pending for a later retry.

The app retries on connection restoration, when the page becomes visible, and periodically while open. Failed or partially acknowledged records remain pending and are retried without blocking entry or showing sync errors. Where the browser supports Background Sync, the service worker reads and uploads the IndexedDB queue itself, even when no app page is open; the browser controls when that event runs, and failed attempts are left for its retry mechanism. Other browsers sync while the app is open. Without an endpoint, all features remain available locally and the header says data is saved on this device.

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

Subscription UI and payment-return verification are disabled by default. Set `VITE_ENABLE_SUBSCRIPTION=true` before building to show the Settings option and enable verification. If the variable is unset or set to `false`, no subscription UI or lockout is shown, and the PWA remains fully usable for free. The Vercel functions in `api/subscription/`, Dexie schema, and modal remain in the codebase for a future launch.

Configure `PAYSTACK_SECRET_KEY` as a server-only Vercel environment variable and set `APP_URL` to the deployed HTTPS app origin. For local function testing, use Vercel's local development server and sandbox credentials stored only in an ignored `.env.local`; never put the secret in a `VITE_` variable or commit it. Hosted checkout uses Paystack's returned authorization URL, so the public key is not needed in this redirect-based integration.

`FEATURE_SUBSCRIPTION_LOCKOUT` in `src/config/features.js` remains `false`; users are not blocked automatically, even when the subscription UI is enabled. The recorded expiry is stored in IndexedDB and can be altered or removed by a device owner. Do not enable payment lockout until a server-verifiable offline license and a rollout policy for existing users are in place.

Local `npm run dev` also routes `/api/subscription/initiate` and `/api/subscription/verify` to the same server handlers used by Vercel. Set `PAYSTACK_SECRET_KEY` in the ignored `.env.local`; `APP_URL` defaults to `http://localhost:5173` for local callbacks. These values are read by Vite's Node-side config and are not exposed as client environment variables.
