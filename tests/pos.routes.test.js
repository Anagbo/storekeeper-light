import test from "node:test";
import assert from "node:assert/strict";
import { POS_LINKS, POS_ROUTES, backRoute, createRouteState, pushRoute, replaceRoute } from "../src/pos/routes.js";
import { posText } from "../src/pos/i18n.js";

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
  const implementedRoutes = new Set([
    "Home", "Menu", "Sell", "MyMoney", "TodaysTransactions",
    "CollectPayment", "CollectPayPart", "CollectPartByPart", "PaymentReceived", "DebtorDetail",
    "WhoOwesYou", "NewPerson", "WhenWillTheyPay", "ALittleAtATime", "CreditSaved", "SellWithItems", "SaleRecorded",
    "MyItems", "NewItem", "EditItem", "DeleteItem", "YourStarterList",
    "HowDoYouWantToSell", "WhatDoYouSell", "HowMuchIsItem", "HowManyItem",
    "PayPartByPart", "LanguageSettings", "SettingsProfitTools"
  ]);
  for (const route of knownRoutes) {
    if (!implementedRoutes.has(route)) assert.ok(posText(`planned.titles.${route}`));
  }
  assert.ok(POS_LINKS.some((link) => link.from === "CollectPayPart" && link.action === "payPartByPart" && link.to === "CollectPartByPart"));
  assert.ok(POS_LINKS.some((link) => link.from === "CollectPartByPart" && link.action === "back" && link.to === "CollectPayPart"));
  assert.ok(POS_LINKS.some((link) => link.from === "CollectPartByPart" && link.action === "received" && link.to === "PaymentReceived"));
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
    "setup.quantityMore", "setup.addToSale", "split.title", "split.saleTotal",
    "split.paidNow", "split.amountTooHigh", "split.remainingCredit",
    "split.done", "split.owe", "split.saveFailed",
    "language.title", "language.appLanguage", "language.englishOnly",
    "language.english", "language.voiceLanguage", "language.loadFailed",
    "language.saveFailed", "language.saved", "settings.title", "settings.shopName",
    "settings.shopNameRequired", "settings.saveShopName", "settings.soundFeedback",
    "settings.profitTitle", "settings.profitUnavailable", "settings.backup",
    "settings.saveFailed", "settings.saved"
  ];
  for (const key of implementedKeys) assert.ok(posText(key), `missing string: ${key}`);
  assert.equal(posText("setup.priceTitle", { name: "Rice" }), "How much is Rice?");
  assert.equal(posText("split.remainingCredit", { amount: "12.00" }), "Still to pay: 12.00");
});

test("partial debt collection routes split tender through its own screen", () => {
  assert.ok(POS_ROUTES.CollectPayPart);
  assert.ok(POS_ROUTES.CollectPartByPart);
  assert.ok(POS_LINKS.some((link) => link.from === "PayPartByPart" && link.action === "owe" && link.to === "WhoOwesYou"));
  assert.ok(POS_LINKS.some((link) => link.from === "PayPartByPart" && link.action === "done" && link.to === "SaleRecorded"));
  assert.equal(posText("collect.payPartByPart"), "Pay part by part");
  assert.equal(posText("collect.splitTitle"), "Collect: part by part");
  assert.equal(posText("collect.splitNeedsBoth"), "Enter an amount for Cash and MoMo.");
  assert.equal(posText("collect.splitMustMatch", { amount: "50.00" }), "Cash and MoMo must add up to 50.00.");
  assert.equal(posText("collect.paymentSplit", { cash: "20.00", momo: "30.00" }), "Cash 20.00 | MoMo 30.00");
  assert.equal(POS_LINKS.some((link) => link.from === "CollectPayPart" && link.action === "payPartByPart"), true);
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
  assert.ok(POS_LINKS.some((link) => link.from === "SellWithItems" && link.to === "Sell"));
  assert.equal(posText("sellItems.title"), "Sell with items");
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
  assert.equal(posText("credit.splitCashTooHigh", { amount: "50.00" }), "Cash must be less than GHS 50.00.");
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

test("Home and My money summary labels resolve", () => {
  assert.equal(posText("home.moneyIn"), "Money in");
  assert.equal(posText("home.moneySpent"), "Money spent");
  assert.equal(posText("money.back"), "Back");
  assert.equal(posText("money.moneyIn"), "Money in");
  assert.equal(posText("money.moneySpent"), "Money spent");
  assert.equal(posText("money.wantProfit"), "Want to see your profit?");
  assert.equal(posText("money.openSettings"), "Open Settings ›");
  assert.equal(posText("transactions.title"), "Today’s transactions");
  assert.equal(posText("transactions.filter.credit"), "Credit");
  assert.equal(posText("collect.creditTaken"), "Took on credit");
  assert.equal(posText("collect.creditAdded"), "Took on credit");
});
