import { readFileSync } from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";
import { POS_LINKS, POS_ROUTES, backRoute, createRouteState, pushRoute, replaceRoute } from "../src/pos/routes.js";
import { posText } from "../src/pos/i18n.js";
import { builtRoutes } from "./helpers/builtRoutes.js";

test("every declared route is reachable from Home or first-run setup", () => {
  const knownRoutes = new Set(Object.values(POS_ROUTES));
  assert.equal(knownRoutes.size, Object.keys(POS_ROUTES).length);

  for (const link of POS_LINKS) {
    assert.ok(knownRoutes.has(link.from), `unknown source route: ${link.from}`);
    assert.ok(knownRoutes.has(link.to), `unknown destination route: ${link.to}`);
  }

  const reachable = new Set(["Home", "HowDoYouWantToSell"]);
  const queue = [...reachable];
  while (queue.length) {
    const current = queue.shift();
    for (const link of POS_LINKS) {
      if (link.from === current && !reachable.has(link.to)) {
        reachable.add(link.to);
        queue.push(link.to);
      }
    }
  }

  assert.deepEqual([...knownRoutes].filter((route) => !reachable.has(route)), []);
  // The screens PosApp really renders, read from its render chain (not a hand-written list).
  const implementedRoutes = builtRoutes();
  assert.deepEqual([...knownRoutes].filter((route) => !implementedRoutes.has(route)), [], "every route has a built screen");
  for (const route of knownRoutes) {
    if (!implementedRoutes.has(route)) assert.ok(posText(`planned.titles.${route}`));
  }
  assert.ok(POS_LINKS.some((link) => link.from === "CollectPayPart" && link.action === "split" && link.to === "SplitPayment"));
  assert.ok(POS_LINKS.some((link) => link.from === "SplitPayment" && link.action === "back" && link.to === "CollectPayPart"));
  assert.ok(POS_LINKS.some((link) => link.from === "SplitPayment" && link.action === "received" && link.to === "PaymentReceived"));
});

test("implemented setup, split payment and settings screens have complete copy", () => {
  const implementedKeys = [
    "setup.sellTitle", "setup.sellHint", "setup.byAmount", "setup.withItems",
    "setup.amountMode", "setup.amountModeHint", "setup.itemsMode",
    "setup.itemsModeHint", "setup.laterHint", "setup.continue",
    "setup.loadFailed",
    "setup.itemsTitle", "setup.itemsHint", "setup.skip",
    "setup.continueItems", "setup.finish", "setup.saveFailed",
    "setup.priceTitle", "setup.quantityTitle", "setup.quantityLess",
    "setup.quantityMore", "setup.addQuantity", "split.title", "split.saleTotal",
    "split.paidNow", "split.amountTooHigh", "split.remainingCredit",
    "split.done", "split.owe", "split.saveFailed",
    "language.title", "language.appLanguage", "language.englishOnly",
    "language.english", "language.voiceLanguage", "language.loadFailed",
    "language.saveFailed", "language.saved", "settings.title", "settings.shopName",
    "settings.shopNameRequired", "settings.saveShopName", "settings.soundFeedback",
    "settings.subscriptionTitle", "settings.subscriptionActive", "settings.subscriptionInactive",
    "settings.subscriptionExpires", "settings.manageSubscription", "settings.subscribe",
    "settings.subscriptionTrial",
    "settings.backup",
    "settings.saveFailed", "settings.saved"
  ];
  for (const key of implementedKeys) assert.ok(posText(key), `missing string: ${key}`);
  assert.equal(posText("setup.priceTitle", { name: "Rice" }), "How much is Rice?");
  assert.equal(posText("split.remainingCredit", { amount: "12.00" }), "Still to pay: 12.00");
});

test("sale and collection split tender share the SplitPayment route", () => {
  assert.ok(POS_ROUTES.CollectPayPart);
  assert.ok(POS_ROUTES.SplitPayment);
  assert.equal(POS_ROUTES.PayPartByPart, undefined);
  assert.equal(POS_ROUTES.CollectPartByPart, undefined);
  assert.ok(POS_LINKS.some((link) => link.from === "Sell" && link.action === "split" && link.to === "SplitPayment"));
  assert.ok(POS_LINKS.some((link) => link.from === "SplitPayment" && link.action === "owe" && link.to === "WhoOwesYou"));
  assert.ok(POS_LINKS.some((link) => link.from === "SplitPayment" && link.action === "done" && link.to === "SaleRecorded"));
  assert.equal(posText("split.title"), "Split payment");
  assert.equal(posText("sell.split"), "Split payment");
  assert.equal(posText("collect.paymentSplit", { cash: "20.00", momo: "30.00" }), "Cash 20.00 | MoMo 30.00");
});

test("collection split MoMo handoff preserves the canonical split total", () => {
  const source = readFileSync(new URL("../src/pos/DebtCollection.jsx", import.meta.url), "utf8");
  assert.match(source, /onMoMo=\{\(parts, pendingMomoAmountPesewas\) => onNavigate\("MoMoChoice", \{\s*\.\.\.params,\s*splitTotalPesewas: totalPesewas,\s*splitParts: parts/s);
});

test("item management routes connect from Menu through save, delete and starter-list flows", () => {
  assert.ok(POS_LINKS.some((link) => link.from === "Menu" && link.to === "MyItems"));
  assert.ok(POS_LINKS.some((link) => link.from === "MyItems" && link.to === "NewItem"));
  assert.ok(POS_LINKS.some((link) => link.from === "MyItems" && link.to === "EditItem"));
  assert.ok(POS_LINKS.some((link) => link.from === "EditItem" && link.to === "DeleteItem"));
  assert.ok(POS_LINKS.some((link) => link.from === "MyItems" && link.to === "YourStarterList"));
});

test("itemized sales route from Sell into a selectable item cart", () => {
  assert.ok(POS_LINKS.some((link) => link.from === "Sell" && link.to === "SellWithItems"));
  assert.ok(POS_LINKS.some((link) => link.from === "SellWithItems" && link.to === "NewItem"));
  assert.ok(POS_LINKS.some((link) => link.from === "SellWithItems" && link.to === "ReviewAndPay"));
  assert.ok(POS_LINKS.some((link) => link.from === "ReviewAndPay" && link.action === "back" && link.to === "SellWithItems"));
  assert.ok(POS_LINKS.some((link) => link.from === "ReviewAndPay" && link.action === "split" && link.to === "SplitPayment"));
  assert.ok(POS_LINKS.some((link) => link.from === "ReviewAndPay" && link.action === "owe" && link.to === "WhoOwesYou"));
  assert.ok(POS_LINKS.some((link) => link.from === "ReviewAndPay" && link.action === "done" && link.to === "SaleRecorded"));
  assert.equal(posText("sellItems.title"), "Sell with items");
  assert.equal(posText("review.title"), "Review and pay");
});

test("completed cash and MoMo sales open the implemented receipt screen", () => {
  assert.ok(POS_LINKS.some((link) => link.from === "Sell" && link.action === "done" && link.to === "SaleRecorded"));
  assert.ok(POS_LINKS.some((link) => link.from === "SaleRecorded" && link.action === "done" && link.to === "Home"));
  assert.ok(POS_LINKS.some((link) => link.from === "SaleRecorded" && link.action === "newSale" && link.to === "Sell"));
  assert.equal(posText("saleRecorded.title"), "Sale recorded");
});

test("credit sale route links and screen copy are available", () => {
  const creditRoutes = new Set(["WhoOwesYou", "NewPerson", "WhenWillTheyPay", "ALittleAtATime", "CreditSaved"]);
  for (const route of creditRoutes) {
    assert.ok(Object.values(POS_ROUTES).includes(route));
    assert.ok(posText(`planned.titles.${route}`));
  }
  assert.ok(POS_LINKS.some((link) => link.from === "Sell" && link.to === "WhoOwesYou"));
  assert.ok(POS_LINKS.some((link) => link.from === "WhoOwesYou" && link.to === "WhenWillTheyPay"));
  assert.ok(POS_LINKS.some((link) => link.from === "WhenWillTheyPay" && link.to === "ALittleAtATime"));
  assert.equal(posText("credit.whoOwes"), "Who owes you?");
  assert.equal(posText("credit.savePlan"), "Save plan");
  assert.equal(posText("credit.done"), "Done");
  assert.equal(posText("credit.firstPaymentMethod"), "How is it paid?");
  assert.equal(posText("credit.method.both"), "Both");
  assert.equal(posText("credit.method.owe"), "Owe");
  // The amount is passed already formatted (formatGhs); the string no longer hard-codes the symbol.
  assert.equal(posText("credit.splitCashTooHigh", { amount: "GH₵50.00" }), "Cash must be less than GH₵50.00.");
});

test("credit saved forwards the contact-save callback to its editor", () => {
  const source = readFileSync(new URL("../src/pos/CreditScreens.jsx", import.meta.url), "utf8");
  assert.match(source, /CreditScreens\(\{[^}]*onSaveCustomerContact[^}]*\}/s);
  assert.match(source, /route === "CreditSaved"[\s\S]*onSaveCustomerContact=\{onSaveCustomerContact\}/);
  assert.match(source, /result\?\.initialPaymentPesewas > 0/);
  assert.match(source, /t\("credit\.paymentRecorded"\)/);
  assert.match(source, /t\("credit\.paymentRecordedTotal"\)/);
  assert.match(source, /whatsappLink \? \(/);
  assert.match(source, /receiptLink \? \(/);
  assert.match(source, /onClick=\{openContactEditor\}/);
  assert.match(source, /useLiveQuery\(async \(\) =>/);
  assert.match(source, /db\.customers\.where\("nameLower"\)/);
});

test("screen 19 split payment keeps split as the selected payment method", () => {
  const source = readFileSync(new URL("../src/pos/CreditScreens.jsx", import.meta.url), "utf8");
  assert.match(source, /onNavigate\("SplitPayment", \{\s*\.\.\.params,\s*paymentMethod: "split",\s*installmentSplit: true/s);
  assert.match(source, /const initialPaymentParts = paymentAlreadyMadeToday[\s\S]*?carriedPaymentParts[\s\S]*?startToday && paymentMethod === "split"[\s\S]*?\.\.\.splitParts/);
});

test("screen 19 locks Today and preserves Cash, MoMo and Owe from a Sell split", () => {
  const source = readFileSync(new URL("../src/pos/CreditScreens.jsx", import.meta.url), "utf8");
  const saleSplitSource = readFileSync(new URL("../src/pos/SaleSplitPayment.jsx", import.meta.url), "utf8");

  assert.match(source, /paymentAlreadyMadeToday/);
  assert.match(source, /getPaidPaymentPesewas\(carriedPaymentParts\)/);
  assert.match(source, /disabled=\{paymentAlreadyMadeToday \|\| alreadyPaidPesewas > 0\}/);
  assert.match(source, /paymentAlreadyMadeToday\s*\n\s*\? carriedPaymentParts/);
  assert.match(source, /startToday && !paymentAlreadyMadeToday/);
  assert.match(saleSplitSource, /paymentAlreadyMadeToday: getPaidPaymentPesewas\(parts\) > 0/);
  assert.match(saleSplitSource, /initialPaymentPesewas: getPaidPaymentPesewas\(parts\)/);
});

test("screen 19 Today and Next cycle controls only toggle local payment state", () => {
  const source = readFileSync(new URL("../src/pos/CreditScreens.jsx", import.meta.url), "utf8");
  const screenSource = source.slice(source.indexOf("function ALittleAtATime"), source.indexOf("function CreditSaved"));
  const todayButton = screenSource.match(/<button[\s\S]*?t\("credit\.today"\)[\s\S]*?<\/button>/)?.[0] ?? "";
  const nextCycleButton = screenSource.match(/<button[\s\S]*?t\("credit\.nextCycle"[\s\S]*?<\/button>/)?.[0] ?? "";

  assert.doesNotMatch(todayButton, /onNavigate/);
  assert.doesNotMatch(nextCycleButton, /onNavigate/);
  assert.match(todayButton, /setStartToday\(true\)/);
  assert.match(nextCycleButton, /setStartToday\(false\)/);
});

test("MoMo screens 56 and 57 match the prototype layout contract", () => {
  const source = readFileSync(new URL("../src/pos/MoMoScreens.jsx", import.meta.url), "utf8");
  const paymentSource = source.slice(source.indexOf("export function MoMoPayment"), source.indexOf("export function MoMoWaiting"));
  const waitingSource = source.slice(source.indexOf("export function MoMoWaiting"), source.indexOf("export function MoMoCode"));

  assert.match(paymentSource, /Customer pays/);
  assert.match(paymentSource, /You receive/);
  assert.match(paymentSource, /Customer[&']apos;s network|Customer's network/);
  assert.match(paymentSource, /aria-label=\{`Network \$\{item\}`\}/);
  assert.match(paymentSource, /Customer[&']apos;s MoMo number|Customer's MoMo number/);
  assert.match(paymentSource, /Customer already paid me directly/);
  assert.match(paymentSource, /<Smartphone size=\{24\} aria-hidden="true" \/>Send request/);
  assert.match(waitingSource, /Clock3/);
  assert.match(waitingSource, /We sent a request to/);
  assert.match(waitingSource, /Expires in/);
  assert.match(waitingSource, /Resend request/);
  assert.match(waitingSource, /Cancel request/);
  assert.doesNotMatch(waitingSource, /Demo: approved|Demo: declined/);
});

test("route state preserves parameters on push and returns to them on back", () => {
  const initial = createRouteState(POS_ROUTES.Home);
  const withDebtor = pushRoute(initial, POS_ROUTES.DebtorDetail, { customerName: "A customer" });
  const withCollection = pushRoute(withDebtor, POS_ROUTES.CollectPayment, { debtId: "debt-1" });

  assert.equal(backRoute(withCollection).current, POS_ROUTES.DebtorDetail);
  assert.deepEqual(backRoute(withCollection).params, { customerName: "A customer" });
  assert.deepEqual(backRoute(withCollection).history, [{ current: "Home", params: {} }]);
  assert.equal(replaceRoute(withDebtor, POS_ROUTES.Home).history.length, 1);
});

test("debtor details return to the originating screen instead of resetting to Home", () => {
  const source = readFileSync(new URL("../src/pos/PosApp.jsx", import.meta.url), "utf8");
  const detailBlock = source.match(/route === POS_ROUTES\.DebtorDetail \? \(([\s\S]*?)\) : route === POS_ROUTES\.PeopleWhoOweYou/);
  assert.ok(detailBlock, "DebtorDetail route block should exist");
  assert.match(detailBlock[1], /onBack=\{navigateBack\}/);
  assert.doesNotMatch(detailBlock[1], /switchTab\(POS_ROUTES\.Home\)/);
});

test("Home and My money summary labels resolve", () => {
  assert.equal(posText("home.cashLeftToday"), "Money left today"); // 22 headings (owner, Batch 14)
  assert.equal(posText("home.moneyIn"), "Money in");
  assert.equal(posText("home.moneySpent"), "Spent");
  assert.equal(posText("money.back"), "Back");
  assert.equal(posText("money.moneyIn"), "Money in");
  assert.equal(posText("money.moneySpent"), "Money spent");
  assert.equal(posText("money.wantProfit"), "Want to see your profit?");
  assert.equal(posText("money.openSettings"), "Open Settings ›");
  assert.equal(posText("transactions.title"), "Today’s transactions");
  assert.equal(posText("transactions.filter.credit"), "Credit");
  assert.equal(posText("collect.creditTaken"), "Added to debt");
  assert.equal(posText("collect.creditAdded"), "Added to debt");
});
