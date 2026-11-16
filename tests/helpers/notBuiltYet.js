// customer proof feature, remove when built.
// 72 Customer signs (CustomerSignature) is built. The synced wiring also has 73 Show {Name} the record
// (CustomerRecordView) and the "Show {Name} the record ›" control on 29/43 that opens 73. They belong
// to the next feature and are not built yet. batch16BottomBar, routeScreens and wp5.contract skip
// exactly these; any other missing screen or control still fails. notBuiltYet.test.js checks this
// list holds only these entries and fails once any of them is built.
export const NOT_BUILT_YET = Object.freeze({
  screens: Object.freeze([]),
  controls: Object.freeze([Object.freeze({ label: "Show {Name} the record ›", to: "73", on: Object.freeze(["29", "43"]) })])
});

export const isNotBuiltYetScreen = (id) => NOT_BUILT_YET.screens.includes(String(id));

export const isNotBuiltYetControl = (screenId, control) =>
  NOT_BUILT_YET.controls.some((entry) =>
    entry.on.includes(String(screenId)) && entry.label === control.label && entry.to === control.to);
