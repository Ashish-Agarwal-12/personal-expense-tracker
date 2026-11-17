'use client';

import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import { emiRemainingMonths, preSpendWarnings } from '@/lib/budget';
import { api, ApiError } from '@/lib/client/api';
import { money, num, uid, ym } from '@/lib/format';
import type { AppData, Category, Emi, Expense, Settings } from '@/lib/types';
import { Rich, useModal, useToast } from './ui';

export type NewExpense = Omit<Expense, 'id' | 'createdAt'>;

interface TrackerApi {
  data: AppData;
  now: Date;
  reload(): Promise<void>;
  addExpense(exp: NewExpense): Promise<boolean>;
  deleteExpense(id: string): void;
  saveEmi(emi: Emi, isNew: boolean): void;
  deleteEmi(emi: Emi): Promise<void>;
  markPaid(id: string, paid: boolean): Promise<void>;
  saveCategory(cat: Category, isNew: boolean): void;
  deleteCategory(cat: Category): void;
  saveSettings(s: Settings): void;
  importBackup(backup: unknown): Promise<void>;
  eraseAll(): Promise<void>;
}

const Ctx = createContext<TrackerApi | null>(null);
export const useTracker = () => useContext(Ctx)!;

export function TrackerProvider({ initial, now, children }: { initial: AppData; now: Date; children: ReactNode }) {
  const [data, setData] = useState(initial);
  const dataRef = useRef(data);
  dataRef.current = data;
  const toast = useToast();
  const modal = useModal();

  const reload = useCallback(async () => {
    setData(await api<AppData>('GET', '/data'));
  }, []);

  /**
   * Apply a change locally right away (so the app feels instant), then save it to the server.
   * If the server rejects it, show why and reload the real data.
   */
  const sync = useCallback(
    async <T,>(change: ((d: AppData) => AppData) | null, request: () => Promise<T>): Promise<T> => {
      if (change) setData(change);
      try {
        return await request();
      } catch (e) {
        toast((e as Error).message);
        if ((e as ApiError).status !== 401) reload().catch(() => {});
        throw e;
      }
    },
    [reload, toast],
  );

  const quiet = (p: Promise<unknown>) => p.catch(() => {}); // errors already shown as a toast

  const value = useMemo<TrackerApi>(
    () => ({
      data,
      now,
      reload,

      async addExpense(exp) {
        const warnings = preSpendWarnings(dataRef.current, exp, new Date());
        if (warnings.length) {
          const ok = await modal.confirm({
            icon: '🛑',
            title: `Wait — think before you spend ${money(exp.amount)}`,
            body: (
              <>
                <ul>{warnings.map((w, i) => <li key={i}><Rich text={w} /></li>)}</ul>
                <p className="muted small">Ask yourself: do I <b>need</b> this today, or can it wait until next salary?</p>
              </>
            ),
            yes: 'Add anyway',
            no: "Don't buy it 👍",
            primary: 'no',
          });
          if (!ok) {
            toast('Good call. Money saved!');
            return false;
          }
        }
        const item: Expense = { ...exp, id: uid(), createdAt: Date.now() };
        try {
          await sync((d) => ({ ...d, expenses: [item, ...d.expenses] }), () => api('POST', '/expenses', item));
        } catch {
          return false;
        }
        toast(`Added ${money(exp.amount)}`);
        return true;
      },

      deleteExpense(id) {
        quiet(sync((d) => ({ ...d, expenses: d.expenses.filter((x) => x.id !== id) }), () => api('DELETE', `/expenses/${id}`)).then(() => toast('Expense deleted')));
      },

      saveEmi(emi, isNew) {
        quiet(
          sync(
            (d) => ({ ...d, emis: isNew ? [...d.emis, emi] : d.emis.map((x) => (x.id === emi.id ? emi : x)) }),
            () => (isNew ? api('POST', '/emis', emi) : api('PUT', `/emis/${emi.id}`, emi)),
          ).then(() => toast(isNew ? 'EMI added' : 'EMI updated')),
        );
      },

      async deleteEmi(emi) {
        const ok = await modal.confirm({
          title: `Delete “${emi.name}”?`,
          body: <p className="muted">This removes the EMI and its payment history.</p>,
          yes: 'Delete',
          danger: true,
        });
        if (ok) quiet(sync((d) => ({ ...d, emis: d.emis.filter((x) => x.id !== emi.id) }), () => api('DELETE', `/emis/${emi.id}`)));
      },

      async markPaid(id, paid) {
        const month = ym(new Date());
        const optimistic = (e: Emi): Emi => {
          const payments = e.payments || [];
          if (paid && !payments.includes(month)) return { ...e, payments: [...payments, month], paidMonths: Math.min(num(e.totalMonths), num(e.paidMonths) + 1) };
          if (!paid && payments.includes(month)) return { ...e, payments: payments.filter((m) => m !== month), paidMonths: Math.max(0, num(e.paidMonths) - 1) };
          return e;
        };
        try {
          const updated = await sync(
            (d) => ({ ...d, emis: d.emis.map((e) => (e.id === id ? optimistic(e) : e)) }),
            () => api<Emi>('POST', `/emis/${id}/pay`, { month, paid }),
          );
          setData((d) => ({ ...d, emis: d.emis.map((e) => (e.id === id ? updated : e)) }));
          if (paid) toast(emiRemainingMonths(updated) === 0 ? `🎉 ${updated.name} is fully paid off!` : `${updated.name} marked paid`);
        } catch {
          /* already reported */
        }
      },

      saveCategory(cat, isNew) {
        quiet(
          sync(
            (d) => ({ ...d, categories: isNew ? [...d.categories, cat] : d.categories.map((x) => (x.id === cat.id ? cat : x)) }),
            () => (isNew ? api('POST', '/categories', cat) : api('PUT', `/categories/${cat.id}`, cat)),
          ),
        );
      },

      deleteCategory(cat) {
        if (dataRef.current.expenses.some((x) => x.categoryId === cat.id)) {
          toast('This category has expenses — it can’t be deleted. Set its limit instead.');
          return;
        }
        quiet(sync((d) => ({ ...d, categories: d.categories.filter((x) => x.id !== cat.id) }), () => api('DELETE', `/categories/${cat.id}`)));
      },

      saveSettings(s) {
        quiet(sync((d) => ({ ...d, settings: s }), () => api('PUT', '/settings', s)).then(() => toast('Budget saved')));
      },

      async importBackup(backup) {
        await api('POST', '/import', backup);
        await reload();
      },

      async eraseAll() {
        await api('DELETE', '/data');
        await reload();
      },
    }),
    [data, now, reload, sync, modal, toast],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
