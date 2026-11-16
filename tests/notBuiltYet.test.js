import assert from "node:assert/strict";
import { test } from "node:test";
import { POS_ROUTES } from "../src/pos/routes.js";
import wiring from "../src/pos/wiring.json" with { type: "json" };
import { builtRoutes } from "./helpers/builtRoutes.js";
import { NOT_BUILT_YET, isNotBuiltYetControl, isNotBuiltYetScreen } from "./helpers/notBuiltYet.js";

// customer proof feature, remove when built: the allow-list used by batch16BottomBar, routeScreens
// and wp5.contract holds only 72, 73 and the one control on 29/43, and nothing else.
test("the not-built-yet allow-list holds only 72, 73 and the Show {Name} the record control", () => {
  assert.deepEqual([...NOT_BUILT_YET.screens], ["72", "73"]);
  assert.deepEqual(NOT_BUILT_YET.controls.map((entry) => ({ ...entry, on: [...entry.on] })),
    [{ label: "Show {Name} the record ›", to: "73", on: ["29", "43"] }]);
  assert.deepEqual(Object.keys(NOT_BUILT_YET).sort(), ["controls", "screens"]);
});

test("the allow-list entries are the customer proof screens in the wiring, and they are still not built", () => {
  assert.equal(wiring.screens["72"].component, "CustomerSignature");
  assert.equal(wiring.screens["73"].component, "CustomerRecordView");
  const built = builtRoutes();
  for (const id of NOT_BUILT_YET.screens) {
    const component = wiring.screens[id].component;
    assert.ok(!POS_ROUTES[component] && !built.has(component), `${id} ${component} is built: remove it from NOT_BUILT_YET`);
  }
  for (const id of ["29", "43"]) {
    assert.ok(wiring.screens[id].controls.some((control) => isNotBuiltYetControl(id, control)), `screen ${id} has the control`);
  }
});

test("the allow-list matches nothing else: other screens and controls are still checked", () => {
  for (const id of Object.keys(wiring.screens)) {
    assert.equal(isNotBuiltYetScreen(id), id === "72" || id === "73", `screen ${id}`);
  }
  const skipped = Object.entries(wiring.screens).flatMap(([id, screen]) =>
    screen.controls.filter((control) => isNotBuiltYetControl(id, control)).map((control) => `${id}:${control.label}`));
  assert.deepEqual(skipped.sort(), ["29:Show {Name} the record ›", "43:Show {Name} the record ›"]);
  // Same label, another screen or another target: not skipped.
  assert.equal(isNotBuiltYetControl("22", { label: "Show {Name} the record ›", to: "73" }), false);
  assert.equal(isNotBuiltYetControl("29", { label: "Show {Name} the record ›", to: "25" }), false);
  assert.equal(isNotBuiltYetControl("29", { label: "Collect", to: "25" }), false);
});
