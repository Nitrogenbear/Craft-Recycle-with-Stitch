import { useState } from 'react';
import { Empty, useApp } from '../ui.jsx';
import { PRIORITIES, daysBetween, fmtDate, todayISO } from '../util.js';

const PRI_ORDER = { High: 0, Medium: 1, Low: 2 };

// mode: 'today' (due today/overdue/undated high), 'upcoming', 'all', 'done', 'job'
export default function TaskList({ mode = 'all', jobId, compact }) {
  const { state, actions } = useApp();
  const today = todayISO();
  const [editId, setEditId] = useState(null);

  let tasks = state.tasks.filter((t) => {
    if (mode === 'job') return t.jobId === jobId;
    if (mode === 'done') return t.done;
    if (t.done) return mode === 'today' && t.doneAt && todayISO(new Date(t.doneAt)) === today; // keep today's ticks visible
    if (mode === 'today') return (t.due && t.due <= today) || (!t.due && t.priority === 'High');
    if (mode === 'upcoming') return t.due && t.due > today;
    return true;
  });
  tasks = tasks.sort((a, b) =>
    Number(a.done) - Number(b.done) ||
    (a.due || '9999').localeCompare(b.due || '9999') ||
    PRI_ORDER[a.priority] - PRI_ORDER[b.priority]);

  const jobOf = (id) => state.jobs.find((j) => j.id === id);

  return (
    <div className={`tasklist ${compact ? 'compact' : ''}`}>
      {mode !== 'done' && <TaskForm defaults={{ jobId: jobId || '', due: mode === 'today' || mode === 'job' ? today : '' }} hideJob={mode === 'job'} onSave={actions.saveTask} />}
      {tasks.length === 0 ? <Empty>{mode === 'today' ? 'Nothing due today 🎉' : 'No tasks.'}</Empty> : (
        <ul className="tasks">
          {tasks.map((t) => {
            if (editId === t.id) {
              return (
                <li key={t.id} className="task editing">
                  <TaskForm defaults={t} onSave={(v) => { actions.saveTask({ ...v, id: t.id }); setEditId(null); }} onCancel={() => setEditId(null)} />
                </li>
              );
            }
            const job = t.jobId && jobOf(t.jobId);
            const late = !t.done && t.due && t.due < today;
            return (
              <li key={t.id} className={`task pri-${t.priority.toLowerCase()} ${t.done ? 'done' : ''}`}>
                <input type="checkbox" checked={t.done} onChange={() => actions.toggleTask(t.id)} aria-label={`Mark "${t.title}" done`} />
                <div className="task-body">
                  <div className="task-title">{t.title}</div>
                  <div className="task-meta">
                    <span className={`pri ${t.priority.toLowerCase()}`}>{t.priority}</span>
                    {t.due && <span className={late ? 'red-text' : ''}>{late ? `${daysBetween(t.due, today)}d late · ` : ''}{t.due === today ? 'Today' : fmtDate(t.due)}</span>}
                    {job && mode !== 'job' && <a href={`#/job/${job.id}`}>{job.ticket} · {job.client.name}</a>}
                  </div>
                </div>
                <button className="icon-btn" title="Edit" onClick={() => setEditId(t.id)}>✎</button>
                <button className="icon-btn" title="Delete" onClick={() => actions.deleteTask(t.id)}>✕</button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function TaskForm({ defaults, onSave, onCancel, hideJob }) {
  const { state } = useApp();
  const blank = { title: '', priority: 'Medium', due: '', jobId: '', ...defaults };
  const [t, setT] = useState(blank);
  const [open, setOpen] = useState(!!onCancel);
  const set = (k, v) => setT((x) => ({ ...x, [k]: v }));
  const activeJobs = state.jobs.filter((j) => j.status !== 'Completed' || j.id === t.jobId);

  const submit = (e) => {
    e.preventDefault();
    if (!t.title.trim()) return;
    onSave({ title: t.title.trim(), priority: t.priority, due: t.due, jobId: t.jobId });
    if (!onCancel) setT({ ...blank, title: '' });
  };

  return (
    <form className="task-form" onSubmit={submit}>
      <div className="task-form-main">
        <input value={t.title} placeholder="Add a task…" onFocus={() => setOpen(true)} onChange={(e) => set('title', e.target.value)} aria-label="Task" />
        <button className="btn primary small" disabled={!t.title.trim()}>{onCancel ? 'Save' : 'Add'}</button>
        {onCancel && <button type="button" className="btn small" onClick={onCancel}>Cancel</button>}
      </div>
      {open && (
        <div className="task-form-extra">
          <select value={t.priority} onChange={(e) => set('priority', e.target.value)} aria-label="Priority">
            {PRIORITIES.map((p) => <option key={p}>{p}</option>)}
          </select>
          <input type="date" value={t.due} onChange={(e) => set('due', e.target.value)} aria-label="Due date" />
          {!hideJob && (
            <select value={t.jobId} onChange={(e) => set('jobId', e.target.value)} aria-label="Linked job">
              <option value="">No linked job</option>
              {activeJobs.map((j) => <option key={j.id} value={j.id}>{j.ticket} · {j.client.name}</option>)}
            </select>
          )}
        </div>
      )}
    </form>
  );
}
