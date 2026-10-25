export type TransactionType = "sale" | "installment_sale" | "installment_addon" | "expense" | "income" | "debt_payment";
export type PaymentMethod = "cash" | "momo";
export type DebtStatus = "unpaid" | "paid";
export type SyncStatus = "pending" | "synced";

export interface Product {
  id?: number;
  name: string;
  default_price: number;
  unit: string;
  category: string;
  synced: boolean;
  updatedAt: number;
  syncStatus: SyncStatus;
}

export interface Transaction {
  id: string;
  type: TransactionType;
  total_amount: number;
  payment_method: PaymentMethod | null;
  installmentPaymentPesewas?: number;
  creditExtendedPesewas?: number;
  addonAmountPesewas?: number;
  customer_name: string;
  customer_phone: string;
  items_json: string;
  timestamp: number;
  synced: boolean;
  updatedAt: number;
  syncStatus: SyncStatus;
}

export interface Debt {
  id: string;
  customer_name: string;
  customer_phone: string;
  total_owed: number;
  status: DebtStatus;
  last_reminder_date: number | null;
  created_at: number;
  synced: boolean;
  updatedAt: number;
  syncStatus: SyncStatus;
}

export interface Payment {
  id: string;
  debtId: string | null;
  amountPesewas: number;
  paymentMethod: PaymentMethod;
  createdAt: number;
  updatedAt: number;
}

export interface Customer {
  id: string;
  name: string;
  nameLower: string;
  phone: string;
  totalDebtPesewas: number;
  createdAt: number;
  updatedAt: number;
}
