import { createContext, useContext, useEffect, useState } from 'react';
import { deadlineLabel, deadlineState, hasValue, jobTotal, pricedByGarment } from './util.js';

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

// Click-to-edit amount in pounds. Shows "+ Add price" when there isn't one yet.
export function PriceInput({ value: current, onSave, size, addLabel = '+ Add price', title = 'Change price' }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState('');
  const has = hasValue(current);

  const open = (e) => {
    e?.stopPropagation();
    setValue(has ? String(current) : '');
    setEditing(true);
  };
  const commit = () => {
    setEditing(false);
    const v = value.trim().replace(/^£/, '');
    if (v === (has ? String(current) : '')) return;
    onSave(v);
  };

  if (editing) {
    return (
      <span className={`price-edit ${size || ''}`} onClick={(e) => e.stopPropagation()}>
        <span className="price-symbol">£</span>
        <input
          type="number" inputMode="decimal" min={0} step="0.5" autoFocus value={value} placeholder="0.00"
          aria-label="Price in pounds"
          onChange={(e) => setValue(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') setEditing(false); }}
        />
      </span>
    );
  }
  return has ? (
    <button type="button" className={`price-chip ${size || ''}`} onClick={open} title={title}>
      £{Number(current).toFixed(2)} <span aria-hidden="true">✎</span>
    </button>
  ) : (
    <button type="button" className={`price-chip add ${size || ''}`} onClick={open}>{addLabel}</button>
  );
}

// The job's total. If garments are priced individually it's their sum (not editable here);
// otherwise it's a single editable price for the whole job.
export function PriceEditor({ job, size }) {
  const { actions } = useApp();
  if (pricedByGarment(job)) {
    const unpriced = job.garments.filter((g) => !hasValue(g.price)).length;
    return (
      <span className={`price-total ${size || ''}`} title="Total of the garment prices">
        £{Number(jobTotal(job)).toFixed(2)}
        <span className="price-note">{unpriced ? `${unpriced} garment${unpriced > 1 ? 's' : ''} not priced` : 'total'}</span>
      </span>
    );
  }
  return <PriceInput value={job.price} size={size} onSave={(v) => actions.setPrice(job.id, v)} />;
}

export function GarmentPrice({ job, garment }) {
  const { actions } = useApp();
  return (
    <PriceInput value={garment.price} addLabel="+ Price" title="Change this garment's price"
      onSave={(v) => actions.setGarmentPrice(job.id, garment.id, v)} />
  );
}

export function Empty({ children }) {
  return <div className="empty">{children}</div>;
}
