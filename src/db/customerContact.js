import { updateCustomerProfile } from "./debtLedger.js";

export async function saveCustomerContact({
  customerId,
  name,
  phone = "",
  ghanaCardNumber = "",
  now = Date.now()
}) {
  const customer = await updateCustomerProfile({
    customerId,
    name,
    phone,
    ghanaCardNumber,
    now
  });
  return {
    customerId: customer.id,
    name: customer.name,
    phone: customer.phone,
    ghanaCardNumber: customer.ghanaCardNumber
  };
}
