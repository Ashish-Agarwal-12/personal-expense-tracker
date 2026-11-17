/* Debt-Free Tracker — all data stays in this browser (localStorage). */
(function () {
  'use strict';

  const STORAGE_KEY = 'debtFreeTracker.v1';

  const DEFAULT_CATEGORIES = [
    { id: 'food', name: 'Food & Groceries', icon: '🛒', limit: 0 },
    { id: 'eating', name: 'Eating out / Swiggy / Zomato', icon: '🍔', limit: 0 },
    { id: 'transport', name: 'Transport & Fuel', icon: '⛽', limit: 0 },
    { id: 'shopping', name: 'Shopping', icon: '🛍️', limit: 0 },
    { id: 'entertainment', name: 'Entertainment', icon: '🎬', limit: 0 },
    { id: 'health', name: 'Health & Medicine', icon: '💊', limit: 0 },
    { id: 'family', name: 'Family & Gifts', icon: '🎁', limit: 0 },
    { id: 'other', name: 'Other', icon: '📦', limit: 0 },
  ];

  const METHOD_LABEL = { upi: 'UPI', cash: 'Cash', debit: 'Debit card', credit: 'Credit card' };
  const EMI_KIND = {
    personal: { label: 'Personal loan', icon: '🏦' },
    card: { label: 'Credit card EMI', icon: '💳' },
    home: { label: 'Home loan', icon: '🏠' },
    vehicle: { label: 'Vehicle loan', icon: '🚗' },
    consumer: { label: 'Phone / gadget EMI', icon: '📱' },
    education: { label: 'Education loan', icon: '🎓' },
    other: { label: 'Other', icon: '📄' },
  };

  /* ------------------------------------------------------------------ *
   * State
   * ------------------------------------------------------------------ */
  function defaultState() {
    return {
      settings: { income: 0, fixedBills: 0, savingsGoal: 0, ccLimit: 0 },
      categories: DEFAULT_CATEGORIES.map((c) => ({ ...c })),
      expenses: [],
      emis: [],
    };
  }

  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return defaultState();
      const data = JSON.parse(raw);
      const base = defaultState();
      return {
        settings: { ...base.settings, ...(data.settings || {}) },
        categories: Array.isArray(data.categories) && data.categories.length ? data.categories : base.categories,
        expenses: Array.isArray(data.expenses) ? data.expenses : [],
        emis: Array.isArray(data.emis) ? data.emis : [],
      };
    } catch (e) {
      console.error('Could not load saved data', e);
      return defaultState();
    }
  }

  let state = load();

  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (e) {
      toast('Could not save — browser storage is blocked or full.');
    }
  }

  /* ------------------------------------------------------------------ *
   * Helpers
   * ------------------------------------------------------------------ */
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const num = (v) => {
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : 0;
  };

  const inr = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });
  const money = (n) => inr.format(Math.round(n || 0));

  function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  const pad = (n) => String(n).padStart(2, '0');
  const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const ym = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
  const today = () => new Date();
  const todayStr = () => ymd(today());
  const thisMonth = () => ym(today());
  const daysInMonth = (y, m) => new Date(y, m + 1, 0).getDate();

  function parseYmd(s) {
    const [y, m, d] = s.split('-').map(Number);
    return new Date(y, m - 1, d || 1);
  }

  function monthName(ymStr) {
    return parseYmd(ymStr + '-01').toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
  }

  function prettyDate(s) {
    const d = parseYmd(s);
    const t = todayStr();
    if (s === t) return 'Today';
    const y = new Date(); y.setDate(y.getDate() - 1);
    if (s === ymd(y)) return 'Yesterday';
    return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
  }

  function addMonths(date, n) {
    const d = new Date(date.getFullYear(), date.getMonth() + n, 1);
    return d;
  }

  function catById(id) {
    return state.categories.find((c) => c.id === id) || { id, name: 'Unknown', icon: '❔', limit: 0 };
  }

  /* ------------------------------------------------------------------ *
   * Budget maths
   * ------------------------------------------------------------------ */
  function emiRemainingMonths(e) {
    return Math.max(0, num(e.totalMonths) - num(e.paidMonths));
  }
  const activeEmis = () => state.emis.filter((e) => emiRemainingMonths(e) > 0);
  const emiTotal = () => activeEmis().reduce((s, e) => s + num(e.amount), 0);

  function expensesIn(monthStr) {
    return state.expenses.filter((x) => x.date.slice(0, 7) === monthStr);
  }
  const sum = (arr) => arr.reduce((s, x) => s + num(x.amount), 0);

  /** Everything the dashboard and warnings need for a given moment. */
  function budget() {
    const s = state.settings;
    const now = today();
    const month = thisMonth();
    const income = num(s.income);
    const emi = emiTotal();
    const fixed = num(s.fixedBills);
    const savings = num(s.savingsGoal);
    const spendable = income - emi - fixed - savings;

    const monthExp = expensesIn(month);
    const spent = sum(monthExp);
    const t = todayStr();
    const spentToday = sum(monthExp.filter((x) => x.date === t));
    const spentBeforeToday = spent - spentToday;

    const dim = daysInMonth(now.getFullYear(), now.getMonth());
    const daysLeft = dim - now.getDate() + 1; // including today
    const dailyLimit = Math.max(0, (spendable - spentBeforeToday) / daysLeft);
    const remaining = spendable - spent;
    const pct = spendable > 0 ? (spent / spendable) * 100 : spent > 0 ? 999 : 0;
    const ccSpent = sum(monthExp.filter((x) => x.method === 'credit'));
    const emiRatio = income > 0 ? (emi / income) * 100 : 0;

    let level = 'ok';
    if (pct >= 100) level = 'over';
    else if (pct >= 90) level = 'danger';
    else if (pct >= 70) level = 'warn';

    return {
      income, emi, fixed, savings, spendable, spent, spentToday, remaining, pct, level,
      dailyLimit, daysLeft, ccSpent, ccLimit: num(s.ccLimit), emiRatio, month,
    };
  }

  function categorySpend(monthStr) {
    const map = {};
    for (const x of expensesIn(monthStr)) map[x.categoryId] = (map[x.categoryId] || 0) + num(x.amount);
    return map;
  }

  /** EMI due info for the current month. */
  function emiDue(e) {
    const now = today();
    const month = thisMonth();
    const paidThisMonth = (e.payments || []).includes(month);
    const dueDay = Math.min(num(e.dueDay) || 1, daysInMonth(now.getFullYear(), now.getMonth()));
    let due = new Date(now.getFullYear(), now.getMonth(), dueDay);
    if (paidThisMonth) {
      const nm = addMonths(now, 1);
      due = new Date(nm.getFullYear(), nm.getMonth(), Math.min(num(e.dueDay) || 1, daysInMonth(nm.getFullYear(), nm.getMonth())));
    }
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const days = Math.round((due - startOfToday) / 86400000);
    let status = 'upcoming';
    if (paidThisMonth) status = 'paid';
    else if (days < 0) status = 'overdue';
    else if (days <= 5) status = 'soon';
    return { due, days, status, paidThisMonth };
  }

  /** Month of the last EMI payment. If this month's EMI is already paid, the remaining ones start next month. */
  function emiEndDate(e) {
    const rem = emiRemainingMonths(e);
    if (!rem) return null;
    return addMonths(today(), emiDue(e).paidThisMonth ? rem : rem - 1);
  }

  function debtFreeDate() {
    const ends = state.emis.map(emiEndDate).filter(Boolean);
    return ends.length ? new Date(Math.max(...ends)) : null;
  }

  /* ------------------------------------------------------------------ *
   * Alerts
   * ------------------------------------------------------------------ */
  function buildAlerts(b) {
    const out = [];
    if (!b.income) {
      out.push({ type: 'info', ico: '👋', title: 'Start here: set your salary and budget',
        text: 'Go to <b>Budget &amp; Settings</b>, enter your salary and bills, then add your EMIs. The app will then calculate how much you are allowed to spend.',
        action: { label: 'Set up budget', goto: 'settings' } });
      return out;
    }
    if (b.spendable <= 0) {
      out.push({ type: 'danger', ico: '🚨', title: 'Your EMIs + bills + savings are more than your salary',
        text: `You are short by <b>${money(-b.spendable)}</b> every month before spending anything. Don't take any new loan or EMI. Consider talking to your bank about restructuring, or lowering the savings target temporarily.` });
    }
    if (b.level === 'over' && b.spendable > 0) {
      out.push({ type: 'danger', ico: '⛔', title: `You've crossed this month's limit by ${money(-b.remaining)}`,
        text: 'Stop all non-essential spending until your next salary. Every extra rupee now goes on the credit card and grows your debt.' });
    } else if (b.level === 'danger') {
      out.push({ type: 'danger', ico: '⚠️', title: `${Math.round(b.pct)}% of your monthly limit is used`,
        text: `Only <b>${money(b.remaining)}</b> left for ${b.daysLeft} day(s). Essentials only.` });
    } else if (b.level === 'warn') {
      out.push({ type: 'warn', ico: '⚠️', title: `${Math.round(b.pct)}% of your monthly limit is used`,
        text: `Slow down — ${money(b.remaining)} left for ${b.daysLeft} day(s).` });
    }
    if (b.spendable > 0 && b.spentToday > b.dailyLimit && b.dailyLimit >= 0) {
      out.push({ type: 'warn', ico: '📅', title: `Today's spend (${money(b.spentToday)}) is above today's safe limit (${money(b.dailyLimit)})`,
        text: 'Try to spend nothing more today so the rest of the month stays on track.' });
    }
    if (b.ccSpent > 0 && b.ccSpent > b.ccLimit) {
      out.push({ type: 'danger', ico: '💳', title: `Credit card spend ${money(b.ccSpent)} is over your cap of ${money(b.ccLimit)}`,
        text: 'Credit card debt is the costliest debt (≈36–42% a year). Switch to UPI / debit so you only spend money you actually have.' });
    }
    if (b.emiRatio >= 50) {
      out.push({ type: 'danger', ico: '📉', title: `EMIs take ${Math.round(b.emiRatio)}% of your salary`,
        text: 'Above 50% is a debt trap zone. Do not take any new loan or "No-cost EMI". Pay off the highest-interest loan first.' });
    } else if (b.emiRatio >= 35) {
      out.push({ type: 'warn', ico: '📉', title: `EMIs take ${Math.round(b.emiRatio)}% of your salary`,
        text: 'Healthy is under 30–35%. Avoid adding any new EMI.' });
    }
    const overdue = state.emis.filter((e) => emiRemainingMonths(e) > 0 && emiDue(e).status === 'overdue');
    if (overdue.length) {
      out.push({ type: 'danger', ico: '⏰', title: `${overdue.length} EMI overdue: ${overdue.map((e) => esc(e.name)).join(', ')}`,
        text: 'Late EMIs add penalty charges and hurt your CIBIL score. Pay these first, then mark them paid.', action: { label: 'Open EMIs', goto: 'emis' } });
    }
    const cs = categorySpend(b.month);
    for (const c of state.categories) {
      if (num(c.limit) > 0 && (cs[c.id] || 0) > num(c.limit)) {
        out.push({ type: 'warn', ico: c.icon, title: `${esc(c.name)}: ${money(cs[c.id])} spent, limit ${money(c.limit)}`,
          text: 'This category is over its cap for the month.' });
      }
    }
    return out;
  }

  /** Warnings shown *before* an expense is saved. */
  function preSpendWarnings(exp) {
    const b = budget();
    const w = [];
    if (exp.date.slice(0, 7) !== b.month) return w; // only check the current month
    const amt = num(exp.amount);
    if (b.income) {
      const newRemaining = b.remaining - amt;
      if (b.remaining <= 0) w.push(`You are <b>already over</b> this month's limit by ${money(-b.remaining)}. This makes it ${money(-newRemaining)}.`);
      else if (newRemaining < 0) w.push(`This will push you <b>${money(-newRemaining)} over</b> your monthly limit.`);
      else if ((b.spent + amt) / b.spendable >= 0.9) w.push(`After this, only <b>${money(newRemaining)}</b> is left for ${b.daysLeft} day(s).`);
      if (exp.date === todayStr() && b.spentToday + amt > b.dailyLimit) {
        w.push(`Today's safe limit is <b>${money(b.dailyLimit)}</b>. You'd be at ${money(b.spentToday + amt)} today.`);
      }
    }
    if (exp.method === 'credit') {
      if (b.ccSpent + amt > b.ccLimit) {
        w.push(`Credit card spend would be <b>${money(b.ccSpent + amt)}</b> — your cap is ${money(b.ccLimit)}. Pay by UPI/debit if you have the money; if you don't, you can't afford it.`);
      }
    }
    const c = catById(exp.categoryId);
    if (num(c.limit) > 0) {
      const cs = (categorySpend(b.month)[c.id] || 0) + amt;
      if (cs > num(c.limit)) w.push(`${esc(c.name)} would be at <b>${money(cs)}</b> — limit is ${money(c.limit)}.`);
    }
    return w;
  }

  /* ------------------------------------------------------------------ *
   * Rendering
   * ------------------------------------------------------------------ */
  function render() {
    $('#monthLabel').textContent = monthName(thisMonth());
    renderDashboard();
    renderExpenses();
    renderEmis();
    renderSettings();
  }

  function stat(label, value, hint, cls = '') {
    return `<div class="card stat"><div class="label">${label}</div><div class="value num ${cls}">${value}</div>${hint ? `<div class="hint">${hint}</div>` : ''}</div>`;
  }

  function renderDashboard() {
    const b = budget();

    $('#alerts').innerHTML = buildAlerts(b).map((a) => `
      <div class="alert ${a.type}">
        <span class="ico">${a.ico}</span>
        <div><b>${a.title}</b><p>${a.text}</p>
          ${a.action ? `<button class="link" data-goto="${a.action.goto}">${a.action.label} →</button>` : ''}
        </div>
      </div>`).join('');

    const pctW = Math.min(100, Math.max(0, b.pct));
    const remCls = b.remaining < 0 ? 'danger-text' : b.level === 'ok' ? 'ok-text' : 'warn-text';
    $('#hero').innerHTML = `
      <div class="hero-top">
        <div>
          <div class="label">Left to spend this month</div>
          <div class="big num ${remCls}">${b.remaining < 0 ? '−' + money(-b.remaining) : money(b.remaining)}</div>
          <div class="muted small">of ${money(Math.max(0, b.spendable))} allowed · ${b.daysLeft} day(s) left</div>
        </div>
        <div class="daily">
          <div class="label">Safe to spend today</div>
          <div class="big num">${money(Math.max(0, b.dailyLimit - b.spentToday))}</div>
          <div class="muted small">daily limit ${money(b.dailyLimit)} · spent today ${money(b.spentToday)}</div>
        </div>
      </div>
      <div class="meter ${b.level}"><span style="width:${pctW}%"></span></div>
      <div class="meter-legend"><span>Spent ${money(b.spent)} (${Math.round(Math.min(b.pct, 999))}%)</span><span>Limit ${money(Math.max(0, b.spendable))}</span></div>`;

    const dfd = debtFreeDate();
    const ratioCls = b.emiRatio >= 50 ? 'danger-text' : b.emiRatio >= 35 ? 'warn-text' : '';
    const ccCls = b.ccSpent > b.ccLimit ? 'danger-text' : '';
    $('#stats').innerHTML =
      stat('Salary', money(b.income), 'monthly take-home') +
      stat('EMIs this month', money(b.emi), `${activeEmis().length} active · ${Math.round(b.emiRatio)}% of salary`, ratioCls) +
      stat('Credit card spend', money(b.ccSpent), `cap ${money(b.ccLimit)}`, ccCls) +
      stat('Debt-free by', dfd ? dfd.toLocaleDateString('en-IN', { month: 'short', year: 'numeric' }) : '—', dfd ? 'if you take no new loans' : 'add your EMIs');

    // upcoming EMIs
    const upcoming = activeEmis()
      .map((e) => ({ e, d: emiDue(e) }))
      .filter((x) => !x.d.paidThisMonth)
      .sort((a, b2) => a.d.days - b2.d.days);
    $('#upcomingEmis').innerHTML = upcoming.length
      ? `<div class="list">${upcoming.slice(0, 5).map(({ e, d }) => `
          <div class="item">
            <div class="ico">${(EMI_KIND[e.kind] || EMI_KIND.other).icon}</div>
            <div class="main"><div class="title">${esc(e.name)}</div>
              <div class="meta">${dueText(d)}</div></div>
            <div class="amt num">${money(e.amount)}</div>
            <button class="btn small ok" data-pay="${e.id}">Mark paid</button>
          </div>`).join('')}</div>`
      : `<div class="empty">${state.emis.length ? '✅ All EMIs paid for this month' : 'No EMIs added yet.'}</div>`;

    // category bars
    const cs = categorySpend(b.month);
    const rows = Object.entries(cs).sort((a, c) => c[1] - a[1]);
    const max = Math.max(1, ...rows.map((r) => r[1]));
    $('#categoryBars').innerHTML = rows.length
      ? rows.map(([id, amt]) => {
          const c = catById(id);
          const lim = num(c.limit);
          const width = lim > 0 ? Math.min(100, (amt / lim) * 100) : (amt / max) * 100;
          const cls = lim > 0 ? (amt > lim ? 'over' : amt >= lim * 0.8 ? 'warn' : '') : '';
          return `<div class="bar-row"><div class="top"><span>${c.icon} ${esc(c.name)}</span>
            <span class="num"><b>${money(amt)}</b>${lim > 0 ? ` <span class="muted">/ ${money(lim)}</span>` : ''}</span></div>
            <div class="bar ${cls}"><span style="width:${width}%"></span></div></div>`;
        }).join('')
      : '<div class="empty">No expenses this month yet.</div>';

    const recent = [...state.expenses].sort(byDateDesc).slice(0, 6);
    $('#recentExpenses').innerHTML = recent.length ? `<div class="list">${recent.map(expenseRow).join('')}</div>` : '<div class="empty">Nothing added yet. Tap “+ Add expense”.</div>';
  }

  function dueText(d) {
    const date = d.due.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
    if (d.status === 'paid') return `<span class="pill ok">Paid</span> next due ${date}`;
    if (d.status === 'overdue') return `<span class="pill danger">Overdue ${-d.days} day(s)</span> was due ${date}`;
    if (d.days === 0) return `<span class="pill danger">Due today</span>`;
    if (d.status === 'soon') return `<span class="pill warn">Due in ${d.days} day(s)</span> ${date}`;
    return `Due ${date} · in ${d.days} days`;
  }

  function byDateDesc(a, b) {
    return b.date.localeCompare(a.date) || (b.createdAt || 0) - (a.createdAt || 0);
  }

  function expenseRow(x) {
    const c = catById(x.categoryId);
    return `<div class="item">
      <div class="ico">${c.icon}</div>
      <div class="main">
        <div class="title">${esc(x.note) || esc(c.name)}</div>
        <div class="meta">${prettyDate(x.date)} · ${esc(c.name)} · <span class="pill ${x.method === 'credit' ? 'credit' : ''}">${METHOD_LABEL[x.method] || x.method}</span></div>
      </div>
      <div class="amt num">${money(x.amount)}</div>
      <button class="icon-btn" title="Delete" aria-label="Delete expense" data-del-exp="${x.id}">✕</button>
    </div>`;
  }

  function fillCategorySelect(sel, withAll) {
    const cur = sel.value;
    sel.innerHTML = (withAll ? '<option value="">All categories</option>' : '') +
      state.categories.map((c) => `<option value="${c.id}">${c.icon} ${esc(c.name)}</option>`).join('');
    if (cur && [...sel.options].some((o) => o.value === cur)) sel.value = cur;
  }

  function renderExpenses() {
    fillCategorySelect($('#expenseForm [name=categoryId]'), false);
    fillCategorySelect($('#expenseCatFilter'), true);
    const monthInput = $('#expenseMonth');
    if (!monthInput.value) monthInput.value = thisMonth();
    const m = monthInput.value;
    const cat = $('#expenseCatFilter').value;
    let list = expensesIn(m);
    if (cat) list = list.filter((x) => x.categoryId === cat);
    list.sort(byDateDesc);
    const total = sum(list);
    const cc = sum(list.filter((x) => x.method === 'credit'));
    $('#expenseSummary').innerHTML = `${list.length} expense(s) in ${monthName(m)} · total <b>${money(total)}</b>${cc ? ` · on credit card <b class="danger-text">${money(cc)}</b>` : ''}`;
    $('#expenseList').innerHTML = list.length ? `<div class="list">${list.map(expenseRow).join('')}</div>` : '<div class="empty">No expenses for this filter.</div>';

    const b = budget();
    $('#expenseHint').innerHTML = b.income ? `Safe to spend today: <b>${money(Math.max(0, b.dailyLimit - b.spentToday))}</b>` : '';
  }

  function renderEmis() {
    const act = activeEmis();
    const b = budget();
    const outstanding = act.reduce((s, e) => s + num(e.amount) * emiRemainingMonths(e), 0);
    const paidThisMonth = act.filter((e) => emiDue(e).paidThisMonth).reduce((s, e) => s + num(e.amount), 0);
    const dfd = debtFreeDate();
    $('#emiStats').innerHTML =
      stat('Total EMI / month', money(b.emi), `${Math.round(b.emiRatio)}% of salary`, b.emiRatio >= 50 ? 'danger-text' : b.emiRatio >= 35 ? 'warn-text' : '') +
      stat('Paid this month', money(paidThisMonth), `${money(b.emi - paidThisMonth)} still to pay`) +
      stat('Total still to repay', money(outstanding), 'sum of all remaining EMIs') +
      stat('Debt-free by', dfd ? dfd.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' }) : '—', dfd ? 'last EMI ends' : '');

    const sorted = [...state.emis].sort((a, c) => {
      const ra = emiRemainingMonths(a) > 0 ? 0 : 1, rc = emiRemainingMonths(c) > 0 ? 0 : 1;
      return ra - rc || emiDue(a).days - emiDue(c).days;
    });

    $('#emiList').innerHTML = sorted.length ? sorted.map((e) => {
      const rem = emiRemainingMonths(e);
      const done = rem === 0;
      const d = emiDue(e);
      const total = num(e.totalMonths);
      const pct = total ? (num(e.paidMonths) / total) * 100 : 0;
      const kind = EMI_KIND[e.kind] || EMI_KIND.other;
      const end = emiEndDate(e);
      return `<div class="emi ${!done && d.status === 'overdue' ? 'overdue' : ''}">
        <div class="emi-top">
          <div>
            <div class="emi-name">${kind.icon} ${esc(e.name)}</div>
            <div class="muted small">${kind.label}${e.lender ? ' · ' + esc(e.lender) : ''}${num(e.rate) ? ` · ${num(e.rate)}% p.a.` : ''}</div>
          </div>
          <div>
            <div class="emi-amt num">${money(e.amount)}<span class="muted small"> /mo</span></div>
            <div class="small" style="text-align:right">${done ? '<span class="pill ok">🎉 Closed</span>' : dueText(d)}</div>
          </div>
        </div>
        <div class="emi-grid">
          <div><div class="k">Paid</div><div class="v">${num(e.paidMonths)} of ${total} months</div></div>
          <div><div class="k">Remaining</div><div class="v">${rem} month(s)</div></div>
          <div><div class="k">Left to repay</div><div class="v num">${money(num(e.amount) * rem)}</div></div>
          <div><div class="k">Last EMI</div><div class="v">${end ? end.toLocaleDateString('en-IN', { month: 'short', year: 'numeric' }) : '—'}</div></div>
        </div>
        <div class="bar"><span style="width:${pct}%"></span></div>
        <div class="emi-actions" style="margin-top:12px">
          ${done ? '' : d.paidThisMonth
            ? `<button class="btn small" data-unpay="${e.id}">Undo “paid” for this month</button>`
            : `<button class="btn small ok" data-pay="${e.id}">✓ Mark this month paid</button>`}
          <button class="btn small" data-edit-emi="${e.id}">Edit</button>
          <button class="btn small danger" data-del-emi="${e.id}">Delete</button>
        </div>
      </div>`;
    }).join('') : `<div class="empty">No EMIs yet. Add every loan, credit-card EMI and “No-cost EMI” you pay — seeing them together is the first step out.</div>`;
  }

  function renderSettings() {
    const f = $('#settingsForm');
    const s = state.settings;
    for (const k of ['income', 'fixedBills', 'savingsGoal', 'ccLimit']) {
      if (document.activeElement !== f[k]) f[k].value = s[k] || '';
    }
    updateBudgetPreview();

    $('#catList').innerHTML = `<div class="list">${state.categories.map((c) => `
      <div class="item">
        <div class="ico">${c.icon}</div>
        <div class="main"><div class="title">${esc(c.name)}</div>
          <div class="meta">${num(c.limit) ? 'Limit ' + money(c.limit) + ' / month' : 'No limit'}</div></div>
        <button class="btn small" data-edit-cat="${c.id}">Edit</button>
      </div>`).join('')}</div>`;
  }

  function updateBudgetPreview() {
    const f = $('#settingsForm');
    const left = num(f.income.value) - emiTotal() - num(f.fixedBills.value) - num(f.savingsGoal.value);
    $('#budgetPreview').innerHTML = `EMIs ${money(emiTotal())} → you can spend <b class="${left <= 0 ? 'danger-text' : 'ok-text'}">${money(left)}</b> / month`;
  }

  /* ------------------------------------------------------------------ *
   * Modal & toast
   * ------------------------------------------------------------------ */
  let modalResolve = null;
  function openModal(html) {
    $('#modalBody').innerHTML = html;
    $('#modal').hidden = false;
    const first = $('#modalBody input, #modalBody select, #modalBody button');
    if (first) setTimeout(() => first.focus(), 30);
  }
  function closeModal(result) {
    $('#modal').hidden = true;
    $('#modalBody').innerHTML = '';
    if (modalResolve) { const r = modalResolve; modalResolve = null; r(result); }
  }
  $('#modal').addEventListener('click', (e) => { if (e.target.id === 'modal') closeModal(false); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('#modal').hidden) closeModal(false); });

  function confirmModal(html) {
    return new Promise((resolve) => {
      modalResolve = resolve;
      openModal(html);
      $('#modalBody [data-yes]')?.addEventListener('click', () => closeModal(true));
      $('#modalBody [data-no]')?.addEventListener('click', () => closeModal(false));
    });
  }

  let toastTimer;
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (t.hidden = true), 2600);
  }

  /* ------------------------------------------------------------------ *
   * Actions
   * ------------------------------------------------------------------ */
  async function addExpense(exp) {
    const warnings = preSpendWarnings(exp);
    if (warnings.length) {
      const ok = await confirmModal(`
        <div class="warn-head">🛑</div>
        <h3>Wait — think before you spend ${money(exp.amount)}</h3>
        <ul>${warnings.map((w) => `<li>${w}</li>`).join('')}</ul>
        <p class="muted small">Ask yourself: do I <b>need</b> this today, or can it wait until next salary?</p>
        <div class="actions">
          <button class="btn" data-yes>Add anyway</button>
          <button class="btn primary" data-no>Don't buy it 👍</button>
        </div>`);
      if (!ok) { toast('Good call. Money saved!'); return false; }
    }
    state.expenses.push({ ...exp, id: uid(), createdAt: Date.now() });
    save();
    render();
    toast(`Added ${money(exp.amount)}`);
    return true;
  }

  function expenseFormValues(form) {
    return {
      amount: num(form.amount.value),
      categoryId: form.categoryId.value,
      method: form.method.value,
      date: form.date.value || todayStr(),
      note: form.note.value.trim(),
    };
  }

  $('#expenseForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.currentTarget;
    const exp = expenseFormValues(form);
    if (exp.amount <= 0) return toast('Enter an amount');
    if (await addExpense(exp)) {
      form.amount.value = '';
      form.note.value = '';
      form.amount.focus();
    }
  });

  function quickAdd() {
    openModal(`
      <h3>Add expense</h3>
      <form id="quickForm" class="form-grid" autocomplete="off">
        <label>Amount (₹)<input type="number" name="amount" min="1" step="any" required inputmode="decimal" /></label>
        <label>Category<select name="categoryId">${state.categories.map((c) => `<option value="${c.id}">${c.icon} ${esc(c.name)}</option>`).join('')}</select></label>
        <label>Paid with<select name="method">${Object.entries(METHOD_LABEL).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></label>
        <label>Date<input type="date" name="date" value="${todayStr()}" required /></label>
        <label class="wide">Note<input type="text" name="note" maxlength="80" placeholder="What was it for?" /></label>
        <div class="wide actions" style="margin-top:4px">
          <button type="button" class="btn" data-cancel>Cancel</button>
          <button type="submit" class="btn primary">Add</button>
        </div>
      </form>`);
    $('#quickForm [data-cancel]').addEventListener('click', () => closeModal(false));
    $('#quickForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const exp = expenseFormValues(e.currentTarget);
      if (exp.amount <= 0) return toast('Enter an amount');
      closeModal(false);
      await addExpense(exp);
    });
  }

  function emiForm(e) {
    const isNew = !e;
    e = e || { name: '', lender: '', kind: 'personal', amount: '', dueDay: 5, totalMonths: 12, paidMonths: 0, rate: '' };
    openModal(`
      <h3>${isNew ? 'Add EMI' : 'Edit EMI'}</h3>
      <form id="emiForm" class="form-grid" autocomplete="off">
        <label class="wide">Name<input name="name" required maxlength="50" placeholder="e.g. HDFC personal loan, iPhone EMI" value="${esc(e.name)}" /></label>
        <label>Type<select name="kind">${Object.entries(EMI_KIND).map(([k, v]) => `<option value="${k}" ${k === e.kind ? 'selected' : ''}>${v.icon} ${v.label}</option>`).join('')}</select></label>
        <label>Bank / lender<input name="lender" maxlength="40" placeholder="optional" value="${esc(e.lender)}" /></label>
        <label>EMI amount (₹ / month)<input type="number" name="amount" min="1" step="any" required value="${e.amount}" /></label>
        <label>Due on day of month<input type="number" name="dueDay" min="1" max="31" required value="${e.dueDay}" /></label>
        <label>Total tenure (months)<input type="number" name="totalMonths" min="1" required value="${e.totalMonths}" /></label>
        <label>EMIs already paid<input type="number" name="paidMonths" min="0" required value="${e.paidMonths}" /></label>
        <label class="wide">Interest rate % p.a. (optional)<input type="number" name="rate" min="0" step="any" value="${e.rate}" /></label>
        <div class="wide actions" style="margin-top:4px">
          <button type="button" class="btn" data-cancel>Cancel</button>
          <button type="submit" class="btn primary">${isNew ? 'Add EMI' : 'Save'}</button>
        </div>
      </form>`);
    $('#emiForm [data-cancel]').addEventListener('click', () => closeModal(false));
    $('#emiForm').addEventListener('submit', (ev) => {
      ev.preventDefault();
      const f = ev.currentTarget;
      const data = {
        name: f.name.value.trim(),
        lender: f.lender.value.trim(),
        kind: f.kind.value,
        amount: num(f.amount.value),
        dueDay: Math.min(31, Math.max(1, Math.round(num(f.dueDay.value)))),
        totalMonths: Math.max(1, Math.round(num(f.totalMonths.value))),
        paidMonths: Math.max(0, Math.round(num(f.paidMonths.value))),
        rate: num(f.rate.value),
      };
      if (data.paidMonths > data.totalMonths) return toast('Paid EMIs cannot be more than total tenure');
      if (isNew) state.emis.push({ ...data, id: uid(), payments: [] });
      else Object.assign(state.emis.find((x) => x.id === e.id), data);
      save();
      closeModal(true);
      render();
      toast(isNew ? 'EMI added' : 'EMI updated');
    });
  }

  function markPaid(id, paid) {
    const e = state.emis.find((x) => x.id === id);
    if (!e) return;
    const m = thisMonth();
    e.payments = e.payments || [];
    if (paid && !e.payments.includes(m)) {
      e.payments.push(m);
      e.paidMonths = Math.min(num(e.totalMonths), num(e.paidMonths) + 1);
      toast(emiRemainingMonths(e) === 0 ? `🎉 ${e.name} is fully paid off!` : `${e.name} marked paid`);
    } else if (!paid && e.payments.includes(m)) {
      e.payments = e.payments.filter((x) => x !== m);
      e.paidMonths = Math.max(0, num(e.paidMonths) - 1);
    }
    save();
    render();
  }

  function categoryForm(c) {
    const isNew = !c;
    c = c || { name: '', icon: '📦', limit: 0 };
    openModal(`
      <h3>${isNew ? 'Add category' : 'Edit category'}</h3>
      <form id="catForm" class="form-grid" autocomplete="off">
        <label>Icon (emoji)<input name="icon" maxlength="4" value="${esc(c.icon)}" /></label>
        <label>Name<input name="name" required maxlength="40" value="${esc(c.name)}" /></label>
        <label class="wide">Monthly limit (₹, 0 = no limit)<input type="number" name="limit" min="0" step="any" value="${num(c.limit) || ''}" /></label>
        <div class="wide actions" style="margin-top:4px">
          ${isNew ? '' : '<button type="button" class="btn danger" data-delete>Delete</button>'}
          <button type="button" class="btn" data-cancel>Cancel</button>
          <button type="submit" class="btn primary">Save</button>
        </div>
      </form>`);
    $('#catForm [data-cancel]').addEventListener('click', () => closeModal(false));
    $('#catForm [data-delete]')?.addEventListener('click', () => {
      if (state.expenses.some((x) => x.categoryId === c.id)) {
        toast('This category has expenses — it can’t be deleted. Set its limit instead.');
        return;
      }
      state.categories = state.categories.filter((x) => x.id !== c.id);
      save(); closeModal(true); render();
    });
    $('#catForm').addEventListener('submit', (ev) => {
      ev.preventDefault();
      const f = ev.currentTarget;
      const data = { name: f.name.value.trim(), icon: f.icon.value.trim() || '📦', limit: num(f.limit.value) };
      if (isNew) state.categories.push({ ...data, id: uid() });
      else Object.assign(state.categories.find((x) => x.id === c.id), data);
      save(); closeModal(true); render();
    });
  }

  /* ------------------------------------------------------------------ *
   * Event wiring
   * ------------------------------------------------------------------ */
  function showView(name) {
    $$('.tab').forEach((t) => t.classList.toggle('active', t.dataset.view === name));
    $$('.view').forEach((v) => v.classList.toggle('active', v.id === 'view-' + name));
    try { localStorage.setItem(STORAGE_KEY + '.tab', name); } catch (e) { /* ignore */ }
    window.scrollTo(0, 0);
  }

  $$('.tab').forEach((t) => t.addEventListener('click', () => showView(t.dataset.view)));

  document.addEventListener('click', async (e) => {
    const el = e.target.closest('button, [data-goto]');
    if (!el) return;
    const d = el.dataset;
    if (d.goto) showView(d.goto);
    else if (d.pay) markPaid(d.pay, true);
    else if (d.unpay) markPaid(d.unpay, false);
    else if (d.editEmi) emiForm(state.emis.find((x) => x.id === d.editEmi));
    else if (d.editCat) categoryForm(state.categories.find((x) => x.id === d.editCat));
    else if (d.delEmi) {
      const emi = state.emis.find((x) => x.id === d.delEmi);
      const ok = await confirmModal(`<h3>Delete “${esc(emi.name)}”?</h3><p class="muted">This removes the EMI and its payment history.</p>
        <div class="actions"><button class="btn" data-no>Cancel</button><button class="btn solid-danger" data-yes>Delete</button></div>`);
      if (ok) { state.emis = state.emis.filter((x) => x.id !== d.delEmi); save(); render(); }
    } else if (d.delExp) {
      state.expenses = state.expenses.filter((x) => x.id !== d.delExp);
      save(); render(); toast('Expense deleted');
    }
  });

  $('#quickAddBtn').addEventListener('click', quickAdd);
  $('#addEmiBtn').addEventListener('click', () => emiForm(null));
  $('#addCatBtn').addEventListener('click', () => categoryForm(null));
  $('#expenseMonth').addEventListener('change', renderExpenses);
  $('#expenseCatFilter').addEventListener('change', renderExpenses);

  $('#settingsForm').addEventListener('input', updateBudgetPreview);
  $('#settingsForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const f = e.currentTarget;
    state.settings = {
      income: num(f.income.value),
      fixedBills: num(f.fixedBills.value),
      savingsGoal: num(f.savingsGoal.value),
      ccLimit: num(f.ccLimit.value),
    };
    save(); render(); toast('Budget saved');
  });

  $('#exportBtn').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `expense-backup-${todayStr()}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });

  $('#importInput').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      if (!data || !Array.isArray(data.expenses) || !Array.isArray(data.emis)) throw new Error('bad file');
      const ok = await confirmModal(`<h3>Restore backup?</h3><p class="muted">This replaces everything currently in the app with the backup (${data.expenses.length} expenses, ${data.emis.length} EMIs).</p>
        <div class="actions"><button class="btn" data-no>Cancel</button><button class="btn primary" data-yes>Restore</button></div>`);
      if (ok) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
        state = load();
        render();
        toast('Backup restored');
      }
    } catch (err) {
      toast('That file is not a valid backup');
    }
    e.target.value = '';
  });

  $('#resetBtn').addEventListener('click', async () => {
    const ok = await confirmModal(`<h3>Erase all data?</h3><p class="muted">All expenses, EMIs and settings will be deleted from this browser. Download a backup first if you might need it. This cannot be undone.</p>
      <div class="actions"><button class="btn" data-no>Cancel</button><button class="btn solid-danger" data-yes>Erase everything</button></div>`);
    if (ok) { state = defaultState(); save(); render(); toast('All data erased'); }
  });

  /* ------------------------------------------------------------------ *
   * Boot
   * ------------------------------------------------------------------ */
  $('#expenseForm [name=date]').value = todayStr();
  render();
  let startTab = 'dashboard';
  try { startTab = localStorage.getItem(STORAGE_KEY + '.tab') || 'dashboard'; } catch (e) { /* ignore */ }
  if (!state.settings.income) startTab = 'dashboard';
  showView(startTab);

  // Re-render when the date rolls over (app left open overnight).
  let lastDay = todayStr();
  setInterval(() => { if (todayStr() !== lastDay) { lastDay = todayStr(); render(); } }, 60000);
})();
