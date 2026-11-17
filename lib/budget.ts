import { addMonths, daysInMonth, money, num, ym, ymd } from './format';
import type { AppData, Category, Emi, Expense } from './types';

/**
 * All the budget maths and warnings, as pure functions of (data, now) so they're easy to test.
 * Text may contain **bold** markers, rendered by <Rich>.
 */

export type Level = 'ok' | 'warn' | 'danger' | 'over';

export interface BudgetSummary {
  month: string;
  income: number;
  emi: number;
  fixed: number;
  savings: number;
  /** Salary − EMIs − bills − savings: the most you may spend this month. */
  spendable: number;
  spent: number;
  spentToday: number;
  remaining: number;
  pct: number;
  level: Level;
  dailyLimit: number;
  daysLeft: number;
  ccSpent: number;
  ccLimit: number;
  emiRatio: number;
}

export const sum = (items: { amount: number }[]) => items.reduce((s, x) => s + num(x.amount), 0);
export const emiRemainingMonths = (e: Emi) => Math.max(0, num(e.totalMonths) - num(e.paidMonths));
export const activeEmis = (emis: Emi[]) => emis.filter((e) => emiRemainingMonths(e) > 0);
export const emiTotal = (emis: Emi[]) => activeEmis(emis).reduce((s, e) => s + num(e.amount), 0);
export const expensesIn = (expenses: Expense[], month: string) => expenses.filter((x) => x.date.slice(0, 7) === month);

export function catById(categories: Category[], id: string): Category {
  return categories.find((c) => c.id === id) ?? { id, name: 'Unknown', icon: '❔', limit: 0 };
}

export function budget(data: AppData, now: Date): BudgetSummary {
  const s = data.settings;
  const month = ym(now);
  const income = num(s.income);
  const emi = emiTotal(data.emis);
  const fixed = num(s.fixedBills);
  const savings = num(s.savingsGoal);
  const spendable = income - emi - fixed - savings;

  const monthExp = expensesIn(data.expenses, month);
  const spent = sum(monthExp);
  const today = ymd(now);
  const spentToday = sum(monthExp.filter((x) => x.date === today));
  const spentBeforeToday = spent - spentToday;

  const daysLeft = daysInMonth(now.getFullYear(), now.getMonth()) - now.getDate() + 1; // including today
  const dailyLimit = Math.max(0, (spendable - spentBeforeToday) / daysLeft);
  const remaining = spendable - spent;
  const pct = spendable > 0 ? (spent / spendable) * 100 : spent > 0 ? 999 : 0;
  const ccSpent = sum(monthExp.filter((x) => x.method === 'credit'));
  const emiRatio = income > 0 ? (emi / income) * 100 : 0;

  const level: Level = pct >= 100 ? 'over' : pct >= 90 ? 'danger' : pct >= 70 ? 'warn' : 'ok';

  return { month, income, emi, fixed, savings, spendable, spent, spentToday, remaining, pct, level, dailyLimit, daysLeft, ccSpent, ccLimit: num(s.ccLimit), emiRatio };
}

export function categorySpend(expenses: Expense[], month: string): Record<string, number> {
  const map: Record<string, number> = {};
  for (const x of expensesIn(expenses, month)) map[x.categoryId] = (map[x.categoryId] || 0) + num(x.amount);
  return map;
}

export type DueStatus = 'paid' | 'overdue' | 'soon' | 'upcoming';
export interface EmiDue {
  due: Date;
  days: number;
  status: DueStatus;
  paidThisMonth: boolean;
}

/** When the EMI is next due, relative to `now`. */
export function emiDue(e: Emi, now: Date): EmiDue {
  const paidThisMonth = (e.payments || []).includes(ym(now));
  const base = paidThisMonth ? addMonths(now, 1) : now;
  const dueDay = Math.min(num(e.dueDay) || 1, daysInMonth(base.getFullYear(), base.getMonth()));
  const due = new Date(base.getFullYear(), base.getMonth(), dueDay);
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const days = Math.round((due.getTime() - startOfToday.getTime()) / 86_400_000);
  const status: DueStatus = paidThisMonth ? 'paid' : days < 0 ? 'overdue' : days <= 5 ? 'soon' : 'upcoming';
  return { due, days, status, paidThisMonth };
}

/** Month of the last EMI payment. If this month's EMI is already paid, the remaining ones start next month. */
export function emiEndDate(e: Emi, now: Date): Date | null {
  const rem = emiRemainingMonths(e);
  if (!rem) return null;
  return addMonths(now, emiDue(e, now).paidThisMonth ? rem : rem - 1);
}

export function debtFreeDate(emis: Emi[], now: Date): Date | null {
  const ends = emis.map((e) => emiEndDate(e, now)).filter((d): d is Date => !!d);
  return ends.length ? new Date(Math.max(...ends.map((d) => d.getTime()))) : null;
}

export interface Alert {
  type: 'info' | 'warn' | 'danger';
  icon: string;
  title: string;
  text: string;
  action?: { label: string; goto: 'settings' | 'emis' };
}

export function buildAlerts(data: AppData, now: Date): Alert[] {
  const b = budget(data, now);
  const out: Alert[] = [];
  if (!b.income) {
    out.push({
      type: 'info', icon: '👋', title: 'Start here: set your salary and budget',
      text: 'Go to **Budget & Settings**, enter your salary and bills, then add your EMIs. The app will then calculate how much you are allowed to spend.',
      action: { label: 'Set up budget', goto: 'settings' },
    });
    return out;
  }
  if (b.spendable <= 0) {
    out.push({
      type: 'danger', icon: '🚨', title: 'Your EMIs + bills + savings are more than your salary',
      text: `You are short by **${money(-b.spendable)}** every month before spending anything. Don't take any new loan or EMI. Consider talking to your bank about restructuring, or lowering the savings target temporarily.`,
    });
  }
  if (b.level === 'over' && b.spendable > 0) {
    out.push({
      type: 'danger', icon: '⛔', title: `You've crossed this month's limit by ${money(-b.remaining)}`,
      text: 'Stop all non-essential spending until your next salary. Every extra rupee now goes on the credit card and grows your debt.',
    });
  } else if (b.level === 'danger') {
    out.push({ type: 'danger', icon: '⚠️', title: `${Math.round(b.pct)}% of your monthly limit is used`, text: `Only **${money(b.remaining)}** left for ${b.daysLeft} day(s). Essentials only.` });
  } else if (b.level === 'warn') {
    out.push({ type: 'warn', icon: '⚠️', title: `${Math.round(b.pct)}% of your monthly limit is used`, text: `Slow down — ${money(b.remaining)} left for ${b.daysLeft} day(s).` });
  }
  if (b.spendable > 0 && b.spentToday > b.dailyLimit) {
    out.push({
      type: 'warn', icon: '📅', title: `Today's spend (${money(b.spentToday)}) is above today's safe limit (${money(b.dailyLimit)})`,
      text: 'Try to spend nothing more today so the rest of the month stays on track.',
    });
  }
  if (b.ccSpent > 0 && b.ccSpent > b.ccLimit) {
    out.push({
      type: 'danger', icon: '💳', title: `Credit card spend ${money(b.ccSpent)} is over your cap of ${money(b.ccLimit)}`,
      text: 'Credit card debt is the costliest debt (≈36–42% a year). Switch to UPI / debit so you only spend money you actually have.',
    });
  }
  if (b.emiRatio >= 50) {
    out.push({
      type: 'danger', icon: '📉', title: `EMIs take ${Math.round(b.emiRatio)}% of your salary`,
      text: 'Above 50% is a debt trap zone. Do not take any new loan or "No-cost EMI". Pay off the highest-interest loan first.',
    });
  } else if (b.emiRatio >= 35) {
    out.push({ type: 'warn', icon: '📉', title: `EMIs take ${Math.round(b.emiRatio)}% of your salary`, text: 'Healthy is under 30–35%. Avoid adding any new EMI.' });
  }
  const overdue = activeEmis(data.emis).filter((e) => emiDue(e, now).status === 'overdue');
  if (overdue.length) {
    out.push({
      type: 'danger', icon: '⏰', title: `${overdue.length} EMI overdue: ${overdue.map((e) => e.name).join(', ')}`,
      text: 'Late EMIs add penalty charges and hurt your CIBIL score. Pay these first, then mark them paid.',
      action: { label: 'Open EMIs', goto: 'emis' },
    });
  }
  const cs = categorySpend(data.expenses, b.month);
  for (const c of data.categories) {
    if (num(c.limit) > 0 && (cs[c.id] || 0) > num(c.limit)) {
      out.push({ type: 'warn', icon: c.icon, title: `${c.name}: ${money(cs[c.id])} spent, limit ${money(c.limit)}`, text: 'This category is over its cap for the month.' });
    }
  }
  return out;
}

/** Warnings shown *before* an expense is saved (only for the current month). */
export function preSpendWarnings(data: AppData, exp: Pick<Expense, 'amount' | 'date' | 'method' | 'categoryId'>, now: Date): string[] {
  const b = budget(data, now);
  const w: string[] = [];
  if (exp.date.slice(0, 7) !== b.month) return w;
  const amt = num(exp.amount);
  if (b.income) {
    const newRemaining = b.remaining - amt;
    if (b.remaining <= 0) w.push(`You are **already over** this month's limit by ${money(-b.remaining)}. This makes it ${money(-newRemaining)}.`);
    else if (newRemaining < 0) w.push(`This will push you **${money(-newRemaining)} over** your monthly limit.`);
    else if ((b.spent + amt) / b.spendable >= 0.9) w.push(`After this, only **${money(newRemaining)}** is left for ${b.daysLeft} day(s).`);
    if (exp.date === ymd(now) && b.spentToday + amt > b.dailyLimit) {
      w.push(`Today's safe limit is **${money(b.dailyLimit)}**. You'd be at ${money(b.spentToday + amt)} today.`);
    }
  }
  if (exp.method === 'credit' && b.ccSpent + amt > b.ccLimit) {
    w.push(`Credit card spend would be **${money(b.ccSpent + amt)}** — your cap is ${money(b.ccLimit)}. Pay by UPI/debit if you have the money; if you don't, you can't afford it.`);
  }
  const c = catById(data.categories, exp.categoryId);
  if (num(c.limit) > 0) {
    const cs = (categorySpend(data.expenses, b.month)[c.id] || 0) + amt;
    if (cs > num(c.limit)) w.push(`${c.name} would be at **${money(cs)}** — limit is ${money(c.limit)}.`);
  }
  return w;
}
