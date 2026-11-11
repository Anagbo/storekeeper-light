import { useEffect, useRef } from "react";

// The phone's back button (and the browser or swipe back gesture) does what the on-screen Back does.
//
// The in-app stack (PosApp routeState.history) stays the one source of truth. The browser holds the
// page entry plus at most ONE extra "guard" entry, pushed whenever there is somewhere to go back to
// (a screen other than Home, a non-empty stack, or an open sheet). A back press pops the guard and
// fires popstate on the page entry; the handler runs the in-app back and pushes the guard again if it
// is still needed. One guard entry (not one per screen) keeps the two histories from drifting when
// the app drops several screens at once (tab switch, header Home, return to 16/19, MoMo origin) and
// means Menu never adds more than one entry.
//
// Order on a back press: a save running -> nothing happens; an open sheet or dialog -> it closes
// (as its Cancel / Change amount would); otherwise the in-app back. At Home with nothing to go
// back to, the press leaves the app (never trapped).

// One registry per page, even if this module is bundled twice (tests load screens separately).
const store = (globalThis.__posBrowserBack ??= { handlers: [], blockers: 0, onChange: null });
const handlers = store.handlers;

// An open sheet or dialog: a back press calls `close` instead of leaving the screen.
export function registerBackHandler(close) {
  const entry = { close };
  handlers.push(entry);
  store.onChange?.();
  return () => {
    const index = handlers.indexOf(entry);
    if (index >= 0) handlers.splice(index, 1);
  };
}

// A save is running: a back press does nothing until the returned release is called.
export function holdBack() {
  store.blockers += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    store.blockers = Math.max(0, store.blockers - 1);
  };
}

export function backIsHeld() {
  return store.blockers > 0;
}

export function hasOpenSheet() {
  return handlers.length > 0;
}

// For tests: forget every registration.
export function resetBrowserBack() {
  handlers.length = 0;
  store.blockers = 0;
  store.onChange = null;
}

const GUARD = { posGuard: true };

export function needsGuard(state) {
  return state.current !== "Home" || state.history.length > 0 || handlers.length > 0;
}

// history: window.history (or a test double). getState: the current in-app state.
// goBack: runs the in-app back (PosApp's phone back for the current screen).
export function createBrowserBack({ history, getState, goBack }) {
  let guarded = false;
  try {
    history.replaceState({ ...(history.state ?? {}), posBase: true, posGuard: false }, "");
  } catch (error) {
    console.warn("Could not mark the page history entry.", error);
  }

  function pushGuard() {
    history.pushState(GUARD, "");
    guarded = true;
  }

  // After every in-app change: make sure a back press stays in the app when there is somewhere to go.
  function sync(state = getState()) {
    if (!guarded && needsGuard(state)) pushGuard();
  }

  function onPopState(event) {
    // Forward into the guard entry (browser Forward): it is back in place, nothing else to do.
    if (event?.state?.posGuard) {
      guarded = true;
      return;
    }
    guarded = false;
    if (backIsHeld()) {
      pushGuard();
      return;
    }
    const sheet = handlers.at(-1);
    if (sheet) {
      sheet.close();
      sync();
      return;
    }
    const state = getState();
    if (state.current === "Home" && state.history.length === 0) {
      // A guard left over from an earlier screen: leave the app now, do not ask for a second press.
      history.back();
      return;
    }
    goBack();
    sync();
  }

  store.onChange = () => sync();
  return {
    sync,
    onPopState,
    dispose() { store.onChange = null; }
  };
}

// While `open` is true, a back press calls `close` (the sheet's Cancel / Change amount).
export function useBackHandler(open, close) {
  const closeRef = useRef(close);
  closeRef.current = close;
  useEffect(() => {
    if (!open) return undefined;
    return registerBackHandler(() => closeRef.current());
  }, [open]);
}

// While `busy` is true (a save is running), a back press does nothing.
export function useBackBlock(busy) {
  useEffect(() => {
    if (!busy) return undefined;
    return holdBack();
  }, [busy]);
}