import { useState } from "react";

// Wiring rules_global.form_errors (decided 16 Nov 2026): one shared behaviour for every form with an
// error box. A message appears only after the owner taps the form's main button with a problem, names
// only what is wrong, and disappears as soon as that problem is fixed (no second tap). A fresh or
// returning form never shows one.
//
// `problems` is worked out from the form's current values on every render, in check order:
// [[key, message or ""], ...]. An empty message means that check passes.

// The first problem as [key, message], or null when every check passes.
export function firstProblem(problems) {
  return problems.find(([, message]) => Boolean(message)) ?? null;
}

// The message for the problem the owner was shown, while it is still a problem; "" once fixed.
export function shownMessage(shownKey, problems) {
  if (!shownKey) return "";
  return problems.find(([key]) => key === shownKey)?.[1] || "";
}

export function useFormErrors(problems) {
  const [shownKey, setShownKey] = useState(null);
  const message = shownMessage(shownKey, problems);
  // Fixed: forget it, so breaking the same field again shows nothing until the next tap.
  if (shownKey && !message) setShownKey(null);
  return {
    message,
    // Which problem the message is about (null when none is shown), for a form that shows a field's
    // message under that field.
    field: message ? shownKey : null,
    // Call when the main button is tapped. Shows the first problem and returns false, or returns true.
    // `keys` limits the check to some of the problems (a button that needs only those fields).
    check(keys) {
      const problem = firstProblem(keys ? problems.filter(([key]) => keys.includes(key)) : problems);
      setShownKey(problem ? problem[0] : null);
      return !problem;
    },
    clear() { setShownKey(null); }
  };
}
