import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";
import { db } from "../src/db/db.js";
import { tidyPersonName } from "../src/lib/personName.js";
import { localDateString } from "../src/utils/installments.js";
import { browser, waitFor, withEdgeApp } from "./helpers/edgeApp.js";
import { ENV } from "./helpers/lookChecks.js";
import { loadJsx, render, setLiveQuery, textOf, walk } from "./helpers/renderJsx.js";

// rules_global.form_fields (25 Nov 2026, real-phone review): person and supplier name and phone fields
// have autocomplete off (the keyboard must not offer the owner's own number or a saved name), names
// capitalise each word and are tidied on save, phones keep the phone keypad; date fields are light,
// Pay by cannot be before today, and an empty date shows "Choose a date".

globalThis.HTMLElement ??= class {};
after(async () => { setLiveQuery(null); db.close(); await db.delete(); });
beforeEach(async () => {
  setLiveQuery(null);
  await Promise.all([db.debts, db.customers, db.transactions, db.payments].map((table) => table.clear()));
});

const inputs = (tree) => [...walk(tree)].filter((node) => node.type === "input");
const settle = async () => { for (let i = 0; i < 10; i += 1) await new Promise((resolve) => setTimeout(resolve, 3)); };

test("tidyPersonName: a capital first letter per word, spaces tidied, the rest kept", () => {
  assert.equal(tidyPersonName("kennedy junior Anagbo"), "Kennedy Junior Anagbo");
  assert.equal(tidyPersonName("  ama   owusu "), "Ama Owusu");
  assert.equal(tidyPersonName("kofi McDonald"), "Kofi McDonald");
  assert.equal(tidyPersonName("abena boateng-mensah"), "Abena Boateng-Mensah");
  assert.equal(tidyPersonName(""), "");
});

test("New person: name and phone have autocomplete off; the name capitalises words; the phone keypad stays; Next saves the tidied name", async () => {
  const { default: CreditScreens } = await loadJsx("src/pos/CreditScreens.jsx");
  const navigated = [];
  const view = render({ type: CreditScreens, props: { route: "NewPerson", params: { manualDebt: true }, onBack() {}, onNavigate: (...args) => navigated.push(args), onUpdateParams() {} } });
  const [name, phone] = inputs(view.tree);
  assert.equal(name.props.autoComplete, "off");
  assert.equal(name.props.autoCapitalize, "words");
  assert.equal(phone.props.autoComplete, "off");
  assert.equal(phone.props.type, "tel");
  assert.equal(phone.props.inputMode, "tel");
  name.props.onChange({ target: { value: "kennedy junior Anagbo" } });
  view.rerender();
  await settle();
  view.rerender();
  [...walk(view.tree)].find((node) => node.type === "form").props.onSubmit({ preventDefault() {} });
  assert.equal(navigated[0][1].customer.name, "Kennedy Junior Anagbo");
  assert.equal(navigated[0][1].customer.nameLower, "kennedy junior anagbo");
});

test("Stock on credit: supplier name and phone autocomplete off, name words, Pay by min today with Choose a date; the saved name is tidied", async () => {
  const { StockOnCredit } = await loadJsx("src/pos/SupplierScreens.jsx");
  setLiveQuery(() => []);
  const saved = [];
  const view = render({ type: StockOnCredit, props: { params: { amountPesewas: 8000, category: "stock" }, onBack() {}, onUpdateParams() {}, onSaveExpense: async (details) => { saved.push(details); } } });
  const fields = inputs([...walk(view.tree)].find((node) => node.props?.["data-new-supplier-fields"] !== undefined));
  assert.equal(fields[0].props.autoComplete, "off");
  assert.equal(fields[0].props.autoCapitalize, "words");
  assert.equal(fields[1].props.autoComplete, "off");
  assert.equal(fields[1].props.inputMode, "tel");
  const payBy = inputs(view.tree).find((node) => node.props.type === "date");
  assert.equal(payBy.props.min, localDateString());
  const placeholder = [...walk(view.tree)].find((node) => node.props?.["data-date-placeholder"] !== undefined);
  assert.equal(textOf(placeholder), "Choose a date");
  payBy.props.onChange({ target: { value: localDateString() } });
  view.rerender();
  assert.equal([...walk(view.tree)].find((node) => node.props?.["data-date-placeholder"] !== undefined), undefined, "a chosen date hides the hint");
  fields[0].props.onChange({ target: { value: "kofi   wholesale" } });
  view.rerender();
  await [...walk(view.tree)].find((node) => node.type === "button" && textOf(node).trim() === "Save").props.onClick();
  assert.equal(saved[0].newSupplier.name, "Kofi Wholesale");
});

test("the contact editor phone has autocomplete off and the phone keypad", async () => {
  const { default: CustomerContactEditor } = await loadJsx("src/pos/CustomerContactEditor.jsx");
  const view = render({ type: CustomerContactEditor, props: { customer: { id: "c1", name: "Ama", phone: "" }, onClose() {}, onSave: async () => {} } });
  const phone = inputs(view.tree).find((node) => node.props.type === "tel");
  assert.equal(phone.props.autoComplete, "off");
  assert.equal(phone.props.inputMode, "tel");
});

test("Edge 390: Pay by is a light date picker and shows Choose a date while empty", { skip: browser ? false : "no Chrome or Edge found (set HEADER_TEST_BROWSER)", timeout: 300_000 }, async () => {
  await withEdgeApp({ seeds: { fields: `await setPreference("posSetupCompleted", true);` }, env: ENV }, async (app) => {
    await app.open("fields", 390, 800);
    await app.steps(["^Spent money", "type:10", "^Stock$", "^No$"]);
    const look = await waitFor(() => app.evaluate(`(() => {
      const input = document.querySelector("main input[type=date]");
      const hint = document.querySelector("[data-date-placeholder]");
      if (!input || !hint) return null;
      const r = input.getBoundingClientRect(); const h = hint.getBoundingClientRect();
      return { scheme: getComputedStyle(input).colorScheme, hint: hint.textContent, hintVisible: getComputedStyle(hint).display !== "none", inside: h.top >= r.top && h.bottom <= r.bottom, text: getComputedStyle(input).color };
    })()`), "Pay by");
    assert.equal(look.scheme, "light");
    assert.equal(look.hint, "Choose a date");
    assert.equal(look.hintVisible, true);
    assert.equal(look.inside, true, "the hint sits inside the field");
    assert.match(look.text, /rgba\(0, 0, 0, 0\)|transparent/, "the browser's own empty text is hidden under the hint");
  });
});
