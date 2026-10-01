import { useState } from 'react';
import { Field, useApp } from '../ui.jsx';
import { ALL_COLUMNS, migrate } from '../store.js';
import { jobRows, summaryRows, timeLogRows, toCSV } from '../reports.js';
import * as sheets from '../sheets.js';
import { addDaysISO, download, fmtDateTime, startOfWeekISO, todayISO } from '../util.js';
import { demoState } from '../demo.js';

const EXPORT_COLS = ['Job #', 'Client', 'Phone', 'Email', 'Start Date', 'Due Date', 'End Date', 'Service Type', 'Garments', 'Description', 'Time Spent', 'Hours (decimal)', 'Cost', 'Notes'];

export default function Settings() {
  const { state, actions, syncing } = useApp();
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
        <p className="muted">All data is stored on this device in the browser. Download a backup regularly (and before clearing browser data or switching device).</p>
        <div className="btn-row">
          <button className="btn" onClick={backup}>Download full backup (.json)</button>
          <label className="btn">Restore from backup…<input type="file" accept="application/json,.json" hidden onChange={restore} /></label>
        </div>
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
