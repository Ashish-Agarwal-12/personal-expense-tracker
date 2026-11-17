'use client';

import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { api, ApiError, setUnauthorizedHandler } from '@/lib/client/api';
import { monthName, ym, ymd } from '@/lib/format';
import type { AppData } from '@/lib/types';
import { ExpenseForm } from './forms';
import { TrackerProvider, useTracker } from './tracker-context';
import { ModalHost, UiProvider, useModal, useToast } from './ui';
import { Dashboard, EmisView, ExpensesView, SettingsView, type View } from './views';

// Old versions kept everything in localStorage under this key; we offer to upload it once.
const LEGACY_KEY = 'debtFreeTracker.v1';
const TAB_KEY = 'debtFreeTracker.tab';
const TABS: { id: View; label: string }[] = [
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'expenses', label: 'Expenses' },
  { id: 'emis', label: 'EMIs & Loans' },
  { id: 'settings', label: 'Budget & Settings' },
];

type Phase =
  | { kind: 'loading' }
  | { kind: 'login' }
  | { kind: 'ready'; data: AppData }
  | { kind: 'error'; message: string; setupProblems?: string[] };

export default function TrackerApp() {
  return (
    <UiProvider>
      <Gate />
    </UiProvider>
  );
}

/** Decides what to show: loading, login, a server problem, or the app. */
function Gate() {
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' });

  const openApp = useCallback(async () => {
    const data = await api<AppData>('GET', '/data');
    setPhase({ kind: 'ready', data });
  }, []);

  const boot = useCallback(async () => {
    setPhase({ kind: 'loading' });
    try {
      const { authenticated } = await api<{ authenticated: boolean }>('GET', '/session');
      if (authenticated) await openApp();
      else setPhase({ kind: 'login' });
    } catch (e) {
      const err = e as ApiError;
      if (err.status !== 401) setPhase({ kind: 'error', message: err.message, setupProblems: err.setupProblems });
    }
  }, [openApp]);

  useEffect(() => {
    setUnauthorizedHandler(() => setPhase({ kind: 'login' }));
    boot();
  }, [boot]);

  if (phase.kind === 'loading') return null;
  if (phase.kind === 'login') return <LoginScreen onLoggedIn={openApp} />;
  if (phase.kind === 'error') return <ProblemScreen message={phase.message} setupProblems={phase.setupProblems} onRetry={boot} />;
  return <ReadyApp initial={phase.data} onLoggedOut={() => setPhase({ kind: 'login' })} />;
}

function LoginScreen({ onLoggedIn }: { onLoggedIn: () => Promise<void> }) {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await api('POST', '/login', { password: input.current!.value });
      await onLoggedIn();
    } catch (err) {
      setError((err as Error).message);
      input.current!.value = '';
      input.current!.focus();
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="login">
      <form className="card login-card" onSubmit={submit}>
        <span className="logo">₹</span>
        <h1>Debt-Free Tracker</h1>
        <p className="muted small">Enter your password to open your tracker.</p>
        <label>
          Password
          <input ref={input} type="password" name="password" required autoComplete="current-password" autoFocus />
        </label>
        <p className="danger-text small" role="alert">{error}</p>
        <button className="btn primary" type="submit" disabled={busy}>Log in</button>
      </form>
    </section>
  );
}

function ProblemScreen({ message, setupProblems, onRetry }: { message: string; setupProblems?: string[]; onRetry: () => void }) {
  const setup = !!setupProblems?.length;
  return (
    <div className="login">
      <div className={`card login-card${setup ? ' setup-card' : ''}`}>
        <h1>{setup ? '⚙️ Server setup problem' : "Can't reach the server"}</h1>
        {setup ? (
          <>
            <p className="muted small">The website is online, but the server isn&apos;t set up correctly yet. Fix this, then redeploy:</p>
            <ul className="setup-list">{setupProblems!.map((p, i) => <li key={i}>{p}</li>)}</ul>
          </>
        ) : (
          <p className="muted">{message}</p>
        )}
        <button className="btn primary" onClick={onRetry}>Try again</button>
      </div>
    </div>
  );
}

/** Re-renders when the calendar day changes, so "today" stays correct if the app is left open. */
function useToday(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => {
      const d = new Date();
      setNow((prev) => (ymd(prev) === ymd(d) ? prev : d));
    }, 60_000);
    return () => clearInterval(t);
  }, []);
  return now;
}

function ReadyApp({ initial, onLoggedOut }: { initial: AppData; onLoggedOut: () => void }) {
  const now = useToday();
  return (
    <TrackerProvider initial={initial} now={now}>
      <Shell onLoggedOut={onLoggedOut} />
    </TrackerProvider>
  );
}

function Shell({ onLoggedOut }: { onLoggedOut: () => void }) {
  const { data, now, reload, importBackup } = useTracker();
  const modal = useModal();
  const toast = useToast();
  const [view, setView] = useState<View>('dashboard');

  // Restore the last tab (but start on the dashboard until a salary is set).
  useEffect(() => {
    try {
      const saved = localStorage.getItem(TAB_KEY) as View | null;
      if (saved && data.settings.income && TABS.some((t) => t.id === saved)) setView(saved);
    } catch { /* storage blocked */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const goto = useCallback((v: View) => {
    setView(v);
    try { localStorage.setItem(TAB_KEY, v); } catch { /* ignore */ }
    window.scrollTo(0, 0);
  }, []);

  // Coming back to the tab (e.g. you added something on your phone): fetch the latest data.
  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === 'visible' && !document.querySelector('.modal')) reload().catch(() => {});
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [reload]);

  // One-time offer to upload data saved by the old browser-only version.
  useEffect(() => {
    let legacy: { expenses?: unknown[]; emis?: unknown[] } | null = null;
    try { legacy = JSON.parse(localStorage.getItem(LEGACY_KEY) || 'null'); } catch { return; }
    if (!legacy || (!legacy.expenses?.length && !legacy.emis?.length)) return;
    if (data.expenses.length || data.emis.length) return;
    (async () => {
      const ok = await modal.confirm({
        title: 'Move your saved data online?',
        body: (
          <p className="muted">
            This browser has data from the offline version ({legacy!.expenses?.length || 0} expenses, {legacy!.emis?.length || 0} EMIs). Upload it to your database so you can see it from any device?
          </p>
        ),
        yes: 'Upload',
        no: 'Not now',
      });
      if (!ok) return;
      try {
        await importBackup(legacy);
        localStorage.removeItem(LEGACY_KEY);
        toast('Your data is now saved online');
      } catch (err) {
        toast((err as Error).message);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function logout() {
    try { await api('POST', '/logout'); } catch { /* ignore */ }
    onLoggedOut();
  }

  const quickAdd = () =>
    modal.open((close) => (
      <>
        <h3>Add expense</h3>
        <ExpenseForm compact onDone={() => close()} onCancel={() => close()} />
      </>
    ));

  return (
    <>
      <header className="topbar">
        <div className="brand">
          <span className="logo">₹</span>
          <div>
            <h1>Debt-Free Tracker</h1>
            <p className="sub">{monthName(ym(now))}</p>
          </div>
        </div>
        <button className="btn primary" id="quickAddBtn" onClick={quickAdd}>+ Add expense</button>
      </header>

      <nav className="tabs" role="tablist">
        {TABS.map((t) => (
          <button key={t.id} role="tab" aria-selected={view === t.id} className={`tab ${view === t.id ? 'active' : ''}`} onClick={() => goto(t.id)}>
            {t.label}
          </button>
        ))}
      </nav>

      <main>
        {view === 'dashboard' && <Dashboard goto={goto} />}
        {view === 'expenses' && <ExpensesView />}
        {view === 'emis' && <EmisView />}
        {view === 'settings' && <SettingsView key={JSON.stringify(data.settings)} onLogout={logout} />}
      </main>

      {/* Inside TrackerProvider, so pop-up forms can read and change your data. */}
      <ModalHost />
    </>
  );
}
