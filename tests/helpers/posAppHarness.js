// Drives the real PosApp (src/pos/PosApp.jsx) in a test: the real screens, the real route state
// and save handlers, the real writers on fake-indexeddb, the phone back controller on a fake
// window.history. Screens mount and unmount as in the app (render with { unmount: true }) and
// effects run only when their deps change (flushEffects tracked), as React runs them.
import { flushEffects, loadJsx, render, textOf, walk } from "./renderJsx.js";

function fakeHistory() {
  return {
    entries: [{ state: null }],
    index: 0,
    get state() { return this.entries[this.index].state; },
    pushState(state) { this.entries.splice(this.index + 1); this.entries.push({ state }); this.index += 1; },
    replaceState(state) { this.entries[this.index] = { state }; },
    back() {
      if (this.index === 0) return;
      this.index -= 1;
      for (const listener of window.__listeners.popstate ?? []) listener({ state: this.state });
    }
  };
}

// width: the window width layout.js reads (no width = the phone, as before).
function installWindow(width) {
  const listeners = {};
  globalThis.window = {
    __listeners: listeners,
    ...(width === undefined ? {} : { innerWidth: width }),
    history: fakeHistory(),
    location: { href: "http://localhost/" },
    addEventListener(type, listener) { (listeners[type] ??= []).push(listener); },
    removeEventListener(type, listener) { listeners[type] = (listeners[type] ?? []).filter((item) => item !== listener); },
    setInterval() { return 0; },
    clearInterval() {}
  };
  globalThis.document ??= { visibilityState: "visible", addEventListener() {}, removeEventListener() {} };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 2));

// Phone request is on by default here so 61 still asks when the owner has to choose; pass { env: {} } for it off.
export async function openPosApp({ env = { VITE_ENABLE_MOMO_PHONE_REQUEST: "true" }, width } = {}) {
  installWindow(width);
  const errors = [];
  const warnings = [];
  const originalError = console.error;
  const originalWarn = console.warn;
  console.error = (...args) => { errors.push(args); };
  console.warn = (...args) => { warnings.push(args); };
  const { default: PosApp } = await loadJsx("src/pos/PosApp.jsx", env);
  const view = render({ type: PosApp, props: {} }, { unmount: true });

  const app = {
    view,
    errors,
    warnings,
    restoreConsole() { console.error = originalError; console.warn = originalWarn; },
    // Render, run the effects, let the database and the lazy screens finish. A save in progress
    // holds the phone's back button (browserBack.js), so wait until nothing holds it and the
    // screen has stopped changing; give up after about 20 seconds.
    async settle(rounds = 20) {
      let stable = 0;
      let last = "";
      for (let index = 0; index < 10_000 && stable < rounds; index += 1) {
        view.rerender();
        flushEffects(view, { tracked: true });
        await tick();
        const now = `${app.route}|${app.text()}`;
        const saving = (globalThis.__posBrowserBack?.blockers ?? 0) > 0;
        stable = !saving && now === last ? stable + 1 : 0;
        last = now;
      }
      view.rerender();
      return app;
    },
    get state() { return view.instances.get("root>PosApp").hooks[0].value; },
    get route() { return app.state.current; },
    get params() { return app.state.params; },
    text() { return textOf(view.tree); },
    // The innermost button whose visible text (or accessible name) matches.
    button(label) {
      let found = null;
      for (const node of walk(view.tree)) {
        const isButton = node.type === "button" || (typeof node.type === "function" && /Button$/.test(node.type.name));
        if (!isButton) continue;
        const text = textOf(node).trim();
        const name = node.props?.["aria-label"];
        const matches = label instanceof RegExp ? label.test(text) || (name && label.test(name)) : text === label || name === label;
        if (matches) found = node;
      }
      if (!found) throw new Error(`No button "${label}" on ${app.route}: ${app.text().slice(0, 400)}`);
      return found;
    },
    async tap(label) {
      const button = app.button(label);
      if (button.props.disabled) throw new Error(`Button "${label}" is disabled on ${app.route}`);
      await button.props.onClick?.({ preventDefault() {}, stopPropagation() {} });
      return app.settle();
    },
    input(name) {
      for (const node of walk(view.tree)) {
        if (node.type === "input" && (node.props?.["aria-label"] === name || node.props?.id === name)) return node;
      }
      throw new Error(`No input "${name}" on ${app.route}`);
    },
    // The amount a keypad screen shows, by the output's accessible name (26 since 15 Nov 2026).
    amountShown(name) {
      for (const node of walk(view.tree)) {
        if (node.type === "output" && node.props?.["aria-label"] === name) return textOf(node);
      }
      throw new Error(`No amount "${name}" on ${app.route}`);
    },
    async type(name, value) {
      app.input(name).props.onChange({ target: { value } });
      return app.settle();
    },
    async keys(digits) {
      for (const digit of digits) await app.tap(digit);
      return app;
    },
    // The Menu drawer (wiring 23): the dialog named Menu, or null when it is closed.
    drawer() {
      return [...walk(view.tree)].find((node) => node.type === "aside" && node.props?.role === "dialog" && node.props?.["aria-label"] === "Menu") ?? null;
    },
    // Header Menu button, then a row in the drawer (Home, Today’s transactions, My money, Items, Settings).
    // Menu > Home is the old header Home: it leaves the draft (asks first when MoMo was received).
    async menu(row) {
      await app.tap("Open menu");
      const drawer = app.drawer();
      if (!drawer) throw new Error(`The Menu drawer did not open on ${app.route}`);
      const button = [...walk(drawer)].find((node) => node.type === "button" && textOf(node).startsWith(row));
      if (!button) throw new Error(`No row "${row}" in the Menu drawer`);
      await button.props.onClick();
      return app.settle();
    },
    // The wide rail or sidebar (layout.js), or null in the phone layout.
    sideNav() {
      return [...walk(view.tree)].find((node) => node.type === "nav" && node.props?.["data-side-nav"]) ?? null;
    },
    // A sidebar or rail row by its route (Home, Sell, PeopleWhoOweYou, TodaysTransactions, MyMoney, MyItems,
    // SettingsProfitTools).
    async side(route) {
      const nav = app.sideNav();
      const row = nav && [...walk(nav)].find((node) => node.type === "button" && node.props?.["data-side-row"] === route);
      if (!row) throw new Error(`No sidebar row "${route}" on ${app.route}`);
      await row.props.onClick();
      return app.settle();
    },
    // Home from any screen, as the owner can: Menu > Home where the header has the Menu button; the
    // header Home tile where the header has it instead (26, 27 for a collection, 28, 29, 72, 73); the
    // sidebar's Home on wide screens.
    async goHome() {
      const hasMenu = [...walk(view.tree)].some((node) => node.type === "button" && node.props?.["aria-label"] === "Open menu");
      if (hasMenu) return app.menu("Home");
      if (app.sideNav()) return app.side("Home");
      const header = [...walk(view.tree)].find((node) => node.type === "header");
      const home = header && [...walk(header)].find((node) => node.type === "button" && node.props?.["aria-label"] === "Home");
      if (!home) throw new Error(`No way Home on ${app.route}`);
      await home.props.onClick();
      return app.settle();
    },
    // The phone's back button.
    async phoneBack() {
      window.history.back();
      return app.settle();
    }
  };
  await app.settle();
  return app;
}