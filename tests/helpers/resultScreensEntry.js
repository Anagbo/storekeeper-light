// One bundle for loadJsx holding the result screens (30, 31, 28) and the task-column context, so a test
// can draw them inside TaskColumnContext.Provider (separate loadJsx bundles would each have their own context).
export { default as SaleRecorded } from "../../src/pos/SaleRecorded.jsx";
export { default as CreditScreens } from "../../src/pos/CreditScreens.jsx";
export { PaymentReceived } from "../../src/pos/DebtCollection.jsx";
export { TaskColumnContext } from "../../src/pos/PosComponents.jsx";
