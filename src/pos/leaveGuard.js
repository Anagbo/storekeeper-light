import { createContext, useContext, useEffect, useRef } from "react";

// rules_global.leave_question (decided 24 Nov 2026): one rule and one mechanism. A screen that holds
// typed values registers whether they differ from what was saved or from the start, with its own
// question (useLeaveGuard). PosApp asks it before every exit that would drop the values (Back, a
// device Back, a tab, the header Home, Home in the Menu, the wide sidebar) and shows the one
// LeaveDraftDialog. The flag is cleared when the screen unmounts, so it can never trap the owner.

// PosApp provides { guards, asking }: guards.entry is the registered screen (or null) and guards.ask
// (proceed, { push }) asks first when needed; asking is true while the question is open.
export const LeaveGuardContext = createContext(null);

// PosApp: the one registry, the same object for the life of the app.
export function useLeaveGuards() {
  const ref = useRef(null);
  ref.current ??= { entry: null, ask: (proceed) => proceed() };
  return ref.current;
}

// Should this exit ask? `push` is an exit that keeps the screen in history (a sidebar or Menu row):
// a draft kept in the route params (keptOnTripAway) survives it, a draft in the screen's own state does not.
export function guardAsks(entry, { push = false } = {}) {
  if (!entry?.dirty) return false;
  return !(push && entry.keptOnTripAway);
}

// A screen: dirty is whether the values differ from the start; question is its own wording.
// Returns askFirst(proceed) for its own in-page switches (wide Items rows), release() for a
// successful save that leaves (nothing is lost), and asking (the question is open).
export function useLeaveGuard(dirty, question, { keptOnTripAway = false } = {}) {
  const context = useContext(LeaveGuardContext);
  const entryRef = useRef(null);
  entryRef.current ??= { dirty: false, question, keptOnTripAway };
  const entry = entryRef.current;
  useEffect(() => {
    entry.dirty = Boolean(dirty);
    entry.question = question;
    entry.keptOnTripAway = keptOnTripAway;
  }, [dirty, question, keptOnTripAway]);
  useEffect(() => {
    const guards = context?.guards;
    if (!guards) return undefined;
    guards.entry = entry;
    return () => {
      entry.dirty = false;
      if (guards.entry === entry) guards.entry = null;
    };
  }, [context?.guards]);
  return {
    askFirst(proceed) {
      const guards = context?.guards;
      if (guards && guards.entry === entry) guards.ask(proceed);
      else proceed();
    },
    release() { entry.dirty = false; },
    asking: Boolean(context?.asking)
  };
}
