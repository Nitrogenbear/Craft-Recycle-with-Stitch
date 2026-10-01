import { useState } from 'react';
import { DeadlineTag, Field, Modal, StatusPill, useApp, useNow } from '../ui.jsx';
import { STATUSES, deadlineState, fmtDate, fmtDateTime, fmtDuration, fmtTime, garmentMs, isRunning, jobMs, money, todayISO } from '../util.js';
import TaskList from './TaskList.jsx';

export default function JobDetail({ job }) {
  const { actions } = useApp();
  const now = useNow(isRunning(job));
  const [manualFor, setManualFor] = useState(null);
  const [openLogs, setOpenLogs] = useState({});
  const total = jobMs(job, now);
  const times = job.garments.map((g) => garmentMs(g, now));
  const max = Math.max(...times, 1);
  const longest = times.indexOf(Math.max(...times));
  const allDone = job.garments.length > 0 && job.garments.every((g) => g.done);
  const finished = job.status === 'Ready for Pickup' || job.status === 'Completed';

  const confirmDelete = () => {
    if (confirm(`Delete job ${job.ticket} for ${job.client.name}? This can't be undone.`)) actions.deleteJob(job.id);
  };

  return (
    <div className="job-detail">
      <a href="#/jobs" className="back">← Jobs</a>
      <div className={`job-head edge-${deadlineState(job)}`}>
        <div>
          <div className="muted mono">{job.ticket} · {job.service}</div>
          <h1>{job.client.name}</h1>
          <div className="job-head-meta">
            <StatusPill status={job.status} />
            <DeadlineTag job={job} />
            <span className="muted">Started {fmtDate(job.startDate)} · Hand-back {fmtDate(job.dueDate)}{job.finishedDate ? ` · Finished ${fmtDate(job.finishedDate)}` : ''}</span>
          </div>
        </div>
        <div className="job-head-actions">
          <select value={job.status} onChange={(e) => actions.setStatus(job.id, e.target.value)} aria-label="Status">
            {STATUSES.map((s) => <option key={s}>{s}</option>)}
          </select>
          <button className="btn" onClick={() => actions.editJob(job)}>Edit</button>
          <button className="btn ghost danger" onClick={confirmDelete}>Delete</button>
        </div>
      </div>

      {allDone && !finished && (
        <div className="banner ok">
          All garments done.
          <button className="btn primary" onClick={() => actions.setStatus(job.id, 'Ready for Pickup')}>Mark ready for pickup →</button>
        </div>
      )}
      {job.status === 'Ready for Pickup' && (
        <div className="banner purple">
          Ready for pickup — {job.contactLog.length ? `last contact: ${job.contactLog[job.contactLog.length - 1].note}` : 'client not contacted yet'}.
          <button className="btn" onClick={() => actions.openContact(job.id)}>📞 Contact client</button>
          <button className="btn primary" onClick={() => actions.setStatus(job.id, 'Completed')}>✓ Collected</button>
        </div>
      )}

      <div className="detail-grid">
        <section className="card">
          <header className="card-head">
            <h2>Garments & time</h2>
            <span className="total-time mono">Total {fmtDuration(total)}</span>
          </header>
          <ul className="garments">
            {job.garments.map((g, i) => {
              const ms = times[i];
              const running = !!g.runningSince;
              return (
                <li key={g.id} className={`garment ${running ? 'running' : ''} ${g.done ? 'done' : ''}`}>
                  <div className="garment-row">
                    <input className="garment-label" value={g.label} aria-label="Garment name"
                      onChange={(e) => actions.renameGarment(job.id, g.id, e.target.value)} />
                    <span className="garment-time mono">{fmtDuration(ms)}</span>
                  </div>
                  <div className="bar" title={`${Math.round((ms / Math.max(total, 1)) * 100)}% of job time`}>
                    <span style={{ width: `${(ms / max) * 100}%` }} className={i === longest && ms > 0 && job.garments.length > 1 ? 'longest' : ''} />
                  </div>
                  <div className="garment-actions">
                    {g.done ? (
                      <>
                        <span className="tag green">✓ Done {g.completedAt ? fmtDateTime(g.completedAt) : ''}</span>
                        <button className="btn small ghost" onClick={() => actions.reopenGarment(job.id, g.id)}>Reopen</button>
                      </>
                    ) : running ? (
                      <>
                        <button className="btn timer stop" onClick={() => actions.stopTimer(job.id, g.id)}>■ Stop</button>
                        <button className="btn small primary" onClick={() => actions.completeGarment(job.id, g.id)}>✓ Garment complete</button>
                        <span className="muted small">since {fmtTime(g.runningSince)}</span>
                      </>
                    ) : (
                      <>
                        <button className="btn timer start" onClick={() => actions.startTimer(job.id, g.id)} disabled={job.status === 'Completed'}>▶ Start</button>
                        <button className="btn small" onClick={() => actions.completeGarment(job.id, g.id)}>✓ Complete</button>
                      </>
                    )}
                    <span className="spacer" />
                    <button className="btn small ghost" onClick={() => setManualFor(g)}>+ Add time</button>
                    <button className="btn small ghost" onClick={() => setOpenLogs((o) => ({ ...o, [g.id]: !o[g.id] }))}>
                      Log ({g.logs.length})
                    </button>
                    {!g.logs.length && !running && job.garments.length > 1 && (
                      <button className="icon-btn" title="Remove garment" onClick={() => actions.removeGarment(job.id, g.id)}>✕</button>
                    )}
                  </div>
                  {openLogs[g.id] && (
                    <ul className="logs">
                      {g.logs.length === 0 && <li className="muted">No time logged yet.</li>}
                      {g.logs.map((l) => (
                        <li key={l.id}>
                          <span>{fmtDate(l.date)}</span>
                          <span className="muted">{l.manual ? `manual${l.note ? ' — ' + l.note : ''}` : `${fmtTime(l.start)}–${fmtTime(l.end)}`}</span>
                          <span className="mono">{fmtDuration(l.ms)}</span>
                          <button className="icon-btn" title="Delete entry" onClick={() => confirm('Delete this time entry?') && actions.deleteLog(job.id, g.id, l.id)}>✕</button>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
          <button className="btn small ghost" onClick={() => actions.addGarment(job.id)}>+ Add garment</button>
          {job.garments.length > 1 && times[longest] > 0 && (
            <p className="muted small">Longest: <strong>{job.garments[longest].label}</strong> ({fmtDuration(times[longest], false)}, {Math.round((times[longest] / total) * 100)}% of job time)</p>
          )}
        </section>

        <div className="detail-side">
          <section className="card">
            <header className="card-head"><h2>Work</h2>{job.price !== '' && job.price != null && <strong>{money(job.price)}</strong>}</header>
            <p className="pre">{job.description}</p>
            {job.instructions && <><h3>Special instructions</h3><p className="pre instructions">{job.instructions}</p></>}
          </section>

          <section className="card">
            <header className="card-head"><h2>Client</h2><button className="btn small" onClick={() => actions.openContact(job.id)}>📞 Contact</button></header>
            <dl className="client-dl">
              <dt>Phone</dt><dd><a href={`tel:${job.client.phone}`}>{job.client.phone}</a></dd>
              {job.client.email && <><dt>Email</dt><dd><a href={`mailto:${job.client.email}`}>{job.client.email}</a></dd></>}
              {job.client.bestTime && <><dt>Best time</dt><dd>{job.client.bestTime}</dd></>}
              {job.client.address && <><dt>Address</dt><dd className="pre">{job.client.address}</dd></>}
            </dl>
            {job.contactLog.length > 0 && (
              <>
                <h3>Contact log</h3>
                <ul className="contact-log">
                  {[...job.contactLog].reverse().map((c) => <li key={c.id}><span className="muted small">{fmtDateTime(c.at)}</span> {c.note}</li>)}
                </ul>
              </>
            )}
          </section>

          <section className="card">
            <header className="card-head"><h2>Tasks for this job</h2></header>
            <TaskList mode="job" jobId={job.id} compact />
          </section>
        </div>
      </div>

      {manualFor && (
        <ManualTime garment={manualFor} onClose={() => setManualFor(null)}
          onSave={(v) => { actions.addManualTime(job.id, manualFor.id, v); setManualFor(null); actions.toast('Time added'); }} />
      )}
    </div>
  );
}

function ManualTime({ garment, onClose, onSave }) {
  const [date, setDate] = useState(todayISO());
  const [h, setH] = useState('0');
  const [m, setM] = useState('30');
  const [note, setNote] = useState('');
  const minutes = (Number(h) || 0) * 60 + (Number(m) || 0);
  return (
    <Modal title={`Add time — ${garment.label}`} onClose={onClose}>
      <form className="form" onSubmit={(e) => { e.preventDefault(); if (minutes > 0) onSave({ date, minutes, note }); }}>
        <p className="muted">Forgot to start the timer? Add the time here. To remove time, delete an entry from the log.</p>
        <div className="grid-3">
          <Field label="Date"><input type="date" value={date} max={todayISO()} onChange={(e) => setDate(e.target.value)} /></Field>
          <Field label="Hours"><input type="number" min={0} max={24} value={h} onChange={(e) => setH(e.target.value)} /></Field>
          <Field label="Minutes"><input type="number" min={0} max={59} value={m} onChange={(e) => setM(e.target.value)} /></Field>
        </div>
        <div className="quick-dates">
          {[10, 15, 20, 30, 45, 60, 90].map((n) => (
            <button type="button" key={n} className="chip" onClick={() => { setH(String(Math.floor(n / 60))); setM(String(n % 60)); }}>{n < 60 ? `${n}m` : `${n / 60}h`}</button>
          ))}
        </div>
        <Field label="Note (optional)"><input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. pinning & fitting" /></Field>
        <div className="form-actions">
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn primary" disabled={minutes <= 0}>Add {fmtDuration(minutes * 60000, false)}</button>
        </div>
      </form>
    </Modal>
  );
}
