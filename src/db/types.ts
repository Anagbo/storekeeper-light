export type TransactionType = "sale" | "installment_sale" | "installment_addon" | "expense" | "supplier_payment" | "income" | "debt_payment" | "income_reversal";
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
  customerId?: string;
  supplierId?: string;
  paymentId?: string;
  debtId?: string;
  type: TransactionType;
  amountPesewas?: number;
  total_amount: number;
  payment_method: PaymentMethod | null;
  paymentType?: string;
  dueDate?: string;
  collectionId?: string;
  collectionType?: "debt_collection" | "debt_collection_reversal";
  reversalOfCollectionId?: string;
  reversalOfTransactionId?: string;
  debtBefore?: Partial<Debt>;
  debtAfter?: Partial<Debt>;
  installmentPaymentPesewas?: number;
  cashReceivedPesewas?: number;
  momoReceivedPesewas?: number;
  creditExtendedPesewas?: number;
  addonAmountPesewas?: number;
  paidAmountPesewas?: number;
  owedAmountPesewas?: number;
  payBy?: string;
  category?: string;
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
  customerId?: string;
  amountPesewas?: number;
  dueDate?: string;
  isInstallmentPlan?: boolean;
  installmentAmount?: number;
  frequency?: string;
  nextDueDate?: string;
  installmentsRemaining?: number;
  totalInstallments?: number;
  installmentPaymentCarryPesewas?: number;
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
  customerId?: string;
  debtId: string | null;
  transactionId?: string;
  collectionId?: string;
  collectionType?: "debt_collection";
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

export interface Supplier {
  id: string;
  name: string;
  nameLower: string;
  phone: string;
  createdAt: number;
  updatedAt: number;
}
