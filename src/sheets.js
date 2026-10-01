// Google Sheets sync via Google Identity Services (browser-only OAuth token flow).
// Uses the narrow `drive.file` scope: the app can only see spreadsheets it created.
import { jobRows, summaryRows } from './reports.js';

const SCOPE = 'https://www.googleapis.com/auth/drive.file';
const API = 'https://sheets.googleapis.com/v4/spreadsheets';
export const TABS = { completed: 'Completed Jobs', all: 'All Jobs', weekly: 'Weekly Summary', monthly: 'Monthly Summary' };

let token = null; // { access_token, expires_at }
let gisPromise = null;

function loadGis() {
  if (window.google?.accounts?.oauth2) return Promise.resolve();
  if (!gisPromise) {
    gisPromise = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://accounts.google.com/gsi/client';
      s.onload = resolve;
      s.onerror = () => { gisPromise = null; reject(new Error('Could not load Google sign-in (are you offline?)')); };
      document.head.appendChild(s);
    });
  }
  return gisPromise;
}

export const isConnected = () => !!token && token.expires_at > Date.now() + 60000;
export function disconnect() {
  if (token) window.google?.accounts?.oauth2?.revoke(token.access_token);
  token = null;
}

// Must be called from a click handler the first time so the popup isn't blocked.
export async function connect(clientId, { silent = false } = {}) {
  if (!clientId) throw new Error('Add your Google OAuth Client ID in Settings first.');
  if (isConnected()) return token.access_token;
  await loadGis();
  return new Promise((resolve, reject) => {
    const client = window.google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: SCOPE,
      callback: (resp) => {
        if (resp.error) return reject(new Error(resp.error_description || resp.error));
        token = { access_token: resp.access_token, expires_at: Date.now() + resp.expires_in * 1000 };
        resolve(token.access_token);
      },
      error_callback: (err) => reject(new Error(err.message || err.type || 'Google sign-in was cancelled')),
    });
    client.requestAccessToken({ prompt: silent ? '' : undefined });
  });
}

async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token.access_token}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    if (res.status === 401) token = null;
    throw new Error(err.error?.message || `Google Sheets error ${res.status}`);
  }
  return res.json();
}

const range = (tab, r = '') => encodeURIComponent(`'${tab}'${r ? '!' + r : ''}`);

export async function createSpreadsheet(columns) {
  const sheet = await api('', {
    method: 'POST',
    body: {
      properties: { title: 'Craft, Recycle with Stitch — Jobs' },
      sheets: Object.values(TABS).map((title) => ({ properties: { title, gridProperties: { frozenRowCount: 1 } } })),
    },
  });
  await api(`/${sheet.spreadsheetId}/values/${range(TABS.completed, 'A1')}?valueInputOption=RAW`, {
    method: 'PUT',
    body: { values: [columns] },
  });
  return sheet.spreadsheetId;
}

async function ensureTabs(sheetId) {
  const meta = await api(`/${sheetId}?fields=sheets.properties.title`);
  const have = new Set(meta.sheets.map((s) => s.properties.title));
  const missing = Object.values(TABS).filter((t) => !have.has(t));
  if (missing.length) {
    await api(`/${sheetId}:batchUpdate`, {
      method: 'POST',
      body: { requests: missing.map((title) => ({ addSheet: { properties: { title, gridProperties: { frozenRowCount: 1 } } } })) },
    });
  }
}

async function replaceTab(sheetId, tab, rows) {
  await api(`/${sheetId}/values/${range(tab)}:clear`, { method: 'POST', body: {} });
  await api(`/${sheetId}/values/${range(tab, 'A1')}?valueInputOption=USER_ENTERED`, { method: 'PUT', body: { values: rows } });
}

// Appends any completed-but-unsynced jobs; optionally refreshes the snapshot + summary tabs.
// Returns ids of the jobs that were appended.
export async function sync(state, { full = false } = {}) {
  const { sheetId, sheetColumns } = state.settings;
  if (!isConnected()) throw new Error('Not connected to Google.');
  await ensureTabs(sheetId);

  const pending = state.jobs.filter((j) => j.status === 'Completed' && !j.synced);
  if (pending.length) {
    const header = await api(`/${sheetId}/values/${range(TABS.completed, '1:1')}`);
    const [head, ...rows] = jobRows(pending, sheetColumns);
    const values = header.values?.length ? rows : [head, ...rows];
    await api(`/${sheetId}/values/${range(TABS.completed, 'A1')}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`, {
      method: 'POST',
      body: { values },
    });
  }
  if (full) {
    const allCols = ['Job #', 'Client', 'Phone', 'Email', 'Start Date', 'Due Date', 'End Date', 'Service Type', 'Garments', 'Description', 'Time Spent', 'Cost', 'Notes'];
    const rows = jobRows(state.jobs, allCols);
    rows[0].splice(8, 0, 'Status');
    state.jobs.forEach((j, i) => rows[i + 1].splice(8, 0, j.status));
    await replaceTab(sheetId, TABS.all, rows);
    await replaceTab(sheetId, TABS.weekly, summaryRows(state.jobs, 'week'));
    await replaceTab(sheetId, TABS.monthly, summaryRows(state.jobs, 'month'));
  }
  return pending.map((j) => j.id);
}
