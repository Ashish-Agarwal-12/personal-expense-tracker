/** Formatting and local-date helpers (all dates are the user's local calendar dates, never UTC). */

const inr = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });
export const money = (n: number) => inr.format(Math.round(n || 0));

export const num = (v: unknown): number => {
  const n = typeof v === 'number' ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : 0;
};

export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

const pad = (n: number) => String(n).padStart(2, '0');
export const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const ym = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
export const daysInMonth = (y: number, m: number) => new Date(y, m + 1, 0).getDate();
export const addMonths = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth() + n, 1);

export function parseYmd(s: string): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d || 1);
}

export const monthName = (ymStr: string) =>
  parseYmd(ymStr + '-01').toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });

export const shortDate = (d: Date) => d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
export const monthYear = (d: Date, month: 'short' | 'long' = 'short') => d.toLocaleDateString('en-IN', { month, year: 'numeric' });

export function prettyDate(s: string, now: Date): string {
  if (s === ymd(now)) return 'Today';
  const y = new Date(now);
  y.setDate(y.getDate() - 1);
  if (s === ymd(y)) return 'Yesterday';
  return shortDate(parseYmd(s));
}
