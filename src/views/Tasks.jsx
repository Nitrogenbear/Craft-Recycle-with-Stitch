import { useState } from 'react';
import { useApp } from '../ui.jsx';
import { todayISO } from '../util.js';
import TaskList from './TaskList.jsx';

export default function Tasks() {
  const { state } = useApp();
  const [tab, setTab] = useState('today');
  const today = todayISO();
  const open = state.tasks.filter((t) => !t.done);
  const counts = {
    today: open.filter((t) => (t.due && t.due <= today) || (!t.due && t.priority === 'High')).length,
    upcoming: open.filter((t) => t.due && t.due > today).length,
    all: open.length,
    done: state.tasks.length - open.length,
  };
  const tabs = [['today', 'Today'], ['upcoming', 'Upcoming'], ['all', 'All open'], ['done', 'Done']];

  return (
    <div className="tasks-page">
      <div className="page-head">
        <h1>To-do</h1>
        <div className="tabs" role="tablist">
          {tabs.map(([k, l]) => (
            <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'active' : ''} onClick={() => setTab(k)}>
              {l} <span className="count">{counts[k]}</span>
            </button>
          ))}
        </div>
      </div>
      <section className="card">
        <TaskList mode={tab === 'all' ? 'open' : tab} key={tab} />
      </section>
    </div>
  );
}
