// Shared constants and pure helpers (dates, durations, deadline state).

export const SERVICES = ['Alterations', 'Repairs', 'Made-to-Measure', 'Upcycling', 'Other'];
export const STATUSES = ['New', 'In Progress', 'On Hold', 'Ready for Pickup', 'Completed'];
export const PRIORITIES = ['High', 'Medium', 'Low'];
export const CLOSE_DAYS = 2;

export const uid = () =>
  crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2);

// --- Dates (stored as 'YYYY-MM-DD' strings in local time) ---
export function todayISO(d = new Date()) {
  const off = d.getTimezoneOffset();
  return new Date(d.getTime() - off * 60000).toISOString().slice(0, 10);
}
export function parseISO(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
}
export function addDaysISO(iso, n) {
  const d = parseISO(iso);
  d.setDate(d.getDate() + n);
  return todayISO(d);
}
export function daysBetween(fromISO, toISO) {
  return Math.round((parseISO(toISO) - parseISO(fromISO)) / 86400000);
}
export function fmtDate(iso) {
  if (!iso) return '—';
  return parseISO(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: '2-digit' });
}
export function fmtDateTime(ts) {
  if (!ts) return '—';
  return new Date(ts).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}
export function fmtTime(ts) {
  return new Date(ts).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}
export function startOfWeekISO(iso = todayISO()) {
  const d = parseISO(iso);
  const dow = (d.getDay() + 6) % 7; // Monday = 0
  d.setDate(d.getDate() - dow);
  return todayISO(d);
}

// --- Durations ---
export function fmtDuration(ms, withSeconds = true) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n) => String(n).padStart(2, '0');
  return withSeconds ? `${h}:${pad(m)}:${pad(s)}` : `${h}h ${pad(m)}m`;
}
export const hoursDecimal = (ms) => Math.round((ms / 3600000) * 100) / 100;

// Timers store an absolute start timestamp, so elapsed time is always computed
// from the system clock and survives reloads, sleeping tabs and closed browsers.
export function garmentMs(g, now = Date.now()) {
  const logged = g.logs.reduce((sum, l) => sum + l.ms, 0);
  return logged + (g.runningSince ? now - g.runningSince : 0);
}
export const jobMs = (job, now = Date.now()) => job.garments.reduce((s, g) => s + garmentMs(g, now), 0);
export const isRunning = (job) => job.garments.some((g) => g.runningSince);

// --- Deadline state: 'new' | 'ok' | 'close' | 'overdue' | 'done' ---
export function deadlineState(job, today = todayISO()) {
  if (job.status === 'Completed' || job.status === 'Ready for Pickup') return 'done';
  if (job.dueDate) {
    const left = daysBetween(today, job.dueDate);
    if (left < 0) return 'overdue';
    if (left <= CLOSE_DAYS) return 'close';
  }
  return job.status === 'New' ? 'new' : 'ok';
}
export function deadlineLabel(job, today = todayISO()) {
  if (job.status === 'Completed') return 'Collected';
  if (job.status === 'Ready for Pickup') return 'Ready';
  if (!job.dueDate) return '';
  const left = daysBetween(today, job.dueDate);
  if (left < 0) return `${-left}d overdue`;
  if (left === 0) return 'Due today';
  if (left === 1) return 'Due tomorrow';
  return `${left}d left`;
}

export const money = (n) => (n === '' || n == null || isNaN(n) ? '' : `£${Number(n).toFixed(2)}`);

// UK numbers -> international digits for wa.me links (07700 900123 -> 447700900123)
export function waNumber(phone) {
  const d = (phone || '').replace(/[^\d+]/g, '');
  if (d.startsWith('+')) return d.slice(1);
  if (d.startsWith('00')) return d.slice(2);
  if (d.startsWith('0')) return '44' + d.slice(1);
  return d;
}

export function download(filename, text, type = 'text/csv') {
  const blob = new Blob([text], { type: `${type};charset=utf-8` });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
