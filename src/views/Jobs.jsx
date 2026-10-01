import { useEffect, useMemo, useState } from 'react';
import { DeadlineTag, Empty, StatusPill, useApp, useNow } from '../ui.jsx';
import { SERVICES, STATUSES, deadlineState, fmtDate, fmtDuration, isRunning, jobMs } from '../util.js';

const VIEWS = [
  ['active', 'Active'],
  ['warnings', '⚠ Due soon + overdue'],
  ['overdue', 'Overdue only'],
  ['history', 'History (completed)'],
  ['all', 'All jobs'],
];

const COLS = [
  ['ticket', 'Ticket'],
  ['client', 'Client'],
  ['service', 'Service'],
  ['garments', 'Items'],
  ['startDate', 'Started'],
  ['dueDate', 'Hand-back'],
  ['finishedDate', 'Finished'],
  ['status', 'Status'],
  ['time', 'Time'],
];

function initialView(params) {
  if (params.status) return `status:${params.status}`;
  return params.filter || 'active';
}

export default function Jobs({ params }) {
  const { state } = useApp();
  const now = useNow(state.jobs.some(isRunning));
  const [view, setView] = useState(initialView(params));
  const [service, setService] = useState('');
  const [q, setQ] = useState('');
  const [sort, setSort] = useState({ key: 'dueDate', dir: 1 });

  useEffect(() => setView(initialView(params)), [params.filter, params.status]);

  const rows = useMemo(() => {
    const term = q.trim().toLowerCase();
    let list = state.jobs.filter((j) => {
      const ds = deadlineState(j);
      if (view === 'active' && j.status === 'Completed') return false;
      if (view === 'history' && j.status !== 'Completed') return false;
      if (view === 'warnings' && !['overdue', 'close'].includes(ds)) return false;
      if (view === 'overdue' && ds !== 'overdue') return false;
      if (view.startsWith('status:') && j.status !== view.slice(7)) return false;
      if (service && j.service !== service) return false;
      if (term) {
        const hay = [j.ticket, j.client.name, j.client.phone, j.client.email, j.description, j.instructions].join(' ').toLowerCase();
        if (!hay.includes(term)) return false;
      }
      return true;
    });
    const val = (j) => {
      switch (sort.key) {
        case 'client': return j.client.name.toLowerCase();
        case 'garments': return j.garments.length;
        case 'time': return jobMs(j, now);
        case 'status': return STATUSES.indexOf(j.status);
        default: return j[sort.key] || (sort.dir > 0 ? '￿' : '');
      }
    };
    return list.sort((a, b) => {
      const x = val(a), y = val(b);
      return (x < y ? -1 : x > y ? 1 : 0) * sort.dir;
    });
  }, [state.jobs, view, service, q, sort, now]);

  const clickSort = (key) => setSort((s) => ({ key, dir: s.key === key ? -s.dir : key === 'dueDate' ? 1 : -1 }));

  return (
    <div className="jobs-page">
      <div className="page-head">
        <h1>Jobs</h1>
        <div className="filters">
          <input type="search" placeholder="Search name, ticket, phone…" value={q} onChange={(e) => setQ(e.target.value)} />
          <select value={view} onChange={(e) => setView(e.target.value)} aria-label="Show">
            {VIEWS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            <optgroup label="By status">
              {STATUSES.map((s) => <option key={s} value={`status:${s}`}>{s}</option>)}
            </optgroup>
          </select>
          <select value={service} onChange={(e) => setService(e.target.value)} aria-label="Service">
            <option value="">All services</option>
            {SERVICES.map((s) => <option key={s}>{s}</option>)}
          </select>
          <select className="mobile-only" value={`${sort.key}:${sort.dir}`} aria-label="Sort"
            onChange={(e) => { const [key, dir] = e.target.value.split(':'); setSort({ key, dir: Number(dir) }); }}>
            <option value="dueDate:1">Hand-back date</option>
            <option value="startDate:-1">Newest first</option>
            <option value="status:1">Status</option>
            <option value="client:1">Client A–Z</option>
          </select>
        </div>
      </div>

      {rows.length === 0 ? <Empty>No jobs match.</Empty> : (
        <table className="jobs-table">
          <thead>
            <tr>
              {COLS.map(([k, l]) => (
                <th key={k} onClick={() => clickSort(k)} className={sort.key === k ? 'sorted' : ''} aria-sort={sort.key === k ? (sort.dir > 0 ? 'ascending' : 'descending') : 'none'}>
                  {l} {sort.key === k ? (sort.dir > 0 ? '▲' : '▼') : ''}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((j) => (
              <tr key={j.id} className={`edge-${deadlineState(j)}`} onClick={() => { location.hash = `#/job/${j.id}`; }}>
                <td data-label="Ticket" className="mono">{j.ticket}{isRunning(j) && <span className="pulse" />}</td>
                <td data-label="Client"><strong>{j.client.name}</strong><div className="muted small ellipsis">{j.description}</div></td>
                <td data-label="Service">{j.service}</td>
                <td data-label="Items">{j.garments.filter((g) => g.done).length}/{j.garments.length}</td>
                <td data-label="Started">{fmtDate(j.startDate)}</td>
                <td data-label="Hand-back">{fmtDate(j.dueDate)} <DeadlineTag job={j} /></td>
                <td data-label="Finished">{fmtDate(j.finishedDate)}</td>
                <td data-label="Status"><StatusPill status={j.status} /></td>
                <td data-label="Time" className="mono">{fmtDuration(jobMs(j, now), false)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p className="muted small legend">
        <span className="dot blue" /> New <span className="dot green" /> On track <span className="dot yellow" /> Due within 2 days <span className="dot red" /> Overdue <span className="dot purple" /> Ready / collected
      </p>
    </div>
  );
}
