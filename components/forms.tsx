'use client';

import { useState, type FormEvent } from 'react';
import { num, uid, ymd } from '@/lib/format';
import { EMI_KIND_INFO, EMI_KINDS, METHOD_LABEL, PAYMENT_METHODS, type Category, type Emi, type EmiKind, type PaymentMethod } from '@/lib/types';
import { useTracker, type NewExpense } from './tracker-context';
import { useToast } from './ui';

/* ---------------- expense ---------------- */

/** Used on the Expenses tab and in the "+ Add expense" pop-up. */
export function ExpenseForm({ onDone, onCancel, compact = false }: { onDone?: () => void; onCancel?: () => void; compact?: boolean }) {
  const { data, addExpense } = useTracker();
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    const exp: NewExpense = {
      amount: num(f.get('amount')),
      categoryId: String(f.get('categoryId')),
      method: String(f.get('method')) as PaymentMethod,
      date: String(f.get('date') || ymd(new Date())),
      note: String(f.get('note') || '').trim(),
    };
    if (exp.amount <= 0) return toast('Enter an amount');
    setBusy(true);
    onDone?.(); // close the pop-up before the "think before you spend" warning opens
    const added = await addExpense(exp);
    setBusy(false);
    if (added && form.isConnected) {
      (form.elements.namedItem('amount') as HTMLInputElement).value = '';
      (form.elements.namedItem('note') as HTMLInputElement).value = '';
      (form.elements.namedItem('amount') as HTMLInputElement).focus();
    }
  }

  return (
    <form className="form-grid" autoComplete="off" onSubmit={submit}>
      <label>
        Amount (₹)
        <input type="number" name="amount" min="1" step="any" required inputMode="decimal" placeholder="e.g. 250" autoFocus={compact} />
      </label>
      <label>
        Category
        <select name="categoryId" required>
          {data.categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.icon} {c.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        Paid with
        <select name="method" defaultValue="upi">
          {PAYMENT_METHODS.map((m) => (
            <option key={m} value={m}>
              {METHOD_LABEL[m]}
            </option>
          ))}
        </select>
      </label>
      <label>
        Date
        <input type="date" name="date" required defaultValue={ymd(new Date())} />
      </label>
      <label className="wide">
        Note
        <input type="text" name="note" maxLength={80} placeholder="What was it for?" />
      </label>
      <div className="wide row-end">
        {onCancel && (
          <button type="button" className="btn" onClick={onCancel}>
            Cancel
          </button>
        )}
        <button className="btn primary" type="submit" disabled={busy}>
          {compact ? 'Add' : 'Add expense'}
        </button>
      </div>
    </form>
  );
}

/* ---------------- EMI ---------------- */

export function EmiForm({ emi, close }: { emi?: Emi; close: () => void }) {
  const { saveEmi } = useTracker();
  const toast = useToast();
  const isNew = !emi;
  const e = emi ?? { name: '', lender: '', kind: 'personal' as EmiKind, amount: '' as unknown as number, dueDay: 5, totalMonths: 12, paidMonths: 0, rate: '' as unknown as number };

  function submit(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    const f = new FormData(ev.currentTarget);
    const fields = {
      name: String(f.get('name')).trim(),
      lender: String(f.get('lender') || '').trim(),
      kind: String(f.get('kind')) as EmiKind,
      amount: num(f.get('amount')),
      dueDay: Math.min(31, Math.max(1, Math.round(num(f.get('dueDay'))))),
      totalMonths: Math.max(1, Math.round(num(f.get('totalMonths')))),
      paidMonths: Math.max(0, Math.round(num(f.get('paidMonths')))),
      rate: num(f.get('rate')),
    };
    if (fields.paidMonths > fields.totalMonths) return toast('Paid EMIs cannot be more than total tenure');
    const item: Emi = emi ? { ...emi, ...fields } : { ...fields, id: uid(), payments: [] };
    close();
    saveEmi(item, isNew);
  }

  return (
    <>
      <h3>{isNew ? 'Add EMI' : 'Edit EMI'}</h3>
      <form className="form-grid" autoComplete="off" onSubmit={submit}>
        <label className="wide">
          Name
          <input name="name" required maxLength={50} placeholder="e.g. HDFC personal loan, iPhone EMI" defaultValue={e.name} autoFocus />
        </label>
        <label>
          Type
          <select name="kind" defaultValue={e.kind}>
            {EMI_KINDS.map((k) => (
              <option key={k} value={k}>
                {EMI_KIND_INFO[k].icon} {EMI_KIND_INFO[k].label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Bank / lender
          <input name="lender" maxLength={40} placeholder="optional" defaultValue={e.lender} />
        </label>
        <label>
          EMI amount (₹ / month)
          <input type="number" name="amount" min="1" step="any" required defaultValue={e.amount} />
        </label>
        <label>
          Due on day of month
          <input type="number" name="dueDay" min="1" max="31" required defaultValue={e.dueDay} />
        </label>
        <label>
          Total tenure (months)
          <input type="number" name="totalMonths" min="1" required defaultValue={e.totalMonths} />
        </label>
        <label>
          EMIs already paid
          <input type="number" name="paidMonths" min="0" required defaultValue={e.paidMonths} />
        </label>
        <label className="wide">
          Interest rate % p.a. (optional)
          <input type="number" name="rate" min="0" step="any" defaultValue={e.rate} />
        </label>
        <div className="wide actions" style={{ marginTop: 4 }}>
          <button type="button" className="btn" onClick={close}>
            Cancel
          </button>
          <button type="submit" className="btn primary">
            {isNew ? 'Add EMI' : 'Save'}
          </button>
        </div>
      </form>
    </>
  );
}

/* ---------------- category ---------------- */

export function CategoryForm({ category, close }: { category?: Category; close: () => void }) {
  const { saveCategory, deleteCategory } = useTracker();
  const isNew = !category;
  const c = category ?? { name: '', icon: '📦', limit: 0 };

  function submit(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    const f = new FormData(ev.currentTarget);
    const fields = { name: String(f.get('name')).trim(), icon: String(f.get('icon') || '').trim() || '📦', limit: num(f.get('limit')) };
    close();
    saveCategory(category ? { ...category, ...fields } : { ...fields, id: uid() }, isNew);
  }

  return (
    <>
      <h3>{isNew ? 'Add category' : 'Edit category'}</h3>
      <form className="form-grid" autoComplete="off" onSubmit={submit}>
        <label>
          Icon (emoji)
          <input name="icon" maxLength={4} defaultValue={c.icon} />
        </label>
        <label>
          Name
          <input name="name" required maxLength={40} defaultValue={c.name} autoFocus />
        </label>
        <label className="wide">
          Monthly limit (₹, 0 = no limit)
          <input type="number" name="limit" min="0" step="any" defaultValue={num(c.limit) || ''} />
        </label>
        <div className="wide actions" style={{ marginTop: 4 }}>
          {category && (
            <button
              type="button"
              className="btn danger"
              onClick={() => {
                close();
                deleteCategory(category);
              }}
            >
              Delete
            </button>
          )}
          <button type="button" className="btn" onClick={close}>
            Cancel
          </button>
          <button type="submit" className="btn primary">
            Save
          </button>
        </div>
      </form>
    </>
  );
}
