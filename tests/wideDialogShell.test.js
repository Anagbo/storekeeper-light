import assert from "node:assert/strict";
import { test } from "node:test";
import { FOCUSABLE, focusElement, mainHeading, openerSelector, returnFocusTarget, trapTabTarget } from "../src/pos/dialogFocus.js";
import { flushEffects, loadJsx, render, walk } from "./helpers/renderJsx.js";

// wide_layout.page_types.dialog: the shared WideDialog shell. Focus returns to the opener; when the
// opener is not on the page behind, to that page's main heading. Tab stays inside. Escape and a click on
// the scrim are onClose, for the top dialog only.

// A small DOM-like element: enough for the focus helpers.
function el(tagName, { attrs = {}, connected = true, disabled = false, inside = null } = {}) {
  const node = {
    tagName,
    disabled,
    isConnected: connected,
    attrs: { ...attrs },
    focused: 0,
    hasAttribute(name) { return name in this.attrs; },
    getAttribute(name) { return this.attrs[name] ?? null; },
    setAttribute(name, value) { this.attrs[name] = String(value); },
    closest(selector) { return inside && selector.split(",").some((part) => part.trim() === inside) ? {} : null; },
    focus() { this.focused += 1; }
  };
  return node;
}
function doc(matches) {
  return { body: el("BODY"), querySelectorAll: (selector) => matches[selector] ?? [] };
}

test("focus returns to the opener while it is on the page", () => {
  const opener = el("BUTTON", { attrs: { "aria-label": "Pay Kofi" } });
  assert.equal(returnFocusTarget({ opener, selector: openerSelector(opener), doc: doc({}) }), opener);
});

test("a redrawn opener is found again by its label or tile", () => {
  const gone = el("BUTTON", { attrs: { "aria-label": "Quantity Cabbage" }, connected: false });
  const again = el("BUTTON", { attrs: { "aria-label": "Quantity Cabbage" } });
  const selector = openerSelector(gone);
  assert.equal(selector, '[aria-label="Quantity Cabbage"]');
  assert.equal(returnFocusTarget({ opener: gone, selector, doc: doc({ [selector]: [again] }) }), again);
  assert.equal(openerSelector(el("BUTTON", { attrs: { "data-item-tile": "Okra" } })), '[data-item-tile="Okra"]');
});

test("an opener that is not on the page behind: focus goes to that page's main heading", () => {
  const heading = el("H1");
  const inDialog = el("H1", { inside: "[data-wide-dialog-scrim]" });
  const pages = doc({ "[data-page-area] h1, main h1": [inDialog, heading] });
  const gone = el("BUTTON", { attrs: { "aria-label": "Collect from Ama" }, connected: false });
  assert.equal(returnFocusTarget({ opener: gone, selector: openerSelector(gone), doc: pages }), heading);
  // No opener at all (focus was on the page body) and an opener behind an inert layer.
  assert.equal(returnFocusTarget({ opener: pages.body, selector: null, doc: pages }), heading);
  assert.equal(returnFocusTarget({ opener: el("BUTTON", { inside: "[inert]" }), selector: null, doc: pages }), heading);
  assert.equal(mainHeading(doc({})), null);
  // A heading takes focus without becoming a Tab stop.
  focusElement(heading);
  assert.equal(heading.getAttribute("tabindex"), "-1");
  assert.equal(heading.focused, 1);
});

test("Tab stays inside: last to first, Shift+Tab first to last, back inside from outside", () => {
  const [a, b, c] = [el("BUTTON"), el("INPUT"), el("BUTTON")];
  const items = [a, b, c];
  assert.equal(trapTabTarget(items, c, { shift: false }), a);
  assert.equal(trapTabTarget(items, a, { shift: true }), c);
  assert.equal(trapTabTarget(items, b, { shift: false }), null);
  assert.equal(trapTabTarget(items, null, { inside: false }), a);
  assert.equal(trapTabTarget(items, null, { inside: false, shift: true }), c);
  assert.equal(trapTabTarget([], a), null);
  assert.match(FOCUSABLE, /button:not\(\[disabled\]\)/);
});

test("WideDialog: 520px over a dark scrim; Escape and a scrim click are onClose, top dialog only", async () => {
  const listeners = [];
  globalThis.window = { addEventListener: (type, fn) => type === "keydown" && listeners.push(fn), removeEventListener: (type, fn) => { const i = listeners.indexOf(fn); if (i >= 0) listeners.splice(i, 1); } };
  try {
    const { default: WideDialog } = await loadJsx("src/pos/WideDialog.jsx");
    const closed = [];
    let showTop = true;
    const App = () => ({
      type: "div",
      props: {
        children: [
          { type: WideDialog, props: { labelledBy: "under-title", onClose: () => closed.push("under"), children: { type: "h2", props: { id: "under-title", children: "Under" } } } },
          showTop ? { type: WideDialog, props: { role: "alertdialog", label: "Top", onClose: () => closed.push("top"), children: "Top" } } : null
        ]
      }
    });
    const view = render({ type: App, props: {} }, { unmount: true });
    flushEffects(view, { tracked: true });
    const sections = [...walk(view.tree)].filter((node) => node.type === "section");
    assert.equal(sections.length, 2);
    assert.match(sections[0].props.className, /w-\[520px\]/);
    assert.equal(sections[0].props["aria-labelledby"], "under-title");
    assert.equal(sections[0].props["aria-label"], undefined);
    assert.equal(sections[1].props.role, "alertdialog");
    assert.equal(sections[1].props["aria-label"], "Top");
    const scrims = [...walk(view.tree)].filter((node) => node.props?.["data-wide-dialog-scrim"] !== undefined);
    assert.match(scrims[0].props.className, /bg-slate-950\/60/);

    const press = (key) => { for (const fn of [...listeners]) fn({ key, preventDefault() {} }); };
    press("Escape");
    assert.deepEqual(closed, ["top"], "only the top dialog answers Escape");
    // A click on the panel is not a click on the scrim.
    scrims[1].props.onMouseDown({ target: "panel", currentTarget: "scrim" });
    assert.deepEqual(closed, ["top"]);
    showTop = false;
    view.rerender();
    flushEffects(view, { tracked: true });
    press("Escape");
    assert.deepEqual(closed, ["top", "under"], "once the top one closes, the one under it answers");
    scrims[0].props.onMouseDown({ target: "scrim", currentTarget: "scrim" });
    assert.deepEqual(closed, ["top", "under", "under"]);
  } finally {
    delete globalThis.window;
  }
});
