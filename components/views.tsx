'use client';

import { useMemo, useState, type FormEvent } from 'react';
import {
  activeEmis, budget, buildAlerts, catById, categorySpend, debtFreeDate, emiDue, emiEndDate, emiRemainingMonths, emiTotal, expensesIn, sum,
  type EmiDue,
} from '@/lib/budget';
import { money, monthName, monthYear, num, prettyDate, shortDate, ym, ymd } from '@/lib/format';
import { EMI_KIND_INFO, METHOD_LABEL, type Expense, type Settings } from '@/lib/types';
import { CategoryForm, EmiForm, ExpenseForm } from './forms';
import { useTracker } from './tracker-context';
import { Rich, Stat, useModal, useToast } from './ui';

export type View = 'dashboard' | 'expenses' | 'emis' | 'settings';

const ratioTone = (r: number) => (r >= 50 ? 'danger-text' : r >= 35 ? 'warn-text' : '');

/* ---------------- shared bits ---------------- */

function DueText({ d }: { d: EmiDue }) {
  const date = shortDate(d.due);
  if (d.status === 'paid') return <><span className="pill ok">Paid</span> next due {date}</>;
  if (d.status === 'overdue') return <><span className="pill danger">Overdue {-d.days} day(s)</span> was due {date}</>;
  if (d.days === 0) return <span className="pill danger">Due today</span>;
  if (d.status === 'soon') return <><span className="pill warn">Due in {d.days} day(s)</span> {date}</>;
  return <>Due {date} · in {d.days} days</>;
}

function ExpenseRow({ x }: { x: Expense }) {
  const { data, now, deleteExpense } = useTracker();
  const c = catById(data.categories, x.categoryId);
  return (
    <div className="item">
      <div className="ico">{c.icon}</div>
      <div className="main">
        <div className="title">{x.note || c.name}</div>
        <div className="meta">
          {prettyDate(x.date, now)} · {c.name} · <span className={`pill ${x.method === 'credit' ? 'credit' : ''}`}>{METHOD_LABEL[x.method] ?? x.method}</span>
        </div>
      </div>
      <div className="amt num">{money(x.amount)}</div>
      <button className="icon-btn" title="Delete" aria-label="Delete expense" onClick={() => deleteExpense(x.id)}>
        ✕
      </button>
    </div>
  );
}

const byDateDesc = (a: Expense, b: Expense) => b.date.localeCompare(a.date) || (b.createdAt || 0) - (a.createdAt || 0);

/* ---------------- dashboard ---------------- */

export function Dashboard({ goto }: { goto: (v: View) => void }) {
  const { data, now, markPaid } = useTracker();
  const b = budget(data, now);
  const alerts = buildAlerts(data, now);
  const dfd = debtFreeDate(data.emis, now);

  const upcoming = activeEmis(data.emis)
    .map((e) => ({ e, d: emiDue(e, now) }))
    .filter((x) => !x.d.paidThisMonth)
    .sort((a, c) => a.d.days - c.d.days);

  const cs = categorySpend(data.expenses, b.month);
  const rows = Object.entries(cs).sort((a, c) => c[1] - a[1]);
  const max = Math.max(1, ...rows.map((r) => r[1]));
  const recent = [...data.expenses].sort(byDateDesc).slice(0, 6);
  const remTone = b.remaining < 0 ? 'danger-text' : b.level === 'ok' ? 'ok-text' : 'warn-text';

  return (
    <>
      <div>
        {alerts.map((a, i) => (
          <div key={i} className={`alert ${a.type}`}>
            <span className="ico">{a.icon}</span>
            <div>
              <b>{a.title}</b>
              <p><Rich text={a.text} /></p>
              {a.action && (
                <button className="link" onClick={() => goto(a.action!.goto)}>
                  {a.action.label} →
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      <div className="hero card">
        <div className="hero-top">
          <div>
            <div className="label">Left to spend this month</div>
            <div className={`big num ${remTone}`}>{b.remaining < 0 ? '−' + money(-b.remaining) : money(b.remaining)}</div>
            <div className="muted small">of {money(Math.max(0, b.spendable))} allowed · {b.daysLeft} day(s) left</div>
          </div>
          <div className="daily">
            <div className="label">Safe to spend today</div>
            <div className="big num">{money(Math.max(0, b.dailyLimit - b.spentToday))}</div>
            <div className="muted small">daily limit {money(b.dailyLimit)} · spent today {money(b.spentToday)}</div>
          </div>
        </div>
        <div className={`meter ${b.level}`}>
          <span style={{ width: `${Math.min(100, Math.max(0, b.pct))}%` }} />
        </div>
        <div className="meter-legend">
          <span>Spent {money(b.spent)} ({Math.round(Math.min(b.pct, 999))}%)</span>
          <span>Limit {money(Math.max(0, b.spendable))}</span>
        </div>
      </div>

      <div className="grid stats">
        <Stat label="Salary" value={money(b.income)} hint="monthly take-home" />
        <Stat label="EMIs this month" value={money(b.emi)} hint={`${activeEmis(data.emis).length} active · ${Math.round(b.emiRatio)}% of salary`} tone={ratioTone(b.emiRatio)} />
        <Stat label="Credit card spend" value={money(b.ccSpent)} hint={`cap ${money(b.ccLimit)}`} tone={b.ccSpent > b.ccLimit ? 'danger-text' : ''} />
        <Stat label="Debt-free by" value={dfd ? monthYear(dfd) : '—'} hint={dfd ? 'if you take no new loans' : 'add your EMIs'} />
      </div>

      <div className="grid two">
        <div className="card">
          <div className="card-head">
            <h2>Upcoming EMIs</h2>
            <button className="link" onClick={() => goto('emis')}>See all</button>
          </div>
          {upcoming.length ? (
            <div className="list">
              {upcoming.slice(0, 5).map(({ e, d }) => (
                <div className="item" key={e.id}>
                  <div className="ico">{(EMI_KIND_INFO[e.kind] ?? EMI_KIND_INFO.other).icon}</div>
                  <div className="main">
                    <div className="title">{e.name}</div>
                    <div className="meta"><DueText d={d} /></div>
                  </div>
                  <div className="amt num">{money(e.amount)}</div>
                  <button className="btn small ok" onClick={() => markPaid(e.id, true)}>Mark paid</button>
                </div>
              ))}
            </div>
          ) : (
            <div className="empty">{data.emis.length ? '✅ All EMIs paid for this month' : 'No EMIs added yet.'}</div>
          )}
        </div>
        <div className="card">
          <div className="card-head">
            <h2>Spending by category</h2>
            <span className="muted small">this month</span>
          </div>
          {rows.length ? (
            rows.map(([id, amt]) => {
              const c = catById(data.categories, id);
              const lim = num(c.limit);
              const width = lim > 0 ? Math.min(100, (amt / lim) * 100) : (amt / max) * 100;
              const tone = lim > 0 ? (amt > lim ? 'over' : amt >= lim * 0.8 ? 'warn' : '') : '';
              return (
                <div className="bar-row" key={id}>
                  <div className="top">
                    <span>{c.icon} {c.name}</span>
                    <span className="num"><b>{money(amt)}</b>{lim > 0 && <span className="muted"> / {money(lim)}</span>}</span>
                  </div>
                  <div className={`bar ${tone}`}><span style={{ width: `${width}%` }} /></div>
                </div>
              );
            })
          ) : (
            <div className="empty">No expenses this month yet.</div>
          )}
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <h2>Recent expenses</h2>
          <button className="link" onClick={() => goto('expenses')}>See all</button>
        </div>
        {recent.length ? <div className="list">{recent.map((x) => <ExpenseRow key={x.id} x={x} />)}</div> : <div className="empty">Nothing added yet. Tap “+ Add expense”.</div>}
      </div>
    </>
  );
}

/* ---------------- expenses ---------------- */

export function ExpensesView() {
  const { data, now } = useTracker();
  const [month, setMonth] = useState(() => ym(now));
  const [cat, setCat] = useState('');
  const b = budget(data, now);

  const list = useMemo(() => {
    let l = expensesIn(data.expenses, month);
    if (cat) l = l.filter((x) => x.categoryId === cat);
    return [...l].sort(byDateDesc);
  }, [data.expenses, month, cat]);
  const cc = sum(list.filter((x) => x.method === 'credit'));

  return (
    <>
      <div className="card">
        <h2>Add an expense</h2>
        <ExpenseForm />
        {b.income > 0 && (
          <p className="muted small" style={{ margin: '8px 0 0', textAlign: 'right' }}>
            Safe to spend today: <b>{money(Math.max(0, b.dailyLimit - b.spentToday))}</b>
          </p>
        )}
      </div>

      <div className="card">
        <div className="card-head">
          <h2>All expenses</h2>
          <div className="filters">
            <input type="month" value={month} onChange={(e) => setMonth(e.target.value || ym(now))} aria-label="Month" />
            <select value={cat} onChange={(e) => setCat(e.target.value)} aria-label="Category">
              <option value="">All categories</option>
              {data.categories.map((c) => <option key={c.id} value={c.id}>{c.icon} {c.name}</option>)}
            </select>
          </div>
        </div>
        <div className="muted small">
          {list.length} expense(s) in {monthName(month)} · total <b>{money(sum(list))}</b>
          {cc > 0 && <> · on credit card <b className="danger-text">{money(cc)}</b></>}
        </div>
        {list.length ? <div className="list">{list.map((x) => <ExpenseRow key={x.id} x={x} />)}</div> : <div className="empty">No expenses for this filter.</div>}
      </div>
    </>
  );
}

/* ---------------- EMIs ---------------- */

export function EmisView() {
  const { data, now, markPaid, deleteEmi } = useTracker();
  const modal = useModal();
  const b = budget(data, now);
  const act = activeEmis(data.emis);
  const outstanding = act.reduce((s, e) => s + num(e.amount) * emiRemainingMonths(e), 0);
  const paidThisMonth = act.filter((e) => emiDue(e, now).paidThisMonth).reduce((s, e) => s + num(e.amount), 0);
  const dfd = debtFreeDate(data.emis, now);

  const sorted = [...data.emis].sort((a, c) => {
    const ra = emiRemainingMonths(a) > 0 ? 0 : 1;
    const rc = emiRemainingMonths(c) > 0 ? 0 : 1;
    return ra - rc || emiDue(a, now).days - emiDue(c, now).days;
  });

  const openForm = (emi?: (typeof data.emis)[number]) => modal.open((close) => <EmiForm emi={emi} close={() => close()} />);

  return (
    <>
      <div className="grid stats">
        <Stat label="Total EMI / month" value={money(b.emi)} hint={`${Math.round(b.emiRatio)}% of salary`} tone={ratioTone(b.emiRatio)} />
        <Stat label="Paid this month" value={money(paidThisMonth)} hint={`${money(b.emi - paidThisMonth)} still to pay`} />
        <Stat label="Total still to repay" value={money(outstanding)} hint="sum of all remaining EMIs" />
        <Stat label="Debt-free by" value={dfd ? monthYear(dfd, 'long') : '—'} hint={dfd ? 'last EMI ends' : ''} />
      </div>

      <div className="card">
        <div className="card-head">
          <h2>Your EMIs</h2>
          <button className="btn" onClick={() => openForm()}>+ Add EMI</button>
        </div>
        {sorted.length ? (
          sorted.map((e) => {
            const rem = emiRemainingMonths(e);
            const done = rem === 0;
            const d = emiDue(e, now);
            const total = num(e.totalMonths);
            const pct = total ? (num(e.paidMonths) / total) * 100 : 0;
            const kind = EMI_KIND_INFO[e.kind] ?? EMI_KIND_INFO.other;
            const end = emiEndDate(e, now);
            return (
              <div key={e.id} className={`emi ${!done && d.status === 'overdue' ? 'overdue' : ''}`}>
                <div className="emi-top">
                  <div>
                    <div className="emi-name">{kind.icon} {e.name}</div>
                    <div className="muted small">
                      {kind.label}{e.lender ? ` · ${e.lender}` : ''}{num(e.rate) ? ` · ${num(e.rate)}% p.a.` : ''}
                    </div>
                  </div>
                  <div>
                    <div className="emi-amt num">{money(e.amount)}<span className="muted small"> /mo</span></div>
                    <div className="small" style={{ textAlign: 'right' }}>{done ? <span className="pill ok">🎉 Closed</span> : <DueText d={d} />}</div>
                  </div>
                </div>
                <div className="emi-grid">
                  <div><div className="k">Paid</div><div className="v">{num(e.paidMonths)} of {total} months</div></div>
                  <div><div className="k">Remaining</div><div className="v">{rem} month(s)</div></div>
                  <div><div className="k">Left to repay</div><div className="v num">{money(num(e.amount) * rem)}</div></div>
                  <div><div className="k">Last EMI</div><div className="v">{end ? monthYear(end) : '—'}</div></div>
                </div>
                <div className="bar"><span style={{ width: `${pct}%` }} /></div>
                <div className="emi-actions" style={{ marginTop: 12 }}>
                  {!done && (d.paidThisMonth
                    ? <button className="btn small" onClick={() => markPaid(e.id, false)}>Undo “paid” for this month</button>
                    : <button className="btn small ok" onClick={() => markPaid(e.id, true)}>✓ Mark this month paid</button>)}
                  <button className="btn small" onClick={() => openForm(e)}>Edit</button>
                  <button className="btn small danger" onClick={() => deleteEmi(e)}>Delete</button>
                </div>
              </div>
            );
          })
        ) : (
          <div className="empty">No EMIs yet. Add every loan, credit-card EMI and “No-cost EMI” you pay — seeing them together is the first step out.</div>
        )}
      </div>
    </>
  );
}

/* ---------------- settings ---------------- */

export function SettingsView({ onLogout }: { onLogout: () => void }) {
  const { data, saveSettings, importBackup, eraseAll } = useTracker();
  const modal = useModal();
  const toast = useToast();
  const [draft, setDraft] = useState<Record<keyof Settings, string>>(() => ({
    income: data.settings.income ? String(data.settings.income) : '',
    fixedBills: data.settings.fixedBills ? String(data.settings.fixedBills) : '',
    savingsGoal: data.settings.savingsGoal ? String(data.settings.savingsGoal) : '',
    ccLimit: data.settings.ccLimit ? String(data.settings.ccLimit) : '',
  }));
  const left = num(draft.income) - emiTotal(data.emis) - num(draft.fixedBills) - num(draft.savingsGoal);

  function submit(e: FormEvent) {
    e.preventDefault();
    saveSettings({ income: num(draft.income), fixedBills: num(draft.fixedBills), savingsGoal: num(draft.savingsGoal), ccLimit: num(draft.ccLimit) });
  }

  const field = (key: keyof Settings, label: string, extra: { required?: boolean; placeholder?: string } = {}) => (
    <label>
      {label}
      <input type="number" min="0" step="any" value={draft[key]} onChange={(e) => setDraft({ ...draft, [key]: e.target.value })} {...extra} />
    </label>
  );

  function download() {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `expense-backup-${ymd(new Date())}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  async function restore(file: File) {
    try {
      const backup = JSON.parse(await file.text());
      if (!backup || !Array.isArray(backup.expenses) || !Array.isArray(backup.emis)) throw new Error('bad file');
      const ok = await modal.confirm({
        title: 'Restore backup?',
        body: <p className="muted">This replaces everything currently in the app with the backup ({backup.expenses.length} expenses, {backup.emis.length} EMIs).</p>,
        yes: 'Restore',
      });
      if (!ok) return;
      await importBackup(backup);
      toast('Backup restored');
    } catch (err) {
      toast(err instanceof SyntaxError || (err as Error).message === 'bad file' ? 'That file is not a valid backup' : (err as Error).message);
    }
  }

  async function erase() {
    const ok = await modal.confirm({
      title: 'Erase all data?',
      body: <p className="muted">All expenses, EMIs and settings will be permanently deleted from your database, on every device. Download a backup first if you might need it. This cannot be undone.</p>,
      yes: 'Erase everything',
      danger: true,
    });
    if (!ok) return;
    try {
      await eraseAll();
      toast('All data erased');
    } catch (err) {
      toast((err as Error).message);
    }
  }

  return (
    <>
      <div className="card">
        <h2>Monthly budget</h2>
        <p className="muted small">
          Your spending limit is calculated as: <b>Salary − EMIs − Fixed bills − Savings</b>. Whatever is left is all you are allowed to spend this month.
        </p>
        <form className="form-grid" onSubmit={submit}>
          {field('income', 'Monthly take-home salary (₹)', { required: true })}
          {field('fixedBills', 'Fixed bills — rent, electricity, phone, etc. (₹)')}
          {field('savingsGoal', 'Save / emergency fund each month (₹)')}
          {field('ccLimit', 'Max credit card spend per month (₹)', { placeholder: '0 = block credit card' })}
          <div className="wide row-end">
            <span className="muted small">
              EMIs {money(emiTotal(data.emis))} → you can spend <b className={left <= 0 ? 'danger-text' : 'ok-text'}>{money(left)}</b> / month
            </span>
            <button className="btn primary" type="submit">Save budget</button>
          </div>
        </form>
      </div>

      <div className="card">
        <div className="card-head">
          <h2>Category limits</h2>
          <button className="btn" onClick={() => modal.open((close) => <CategoryForm close={() => close()} />)}>+ Add category</button>
        </div>
        <p className="muted small">Optional monthly cap per category. Leave 0 for no cap. You&apos;ll be warned at 80% and when you cross it.</p>
        <div className="list">
          {data.categories.map((c) => (
            <div className="item" key={c.id}>
              <div className="ico">{c.icon}</div>
              <div className="main">
                <div className="title">{c.name}</div>
                <div className="meta">{num(c.limit) ? `Limit ${money(c.limit)} / month` : 'No limit'}</div>
              </div>
              <button className="btn small" onClick={() => modal.open((close) => <CategoryForm category={c} close={() => close()} />)}>Edit</button>
            </div>
          ))}
        </div>
      </div>

      <div className="card">
        <h2>Backup &amp; account</h2>
        <p className="muted small">Your data is saved in your MongoDB database, so it&apos;s the same on every device you log in from. A backup file is still a good idea once a month.</p>
        <div className="row">
          <button className="btn" onClick={download}>Download backup</button>
          <label className="btn file-btn">
            Restore backup
            <input
              type="file"
              accept="application/json"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = '';
                if (f) restore(f);
              }}
            />
          </label>
          <button className="btn danger" onClick={erase}>Erase all data</button>
          <button className="btn" onClick={onLogout}>Log out</button>
        </div>
      </div>
    </>
  );
}
