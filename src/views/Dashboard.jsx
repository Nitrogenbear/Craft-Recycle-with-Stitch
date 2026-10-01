import { DeadlineTag, Empty, StatusPill, useApp, useNow } from '../ui.jsx';
import { avgTurnaround } from '../reports.js';
import { addDaysISO, deadlineState, fmtDate, fmtDuration, isRunning, jobMs, startOfWeekISO, todayISO } from '../util.js';
import TaskList from './TaskList.jsx';

export default function Dashboard() {
  const { state, actions } = useApp();
  const now = useNow(state.jobs.some(isRunning));
  const today = todayISO();
  const jobs = state.jobs;

  const active = jobs.filter((j) => j.status !== 'Completed' && j.status !== 'Ready for Pickup')
    .sort((a, b) => (a.dueDate || '9999').localeCompare(b.dueDate || '9999'));
  const ready = jobs.filter((j) => j.status === 'Ready for Pickup')
    .sort((a, b) => (a.dueDate || '').localeCompare(b.dueDate || ''));
  const count = (st) => jobs.filter((j) => j.status === st).length;
  const overdue = jobs.filter((j) => deadlineState(j) === 'overdue').length;
  const close = jobs.filter((j) => deadlineState(j) === 'close').length;

  const weekStart = startOfWeekISO(today);
  const thisWeek = jobs.filter((j) => j.startDate >= weekStart && j.startDate <= today).length;
  const recent = jobs.filter((j) => j.finishedDate && j.finishedDate >= addDaysISO(today, -30));
  const turnaround = avgTurnaround(recent);

  const tiles = [
    ['New', count('New'), 'blue', 'jobs?status=New'],
    ['In progress', count('In Progress'), 'green', 'jobs?status=In Progress'],
    ['Ready for pickup', ready.length, 'purple', 'jobs?status=Ready for Pickup'],
    ['Due ≤ 2 days', close, 'yellow', 'jobs?filter=warnings'],
    ['Overdue', overdue, 'red', 'jobs?filter=overdue'],
  ];

  return (
    <div className="dashboard">
      <section className="tiles">
        {tiles.map(([label, n, cls, href]) => (
          <a key={label} className={`tile ${cls} ${n && (cls === 'red' || cls === 'yellow') ? 'alert' : ''}`} href={`#/${href}`}>
            <span className="tile-n">{n}</span>
            <span className="tile-label">{label}</span>
          </a>
        ))}
        <div className="tile plain">
          <span className="tile-n">{thisWeek}</span>
          <span className="tile-label">Jobs taken in this week</span>
        </div>
        <div className="tile plain">
          <span className="tile-n">{turnaround === '' ? '—' : `${turnaround}d`}</span>
          <span className="tile-label">Avg turnaround (30 days)</span>
        </div>
      </section>

      <div className="dash-grid">
        <section className="card">
          <header className="card-head">
            <h2>Hand-back queue</h2>
            <span className="muted">{active.length} active · soonest first</span>
          </header>
          {active.length === 0 ? (
            <Empty>No active jobs. <button className="link" onClick={() => actions.openNewJob()}>Add a job</button></Empty>
          ) : (
            <ul className="queue">
              {active.map((j) => {
                const done = j.garments.filter((g) => g.done).length;
                return (
                  <li key={j.id} className={`queue-row edge-${deadlineState(j)}`}>
                    <a href={`#/job/${j.id}`} className="queue-main">
                      <div className="queue-top">
                        <strong>{j.client.name}</strong>
                        <span className="muted">{j.ticket}</span>
                        {isRunning(j) && <span className="pulse" title="Timer running" />}
                      </div>
                      <div className="queue-desc">{j.service} · {j.description}</div>
                      <div className="queue-meta">
                        <StatusPill status={j.status} />
                        <span>{done}/{j.garments.length} garments</span>
                        <span className="mono">{fmtDuration(jobMs(j, now), false)}</span>
                      </div>
                    </a>
                    <div className="queue-side">
                      <span className="queue-date">{fmtDate(j.dueDate)}</span>
                      <DeadlineTag job={j} />
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <div className="dash-side">
          <section className="card">
            <header className="card-head">
              <h2>Waiting for pickup</h2>
              <span className="muted">{ready.length}</span>
            </header>
            {ready.length === 0 ? <Empty>Nothing waiting for collection.</Empty> : (
              <ul className="pickup">
                {ready.map((j) => {
                  const lastNote = j.contactLog[j.contactLog.length - 1];
                  return (
                    <li key={j.id}>
                      <a href={`#/job/${j.id}`} className="pickup-main">
                        <strong>{j.client.name}</strong> <span className="muted">{j.ticket}</span>
                        <div className="muted small">{lastNote ? `${lastNote.note}` : 'Not contacted yet'}</div>
                      </a>
                      <button className="btn small" onClick={() => actions.openContact(j.id)}>📞 Contact</button>
                      <button className="btn small ghost" onClick={() => actions.setStatus(j.id, 'Completed')} title="Mark as collected">✓ Collected</button>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <section className="card">
            <header className="card-head">
              <h2>Today’s to-do</h2>
              <a href="#/tasks" className="muted small">All tasks →</a>
            </header>
            <TaskList mode="today" compact />
          </section>
        </div>
      </div>
    </div>
  );
}
