import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { mapGarment, mapJob, useAppState } from './store.js';
import { deadlineState, todayISO, uid } from './util.js';
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
  const [state, update] = useAppState();
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
      update((s) => {
        const count = Math.max(1, Number(form.garmentCount) || 1);
        if (!form.id) {
          const ticket = form.ticket?.trim() || `${s.settings.ticketPrefix}${String(s.settings.nextTicket).padStart(4, '0')}`;
          const job = {
            id: savedId, ticket, createdAt: Date.now(), status: form.status || 'New',
            client: form.client, startDate: form.startDate, dueDate: form.dueDate, finishedDate: null, collectedDate: null,
            service: form.service, description: form.description, instructions: form.instructions, price: form.price,
            garments: Array.from({ length: count }, (_, i) => newGarment(i + 1)),
            contactLog: [], synced: false,
          };
          const auto = !form.ticket?.trim();
          return { ...s, jobs: [job, ...s.jobs], settings: auto ? { ...s.settings, nextTicket: s.settings.nextTicket + 1 } : s.settings };
        }
        return mapJob(s, form.id, (j) => {
          let garments = j.garments;
          if (count > garments.length) garments = [...garments, ...Array.from({ length: count - garments.length }, (_, i) => newGarment(garments.length + i + 1))];
          else if (count < garments.length) {
            // only trim trailing garments with no time logged
            const keep = [...garments];
            while (keep.length > count && !keep[keep.length - 1].logs.length && !keep[keep.length - 1].runningSince) keep.pop();
            garments = keep;
          }
          return {
            ...j, ticket: form.ticket?.trim() || j.ticket, client: form.client, startDate: form.startDate, dueDate: form.dueDate,
            service: form.service, description: form.description, instructions: form.instructions, price: form.price, garments,
          };
        });
      });
      setEditing(null);
      return savedId;
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
      update((s) => mapJob(s, jobId, (j) => ({ ...j, garments: j.garments.filter((g) => g.id !== gid) })));
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
    <AppCtx.Provider value={{ state, actions, syncing }}>
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
