'use strict';

/** Input validation: every value from the browser is checked and normalised before it reaches MongoDB. */

class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.status = 400;
  }
}

const METHODS = ['upi', 'cash', 'debit', 'credit'];
const EMI_KINDS = ['personal', 'card', 'home', 'vehicle', 'consumer', 'education', 'other'];
const ID_RE = /^[A-Za-z0-9_-]{1,40}$/;
const DATE_RE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const MAX_MONEY = 1e10;

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

function obj(v, what) {
  if (!isObj(v)) throw new ValidationError(`${what} must be an object`);
  return v;
}

function id(v, field = 'id') {
  if (typeof v !== 'string' || !ID_RE.test(v)) throw new ValidationError(`${field} is invalid`);
  return v;
}

function str(v, field, { max, required = false } = {}) {
  if (v === undefined || v === null) v = '';
  if (typeof v !== 'string') throw new ValidationError(`${field} must be text`);
  v = v.trim();
  if (required && !v) throw new ValidationError(`${field} is required`);
  if (v.length > max) throw new ValidationError(`${field} is too long (max ${max})`);
  return v;
}

function number(v, field, { min = 0, max = MAX_MONEY, int = false, required = false } = {}) {
  if ((v === undefined || v === null || v === '') && !required) return min > 0 ? min : 0;
  const n = typeof v === 'string' ? Number(v) : v;
  if (typeof n !== 'number' || !Number.isFinite(n)) throw new ValidationError(`${field} must be a number`);
  if (int && !Number.isInteger(n)) throw new ValidationError(`${field} must be a whole number`);
  if (n < min || n > max) throw new ValidationError(`${field} must be between ${min} and ${max}`);
  return n;
}

function oneOf(v, field, allowed) {
  if (!allowed.includes(v)) throw new ValidationError(`${field} is invalid`);
  return v;
}

function settings(v) {
  obj(v, 'settings');
  return {
    income: number(v.income, 'income'),
    fixedBills: number(v.fixedBills, 'fixedBills'),
    savingsGoal: number(v.savingsGoal, 'savingsGoal'),
    ccLimit: number(v.ccLimit, 'ccLimit'),
  };
}

function category(v) {
  obj(v, 'category');
  return {
    id: id(v.id),
    name: str(v.name, 'name', { max: 40, required: true }),
    icon: str(v.icon, 'icon', { max: 8 }) || '📦',
    limit: number(v.limit, 'limit'),
  };
}

function expense(v) {
  obj(v, 'expense');
  if (typeof v.date !== 'string' || !DATE_RE.test(v.date)) throw new ValidationError('date is invalid');
  return {
    id: id(v.id),
    amount: number(v.amount, 'amount', { min: 0.01, required: true }),
    categoryId: id(v.categoryId, 'categoryId'),
    method: oneOf(v.method, 'method', METHODS),
    date: v.date,
    note: str(v.note, 'note', { max: 80 }),
    createdAt: number(v.createdAt ?? Date.now(), 'createdAt', { max: 8.64e15, int: true }),
  };
}

function emi(v) {
  obj(v, 'emi');
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
    payments: [...new Set(payments)],
  };
}

function month(v) {
  if (typeof v !== 'string' || !MONTH_RE.test(v)) throw new ValidationError('month is invalid');
  return v;
}

function list(v, fn, what, max) {
  if (!Array.isArray(v)) throw new ValidationError(`${what} must be a list`);
  if (v.length > max) throw new ValidationError(`too many ${what}`);
  const out = v.map(fn);
  if (new Set(out.map((x) => x.id)).size !== out.length) throw new ValidationError(`duplicate ids in ${what}`);
  return out;
}

function backup(v) {
  obj(v, 'backup');
  return {
    settings: settings(v.settings || {}),
    categories: list(v.categories || [], category, 'categories', 200),
    expenses: list(v.expenses || [], expense, 'expenses', 50000),
    emis: list(v.emis || [], emi, 'emis', 200),
  };
}

module.exports = { ValidationError, settings, category, expense, emi, month, backup, id };
