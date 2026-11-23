import { createContext, useContext, useEffect, useState } from "react";

// rules_global.wide_layout.layout_mode_function (decided 21 Nov 2026): the ONE place that decides the
// layout. The mode depends on the width alone (touch and orientation are not inputs):
//   below 768px    "phone"   — header with the Menu button, bottom bar, Menu drawer (unchanged)
//   768 to 1279px  "rail"    — an 84px icon rail on the left, the wide page types
//   1280px and up  "sidebar" — a 300px sidebar with icon and label
// My money (33) keeps its phone layout below 1024px (wide_layout.screens["33"]), so the layout also
// says whether My money is wide. Every screen gets this object from PosApp; none reads the width.
export const LAYOUT_BREAKPOINTS = Object.freeze({ rail: 768, wideMyMoney: 1024, sidebar: 1280 });
// Content never stretches past this; on wider screens it stays centred with the background around it.
export const WIDE_CONTENT_MAX_PX = 1160;

export function getLayoutMode(width) {
  if (!(width >= LAYOUT_BREAKPOINTS.rail)) return "phone";
  return width >= LAYOUT_BREAKPOINTS.sidebar ? "sidebar" : "rail";
}

export function getLayout(width) {
  const mode = getLayoutMode(width);
  return Object.freeze({ mode, wide: mode !== "phone", wideMyMoney: mode !== "phone" && width >= LAYOUT_BREAKPOINTS.wideMyMoney });
}

export const PHONE_LAYOUT = getLayout(0);

// The only place the app reads the window width. No window (tests, server) is the phone.
export function readLayout(win = globalThis.window) {
  const width = win?.innerWidth;
  return typeof width === "number" && Number.isFinite(width) ? getLayout(width) : PHONE_LAYOUT;
}

// The matchMedia queries that tell the hook a breakpoint was crossed (one per breakpoint above).
export const LAYOUT_QUERIES = Object.freeze(Object.values(LAYOUT_BREAKPOINTS).map((px) => `(min-width: ${px}px)`));

function sameLayout(a, b) {
  return a.mode === b.mode && a.wideMyMoney === b.wideMyMoney;
}

// The layout PosApp read (useLayout below), for parts drawn inside a screen that are not given it as a
// prop: the phone sheets become WideDialogs when the mode is not phone. No provider is the phone.
export const LayoutContext = createContext(PHONE_LAYOUT);
export function useLayoutContext() {
  return useContext(LayoutContext) ?? PHONE_LAYOUT;
}

// Used once, in PosApp: the layout now, updated when the window crosses a breakpoint.
export function useLayout() {
  const [layout, setLayout] = useState(() => readLayout());
  useEffect(() => {
    const win = globalThis.window;
    if (!win?.matchMedia) return undefined;
    const lists = LAYOUT_QUERIES.map((query) => win.matchMedia(query));
    const onChange = () => setLayout((previous) => {
      const next = readLayout(win);
      return sameLayout(previous, next) ? previous : next;
    });
    for (const list of lists) list.addEventListener?.("change", onChange);
    onChange();
    return () => { for (const list of lists) list.removeEventListener?.("change", onChange); };
  }, []);
  return layout;
}
