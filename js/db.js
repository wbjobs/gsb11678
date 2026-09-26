// IndexedDB 封装：持久化会话记录与输入事件日志
const DB_NAME = 'webxr-input-viz';
const DB_VERSION = 1;

let dbPromise = null;

function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('sessions')) {
        db.createObjectStore('sessions', { keyPath: 'id', autoIncrement: true });
      }
      if (!db.objectStoreNames.contains('events')) {
        const store = db.createObjectStore('events', { keyPath: 'id', autoIncrement: true });
        store.createIndex('by_time', 'ts');
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx(db, store, mode, fn) {
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const result = fn(t.objectStore(store));
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error);
  });
}

export async function saveSession(record) {
  const db = await openDB();
  return tx(db, 'sessions', 'readwrite', (s) => s.put(record));
}

export async function logEvent(type, detail, level = 'info') {
  try {
    const db = await openDB();
    await tx(db, 'events', 'readwrite', (s) =>
      s.add({ ts: Date.now(), type, level, detail: JSON.stringify(detail ?? null) }));
  } catch (err) {
    console.warn('日志写入失败', err);
  }
}

export async function recentEvents(limit = 200) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const t = db.transaction('events', 'readonly');
    const req = t.objectStore('events').index('by_time').openCursor(null, 'prev');
    const out = [];
    req.onsuccess = () => {
      const cursor = req.result;
      if (cursor && out.length < limit) {
        out.push(cursor.value);
        cursor.continue();
      } else {
        resolve(out);
      }
    };
    req.onerror = () => reject(req.error);
  });
}

export async function exportAll() {
  const db = await openDB();
  const dump = (store) =>
    new Promise((resolve, reject) => {
      const req = db.transaction(store, 'readonly').objectStore(store).getAll();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  return { sessions: await dump('sessions'), events: await dump('events') };
}
