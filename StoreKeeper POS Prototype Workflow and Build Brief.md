# StoreKeeper POS: Prototype Workflow and Build Brief

Prepared 1 Nov 2026. Clickable prototype: https://claude.ai/artifact/JCe5fACZHSi55HXvVGdukK. Design canvas (all screens side by side): https://claude.ai/artifact/PanFQaKvscLx5t1vBcHUNc.

## Part 1. How the prototype works

- It opens on screen 21. A bar above the phone shows the current screen number, a ‹ Previous button (history stack) and a ↺ Restart button (returns to 21).
- Every tap goes to the destination listed in this document. BACK means pop the history stack to the previous screen. Any button not listed shows the message “Not wired in this prototype”.
- Selection-only controls do nothing in the prototype (Cash/MoMo tiles, tabs, keypad digits, category chips, Yes/No, item tiles, customer tiles). In the real app they change state.
- Three things do hold state in the prototype: the two Settings switches (Show estimated profit, Track cost price), the greyed-out Done and Received buttons on screens 16 and 27 (they turn green once Cash or MoMo is tapped), and the Previous history.
- Each screen scrolls inside the phone frame. The header and bottom bar stay fixed.
- All amounts, names and dates are placeholders. The debtor Amoto, GHS 30.00, Ghana Card GHA-677777554-5 and the date 2026-11-02 come from the real app screenshots.

## Screen index

- 15 Sell
- 16 Pay part by part (split a sale)
- 17 Who owes you? (credit sale)
- 18 When will they pay?
- 19 A little at a time (installment plan)
- 20 Sell with items
- 21 How do you want to sell? (first-time setup)
- 22 Home
- 23 Menu
- 24 Today’s transactions
- 25 Collect payment (bottom sheet over Home)
- 26 Collect: pay part (number pad)
- 27 Collect: part by part (cash plus MoMo)
- 28 Payment received (with Undo)
- 29 Debtor detail (on-time state)
- 30 Sale recorded (receipt)
- 31 Credit saved
- 32 People who owe you (bottom-bar tab: Owed)
- 33 My money (week and month)
- 34 New person (credit sale)
- 35 What do you sell?
- 36 Your starter list
- 37 How much is {item}? (item price)
- 38 How many {item}? (quantity)
- 39 My items
- 40 Edit item
- 41 New item
- 42 Delete item? (confirmation)
- 43 Debtor detail (late state)
- 44 Spent money
- 45 Stock on credit
- 46 You owe suppliers
- 47 Settings: profit tools

Naming rules for the agent. Use these screen names exactly for routes, components, files, tests, analytics events and on-screen titles. The numbers are only for cross-reference.

- Route and component names are the screen name in PascalCase, for example Sell, SellWithItems, PayPartByPart, DebtorDetail, MyMoney, PeopleWhoOweYou.
- A screen with states is ONE component, not several. DebtorDetail covers screens 29 and 43 (on-time and late). MyMoney covers screens 33, 48 and 49 (default, estimated profit, profit from item costs). EditItem covers screens 40 and 50 (with and without cost price).
- Navigation labels: the bottom bar is Home, Sell, Owed. Owed opens People who owe you. The Menu row that opens screen 33 is called My money.
- In the HTML prototype every screen is a section with the id sNN, where NN is the screen number (s22 is Home, s43 is Debtor detail late). Use these to find any screen. Do not copy the markup (see How to use the prototype).

## Journeys, step by step

### A. First-run setup

1. Screen 21: choose Just numbers or With items.
2. Tap Continue › (Just numbers) and go to 22 Home.
3. Or tap With items and go to 35 (the prototype jumps straight there; the real app selects the option, then Continue goes to 35).
4. Screen 35: multi-select what the merchant sells, then Continue › to 36. Skip goes to 22. Back goes to 21.
5. Screen 36: untick items not sold, then Continue. If the merchant arrived from setup, go to 22. If they arrived from 39 (My items), return to 39. Back returns to wherever they came from.
6. Prices are blank on purpose. Each item gets a price the first time it is sold (journey C).

### B. Sell, single payment, numbers only

1. Screen 22: tap Sell (big green button or the round button in the bottom bar) and go to 15.
2. Screen 15: type the amount on the number pad, tap Cash, MoMo or Owe, then Done.
3. Done goes to 30 Receipt. Owe goes to 17 (journey E).
4. Screen 30: Send receipt opens WhatsApp (not wired). Done goes to 22. New sale goes to 15.

### C. Sell with items

1. Screen 15: tap Add items and go to 20.
2. Screen 20: tap item tiles to add them. The − and + buttons change quantity (the − becomes a bin at quantity 1). Tap the underlined quantity to go to 38 (type a larger number, Add returns to 20).
3. Tap an item with no price (Sugar shows “Set price”) and go to 37. Save price returns to 20.
4. Tap + New item and go to 41. Save returns to 20.
5. Next · GHS 13.00 goes to 15 for the payment choice. The real app should put payment choices on a dedicated step (open point).

### D. Split payment on a sale

1. Screen 15: tap Pay part by part and go to 16.
2. Screen 16: add parts with the Cash, MoMo and Owe tiles. A bar shows Left to pay. Done is disabled until the left amount is zero. In the prototype, tapping Cash or MoMo enables Done.
3. Owe goes to 17 for the credit part. Done goes to 30.

### E. Credit sale and installments

1. Screen 17 (from Owe on 15 or 16): shows a search box and the five customers who owe the most (default list). The selected customer has a tick. Next › goes to 18.
2. - New person goes to 34 (name, phone, Ghana Card using the existing field and validation, amount owed pre-filled from the sale). Next › goes to 18. Back returns to 17.
3. Screen 18: choose Today, In 1 week or In 2 weeks, then Save · Amoto owes GHS 35.00, which goes to 31. Choosing A little at a time goes to 19.
4. Screen 19: amount each time, how often (every week, every 2 weeks, every month), first payment (today or next week), next payment date. Save plan goes to 31.
5. Screen 31: Done goes to 22. See Amoto’s details › goes to 29. WhatsApp Amoto is not wired.

### F. Collect a debt

1. Screen 22 (or 32): tap the green cash icon on a debtor row and go to 25.
2. Screen 25 (bottom sheet over Home): choose Due now (default, the next installment), Pay all or Pay part. Choose Cash or MoMo. Received goes to 28. Pay part goes to 26. ✕ closes to 22. See Amoto’s details › goes to 43.
3. Screen 26: number pad for the amount. A red line shows what is Left to pay. Received goes to 28. Pay part by part goes to 27. Back goes to 25.
4. Screen 27: add parts (Cash then MoMo) until nothing is left. Received goes to 28. Back goes to 26.
5. Screen 28: shows the amount, the split and the new balance. Undo (available for a few seconds) reverses the payment and goes to 22. Send receipt opens WhatsApp. Done goes to 22. See Amoto’s details › goes to 29.

### G. Debtors

1. Screen 22 shows the most urgent debtor with a status tag (Late, Due today, In N days).
2. Tap the name on 22 and go to 43 (late version). Tap Owed in the bottom bar and go to 32.
3. Screen 32: filter tabs All, Late, Due soon. List is ordered by urgency. Each row has a green Collect icon (to 25), a WhatsApp button, and a Call button. Tapping a name goes to 43.
4. Screen 43 (late): red balance box with Late 3 days, a full-width Send reminder on WhatsApp button with Last reminder: 2 days ago, then Collect (to 25) and Call. The installment card shows 0 paid · 3 left and the missed date. Back goes to 22.
5. Screen 29 (on time, after payment): balance, Collect, WhatsApp, Call, installment progress (1 paid · 2 left), next date, history. Collect goes to 25. Back goes to 22.

### H. Spent money and suppliers

1. Screen 22: tap Spent money and go to 44.
2. Screen 44: amount, What for? (Stock first, then Transport, Rent, Utilities, Other), Paid all now? (Yes default). Save goes to 22. No goes to 45.
3. Screen 45: stock total, Paid now, Still owed (calculated), supplier picker or + New supplier, optional pay-by date. Save goes to 22. Back goes to 44.
4. Screen 46 (reached from My money): total owed to suppliers, each with a due tag, Pay and Call. Back goes to 33.

### I. Reviewing the day, week and month

1. Screen 22: tap Today’s transactions › and go to 24. Back goes to 22.
2. Screen 24: Money in, Spent, Owed boxes, tabs All, Sold, Spent, Credit, and rows with sign and tags (Sold, Cash, MoMo, Owed, Credit, Spent).
3. Screen 23 (Menu from Home): Home, Today’s transactions (24), My money (33), Items (39), Language, Settings (47). Close goes to 22.
4. Screen 33 My money: Cash left this week with the change from last week, Money in, Money spent (stock and other), Owed to you (to 32), You owe suppliers (to 46). A card Want to see your profit? with Open Settings › goes to 47.

### J. Profit tools (optional, off by default)

1. Screen 47: two switches, Show estimated profit and Track cost price of items. These toggle for real in the prototype.
2. Estimate on: screen 33 shows Estimated profit (sales minus stock minus other costs, plus a four-week average) and hides the nudge card.
3. Cost price on: screen 33 shows Profit, based on 8 of 10 items (replaces the estimate), with Add costs › to 40. Screen 40 and 41 show a Cost price field.
4. If both are on, the cost-price version wins.

### K. Manage items

1. Screen 23: Items goes to 39.
2. Screen 39: Find item, New item (to 41), item rows (to 40), Add from starter list (to 36).
3. Screen 40: edit name and price (and cost price if enabled), Save returns, Delete item goes to 42.
4. Screen 42: Keep Sugar returns to 40. Yes, delete goes to 39. Past sales are unchanged.

## Complete link map (control, destination)

- 21: Continue › → 22. With items → 35.
- 22: Menu → 23. Sell → 15. Spent money → 44. Collect icon → 25. Today’s transactions › → 24. Name Amoto → 43. Home → 22. Owed → 32.
- 23: Close → 22. Home → 22. Today’s transactions → 24. My money → 33. Items → 39. Settings → 47.
- 24: Back → 22.
- 25: ✕ → 22. Pay part → 26. Received → 28. See details › → 43.
- 26: Back → 25. Received → 28. Pay part by part → 27.
- 27: Back → 26. Received → 28 (enabled after Cash or MoMo).
- 28: Undo → 22. Done → 22. See details › → 29.
- 29: Back → 22. Collect → 25.
- 15: Done → 30. Add items → 20. Pay part by part → 16. Owe → 17. Home → 22. Sell → 15. Owed → 32.
- 16: Owe → 17. Done → 30 (enabled after Cash or MoMo).
- 17: Next › → 18. New person → 34.
- 18: A little at a time → 19. Save · … → 31.
- 19: Save plan → 31.
- 20: Next · … → 15. Sugar → 37. Quantity → 38. + New item → 41.
- 30: Done → 22. New sale → 15.
- 31: Done → 22. See details › → 29.
- 32: Home → 22. Sell → 15. Collect icon → 25. Name → 43.
- 33: Back → 22. Owed to you → 32. You owe suppliers → 46. Open Settings → 47. Add costs → 40.
- 34: Back → 17. Next › → 18.
- 35: Back → 21. Continue › → 36. Skip → 22.
- 36: Back → previous screen. Continue → 22 (from setup) or 39 (from My items).
- 37: Back → 20. Save price → 20.
- 38: Back → 20. Add → 20.
- 39: Back → 23. New item → 41. Add from starter list → 36. Item rows → 40.
- 40: Back or Save → previous screen. Delete item → 42.
- 41: Back or Save → previous screen.
- 42: Keep → previous screen. Yes, delete → 39.
- 43: Back → 22. Collect → 25.
- 44: Back → 22. No → 45. Save → 22.
- 45: Back → 44. Save → 22.
- 46: Back → 33.
- 47: Back → previous screen. Switches toggle the two flags.

## Known prototype shortcuts (not real behaviour)

- Numbers never change: keypads do not type, tabs do not filter, switches only affect screens 33 and 40.
- Every debtor name opens Amoto’s page. Every item row opens Sugar.
- After a collection, screen 22 and 32 still show the old balance.
- WhatsApp, Call, Send receipt and Pay (supplier) are not wired.
- Screen 20 Next goes to 15, because there is no separate payment step after items.
- The Menu rows Language and some Settings options are placeholders.
- The old light-theme screens (1 to 14 on the design canvas) are superseded by the high-contrast sunlight screens and are not part of this prototype.

## Part 2. Build prompt for an AI developer agent

Copy everything below this line into the agent.

### How to use the prototype (read this first)

The attached prototype and screenshots are a visual and behavioural reference only. Do not copy, embed or port its HTML.

- The prototype is static markup. Every name, amount, date, tag and total in it (for example Amoto, GHS 30.00, Late, In 5 days) is sample data written directly into the page. Its inline styles and its click handler, which finds buttons by their text, are shortcuts that exist only to make a demo.
- Build real, reusable components that render from the data model. Every name, amount, status tag, list and total must be derived from stored data. If the data changes, the screen changes. No sample values may appear in components. They belong only in test fixtures and seed data.
- Pull the look into a single theme file: colours, type sizes, spacing, radii and border widths. Build shared components such as BigButton, Tile, StatusTag, NumberPad, ListRow, Switch, BottomSheet and Dialog, and reuse them across screens.
- Replace the text-matching click handler with typed routes and explicit handlers. Each control in the link map becomes a named action.
- Design the states the prototype does not show and keep them in the same style: empty lists (no sales yet, nobody owes you), loading, errors, offline and sync-pending. Propose these and flag them for review.
- Acceptance check: searching the source code for the prototype’s sample names and amounts finds nothing outside fixtures; changing the data updates every screen; every list renders from state.

### Role and objective

You are a senior front-end and PWA engineer. Evolve the existing, working StoreKeeper codebase into an offline-first point-of-sale and debt-tracking progressive web app for micro-merchants in Ghana, many with limited reading ability and basic Android phones. The attached prototype (screens 15 to 47) is the product specification. Match its flows, labels, and behaviour. Where this brief and the prototype disagree, ask before deciding.

### Product principles (non-negotiable)

1. Selling must take about three taps. Never block a sale on setup, items, prices, customers, or cost prices.
2. Plain words and icons. No accounting terms (no “accrued”, “inflow”, “extended”). Every key button has an icon and a word. Text is at least 16px.
3. Daily headline is Cash left today (money received minus money spent). The word “profit” never appears in the default experience.
4. Profit features are optional, off by default, and always labelled as an estimate unless every item has a cost price.
5. Outdoor readability: strong outlines, high contrast, thick borders, 44px minimum tap targets (56px on primary actions).
6. Works offline. Never lose a sale. Show Saved ✓ or the number of items waiting to sync.
7. Colour is never the only signal. Status uses words (Late, Due today, In 5 days) plus colour.

### Existing codebase: migrate, reconcile and keep data consistent

StoreKeeper already works and holds real merchants’ data. Do not rewrite it from scratch. Audit first, then change it step by step.

- Step 0, audit (read only, before any change): map the existing screens, routes, components, database schema, sync and naming. Produce a mapping table: existing name, the canonical screen name from this document, and the action (keep, rename, merge, replace or add). Flag duplicates and conflicting names. Show it to me for approval before you change anything.
- Reconcile names: rename routes, components, files, database fields, translation keys and on-screen labels to the canonical names and the plain wording in this document (for example, Cash left today replaces any profit label). Keep old routes as redirects for one release.
- Database changes go through versioned, reversible migrations, never by hand. Back up before migrating. Migrations must be safe to run twice, run on the device store (IndexedDB) and on the server, and work for a device that opens the new version weeks later, so support upgrading from any earlier version.
- Data mapping: for each entity in the domain model, say whether it exists, needs new fields, or is new (installment plans, supplier payables, collections with parts, item cost, settings flags, lastReminderAt). New fields get safe defaults. No merchant may see a changed total after migration unless it was wrong before. If existing amounts are decimals or floats, convert them to integer pesewas with documented rounding and report any mismatch.
- Preserve history: past sales, debts and payments never change. Archived items keep their old name and price.
- Single source of truth: every number on every screen is computed from the ledger by one shared money module. No screen computes its own totals.
- Track data consistency: add invariant checks that run after each migration and on sync, and write a report. Do not fix silently and never auto-delete. Check at least that: split payments add up to the sale total; a debt balance equals credits minus collections; installment counts agree with the plan; no balance is negative; the totals on Home, Today’s transactions, My money, People who owe you and You owe suppliers equal the ledger; every collection and credit points to an existing customer and debt; a supplier balance equals stock owed minus payments paid; status tags (Late, Due today, In N days) are derived from dates, never stored.
- Sync: use client-generated ids so operations can be repeated safely, treat financial records as append-only, and document the conflict rule for other fields.
- Rollout: put each group of screens behind a feature flag, rehearse the migration on a copy of real data and report the differences, write a rollback plan, and keep the old screens reachable until I sign off.
- Extra deliverables: the audit mapping table, migration scripts with tests, a data-consistency report, and rollback notes.

### Suggested stack (confirm against the existing codebase before starting)

- TypeScript, React (or the framework already used), a router with one route per screen id, and a small state library.
- IndexedDB (Dexie or equivalent) as the source of truth with a queued sync layer. Service worker with precache for the app shell.
- Amounts stored as integer pesewas. Format with the en-GH locale, prefix GHS.
- i18n from day one (English now, Twi next). No hard-coded strings in components.
- System font stack (no web-font downloads). Respect the phone’s text-size setting.
- Responsive: phone layout as specified; tablet two columns; desktop with a side menu, a Home grid, and Owed as list plus detail panel; dialogs instead of bottom sheets on desktop. Keyboard support (digits, Enter, Tab order).

### Domain model

- Shop: name, settings flags (estimatedProfit, trackCost), sellMode (numbers or items), language.
- Customer: name, phone, Ghana Card (use the existing field and its existing validation), createdAt.
- Sale: id, timestamp, total, optional lines (itemId, qty, unitPrice), payments (cash, momo, credit parts that sum to total). A credit part creates or increases a Debt.
- Debt: customerId, balance, optional InstallmentPlan, history (credits and collections), lastReminderAt.
- InstallmentPlan: amountPerPayment, frequency (weekly, biweekly, monthly), startRule (today or next cycle), nextDueDate, paidCount, totalCount.
- Collection: debtId, amount, parts (cash, momo), timestamp, undoable for a short window.
- Expense: amount, category (stock, transport, rent, utilities, other), paidAmount, owedAmount, optional supplierId, optional payBy.
- Supplier and SupplierPayable: name, balance, due date. Paying a supplier reduces the payable and is not a new cost.
- Item: name, optional price, optional cost, archived flag. Deleting an item archives it; past sales keep the old name and price.

### Business rules

- Status of a debt or payable: Late if the next due date is before today, Due today if equal, otherwise In N days. A customer with no plan has one due date.
- Debtor lists order by urgency (late first, then soonest due). Screen 17 (customer picker during a sale) orders by largest debt and shows the top five when the search box is empty; typing searches all customers by name or phone.
- Money in = cash and MoMo actually received (sale payments plus debt collections). Money spent = cash actually paid out (stock paid now, other costs, and payments to suppliers). Cash left = money in minus money spent. Compare with the previous period.
- Owed to you and You owe suppliers are balances. Never subtract them from period figures.
- Estimated profit (optional) = total sales (including credit) minus stock bought (paid and on credit) minus other costs, shown with a four-week average and an Estimate tag. Supplier payments are never subtracted again, because the stock was already counted when it was bought.
- Profit from item costs (optional) counts only items that have a cost price and shows “based on X of Y items”. If both tools are on, this one replaces the estimate.
- Collect sheet default is the next installment (Due now). Collecting less than the amount due leaves the installment partly paid.
- Undo reverses a collection or sale made in the last few seconds and restores balances. Make the window a constant.
- Split payments: the parts must sum exactly to the total before Done or Received enables.
- Deleting a customer-linked record must never alter history.

### Screens and navigation

Implement every screen in the attached index with the exact control-to-destination links in Part 1 of this document. Treat BACK as returning to the real previous route, and implement “Continue from the starter list” as: return to the screen that opened it. Model navigation as an explicit route map and add a test that walks every link.

### Integrations

- WhatsApp: open https://wa.me/\<number>?text=\<encoded message> using the merchant’s existing reminder template, reused unchanged, and the receipt templates in the Decisions section below. No SMS anywhere. Record lastReminderAt when the merchant returns.
- Call: tel: links.
- Use Meta’s official WhatsApp logo asset, unmodified (the prototype uses a drawn stand-in).
- Mobile money wording: plan for MTN, Telecel and AirtelTigo as sub-options of MoMo.

### Accessibility and quality

- Semantic buttons, labels for every input, aria-label on icon-only buttons, role=switch on toggles, focus-visible outlines, dialogs trap focus.
- Confirm destructive actions (delete item) with the safe option as the largest button.
- Light high-contrast theme by default, optional dark theme. Test text contrast at WCAG AA or better.
- Performance: first load under 3 seconds on a mid-range Android on 3G, interactions under 100 ms, no layout shift.
- Tests: unit tests for all money rules, status calculation and split-payment validation; component tests for each screen; end-to-end tests for journeys A to K; offline tests for sale, collection and expense.

### Out of scope for this iteration

Inventory counts and low-stock alerts, barcode scanning, multi-user roles, weight or volume units, refunds beyond Undo, end-of-day cash close.

### Deliverables

1. The app, with a route map and a link-walk test.
2. A short architecture note (data layer, sync strategy, state flow).
3. A list of any remaining open questions. The Decisions section below settles the earlier ones.

Ask clarifying questions before starting if anything above conflicts with the existing StoreKeeper code.

### Decisions (settled answers to the audit questions)

- Three-tap selling: a plain cash sale stays at about three taps (Sell, amount, Done). The extra screens appear only for items, credit and split payments.
- Rollout: build the new screens beside the existing app behind feature flags, then replace it after sign-off. There are no old routes, so the redirect rule does not apply. Keep the old modals reachable by flag until sign-off.
- Rollback: a backup plus a tested restore. Migrations are additive and keep the old tables until sign-off.
- Sync and server: not decided. Unless a backend is named, sync stays as it is and server migration is a separate phase.
- Seeded sample products: do not seed them for new accounts (they use the starter list). Leave existing users’ products unchanged.
- Ledger corrections: explicit adjustment events with a reason, never edits. For each existing debt, create one opening-balance event equal to its current balance, and report any debt whose payments do not add up.
- Split payments and collections: each part is its own payment row, linked to one parent sale or collection by id and type, and the parts must sum to the total.
- Undo: the window is a constant of 10 seconds. Undo appends a reversal event and never deletes the original. Merchant totals ignore reversed records; the audit log keeps them.
- Stock purchases: every stock purchase uses the stock model. A supplier is required only when something is owed. A part-paid purchase creates an expense for the amount paid and a payable for the rest, linked to the supplier. Paying a supplier later reduces the payable and counts as cash paid out, but not as a new cost.
- Ghana Card: keep the existing validation exactly as it is. Do not rewrite or simplify it. Reuse it on the New person screen and anywhere the Ghana Card is entered. Keep its current required or optional behaviour and its current display format. Do not add masking.
- Reminder template: it already exists in the code. Reuse it exactly.
- Receipt template: not implemented yet. Draft it to match the tone and format of the reminder template, and show it for approval before wiring it in. Two receipts are needed: a sale receipt (screen 30, Send receipt) and a payment receipt for a collection (screen 28, Send receipt). Never include the Ghana Card number or phone numbers in a receipt. Each opens in WhatsApp for the merchant to review and send; nothing is sent automatically. Only lines that apply appear (a cash-only sale has no Owed line).
- Twi: deferred. English first, with i18n in place.
- MoMo: one tap. Record the network (MTN, Telecel or AirtelTigo) as an optional detail and preselect the last one used.
- Home shows the single most urgent debtor with a link to the full list. The customer picker (screen 17) shows five.

Proposed sale receipt (screen 30):

```text
Receipt from {shop name}
{date}, {time}
{item lines, only if the merchant sells with items}
Total: GHS {total}
Paid: {Cash GHS x, MoMo GHS y}
Owed: GHS {owed}, pay by {date}   (only if part is on credit)
Thank you!
```

Proposed payment receipt (screen 28):

```text
Payment received by {shop name}
{date}, {time}
From: {customer name}
Amount: GHS {amount} ({Cash GHS x, MoMo GHS y})
Still owed: GHS {balance}
Next payment: GHS {installment} on {date}   (only if there is an installment plan)
Thank you!
```
