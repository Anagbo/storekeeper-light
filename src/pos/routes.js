import { applyMomoPick, getCarriedPaymentParts, getInitialPaymentParts } from "./paymentAmount.js";
import { toPesewas } from "../lib/money.js";
import { isLockedMomoRow } from "./splitTender.js";

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
  ,BackupRestore: "BackupRestore"
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
  // Close menu goes back to the screen the menu was opened from, draft intact (wiring 23: BACK).
  { from: "Menu", action: "close", to: "Home", via: "history" },
  { from: "Menu", action: "home", to: "Home" },
  { from: "Menu", action: "transactions", to: "TodaysTransactions" },
  { from: "Menu", action: "myMoney", to: "MyMoney" },
  { from: "Menu", action: "items", to: "MyItems" },
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
  { from: "SettingsProfitTools", action: "backup", to: "BackupRestore" },
  { from: "BackupRestore", action: "back", to: "SettingsProfitTools", via: "history" },
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

// The bottom bar shows only on 15 (Sell), 22 (Home), 25 (Home behind the Collect sheet) and 32
// (Owed), as the wiring file's bottom_bar flags say. Every other screen hides it so a tap on
// Home or Owed cannot lose a draft mid-flow. The side menu stays on wide screens.
export const BOTTOM_BAR_ROUTES = [POS_ROUTES.Home, POS_ROUTES.Sell, POS_ROUTES.CollectPayment, POS_ROUTES.PeopleWhoOweYou];

export function showsBottomBar(route) {
  return BOTTOM_BAR_ROUTES.includes(route);
}

// The menu adds one history entry however often it is shown (wiring 23). Showing it again while
// it is already below the current screen (for example from Settings) returns to that entry and
// drops what was opened since; showing it while it is open closes it.
export function openMenuState(state) {
  if (state.current === POS_ROUTES.Menu) return closeMenuState(state);
  return popToRoute(state, POS_ROUTES.Menu) ?? pushRoute(state, POS_ROUTES.Menu, {});
}

// Close menu: back to the screen the menu was opened from, with its params as they were (not
// Home, which would drop a draft). Nothing to go back to means Home.
export function closeMenuState(state) {
  if (state.current !== POS_ROUTES.Menu) return state;
  return backRoute(state);
}

export function backRoute(state, fallback = POS_ROUTES.Home) {
  const previous = state.history.at(-1);
  if (!previous) return createRouteState(fallback);
  // Wiring 16 (11 Nov 2026): Back from 16 to 15 (or to 55, MOMO16) keeps the split draft (parts, and the Owe customer
  // and terms) in 15's route params, so Split payment can reopen it. Received MoMo never gets here:
  // Back with a locked row asks first and Leave goes to an empty 15 (PosApp backFromScreen).
  let params = (previous.current === POS_ROUTES.Sell || previous.current === POS_ROUTES.ReviewAndPay) && isSaleSplitHubScreen(state)
    ? { ...previous.params, splitDraft: getSplitDraft(state.params) }
    : previous.params;
  // Wiring 27 (12 Nov 2026): Back from 27 opened from 19 keeps the Cash and MoMo parts in 19's
  // route params; Split payment on 19 reopens them while Amount paid today is unchanged.
  if (previous.current === POS_ROUTES.ALittleAtATime && state.current === POS_ROUTES.SplitPayment && state.params?.installmentSplit) {
    params = { ...params, installmentSplitDraft: getInstallmentSplitDraft(state.params) };
  }
  // Wiring 27 (12 Nov 2026, same fix as 19): Back from 27 opened from 26 (collect split) keeps the
  // Cash and MoMo parts in 26's route params; Split payment on 26 reopens them while the amount is
  // unchanged.
  if (previous.current === POS_ROUTES.CollectPayPart && state.current === POS_ROUTES.SplitPayment && isCollectSplit(state.params ?? {})) {
    params = { ...params, collectSplitDraft: getCollectSplitDraft(state.params) };
  }
  params = keepDraftOnBack(state, params);
  return { current: previous.current, params, history: state.history.slice(0, -1) };
}

// The parts on 27 opened from 19, with the amount they split. Nothing typed: no draft.
function getInstallmentSplitDraft(params = {}) {
  const splitParts = Array.isArray(params.splitParts) ? params.splitParts : [];
  if (!splitParts.length || !Number.isSafeInteger(params.splitTotalPesewas)) return undefined;
  return { totalPesewas: params.splitTotalPesewas, splitParts };
}

// The parts on 27 opened from 26, with the amount they split (a MoMo part just picked on 61 is
// one of them). Nothing added: no draft.
function getCollectSplitDraft(params = {}) {
  const totalPesewas = toPesewas(params.amount ?? "");
  if (!Number.isSafeInteger(totalPesewas) || totalPesewas <= 0) return undefined;
  const splitParts = getInitialPaymentParts({ ...params, splitTotalPesewas: totalPesewas }, totalPesewas);
  if (!splitParts.length) return undefined;
  return { totalPesewas, splitParts };
}

// draft_survives_trip_away (decided 12 Nov 2026): what each screen keeps in its route params while
// the owner types or chooses. Back from the screen hands these to the screen below (keptDrafts), and
// opening the same screen again in the same task puts them back (navigateState). A fresh stack (Home,
// a tab, a result screen, Leave) has no keptDrafts, so a new task starts empty.
export const KEPT_ON_BACK = Object.freeze({
  [POS_ROUTES.NewPerson]: ["newPersonName", "newPersonPhone", "newPersonGhanaCard", "newPersonAmount"],
  [POS_ROUTES.WhenWillTheyPay]: ["creditDueChoice"],
  [POS_ROUTES.MoMoSetup]: ["payoutNetwork", "payoutNumber"],
  [POS_ROUTES.MoMoPayment]: ["requestNetwork", "requestPhone"],
  [POS_ROUTES.ManualDebtAmount]: ["amountDigits", "note", "takenOn"],
  [POS_ROUTES.StockOnCredit]: ["stockPaidNow", "stockSupplierId", "stockNewSupplier", "stockSupplierName", "stockSupplierPhone", "stockPayBy"],
  [POS_ROUTES.ALittleAtATime]: ["installmentAmount", "frequency", "startToday", "nextDueDate", "todayPaymentAmount", "paymentMethod", "momoMethod", "installmentSplitDraft"]
});

// The same task: the same amount and customer, the same kind of flow. A different customer or
// amount starts the screen empty, as 16 does when the total changed.
function draftTaskKey(params = {}) {
  const customer = params.customer?.nameLower ?? params.customer?.name?.trim().toLowerCase() ?? null;
  return JSON.stringify([params.amountPesewas ?? null, customer, params.flow ?? null, Boolean(params.manualDebt), params.initialPaymentPesewas ?? null]);
}

function pickDraft(route, params = {}) {
  const draft = {};
  for (const key of KEPT_ON_BACK[route] ?? []) if (params[key] !== undefined) draft[key] = params[key];
  // 19's own MoMo choice once received is locked and never travels in a kept draft (Back from 19
  // with it asks first and Leave drops the draft).
  if (route === POS_ROUTES.ALittleAtATime && draft.paymentMethod === "momo" && isLockedMomoRow({ paymentMethod: "momo", verification: params.verification })) {
    delete draft.paymentMethod;
    delete draft.momoMethod;
  }
  return draft;
}

function keepDraftOnBack(state, previousParams = {}) {
  const leaving = state.params ?? {};
  const kept = { ...(previousParams.keptDrafts ?? {}), ...(leaving.keptDrafts ?? {}) };
  if (KEPT_ON_BACK[state.current]) {
    const draft = pickDraft(state.current, leaving);
    if (Object.keys(draft).length) kept[state.current] = { key: draftTaskKey(leaving), draft };
    else delete kept[state.current];
  }
  if (!Object.keys(kept).length) return previousParams;
  return { ...previousParams, keptDrafts: kept };
}

// Opening a screen again in the same task: its kept draft comes back into its params. The kept drafts
// are looked up in the new params, or on the screen it is opened from (63 opens 60 with no params).
export function withKeptDraft(route, params = {}, fromParams = {}) {
  const kept = (params.keptDrafts ?? fromParams?.keptDrafts)?.[route];
  if (!kept || kept.key !== draftTaskKey(params)) return params;
  return { ...params, ...kept.draft };
}

// 16's params as a draft 15 can hand back: no MoMo pick leftovers and no one-shot commit flag.
function getSplitDraft(params = {}) {
  const { commitNow: _commitNow, splitDraft: _splitDraft, ...rest } = withoutPendingMomoValues(withoutMomoPickFlags(params));
  return rest;
}

// 15 or 55 > Split payment: reopen the kept draft when its total still matches the amount;
// otherwise 16 starts again with the new total. baseParams (55 passes its own) never carry the
// kept draft itself into 16.
export function getSplitPaymentParams(sourceParams = {}, amountPesewas, saleItems, baseParams = {}) {
  const { splitDraft: _kept, ...base } = baseParams;
  const draft = sourceParams.splitDraft;
  if (draft && draft.amountPesewas === amountPesewas) return { ...base, ...draft, amountPesewas, saleItems };
  return { ...base, amountPesewas, saleItems };
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

// SplitPayment as 27 for a debt collection (not 27 opened from 19).
export function isCollectSplit(params = {}) {
  return Boolean(params.debtId) && !params.installmentSplit;
}

// MoMo money already received (locked MoMo parts) held by one screen's draft: the split on 16 or
// 27, or today's payment on 19 (the parts back from 27, or 19's own MoMo choice).
export function getReceivedMomoOnScreen(entry = {}) {
  const params = entry.params ?? {};
  const lockedTotal = (parts) => parts.filter(isLockedMomoRow).reduce((total, part) => total + part.amountPesewas, 0);
  if (entry.current === POS_ROUTES.ALittleAtATime) {
    const single = params.paymentMethod === "momo" && isLockedMomoRow({ paymentMethod: "momo", verification: params.verification }) &&
      Number.isSafeInteger(params.momoConfirmedPesewas) ? params.momoConfirmedPesewas : 0;
    // Parts kept from 27 after Back (wiring 27): a received MoMo part there stays locked and asks too.
    const keptSplit = Array.isArray(params.installmentSplitDraft?.splitParts) ? params.installmentSplitDraft.splitParts : [];
    return lockedTotal(getCarriedPaymentParts(params)) + single + lockedTotal(keptSplit);
  }
  // Parts kept on 26 after Back from 27 (collect split): a received MoMo part there asks too.
  if (entry.current === POS_ROUTES.CollectPayPart) {
    return lockedTotal(Array.isArray(params.collectSplitDraft?.splitParts) ? params.collectSplitDraft.splitParts : []);
  }
  if (entry.current !== POS_ROUTES.SplitPayment || params.installmentSplit) return 0;
  return lockedTotal(Array.isArray(params.splitParts) ? params.splitParts : []);
}

// Wiring 16 / MOMO16 (11 Nov 2026): MoMo money already received held in a draft (16, 27), whether
// that screen is the current one or below it. Leaving the draft with it asks first. The most recent
// screen holding it counts (a later screen may carry the same parts).
export function getReceivedMomoInDraft(state) {
  const entries = [...(state.history ?? []), { current: state.current, params: state.params }];
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const amount = getReceivedMomoOnScreen(entries[index]);
    if (amount > 0) return amount;
  }
  return 0;
}

export function isSaleSplitHubScreen(state) {
  return state.current === POS_ROUTES.SplitPayment && isSaleSplitHub(state.params ?? {});
}

// Back (on-screen or phone) from a screen holding received MoMo leaves its draft: it asks first, and
// Leave drops the whole draft. Returns where Leave goes (a sale starts again on an empty 15, a
// collection goes Home), or null when Back is an ordinary Back.
export function getLeaveOnBackRoute(state) {
  // 19 in flow=split only carries 16's parts: Back returns to the draft on 16, it does not leave it.
  if (state.current === POS_ROUTES.ALittleAtATime && state.params?.flow === "split") return null;
  if (getReceivedMomoOnScreen(state) <= 0) return null;
  if (isSaleSplitHubScreen(state)) return POS_ROUTES.Sell;
  // 19 in a sale (15 > Owe) starts again on an empty 15; 19 for a debt added by hand goes Home.
  if (state.current === POS_ROUTES.ALittleAtATime && !state.params?.manualDebt) return POS_ROUTES.Sell;
  return POS_ROUTES.Home;
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
  // Wiring 15: back on 15, pending MoMo values are removed so an old amount can never come back.
  const params = origin.current === POS_ROUTES.Sell ? withoutPendingMomoValues(withoutMomoPickFlags(origin.params)) : origin.params;
  return { current: origin.current, params, history: state.history.slice(0, originIndex) };
}

// Pick-only flags must not leak into later screens (E4).
function withoutMomoPickFlags(params = {}) {
  const { pickOnly: _pickOnly, returnRoute: _returnRoute, confirmAtDone: _confirmAtDone, ...rest } = params;
  return rest;
}

// The values a MoMo pick leaves behind. On 16 and 27 they are merged into splitParts and removed;
// 19 keeps its own (it shows the chosen method on its button).
function withoutPendingMomoValues(params = {}) {
  const { pendingMomoAmountPesewas: _pending, momoRowAmountPesewas: _rowAmount, momoMethod: _method, verification: _verification, reference: _reference, ...rest } = params;
  return rest;
}

// Return from a MoMo pick (61/62) to the screen that asked for it (16, 19, 27).
export function returnFromMomoPickState(state, details = {}) {
  const target = details.returnRoute;
  if (!target) return state;
  const isSplitHub = target === POS_ROUTES.SplitPayment;
  const settle = (params) => (isSplitHub ? withoutPendingMomoValues(withoutMomoPickFlags(params)) : withoutMomoPickFlags(params));
  const cleanDetails = isSplitHub
    ? { ...settle(details), splitParts: applyMomoPick(details) }
    : withoutMomoPickFlags(details);
  const popped = popToRoute(state, target, cleanDetails);
  if (popped) return { ...popped, params: settle(popped.params) };
  // Target not in history: drop the trailing MoMo screens so Back cannot reach them again.
  const history = [...state.history];
  while (history.length && MOMO_FLOW_ROUTES.has(history.at(-1).current)) history.pop();
  return { current: target, params: settle({ ...state.params, ...cleanDetails }), history };
}

// Screens that show a finished save. Opening one starts a fresh stack, so Back (on-screen or the
// phone's) can never return into the sale, debt or collection that was just saved.
export const RESULT_ROUTES = Object.freeze([POS_ROUTES.SaleRecorded, POS_ROUTES.CreditSaved, POS_ROUTES.PaymentReceived, POS_ROUTES.ManualDebtSaved]);

// One in-app navigation (PosApp navigate): Home resets, Menu adds one entry at most, a result screen
// starts a fresh stack, anything else is pushed.
export function navigateState(state, route, params = {}) {
  if (route === POS_ROUTES.Home) return createRouteState(POS_ROUTES.Home);
  if (route === POS_ROUTES.Menu) return openMenuState(state);
  if (RESULT_ROUTES.includes(route)) return createRouteState(route, params);
  return pushRoute(state, route, withKeptDraft(route, params, state.params));
}

// Screens whose on-screen Back (or Close) goes to Home rather than one step back.
const BACK_TO_HOME = new Set([POS_ROUTES.CollectPayment, POS_ROUTES.TodaysTransactions, POS_ROUTES.PeopleWhoOweYou]);

// The phone's back button: exactly what the screen's own Back does (the BACK rule). Nothing behind
// a screen other than Home means Home.
export function phoneBackState(state) {
  if (BACK_TO_HOME.has(state.current)) return createRouteState(POS_ROUTES.Home);
  if (state.current === POS_ROUTES.Menu) return closeMenuState(state);
  return backRoute(state);
}
