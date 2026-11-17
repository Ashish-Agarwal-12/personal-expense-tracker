/** Data shapes shared by the browser and the server. */

export type PaymentMethod = 'upi' | 'cash' | 'debit' | 'credit';
export type EmiKind = 'personal' | 'card' | 'home' | 'vehicle' | 'consumer' | 'education' | 'other';

export interface Settings {
  income: number;
  fixedBills: number;
  savingsGoal: number;
  ccLimit: number;
}

export interface Category {
  id: string;
  name: string;
  icon: string;
  limit: number;
}

export interface Expense {
  id: string;
  amount: number;
  categoryId: string;
  method: PaymentMethod;
  /** Local date, YYYY-MM-DD */
  date: string;
  note: string;
  createdAt: number;
}

export interface Emi {
  id: string;
  name: string;
  lender: string;
  kind: EmiKind;
  amount: number;
  dueDay: number;
  totalMonths: number;
  paidMonths: number;
  rate: number;
  /** Months marked paid, YYYY-MM */
  payments: string[];
}

export interface AppData {
  settings: Settings;
  categories: Category[];
  expenses: Expense[];
  emis: Emi[];
}

export const PAYMENT_METHODS: PaymentMethod[] = ['upi', 'cash', 'debit', 'credit'];
export const EMI_KINDS: EmiKind[] = ['personal', 'card', 'home', 'vehicle', 'consumer', 'education', 'other'];

export const METHOD_LABEL: Record<PaymentMethod, string> = {
  upi: 'UPI',
  cash: 'Cash',
  debit: 'Debit card',
  credit: 'Credit card',
};

export const EMI_KIND_INFO: Record<EmiKind, { label: string; icon: string }> = {
  personal: { label: 'Personal loan', icon: '🏦' },
  card: { label: 'Credit card EMI', icon: '💳' },
  home: { label: 'Home loan', icon: '🏠' },
  vehicle: { label: 'Vehicle loan', icon: '🚗' },
  consumer: { label: 'Phone / gadget EMI', icon: '📱' },
  education: { label: 'Education loan', icon: '🎓' },
  other: { label: 'Other', icon: '📄' },
};

export const DEFAULT_CATEGORIES: Category[] = [
  { id: 'food', name: 'Food & Groceries', icon: '🛒', limit: 0 },
  { id: 'eating', name: 'Eating out / Swiggy / Zomato', icon: '🍔', limit: 0 },
  { id: 'transport', name: 'Transport & Fuel', icon: '⛽', limit: 0 },
  { id: 'shopping', name: 'Shopping', icon: '🛍️', limit: 0 },
  { id: 'entertainment', name: 'Entertainment', icon: '🎬', limit: 0 },
  { id: 'health', name: 'Health & Medicine', icon: '💊', limit: 0 },
  { id: 'family', name: 'Family & Gifts', icon: '🎁', limit: 0 },
  { id: 'other', name: 'Other', icon: '📦', limit: 0 },
];

export const DEFAULT_SETTINGS: Settings = { income: 0, fixedBills: 0, savingsGoal: 0, ccLimit: 0 };
