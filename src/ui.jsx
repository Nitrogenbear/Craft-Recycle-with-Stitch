import { createContext, useContext, useEffect, useState } from 'react';
import { deadlineLabel, deadlineState } from './util.js';

export const AppCtx = createContext(null);
export const useApp = () => useContext(AppCtx);

// Re-render every second while something is ticking.
export function useNow(active = true) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [active]);
  return now;
}

export function Modal({ title, onClose, children, wide }) {
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <header className="modal-head">
          <h2>{title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close">✕</button>
        </header>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}

const STATUS_CLASS = {
  New: 'blue', 'In Progress': 'green', 'On Hold': 'grey', 'Ready for Pickup': 'purple', Completed: 'muted',
};
export const StatusPill = ({ status }) => <span className={`pill ${STATUS_CLASS[status]}`}>{status}</span>;

export function DeadlineTag({ job }) {
  const state = deadlineState(job);
  const label = deadlineLabel(job);
  if (!label) return null;
  const cls = { overdue: 'red', close: 'yellow', new: 'blue', ok: 'green', done: 'purple' }[state];
  return <span className={`tag ${cls}`}>{state === 'overdue' ? '⚠ ' : ''}{label}</span>;
}

export function Field({ label, children, hint, span }) {
  return (
    <label className={`field ${span ? 'span-2' : ''}`}>
      <span className="field-label">{label}</span>
      {children}
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  );
}

export function Empty({ children }) {
  return <div className="empty">{children}</div>;
}
