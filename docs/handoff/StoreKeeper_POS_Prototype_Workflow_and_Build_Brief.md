# StoreKeeper POS: Prototype Workflow and Build Brief

Prepared 1 Nov 2026. Clickable prototype: https://claude.ai/artifact/JCe5fACZHSi55HXvVGdukK. Design canvas (all screens side by side): https://claude.ai/artifact/PanFQaKvscLx5t1vBcHUNc.

## Part 1. How the prototype works

- It opens on screen 21. A bar above the phone shows the current screen number, a ‹ Previous button (history stack) and a ↺ Restart button (returns to 21).
- Every tap goes to the destination listed in this document. BACK means pop the history stack to the previous screen. Any button not listed shows the message “Not wired in this prototype”.
- Selection-only controls do nothing in the prototype (Cash/MoMo tiles, tabs, keypad digits, category chips, Yes/No, item tiles, customer tiles). In the real app they change state.
- Three things do hold state in the prototype: the two Settings switches (Show estimated profit, Track cost price), the greyed-out Done and Received buttons on screens 16 and 27 (they turn green once Cash or MoMo is tapped), and the Previous history.
- Each screen scrolls inside the phone frame. The header and bottom bar stay fixed.
- All amounts, names and dates are placeholders. The debtor Amoto, GH₵30.00, Ghana Card GHA-677777554-5 and the date 2026-11-02 come from the real app screenshots.

## Screen index

- 15 Sell
- 16 Split payment (cash + MoMo + owe)
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

* 56 MoMo payment (Paystack request)
* 57 Waiting for customer
* 58 Enter the code
* 59 Payment not completed
* 60 Receive MoMo payments (setup)

- 55 Review and pay (after Sell with items)

* 54 Correct balance (sheet over Debtor detail)

- 53 How much do they owe? (add debt)

* 51 More categories (grouped chips)
* 52 Your starter list (several categories, grouped)

Naming rules for the agent. Use these screen names exactly for routes, components, files, tests, analytics events and on-screen titles. The numbers are only for cross-reference.

- Route and component names are the screen name in PascalCase, for example Sell, SellWithItems, SplitPayment, DebtorDetail, MyMoney, PeopleWhoOweYou.
- A screen with states is ONE component, not several. DebtorDetail covers screens 29 and 43 (on-time and late). MyMoney covers screens 33, 48 and 49 (default, estimated profit, profit from item costs). EditItem covers screens 40 and 50 (with and without cost price).
- Navigation labels: the bottom bar is Home, Sell, Owed. Owed opens People who owe you. The Menu row that opens screen 33 is called My money.
- In the HTML prototype every screen is a section with the id sNN, where NN is the screen number (s22 is Home, s43 is Debtor detail late). Use these to find any screen. Do not copy the markup (see How to use the prototype).

## Journeys, step by step

### A. First-run setup

1. Screen 21: choose Just numbers or With items.
2. Tap Continue › (Just numbers) and go to 22 Home.
3. Or tap With items and go to 35 (the prototype jumps straight there; the real app selects the option, then Continue goes to 35).
4. Screen 35: the merchant searches or taps the popular category tiles (multi-select). More categories › opens 51 (the rest as grouped chips; Done › returns to 35). Continue › goes to 36, or to 52 when several categories were chosen. Skip for now goes to 22. Back goes to 21.
5. Screen 36 (or 52 for several categories): the main (core) items for the chosen categories start ticked. Show more reveals the rest of the core items and extra items that start unticked. Continue · N items (N counts ticked items) or Skip, I’ll add items later: from setup go to 22; from 39 (My items) return to 39. Back returns to wherever they came from.
6. Prices are blank on purpose. Each item gets a price the first time it is sold (journey C).

### B. Sell, single payment, numbers only

1. Screen 22: tap Sell (big green button or the round button in the bottom bar) and go to 15.
2. Screen 15: type the amount on the number pad, tap Cash, MoMo or Owe, then Done.
3. Done goes to 30 Receipt. Owe goes to 17 (journey E).
4. Screen 30: Send receipt opens WhatsApp (not wired). Done goes to 22. New sale goes to 15.

### C. Sell with items

1. Screen 15: tap Add items and go to 20. Any amount already typed on 15 comes along as an Other amount line on 20.
2. Screen 20: tap item tiles to add them. The − and + buttons change quantity (the − becomes a bin at quantity 1). Tap the underlined quantity to go to 38 (type a larger number, Add returns to 20).
3. Tap an item with no price (Sugar shows “Set price”) and go to 37. Save price returns to 20.
4. Tap + New item and go to 41. Save returns to 20.
5. Next · GH₵13.00 goes to 55 (Review and pay): the Other amount and the items with quantities, the Total, How is it paid? (Cash, MoMo, Owe and the three-icon Split payment button) and Done, which goes to 30. Owe goes to 17 and Split payment to 16.

### D. Split payment on a sale

1. Screen 15: tap the three-icon button (cash + MoMo + owe, accessible name Split payment) and go to 16.
2. Screen 16: add parts with the Cash, MoMo and Owe tiles. A bar shows Left to pay. Done is disabled until the left amount is zero. In the prototype, tapping Cash or MoMo enables Done.
3. Owe goes to 17 for the credit part. Done goes to 30.

### E. Credit sale and installments

1. Screen 17 (from Owe on 15 or 16): shows a search box and the five customers who owe the most (default list). The selected customer has a tick. Next › goes to 18.
2. - New person goes to 34 (name, phone, Ghana Card using the existing field and validation, amount owed pre-filled from the sale). Next › goes to 18. Back returns to 17.
3. Screen 18: choose Today, In 1 week or In 2 weeks, then Save · Amoto owes GH₵35.00, which goes to 31. Choosing A little at a time goes to 19.
4. Screen 19: amount each time, how often (every week, every 2 weeks, every month), first payment (Today or Next cycle), amount paid today and how it is paid (only when Today is chosen), next payment date. Back goes back. Save plan goes to 31 (see 3.9).
5. Screen 31: Done goes to 22. See Amoto’s details › goes to 29. WhatsApp Amoto is not wired.

### F. Collect a debt

1. Screen 22 (or 32): tap the green cash icon on a debtor row and go to 25.
2. Screen 25 (bottom sheet over Home): choose Due now (default, the next installment), Pay all or Pay part. Choose Cash or MoMo. Received goes to 28. Pay part goes to 26. ✕ closes to 22. See Amoto’s details › goes to 43.
3. Screen 26: number pad for the amount. A red line shows what is Left to pay. Received goes to 28. the two-icon button (cash + MoMo) goes to 27. Back goes to 25.
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
- 26: Back → 25. Received → 28. two-icon button (cash + MoMo) → 27.
- 27: Back → 26. Received → 28 (enabled after Cash or MoMo).
- 28: Undo → 22. Done → 22. See details › → 29.
- 29: Back → 22. Collect → 25. + Add to debt → 53. Correct balance → 54. Edit (contact) reuses the existing edit form and validation.
- 15: Done → 30. Add items → 20. three-icon button (Split payment) → 16. Owe → 17. Home → 22. Sell → 15. Owed → 32.
- 16: Owe → 17. Done → 30 (enabled after Cash or MoMo).
- 17: Next › → 18 (in a sale), or → 53 (in the add-debt flow). New person → 34. In the add-debt flow the Owed amount banner is hidden.
- 18: A little at a time → 19. Save · … → 31.
- 19: Save plan → 31, after confirming any MoMo part (see 3.9). MoMo → 61 and back. Split payment → 27 and back.
- 20: Next · … → 55. Sugar → 37. Quantity → 38. + New item → 41.
- 30: Done → 22. New sale → 15.
- 31: Done → 22. See details › → 29.
- 32: Home → 22. Sell → 15. Collect icon → 25. Name → 43. Add debt → 17 (add-debt flow, journey L).
- 33: Back → 22. Owed to you → 32. You owe suppliers → 46. Open Settings → 47. Add costs → 40.
- 34: Back → 17. Next › → 18.
- 35: Back → 21. Continue › → 36 (52 if several categories). Skip for now → 22. More categories › → 51 (51: Back or Done › → 35).
- 36 and 52: Back → previous screen. Continue · N items or Skip → 22 (from setup) or 39 (from My items). Show more and Show all N expand a list with no navigation.
- 37: Back → 20. Save price → 20.
- 38: Back → 20. Add → 20.
- 39: Back → 23. New item → 41. Add from starter list → 36. Item rows → 40.
- 40: Back or Save → previous screen. Delete item → 42.
- 41: Back or Save → previous screen.
- 42: Keep → previous screen. Yes, delete → 39.
- 43: Back → 22. Collect → 25. + Add to debt → 53. Correct balance → 54. Edit (contact) reuses the existing edit form and validation.
- 44: Back → 22. No → 45. Save → 22.
- 45: Back → 44. Save → 22.
- 46: Back → 33.
- 47: Back → previous screen. Switches toggle the two flags.

## Known prototype shortcuts (not real behaviour)

- Numbers never change: keypads do not type, tabs do not filter, switches only affect screens 33 and 40.
- Every debtor name opens Amoto’s page. Every item row opens Sugar.
- After a collection, screen 22 and 32 still show the old balance.
- WhatsApp, Call, Send receipt and Pay (supplier) are not wired.
- Screen 20 Next goes to 55 (Review and pay), the payment step after items.
- The Menu rows Language and some Settings options are placeholders.
- The old light-theme screens (1 to 14 on the design canvas) are superseded by the high-contrast sunlight screens and are not part of this prototype.

## Part 2. Build prompt for an AI developer agent

Copy everything below this line into the agent.

### How to use the prototype (read this first)

The attached prototype and screenshots are a visual and behavioural reference only. Do not copy, embed or port its HTML.

- The prototype is static markup. Every name, amount, date, tag and total in it (for example Amoto, GH₵30.00, Late, In 5 days) is sample data written directly into the page. Its inline styles and its click handler, which finds buttons by their text, are shortcuts that exist only to make a demo.
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
- Amounts stored as integer pesewas. Format with the app's existing money formatter (en-GH, GH₵ prefix with no space, for example GH₵268.20). See 3.10.
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

- WhatsApp: open https://wa.me/\<number>?text=\<encoded message> using the merchant’s existing reminder template (wording unchanged, amounts through the money formatter), and the receipt templates in the Decisions section below. No SMS anywhere. Record lastReminderAt when the merchant returns.
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
- Reminder template: it already exists in the code. Reuse its wording and structure exactly, but format every amount through the app's money formatter (GH₵12.00, no space), as in section 3.10. This overrides the old spacing (GH₵ 12.00).
- Receipt template: not implemented yet. Draft it to match the tone and format of the reminder template, and show it for approval before wiring it in. Two receipts are needed: a sale receipt (screen 30, Send receipt) and a payment receipt for a collection (screen 28, Send receipt). Never include the Ghana Card number or phone numbers in a receipt. Each opens in WhatsApp for the merchant to review and send; nothing is sent automatically. Only lines that apply appear (a cash-only sale has no Owed line).
- Twi: deferred. English first, with i18n in place.
- MoMo: one tap. Record the network (MTN, Telecel or AirtelTigo) as an optional detail and preselect the last one used.
- Home shows the single most urgent debtor with a link to the full list. The customer picker (screen 17) shows five.

Proposed sale receipt (screen 30):

```text
Receipt from {shop name}
{date}, {time}
{item lines, only if the merchant sells with items}
Total: GH₵{total}
Paid: {Cash GH₵x, MoMo GH₵y}
Owed: GH₵{owed}, pay by {date}   (only if part is on credit)
Thank you!
```

Proposed payment receipt (screen 28):

```text
Payment received by {shop name}
{date}, {time}
From: {customer name}
Amount: GH₵{amount} ({Cash GH₵x, MoMo GH₵y})
Still owed: GH₵{balance}
Next payment: GH₵{installment} on {date}   (only if there is an installment plan)
Thank you!
```

### Starter items and screens 35, 36, 51 and 52

- Data source: the attached starter-items.json (version 2). Load it as data, not in component code. Do not add prices.
- Structure: each category has an id, name, icon, popular flag, group, a core list and a more list. Core items start ticked. More items sit behind Show more and start unticked. An entry called other (Something else) has no items.
- Screen 35 shows the popular categories first as tiles, with a search box (Find your business) that finds categories. More categories opens screen 51, which shows the rest as chips grouped by the group field. Hardware is split into four categories (Building materials, Plumbing materials, Paint and finishing, Tools and fasteners), and Electrical and wiring sits under Phones and electronics.
- Merging: combine the picked categories and remove duplicates by case-insensitive name. A name that is core in one category and more in another is treated as core.
- Something else: if it is the only category picked, skip the starter list and open New item (41). If it is picked with others, ignore it for the list.
- Screen 36 (one category, or a short combined list): core items ticked; Show more reveals the remaining core items and the more items (unticked). The button reads Continue · N items, where N counts only ticked items and updates as items are unticked. A text link, Skip, I’ll add items later, lets the merchant leave with none.
- Screen 52 (several categories): if the combined core list is longer than about 30 items, group it under small headings, one per category, each showing an item count, its first few items and a Show all N › button. The Continue button counts all ticked items across the groups.
- Search: every item, core and more, is searchable from My items → Add from starter list (39 to 36).
- Tests: the merge, the de-duplication, the core versus more rule, the Something-else-only case, and the grouping threshold.
- Attachments for the agent: starter-items.json goes with the brief and the two HTML files.

### Journey L: add a debt manually (required)

The old POS lets a merchant add a debt by hand from the Owed area. This must exist in the new app. Implement it as follows.

1. Screen 32 (People who owe you): the merchant taps Add debt, a button above the filter tabs.
2. Screen 17 (Who owes you?): the same customer picker as in a sale, with search, the five biggest debtors and New person (34). The Owed amount banner is hidden because the amount is not known yet. Next › goes to 53.
3. Screen 53 (How much do they owe?): a number pad for the amount, an optional note (What for?) and a Taken on date that defaults to today and can be changed to record an older debt. Next › goes to 18 when the person has no existing due date or plan. If they do, 53 shows the inherited terms and Next › goes to 31 (see the inheritance rule below).
4. Screen 18 (When will they pay?): Today, In 1 week, In 2 weeks, or A little at a time (19). Save goes to 31 (Saved as credit) with the new balance, and Done returns to 32.
5. Shortcut from a person: on Debtor detail (29 and 43), the + Add to debt button next to the What happened heading skips the picker and goes straight to 53. The same inheritance rule applies as in the main flow (see below). Never assign a schedule silently.

Rules for a manual debt:

- It is not a sale. Create no sale record and no item lines. It only adds a credit event to the customer’s debt.
- No cash moves. It does not change Money in, Money spent or Cash left, and it is not included in the sales used for Estimated profit. Owed to you goes up.
- The history entry reads Added to debt, with no plus or minus sign (signs appear only when cash really moves). Use Added to debt for every entry and drop Took on credit.
- The note and the Taken on date are stored on the credit event. Backdated debts must still order correctly in history and in status (Late, Due today, In N days).
- Reuse the existing add-debt validation and the existing customer and Ghana Card handling. Do not rewrite them.

### Old POS migration: required behaviour

The old POS code base is legacy. Use it only as a source of existing data, validated business rules and working integrations (Ghana Card validation, the reminder template, backup and restore, subscription controls). Do not copy its screens, flows, component structure, naming or scattered money logic.

These are explicit instructions, not suggestions:

- The Owed tab must open People who owe you (32). Tapping a person must open Debtor detail (29 or 43) for that customer, rendered from data. The old debt page must not be the destination.
- Implement journey L (add a debt manually) in full, including the + Add to debt shortcut. Do not drop the feature because it is missing from the old code path.
- Before removing any old feature, produce a parity table: each old-page feature, where it lives in the new screens, and any gap. Expected mapping: WhatsApp and Call become the reminder button and Call on Debtor detail; View Payment History becomes the What happened list; Mark as Paid becomes Collect (screen 25), because the old button actually opens a payment modal with pay all and pay part, not a simple mark as paid. Reuse the old modal’s payment validation. Due now appears only when the person has an installment plan; otherwise the options are Pay all and Pay part (26). Do not build a separate Mark as Paid action; Edit Debt and the edit-phone pencil become an Edit link on Debtor detail that reuses the existing edit form and validation; Add debt becomes journey L; Previous and Next customers paging becomes Show more or scrolling; the repeated items line (Sale, Sale, Sale) is removed or limited to the last three items; the installments remaining text becomes X paid · Y left plus the next date.
- Keep the old pages reachable behind the feature flag until I sign off the parity table. Delete old code only after sign-off.
- Where the old behaviour and this brief disagree, follow this brief and tell me about the difference.

### Inheritance rule for an added debt (settled)

- No balance, or a balance with no due date and no plan: after screen 53 show screen 18 (When will they pay?).
- Active installment plan: keep the payment amount, frequency and next due date. Add the new amount to the balance and recompute the payments left (balance divided by payment amount, rounded up). Show the result on screen 53 under the date, for example: Next payment stays 13 Nov, GH₵10 each week, 5 payments left now, with a Change link that opens 18 or 19. Next › then goes to 31.
- A single due date and no plan: keep that date and show it on screen 53 with a Change link. If the date has already passed, keep it. Adding debt must never hide or reset lateness.
- Never assign a schedule silently. The inherited terms must be visible on 53 before the merchant saves, and shown again on 31.
- Tests: each case above, lateness not reset, and the payments-left recompute.

### Edit Debt (required)

- Edit Debt on Debtor detail must not edit amounts in place. A balance correction is an adjustment event with a reason. A change of due date or plan is recorded as a plan-change event. Name and phone edits reuse the existing contact edit and validation.
- Before building it, list every field the old Edit Debt action changes and map each to one of the three kinds above.

### Correct balance (screen 54, required behaviour)

- A correction never overwrites data. It appends an adjustment event holding the previous balance, the new balance, the difference, the reason, an optional note, the timestamp and the user. The balance on screen is computed from all events. Earlier events are never changed or deleted.
- The sheet shows Now owed, and after the merchant types, a line such as This lowers the debt by GH₵10.00.
- No default reason. Save correction stays disabled until a reason is chosen. Reasons: Wrong amount entered, Customer dispute, Goods returned, Debt forgiven, Other (a short note is then required).
- One short hint only: No cash moves. Use Collect for money received.
- Validation: no negative balance, and no increase from this screen (use Add debt).
- History shows Balance corrected to GH₵X · reason, with no plus or minus sign, clearly different from payments and Added to debt.
- A correction does not change Money in, Money spent or Cash left. Owed to you changes.
- If the person has an installment plan, recompute the payments left and keep the next due date and any lateness (same rule as an added debt).
- The sheet must fit narrow phones (test at 320 and 360 pixels wide).
- If the old Edit Debt also changed the due date or plan, record those as plan-change events, never in-place edits.

### Split payment: icon buttons, word headings (screens 15, 16, 26, 27)

- The old label Pay part by part is replaced: the buttons use icons and the headings use the words Split payment. It was confusing, and on the collect screens it clashed with Pay part (paying only some of a debt).
- Screen 15: next to Add items, a button shows three icons joined by plus signs: cash + MoMo + owe. Its accessible name is Split payment. It opens screen 16.
- Screen 16: the heading is the words Split payment (a normal heading, not icons). Below it keep the Total, the parts already added, the Left to pay bar, and the Cash, MoMo and Owe tiles. Done stays disabled until the parts add up to the total.
- Screen 26: the button under Received shows two icons, cash + MoMo, and opens 27. Screen 27: the heading is also the words Split payment. Pay part (a debt payment of less than the amount owed) keeps its words.
- Code name for the component and route: SplitPayment (screens 16 and 27 share it).
- Test that the buttons have an accessible name and that screen readers announce the heading.

### Sell flow (screens 15, 20, 55)

- Selling without items, paid in cash or MoMo, stays on screen 15: type the amount, choose Cash or MoMo, then Done goes to 30 with no screen in between. Owe on 15 opens 17 (customer picker, then 18 or 19, then 31), and the Split payment icon button opens 16 (add Cash, MoMo and Owe parts, then Done goes to 30).
- Add items on 15 opens 20 and carries over any amount already typed, shown as a cart line called Other amount (From Sell) with a bin button to remove it. If nothing was typed there is no such line.
- On 20 the merchant picks items, sets missing prices (37) and quantities (38). Next · GH₵N, where N is the Other amount plus the items, goes to 55.
- Screen 55, Review and pay: lists the Other amount and the items with quantities, the Total, How is it paid? with Cash, MoMo and Owe tiles, and the three-icon Split payment button. Back goes to 20, Owe to 17, Split payment to 16, and Done to 30.
- Screen 30 lists the same lines and how the sale was paid.
- 55: Link map entry: Back → 20. Split payment → 16. Owe → 17. Done → 30.

### MoMo payment through Paystack (journey M, screens 56 to 60)

Verify every Paystack detail below against the current official Paystack documentation before building.

Flow:

- Tapping MoMo on 15, 55, 25 or 26 starts the MoMo flow for the full amount. On the split screens 16 and 27 the MoMo part is requested when the merchant taps Done or Received.
- If MoMo payments are not set up, MoMo opens 60 (Receive MoMo payments). Save and verify continues to 56. Settings has a MoMo payments row that opens 60.
- 56 MoMo payment: choose the customer’s network (MTN, Telecel, AirtelTigo; preselect the last used), check the number (prefill from the customer record), then Send request, which goes to 57 (or 58 when the charge asks for a code). Back returns to the origin. Customer already paid me directly records the MoMo part as Not verified and continues to 30 or 28.
- 57 Waiting for customer: number, network, amount and a countdown. Cancel request returns to the origin. Resend request is disabled until the wait has passed. When Paystack confirms, go to 30 (sale) or 28 (collection). Failure or timeout goes to 59. The Demo buttons exist only in the prototype.
- 58 Enter the code: Submit code returns to 57.
- 59 Payment not completed: Try again goes to 56, Pay another way returns to the origin, Cancel sale goes to 22. No sale or payment is recorded until Paystack confirms.
- Screens 30 and 28 show MoMo · verified for confirmed MoMo parts.

Integration rules:

- The Paystack secret key stays on the server. The app calls our backend, which calls Paystack.
- The backend creates the charge with the amount in pesewas, currency GHS, the customer’s phone, and the provider code (mtn, atl for AirtelTigo, vod for Telecel), with a client-generated unique reference per attempt. Handle the statuses pending, send\_otp, success and failed. When pending, wait at least 10 seconds between status checks. The webhook is the source of truth: verify its signature and also verify the transaction before recording anything.
- Never record a MoMo payment as paid until the charge is confirmed. Store the Paystack reference with the payment.
- Subaccount: screen 60 creates or updates the merchant’s Paystack subaccount (business name, settlement account, payout MoMo number). Resolve and show the account name before saving. Charges for that merchant use the subaccount code. The platform fee is set by the business, not the merchant.
- Fees: Paystack lists a per-transaction mobile money charge (1.95% in its help article; confirm on the pricing page). Decide who bears it. Screen 56 shows the fee and what the merchant receives; the figures on the prototype are placeholders.
- Settlement is on Paystack’s schedule, not instant, and the interface says so.
- Offline: a MoMo request needs the internet. Offline, explain this and offer the manual path (Not verified).
- A consistency check compares verified MoMo parts and Paystack references with the ledger, and reports differences without fixing them.
- Out of scope for now: refunds, disputes, recurring payments.

Open questions for the owner: who bears the fee; the platform fee; the settlement schedule shown to merchants; whether a Not verified manual MoMo record is allowed; the email to send to Paystack when a customer has none; the countdown length.


---

## Part 3. Change request (7 Nov 2026): two ways to take MoMo, and merchant subscription

This part adds screens 61 to 70 and changes five links. Where it disagrees with Parts 1 and 2, this part wins. Screens 56 to 60 and the Paystack rules stay as written, except for the changes listed in "What changed".

### 3.1 Research findings that drive the design

Sources are listed in 3.7. Items marked (verify) come from third-party pages and need a check against official documentation before building.

1. **Normal MoMo has no confirmation inside the app.** When a customer sends money to the merchant's own number, the only proof is a message or the wallet balance. Receiving is reported free on MTN MoMo. So this path is free, instant to the merchant's wallet, and cannot be verified by the system. (verify tariffs)
2. **Paystack is the opposite.** It confirms by itself and gives a reference, but it charges a fee (1.95% on local Ghana transactions, 2.5% on AT Money when the merchant absorbs it, per a September 2026 comparison; confirm on Paystack's pricing page) and pays out on its own schedule.
3. **Paystack status names.** Paystack's official docs show MTN and AirtelTigo (code atl) charges returning `pay_offline` (approve on the phone, then wait for the webhook or verify), and Telecel (code vod) returning `send_otp`. The brief's status list (pending, send_otp, success, failed) should add `pay_offline`. A third-party SDK reports a 180-second approval window (verify, and use it for the countdown).
4. **MoMo does not renew by itself on Paystack.** Paystack's help centre says recurring payments are not possible with the Pay with Mobile Money channel, and subscriptions need a reusable authorization, which in practice means cards. So a "push" subscription is a new approval request each cycle. It is not an automatic debit, and the interface must never say it renews by itself.
5. **Payment-method selection.** Baymard's research finds that tabbed or vertical lists both work, that the selected method must be unmistakable, that the most popular method should be preselected, and that each method's differences should be explained. It also finds that offering a second method removes a single point of failure.
6. **Low-literacy users.** Microsoft Research found text-heavy mobile interfaces unusable for first-time low-literacy users, and recommends graphics plus voice. MicroSave found many literate users could not read a 4-digit number string, and that users need to cross-check one input against another. This supports big icons, short words, large numbers shown one per line, and a later voice option.
7. **E-Levy.** Several 2026 sources say the 1% E-Levy was abolished on 2 April 2025; other pages still list a levy. Do not show any levy in the app until confirmed.

### 3.2 Design strategy: one MoMo tile, then one clear choice

- **Keep the single MoMo tile** on screens 15, 55, 25 and 26. Merchants already learned it, and the 3-tap rule holds. The choice appears after it, on new screen 61.
- **Two big choices, plain words, icon plus words:** Customer sends to my number (free, you check the message) and Phone request (customer approves on their phone, confirmed by itself, fee shown). Each tile states its cost and its confirmation, because that is the real difference.
- **Preselect the last used method**, labelled Last used (Baymard default rule). A merchant who always uses one can set Always in Settings (screen 63) and skip 61 entirely, so the extra tap disappears.
- **Never block a sale on setup.** The old rule sent a first MoMo tap to the Paystack setup screen. Now Direct works at once; Phone request alone asks for setup (60).
- **Two honest receipt labels:** MoMo · verified (Paystack confirmed) and MoMo · you confirmed (the merchant checked). They replace Not verified, which sounds like a fault. Reports can filter by either.
- **Direct path safety:** show the amount, number and name large; tell the merchant to check the amount and the name in the network message and check the MoMo balance, not only the SMS (spoofed SMS is a common scam) before tapping Money received. Open question: whether to also offer a reference code the customer types (cannot be enforced on a normal transfer).
- **Failure path:** on 59 (Payment not completed), offer Customer sends to my number alongside Try again, so a network outage never loses the sale.

### 3.3 Subscription design (merchant pays StoreKeeper)

Three methods, in the same order and wording style as 3.2, on screen 65:

| Method | Merchant does | Who confirms | Result screen |
|---|---|---|---|
| Cash | Gives cash to a StoreKeeper agent; shows a 6-digit code (66) | The agent enters the code | 70 Waiting to confirm, then paid |
| Mobile money | Sends to StoreKeeper's number, writes their shop phone as reference, types the code from the message (67) | Admin matches the code | 70, then paid |
| Phone request | Picks network, confirms own number, approves on phone (68, then 57 to 59 reused) | Paystack | 69 Plan paid |

Rules:
- A merchant can never mark cash or direct MoMo as paid themselves. Those stay Waiting to confirm until an agent or admin confirms. This needs an agent and admin tool, which is out of scope and flagged below.
- Plan status uses words plus colour (Active · 12 days left, Due today, Late), derived from dates, never stored.
- Proposed lapse rule (owner to decide): selling and records never stop; after a grace period only optional tools (items, profit tools) pause. The prototype shows "Your sales and records stay safe if a payment is late."
- Phone request renewals are a new request each month. Reminder 3 days before, with the three methods. Do not promise auto-renew.
- Append-only: each plan payment is a ledger event with method, amount, reference, status and confirmedBy. Reversal is an event, never a delete.
- Subscription payments are StoreKeeper's income, not the merchant's expense. They must not change Cash left.

### 3.4 What changed

- 15, 55, 25, 26, 16 and 27: MoMo now opens 61, not 56 or 60.
- 47 Settings: MoMo payments now opens 63. New row My plan opens 64.
- 60 is reached only through Phone request.
- 56: keep the existing "Customer already paid me directly" button for now. It now duplicates 62. Recommend removing it after sign-off.
- New components: MoMoChoice (61), MoMoDirect (62), PaymentSettings (63), MyPlan (64), PlanPayMethod (65), PlanPayCash (66), PlanPayMoMo (67), PlanPayPhone (68), PlanPaymentResult (69 and 70, one component with states).

### 3.5 New link map

- 61: Back → BACK. Customer sends to my number → 62. Phone request → 60 if not set up (then 56), else 56.
- 62: Back → BACK. Money received → 30 for a sale or 28 for a collection. Copy number is a local action.
- 63: Back and Save → BACK. Phone request: set up › → 60. The three When I tap MoMo options select a value.
- 64: Back → BACK. Pay now → 65.
- 65: Back → BACK. Cash → 66. Mobile money → 67. Phone request → 68.
- 66 and 67: Back → BACK. I gave the cash and I sent it → 70.
- 68: Back → BACK. Send request → 57 (reuse) and then 69 on confirmation, 59 on failure.
- 69 and 70: Done → 64.

### 3.6 Open questions for the owner

1. Who bears the Paystack fee, for customer payments and for subscriptions?
2. Is a platform-started monthly approval request allowed by Paystack for MoMo, given that MoMo is not recurring? Ask Paystack before promising a push renewal.
3. Who are the agents, how do they confirm cash, and how fast must admin confirm direct MoMo?
4. StoreKeeper's receiving number or MoMo Pay merchant ID, and whether GhQR is offered.
5. Lapse rule and grace period.
6. Plan price, billing period (weekly, monthly), and annual discount.
7. Is Not verified retired in favour of MoMo · you confirmed?
8. Add the Paystack statuses `pay_offline` to 3.1 item 3 handling, and confirm the countdown length.

### 3.7 Sources

- Paystack docs, Payment Channels (mobile money, provider codes, pay_offline and send_otp): https://paystack.com/docs/payments/payment-channels/
- Paystack docs, Charge API: https://paystack.com/docs/api/charge/
- Paystack help centre, no recurring payments with the mobile money channel: https://support2.paystack.com/hc/en-us/articles/360012174020-Pay-with-Mobile-Money
- Mobile money authorizations not reusable (third party, verify): https://www.mctaba.com/learn/paystack/paystack-subscriptions-and-recurring-billing-complete-guide
- Paystack fees and 180-second window (third party, verify): https://www.maxmegroup.com/learn/paystack-vs-hubtel-vs-expresspay and https://github.com/nanafox/paystack_sdk/pull/50
- Ghana MoMo fees and E-Levy status (third party, verify): https://banksinghana.com/mobile-money-ghana and https://momocalc.com/ghana/mtn-momo-fees
- Baymard, payment method selection: https://baymard.com/blog/payment-method-selection
- Medhi Thies et al., low-literacy mobile interfaces: https://www.microsoft.com/en-us/research/?p=161317
- MicroSave, Mobile Wallet Design for Oral Users: https://www.microsave.net/wp-content/uploads/2017/05/Mobile_Wallet_Design_for_Oral_Users.pdf

### 3.8 Split payments: the draft-sale hub (supersedes Journey D and the 16, 18, 19 and 31 links where they differ)

Problem found: on 16, Owe went 17 → 18 → 19 → 31 and ended there, so Cash and MoMo parts already entered were lost and the MoMo request never ran. "Today" on 19 also read like "pay now".

Rules:
1. **Draft sale.** Screen 16 edits a draft (the SplitPayment component). Nothing reaches the ledger until Done. Screens 17, 18, 19, 56 to 62 only fill in one part and return to 16. Flag: `flow=split`, set by Owe on 16, cleared on arriving at 22, 15 or 30.
2. **One row per mode** (Cash, MoMo, Owe), so at most three rows. Tapping Cash puts the whole Left to pay into it. Tapping MoMo first asks how much (the box shows Left to pay and can be lowered), and that amount goes to 61 and 62, so the customer is asked for exactly that amount. Tapping a row's amount edits it. A MoMo row the merchant confirmed on 62 can be lowered, and the saved record shows the lower amount together with the amount that was confirmed. Raising it above the confirmed amount sends only the extra to 62 to be confirmed again. A second MoMo tap grows the existing MoMo row (one row per mode). A MoMo row paid by phone request cannot be edited or removed. Owe is never typed: it always equals Left to pay, so the parts cannot fail to add up. Each other row has a remove button (✕).
3. **Row status in words.** MoMo shows its method (you confirm, or phone request). Owe shows the person and the terms (for example Amoto · GH₵2.50 a week · first due today).
4. **MoMo method is chosen when the part is added** (tile → how much → 61 → 62 → back to 16), not at Done.
5. **Owe needs a person and terms.** Save on 18 or 19 returns to 16 when `flow=split`, with 17, 18 and 19 removed from history so Back from 16 goes to 15 or 55. A person with an existing plan or due date shows the inherited terms (Journey L rule) before returning.
6. **Done runs in this order:** parts sum to the total; confirm the MoMo part (Direct: 62; Phone request: 56 then 57); commit once as a single local transaction (sale, one payment row per part, credit event, plan); go to 30. Money that moves outside the phone happens last, so a failure never leaves a half-saved sale.
7. **Screen 31 is skipped in a split sale.** Screen 30 lists every part, including Owed GH₵x, pay by date. A pure Owe sale from 15 still ends on 31.
8. **Failures keep the draft.** If the request fails (59): nothing is saved; Try again re-requests; Pay another way edits only the MoMo part; Cancel sale discards the draft. Offline: Phone request is disabled, Direct MoMo and Cash still work.
10. **Collections (27)** use the same pattern with Cash and MoMo only. Whatever is not collected stays in the existing balance. It is not new credit.
11. **Undo.** A Paystack-verified MoMo part cannot be reversed (refunds are out of scope). After a sale or collection with such a part, Undo is hidden, or the button says the MoMo part cannot be undone here. Cash, direct MoMo and credit parts can be reversed as before.
13. **Draft survives a trip to Settings.** The split screen keeps its parts in the route parameters, so Menu → Settings → Back restores the draft. The header Home still discards it (a guard is a later product decision). After a MoMo pick returns, the pending MoMo values are removed from the parameters so an old amount can never come back.
12. **Accessibility.** Done must drop aria-disabled when it enables (the old prototype logic left it on). Each row has an accessible name, and the Left to pay change is announced.

Tests: parts always sum to the total; Owe equals Left; all three modes together; Owe plus Phone request with a failure leaves no sale and no debt; Pay another way keeps the Owe part; Back from 16 returns to the origin; pure credit still ends on 31; installment count is ceil(owed / amount); an existing plan is inherited; offline disables Phone request; Undo is blocked after a verified MoMo part.

Open question: when the customer pays more than the total in Cash (change due), is change recorded? Out of scope here. Ask before adding.


### 3.9 Installment plan with a payment today (screen 19)

This documents what the live app already does and how it joins the new MoMo flow. Keep the existing behaviour. Do not remove or simplify it.

Order of fields on 19: How much each time? (Maximum: the amount owed), How often? (Every week, Every 2 weeks, Every month), First payment (**Today** or **Next cycle (Every week | Every 2 weeks | Every month)**), **Amount paid today** (Maximum today: the amount owed), Next payment date, **How is it paid?** (Cash, MoMo, Cash + MoMo), then Back and Save plan.

Rules:
1. **First payment = Today** shows Amount paid today and How is it paid?. **Next cycle** hides both, and the amount paid today counts as 0.
2. **Next payment date** is prefilled with one cycle after today and can be edited. It must be after today.
3. **Save plan stays disabled** until: each time is above 0 and not above its maximum; amount paid today (if shown) is not above its maximum; a method is chosen when amount paid today is above 0; the date is valid.
4. **Methods.** Cash needs nothing more. MoMo opens 61 with the pick flag; the chosen method (you confirm, or phone request) is shown on the button and you return to 19. Cash + MoMo opens 27 and returns to 19 with the parts.
5. **Save plan** confirms the MoMo part first (Direct: 62; Phone request: 56 then 57, 60 for setup, 61 if the method is not chosen yet), then commits **once**: the debt (or the sale's credit), the plan, and the collection of the amount paid today. Then go to 31. If the request fails go to 59. Nothing is saved and you stay on 19.
6. **Ledger.** The debt is created, the plan is saved (amount, frequency, next date), and a payment is recorded against the debt with its parts (Cash, MoMo · verified or MoMo · you confirmed). The balance is derived: owed minus paid.
7. **Inside a split sale (flow=split)** the payment section is hidden, because the Cash and MoMo parts on 16 already cover today. Today then only means due today. This is how the live app works and is decided. This is how the live app works today (confirmed by the owner). Keep it.
8. **Paying the full amount today settles the debt (decided; matches the live app).** If Amount paid today equals the amount owed, record the debt and the payment, save no plan, and the balance becomes 0. No schedule, next payment date or reminder is created. Keep the live app's behaviour for the other fields and the screen shown afterwards, and report what it does. Do not block this case.

### 3.10 Currency display (applies to every screen and message)

- Money is shown as **GH₵** followed directly by the amount, with no space: GH₵268.20. Labels read "Price (GH₵)" and "All amounts in GH₵".
- Use the app's existing money formatter everywhere: screens, receipts, WhatsApp messages, reports, exports and toasts. Do not write a second formatter and do not hard-code the symbol or the letters in components.
- The letters **GHS** appear only as the ISO currency parameter in API calls (for example the Paystack charge).
- Tests: a check that fails if a component or message template contains the letters GHS or a hard-coded GH₵ outside the formatter, the API client and test fixtures. Open question: CSV and backup exports, which may need the ISO code. Ask before changing them.


### 3.11 My money (33): calmer layout and estimated profit

Problems found on the live screen: "Cash left" used the wrong word (Money in includes MoMo), a drop vs last week showed inside a green card, "Category breakdown unavailable" showed as text, the profit nudge pointed to Settings switches that did not exist, and four colour blocks competed for attention.

Rules:
1. One strong green block "Money left this week" with one calm comparison line.
2. Money in and Money spent side by side with breakdowns; no error text when a breakdown is missing.
3. Estimated profit (version A) = Sales − stock − other costs for the period, tagged "Estimate", with the sum shown underneath. Credit sales count when sold. Shown by default, hide switch in Settings. Item-level profit is a later version that needs item cost prices.
4. Owed to you and You owe suppliers as white tiles with a coloured left edge and a clear link.
5. Amounts through formatGhs; the last-week comparison is checked for unit errors.

Tests: the heading says "Money left"; no "Category breakdown unavailable" text; profit equals sales − stock − other for a known set of transactions; a credit sale is counted once; with the switch off the profit card is hidden and no nudge shows.


### 3.12 Large-amount confirmation

Problem found: a cash sale of GH₵1,000,065.00 (a typing slip) was accepted with no warning and distorted the week totals and the comparison on My money.

Rules:
1. A sale above the limit asks "This sale is GH₵{amount}. Is the amount right?" with **Change amount** and **Yes, save**. Focus starts on Change amount.
2. The limit is configurable (VITE_LARGE_AMOUNT_CONFIRM_PESEWAS, default 100000 pesewas = GH₵1,000.00). Exactly the limit does not ask. A bad value uses the default.
3. It applies to the sale total on 15, 55 and 16 (split), including credit sales and plans from 19. It opens before the save starts, so the save attempt key and the double-tap guards are unaffected. It works offline.
4. Change amount returns to the same screen with every entry kept. Yes, save continues the normal save.
5. Collections, spent money and manual debts are a later extension (owner decision).

Tests: exactly the limit saves with no dialog; one pesewa above asks; Change amount keeps the draft and saves nothing; Yes, save saves once; a split and a credit sale above the limit ask once; a bad setting uses the default; the dialog is announced; no dialog when the amount is below the limit.

6. **MoMo amounts.** A MoMo amount above the limit asks "This MoMo payment is GH₵{amount}. Is the amount right?" before it goes to 61 (MoMo tile on 15 and 55, Save in the How much MoMo? editor on 16 and 27 including 27 from 19, and the payment-today MoMo choice on 19), so the customer is never asked to pay a wrong large amount. It does not ask again on 62. A split asks once for the MoMo part, and once at Done for the sale total only if the total is above the limit.
7. **Not covered yet:** collections (including MoMo collections outside the split screen), spent money, manual debts, and the legacy QuickSaleModal on the old Dashboard.

### 3.13 Settings (47) and Backup and restore (71): cleaner layout

Why: Settings was a pile of separate boxes with mixed styles (tick boxes, two buttons for the plan, a button cut off at the bottom). Backup and restore was an old dark pop-up with emoji, an orange button and a second copy of the sound switch.

1. Settings is four groups. Each group is one white card with a small heading: Shop, Preferences, Payments and plan, Your records.
2. Rows inside a card are separated by a thin line. Switches, not tick boxes. One helper line under each switch.
3. My plan is one row with the status in words and a green Active tag. The separate "View subscription" button is removed; Claude Code checks where it went and keeps that content reachable from screen 64.
4. Shop name: the field has Save beside it, disabled until the name changes.
5. Backup and restore is a normal screen (71) opened from Settings, with Back. Two cards: Save a backup (green) and Restore from a backup (outlined). Restore asks for confirmation first. No sound switch, no emoji, no orange.
6. No change to how backup and restore work. Only the screens around them change.
7. Fonts, sizes and colours follow the rest of the POS (same header, same Back button, green #03543F).
