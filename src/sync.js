// Cloud sync between devices via Firebase (Google sign-in + Firestore).
//
// Layout in Firestore:
//   workspaces/stitch               { members: [emails], settings: {...shared settings} }
//   workspaces/stitch/items/{id}    { kind: 'job'|'task', data: {...}, deleted, updatedAt }
//
// Each job/task is its own document, so editing one job only sends that job.
// Each device keeps its full copy locally (IndexedDB, see store.js) and only listens
// for documents changed since it last synced, which keeps reads tiny.
// Deletes are "soft" (deleted: true) so other devices hear about them.
// If two devices edit the same job while offline, the last one to reconnect wins.
import { useCallback, useEffect, useRef, useState } from 'react';
import { firebaseConfig } from './firebaseConfig.js';
import { idbGet, idbSet } from './store.js';

const WORKSPACE = 'stitch';
const META_KEY = 'sync-meta';
// Settings shared between devices (theme stays per-device).
const SHARED_SETTINGS = ['ticketPrefix', 'nextTicket', 'googleClientId', 'sheetId', 'sheetColumns', 'autoSync'];

export const syncConfigured = !!firebaseConfig;

// --- stable hashing so we only send what actually changed ---
function stable(v) {
  if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`;
  if (v && typeof v === 'object') {
    return `{${Object.keys(v).filter((k) => v[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${stable(v[k])}`).join(',')}}`;
  }
  return JSON.stringify(v ?? null);
}
function hash(v) {
  const s = stable(v);
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(36) + s.length.toString(36);
}
const clean = (v) => JSON.parse(JSON.stringify(v)); // drops undefined, which Firestore rejects
const sharedSettings = (settings) => Object.fromEntries(SHARED_SETTINGS.map((k) => [k, settings[k] ?? null]));

let fb = null; // lazily loaded Firebase modules + instances
async function firebase() {
  if (fb) return fb;
  const [{ initializeApp }, auth, fs] = await Promise.all([
    import('firebase/app'), import('firebase/auth'), import('firebase/firestore'),
  ]);
  const app = initializeApp(firebaseConfig);
  fb = {
    auth, fs,
    authInstance: auth.getAuth(app),
    db: fs.initializeFirestore(app, { ignoreUndefinedProperties: true }),
  };
  return fb;
}

// status: 'off' | 'signed-out' | 'connecting' | 'not-member' | 'synced' | 'pending' | 'offline' | 'error'
export function useCloudSync(state, update) {
  const [user, setUser] = useState(null);
  const [status, setStatus] = useState(syncConfigured ? 'connecting' : 'off');
  const [members, setMembers] = useState([]);
  const [error, setError] = useState('');
  const [online, setOnline] = useState(navigator.onLine);
  const [pendingCount, setPendingCount] = useState(0);
  const [ready, setReady] = useState(false); // member + first snapshot received
  const [retryKey, setRetryKey] = useState(0);
  const waitingForNetwork = useRef(false);

  const meta = useRef(null); // { uid, cursor, confirmed: {id: 'kind|hash'}, settingsHash }
  const inFlight = useRef({}); // id -> hash being written
  const stateRef = useRef(state);
  stateRef.current = state;

  const saveMeta = useCallback(() => { if (meta.current) idbSet(META_KEY, meta.current).catch(() => {}); }, []);
  const refreshPending = useCallback(() => setPendingCount(Object.keys(inFlight.current).length), []);

  useEffect(() => {
    const on = () => setOnline(true), off = () => setOnline(false);
    window.addEventListener('online', on); window.addEventListener('offline', off);
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); };
  }, []);

  // Auth
  useEffect(() => {
    if (!syncConfigured) return;
    let unsub = () => {};
    firebase().then(({ auth, authInstance }) => {
      unsub = auth.onAuthStateChanged(authInstance, (u) => {
        setUser(u);
        setReady(false);
        if (!u) setStatus('signed-out');
      });
    }).catch((e) => { setError(e.message); setStatus('error'); });
    return () => unsub();
  }, []);

  // Workspace membership + listeners
  const loaded = !!state;
  useEffect(() => {
    if (!user || !loaded) return;
    let cancelled = false;
    const unsubs = [];
    (async () => {
      setStatus('connecting');
      const { fs, db } = await firebase();
      const email = (user.email || '').toLowerCase();
      const wsRef = fs.doc(db, 'workspaces', WORKSPACE);

      // Load (or reset) sync bookkeeping for this account
      const stored = await idbGet(META_KEY).catch(() => null);
      meta.current = stored && stored.uid === user.uid ? stored : { uid: user.uid, cursor: 0, confirmed: {}, settingsHash: null };

      try {
        const snap = await fs.getDoc(wsRef);
        if (!snap.exists()) {
          // First sign-in ever: the owner (set in firestore.rules) creates the workspace.
          await fs.setDoc(wsRef, { members: [email], owner: email, createdAt: fs.serverTimestamp(), settings: clean(sharedSettings(stateRef.current.settings)) });
        } else if (!(snap.data().members || []).includes(email)) {
          throw Object.assign(new Error('not a member'), { code: 'permission-denied' });
        }
      } catch (e) {
        if (cancelled) return;
        if (e.code === 'permission-denied') { setStatus('not-member'); return; }
        if (!navigator.onLine || e.code === 'unavailable') { setStatus('offline'); waitingForNetwork.current = true; return; }
        setError(e.message); setStatus('error'); return;
      }
      if (cancelled) return;

      // Shared settings + member list
      unsubs.push(fs.onSnapshot(wsRef, (snap) => {
        const d = snap.data() || {};
        setMembers(d.members || []);
        if (snap.metadata.hasPendingWrites || !d.settings) return;
        const h = hash(d.settings);
        if (h === meta.current.settingsHash) return;
        meta.current.settingsHash = h;
        saveMeta();
        update((s) => {
          const merged = { ...s.settings, ...d.settings };
          // never move the ticket counter backwards
          merged.nextTicket = Math.max(Number(s.settings.nextTicket) || 1, Number(d.settings.nextTicket) || 1);
          return { ...s, settings: merged };
        });
      }, (e) => { setError(e.message); setStatus('error'); }));

      // Items changed since our cursor
      const itemsQ = fs.query(
        fs.collection(db, 'workspaces', WORKSPACE, 'items'),
        fs.where('updatedAt', '>', fs.Timestamp.fromMillis(meta.current.cursor)),
        fs.orderBy('updatedAt'),
      );
      unsubs.push(fs.onSnapshot(itemsQ, (snap) => {
        const incoming = [];
        const m = meta.current;
        const local = stateRef.current;
        for (const ch of snap.docChanges()) {
          if (ch.type === 'removed') continue;
          const doc = ch.doc;
          if (doc.metadata.hasPendingWrites) continue; // our own write echoing back
          const d = doc.data();
          const ts = d.updatedAt?.toMillis?.() || 0;
          if (ts > m.cursor) m.cursor = ts;
          if (inFlight.current[doc.id]) continue; // our newer local version is on its way

          const known = m.confirmed[doc.id];
          // Identical to what we last synced (e.g. our own save coming back): nothing to do.
          if (!d.deleted && known === `${d.kind}|${hash(d.data)}`) continue;
          if (d.deleted && known === undefined) {
            if (![...local.jobs, ...local.tasks].some((x) => x.id === doc.id)) continue;
          }
          // This device has changes to the item that haven't been sent yet: keep them (they're sent next).
          if (known !== undefined) {
            const mine = (d.kind === 'task' ? local.tasks : local.jobs).find((x) => x.id === doc.id);
            const mineHash = mine ? `${d.kind}|${hash(clean(mine))}` : undefined;
            if (mineHash !== known) continue;
          }
          incoming.push({ id: doc.id, ...d });
        }
        if (incoming.length) {
          for (const it of incoming) {
            if (it.deleted) delete meta.current.confirmed[it.id];
            else meta.current.confirmed[it.id] = `${it.kind}|${hash(it.data)}`;
          }
          update((s) => {
            let jobs = s.jobs, tasks = s.tasks;
            for (const it of incoming) {
              const key = it.kind === 'task' ? 'tasks' : 'jobs';
              let list = key === 'jobs' ? jobs : tasks;
              const i = list.findIndex((x) => x.id === it.id);
              if (it.deleted) { if (i >= 0) list = list.filter((x) => x.id !== it.id); }
              else if (i >= 0) { list = list.slice(); list[i] = it.data; }
              else list = [it.data, ...list];
              if (key === 'jobs') jobs = list; else tasks = list;
            }
            return { ...s, jobs, tasks };
          });
        }
        saveMeta();
        setReady(true);
      }, (e) => { setError(e.message); setStatus('error'); }));
    })().catch((e) => { if (!cancelled) { setError(e.message); setStatus('error'); } });

    return () => { cancelled = true; unsubs.forEach((u) => u()); setReady(false); };
  }, [user, loaded, update, saveMeta, retryKey]);

  // If we couldn't connect because the device was offline, try again when it's back online.
  useEffect(() => {
    if (online && waitingForNetwork.current) {
      waitingForNetwork.current = false;
      setRetryKey((k) => k + 1);
    }
  }, [online]);

  // Push local changes (debounced so typing doesn't send a write per keystroke)
  useEffect(() => {
    if (!ready || !state) return;
    const t = setTimeout(async () => {
      const { fs, db } = await firebase();
      const m = meta.current;
      const s = stateRef.current;
      const write = (id, kind, payload, h) => {
        inFlight.current[id] = h;
        refreshPending();
        fs.setDoc(fs.doc(db, 'workspaces', WORKSPACE, 'items', id), { kind, ...payload, updatedAt: fs.serverTimestamp() })
          .then(() => {
            if (inFlight.current[id] === h) delete inFlight.current[id];
            if (payload.deleted) delete m.confirmed[id]; else m.confirmed[id] = `${kind}|${h}`;
            saveMeta();
            refreshPending();
          })
          .catch((e) => { delete inFlight.current[id]; refreshPending(); setError(e.message); });
      };

      const live = new Set();
      for (const [kind, list] of [['job', s.jobs], ['task', s.tasks]]) {
        for (const item of list) {
          live.add(item.id);
          const data = clean(item);
          const h = hash(data);
          if (m.confirmed[item.id] === `${kind}|${h}` || inFlight.current[item.id] === h) continue;
          write(item.id, kind, { data, deleted: false }, h);
        }
      }
      for (const [id, v] of Object.entries(m.confirmed)) {
        if (live.has(id) || inFlight.current[id] === 'deleted') continue;
        write(id, v.split('|')[0], { data: null, deleted: true }, 'deleted');
      }

      const shared = clean(sharedSettings(s.settings));
      const sh = hash(shared);
      if (sh !== m.settingsHash) {
        m.settingsHash = sh;
        fs.updateDoc(fs.doc(db, 'workspaces', WORKSPACE), { settings: shared }).then(saveMeta).catch((e) => setError(e.message));
      }
    }, 800);
    return () => clearTimeout(t);
  }, [state?.jobs, state?.tasks, state?.settings, ready, refreshPending, saveMeta]);

  // Overall status
  useEffect(() => {
    if (!user || !ready) return;
    if (!online) setStatus('offline');
    else if (pendingCount) setStatus('pending');
    else setStatus('synced');
  }, [user, ready, online, pendingCount]);

  const signIn = useCallback(async () => {
    setError('');
    const { auth, authInstance } = await firebase();
    const provider = new auth.GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });
    try {
      await auth.signInWithPopup(authInstance, provider);
    } catch (e) {
      if (e.code === 'auth/popup-blocked' || e.code === 'auth/operation-not-supported-in-this-environment') {
        await auth.signInWithRedirect(authInstance, provider);
      } else if (e.code !== 'auth/popup-closed-by-user' && e.code !== 'auth/cancelled-popup-request') {
        setError(e.message);
      }
    }
  }, []);

  const signOut = useCallback(async () => {
    const { auth, authInstance } = await firebase();
    await auth.signOut(authInstance);
    setMembers([]);
  }, []);

  const setMemberList = useCallback(async (list) => {
    const { fs, db } = await firebase();
    await fs.updateDoc(fs.doc(db, 'workspaces', WORKSPACE), { members: [...new Set(list.map((e) => e.trim().toLowerCase()).filter(Boolean))] });
  }, []);

  return { configured: syncConfigured, status, user, members, error, pendingCount, signIn, signOut, setMemberList };
}
