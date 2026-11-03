import test from "node:test";
import assert from "node:assert/strict";
import { saveCustomerContact } from "../src/db/customerContact.js";

test("customer contact edits require a name and a valid Ghana mobile number", async () => {
  await assert.rejects(saveCustomerContact({ name: " " }), /customer name/);
  await assert.rejects(saveCustomerContact({ name: "Ama", phone: "12345" }), /valid Ghana mobile/);
});

test("customer contact edits preserve Ghana Card validation", async () => {
  await assert.rejects(saveCustomerContact({
    name: "Ama",
    phone: "024 123 4567",
    ghanaCardNumber: "GHA-123-0"
  }), /valid Ghana Card/);
});
