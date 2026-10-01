// Local-first persistence: the whole app state lives in IndexedDB (falls back to
// localStorage if IndexedDB is unavailable). Saves are debounced, and flushed
// immediately when the tab is hidden so a running timer is never lost.
import { useCallback, useEffect, useRef, useState } from 'react';

const DB = 'carla-stitch';
const STORE = 'state';
const KEY = 'app';

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

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function load() {
  try {
    const db = await openDB();
    return await new Promise((resolve, reject) => {
      const r = db.transaction(STORE).objectStore(STORE).get(KEY);
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
  } catch {
    const raw = localStorage.getItem(DB);
    return raw ? JSON.parse(raw) : undefined;
  }
}

async function save(state) {
  try {
    const db = await openDB();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(state, KEY);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    localStorage.setItem(DB, JSON.stringify(state));
  }
}

export function migrate(s) {
  return {
    ...initialState,
    ...(s || {}),
    settings: { ...initialState.settings, ...(s?.settings || {}) },
  };
}

export function useAppState() {
  const [state, setState] = useState(null);
  const pending = useRef();
  const latest = useRef();

  useEffect(() => {
    load().then((s) => setState(migrate(s)));
    navigator.storage?.persist?.(); // ask the browser not to evict our data
  }, []);

  useEffect(() => {
    if (!state) return;
    latest.current = state;
    clearTimeout(pending.current);
    pending.current = setTimeout(() => save(state), 250);
  }, [state]);

  useEffect(() => {
    const flush = () => latest.current && save(latest.current);
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', flush);
    return () => {
      window.removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', flush);
    };
  }, []);

  const update = useCallback((fn) => setState((s) => fn(s)), []);
  return [state, update];
}

// Immutable helpers
export const mapJob = (s, id, fn) => ({ ...s, jobs: s.jobs.map((j) => (j.id === id ? fn(j) : j)) });
export const mapGarment = (job, gid, fn) => ({
  ...job,
  garments: job.garments.map((g) => (g.id === gid ? fn(g) : g)),
});
