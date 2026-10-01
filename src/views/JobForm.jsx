import { useMemo, useState } from 'react';
import { Field, Modal, useApp } from '../ui.jsx';
import { SERVICES, addDaysISO, todayISO } from '../util.js';

const blankClient = { name: '', phone: '', email: '', address: '', bestTime: '' };

export default function JobForm({ job, prefill, onClose, onSave }) {
  const { state } = useApp();
  const today = todayISO();
  const [f, setF] = useState(() => job
    ? { ...job, client: { ...blankClient, ...job.client }, garmentCount: job.garments.length }
    : {
        ticket: '', client: { ...blankClient, ...(prefill?.client || {}) }, startDate: today, dueDate: addDaysISO(today, 7),
        service: 'Alterations', description: '', instructions: '', price: '', garmentCount: 1,
      });
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  const setClient = (k, v) => setF((x) => ({ ...x, client: { ...x.client, [k]: v } }));

  // Repeat clients: most recent details for each name
  const clients = useMemo(() => {
    const m = new Map();
    [...state.jobs].sort((a, b) => a.createdAt - b.createdAt).forEach((j) => m.set(j.client.name.trim().toLowerCase(), j.client));
    return m;
  }, [state.jobs]);

  const onName = (name) => {
    const known = clients.get(name.trim().toLowerCase());
    if (known && !job) setF((x) => ({ ...x, client: { ...blankClient, ...known, name } }));
    else setClient('name', name);
  };
  const isReturning = !job && clients.has(f.client.name.trim().toLowerCase());

  const nextTicket = `${state.settings.ticketPrefix}${String(state.settings.nextTicket).padStart(4, '0')}`;
  const submit = (e) => {
    e.preventDefault();
    onSave(f);
  };

  return (
    <Modal title={job ? `Edit ${job.ticket}` : 'New job'} onClose={onClose} wide>
      <form onSubmit={submit} className="form">
        <fieldset>
          <legend>Client {isReturning && <span className="tag green">Returning client — details filled in</span>}</legend>
          <div className="grid-2">
            <Field label="Full name *">
              <input required list="client-names" value={f.client.name} onChange={(e) => onName(e.target.value)} autoFocus={!job} autoComplete="off" />
              <datalist id="client-names">
                {[...clients.values()].map((c) => <option key={c.name} value={c.name} />)}
              </datalist>
            </Field>
            <Field label="Phone *">
              <input required type="tel" value={f.client.phone} onChange={(e) => setClient('phone', e.target.value)} />
            </Field>
            <Field label="Email">
              <input type="email" value={f.client.email} onChange={(e) => setClient('email', e.target.value)} />
            </Field>
            <Field label="Best time to contact">
              <input value={f.client.bestTime} placeholder="e.g. after 5pm, weekdays" onChange={(e) => setClient('bestTime', e.target.value)} />
            </Field>
            <Field label="Postal address" span>
              <textarea rows={2} value={f.client.address} onChange={(e) => setClient('address', e.target.value)} />
            </Field>
          </div>
        </fieldset>

        <fieldset>
          <legend>Job</legend>
          <div className="grid-3">
            <Field label="Ticket / job number" hint={job ? '' : `Leave blank for ${nextTicket}`}>
              <input value={f.ticket} placeholder={job ? '' : nextTicket} onChange={(e) => set('ticket', e.target.value)} />
            </Field>
            <Field label="Service type">
              <select value={f.service} onChange={(e) => set('service', e.target.value)}>
                {SERVICES.map((s) => <option key={s}>{s}</option>)}
              </select>
            </Field>
            <Field label="Number of garments">
              <input type="number" min={1} max={50} value={f.garmentCount} onChange={(e) => set('garmentCount', e.target.value)} />
            </Field>
            <Field label="Start date">
              <input type="date" required value={f.startDate} onChange={(e) => set('startDate', e.target.value)} />
            </Field>
            <Field label="Hand-back date *">
              <input type="date" required value={f.dueDate} min={f.startDate} onChange={(e) => set('dueDate', e.target.value)} />
            </Field>
            <Field label="Price (£)">
              <input type="number" min={0} step="0.5" value={f.price} placeholder="e.g. 18" onChange={(e) => set('price', e.target.value)} />
            </Field>
          </div>
          <div className="quick-dates">
            Hand back in:
            {[2, 3, 5, 7, 14].map((d) => (
              <button type="button" key={d} className="chip" onClick={() => set('dueDate', addDaysISO(f.startDate, d))}>{d} days</button>
            ))}
          </div>
          <Field label="Work description *">
            <textarea required rows={3} value={f.description} placeholder="e.g. Hem two pairs of jeans, taper legs" onChange={(e) => set('description', e.target.value)} />
          </Field>
          <Field label="Special instructions">
            <textarea rows={2} value={f.instructions} placeholder="e.g. Customer prefers a narrow hem" onChange={(e) => set('instructions', e.target.value)} />
          </Field>
        </fieldset>

        <div className="form-actions">
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn primary">{job ? 'Save changes' : 'Create job'}</button>
        </div>
      </form>
    </Modal>
  );
}
