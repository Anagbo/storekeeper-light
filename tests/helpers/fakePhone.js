// A fake phone for the shared WhatsApp opener (src/lib/openWhatsApp.js): `navigator` (userAgent,
// share, onLine) and a `window` whose location.href and open() collect the links the opener writes,
// so a test can tap a WhatsApp button in Node and see which link opened. Restores both afterwards.
export const ANDROID_UA = "Mozilla/5.0 (Linux; Android 13; Phone) Mobile";

export async function withPhone(navigatorValue, run) {
  const original = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const opened = [];
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: navigatorValue });
  const win = originalWindow?.value ?? {};
  const saved = { location: Object.getOwnPropertyDescriptor(win, "location"), open: Object.getOwnPropertyDescriptor(win, "open") };
  Object.defineProperty(win, "location", { configurable: true, value: { set href(link) { opened.push(link); }, get href() { return opened.at(-1) ?? "http://localhost/"; } } });
  Object.defineProperty(win, "open", { configurable: true, writable: true, value: (link) => { opened.push(link); } });
  if (!originalWindow) globalThis.window = win;
  try {
    return await run(opened);
  } finally {
    if (original) Object.defineProperty(globalThis, "navigator", original);
    else delete globalThis.navigator;
    for (const key of ["location", "open"]) {
      if (saved[key]) Object.defineProperty(win, key, saved[key]);
      else delete win[key];
    }
    if (!originalWindow) delete globalThis.window;
  }
}
