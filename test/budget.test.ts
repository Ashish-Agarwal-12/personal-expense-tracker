import { describe, expect, test } from 'vitest';
import { budget, buildAlerts, debtFreeDate, emiDue, emiEndDate, preSpendWarnings } from '@/lib/budget';
import { ymd } from '@/lib/format';
import { DEFAULT_CATEGORIES, type AppData, type Emi, type Expense } from '@/lib/types';

// Wednesday 18 Nov 2026, local time. November has 30 days → 13 days left including today.
const NOW = new Date(2026, 10, 18, 12, 0, 0);

const emi = (over: Partial<Emi> = {}): Emi => ({
  id: 'm1', name: 'HDFC loan', lender: '', kind: 'personal', amount: 14500, dueDay: 5, totalMonths: 36, paidMonths: 14, rate: 14, payments: [], ...over,
});
const exp = (over: Partial<Expense> = {}): Expense => ({
  id: Math.random().toString(36).slice(2), amount: 1000, categoryId: 'food', method: 'upi', date: '2026-11-10', note: '', createdAt: 0, ...over,
});
const data = (over: Partial<AppData> = {}): AppData => ({
  settings: { income: 60000, fixedBills: 12000, savingsGoal: 3000, ccLimit: 2000 },
  categories: DEFAULT_CATEGORIES,
  expenses: [],
  emis: [emi()],
  ...over,
});

describe('budget', () => {
  test('limit = salary − EMIs − bills − savings; daily limit spreads the rest over days left', () => {
    const b = budget(data({ expenses: [exp({ amount: 9800 }), exp({ amount: 450, date: ymd(NOW) })] }), NOW);
    expect(b.spendable).toBe(60000 - 14500 - 12000 - 3000); // 30,500
    expect(b.spent).toBe(10250);
    expect(b.spentToday).toBe(450);
    expect(b.daysLeft).toBe(13);
    expect(b.dailyLimit).toBeCloseTo((30500 - 9800) / 13);
    expect(b.remaining).toBe(30500 - 10250);
    expect(b.level).toBe('ok');
  });

  test('levels: 70% warn, 90% danger, 100% over', () => {
    const at = (spent: number) => budget(data({ expenses: [exp({ amount: spent })] }), NOW).level;
    expect(at(30500 * 0.69)).toBe('ok');
    expect(at(30500 * 0.7)).toBe('warn');
    expect(at(30500 * 0.9)).toBe('danger');
    expect(at(30500)).toBe('over');
  });

  test('finished EMIs no longer count', () => {
    expect(budget(data({ emis: [emi({ paidMonths: 36 })] }), NOW).emi).toBe(0);
  });

  test('other months are ignored', () => {
    expect(budget(data({ expenses: [exp({ date: '2026-10-31' })] }), NOW).spent).toBe(0);
  });
});

describe('EMI dates', () => {
  test('overdue when the due day has passed and it is not marked paid', () => {
    const d = emiDue(emi({ dueDay: 5 }), NOW);
    expect(d.status).toBe('overdue');
    expect(d.days).toBe(-13);
  });

  test('due soon within 5 days', () => {
    expect(emiDue(emi({ dueDay: 20 }), NOW)).toMatchObject({ status: 'soon', days: 2 });
  });

  test('paid this month → next due date is next month', () => {
    const d = emiDue(emi({ dueDay: 5, payments: ['2026-11'] }), NOW);
    expect(d.status).toBe('paid');
    expect(ymd(d.due)).toBe('2026-12-05');
  });

  test('due day 31 is clamped to the last day of a short month', () => {
    expect(ymd(emiDue(emi({ dueDay: 31 }), NOW).due)).toBe('2026-11-30');
  });

  test('end date and debt-free date', () => {
    // 22 left, this month unpaid → this month is #1, last is 21 months later (Aug 2028).
    expect(ymd(emiEndDate(emi(), NOW)!)).toBe('2028-08-01');
    // Paid this month → remaining start next month.
    expect(ymd(emiEndDate(emi({ payments: ['2026-11'], paidMonths: 15 }), NOW)!)).toBe('2028-08-01');
    expect(ymd(debtFreeDate([emi(), emi({ id: 'm2', totalMonths: 12, paidMonths: 7 })], NOW)!)).toBe('2028-08-01');
    expect(debtFreeDate([], NOW)).toBeNull();
  });
});

describe('warnings', () => {
  test('new user sees the setup prompt only', () => {
    const alerts = buildAlerts(data({ settings: { income: 0, fixedBills: 0, savingsGoal: 0, ccLimit: 0 } }), NOW);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].action?.goto).toBe('settings');
  });

  test('credit card cap, overdue EMI and high EMI ratio are flagged', () => {
    const alerts = buildAlerts(data({ expenses: [exp({ method: 'credit', amount: 5000 })], emis: [emi({ amount: 25000 })] }), NOW);
    const titles = alerts.map((a) => a.title).join(' | ');
    expect(titles).toMatch(/Credit card spend .* over your cap/);
    expect(titles).toMatch(/EMI overdue: HDFC loan/);
    expect(titles).toMatch(/EMIs take 42% of your salary/);
  });

  test('pre-spend warning when an expense would break the monthly limit', () => {
    const d = data({ expenses: [exp({ amount: 30000 })] });
    const w = preSpendWarnings(d, { amount: 1000, date: ymd(NOW), method: 'upi', categoryId: 'food' }, NOW);
    expect(w.join(' ')).toMatch(/push you .* over/);
  });

  test('no pre-spend warning for a small expense', () => {
    expect(preSpendWarnings(data(), { amount: 100, date: ymd(NOW), method: 'upi', categoryId: 'food' }, NOW)).toEqual([]);
  });

  test('pre-spend warnings ignore other months', () => {
    expect(preSpendWarnings(data(), { amount: 999999, date: '2026-10-01', method: 'credit', categoryId: 'food' }, NOW)).toEqual([]);
  });
});
