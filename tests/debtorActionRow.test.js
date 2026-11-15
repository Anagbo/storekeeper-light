import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { browser, appCss, measureInFrames, toHtml } from "./helpers/browserLayout.js";
import { loadJsx, render, setLiveQuery, textOf, walk } from "./helpers/renderJsx.js";

// Wiring 29 and 43 "Action buttons" (phone test at 360px, 14 Nov 2026), and the owner's answer for no
// valid phone (14 Nov 2026):
// 29 (on time): Collect | WhatsApp | Call in ONE row of three equal columns, icon above the label,
//   48px or taller, at 340px and wider; never wrapped, Call never alone on a second row.
// 43 (late): the wide WhatsApp reminder on top, then Collect | Call side by side.
// No valid phone: WhatsApp stays on and opens the share sheet with the reminder text (the owner picks
//   the chat), Call is greyed and disabled, and Add contact is not in the row (Edit contact in the header).

const OFF = {};
const ON = { VITE_ENABLE_POS_RECEIPTS: "true" };
const PHONE = "+233241234567";

const dayOffset = (days) => {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
};
const SCREENS = { 29: dayOffset(7), 43: dayOffset(-3) };

function debtorData(dueDate, phone, name = "Ama") {
  const debt = { id: "d1", customerId: "c1", customerName: name, amountPesewas: 8000, status: "unpaid", isInstallmentPlan: false, dueDate };
  return { name, customerId: "c1", phone, ghanaCardNumber: "", balancePesewas: 8000, debt, unpaidDebts: [debt], unpaidDebtCount: 1, history: [] };
}

async function detail({ screen, phone, env = OFF, name }) {
  const { DebtorDetail } = await loadJsx("src/pos/DebtCollection.jsx", env);
  const data = debtorData(SCREENS[screen], phone, name);
  setLiveQuery(([debtId]) => (debtId === "d1" ? data : undefined));
  try {
    return render({ type: DebtorDetail, props: { params: { debtId: "d1", customerName: data.name }, onBack() {}, onNavigate() {}, onCollect() {}, shopName: "My shop" } });
  } finally {
    setLiveQuery(null);
  }
}

const row = (tree) => [...walk(tree)].find((node) => node.props?.["data-row"] === "debtor-actions");
const cells = (rowNode) => [rowNode.props.children].flat(Infinity).filter((child) => child && typeof child === "object");
const reminderOnTop = (tree) => [...walk(tree)].find((node) => (node.type === "a" || node.type === "button") && textOf(node).includes("Send reminder on WhatsApp"));

function assertCall(cell, phone, where) {
  assert.equal(textOf(cell).trim(), "Call", `${where}: Call`);
  if (phone) {
    assert.equal(cell.type, "a", `${where}: Call is a link`);
    assert.equal(cell.props.href, `tel:${phone}`);
  } else {
    assert.equal(cell.type, "button", `${where}: Call without a phone is a button`);
    assert.equal(cell.props.disabled, true, `${where}: Call is disabled`);
    assert.match(cell.props.className, /bg-slate-100/, `${where}: Call is greyed`);
    assert.match(cell.props.className, /text-slate-500/);
  }
}

for (const env of [OFF, ON]) {
  const flag = env === ON ? "receipts on" : "receipts off";
  for (const phone of [PHONE, ""]) {
    const who = phone ? "with a phone" : "with no phone";

    test(`29 ${who}, ${flag}: Collect | WhatsApp | Call in one 3-column row, icon above the label`, async () => {
      const view = await detail({ screen: 29, phone, env });
      const actions = row(view.tree);
      assert.ok(actions, "the action row");
      assert.match(actions.props.className, /(^|\s)grid-cols-3(\s|$)/);
      assert.doesNotMatch(actions.props.className, /grid-cols-[124]|sm:grid-cols|flex-wrap/, "one fixed 3-column grid at every width");
      const [collect, whatsapp, call, ...rest] = cells(actions);
      assert.equal(rest.length, 0, "exactly three buttons");
      assert.equal(textOf(collect).trim(), "Collect");
      assert.equal(textOf(whatsapp).trim(), "Reminder");
      assert.equal(whatsapp.props["aria-label"], "WhatsApp reminder for Ama");
      assertCall(call, phone, "29");
      for (const cell of [collect, whatsapp, call]) {
        assert.match(cell.props.className, /flex-col/, "icon above the label");
        assert.match(cell.props.className, /min-h-16/, "64px, more than 48px");
        assert.match(cell.props.className, /whitespace-nowrap/);
      }
      if (phone) {
        assert.equal(whatsapp.type, "a");
        assert.match(whatsapp.props.href, /^https:\/\/wa\.me\/233241234567\?text=Hello/);
      } else {
        assert.equal(whatsapp.type, "button", "share sheet button");
        assert.notEqual(whatsapp.props.disabled, true, "WhatsApp stays enabled with no phone");
      }
      assert.doesNotMatch(textOf(actions), /Add contact|Edit contact/, "no Add contact in the row");
      assert.equal(reminderOnTop(view.tree), undefined, "29 has no wide late reminder");
      if (env === ON) assert.ok(!cells(actions).some((cell) => /Receipt/.test(textOf(cell))), "Receipt has its own row");
    });

    test(`43 ${who}, ${flag}: the wide WhatsApp reminder on top, then Collect | Call`, async () => {
      const view = await detail({ screen: 43, phone, env });
      const top = reminderOnTop(view.tree);
      assert.ok(top, "Send reminder on WhatsApp");
      assert.match(top.props.className, /w-full/);
      if (phone) assert.equal(top.type, "a");
      else {
        assert.equal(top.type, "button", "share sheet button");
        assert.notEqual(top.props.disabled, true, "WhatsApp stays enabled with no phone");
      }
      const actions = row(view.tree);
      assert.match(actions.props.className, /(^|\s)grid-cols-2(\s|$)/);
      assert.doesNotMatch(actions.props.className, /grid-cols-[134]|sm:grid-cols|flex-wrap/);
      const [collect, call, ...rest] = cells(actions);
      assert.equal(rest.length, 0, "exactly two buttons");
      assert.equal(textOf(collect).trim(), "Collect");
      assertCall(call, phone, "43");
      assert.doesNotMatch(textOf(actions), /Add contact|Edit contact|Reminder/);
      // The reminder comes before the row in the page.
      const order = [...walk(view.tree)];
      assert.ok(order.indexOf(top) < order.indexOf(actions), "the reminder is above Collect and Call");
    });
  }
}

test("no phone: WhatsApp on 29 and on 43 opens the share sheet with the reminder text", async () => {
  const shared = [];
  const original = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: { userAgent: "Android", share: async (data) => { shared.push(data); } } });
  const errors = [];
  const originalError = console.error;
  console.error = (...args) => errors.push(args);
  after(() => {
    console.error = originalError;
    if (original) Object.defineProperty(globalThis, "navigator", original);
    else delete globalThis.navigator;
  });
  for (const screen of [29, 43]) {
    const view = await detail({ screen, phone: "" });
    const button = screen === 29 ? cells(row(view.tree))[1] : reminderOnTop(view.tree);
    await button.props.onClick();
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.equal(shared.length, 2);
  for (const data of shared) {
    assert.equal(data.text, "Hello *Ama*, this is a gentle reminder from *My shop* regarding your outstanding balance of *GH₵80.00*. Kindly arrange payment at your earliest convenience. Thank you!");
    assert.doesNotMatch(JSON.stringify(data), /wa\.me|phone=/, "no number: the owner picks the chat");
  }
});

// ---- a real browser at 340, 360 and 393px --------------------------------------------------------------

const WIDTHS = [340, 360, 393];
const MEASURE = `(frame, win, doc) => {
  const row = doc.querySelector('[data-row="debtor-actions"]');
  const cells = [...row.children].map((el) => {
    const r = el.getBoundingClientRect();
    const label = el.querySelector("span");
    const icon = el.querySelector("svg");
    return {
      tag: el.tagName.toLowerCase(), text: el.textContent.trim(), disabled: el.disabled === true,
      top: r.top, left: r.left, right: r.right, width: r.width, height: r.height,
      labelFits: label ? label.scrollWidth <= label.clientWidth + 0.5 && label.getBoundingClientRect().right <= r.right + 0.5 && label.getBoundingClientRect().left >= r.left - 0.5 : true,
      iconAbove: icon && label ? icon.getBoundingClientRect().bottom <= label.getBoundingClientRect().top + 1 : false,
      overflowX: el.scrollWidth > el.clientWidth + 0.5
    };
  });
  const rr = row.getBoundingClientRect();
  const reminder = [...doc.querySelectorAll("a, button")].find((el) => el.textContent.includes("Send reminder on WhatsApp"));
  return {
    cells, rowLeft: rr.left, rowRight: rr.right, rowTop: rr.top,
    reminderBottom: reminder ? reminder.getBoundingClientRect().bottom : null,
    pageOverflow: doc.scrollingElement.scrollWidth > win.innerWidth
  };
}`;

test("at 340, 360 and 393px: no wrapping, no overflow, equal columns, icon above the label, Call disabled without a number", { skip: browser ? false : "no Chrome or Edge found (set HEADER_TEST_BROWSER)" }, async () => {
  const pages = [];
  for (const screen of [29, 43]) {
    for (const phone of [PHONE, ""]) {
      for (const env of [OFF, ON]) {
        // A long name too, so nothing in the header pushes the row wider.
        const view = await detail({ screen, phone, env, name: "Akosua Mensah-Boateng" });
        pages.push({ name: `${screen}|${phone ? "phone" : "none"}|${env === ON ? "on" : "off"}`, html: toHtml(view.tree) });
      }
    }
  }
  const results = measureInFrames({ pages, css: await appCss(), widths: WIDTHS, measure: MEASURE });
  assert.equal(results.length, pages.length * WIDTHS.length);
  for (const result of results) {
    const [screen, phone] = result.page.split("|");
    const where = `${result.page} at ${result.width}px`;
    assert.equal(result.innerWidth, result.width, `${where}: the frame is that wide`);
    assert.equal(result.pageOverflow, false, `${where}: no horizontal page scroll`);
    const expected = screen === "29" ? ["Collect", "Reminder", "Call"] : ["Collect", "Call"];
    assert.deepEqual(result.cells.map((cell) => cell.text), expected, where);
    const [first] = result.cells;
    for (const cell of result.cells) {
      assert.ok(Math.abs(cell.top - first.top) < 1, `${where}: ${cell.text} is on the same row (no wrap)`);
      assert.ok(Math.abs(cell.width - first.width) < 1, `${where}: ${cell.text} has an equal column (${cell.width} vs ${first.width})`);
      assert.ok(cell.height >= 48, `${where}: ${cell.text} is ${cell.height}px tall`);
      assert.ok(cell.left >= result.rowLeft - 0.5 && cell.right <= result.rowRight + 0.5, `${where}: ${cell.text} inside the row`);
      assert.ok(cell.labelFits, `${where}: the ${cell.text} label is not clipped`);
      assert.equal(cell.overflowX, false, `${where}: ${cell.text} does not overflow`);
      assert.ok(cell.iconAbove, `${where}: the ${cell.text} icon is above its label`);
    }
    const call = result.cells.at(-1);
    assert.equal(call.disabled, phone === "none", `${where}: Call disabled only without a number`);
    if (screen === "43") assert.ok(result.reminderBottom !== null && result.reminderBottom <= result.rowTop, `${where}: the wide reminder is above the row`);
  }
});
