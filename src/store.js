// Local-first persistence: the whole app state lives in IndexedDB (falls back to
// localStorage if IndexedDB is unavailable). Saves are debounced, and flushed
// immediately when the tab is hidden so a running timer is never lost.
//
// Data safety:
// - If stored data can't be read, the app refuses to save (so it can never write an
//   empty list over real jobs) and shows an error instead.
// - A copy of the data is kept for each of the last 7 days the app was opened.
import { useCallback, useEffect, useRef, useState } from 'react';
import { todayISO } from './util.js';

const DB = 'carla-stitch';
const STORE = 'state';
const KEY = 'app';
const BACKUP_PREFIX = 'backup-';
const BACKUPS_KEPT = 7;

export const DEFAULT_COLUMNS = ['Job #', 'Client', 'Start Date', 'End Date', 'Service Type', 'Time Spent', 'Cost', 'Notes'];
export const ALL_COLUMNS = [
  'Job #', 'Client', 'Phone', 'Email', 'Start Date', 'Due Date', 'End Date', 'Service Type',
  'Garments', 'Description', 'Time Spent', 'Hours (decimal)', 'Cost', 'Notes',
];

export const initialState = {
  version: 1,
  jobs: [],
  tasks: [],
  settings: {
    theme: 'system',
    ticketPrefix: 'CRS-',
    nextTicket: 1,
    googleClientId: '',
    sheetId: '',
    sheetColumns: DEFAULT_COLUMNS,
    autoSync: true,
    lastSync: null,
  },
};

let dbPromise = null;
function openDB() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => { dbPromise = null; reject(req.error); };
    });
  }
  return dbPromise;
}

export async function idbGet(key) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const r = db.transaction(STORE).objectStore(STORE).get(key);
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

export async function idbSet(key, value) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(value, key);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}

async function idbKeys() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const r = db.transaction(STORE).objectStore(STORE).getAllKeys();
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

async function idbDelete(key) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(key);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}

// Returns the saved state (or undefined on a genuinely fresh install). Throws if it can't read.
async function load() {
  let lastErr;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const fromIdb = await idbGet(KEY);
      if (fromIdb !== undefined) return fromIdb;
      // Data may have been saved to localStorage when IndexedDB was unavailable.
      const raw = localStorage.getItem(DB);
      return raw ? JSON.parse(raw) : undefined;
    } catch (err) {
      lastErr = err;
      await new Promise((r) => setTimeout(r, 300 * (attempt + 1)));
    }
  }
  const raw = localStorage.getItem(DB);
  if (raw) return JSON.parse(raw);
  throw lastErr;
}

export const saveState = (state) => save(state);

async function save(state) {
  try {
    await idbSet(KEY, state);
  } catch {
    localStorage.setItem(DB, JSON.stringify(state));
  }
}

// One snapshot per day, keeping the last BACKUPS_KEPT days.
async function dailyBackup(state) {
  if (!state.jobs.length && !state.tasks.length) return;
  try {
    const key = BACKUP_PREFIX + todayISO();
    const keys = (await idbKeys()).filter((k) => String(k).startsWith(BACKUP_PREFIX)).sort();
    if (!keys.includes(key)) await idbSet(key, { savedAt: Date.now(), state });
    const all = keys.includes(key) ? keys : [...keys, key];
    for (const old of all.slice(0, Math.max(0, all.length - BACKUPS_KEPT))) await idbDelete(old);
  } catch {
    // backups are best-effort
  }
}

export async function listBackups() {
  const keys = (await idbKeys()).filter((k) => String(k).startsWith(BACKUP_PREFIX)).sort().reverse();
  const out = [];
  for (const key of keys) {
    const b = await idbGet(key);
    out.push({ key, date: key.slice(BACKUP_PREFIX.length), savedAt: b?.savedAt, jobs: b?.state?.jobs?.length || 0, tasks: b?.state?.tasks?.length || 0 });
  }
  return out;
}
export async function readBackup(key) {
  return (await idbGet(key))?.state;
}

export function migrate(s) {
  return {
    ...initialState,
    ...(s || {}),
    jobs: Array.isArray(s?.jobs) ? s.jobs : [],
    tasks: Array.isArray(s?.tasks) ? s.tasks : [],
    settings: { ...initialState.settings, ...(s?.settings || {}) },
  };
}

export function useAppState() {
  const [state, setState] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const canSave = useRef(false);
  const pending = useRef();
  const latest = useRef();

  useEffect(() => {
    load()
      .then((s) => {
        const st = migrate(s);
        canSave.current = true;
        setState(st);
        dailyBackup(st);
      })
      .catch((err) => setLoadError(err?.message || String(err)));
    navigator.storage?.persist?.(); // ask the browser not to evict our data
  }, []);

  useEffect(() => {
    if (!state || !canSave.current) return;
    latest.current = state;
    clearTimeout(pending.current);
    pending.current = setTimeout(() => save(state), 250);
  }, [state]);

  useEffect(() => {
    const flush = () => canSave.current && latest.current && save(latest.current);
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', flush);
    return () => {
      window.removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', flush);
    };
  }, []);

  const update = useCallback((fn) => setState((s) => (s ? fn(s) : s)), []);
  return [state, update, loadError];
}

// Immutable helpers
export const mapJob = (s, id, fn) => ({ ...s, jobs: s.jobs.map((j) => (j.id === id ? fn(j) : j)) });
export const mapGarment = (job, gid, fn) => ({
  ...job,
  garments: job.garments.map((g) => (g.id === gid ? fn(g) : g)),
});
