import { useEffect, useState } from 'react';
import { Field, useApp } from '../ui.jsx';
import { ALL_COLUMNS, listBackups, migrate, readBackup } from '../store.js';
import { jobRows, summaryRows, timeLogRows, toCSV } from '../reports.js';
import * as sheets from '../sheets.js';
import { addDaysISO, download, fmtDateTime, startOfWeekISO, todayISO } from '../util.js';
import { demoState } from '../demo.js';

const EXPORT_COLS = ['Job #', 'Client', 'Phone', 'Email', 'Start Date', 'Due Date', 'End Date', 'Service Type', 'Garments', 'Description', 'Time Spent', 'Hours (decimal)', 'Cost', 'Notes'];

export default function Settings() {
  const { state, actions, syncing, sync } = useApp();
  const s = state.settings;
  const today = todayISO();
  const [logFrom, setLogFrom] = useState(startOfWeekISO(today));
  const [logTo, setLogTo] = useState(today);
  const [month, setMonth] = useState(today.slice(0, 7));
  const [clientId, setClientId] = useState(s.googleClientId);
  const [busy, setBusy] = useState(false);
  const unsynced = state.jobs.filter((j) => j.status === 'Completed' && !j.synced).length;

  const exportJobs = (which) => {
    const jobs = which === 'active' ? state.jobs.filter((j) => j.status !== 'Completed') : state.jobs;
    const rows = jobRows(jobs, EXPORT_COLS);
    rows[0].push('Status');
    jobs.forEach((j, i) => rows[i + 1].push(j.status));
    download(`jobs-${which}-${today}.csv`, toCSV(rows));
  };
  const exportCompleted = () => {
    const jobs = state.jobs.filter((j) => j.status === 'Completed' && (j.finishedDate || '').startsWith(month));
    if (!jobs.length) return actions.toast(`No completed jobs in ${month}`, 'warn');
    download(`completed-${month}.csv`, toCSV(jobRows(jobs, EXPORT_COLS)));
  };
  const exportLogs = () => download(`time-log-${logFrom}-to-${logTo}.csv`, toCSV(timeLogRows(state.jobs, logFrom, logTo)));
  const exportSummary = (period) => download(`${period}ly-summary-${today}.csv`, toCSV(summaryRows(state.jobs, period)));

  const backup = () => download(`stitch-backup-${today}.json`, JSON.stringify(state, null, 2), 'application/json');
  const restore = (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    file.text().then((txt) => {
      try {
        const data = JSON.parse(txt);
        if (!Array.isArray(data.jobs)) throw new Error('not a backup file');
        if (!confirm(`Replace ALL current data with this backup (${data.jobs.length} jobs, ${data.tasks?.length || 0} tasks)?`)) return;
        actions.replaceState(migrate(data));
        actions.toast('Backup restored', 'ok');
      } catch (err) {
        actions.toast(`Could not restore: ${err.message}`, 'error');
      }
    });
  };

  const connectAndCreate = async () => {
    setBusy(true);
    try {
      actions.setSettings({ googleClientId: clientId.trim() });
      await sheets.connect(clientId.trim());
      const id = await sheets.createSpreadsheet(s.sheetColumns);
      actions.setSettings({ sheetId: id });
      actions.toast('Google Sheet created and linked', 'ok');
    } catch (err) {
      actions.toast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const toggleCol = (c) => {
    const cols = s.sheetColumns.includes(c) ? s.sheetColumns.filter((x) => x !== c) : ALL_COLUMNS.filter((x) => x === c || s.sheetColumns.includes(x));
    actions.setSettings({ sheetColumns: cols });
  };

  return (
    <div className="settings-page">
      <h1>Settings & export</h1>

      <SyncCard />

      <section className="card">
        <header className="card-head"><h2>Export</h2></header>
        <div className="export-grid">
          <div>
            <h3>Job list</h3>
            <div className="btn-row">
              <button className="btn" onClick={() => exportJobs('active')}>Active jobs CSV</button>
              <button className="btn" onClick={() => exportJobs('all')}>All jobs CSV</button>
            </div>
          </div>
          <div>
            <h3>Time log (for invoicing)</h3>
            <div className="btn-row">
              <input type="date" value={logFrom} onChange={(e) => setLogFrom(e.target.value)} aria-label="From" />
              <span>to</span>
              <input type="date" value={logTo} onChange={(e) => setLogTo(e.target.value)} aria-label="To" />
            </div>
            <div className="btn-row">
              <button className="chip" onClick={() => { setLogFrom(startOfWeekISO(today)); setLogTo(today); }}>This week</button>
              <button className="chip" onClick={() => { const w = startOfWeekISO(addDaysISO(today, -7)); setLogFrom(w); setLogTo(addDaysISO(w, 6)); }}>Last week</button>
              <button className="chip" onClick={() => { setLogFrom(today.slice(0, 8) + '01'); setLogTo(today); }}>This month</button>
              <button className="btn" onClick={exportLogs}>Download time log</button>
            </div>
          </div>
          <div>
            <h3>Completed jobs — monthly report</h3>
            <div className="btn-row">
              <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} aria-label="Month" />
              <button className="btn" onClick={exportCompleted}>Download</button>
            </div>
          </div>
          <div>
            <h3>Summaries</h3>
            <div className="btn-row">
              <button className="btn" onClick={() => exportSummary('week')}>Weekly CSV</button>
              <button className="btn" onClick={() => exportSummary('month')}>Monthly CSV</button>
            </div>
          </div>
        </div>
      </section>

      <section className="card">
        <header className="card-head"><h2>Google Sheets backup</h2>{s.sheetId && <span className={`tag ${unsynced ? 'yellow' : 'green'}`}>{unsynced ? `${unsynced} to sync` : 'Up to date'}</span>}</header>
        {!s.sheetId ? (
          <>
            <p className="muted">Completed jobs are added to a Google Sheet automatically. You need a free Google OAuth Client ID once — see the setup steps in <code>README.md</code>.</p>
            <Field label="Google OAuth Client ID">
              <input value={clientId} onChange={(e) => setClientId(e.target.value)} placeholder="1234567890-abc….apps.googleusercontent.com" />
            </Field>
            <button className="btn primary" disabled={!clientId.trim() || busy} onClick={connectAndCreate}>{busy ? 'Connecting…' : 'Connect Google & create sheet'}</button>
          </>
        ) : (
          <>
            <p>
              Linked sheet: <a href={`https://docs.google.com/spreadsheets/d/${s.sheetId}`} target="_blank" rel="noreferrer">open in Google Sheets ↗</a>
              <br /><span className="muted small">Last sync: {s.lastSync ? fmtDateTime(s.lastSync) : 'never'}</span>
            </p>
            <label className="check"><input type="checkbox" checked={s.autoSync} onChange={(e) => actions.setSettings({ autoSync: e.target.checked })} /> Add jobs to the sheet automatically when marked Completed</label>
            <div className="btn-row">
              <button className="btn primary" disabled={syncing} onClick={() => actions.runSync()}>{syncing ? 'Syncing…' : 'Sync completed jobs now'}</button>
              <button className="btn" disabled={syncing} onClick={() => actions.runSync({ full: true })}>Push all jobs + weekly/monthly summaries</button>
            </div>
            <h3>Columns for the “Completed Jobs” tab</h3>
            <div className="col-picks">
              {ALL_COLUMNS.map((c) => (
                <label key={c} className="check"><input type="checkbox" checked={s.sheetColumns.includes(c)} onChange={() => toggleCol(c)} /> {c}</label>
              ))}
            </div>
            <p className="muted small">Column changes apply to new rows. If you change them, add a matching header row in the sheet (or unlink and create a fresh sheet).</p>
            <button className="btn ghost danger small" onClick={() => { if (confirm('Unlink this Google Sheet? The sheet itself is not deleted.')) { sheets.disconnect(); actions.setSettings({ sheetId: '' }); } }}>Unlink sheet</button>
          </>
        )}
      </section>

      <section className="card">
        <header className="card-head"><h2>Backup & restore</h2></header>
        <p className="muted">
          Your data is saved on this device{sync.configured && sync.status !== 'signed-out' && sync.status !== 'off' ? ' and in the cloud (sync)' : ''}.
          Updating the app never deletes it. The app also keeps an automatic copy for each of the last 7 days you used it.
          Downloading a backup file now and then is a good extra safeguard.
        </p>
        <div className="btn-row">
          <button className="btn" onClick={backup}>Download full backup (.json)</button>
          <label className="btn">Restore from backup file…<input type="file" accept="application/json,.json" hidden onChange={restore} /></label>
        </div>
        <DailyBackups />
      </section>

      <section className="card">
        <header className="card-head"><h2>Preferences</h2></header>
        <div className="grid-3">
          <Field label="Theme">
            <select value={s.theme} onChange={(e) => actions.setSettings({ theme: e.target.value })}>
              <option value="system">Match device</option>
              <option value="light">Light</option>
              <option value="dark">Dark</option>
            </select>
          </Field>
          <Field label="Ticket prefix">
            <input value={s.ticketPrefix} onChange={(e) => actions.setSettings({ ticketPrefix: e.target.value })} />
          </Field>
          <Field label="Next ticket number">
            <input type="number" min={1} value={s.nextTicket} onChange={(e) => actions.setSettings({ nextTicket: Math.max(1, Number(e.target.value) || 1) })} />
          </Field>
        </div>
        {state.jobs.length === 0 && (
          <p className="muted small">Want to try it out first? <button className="link" onClick={() => actions.replaceState({ ...state, ...demoState(state.settings) })}>Load sample jobs</button></p>
        )}
        {state.jobs.some((j) => j.demo) && (
          <p className="muted small">Sample jobs are loaded. <button className="link" onClick={() => actions.replaceState({
            ...state, jobs: state.jobs.filter((j) => !j.demo), tasks: state.tasks.filter((t) => !t.demo),
            settings: state.jobs.every((j) => j.demo) ? { ...state.settings, nextTicket: 1 } : state.settings,
          })}>Remove sample jobs & tasks</button></p>
        )}
      </section>
    </div>
  );
}

function SyncCard() {
  const { sync } = useApp();
  const [newMember, setNewMember] = useState('');
  const [busy, setBusy] = useState(false);
  if (!sync.configured) {
    return (
      <section className="card">
        <header className="card-head"><h2>Sync between devices</h2><span className="tag">Not set up</span></header>
        <p className="muted">Cloud sync isn’t switched on yet. Once it is, sign in here on each phone and tablet and they’ll share the same jobs.</p>
      </section>
    );
  }
  const label = {
    synced: ['green', 'Up to date'], pending: ['yellow', `Sending ${sync.pendingCount} change(s)…`], connecting: ['', 'Connecting…'],
    offline: ['yellow', 'Offline — changes saved on this device, will sync later'], 'signed-out': ['', 'Signed out'],
    'not-member': ['red', 'No access'], error: ['red', 'Problem syncing'],
  }[sync.status] || ['', sync.status];

  const run = async (fn) => {
    setBusy(true);
    try { await fn(); } catch (e) { alert(e.message); } finally { setBusy(false); }
  };

  return (
    <section className="card">
      <header className="card-head"><h2>Sync between devices</h2><span className={`tag ${label[0]}`}>{label[1]}</span></header>
      {!sync.user ? (
        <>
          <p className="muted">Sign in with Carla’s Google account on each phone and tablet. Jobs, tasks and timers then stay the same everywhere, and are kept safely online. Jobs already on this device are added, not replaced.</p>
          <button className="btn primary" onClick={() => run(sync.signIn)} disabled={busy}>Sign in with Google</button>
        </>
      ) : (
        <>
          <p>Signed in as <strong>{sync.user.email}</strong></p>
          {sync.status === 'not-member' && (
            <p className="banner purple">This Google account hasn’t been given access. Ask Carla to add <strong>{sync.user.email}</strong> below on a device that’s already syncing, then reopen the app.</p>
          )}
          {sync.error && sync.status === 'error' && <p className="red-text small">{sync.error}</p>}
          {sync.members.length > 0 && (
            <>
              <h3>People who can see these jobs</h3>
              <ul className="members">
                {sync.members.map((m) => (
                  <li key={m}>
                    {m}
                    {sync.members.length > 1 && m !== sync.user.email.toLowerCase() && (
                      <button className="icon-btn" title="Remove access" onClick={() => confirm(`Remove ${m}?`) && run(() => sync.setMemberList(sync.members.filter((x) => x !== m)))}>✕</button>
                    )}
                  </li>
                ))}
              </ul>
              <form className="inline-form" onSubmit={(e) => { e.preventDefault(); const em = newMember.trim(); if (em) run(async () => { await sync.setMemberList([...sync.members, em]); setNewMember(''); }); }}>
                <input type="email" value={newMember} onChange={(e) => setNewMember(e.target.value)} placeholder="Add a Google account email (e.g. an assistant)" />
                <button className="btn" disabled={busy || !newMember.trim()}>Add</button>
              </form>
            </>
          )}
          <div className="btn-row" style={{ marginTop: 12 }}>
            <button className="btn ghost small" onClick={() => confirm('Stop syncing on this device? Jobs already here stay on this device.') && run(sync.signOut)}>Sign out on this device</button>
          </div>
        </>
      )}
    </section>
  );
}

function DailyBackups() {
  const { actions, sync } = useApp();
  const [list, setList] = useState(null);
  useEffect(() => { listBackups().then(setList).catch(() => setList([])); }, []);
  if (!list || !list.length) return null;
  const restore = async (b) => {
    if (!confirm(`Go back to the copy from ${b.date} (${b.jobs} jobs, ${b.tasks} tasks)? Changes made since then will be undone${sync?.user ? ' on every synced device' : ''}.`)) return;
    const data = await readBackup(b.key);
    if (data) { actions.replaceState(migrate(data)); actions.toast(`Restored the copy from ${b.date}`, 'ok'); }
  };
  return (
    <>
      <h3>Automatic daily copies on this device</h3>
      <ul className="members">
        {list.map((b) => (
          <li key={b.key}>
            <span>{b.date} · {b.jobs} jobs, {b.tasks} tasks</span>
            <button className="btn small ghost" onClick={() => restore(b)}>Restore</button>
          </li>
        ))}
      </ul>
    </>
  );
}
