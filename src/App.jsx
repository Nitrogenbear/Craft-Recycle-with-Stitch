import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { mapGarment, mapJob, migrate, saveState, useAppState } from './store.js';
import { useCloudSync } from './sync.js';
import { deadlineState, garmentTotal, priceOf, pricedByGarment, todayISO, uid } from './util.js';
import * as sheets from './sheets.js';
import { AppCtx } from './ui.jsx';
import Dashboard from './views/Dashboard.jsx';
import Jobs from './views/Jobs.jsx';
import JobDetail from './views/JobDetail.jsx';
import JobForm from './views/JobForm.jsx';
import Tasks from './views/Tasks.jsx';
import Settings from './views/Settings.jsx';
import ContactPanel from './views/ContactPanel.jsx';

// --- tiny hash router: #/dashboard, #/jobs?filter=warnings, #/job/<id>, #/tasks, #/settings
function parseHash() {
  const [path, query = ''] = location.hash.replace(/^#\/?/, '').split('?');
  const [view = 'dashboard', id] = path.split('/');
  return { view: view || 'dashboard', id, params: Object.fromEntries(new URLSearchParams(query)) };
}
export const go = (path) => { location.hash = '#/' + path; };

// Next ticket number: never reuse a number already on a job (matters when two devices add jobs).
function nextTicketNumber(s) {
  const prefix = s.settings.ticketPrefix;
  const used = s.jobs
    .map((j) => (j.ticket.startsWith(prefix) ? parseInt(j.ticket.slice(prefix.length), 10) : NaN))
    .filter((n) => !isNaN(n));
  return Math.max(Number(s.settings.nextTicket) || 1, used.length ? Math.max(...used) + 1 : 1);
}

const newGarment = (n) => ({ id: uid(), label: `Garment ${n}`, done: false, completedAt: null, runningSince: null, logs: [] });

function stopAll(job, now) {
  if (!job.garments.some((g) => g.runningSince)) return job;
  return {
    ...job,
    garments: job.garments.map((g) =>
      g.runningSince
        ? { ...g, runningSince: null, logs: [...g.logs, { id: uid(), start: g.runningSince, end: now, ms: now - g.runningSince, date: todayISO(new Date(g.runningSince)) }] }
        : g),
  };
}

export default function App() {
  const [state, update, loadError] = useAppState();
  const sync = useCloudSync(state, update);
  const [route, setRoute] = useState(parseHash);
  const [editing, setEditing] = useState(null); // job object, or {} for new
  const [contact, setContact] = useState(null); // { jobId, garmentId }
  const [toasts, setToasts] = useState([]);
  const stateRef = useRef(state);
  stateRef.current = state;

  useEffect(() => {
    const on = () => { setRoute(parseHash()); window.scrollTo(0, 0); };
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);

  // Theme
  const theme = state?.settings.theme;
  useEffect(() => {
    if (!theme) return;
    if (theme === 'system') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  const toast = useCallback((msg, kind = 'info') => {
    const id = uid();
    setToasts((t) => [...t, { id, msg, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4000);
  }, []);

  // ---------- Google Sheets ----------
  const [syncing, setSyncing] = useState(false);
  const runSync = useCallback(async ({ full = false, snapshot, quiet = false } = {}) => {
    const s = snapshot || stateRef.current;
    const { googleClientId, sheetId } = s.settings;
    if (!googleClientId || !sheetId) {
      if (!quiet) toast('Set up Google Sheets in Settings first.', 'warn');
      return;
    }
    setSyncing(true);
    try {
      await sheets.connect(googleClientId);
      const ids = await sheets.sync(s, { full });
      update((st) => ({
        ...st,
        jobs: st.jobs.map((j) => (ids.includes(j.id) ? { ...j, synced: true } : j)),
        settings: { ...st.settings, lastSync: Date.now() },
      }));
      toast(ids.length ? `Synced ${ids.length} completed job${ids.length > 1 ? 's' : ''} to Google Sheets` : full ? 'Google Sheet updated' : 'Nothing new to sync', 'ok');
    } catch (e) {
      toast(`Sheets sync failed: ${e.message}. It will retry on next sync.`, 'error');
    } finally {
      setSyncing(false);
    }
  }, [toast, update]);

  // ---------- actions ----------
  const actions = useMemo(() => ({
    toast,
    runSync,
    openNewJob: (prefill = {}) => setEditing({ ...prefill, __new: true }),
    editJob: (job) => setEditing(job),
    openContact: (jobId, garmentId = null) => setContact({ jobId, garmentId }),

    saveJob(form) {
      const savedId = form.id || uid();
      // form.garments: [{ id?, label, price }] — the garment list edited in the form
      const rows = form.garments.length ? form.garments : [{ label: 'Garment 1', price: '' }];
      const withPrice = (job) => ({ ...job, price: pricedByGarment(job) ? garmentTotal(job.garments) : priceOf(form.price) });
      update((s) => {
        if (!form.id) {
          const n = nextTicketNumber(s);
          const ticket = form.ticket?.trim() || `${s.settings.ticketPrefix}${String(n).padStart(4, '0')}`;
          const job = withPrice({
            id: savedId, ticket, createdAt: Date.now(), status: form.status || 'New',
            client: form.client, startDate: form.startDate, dueDate: form.dueDate, finishedDate: null, collectedDate: null,
            service: form.service, description: form.description, instructions: form.instructions,
            garments: rows.map((r, i) => ({ ...newGarment(i + 1), label: r.label.trim() || `Garment ${i + 1}`, price: priceOf(r.price) })),
            contactLog: [], synced: false,
          });
          const auto = !form.ticket?.trim();
          return { ...s, jobs: [job, ...s.jobs], settings: auto ? { ...s.settings, nextTicket: n + 1 } : s.settings };
        }
        return mapJob(s, form.id, (j) => {
          const byId = new Map(j.garments.map((g) => [g.id, g]));
          const garments = rows.map((r, i) => {
            const existing = r.id && byId.get(r.id);
            const base = existing || newGarment(i + 1);
            return { ...base, label: r.label.trim() || base.label, price: priceOf(r.price) };
          });
          // never drop a garment that has time logged against it
          const kept = new Set(garments.map((g) => g.id));
          for (const g of j.garments) if (!kept.has(g.id) && (g.logs.length || g.runningSince)) garments.push(g);
          return withPrice({
            ...j, ticket: form.ticket?.trim() || j.ticket, client: form.client, startDate: form.startDate, dueDate: form.dueDate,
            service: form.service, description: form.description, instructions: form.instructions, garments,
          });
        });
      });
      setEditing(null);
      return savedId;
    },

    // Whole-job price (used when garments aren't priced individually)
    setPrice(id, price) {
      const value = priceOf(price);
      if (value !== '' && value < 0) return;
      update((s) => mapJob(s, id, (j) => ({ ...j, price: value })));
    },

    // Per-garment price; the job's price is kept as the total of its garments
    setGarmentPrice(jobId, gid, price) {
      const value = priceOf(price);
      if (value !== '' && value < 0) return;
      update((s) => mapJob(s, jobId, (j) => {
        const job = mapGarment(j, gid, (g) => ({ ...g, price: value }));
        return { ...job, price: pricedByGarment(job) ? garmentTotal(job.garments) : '' };
      }));
    },

    deleteJob(id) {
      update((s) => ({ ...s, jobs: s.jobs.filter((j) => j.id !== id), tasks: s.tasks.map((t) => (t.jobId === id ? { ...t, jobId: '' } : t)) }));
      go('jobs');
      toast('Job deleted');
    },

    setStatus(id, status) {
      const today = todayISO();
      const now = Date.now();
      const transform = (s) => mapJob(s, id, (j) => {
        let job = { ...j, status };
        if (status === 'Ready for Pickup' || status === 'Completed') {
          job = stopAll(job, now);
          job.finishedDate = j.finishedDate || today;
        } else {
          job.finishedDate = null;
        }
        job.collectedDate = status === 'Completed' ? j.collectedDate || today : null;
        if (status === 'Completed' && j.status !== 'Completed') job.synced = false;
        return job;
      });
      update(transform);
      if (status === 'Ready for Pickup') setContact({ jobId: id, garmentId: null });
      if (status === 'Completed') {
        const snap = transform(stateRef.current);
        if (snap.settings.autoSync && snap.settings.sheetId && snap.settings.googleClientId) runSync({ snapshot: snap, quiet: true });
      }
    },

    startTimer(jobId, gid) {
      const now = Date.now();
      update((s) => ({
        ...s,
        // one garment at a time: stop any other running timer first
        jobs: s.jobs.map((j) => {
          let job = j.id === jobId ? j : stopAll(j, now);
          if (j.id !== jobId) return job;
          job = { ...job, garments: job.garments.map((g) => (g.id !== gid && g.runningSince ? stopAll({ garments: [g] }, now).garments[0] : g)) };
          job = mapGarment(job, gid, (g) => ({ ...g, runningSince: now, done: false }));
          if (job.status === 'New' || job.status === 'On Hold') job.status = 'In Progress';
          return job;
        }),
      }));
    },

    stopTimer(jobId, gid) {
      const now = Date.now();
      update((s) => mapJob(s, jobId, (j) => mapGarment(j, gid, (g) => stopAll({ garments: [g] }, now).garments[0])));
    },

    addManualTime(jobId, gid, { date, minutes, note }) {
      const ms = Math.round(minutes * 60000);
      update((s) => mapJob(s, jobId, (j) => mapGarment(j, gid, (g) => ({ ...g, logs: [...g.logs, { id: uid(), date, ms, manual: true, note }] }))));
    },

    deleteLog(jobId, gid, logId) {
      update((s) => mapJob(s, jobId, (j) => mapGarment(j, gid, (g) => ({ ...g, logs: g.logs.filter((l) => l.id !== logId) }))));
    },

    completeGarment(jobId, gid) {
      const now = Date.now();
      update((s) => mapJob(s, jobId, (j) => mapGarment(j, gid, (g) => ({ ...stopAll({ garments: [g] }, now).garments[0], done: true, completedAt: now }))));
      setContact({ jobId, garmentId: gid });
    },

    reopenGarment(jobId, gid) {
      update((s) => mapJob(s, jobId, (j) => mapGarment(j, gid, (g) => ({ ...g, done: false, completedAt: null }))));
    },

    renameGarment(jobId, gid, label) {
      update((s) => mapJob(s, jobId, (j) => mapGarment(j, gid, (g) => ({ ...g, label }))));
    },

    addGarment(jobId) {
      update((s) => mapJob(s, jobId, (j) => ({ ...j, garments: [...j.garments, newGarment(j.garments.length + 1)] })));
    },

    removeGarment(jobId, gid) {
      update((s) => mapJob(s, jobId, (j) => {
        const job = { ...j, garments: j.garments.filter((g) => g.id !== gid) };
        return pricedByGarment(j) ? { ...job, price: garmentTotal(job.garments) } : job;
      }));
    },

    addContactNote(jobId, note) {
      if (!note.trim()) return;
      update((s) => mapJob(s, jobId, (j) => ({ ...j, contactLog: [...j.contactLog, { id: uid(), at: Date.now(), note: note.trim() }] })));
    },

    saveTask(task) {
      update((s) => task.id
        ? { ...s, tasks: s.tasks.map((t) => (t.id === task.id ? { ...t, ...task } : t)) }
        : { ...s, tasks: [{ ...task, id: uid(), done: false, createdAt: Date.now() }, ...s.tasks] });
    },
    toggleTask(id) {
      update((s) => ({ ...s, tasks: s.tasks.map((t) => (t.id === id ? { ...t, done: !t.done, doneAt: t.done ? null : Date.now() } : t)) }));
    },
    deleteTask(id) {
      update((s) => ({ ...s, tasks: s.tasks.filter((t) => t.id !== id) }));
    },

    setSettings(patch) {
      update((s) => ({ ...s, settings: { ...s.settings, ...patch } }));
    },
    replaceState(next) {
      update(() => next);
    },
  }), [toast, update, runSync]);

  if (loadError) return <LoadError message={loadError} onRestore={(data) => saveState(migrate(data)).then(() => location.reload())} />;
  if (!state) return <div className="loading">Loading…</div>;

  const warnings = state.jobs.filter((j) => ['overdue', 'close'].includes(deadlineState(j)));
  const overdue = warnings.filter((j) => deadlineState(j) === 'overdue').length;
  const running = state.jobs.find((j) => j.garments.some((g) => g.runningSince));
  const job = route.view === 'job' ? state.jobs.find((j) => j.id === route.id) : null;

  const nav = [
    ['dashboard', 'Dashboard', '◧'],
    ['jobs', 'Jobs', '☰'],
    ['tasks', 'To-do', '✓'],
    ['settings', 'Settings', '⚙'],
  ];

  return (
    <AppCtx.Provider value={{ state, actions, syncing, sync }}>
      <div className="app">
        <header className="topbar">
          <a className="brand" href="#/dashboard">
            <span className="brand-mark">🧵</span>
            <span className="brand-text"><strong>Craft, Recycle</strong> with Stitch</span>
          </a>
          <nav className="topnav">
            {nav.map(([v, label]) => (
              <a key={v} href={`#/${v}`} className={route.view === v || (v === 'jobs' && route.view === 'job') ? 'active' : ''}>{label}</a>
            ))}
          </nav>
          <div className="topbar-actions">
            <SyncBadge sync={sync} />
            {running && (
              <a className="running-chip" href={`#/job/${running.id}`} title="Timer running">
                <span className="pulse" /> {running.ticket}
              </a>
            )}
            <a
              className={`warn-badge ${overdue ? 'red' : warnings.length ? 'yellow' : 'clear'}`}
              href="#/jobs?filter=warnings"
              title={`${overdue} overdue, ${warnings.length - overdue} due within 2 days`}
            >
              ⚠ <span>{warnings.length}</span>
            </a>
            <button className="btn primary" onClick={() => actions.openNewJob()}>+ New job</button>
          </div>
        </header>

        <main className="main">
          {route.view === 'dashboard' && <Dashboard />}
          {route.view === 'jobs' && <Jobs params={route.params} />}
          {route.view === 'job' && (job ? <JobDetail job={job} /> : <div className="empty">Job not found. <a href="#/jobs">Back to jobs</a></div>)}
          {route.view === 'tasks' && <Tasks />}
          {route.view === 'settings' && <Settings />}
        </main>

        <nav className="bottomnav">
          {nav.map(([v, label, icon]) => (
            <a key={v} href={`#/${v}`} className={route.view === v || (v === 'jobs' && route.view === 'job') ? 'active' : ''}>
              <span className="bn-icon">{icon}</span>{label}
            </a>
          ))}
        </nav>

        {editing && (
          <JobForm
            job={editing.__new ? null : editing}
            prefill={editing.__new ? editing : null}
            onClose={() => setEditing(null)}
            onSave={(form) => {
              const id = actions.saveJob(form);
              if (!form.id) setTimeout(() => go(`job/${id}`), 0);
            }}
          />
        )}
        {contact && <ContactPanel {...contact} onClose={() => setContact(null)} />}

        <div className="toasts" aria-live="polite">
          {toasts.map((t) => <div key={t.id} className={`toast ${t.kind}`}>{t.msg}</div>)}
        </div>
      </div>
    </AppCtx.Provider>
  );
}

const SYNC_LABELS = {
  synced: ['☁ Synced', 'ok'],
  pending: ['☁ Saving…', 'pending'],
  connecting: ['☁ Connecting…', 'pending'],
  offline: ['☁ Offline', 'offline'],
  'signed-out': ['☁ Not syncing', 'offline'],
  'not-member': ['☁ No access', 'bad'],
  error: ['☁ Sync error', 'bad'],
};

function SyncBadge({ sync }) {
  if (!sync.configured) return null;
  const [label, cls] = SYNC_LABELS[sync.status] || SYNC_LABELS.connecting;
  const title = sync.status === 'offline'
    ? 'No connection. Changes are saved on this device and will sync when back online.'
    : sync.status === 'pending' ? `${sync.pendingCount} change(s) being sent` : sync.error || label;
  return <a className={`sync-badge ${cls}`} href="#/settings" title={title}>{label}</a>;
}

// Shown if saved data can't be read. Nothing is saved in this state, so existing data can't be overwritten.
function LoadError({ message, onRestore }) {
  const restore = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    file.text()
      .then((t) => {
        if (confirm('Replace the data on this device with this backup file?')) return onRestore(JSON.parse(t));
      })
      .catch((err) => alert(`Could not read backup: ${err.message}`));
  };
  return (
    <div className="load-error">
      <h1>Couldn’t open your saved jobs</h1>
      <p>The app couldn’t read the data stored on this device ({message}). <strong>Nothing has been changed or deleted</strong>, and the app won’t save anything until this is fixed.</p>
      <p>Try closing the app completely and opening it again. If you use sync, your jobs are also safe online.</p>
      <div className="btn-row">
        <button className="btn primary" onClick={() => location.reload()}>Try again</button>
        <label className="btn">Restore from a backup file…<input type="file" accept=".json,application/json" hidden onChange={restore} /></label>
      </div>
    </div>
  );
}
