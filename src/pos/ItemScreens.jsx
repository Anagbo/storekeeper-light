import { useEffect, useMemo, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { Check, Search, Trash2 } from "lucide-react";
import { db } from "../db/db.js";
import { createProduct, normalizeProductInput, removeProduct, updateProduct, addStarterProducts } from "../db/products.js";
import { getAllStarterItems, groupCoreItemsByCategory, mergeStarterItems, starterChipCategories, starterItemsForChip } from "../db/starterItems.js";
import { loadStarterCategories } from "../db/preferences.js";
import { formatGhs, toPesewas } from "../lib/money.js";
import { requestBackgroundSync } from "../lib/syncRegistration.js";
import { posText as t } from "./i18n.js";
import { shortSaveName } from "./saveLabel.js";
import { AddButton, LeaveButton, PosBackButton, PosPage, PosPrimaryButton, PosSecondaryButton } from "./PosComponents.jsx";
import { useBackBlock } from "./browserBack.js";
import { useFormErrors } from "./formErrors.js";
import AmountTextInput from "./AmountTextInput.jsx";
import WideDialog from "./WideDialog.jsx";
import LeaveDraftDialog from "./LeaveDraftDialog.jsx";

// What normalizeProductInput (the save's own check) says is wrong, or "".
function productInputProblem(input) {
  try {
    normalizeProductInput(input);
    return "";
  } catch (validationError) {
    return validationError.message;
  }
}

function ScreenHeader({ title, onBack }) {
  return (
    <div className="flex items-center gap-3">
      <PosBackButton onClick={onBack} />
      <h1 className="line-clamp-2 min-w-0 break-words text-2xl font-extrabold leading-tight">{title}</h1>
    </div>
  );
}

function useActiveProducts() {
  return useLiveQuery(async () => {
    try {
      const products = await db.products.toArray();
      return { products: products.filter((product) => product.active !== false).sort((a, b) => a.name.localeCompare(b.name)), error: "" };
    } catch (error) {
      console.error("Could not load items.", error);
      return { products: [], error: t("items.loadFailed") };
    }
  }, [], undefined);
}

function MyItems({ onBack, onNavigate }) {
  const [query, setQuery] = useState("");
  const result = useActiveProducts();
  const filteredItems = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return (result?.products ?? []).filter((item) => item.name.toLowerCase().includes(normalizedQuery));
  }, [query, result]);

  // Empty list on 39 (17 Nov 2026): with no items the hint is plain text (17px, no box) right under the Back
  // and title row, then Find item, "+ New item" and "+ Add from starter list" together. With items the order
  // is Find item, "+ New item", the list, then "+ Add from starter list" at the end.
  const empty = Boolean(result) && !result.error && result.products.length === 0;
  const starterButton = (
    // rules_global.button_system.open_text_sweep: "+ Add from starter list" is the add look.
    <AddButton onClick={() => onNavigate("YourStarterList", { returnRoute: "MyItems" })}>{t("items.starterList")}</AddButton>
  );

  return (
    <PosPage className="flex flex-col gap-3">
      <ScreenHeader title={t("items.title")} onBack={onBack} />
      {empty && <p data-empty-hint="" className="text-[17px] font-semibold">{t("items.empty")}</p>}
      <label className="flex min-h-14 items-center gap-2 rounded-2xl border-[3px] border-slate-500 px-3">
        <Search size={24} aria-hidden="true" />
        <span className="sr-only">{t("items.find")}</span>
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("items.find")} className="min-w-0 flex-1 bg-transparent text-lg font-semibold outline-none" />
      </label>
      {/* rules_global.button_system.open_text_sweep: "+ New item" is the add look (was solid green). */}
      <AddButton onClick={() => onNavigate("NewItem")}>{t("items.new")}</AddButton>
      {empty ? starterButton : result === undefined ? (
        <p role="status" className="rounded-xl bg-slate-100 p-3 font-semibold">{t("items.loading")}</p>
      ) : result.error ? (
        <p role="alert" className="rounded-xl border-2 border-rose-900 bg-rose-100 p-3 font-semibold text-rose-950">{result.error}</p>
      ) : filteredItems.length ? (
        <div className="flex flex-col gap-2">
          {filteredItems.map((item) => (
            <button key={item.id} type="button" onClick={() => onNavigate("EditItem", { itemId: item.id })} className="flex min-h-[60px] items-center gap-3 rounded-2xl border-2 border-slate-500 bg-white px-3 text-left">
              <strong className="min-w-0 flex-1 truncate text-lg">{item.name}</strong>
              <span className={`shrink-0 font-extrabold ${item.default_price > 0 ? "text-emerald-900" : "text-[#0F172A]"}`}>
                {item.default_price > 0 ? formatGhs(toPesewas(item.default_price)) : t("items.setPrice")}
              </span>
            </button>
          ))}
        </div>
      ) : (
        <p className="rounded-xl border-2 border-slate-300 bg-white p-4 font-semibold">{t("items.noMatches")}</p>
      )}
      {!empty && starterButton}
    </PosPage>
  );
}

// The Price field's text for a saved item ("" when it has no price yet).
function priceText(item) {
  return item?.default_price > 0 ? item.default_price.toFixed(2) : "";
}

// pane (wide D8): the same form, fields, checks and save as 40 and 41, drawn inside the Items page's right
// pane instead of as its own page. onSaved(product) replaces Back; onDelete opens 42 over the page.
// onDirtyChange(dirty) tells the page whether the values differ from the saved ones; savedNotice starts
// the pane with the quiet Saved line (a New item just saved, now shown as its Edit item).
function ItemEditor({ item, onBack, onNavigate, onSave, setupFlow = false, onCompleteSetup, pane = false, onSaved, onDelete, onDirtyChange, savedNotice = false }) {
  const [name, setName] = useState(item?.name ?? "");
  const [price, setPrice] = useState(() => priceText(item));
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  useBackBlock(saving);
  // The saved values (what the owner would lose); typing a value back to them is not a change.
  const [baseline, setBaseline] = useState(() => ({ name: item?.name ?? "", price: priceText(item) }));
  const dirty = name !== baseline.name || price !== baseline.price;
  const [showSaved, setShowSaved] = useState(savedNotice);
  useEffect(() => {
    if (!pane) return undefined;
    onDirtyChange?.(dirty);
    return () => onDirtyChange?.(false);
  }, [pane, dirty]);
  // rules_global.form_errors: the same checks as the save (normalizeProductInput), one per field, so
  // a name problem goes once the name is fixed and a price problem once the price is.
  const formErrors = useFormErrors([
    ["name", productInputProblem({ name, price: "" })],
    ["price", productInputProblem({ name: "x", price })]
  ]);

  async function submit(event) {
    event.preventDefault();
    if (saving) return;
    setError("");
    if (!formErrors.check()) return;
    setSaving(true);
    setError("");
    try {
      const saved = await onSave({ name, price });
      void requestBackgroundSync();
      if (pane) {
        // The pane stays on the saved item showing what was saved; the values are the new baseline.
        const next = { name: saved?.name ?? name, price: saved ? priceText(saved) : price };
        setName(next.name);
        setPrice(next.price);
        setBaseline(next);
        setShowSaved(true);
        onSaved?.(saved);
      } else if (setupFlow) await onCompleteSetup();
      else onBack();
    } catch (saveError) {
      console.error("Could not save this item.", saveError);
      setError(saveError instanceof TypeError ? saveError.message : t("items.saveFailed"));
    } finally {
      setSaving(false);
    }
  }

  const fields = (
    <>
      <label className="block">
        <span className="mb-1 block text-lg font-extrabold">{t("items.name")}</span>
        <input autoComplete="off" maxLength="80" value={name} onChange={(event) => { setName(event.target.value); setError(""); }} placeholder={t("items.namePlaceholder")} className="h-14 w-full rounded-2xl border-[3px] border-slate-500 px-3 text-lg" />
      </label>
      <label className="block">
        <span className="mb-1 block text-lg font-extrabold">{t("items.price")}</span>
        <span className="flex h-14 items-center gap-2 rounded-2xl border-[3px] border-slate-500 px-3">
          <span className="shrink-0 font-bold text-slate-700">GH₵</span>
          <AmountTextInput value={price} onValue={(value) => { setPrice(value); setError(""); }} placeholder="0.00" className="w-full min-w-0 bg-transparent text-lg font-bold outline-none" />
        </span>
      </label>
      {(formErrors.message || error) && <p role="alert" className={`rounded-xl border-2 border-rose-900 bg-rose-100 p-3 font-semibold text-rose-950${pane ? " text-[17px]" : ""}`}>{formErrors.message || error}</p>}
    </>
  );

  // Wide D8 pane: title, then the phone's fields (Price full width: the wide form has exactly the phone's
  // fields), the fields scroll by themselves and the buttons stay at the bottom of the pane: Delete item
  // outlined red at the left (not on New item), Save at the right.
  if (pane) {
    return (
      <form data-items-pane="" aria-labelledby="item-pane-title" onSubmit={(event) => void submit(event)} className="flex min-h-0 min-w-0 flex-col rounded-[20px] border-2 border-slate-300 bg-white">
        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-6">
          <h2 id="item-pane-title" className="line-clamp-2 break-words text-[24px] font-bold leading-tight text-[#0F172A]">{item ? t("items.editTitle", { name: item.name }) : t("items.new")}</h2>
          {fields}
        </div>
        <div data-items-pane-actions="" className="flex flex-col gap-2 border-t-2 border-slate-200 px-6 py-4">
          <div className="flex items-center justify-between gap-3">
            {item ? (
              <PosSecondaryButton type="button" data-delete-item="" disabled={saving} onClick={onDelete} tone="danger" className="w-auto max-w-[240px] whitespace-nowrap">
                <Trash2 size={20} aria-hidden="true" />{t("items.delete")}
              </PosSecondaryButton>
            ) : <span />}
            <PosPrimaryButton type="submit" disabled={saving} className="w-auto min-w-[160px] max-w-[240px]">
              <Check size={24} aria-hidden="true" />{saving ? t("items.saving") : t("items.save")}
            </PosPrimaryButton>
          </div>
          {/* The quiet Saved line (no toast); its space is kept so the buttons never move. */}
          <p role="status" data-items-saved="" className="min-h-[26px] text-right text-[17px] font-semibold text-slate-600">{showSaved && !dirty ? t("items.saved") : ""}</p>
        </div>
      </form>
    );
  }

  return (
    <PosPage className="flex flex-col gap-3">
      <ScreenHeader title={item ? item.name : t("items.new")} onBack={onBack} />
      <form onSubmit={(event) => void submit(event)} className="flex flex-1 flex-col gap-3">
        {fields}
        <div className="mt-auto flex flex-col gap-2">
          {item && (
            <PosSecondaryButton type="button" disabled={saving} onClick={() => onNavigate("DeleteItem", { itemId: item.id, itemName: item.name })} tone="danger">
              <Trash2 size={20} aria-hidden="true" />{t("items.delete")}
            </PosSecondaryButton>
          )}
          <PosPrimaryButton type="submit" disabled={saving}>
            <Check size={24} aria-hidden="true" />{saving ? t("items.saving") : t("items.save")}
          </PosPrimaryButton>
        </div>
      </form>
    </PosPage>
  );
}

function DeleteItem({ itemId, itemName, onBack, onReturnToItems, onDelete, dialog = false, returnFocus }) {
  const [busy, setBusy] = useState(false);
  useBackBlock(busy);
  const [error, setError] = useState("");

  async function confirmDelete() {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await onDelete(itemId);
      void requestBackgroundSync();
      onReturnToItems();
    } catch (deleteError) {
      console.error("Could not remove this item.", deleteError);
      setError(deleteError instanceof TypeError ? deleteError.message : t("items.deleteFailed"));
    } finally {
      setBusy(false);
    }
  }

  const body = (
    <>
        <div className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-rose-200 text-rose-950"><Trash2 size={32} aria-hidden="true" /></div>
        <h2 id="delete-item-title" className="text-2xl font-extrabold">{t("items.deleteConfirm", { name: itemName })}</h2>
        <p className="text-base text-slate-800">{t("items.deleteExplanation")}</p>
        {error && <p role="alert" className="rounded-xl border-2 border-rose-900 bg-rose-100 p-3 font-semibold text-rose-950">{error}</p>}
        <PosPrimaryButton type="button" disabled={busy} onClick={onBack} className="min-h-20 text-xl">{t("items.keep", { name: shortSaveName(itemName) })}</PosPrimaryButton>
        <button type="button" disabled={busy} onClick={() => void confirmDelete()} className="min-h-14 rounded-2xl border-[3px] border-rose-900 bg-white px-4 text-lg font-extrabold text-rose-900 disabled:opacity-50">
          {busy ? t("items.deleting") : t("items.confirmDelete")}
        </button>
    </>
  );
  // wide_layout.page_types.dialog: on wide 42 is the shared WideDialog over the item's page; Escape and
  // a scrim click are Keep (Back), not while the item is being removed.
  if (dialog) {
    return (
      <WideDialog role="alertdialog" labelledBy="delete-item-title" returnFocus={returnFocus} onClose={() => { if (!busy) onBack(); }}>
        <div className="flex flex-col gap-3 text-center">{body}</div>
      </WideDialog>
    );
  }
  return (
    <PosPage className="flex flex-col gap-3">
      <ScreenHeader title={itemName} onBack={onBack} />
      <section role="alertdialog" aria-modal="true" aria-labelledby="delete-item-title" className="my-auto flex flex-col gap-3 rounded-3xl border-[3px] border-slate-900 bg-white p-5 text-center">
        {body}
      </section>
    </PosPage>
  );
}

const GROUP_PREVIEW_COUNT = 3;

function StarterList({ grouped = false, params, onBack, onAdd, onCompleteSetup }) {
  const result = useActiveProducts();
  const isSetup = params.setupFlow === true && params.starterCategories?.length > 0;
  const merged = useMemo(() => (isSetup
    ? mergeStarterItems(params.starterCategories)
    : { core: [], more: getAllStarterItems() }), [isSetup, params.starterCategories]);
  const [selected, setSelected] = useState(() => new Set(merged.core.map(({ name }) => name.toLowerCase())));
  const [showMore, setShowMore] = useState(!isSetup);
  // 52: categories whose full list is shown ("Show all {category}").
  const [expandedGroups, setExpandedGroups] = useState(() => new Set());
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  useBackBlock(saving);
  const existingNames = new Set((result?.products ?? []).map((product) => product.name.trim().toLowerCase()));
  const isAvailable = ({ name }) => !existingNames.has(name.toLowerCase());
  const availableItems = [...merged.core, ...merged.more].filter(isAvailable);
  const searchText = query.trim().toLowerCase();
  const matches = ({ name }) => !searchText || name.toLowerCase().includes(searchText);
  const visibleCore = merged.core.filter(isAvailable).filter(matches);
  const hiddenMore = merged.more.filter(isAvailable);
  const visibleMore = (showMore ? hiddenMore : []).filter(matches);
  const groupedCore = grouped
    ? groupCoreItemsByCategory(params.starterCategories ?? []).map(({ category, items }) => ({ category, items: items.filter(isAvailable) })).filter(({ items }) => items.length)
    : [];
  const selectedItems = availableItems.filter(({ name }) => selected.has(name.toLowerCase()));
  const selectedCount = selectedItems.length;

  function toggle(name) {
    setSelected((current) => {
      const next = new Set(current);
      const itemKey = name.toLowerCase();
      if (next.has(itemKey)) next.delete(itemKey);
      else next.add(itemKey);
      return next;
    });
  }

  function renderItem({ name }) {
    const checked = selected.has(name.toLowerCase());
    return (
      <button key={name} type="button" aria-pressed={checked} onClick={() => toggle(name)} className="flex min-h-14 items-center gap-3 rounded-2xl border-2 border-slate-500 bg-white px-3 text-left text-lg font-extrabold">
        <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg border-[3px] ${checked ? "border-emerald-900 bg-emerald-900 text-white" : "border-slate-500 bg-white"}`}>
          {checked && <Check size={21} aria-hidden="true" />}
        </span>{name}
      </button>
    );
  }

  async function addSelected() {
    if (saving || selectedCount === 0) return;
    setSaving(true);
    setError("");
    try {
      await onAdd(selectedItems);
      void requestBackgroundSync();
      if (params.setupFlow) await onCompleteSetup({ starterCategories: params.starterCategories });
      else onBack();
    } catch (saveError) {
      console.error("Could not add starter items.", saveError);
      setError(params.setupFlow ? t("setup.saveFailed") : t("items.starterFailed"));
    } finally {
      setSaving(false);
    }
  }

  async function finishSetup() {
    if (saving) return;
    setSaving(true);
    setError("");
    try {
      await onCompleteSetup({ starterCategories: params.starterCategories });
    } catch (saveError) {
      console.error("Could not finish POS setup.", saveError);
      setError(t("setup.saveFailed"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <PosPage className="flex flex-col gap-3">
      <ScreenHeader title={t("items.starterTitle")} onBack={onBack} />
      <p className="text-base text-slate-800">{t("items.starterHint")}</p>
      {result === undefined ? <p role="status">{t("items.loading")}</p> : (
        <div className="flex flex-col gap-2">
          {!isSetup && (
            <label className="flex min-h-14 items-center gap-2 rounded-2xl border-[3px] border-slate-500 px-3">
              <Search size={24} aria-hidden="true" />
              <span className="sr-only">{t("items.starterSearch")}</span>
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("items.starterSearch")} className="min-w-0 flex-1 bg-transparent text-lg font-semibold outline-none" />
            </label>
          )}
          {grouped && isSetup ? groupedCore.map(({ category, items }) => {
            const expanded = expandedGroups.has(category);
            return (
              <section key={category} className="flex flex-col gap-2">
                <div className="flex items-baseline justify-between gap-2">
                  <h2 className="text-xl font-extrabold">{category}</h2>
                  <span className="text-base text-slate-700">{t("items.groupCount", { count: items.length })}</span>
                </div>
                {(expanded ? items : items.slice(0, GROUP_PREVIEW_COUNT)).map(renderItem)}
                {items.length > GROUP_PREVIEW_COUNT && (expanded ? (
                  <PosSecondaryButton
                    type="button"
                    aria-expanded
                    onClick={() => setExpandedGroups((current) => {
                      const next = new Set(current);
                      next.delete(category);
                      return next;
                    })}
                  >
                    {t("items.showFewer")}
                  </PosSecondaryButton>
                ) : (
                  <PosSecondaryButton
                    type="button"
                    aria-label={t("items.showAllCategory", { category })}
                    aria-expanded={false}
                    onClick={() => setExpandedGroups((current) => new Set(current).add(category))}
                  >
                    {t("items.showAll", { count: items.length })}
                  </PosSecondaryButton>
                ))}
              </section>
            );
          }) : (
            <>
              {visibleCore.map(renderItem)}
              {visibleMore.map(renderItem)}
              {isSetup && !showMore && hiddenMore.length > 0 && (
                <PosSecondaryButton type="button" onClick={() => setShowMore(true)}>{t("items.showMore", { count: hiddenMore.length })}</PosSecondaryButton>
              )}
            </>
          )}
          {!availableItems.length && <p className="rounded-xl border-2 border-slate-300 bg-white p-4 font-semibold">{t("items.starterEmpty")}</p>}
          {availableItems.length > 0 && !visibleCore.length && !visibleMore.length && searchText && (
            <p className="rounded-xl border-2 border-slate-300 bg-white p-4 font-semibold">{t("items.starterNoMatch")}</p>
          )}
        </div>
      )}
      <p className="text-sm text-slate-700">{t("items.priceLater")}</p>
      {error && <p role="alert" className="rounded-xl border-2 border-rose-900 bg-rose-100 p-3 font-semibold text-rose-950">{error}</p>}
      <PosPrimaryButton type="button" disabled={saving || result === undefined || selectedCount === 0} onClick={() => void addSelected()} className="mt-auto">
        {saving ? t("items.saving") : t("setup.continueCount", { count: selectedCount })}
      </PosPrimaryButton>
      {params.setupFlow && (
        <LeaveButton disabled={saving} onClick={() => void finishSetup()}>
          {t("setup.finish")}
        </LeaveButton>
      )}
    </PosPage>
  );
}

// The categories saved at setup (preferences.loadStarterCategories); undefined while loading.
function useSetupCategories() {
  return useLiveQuery(async () => {
    try {
      return { setupCategories: await loadStarterCategories() };
    } catch (error) {
      console.error("Could not load the setup categories.", error);
      return { setupCategories: [] };
    }
  }, ["starterCategories"], undefined);
}

const chipClass = (pressed) => `min-h-11 rounded-full border-2 px-4 text-base font-bold ${pressed ? "border-emerald-900 bg-emerald-900 text-white" : "border-slate-500 bg-white text-slate-900"}`;

// 36 opened from My items 39, the second mode of the starter list (decided 20 Nov 2026; setup 35/36/51/52
// unchanged): "Add from starter list", nothing ticked, category chips (All, the setup categories or the
// popular ones, More categories), search across every category, items already in My items shown as
// "Added" and not tickable (name, case ignored), "Add N items" disabled at 0, Back only, back to 39.
// dialog (wide D8): the same content as a WideDialog over the Items page; Back, Escape and the scrim close it.
function StarterBrowse({ onBack, onAdd, dialog = false }) {
  const result = useActiveProducts();
  const setup = useSetupCategories();
  const chips = useMemo(() => starterChipCategories(setup?.setupCategories), [setup]);
  const [chip, setChip] = useState("all");
  const [moreOpen, setMoreOpen] = useState(false);
  const [selected, setSelected] = useState(() => new Map());
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  useBackBlock(saving);
  const existingNames = new Set((result?.products ?? []).map((product) => product.name.trim().toLowerCase()));
  const isAdded = ({ name }) => existingNames.has(name.trim().toLowerCase());
  const searchText = query.trim().toLowerCase();
  const items = searchText
    ? starterItemsForChip("all", chips).filter(({ name }) => name.toLowerCase().includes(searchText))
    : starterItemsForChip(chip, chips);
  // Ticks are kept by name; an item that is now in My items never counts.
  const selectedItems = [...selected.values()].filter((item) => !isAdded(item));
  const selectedCount = selectedItems.length;

  function toggle(item) {
    if (isAdded(item)) return;
    setSelected((current) => {
      const next = new Map(current);
      const itemKey = item.name.toLowerCase();
      if (next.has(itemKey)) next.delete(itemKey);
      else next.set(itemKey, { name: item.name, category: item.category });
      return next;
    });
  }

  function pickChip(id) {
    setChip(id);
    if (id === "more") setMoreOpen(true);
    else if (!chips.more.some((category) => category.id === id)) setMoreOpen(false);
  }

  async function addSelected() {
    if (saving || selectedCount === 0) return;
    setSaving(true);
    setError("");
    try {
      await onAdd(selectedItems);
      void requestBackgroundSync();
      onBack();
    } catch (saveError) {
      console.error("Could not add starter items.", saveError);
      setError(t("items.starterFailed"));
    } finally {
      setSaving(false);
    }
  }

  const chipButton = ({ id, name }) => (
    <button key={id} type="button" aria-pressed={chip === id} onClick={() => pickChip(id)} className={chipClass(chip === id)}>{name}</button>
  );

  const body = (
    <>
      <p className={dialog ? "text-[17px] text-slate-800" : "text-base text-slate-800"}>{t("items.starterBrowseHint")}</p>
      {result === undefined || setup === undefined ? <p role="status">{t("items.loading")}</p> : (
        <div className="flex flex-col gap-2">
          <div role="group" aria-label={t("items.starterCategories")} className="flex flex-wrap gap-2">
            {chipButton({ id: "all", name: t("items.starterAll") })}
            {chips.chosen.map(chipButton)}
            <button type="button" aria-pressed={chip === "more"} aria-expanded={moreOpen} onClick={() => pickChip("more")} className={chipClass(chip === "more")}>{t("setup.moreCategories")}</button>
          </div>
          {moreOpen && (
            <div role="group" aria-label={t("setup.moreCategories")} className="flex flex-wrap gap-2">
              {chips.more.map(chipButton)}
            </div>
          )}
          <label className="flex min-h-14 items-center gap-2 rounded-2xl border-[3px] border-slate-500 px-3">
            <Search size={24} aria-hidden="true" />
            <span className="sr-only">{t("items.starterSearch")}</span>
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("items.starterSearch")} className="min-w-0 flex-1 bg-transparent text-lg font-semibold outline-none" />
          </label>
          {items.map((item) => {
            if (isAdded(item)) {
              return (
                // Not a control: already in My items, so it cannot be ticked again.
                <div key={item.name} data-added="" className="flex min-h-14 items-center gap-3 rounded-2xl border-2 border-slate-300 bg-slate-50 px-3 text-lg font-extrabold text-slate-700">
                  <span className="min-w-0 flex-1 break-words">{item.name}</span>
                  <span className="shrink-0 rounded-full bg-slate-200 px-3 py-0.5 text-base font-bold text-slate-800">{t("items.added")}</span>
                </div>
              );
            }
            const checked = selected.has(item.name.toLowerCase());
            return (
              <button key={item.name} type="button" aria-pressed={checked} onClick={() => toggle(item)} className="flex min-h-14 items-center gap-3 rounded-2xl border-2 border-slate-500 bg-white px-3 text-left text-lg font-extrabold">
                <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg border-[3px] ${checked ? "border-emerald-900 bg-emerald-900 text-white" : "border-slate-500 bg-white"}`}>
                  {checked && <Check size={21} aria-hidden="true" />}
                </span>
                <span className="min-w-0 flex-1 break-words">{item.name}</span>
              </button>
            );
          })}
          {!items.length && searchText && <p className="rounded-xl border-2 border-slate-300 bg-white p-4 font-semibold">{t("items.starterNoMatch")}</p>}
        </div>
      )}
      <p className="text-sm text-slate-700">{t("items.priceLater")}</p>
      {error && <p role="alert" className="rounded-xl border-2 border-rose-900 bg-rose-100 p-3 font-semibold text-rose-950">{error}</p>}
      <PosPrimaryButton type="button" disabled={saving || result === undefined || selectedCount === 0} onClick={() => void addSelected()} className="mt-auto">
        {saving ? t("items.saving") : t(selectedCount === 1 ? "items.addOne" : "items.addCount", { count: selectedCount })}
      </PosPrimaryButton>
    </>
  );
  if (dialog) {
    return (
      <WideDialog labelledBy="starter-browse-title" onClose={() => { if (!saving) onBack(); }}>
        <div className="flex min-w-0 flex-col gap-3">
          <div className="flex items-center gap-3">
            <PosBackButton onClick={onBack} disabled={saving} />
            <h2 id="starter-browse-title" className="line-clamp-2 min-w-0 break-words text-2xl font-extrabold leading-tight">{t("items.starterBrowseTitle")}</h2>
          </div>
          {body}
        </div>
      </WideDialog>
    );
  }
  return (
    <PosPage className="flex flex-col gap-3">
      <ScreenHeader title={t("items.starterBrowseTitle")} onBack={onBack} />
      {body}
    </PosPage>
  );
}

// Wide D8 (wide_layout.screens "39, 40, 41 Items", list_with_detail): one page on the 39 route when the
// layout mode is not phone. Left: Find item and the rows (the list scrolls by itself). Right: Edit item
// or New item, the phone's own form (ItemEditor pane). The selection is this route's own params
// (itemsSelected: an item id or "new"), changed by replacing the current entry like Owed's, so it
// survives a trip away and Back. Nothing is selected on first opening.
// Add from starter list (36) and Delete item (42) are WideDialogs over this page.
// Unsaved changes: another row, New item or another page (the sidebar, onLeaveGuard) with
// values that differ from the saved ones asks the leave question first; with nothing changed it just goes.
function ItemsWide({ mode, params, onUpdateParams, onLeaveGuard }) {
  const [query, setQuery] = useState("");
  const [deleting, setDeleting] = useState(null);
  const [leaveAsk, setLeaveAsk] = useState(null);
  const [starterOpen, setStarterOpen] = useState(false);
  // The item whose Save just finished: its pane shows the quiet Saved line.
  const [justSaved, setJustSaved] = useState(null);
  const dirtyRef = useRef(false);
  function askFirst(proceed) {
    if (dirtyRef.current) setLeaveAsk({ proceed });
    else proceed();
  }
  const askRef = useRef(askFirst);
  askRef.current = askFirst;
  useEffect(() => {
    onLeaveGuard?.((proceed) => askRef.current(proceed));
    return () => onLeaveGuard?.(null);
  }, []);
  const blocked = Boolean(deleting || leaveAsk || starterOpen);
  const result = useActiveProducts();
  const filteredItems = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return (result?.products ?? []).filter((item) => item.name.toLowerCase().includes(normalizedQuery));
  }, [query, result]);
  const rail = mode !== "sidebar";
  const selected = params.itemsSelected;
  const ready = Boolean(result) && !result.error;
  const count = ready ? result.products.length : null;
  const select = (next) => { setJustSaved(null); onUpdateParams?.({ itemsSelected: next }); };
  // A row or New item: the one already shown does nothing; another asks first when there are changes.
  const choose = (next) => { if (next !== selected) askFirst(() => select(next)); };
  const onDirtyChange = (dirty) => { dirtyRef.current = dirty; };
  // After Save the saved item stays selected (a new item becomes its own Edit item) with the Saved line.
  const onSaved = (saved) => {
    if (!saved) return;
    onUpdateParams?.({ itemsSelected: saved.id });
    setJustSaved(saved.id);
  };

  return (
    <PosPage wide rail={rail} style={{ height: "100dvh" }} className="flex flex-col gap-5 tabular-nums">
      <div data-items-top="" inert={blocked || undefined} aria-hidden={blocked || undefined} className="flex min-w-0 items-center justify-between gap-4">
        <div className="flex min-w-0 items-baseline gap-3">
          <h1 className="text-[30px] font-bold leading-tight text-[#0F172A]">{t("items.title")}</h1>
          {count !== null && (
            <p data-items-count="" className="whitespace-nowrap text-[17px] text-slate-600">
              {rail ? <>{count}<span className="sr-only"> {t(count === 1 ? "items.countOne" : "items.countMany", { count }).replace(/^\d+ /, "")}</span></> : t(count === 1 ? "items.countOne" : "items.countMany", { count })}
            </p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <PosSecondaryButton type="button" aria-label={t("items.starterList")} onClick={() => setStarterOpen(true)} className="whitespace-nowrap">
            {rail ? t("items.starterShort") : t("items.starterList")}
          </PosSecondaryButton>
          <AddButton pressed={selected === "new"} onClick={() => choose("new")} className="w-auto! whitespace-nowrap">{t("items.new")}</AddButton>
        </div>
      </div>
      <div data-items-columns="" inert={blocked || undefined} aria-hidden={blocked || undefined} className="grid min-h-0 min-w-0 flex-1 gap-6" style={{ gridTemplateColumns: rail ? "260px minmax(0, 1fr)" : "clamp(340px, 36%, 400px) minmax(0, 1fr)" }}>
        <section data-items-list="" aria-label={t("items.title")} className="flex min-h-0 min-w-0 flex-col gap-3">
          <label className="flex min-h-14 shrink-0 items-center gap-2 rounded-2xl border-2 border-slate-500 bg-white px-3">
            <Search size={24} aria-hidden="true" />
            <span className="sr-only">{t("items.find")}</span>
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("items.find")} className="min-w-0 flex-1 bg-transparent text-lg font-semibold outline-none" />
          </label>
          {result === undefined ? (
            <p role="status" className="rounded-xl bg-slate-100 p-3 text-[17px] font-semibold">{t("items.loading")}</p>
          ) : result.error ? (
            <p role="alert" className="rounded-xl border-2 border-rose-900 bg-rose-100 p-3 text-[17px] font-semibold text-rose-950">{result.error}</p>
          ) : result.products.length === 0 ? (
            <p data-empty-hint="" className="text-[17px] font-semibold">{t("items.empty")}</p>
          ) : filteredItems.length ? (
            <div data-items-rows="" className="-m-1 flex min-h-0 flex-col gap-2 overflow-y-auto p-1">
              {filteredItems.map((item) => {
                const current = selected === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    data-item-row={item.id}
                    aria-current={current ? "true" : undefined}
                    onClick={() => choose(item.id)}
                    className={`flex min-h-[60px] shrink-0 items-center gap-3 rounded-2xl px-3 text-left ${current ? "border-[3px] border-emerald-900 bg-green-50" : "border-2 border-slate-300 bg-white hover:bg-slate-50"}`}
                  >
                    <strong className="min-w-0 flex-1 truncate text-[18px] font-bold text-[#0F172A]">{item.name}</strong>
                    <span className="shrink-0 text-[17px] font-bold text-[#0F172A]">
                      {item.default_price > 0 ? formatGhs(toPesewas(item.default_price)) : t("items.setPrice")}
                    </span>
                  </button>
                );
              })}
            </div>
          ) : (
            <p className="rounded-xl border-2 border-slate-300 bg-white p-4 text-[17px] font-semibold">{t("items.noMatches")}</p>
          )}
        </section>
        <div data-items-detail="" className="flex min-h-0 min-w-0 flex-col">
          {selected === "new" ? (
            <ItemEditor key="new" pane onSave={createProduct} onSaved={onSaved} onDirtyChange={onDirtyChange} />
          ) : Number.isSafeInteger(selected) ? (
            <EditItem key={selected} pane itemId={selected} savedNotice={justSaved === selected} onSaved={onSaved} onDirtyChange={onDirtyChange} onDelete={(item) => setDeleting({ id: item.id, name: item.name })} />
          ) : (
            // Nothing selected (first opening): only this plain text, no box; no item is chosen for the owner.
            <p data-items-choose="" className="px-2 py-6 text-[19px] font-semibold text-[#334155]">{t("items.choose")}</p>
          )}
        </div>
      </div>
      {deleting && (
        <DeleteItem
          dialog
          itemId={deleting.id}
          itemName={deleting.name}
          onBack={() => setDeleting(null)}
          onReturnToItems={() => { setDeleting(null); select(undefined); }}
          onDelete={removeProduct}
          returnFocus={`[data-item-row="${deleting.id}"]`}
        />
      )}
      {/* Add from starter list over the same page: the pane and any unsaved edit in it stay as they are. */}
      {starterOpen && <StarterBrowse dialog onBack={() => setStarterOpen(false)} onAdd={addStarterProducts} />}
      {leaveAsk && (
        <LeaveDraftDialog
          question={t("items.leaveQuestion")}
          onStay={() => setLeaveAsk(null)}
          onLeave={() => { const { proceed } = leaveAsk; setLeaveAsk(null); dirtyRef.current = false; proceed(); }}
        />
      )}
    </PosPage>
  );
}

export default function ItemScreens({ route, params = {}, onBack, onNavigate, onReturnToItems, onCompleteSetup, onUpdateParams, onLeaveGuard, wide = false, layoutMode = "phone" }) {
  if (wide && route === "MyItems") return <ItemsWide mode={layoutMode} params={params} onUpdateParams={onUpdateParams} onLeaveGuard={onLeaveGuard} />;
  if (route === "MyItems") return <MyItems onBack={onBack} onNavigate={onNavigate} />;
  if (route === "NewItem") return <ItemEditor onBack={onBack} onSave={createProduct} onNavigate={onNavigate} setupFlow={params.setupFlow === true} onCompleteSetup={onCompleteSetup} />;
  // Wide: 40 and 42 become 39 with the item selected (PosApp); nothing is drawn for the moment between.
  if (wide && (route === "EditItem" || route === "DeleteItem")) return null;
  if (route === "EditItem") {
    return <EditItem itemId={params.itemId} onBack={onBack} onNavigate={onNavigate} />;
  }
  if (route === "DeleteItem") {
    return <DeleteItem itemId={params.itemId} itemName={params.itemName ?? t("items.nameFallback")} onBack={onBack} onReturnToItems={onReturnToItems} onDelete={removeProduct} />;
  }
  if (route === "YourStarterListGrouped") return <StarterList grouped params={params} onBack={onBack} onAdd={addStarterProducts} onCompleteSetup={onCompleteSetup} />;
  if (route === "YourStarterList" && params.setupFlow !== true) return <StarterBrowse onBack={onBack} onAdd={addStarterProducts} />;
  if (route === "YourStarterList") return <StarterList params={params} onBack={onBack} onAdd={addStarterProducts} onCompleteSetup={onCompleteSetup} />;
  return null;
}

function EditItem({ itemId, onBack, onNavigate, pane = false, onSaved, onDelete, onDirtyChange, savedNotice = false }) {
  const item = useLiveQuery(() => Number.isSafeInteger(itemId) ? db.products.get(itemId) : null, [itemId], undefined);
  if (pane) {
    if (item === undefined) return <p role="status" className="text-[17px]">{t("items.loading")}</p>;
    if (!item || item.active === false) return <p role="alert" className="rounded-xl border-2 border-rose-900 bg-rose-100 p-3 text-[17px] font-semibold text-rose-950">{t("items.notFound")}</p>;
    return <ItemEditor key={item.id} pane item={item} savedNotice={savedNotice} onSave={(input) => updateProduct(item.id, input)} onSaved={onSaved} onDirtyChange={onDirtyChange} onDelete={() => onDelete?.(item)} />;
  }
  if (item === undefined) return <PosPage><p role="status">{t("items.loading")}</p></PosPage>;
  if (!item || item.active === false) {
    return <PosPage className="flex flex-col gap-3"><ScreenHeader title={t("items.title")} onBack={onBack} /><p role="alert" className="rounded-xl border-2 border-rose-900 bg-rose-100 p-3 font-semibold text-rose-950">{t("items.notFound")}</p></PosPage>;
  }
  return <ItemEditor key={item.id} item={item} onBack={onBack} onNavigate={onNavigate} onSave={(input) => updateProduct(item.id, input)} />;
}
