'use client';

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';

/** Renders text with **bold** markers safely (no HTML injection). */
export function Rich({ text }: { text: string }) {
  const parts = text.split('**');
  return <>{parts.map((p, i) => (i % 2 ? <b key={i}>{p}</b> : p))}</>;
}

export function Stat({ label, value, hint, tone = '' }: { label: string; value: string; hint?: string; tone?: string }) {
  return (
    <div className="card stat">
      <div className="label">{label}</div>
      <div className={`value num ${tone}`}>{value}</div>
      {hint && <div className="hint">{hint}</div>}
    </div>
  );
}

/* ---------------- toast ---------------- */

const ToastContext = createContext<(msg: string) => void>(() => {});
export const useToast = () => useContext(ToastContext);

/* ---------------- modal ---------------- */

type CloseFn = (result?: boolean) => void;
interface ModalApi {
  /** Show any content; it receives `close`. */
  open(render: (close: CloseFn) => ReactNode): Promise<boolean>;
  /** Yes/no question. */
  confirm(opts: { title: string; body?: ReactNode; yes: string; no?: string; danger?: boolean; icon?: string; primary?: 'yes' | 'no' }): Promise<boolean>;
}
const ModalContext = createContext<ModalApi | null>(null);
export const useModal = () => useContext(ModalContext)!;

interface ModalState {
  node: ReactNode;
  close: CloseFn;
}
const ModalStateContext = createContext<ModalState | null>(null);

/**
 * Where the open pop-up is drawn. Place it *inside* any providers the pop-up content needs
 * (e.g. the tracker data), so forms in a pop-up can use them.
 */
export function ModalHost() {
  const modal = useContext(ModalStateContext);
  if (!modal) return null;
  return (
    <div className="modal-backdrop" onClick={(e) => e.target === e.currentTarget && modal.close(false)}>
      <div className="modal" role="dialog" aria-modal="true">
        {modal.node}
      </div>
    </div>
  );
}

export function UiProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const showToast = useCallback((msg: string) => {
    setToast(msg);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setToast(null), 2600);
  }, []);

  const [modal, setModal] = useState<{ node: ReactNode; resolve: (v: boolean) => void } | null>(null);
  const modalRef = useRef(modal);
  modalRef.current = modal;

  const close = useCallback<CloseFn>((result = false) => {
    const m = modalRef.current;
    setModal(null);
    m?.resolve(result);
  }, []);

  const open = useCallback<ModalApi['open']>(
    (render) =>
      new Promise<boolean>((resolve) => {
        modalRef.current?.resolve(false);
        setModal({ node: render(close), resolve });
      }),
    [close],
  );

  const confirm = useCallback<ModalApi['confirm']>(
    ({ title, body, yes, no = 'Cancel', danger, icon, primary = 'yes' }) =>
      open((done) => (
        <>
          {icon && <div className="warn-head">{icon}</div>}
          <h3>{title}</h3>
          {body}
          <div className="actions">
            <button className={`btn ${primary === 'no' ? 'primary' : ''}`} onClick={() => done(false)} autoFocus={primary === 'no'}>
              {no}
            </button>
            <button className={`btn ${primary === 'yes' ? (danger ? 'solid-danger' : 'primary') : ''}`} onClick={() => done(true)} autoFocus={primary === 'yes'}>
              {yes}
            </button>
          </div>
        </>
      )),
    [open],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && modalRef.current && close(false);
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [close]);

  return (
    <ToastContext.Provider value={showToast}>
      <ModalContext.Provider value={{ open, confirm }}>
        <ModalStateContext.Provider value={modal ? { node: modal.node, close } : null}>{children}</ModalStateContext.Provider>
        {toast && (
          <div className="toast" role="status">
            {toast}
          </div>
        )}
      </ModalContext.Provider>
    </ToastContext.Provider>
  );
}
