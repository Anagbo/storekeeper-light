import { lazy, Suspense, useEffect, useState } from "react";
import BackupModal from "../components/BackupModal.jsx";
import DebtLedger from "../components/DebtLedger.jsx";
import QuickSaleModal from "../components/QuickSaleModal.jsx";
import { recordCashSale } from "../db/sales.js";
import { setPreference, shouldShowPosSetup } from "../db/preferences.js";
import { useSync } from "../hooks/useSync.js";
import { formatGhs } from "../lib/money.js";
import { requestBackgroundSync } from "../lib/syncRegistration.js";
import { backRoute, createRouteState, POS_ROUTES, pushRoute, replaceRoute } from "./routes.js";
import Home from "./Home.jsx";
import Menu from "./Menu.jsx";
import MyMoney from "./MyMoney.jsx";
import TodaysTransactions from "./TodaysTransactions.jsx";
import { posText as t } from "./i18n.js";
import { PosBottomNav, PosHeader, PosPage, PosPrimaryButton, PosSideNav } from "./PosComponents.jsx";
import PosErrorBoundary from "./PosErrorBoundary.jsx";
import CreditScreens from "./CreditScreens.jsx";
import Sell from "./Sell.jsx";
import { POS_THEME } from "./theme.js";
import { SpentMoney, StockOnCredit, YouOweSuppliers } from "./SupplierScreens.jsx";
import ItemScreens from "./ItemScreens.jsx";
import SellWithItems from "./SellWithItems.jsx";
import SaleRecorded from "./SaleRecorded.jsx";
import PaymentSplit from "./PaymentSplit.jsx";
import { HowDoYouWantToSell, HowManyItem, HowMuchIsItem, WhatDoYouSell } from "./SetupScreens.jsx";
import { LanguageSettings, SettingsProfitTools } from "./SettingsScreens.jsx";

const CollectPayment = lazy(() => import("./DebtCollection.jsx").then((module) => ({ default: module.CollectPayment })));
const CollectPayPart = lazy(() => import("./DebtCollection.jsx").then((module) => ({ default: module.CollectPayPart })));
const CollectPartByPart = lazy(() => import("./DebtCollection.jsx").then((module) => ({ default: module.CollectPartByPart })));
const DebtorDetail = lazy(() => import("./DebtCollection.jsx").then((module) => ({ default: module.DebtorDetail })));
const PaymentReceived = lazy(() => import("./DebtCollection.jsx").then((module) => ({ default: module.PaymentReceived })));

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

function PlannedScreen({ route, params, onBack, onOpenBackup }) {
  const title = t(`planned.titles.${route}`);
  return (
    <PosPage className="space-y-4">
      <h1 className="text-2xl font-extrabold">{title}</h1>
      <section className="rounded-2xl border-2 border-amber-800 bg-amber-100 p-4">
        <p className="text-base font-semibold">{t("planned.notReady", { title })}</p>
        {params?.customerName && <p className="mt-3 text-base font-semibold">{t("planned.customer", { name: params.customerName })}</p>}
        {params?.amountPesewas > 0 && <p className="mt-3 text-base font-semibold">{t("planned.saleAmount", { amount: formatGhs(params.amountPesewas) })}</p>}
        {route === "SettingsProfitTools" && (
          <PosPrimaryButton type="button" onClick={onOpenBackup} className="mt-4">
            {t("planned.backup")}
          </PosPrimaryButton>
        )}
      </section>
      <button type="button" onClick={onBack} className="min-h-12 rounded-xl border-2 border-slate-800 px-4 text-base font-bold focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-800">
        {t("planned.back")}
      </button>
    </PosPage>
  );
}

export default function PosApp() {
  const [routeState, setRouteState] = useState(() => createRouteState());
  const [shopName, setShopName] = useState(getSavedShopName);
  const [setupReady, setSetupReady] = useState(false);
  const [quickEntryOpen, setQuickEntryOpen] = useState(false);
  const [entryType, setEntryType] = useState("expense");
  const [backupOpen, setBackupOpen] = useState(false);
  const [notice, setNotice] = useState("");
  const sync = useSync();

  useEffect(() => {
    let active = true;
    shouldShowPosSetup()
      .then((showSetup) => {
        if (active && showSetup) setRouteState(createRouteState(POS_ROUTES.HowDoYouWantToSell));
      })
      .catch((error) => console.error("Could not check first-run setup.", error))
      .finally(() => { if (active) setSetupReady(true); });
    return () => { active = false; };
  }, []);

  function navigate(route, params = {}) {
    if (!Object.values(POS_ROUTES).includes(route)) {
      throw new Error(`Unknown POS route: ${route}`);
    }
    if (route === "Home") {
      setRouteState(createRouteState(POS_ROUTES.Home));
      setNotice("");
      return;
    }
    setRouteState((current) => pushRoute(current, route, params));
    setNotice("");
  }

  function switchTab(route) {
    if (!Object.values(POS_ROUTES).includes(route)) {
      throw new Error(`Unknown POS route: ${route}`);
    }
    setRouteState(createRouteState(route));
    setNotice("");
  }

  function navigateBack() {
    setRouteState((current) => backRoute(current));
    setNotice("");
  }

  function returnToItemList() {
    setRouteState((current) => {
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
    setRouteState((current) => replaceRoute(current, current.current, { ...current.params, ...params }));
  }

  function replaceCurrentRoute(route, params = {}) {
    setRouteState((current) => replaceRoute(current, route, params));
    setNotice("");
  }

  async function completePosSetup() {
    await setPreference("posSetupCompleted", true);
    switchTab(POS_ROUTES.Home);
  }

  function openMenu() {
    if (routeState.current === POS_ROUTES.Menu) {
      switchTab(POS_ROUTES.Home);
      return;
    }
    navigate(POS_ROUTES.Menu);
  }

  function openLegacyEntry(type) {
    setEntryType(type);
    setQuickEntryOpen(true);
  }

  async function saveDebtCollection(debtId, parts) {
    const { recordDebtCollection } = await import("../db/debts.js");
    const result = await recordDebtCollection({ debtId, parts });
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
      saleItems: details.saleItems
    });
    void requestBackgroundSync();
    navigate(POS_ROUTES.CreditSaved, { ...details, creditResult });
  }

  async function saveSplitSale(details) {
    const transaction = await recordCashSale(details);
    void requestBackgroundSync();
    navigate(POS_ROUTES.SaleRecorded, { transaction });
  }

  async function saveExpense(details) {
    const { recordExpense } = await import("../db/suppliers.js");
    const result = await recordExpense(details);
    void requestBackgroundSync();
    switchTab(POS_ROUTES.Home);
    setNotice(t("expense.savedNotice", { amount: formatGhs(result.amountPesewas) }));
  }

  async function saveStockExpense(details) {
    const { recordExpense } = await import("../db/suppliers.js");
    const result = await recordExpense({
      ...details
    });
    void requestBackgroundSync();
    switchTab(POS_ROUTES.Home);
    setNotice(t("expense.savedNotice", { amount: formatGhs(result.amountPesewas) }));
  }

  async function paySupplier(supplierId, amountPesewas) {
    const { recordSupplierPayment } = await import("../db/suppliers.js");
    await recordSupplierPayment({ supplierId, amountPesewas });
    void requestBackgroundSync();
  }

  const route = routeState.current;
  const isSetupFlow = route === POS_ROUTES.HowDoYouWantToSell ||
    route === POS_ROUTES.WhatDoYouSell ||
    (route === POS_ROUTES.YourStarterList && routeState.params.setupFlow === true) ||
    (route === POS_ROUTES.NewItem && routeState.params.setupFlow === true);
  const isCollectSheet = route === POS_ROUTES.CollectPayment;
  const isFocusedCollectionScreen = [
    POS_ROUTES.CollectPayPart,
    POS_ROUTES.CollectPartByPart,
    POS_ROUTES.PaymentReceived,
    POS_ROUTES.DebtorDetail
  ].includes(route);
  const content = route === POS_ROUTES.Home ? (
    <Home
      onNavigate={navigate}
      onLegacyEntry={openLegacyEntry}
      notice={notice}
    />
  ) : route === POS_ROUTES.Menu ? (
    <Menu onNavigate={navigate} />
  ) : route === POS_ROUTES.HowDoYouWantToSell ? (
    <HowDoYouWantToSell onNavigate={navigate} onCompleteSetup={completePosSetup} />
  ) : route === POS_ROUTES.WhatDoYouSell ? (
    <WhatDoYouSell onBack={navigateBack} onNavigate={navigate} onCompleteSetup={completePosSetup} />
  ) : route === POS_ROUTES.HowMuchIsItem ? (
    <HowMuchIsItem params={routeState.params} onBack={navigateBack} onNavigate={navigate} />
  ) : route === POS_ROUTES.HowManyItem ? (
    <HowManyItem params={routeState.params} onBack={navigateBack} onReplace={replaceCurrentRoute} />
  ) : route === POS_ROUTES.PayPartByPart ? (
    <PaymentSplit params={routeState.params} onBack={navigateBack} onNavigate={navigate} onSaveSale={saveSplitSale} />
  ) : route === POS_ROUTES.LanguageSettings ? (
    <LanguageSettings onBack={navigateBack} />
  ) : route === POS_ROUTES.SettingsProfitTools ? (
    <SettingsProfitTools
      shopName={shopName}
      onShopNameChange={setShopName}
      onBack={navigateBack}
      onOpenBackup={() => setBackupOpen(true)}
    />
  ) : route === POS_ROUTES.Sell ? (
    <Sell
      params={routeState.params}
      onNavigate={navigate}
    />
  ) : route === POS_ROUTES.SellWithItems ? (
    <SellWithItems
      params={routeState.params}
      onBack={navigateBack}
      onNavigate={navigate}
      onUpdateParams={updateCurrentParams}
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
      <Home onNavigate={navigate} onLegacyEntry={openLegacyEntry} notice={notice} />
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
      onUpdateParams={updateCurrentParams}
      onRecordCollection={saveDebtCollection}
    />
  ) : route === POS_ROUTES.CollectPartByPart ? (
    <CollectPartByPart
      params={routeState.params}
      onBack={navigateBack}
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
      onBack={() => switchTab(POS_ROUTES.Home)}
      shopName={shopName}
      onSaveCustomerContact={saveCustomerContact}
      onCollect={(debt) => navigate(POS_ROUTES.CollectPayment, { debtId: debt.id, customerName: debt.customerName ?? debt.customer_name })}
    />
  ) : route === POS_ROUTES.PeopleWhoOweYou ? (
    <DebtLedger
      shopName={shopName}
      onReturnToDashboard={() => switchTab(POS_ROUTES.Home)}
      onCollect={(debt) => navigate(POS_ROUTES.CollectPayment, { debtId: debt.id, customerName: debt.customerName ?? debt.customer_name })}
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
    POS_ROUTES.YourStarterList
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
      onSaveCredit={saveCreditSale}
      onSaveCustomerContact={saveCustomerContact}
      onHome={() => switchTab(POS_ROUTES.Home)}
      shopName={shopName}
    />
  ) : (
    <PlannedScreen route={route} params={routeState.params} onBack={navigateBack} onOpenBackup={() => setBackupOpen(true)} />
  );

  return (
    <div className="pos-app min-h-screen bg-white text-slate-950" style={POS_THEME.cssVariables}>
      <PosHeader
        shopName={shopName}
        statusLabel={getStatusLabel(sync)}
        onHome={() => switchTab(POS_ROUTES.Home)}
        onMenu={openMenu}
        menuActive={route === POS_ROUTES.Menu}
        hideMenu={isFocusedCollectionScreen || isSetupFlow}
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
      {!isFocusedCollectionScreen && !isSetupFlow && <PosBottomNav current={route} onNavigate={switchTab} />}

      {quickEntryOpen && (
        <QuickSaleModal
          type={entryType}
          onClose={() => setQuickEntryOpen(false)}
          onSaved={() => setNotice(t("sell.savedNotice"))}
        />
      )}
      <BackupModal
        isOpen={backupOpen}
        onClose={() => setBackupOpen(false)}
        showSubscription={false}
      />
    </div>
  );
}
