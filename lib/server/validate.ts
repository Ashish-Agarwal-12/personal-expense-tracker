import { EMI_KINDS, PAYMENT_METHODS, type AppData, type Category, type Emi, type Expense, type Settings } from '@/lib/types';

/** Input validation: every value from the browser is checked and normalised before it reaches MongoDB. */

export class ValidationError extends Error {
  readonly status = 400;
}

const ID_RE = /^[A-Za-z0-9_-]{1,40}$/;
const DATE_RE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const MAX_MONEY = 1e10;

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => v !== null && typeof v === 'object' && !Array.isArray(v);

function obj(v: unknown, what: string): Obj {
  if (!isObj(v)) throw new ValidationError(`${what} must be an object`);
  return v;
}

export function id(v: unknown, field = 'id'): string {
  if (typeof v !== 'string' || !ID_RE.test(v)) throw new ValidationError(`${field} is invalid`);
  return v;
}

function str(v: unknown, field: string, { max, required = false }: { max: number; required?: boolean }): string {
  if (v === undefined || v === null) v = '';
  if (typeof v !== 'string') throw new ValidationError(`${field} must be text`);
  const s = v.trim();
  if (required && !s) throw new ValidationError(`${field} is required`);
  if (s.length > max) throw new ValidationError(`${field} is too long (max ${max})`);
  return s;
}

function number(
  v: unknown,
  field: string,
  { min = 0, max = MAX_MONEY, int = false, required = false }: { min?: number; max?: number; int?: boolean; required?: boolean } = {},
): number {
  if ((v === undefined || v === null || v === '') && !required) return min > 0 ? min : 0;
  const n = typeof v === 'string' ? Number(v) : v;
  if (typeof n !== 'number' || !Number.isFinite(n)) throw new ValidationError(`${field} must be a number`);
  if (int && !Number.isInteger(n)) throw new ValidationError(`${field} must be a whole number`);
  if (n < min || n > max) throw new ValidationError(`${field} must be between ${min} and ${max}`);
  return n;
}

function oneOf<T extends string>(v: unknown, field: string, allowed: readonly T[]): T {
  if (!allowed.includes(v as T)) throw new ValidationError(`${field} is invalid`);
  return v as T;
}

export function settings(input: unknown): Settings {
  const v = obj(input, 'settings');
  return {
    income: number(v.income, 'income'),
    fixedBills: number(v.fixedBills, 'fixedBills'),
    savingsGoal: number(v.savingsGoal, 'savingsGoal'),
    ccLimit: number(v.ccLimit, 'ccLimit'),
  };
}

export function category(input: unknown): Category {
  const v = obj(input, 'category');
  return {
    id: id(v.id),
    name: str(v.name, 'name', { max: 40, required: true }),
    icon: str(v.icon, 'icon', { max: 8 }) || '📦',
    limit: number(v.limit, 'limit'),
  };
}

export function expense(input: unknown): Expense {
  const v = obj(input, 'expense');
  if (typeof v.date !== 'string' || !DATE_RE.test(v.date)) throw new ValidationError('date is invalid');
  return {
    id: id(v.id),
    amount: number(v.amount, 'amount', { min: 0.01, required: true }),
    categoryId: id(v.categoryId, 'categoryId'),
    method: oneOf(v.method, 'method', PAYMENT_METHODS),
    date: v.date,
    note: str(v.note, 'note', { max: 80 }),
    createdAt: number(v.createdAt ?? Date.now(), 'createdAt', { max: 8.64e15, int: true }),
  };
}

export function emi(input: unknown): Emi {
  const v = obj(input, 'emi');
  const totalMonths = number(v.totalMonths, 'totalMonths', { min: 1, max: 600, int: true, required: true });
  const paidMonths = number(v.paidMonths, 'paidMonths', { max: totalMonths, int: true });
  const payments = v.payments === undefined ? [] : v.payments;
  if (!Array.isArray(payments) || payments.length > 600 || !payments.every((p) => typeof p === 'string' && MONTH_RE.test(p))) {
    throw new ValidationError('payments is invalid');
  }
  return {
    id: id(v.id),
    name: str(v.name, 'name', { max: 50, required: true }),
    lender: str(v.lender, 'lender', { max: 40 }),
    kind: oneOf(v.kind, 'kind', EMI_KINDS),
    amount: number(v.amount, 'amount', { min: 0.01, required: true }),
    dueDay: number(v.dueDay, 'dueDay', { min: 1, max: 31, int: true, required: true }),
    totalMonths,
    paidMonths,
    rate: number(v.rate, 'rate', { max: 100 }),
    payments: [...new Set(payments as string[])],
  };
}

export function month(v: unknown): string {
  if (typeof v !== 'string' || !MONTH_RE.test(v)) throw new ValidationError('month is invalid');
  return v;
}

function list<T extends { id: string }>(v: unknown, fn: (x: unknown) => T, what: string, max: number): T[] {
  if (!Array.isArray(v)) throw new ValidationError(`${what} must be a list`);
  if (v.length > max) throw new ValidationError(`too many ${what}`);
  const out = v.map(fn);
  if (new Set(out.map((x) => x.id)).size !== out.length) throw new ValidationError(`duplicate ids in ${what}`);
  return out;
}

export function backup(input: unknown): AppData {
  const v = obj(input, 'backup');
  return {
    settings: settings(v.settings || {}),
    categories: list(v.categories || [], category, 'categories', 200),
    expenses: list(v.expenses || [], expense, 'expenses', 50000),
    emis: list(v.emis || [], emi, 'emis', 200),
  };
}
