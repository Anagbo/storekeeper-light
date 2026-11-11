import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { recordCashSale } from "../db/sales.js";
import { setPreference, shouldShowPosSetup } from "../db/preferences.js";
import { useSync } from "../hooks/useSync.js";
import { useSubscription } from "../hooks/useSubscription.js";
import { FEATURE_FLAGS } from "../config/features.js";
import { formatGhs } from "../lib/money.js";
import { requestBackgroundSync } from "../lib/syncRegistration.js";
import {
  backRoute,
  createRouteState,
  isSaleSplitHub,
  popToRoute,
  POS_ROUTES,
  pushRoute,
  replaceRoute,
  returnFromMomoPickState,
  returnToMomoOrigin,
  showsBottomBar,
  closeMenuState,
  navigateState,
  openMenuState,
  phoneBackState
} from "./routes.js";
import { createBrowserBack } from "./browserBack.js";
import Home from "./Home.jsx";
import Menu from "./Menu.jsx";
import MyMoney from "./MyMoney.jsx";
import TodaysTransactions from "./TodaysTransactions.jsx";
import { posText as t } from "./i18n.js";
import { spentSavedNotice, stockSavedNotice } from "./expenseNotice.js";
import { PosBottomNav, PosHeader, PosPage, PosSideNav } from "./PosComponents.jsx";
import PlannedScreen from "./PlannedScreen.jsx";
import PosErrorBoundary from "./PosErrorBoundary.jsx";
import CreditScreens from "./CreditScreens.jsx";
import Sell from "./Sell.jsx";
import { POS_THEME } from "./theme.js";
import { SpentMoney, StockOnCredit, YouOweSuppliers } from "./SupplierScreens.jsx";
import ItemScreens from "./ItemScreens.jsx";
import SellWithItems from "./SellWithItems.jsx";
import SaleRecorded from "./SaleRecorded.jsx";
import SaleSplitPayment from "./SaleSplitPayment.jsx";
import ReviewAndPay from "./ReviewAndPay.jsx";
import InstallmentSplitPayment from "./InstallmentSplitPayment.jsx";
import { HowDoYouWantToSell, HowManyItem, HowMuchIsItem, MoreCategories, WhatDoYouSell } from "./SetupScreens.jsx";
import BackupRestore from "./BackupRestore.jsx";
import { SettingsProfitTools } from "./SettingsScreens.jsx";
import PeopleWhoOweYou from "./OwedScreens.jsx";
import { ManualDebtAmount, ManualDebtSaved } from "./ManualDebtScreens.jsx";
import { MoMoChoice, MoMoCode, MoMoDirect, MoMoNotCompleted, MoMoPayment, MoMoSetup, MoMoWaiting, PaymentSettings } from "./MoMoScreens.jsx";
import { MyPlan, PlanPayCash, PlanPayMethod, PlanPayMoMo, PlanPayPhone, PlanPaymentResult } from "./PlanScreens.jsx";

const CollectPayment = lazy(() => import("./DebtCollection.jsx").then((module) => ({ default: module.CollectPayment })));
const CollectPayPart = lazy(() => import("./DebtCollection.jsx").then((module) => ({ default: module.CollectPayPart })));
const CollectSplitPayment = lazy(() => import("./DebtCollection.jsx").then((module) => ({ default: module.CollectSplitPayment })));
const DebtorDetail = lazy(() => import("./DebtCollection.jsx").then((module) => ({ default: module.DebtorDetail })));
const PaymentReceived = lazy(() => import("./DebtCollection.jsx").then((module) => ({ default: module.PaymentReceived })));

// What was really saved, or "" when no name was ever saved (Settings then shows My shop as a placeholder).
function getRawSavedShopName() {
  try {
    return localStorage.getItem("storekeeper-shop-name") || "";
  } catch {
    return "";
  }
}

function getSavedShopName() {
  try {
    return localStorage.getItem("storekeeper-shop-name") || t("app.defaultShopName");
  } catch (error) {
    console.warn("The saved shop name could not be read.", error);
    return t("app.defaultShopName");
  }
}

function getStatusLabel(sync) {
  if (sync.status === "offline") return t("app.offline");
  if (sync.status === "syncing") return t("app.syncing");
  if (sync.status === "unconfigured") return t("app.saved");
  if (sync.lastSyncedAt) {
    const time = sync.lastSyncedAt.toLocaleTimeString("en-GH", { hour: "2-digit", minute: "2-digit" });
    return t("app.syncedAt", { time });
  }
  return t("app.readyToSync");
}

export default function PosApp() {
  const [routeState, setRouteState] = useState(() => createRouteState());
  // The in-app stack, read synchronously by the phone's back button (two quick presses in a row).
  const routeRef = useRef(routeState);
  const browserBackRef = useRef(null);

  // Every route change goes through here so the browser history stays in step (browserBack.js).
  function commit(update) {
    const next = typeof update === "function" ? update(routeRef.current) : update;
    if (next === routeRef.current) return;
    routeRef.current = next;
    setRouteState(next);
    browserBackRef.current?.sync(next);
  }

  // The phone's back button and the browser / swipe back: the same as the on-screen Back.
  useEffect(() => {
    if (typeof window === "undefined" || !window.history) return undefined;
    const controller = createBrowserBack({
      history: window.history,
      getState: () => routeRef.current,
      goBack: () => {
        commit(phoneBackState);
        setNotice("");
      }
    });
    browserBackRef.current = controller;
    controller.sync();
    const onPopState = (event) => controller.onPopState(event);
    window.addEventListener("popstate", onPopState);
    return () => {
      window.removeEventListener("popstate", onPopState);
      controller.dispose();
      browserBackRef.current = null;
    };
  }, []);
  const [shopName, setShopName] = useState(getSavedShopName);
  const [savedShopName, setSavedShopName] = useState(getRawSavedShopName);
  const [setupCategories, setSetupCategories] = useState([]);
  const [setupReady, setSetupReady] = useState(false);
  const [notice, setNotice] = useState("");
  const sync = useSync();
  const {
    subscriptionExpiry,
    hasActiveSubscription,
    trialActive,
    trialExpiry
  } = useSubscription();

  useEffect(() => {
    let active = true;
    shouldShowPosSetup()
      .then((showSetup) => {
        if (active && showSetup) commit(createRouteState(POS_ROUTES.HowDoYouWantToSell));
      })
      .catch((error) => console.error("Could not check first-run setup.", error))
      .finally(() => { if (active) setSetupReady(true); });
    return () => { active = false; };
  }, []);

  function navigate(route, params = {}) {
    if (!Object.values(POS_ROUTES).includes(route)) {
      throw new Error(`Unknown POS route: ${route}`);
    }
    if (route === POS_ROUTES.Menu) {
      openMenu();
      return;
    }
    // Home resets, a result screen (sale saved…) starts a fresh stack, anything else is pushed.
    commit((current) => navigateState(current, route, params));
    setNotice("");
  }

  function switchTab(route) {
    if (!Object.values(POS_ROUTES).includes(route)) {
      throw new Error(`Unknown POS route: ${route}`);
    }
    // Wiring 15: the Sell tab pressed on 15 itself is not a different tab; the draft stays.
    commit((current) => (route === POS_ROUTES.Sell && current.current === POS_ROUTES.Sell ? current : createRouteState(route)));
    setNotice("");
  }

  function navigateBack() {
    commit((current) => backRoute(current));
    setNotice("");
  }

  function returnToItemList() {
    commit((current) => {
      let itemListIndex = -1;
      for (let index = current.history.length - 1; index >= 0; index -= 1) {
        if (current.history[index].current === POS_ROUTES.MyItems) {
          itemListIndex = index;
          break;
        }
      }
      if (itemListIndex < 0) return createRouteState(POS_ROUTES.MyItems);
      return {
        ...current.history[itemListIndex],
        history: current.history.slice(0, itemListIndex)
      };
    });
  }

  function updateCurrentParams(params) {
    commit((current) => replaceRoute(current, current.current, { ...current.params, ...params }));
  }

  function replaceCurrentRoute(route, params = {}) {
    commit((current) => replaceRoute(current, route, params));
    setNotice("");
  }

  function returnFromMomoPick(details) {
    if (!details.returnRoute) return;
    commit((current) => returnFromMomoPickState(current, details));
  }

  // Go back to an existing hub screen (16, 19) instead of stacking a copy (K4, E3).
  // If it is not in history, open it as before.
  function returnTo(route, params = {}, predicate) {
    commit((current) => popToRoute(current, route, params, predicate) ?? pushRoute(current, route, params));
    setNotice("");
  }

  // 57 Cancel request and 59 Pay another way: back to the screen that opened MoMo (K9, K10).
  function returnToOrigin() {
    commit((current) => returnToMomoOrigin(current) ?? backRoute(current));
    setNotice("");
  }

  async function completePosSetup() {
    await setPreference("posSetupCompleted", true);
    switchTab(POS_ROUTES.Home);
  }

  // One history entry however often the menu is shown; opening it while it is open closes it.
  function openMenu() {
    commit((current) => openMenuState(current));
    setNotice("");
  }

  // Close menu: back to the screen it was opened from, with its draft (not Home).
  function closeMenu() {
    commit((current) => closeMenuState(current));
    setNotice("");
  }

  // D11: attemptId comes from the screen (useSaveAttempt) and is passed to every writer.
  async function saveDebtCollection(debtId, parts, attemptId) {
    const { recordDebtCollection } = await import("../db/debts.js");
    const result = await recordDebtCollection({ debtId, parts, attemptId });
    void requestBackgroundSync();
    navigate(POS_ROUTES.PaymentReceived, result);
  }

  async function saveCustomerContact(details) {
    const { saveCustomerContact: persistCustomerContact } = await import("../db/customerContact.js");
    const customer = await persistCustomerContact(details);
    void requestBackgroundSync();
    return customer;
  }

  async function saveCreditSale(details) {
    if (details.manualDebt) {
      const { recordManualDebt } = await import("../db/debtLedger.js");
      const manualDebtResult = await recordManualDebt({
        customerId: details.customer?.id ?? details.customerId,
        debtId: details.debtId,
        name: details.customer?.name ?? details.customerName ?? "",
        phone: details.customer?.phone ?? "",
        ghanaCardNumber: details.customer?.ghanaCardNumber ?? "",
        amountPesewas: details.amountPesewas,
        initialPaymentPesewas: details.initialPaymentPesewas ?? 0,
        initialPaymentParts: details.initialPaymentParts ?? null,
        paymentMethod: details.paymentMethod ?? "cash",
        note: details.note ?? "",
        dueDate: details.dueDate ?? "",
        installmentPlan: details.installmentPlan ?? null,
        takenOn: details.takenOn ?? "",
        attemptId: details.attemptId,
        now: Date.now()
      });
      void requestBackgroundSync();
      navigate(POS_ROUTES.ManualDebtSaved, { ...details, manualDebtResult });
      return;
    }
    const { recordCreditSale } = await import("../db/debts.js");
    const creditResult = await recordCreditSale({
      amountPesewas: details.amountPesewas,
      name: details.customer?.name ?? "",
      phone: details.customer?.phone ?? "",
      ghanaCardNumber: details.customer?.ghanaCardNumber ?? "",
      dueDate: details.dueDate ?? "",
      installmentPlan: details.installmentPlan ?? null,
      initialPaymentPesewas: details.initialPaymentPesewas ?? 0,
      initialPaymentParts: details.initialPaymentParts ?? null,
      paymentMethod: details.paymentMethod ?? "cash",
      note: details.itemDescription ?? details.saleItems?.map((item) =>
        item.quantity > 1 ? `${item.name} × ${item.quantity}` : item.name
      ).join(", ") ?? "Sale",
      saleItems: details.saleItems,
      attemptId: details.attemptId
    });
    void requestBackgroundSync();
    navigate(POS_ROUTES.CreditSaved, { ...details, creditResult });
  }

  async function saveSplitSale(details) {
    const owePart = details.parts?.find((part) => part.paymentMethod === "owe");
    if (owePart) {
      const paidParts = details.parts.filter((part) => part.paymentMethod !== "owe");
      const { recordCreditSale } = await import("../db/debts.js");
      const creditResult = await recordCreditSale({
        amountPesewas: details.amountPesewas,
        name: details.customer?.name ?? "",
        phone: details.customer?.phone ?? "",
        ghanaCardNumber: details.customer?.ghanaCardNumber ?? "",
        dueDate: details.dueDate ?? "",
        installmentPlan: details.installmentPlan ?? null,
        initialPaymentPesewas: paidParts.reduce((sum, part) => sum + part.amountPesewas, 0),
        initialPaymentParts: paidParts,
        paymentMethod: paidParts.some((part) => part.paymentMethod === "momo") ? "momo" : "cash",
        note: details.saleItems?.map((item) => item.name).join(", ") || "Sale",
        saleItems: details.saleItems ?? [],
        attemptId: details.attemptId
      });
      void requestBackgroundSync();
      // Wiring 16 (11 Nov 2026): money received today (a Cash or MoMo part above zero) ends on 30;
      // a split owed in full ends on 31 Saved as credit, as a plain credit sale from 15 does.
      // Both are result screens: the stack starts fresh, so the phone back goes Home.
      const receivedTodayPesewas = paidParts.reduce((sum, part) => sum + (part.amountPesewas > 0 ? part.amountPesewas : 0), 0);
      if (receivedTodayPesewas === 0) {
        navigate(POS_ROUTES.CreditSaved, { ...details, creditResult });
        return;
      }
      navigate(POS_ROUTES.SaleRecorded, { transaction: creditResult.saleTransaction, creditResult });
      return;
    }
    const transaction = await recordCashSale(details);
    void requestBackgroundSync();
    navigate(POS_ROUTES.SaleRecorded, { transaction });
  }

  async function saveDirectMomoSale(details) {
    const transaction = await recordCashSale({
      amountPesewas: details.amountPesewas,
      cashReceivedPesewas: 0,
      momoReceivedPesewas: details.amountPesewas,
      saleItems: details.saleItems ?? [],
      parts: [{ paymentMethod: "momo", amountPesewas: details.amountPesewas, verification: details.verification }],
      attemptId: details.attemptId
    });
    void requestBackgroundSync();
    navigate(POS_ROUTES.SaleRecorded, { transaction });
  }

  async function saveDirectMomoCollection(details) {
    await saveDebtCollection(details.debtId, [{ paymentMethod: "momo", amountPesewas: details.amountPesewas, verification: details.verification }], details.attemptId);
  }

  async function saveExpense(details) {
    const { recordExpense } = await import("../db/suppliers.js");
    const result = await recordExpense(details);
    void requestBackgroundSync();
    switchTab(POS_ROUTES.Home);
    setNotice(spentSavedNotice(result));
  }

  async function saveStockExpense(details) {
    const { recordExpense } = await import("../db/suppliers.js");
    const result = await recordExpense({
      ...details
    });
    void requestBackgroundSync();
    switchTab(POS_ROUTES.Home);
    setNotice(stockSavedNotice(result));
  }

  async function paySupplier(supplierId, amountPesewas) {
    const { recordSupplierPayment } = await import("../db/suppliers.js");
    await recordSupplierPayment({ supplierId, amountPesewas });
    void requestBackgroundSync();
  }

  const route = routeState.current;
  const isSetupFlow = route === POS_ROUTES.HowDoYouWantToSell ||
    route === POS_ROUTES.WhatDoYouSell ||
    route === POS_ROUTES.MoreCategories ||
    (route === POS_ROUTES.YourStarterListGrouped) ||
    (route === POS_ROUTES.YourStarterList && routeState.params.setupFlow === true) ||
    (route === POS_ROUTES.NewItem && routeState.params.setupFlow === true);
  const isCollectSheet = route === POS_ROUTES.CollectPayment;
  const isFocusedCollectionScreen = (route === POS_ROUTES.SplitPayment && Boolean(routeState.params.debtId)) || [
    POS_ROUTES.CollectPayPart,
    POS_ROUTES.PaymentReceived,
    POS_ROUTES.DebtorDetail
  ].includes(route);
  const content = route === POS_ROUTES.Home ? (
    <Home
      onNavigate={navigate}
      notice={notice}
    />
  ) : route === POS_ROUTES.Menu ? (
    <Menu onNavigate={navigate} onClose={closeMenu} />
  ) : route === POS_ROUTES.HowDoYouWantToSell ? (
    <HowDoYouWantToSell onNavigate={navigate} onCompleteSetup={completePosSetup} />
  ) : route === POS_ROUTES.WhatDoYouSell ? (
    <WhatDoYouSell selected={setupCategories} onSelectedChange={setSetupCategories} onBack={navigateBack} onNavigate={navigate} onCompleteSetup={completePosSetup} />
  ) : route === POS_ROUTES.MoreCategories ? (
    <MoreCategories selected={setupCategories} onSelectedChange={setSetupCategories} onBack={navigateBack} onDone={navigateBack} />
  ) : route === POS_ROUTES.HowMuchIsItem ? (
    <HowMuchIsItem params={routeState.params} onBack={navigateBack} onReturnTo={returnTo} />
  ) : route === POS_ROUTES.HowManyItem ? (
    <HowManyItem params={routeState.params} onBack={navigateBack} onReplace={replaceCurrentRoute} />
  ) : route === POS_ROUTES.SplitPayment && routeState.params.installmentSplit ? (
    <InstallmentSplitPayment params={routeState.params} onBack={navigateBack} onReturnTo={returnTo} onNavigate={navigate} onUpdateParams={updateCurrentParams} />
  ) : route === POS_ROUTES.SplitPayment && routeState.params.debtId ? (
    <CollectSplitPayment params={routeState.params} onBack={navigateBack} onNavigate={navigate} onUpdateParams={updateCurrentParams} onRecordCollection={saveDebtCollection} />
  ) : route === POS_ROUTES.SplitPayment ? (
    <SaleSplitPayment params={routeState.params} onBack={navigateBack} onNavigate={navigate} onUpdateParams={updateCurrentParams} onSaveSale={saveSplitSale} />
  ) : route === POS_ROUTES.SettingsProfitTools ? (
    <SettingsProfitTools
      shopName={shopName}
      savedShopName={savedShopName}
      onShopNameChange={(name) => { setShopName(name); setSavedShopName(name); }}
      onBack={navigateBack}
      onOpenBackup={() => navigate(POS_ROUTES.BackupRestore)}
      onOpenMomoSettings={() => navigate(POS_ROUTES.PaymentSettings)}
      onOpenPlan={() => navigate(POS_ROUTES.MyPlan)}
      subscriptionEnabled={FEATURE_FLAGS.SHOW_SUBSCRIPTION_FEATURE}
      hasActiveSubscription={hasActiveSubscription}
      subscriptionExpiry={subscriptionExpiry}
      trialActive={trialActive}
      trialExpiry={trialExpiry}
    />
  ) : route === POS_ROUTES.MoMoChoice ? (
    <MoMoChoice params={routeState.params} onBack={navigateBack} onNavigate={navigate} onReplace={replaceCurrentRoute} />
  ) : route === POS_ROUTES.MoMoDirect ? (
    <MoMoDirect
    params={routeState.params}
    onBack={navigateBack}
    onConfirm={(details) => {
      if (details.pickOnly) {
        returnFromMomoPick({ ...details, momoMethod: "direct", verification: "merchant_confirmed" });
        return;
      }
      const save = details.debtId ? saveDirectMomoCollection(details) : saveDirectMomoSale(details);
      return save.catch((error) => {
        console.error("Could not save direct MoMo payment.", error);
        throw error;
      });
    }}
    onPick={(details) => returnFromMomoPick(details)}
    />
  ) : route === POS_ROUTES.PaymentSettings ? (
    <PaymentSettings onBack={navigateBack} onNavigate={navigate} />
  ) : route === POS_ROUTES.MoMoSetup ? (
    <MoMoSetup params={routeState.params} onBack={navigateBack} onNavigate={navigate} shopName={shopName} />
  ) : route === POS_ROUTES.MoMoPayment ? (
    <MoMoPayment params={routeState.params} onBack={navigateBack} onNavigate={navigate} />
  ) : route === POS_ROUTES.MoMoWaiting ? (
    <MoMoWaiting
      params={routeState.params}
      onCancel={() => {
        returnToOrigin();
      }}
    />
  ) : route === POS_ROUTES.MoMoCode ? (
    <MoMoCode params={routeState.params} onBack={navigateBack} onNavigate={navigate} />
  ) : route === POS_ROUTES.MoMoNotCompleted ? (
    <MoMoNotCompleted params={routeState.params} onPayAnotherWay={returnToOrigin} onBack={navigateBack} onNavigate={navigate} />
  ) : route === POS_ROUTES.BackupRestore ? (
    <BackupRestore onBack={navigateBack} />
  ) : route === POS_ROUTES.MyPlan ? (
    <MyPlan
      expiry={subscriptionExpiry}
      onBack={navigateBack}
      onNavigate={navigate}
      subscriptionExpiry={subscriptionExpiry}
      trialActive={trialActive}
      trialExpiry={trialExpiry}
    />
  ) : route === POS_ROUTES.PlanPayMethod ? (
    <PlanPayMethod onBack={navigateBack} onNavigate={navigate} />
  ) : route === POS_ROUTES.PlanPayCash ? (
    <PlanPayCash onBack={navigateBack} onNavigate={navigate} />
  ) : route === POS_ROUTES.PlanPayMoMo ? (
    <PlanPayMoMo onBack={navigateBack} onNavigate={navigate} />
  ) : route === POS_ROUTES.PlanPayPhone ? (
    <PlanPayPhone onBack={navigateBack} onNavigate={navigate} />
  ) : route === POS_ROUTES.PlanPaymentResult ? (
    <PlanPaymentResult params={routeState.params} onNavigate={navigate} />
  ) : route === POS_ROUTES.Sell ? (
    <Sell
      params={routeState.params}
      onNavigate={navigate}
      onUpdateParams={updateCurrentParams}
    />
  ) : route === POS_ROUTES.SellWithItems ? (
    <SellWithItems
      params={routeState.params}
      onBack={navigateBack}
      onNavigate={navigate}
      onUpdateParams={updateCurrentParams}
    />
  ) : route === POS_ROUTES.ReviewAndPay ? (
    <ReviewAndPay
      params={routeState.params}
      onBack={navigateBack}
      onNavigate={navigate}
      onUpdateParams={updateCurrentParams}
      onSaveSale={saveSplitSale}
    />
  ) : route === POS_ROUTES.SaleRecorded ? (
    <SaleRecorded
      transaction={routeState.params.transaction}
      shopName={shopName}
      onDone={() => switchTab(POS_ROUTES.Home)}
      onNewSale={() => switchTab(POS_ROUTES.Sell)}
    />
  ) : route === POS_ROUTES.MyMoney ? (
    <MyMoney onNavigate={navigate} />
  ) : route === POS_ROUTES.TodaysTransactions ? (
    <TodaysTransactions onBack={() => switchTab(POS_ROUTES.Home)} />
  ) : isCollectSheet ? (
    <>
      <Home onNavigate={navigate} notice={notice} />
      <CollectPayment
        params={routeState.params}
        onClose={() => switchTab(POS_ROUTES.Home)}
        onNavigate={navigate}
        onRecordCollection={saveDebtCollection}
      />
    </>
  ) : route === POS_ROUTES.CollectPayPart ? (
    <CollectPayPart
      params={routeState.params}
      onBack={navigateBack}
      onNavigate={navigate}
      onUpdateParams={updateCurrentParams}
      onRecordCollection={saveDebtCollection}
    />
  ) : route === POS_ROUTES.PaymentReceived ? (
    <PaymentReceived
      params={routeState.params}
      onHome={() => switchTab(POS_ROUTES.Home)}
      onNavigate={navigate}
      onSaveCustomerContact={saveCustomerContact}
      shopName={shopName}
    />
  ) : route === POS_ROUTES.DebtorDetail ? (
    <DebtorDetail
      params={routeState.params}
      onBack={navigateBack}
      onNavigate={navigate}
      shopName={shopName}
      onSaveCustomerContact={saveCustomerContact}
      onCollect={(debt) => navigate(POS_ROUTES.CollectPayment, { debtId: debt.id, customerName: debt.customerName ?? debt.customer_name })}
    />
  ) : route === POS_ROUTES.PeopleWhoOweYou ? (
    <PeopleWhoOweYou
      onBack={() => switchTab(POS_ROUTES.Home)}
      onNavigate={navigate}
      shopName={shopName}
      onCollect={(debt) => navigate(POS_ROUTES.CollectPayment, { debtId: debt.id, customerName: debt.customerName })}
    />
  ) : route === POS_ROUTES.ManualDebtAmount ? (
    <ManualDebtAmount
      params={routeState.params}
      onBack={navigateBack}
      onNavigate={navigate}
      onUpdateParams={updateCurrentParams}
      onSaveManualDebt={saveCreditSale}
    />
  ) : route === POS_ROUTES.ManualDebtSaved ? (
    <ManualDebtSaved
      params={routeState.params}
      onDone={() => switchTab(POS_ROUTES.PeopleWhoOweYou)}
      onNavigate={navigate}
      shopName={shopName}
    />
  ) : route === POS_ROUTES.SpentMoney ? (
    <SpentMoney onBack={navigateBack} onNavigate={navigate} onSave={saveExpense} />
  ) : route === POS_ROUTES.StockOnCredit ? (
    <StockOnCredit params={routeState.params} onBack={navigateBack} onSaveExpense={saveStockExpense} />
  ) : route === POS_ROUTES.YouOweSuppliers ? (
    <YouOweSuppliers onBack={navigateBack} onPay={paySupplier} />
  ) : [
    POS_ROUTES.MyItems,
    POS_ROUTES.NewItem,
    POS_ROUTES.EditItem,
    POS_ROUTES.DeleteItem,
    POS_ROUTES.YourStarterList,
    POS_ROUTES.YourStarterListGrouped
  ].includes(route) ? (
    <ItemScreens
      route={route}
      params={routeState.params}
      onBack={navigateBack}
      onNavigate={navigate}
      onReturnToItems={returnToItemList}
      onCompleteSetup={completePosSetup}
    />
  ) : [
    POS_ROUTES.WhoOwesYou,
    POS_ROUTES.NewPerson,
    POS_ROUTES.WhenWillTheyPay,
    POS_ROUTES.ALittleAtATime,
    POS_ROUTES.CreditSaved
  ].includes(route) ? (
    <CreditScreens
      route={route}
      params={routeState.params}
      onBack={navigateBack}
      onNavigate={navigate}
      onUpdateParams={updateCurrentParams}
      onReturnToSplit={(details) => returnTo(POS_ROUTES.SplitPayment, details, isSaleSplitHub)}
      onSaveCredit={saveCreditSale}
      onSaveCustomerContact={saveCustomerContact}
      onHome={() => switchTab(POS_ROUTES.Home)}
      shopName={shopName}
    />
  ) : (
    <PlannedScreen route={route} params={routeState.params} onBack={navigateBack} onOpenBackup={() => navigate(POS_ROUTES.BackupRestore)} />
  );

  return (
    <div className="pos-app min-h-screen max-w-full overflow-x-hidden bg-white text-slate-950" style={POS_THEME.cssVariables}>
      <PosHeader
        shopName={shopName}
        statusLabel={getStatusLabel(sync)}
        onHome={() => switchTab(POS_ROUTES.Home)}
        onMenu={openMenu}
        menuActive={route === POS_ROUTES.Menu}
        hideMenu={isFocusedCollectionScreen || isSetupFlow || route === POS_ROUTES.PeopleWhoOweYou}
      />
      <div className="flex min-h-[calc(100vh-4rem)]">
        {!isSetupFlow && <PosSideNav current={route} onNavigate={switchTab} />}
        <div className="min-w-0 flex-1">
          <PosErrorBoundary key={route}>
            <Suspense fallback={<PosPage><p role="status">{t("app.loadingScreen")}</p></PosPage>}>
                  {setupReady ? content : <PosPage><p role="status">{t("app.loadingScreen")}</p></PosPage>}
            </Suspense>
          </PosErrorBoundary>
        </div>
      </div>
      {showsBottomBar(route) && <PosBottomNav current={route} onNavigate={switchTab} />}
    </div>
  );
}
