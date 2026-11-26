import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";
import { db } from "../src/db/db.js";
import { resetBrowserBack } from "../src/pos/browserBack.js";
import { loadJsx, render, setLiveQuery, textOf, walk } from "./helpers/renderJsx.js";

// Phone validation (26 Nov 2026): every phone field (New supplier, New person, the contact editor) is
// checked on leaving the field and on Save, never while typing; a bad number blocks Save, shows the
// message under the field with aria-invalid and aria-describedby, and the message goes once it is valid.

globalThis.HTMLElement ??= class {};
const MESSAGE = "Enter a valid mobile number, like 024 123 4567";

after(async () => {
  setLiveQuery(null);
  db.close();
  await db.delete();
});
beforeEach(() => { resetBrowserBack(); setLiveQuery(null); });

const nodes = (tree) => [...walk(tree)].filter((node) => node.props);
const phoneInput = (tree) => nodes(tree).find((node) => node.type === "input" && node.props.type === "tel");
const phoneError = (tree) => nodes(tree).find((node) => node.props["data-phone-error"] !== undefined);
const buttons = (tree) => nodes(tree).filter((node) => node.type === "button" || (typeof node.type === "function" && /Button$/.test(node.type.name)));
function type(view, value) { phoneInput(view.tree).props.onChange({ target: { value } }); view.rerender(); }
function leave(view) { phoneInput(view.tree).props.onBlur({}); view.rerender(); }

const FORMS = {
  "New supplier": async (saved) => {
    const { StockOnCredit } = await loadJsx("src/pos/SupplierScreens.jsx");
    setLiveQuery(() => []);
    const view = render({ type: StockOnCredit, props: { params: { amountPesewas: 8000, category: "stock", stockSupplierName: "Kofi Wholesale" }, onBack() {}, onUpdateParams() {}, onSaveExpense: async (entry) => { saved.push(entry); } } });
    return { view, save: () => { buttons(view.tree).find((node) => textOf(node).trim() === "Save").props.onClick({ preventDefault() {} }); view.rerender(); } };
  },
  "New person": async (saved) => {
    const { default: CreditScreens } = await loadJsx("src/pos/CreditScreens.jsx");
    const view = render({ type: CreditScreens, props: { route: "NewPerson", params: { manualDebt: true, newPersonName: "Ama" }, onBack() {}, onNavigate: (route, params) => saved.push(params), onUpdateParams() {} } });
    return { view, save: () => { nodes(view.tree).find((node) => node.type === "form").props.onSubmit({ preventDefault() {} }); view.rerender(); } };
  },
  "Contact editor": async (saved) => {
    const { default: CustomerContactEditor } = await loadJsx("src/pos/CustomerContactEditor.jsx");
    const view = render({ type: CustomerContactEditor, props: { customer: { id: 1, name: "Kofi", phone: "" }, onClose() {}, onSave: async (entry) => { saved.push(entry); } } });
    return { view, save: () => { nodes(view.tree).find((node) => node.type === "form").props.onSubmit({ preventDefault() {} }); view.rerender(); } };
  }
};

for (const [name, open] of Object.entries(FORMS)) {
  test(`${name}: no message while typing; message on leaving and on Save; Save blocked; gone once valid`, async () => {
    const saved = [];
    const { view, save } = await open(saved);
    type(view, "024");
    assert.equal(phoneError(view.tree), undefined, "not while typing the first digits");
    assert.notEqual(phoneInput(view.tree).props["aria-invalid"], true);
    leave(view);
    assert.equal(textOf(phoneError(view.tree)).trim(), MESSAGE, "shown on leaving the field");
    const input = phoneInput(view.tree);
    assert.equal(input.props["aria-invalid"], true);
    assert.equal(input.props["aria-describedby"], phoneError(view.tree).props.id, "message linked to the field");
    assert.match(input.props.className, /border-rose-900/);
    assert.equal(input.props.inputMode, "tel", "keypad stays numeric");

    type(view, "369999955258444785");
    save();
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(saved.length, 0, "a bad number saves nothing");
    assert.equal(textOf(phoneError(view.tree)).trim(), MESSAGE);
    assert.equal(phoneInput(view.tree).props.value, "369999955258444785", "what was typed stays visible");

    type(view, "024 123 4567");
    assert.equal(phoneError(view.tree), undefined, "gone as soon as it is valid");
    assert.doesNotMatch(phoneInput(view.tree).props.className, /border-rose-900/);
  });
}

test("Save with an empty phone is not blocked by the phone check (the field is optional)", async () => {
  for (const open of Object.values(FORMS)) {
    const saved = [];
    const { view, save } = await open(saved);
    save();
    assert.equal(phoneError(view.tree), undefined);
  }
});
