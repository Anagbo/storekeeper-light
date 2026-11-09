export const POS_ROUTES = Object.freeze({
  Sell: "Sell",
  SplitPayment: "SplitPayment",
  WhoOwesYou: "WhoOwesYou",
  WhenWillTheyPay: "WhenWillTheyPay",
  ALittleAtATime: "ALittleAtATime",
  SellWithItems: "SellWithItems",
  ReviewAndPay: "ReviewAndPay",
  HowDoYouWantToSell: "HowDoYouWantToSell",
  Home: "Home",
  Menu: "Menu",
  TodaysTransactions: "TodaysTransactions",
  CollectPayment: "CollectPayment",
  CollectPayPart: "CollectPayPart",
  PaymentReceived: "PaymentReceived",
  DebtorDetail: "DebtorDetail",
  ManualDebtAmount: "ManualDebtAmount",
  ManualDebtSaved: "ManualDebtSaved",
  SaleRecorded: "SaleRecorded",
  CreditSaved: "CreditSaved",
  PeopleWhoOweYou: "PeopleWhoOweYou",
  MyMoney: "MyMoney",
  LanguageSettings: "LanguageSettings",
  NewPerson: "NewPerson",
  WhatDoYouSell: "WhatDoYouSell",
  YourStarterList: "YourStarterList",
  YourStarterListGrouped: "YourStarterListGrouped",
  MoreCategories: "MoreCategories",
  HowMuchIsItem: "HowMuchIsItem",
  HowManyItem: "HowManyItem",
  MyItems: "MyItems",
  EditItem: "EditItem",
  NewItem: "NewItem",
  DeleteItem: "DeleteItem",
  SpentMoney: "SpentMoney",
  StockOnCredit: "StockOnCredit",
  YouOweSuppliers: "YouOweSuppliers",
  SettingsProfitTools: "SettingsProfitTools"
  ,MoMoChoice: "MoMoChoice"
  ,MoMoDirect: "MoMoDirect"
  ,PaymentSettings: "PaymentSettings"
  ,MoMoSetup: "MoMoSetup"
  ,MoMoPayment: "MoMoPayment"
  ,MoMoWaiting: "MoMoWaiting"
  ,MoMoCode: "MoMoCode"
  ,MoMoNotCompleted: "MoMoNotCompleted"
  ,MyPlan: "MyPlan"
  ,PlanPayMethod: "PlanPayMethod"
  ,PlanPayCash: "PlanPayCash"
  ,PlanPayMoMo: "PlanPayMoMo"
  ,PlanPayPhone: "PlanPayPhone"
  ,PlanPaymentResult: "PlanPaymentResult"
});

export const POS_LINKS = Object.freeze([
  { from: "HowDoYouWantToSell", action: "continue", to: "Home" },
  { from: "HowDoYouWantToSell", action: "withItems", to: "WhatDoYouSell" },
  { from: "Home", action: "menu", to: "Menu" },
  { from: "Home", action: "sell", to: "Sell" },
  { from: "Home", action: "spentMoney", to: "SpentMoney" },
  { from: "Home", action: "collect", to: "CollectPayment" },
  { from: "Home", action: "transactions", to: "TodaysTransactions" },
  { from: "Home", action: "debtor", to: "DebtorDetail" },
  { from: "Home", action: "owed", to: "PeopleWhoOweYou" },
  { from: "Menu", action: "close", to: "Home" },
  { from: "Menu", action: "home", to: "Home" },
  { from: "Menu", action: "transactions", to: "TodaysTransactions" },
  { from: "Menu", action: "myMoney", to: "MyMoney" },
  { from: "Menu", action: "items", to: "MyItems" },
  { from: "Menu", action: "language", to: "LanguageSettings" },
  { from: "Menu", action: "settings", to: "SettingsProfitTools" },
  { from: "TodaysTransactions", action: "back", to: "Home" },
  { from: "CollectPayment", action: "close", to: "Home" },
  { from: "CollectPayment", action: "payPart", to: "CollectPayPart" },
  { from: "CollectPayment", action: "received", to: "PaymentReceived" },
  { from: "CollectPayment", action: "details", to: "DebtorDetail" },
  { from: "CollectPayPart", action: "back", to: "CollectPayment" },
  { from: "CollectPayPart", action: "split", to: "SplitPayment" },
  { from: "CollectPayPart", action: "received", to: "PaymentReceived" },
  { from: "SplitPayment", action: "back", to: "CollectPayPart" },
  { from: "SplitPayment", action: "received", to: "PaymentReceived" },
  { from: "PaymentReceived", action: "undo", to: "Home" },
  { from: "PaymentReceived", action: "done", to: "Home" },
  { from: "PaymentReceived", action: "details", to: "DebtorDetail" },
  { from: "DebtorDetail", action: "back", to: "Home" },
  { from: "DebtorDetail", action: "collect", to: "CollectPayment" },
  { from: "Sell", action: "done", to: "SaleRecorded" },
  { from: "Sell", action: "momo", to: "MoMoChoice" },
  { from: "Sell", action: "addItems", to: "SellWithItems" },
  { from: "Sell", action: "split", to: "SplitPayment" },
  { from: "Sell", action: "owe", to: "WhoOwesYou" },
  { from: "Sell", action: "home", to: "Home" },
  { from: "Sell", action: "owed", to: "PeopleWhoOweYou" },
  { from: "SplitPayment", action: "owe", to: "WhoOwesYou" },
  { from: "SplitPayment", action: "done", to: "SaleRecorded" },
  { from: "SplitPayment", action: "saleBack", to: "Sell" },
  { from: "WhoOwesYou", action: "next", to: "WhenWillTheyPay" },
  { from: "WhoOwesYou", action: "newPerson", to: "NewPerson" },
  { from: "WhenWillTheyPay", action: "installments", to: "ALittleAtATime" },
  { from: "WhenWillTheyPay", action: "save", to: "CreditSaved" },
  { from: "ALittleAtATime", action: "savePlan", to: "CreditSaved" },
  // In a split sale (flow=split), 18 and 19 return to the existing 16 (SAVECREDIT, SAVE19).
  { from: "WhenWillTheyPay", action: "saveSplit", to: "SplitPayment", via: "history" },
  { from: "ALittleAtATime", action: "saveSplit", to: "SplitPayment", via: "history" },
  // Split payment on 19 opens 27; Received returns to the existing 19.
  { from: "ALittleAtATime", action: "split", to: "SplitPayment" },
  { from: "SplitPayment", action: "installmentReceived", to: "ALittleAtATime", via: "history" },
  { from: "SellWithItems", action: "next", to: "ReviewAndPay" },
  { from: "SellWithItems", action: "setPrice", to: "HowMuchIsItem" },
  { from: "SellWithItems", action: "quantity", to: "HowManyItem" },
  { from: "SellWithItems", action: "newItem", to: "NewItem" },
  { from: "SaleRecorded", action: "done", to: "Home" },
  { from: "SaleRecorded", action: "newSale", to: "Sell" },
  { from: "ReviewAndPay", action: "back", to: "SellWithItems" },
  { from: "ReviewAndPay", action: "split", to: "SplitPayment" },
  { from: "ReviewAndPay", action: "owe", to: "WhoOwesYou" },
  { from: "ReviewAndPay", action: "done", to: "SaleRecorded" },
  { from: "ReviewAndPay", action: "momo", to: "MoMoChoice" },
  { from: "CreditSaved", action: "done", to: "Home" },
  { from: "CreditSaved", action: "details", to: "DebtorDetail" },
  { from: "CollectPayment", action: "momo", to: "MoMoChoice" },
  { from: "CollectPayPart", action: "momo", to: "MoMoChoice" },
  { from: "SplitPayment", action: "momo", to: "MoMoChoice" },
  { from: "PeopleWhoOweYou", action: "home", to: "Home" },
  { from: "PeopleWhoOweYou", action: "sell", to: "Sell" },
  { from: "PeopleWhoOweYou", action: "collect", to: "CollectPayment" },
  { from: "PeopleWhoOweYou", action: "debtor", to: "DebtorDetail" },
  { from: "PeopleWhoOweYou", action: "addDebtJourney", to: "WhoOwesYou" },
  { from: "WhoOwesYou", action: "nextManualDebt", to: "ManualDebtAmount" },
  { from: "ManualDebtAmount", action: "whenPay", to: "WhenWillTheyPay" },
  { from: "ManualDebtAmount", action: "saveInherited", to: "ManualDebtSaved" },
  { from: "WhenWillTheyPay", action: "saveManualDebt", to: "ManualDebtSaved" },
  { from: "ALittleAtATime", action: "saveManualDebt", to: "ManualDebtSaved" },
  { from: "ManualDebtSaved", action: "done", to: "PeopleWhoOweYou" },
  { from: "ManualDebtSaved", action: "details", to: "DebtorDetail" },
  { from: "MyMoney", action: "back", to: "Home" },
  { from: "MyMoney", action: "owedToYou", to: "PeopleWhoOweYou" },
  { from: "MyMoney", action: "suppliers", to: "YouOweSuppliers" },
  { from: "MyMoney", action: "settings", to: "SettingsProfitTools" },
  { from: "MyMoney", action: "addCosts", to: "EditItem" },
  { from: "NewPerson", action: "back", to: "WhoOwesYou" },
  { from: "NewPerson", action: "next", to: "WhenWillTheyPay" },
  { from: "WhatDoYouSell", action: "back", to: "HowDoYouWantToSell" },
  { from: "WhatDoYouSell", action: "continue", to: "YourStarterList" },
  { from: "WhatDoYouSell", action: "continueSeveral", to: "YourStarterListGrouped" },
  { from: "WhatDoYouSell", action: "moreCategories", to: "MoreCategories" },
  { from: "MoreCategories", action: "back", to: "WhatDoYouSell" },
  { from: "MoreCategories", action: "done", to: "WhatDoYouSell" },
  { from: "YourStarterListGrouped", action: "continueSetup", to: "Home" },
  { from: "WhatDoYouSell", action: "somethingElseOnly", to: "NewItem" },
  { from: "WhatDoYouSell", action: "skip", to: "Home" },
  { from: "YourStarterList", action: "continueSetup", to: "Home" },
  { from: "YourStarterList", action: "continueItems", to: "MyItems" },
  { from: "HowMuchIsItem", action: "back", to: "SellWithItems" },
  { from: "HowMuchIsItem", action: "save", to: "SellWithItems" },
  { from: "HowManyItem", action: "back", to: "SellWithItems" },
  { from: "HowManyItem", action: "add", to: "SellWithItems" },
  { from: "MyItems", action: "back", to: "Menu" },
  { from: "MyItems", action: "newItem", to: "NewItem" },
  { from: "MyItems", action: "starterList", to: "YourStarterList" },
  { from: "MyItems", action: "editItem", to: "EditItem" },
  { from: "EditItem", action: "delete", to: "DeleteItem" },
  { from: "EditItem", action: "save", to: "MyItems" },
  { from: "NewItem", action: "save", to: "MyItems" },
  { from: "DeleteItem", action: "keep", to: "EditItem" },
  { from: "DeleteItem", action: "confirm", to: "MyItems" },
  { from: "SpentMoney", action: "back", to: "Home" },
  { from: "SpentMoney", action: "stockOnCredit", to: "StockOnCredit" },
  { from: "SpentMoney", action: "save", to: "Home" },
  { from: "StockOnCredit", action: "back", to: "SpentMoney" },
  { from: "StockOnCredit", action: "save", to: "Home" },
  { from: "YouOweSuppliers", action: "back", to: "MyMoney" },
  // via: "history" = Back goes to the previous screen; `to` is the usual one.
  { from: "SettingsProfitTools", action: "back", to: "Menu", via: "history" },
  { from: "SettingsProfitTools", action: "momoPayments", to: "PaymentSettings" },
  { from: "SettingsProfitTools", action: "myPlan", to: "MyPlan" },
  { from: "LanguageSettings", action: "back", to: "Menu" },
  { from: "PaymentSettings", action: "setup", to: "MoMoSetup" },
  { from: "PaymentSettings", action: "back", to: "SettingsProfitTools" },
  { from: "MoMoChoice", action: "direct", to: "MoMoDirect" },
  // "Always: customer sends" on 63 replaces 61 with 62.
  { from: "MoMoChoice", action: "always", to: "MoMoDirect" },
  // Phone request opens 60 until the payout account is set up, then 56.
  { from: "MoMoChoice", action: "phone", to: "MoMoSetup" },
  { from: "MoMoChoice", action: "phone", to: "MoMoPayment" },
  { from: "MoMoSetup", action: "save", to: "MoMoPayment" },
  { from: "MoMoSetup", action: "saveFromSettings", to: "PaymentSettings", via: "history" },
  { from: "MoMoDirect", action: "confirmed", to: "SaleRecorded" },
  { from: "MoMoDirect", action: "collectionConfirmed", to: "PaymentReceived" },
  // A pick from 16, 27 or 19 returns to the existing screen (returnFromMomoPickState).
  { from: "MoMoDirect", action: "picked", to: "SplitPayment", via: "history" },
  { from: "MoMoDirect", action: "picked", to: "ALittleAtATime", via: "history" },
  { from: "MoMoPayment", action: "send", to: "MoMoWaiting" },
  { from: "MoMoPayment", action: "otp", to: "MoMoCode" },
  { from: "MoMoPayment", action: "direct", to: "MoMoDirect" },
  // via: "origin" = back to the screen that opened MoMo (15, 55, 16, 19, 25, 26, 27); Sell is the usual one.
  { from: "MoMoWaiting", action: "cancel", to: "Sell", via: "origin" },
  // planned: needs the Paystack backend (no charge result exists yet).
  { from: "MoMoWaiting", action: "paystackFailure", to: "MoMoNotCompleted", planned: true },
  { from: "MoMoCode", action: "submit", to: "MoMoWaiting" },
  { from: "MoMoNotCompleted", action: "retry", to: "MoMoPayment" },
  { from: "MoMoNotCompleted", action: "payAnotherWay", to: "Sell", via: "origin" },
  { from: "MoMoNotCompleted", action: "cancelSale", to: "Home" },
  { from: "MyPlan", action: "pay", to: "PlanPayMethod" },
  { from: "PlanPayMethod", action: "cash", to: "PlanPayCash" },
  { from: "PlanPayMethod", action: "momo", to: "PlanPayMoMo" },
  { from: "PlanPayMethod", action: "phone", to: "PlanPayPhone" },
  { from: "PlanPayCash", action: "submitted", to: "PlanPaymentResult" },
  { from: "PlanPayMoMo", action: "submitted", to: "PlanPaymentResult" },
  { from: "PlanPayPhone", action: "submitted", to: "PlanPaymentResult" },
  { from: "PlanPaymentResult", action: "done", to: "MyPlan" }
]);

export function createRouteState(route = POS_ROUTES.Home, params = {}) {
  return { current: route, params, history: [] };
}

export function pushRoute(state, route, params = {}) {
  return { current: route, params, history: [...state.history, { current: state.current, params: state.params }] };
}

export function replaceRoute(state, route, params = {}) {
  return { ...state, current: route, params };
}

export function backRoute(state, fallback = POS_ROUTES.Home) {
  const previous = state.history.at(-1);
  if (!previous) return createRouteState(fallback);
  return { current: previous.current, params: previous.params, history: state.history.slice(0, -1) };
}

// Return to the most recent history entry for `route` (that also matches `predicate`),
// merging `params` into it and dropping every screen opened after it. Returns null when
// there is no such entry. Used to go back to a hub (16, 19) instead of stacking a copy.
export function popToRoute(state, route, params = {}, predicate = () => true) {
  for (let index = state.history.length - 1; index >= 0; index -= 1) {
    const item = state.history[index];
    if (item.current === route && predicate(item.params ?? {})) {
      return { current: route, params: { ...item.params, ...params }, history: state.history.slice(0, index) };
    }
  }
  return null;
}

// SplitPayment is the sale hub (16) unless it is 27 opened from 19 or a collection split.
export function isSaleSplitHub(params = {}) {
  return !params.installmentSplit && !params.debtId;
}

const MOMO_FLOW_ROUTES = new Set(["MoMoChoice", "MoMoDirect", "MoMoSetup", "MoMoPayment", "MoMoWaiting", "MoMoCode", "MoMoNotCompleted"]);

// The origin is the screen that opened the MoMo flow (momoFrom): the entry just before the
// trailing run of MoMo screens. That still works when "Always" on 63 skipped 61 (K12).
// Used by 57 Cancel request (CANCELMOMO) and 59 Pay another way (PAYOTHER).
export function returnToMomoOrigin(state) {
  let originIndex = state.history.length - 1;
  while (originIndex >= 0 && MOMO_FLOW_ROUTES.has(state.history[originIndex].current)) originIndex -= 1;
  if (originIndex === state.history.length - 1 || originIndex < 0) return null;
  const origin = state.history[originIndex];
  return { current: origin.current, params: origin.params, history: state.history.slice(0, originIndex) };
}

// Pick-only flags must not leak into later screens (E4).
function withoutMomoPickFlags(params = {}) {
  const { pickOnly: _pickOnly, returnRoute: _returnRoute, ...rest } = params;
  return rest;
}

// Return from a MoMo pick (61/62) to the screen that asked for it (16, 19, 27).
export function returnFromMomoPickState(state, details = {}) {
  const target = details.returnRoute;
  if (!target) return state;
  const cleanDetails = withoutMomoPickFlags(details);
  const popped = popToRoute(state, target, cleanDetails);
  if (popped) return { ...popped, params: withoutMomoPickFlags(popped.params) };
  // Target not in history: drop the trailing MoMo screens so Back cannot reach them again.
  const history = [...state.history];
  while (history.length && MOMO_FLOW_ROUTES.has(history.at(-1).current)) history.pop();
  return { current: target, params: withoutMomoPickFlags({ ...state.params, ...cleanDetails }), history };
}
