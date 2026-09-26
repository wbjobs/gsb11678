// IndexedDB: 持久化会话/输入事件日志
const DB_NAME = 'webxr-input-viz';
const STORE = 'events';

let db = null;
let enabled = true;
const memoryFallback = [];

export function setLoggingEnabled(v) { enabled = v; }

export async function initDB() {
  try {
    db = await new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const d = req.result;
        if (!d.objectStoreNames.contains(STORE)) {
          d.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return true;
  } catch (e) {
    db = null;
    return false;
  }
}

export async function logEvent(type, detail = {}, level = 'info') {
  const entry = { ts: Date.now(), type, level, detail: JSON.stringify(detail).slice(0, 500) };
  if (!enabled) return entry;
  if (db) {
    try {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).add(entry);
    } catch { memoryFallback.push(entry); }
  } else {
    memoryFallback.push(entry);
  }
  return entry;
}

export async function getEvents(limit = 200) {
  if (!db) return memoryFallback.slice(-limit);
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).getAll();
      req.onsuccess = () => resolve((req.result || []).slice(-limit));
      req.onerror = () => resolve(memoryFallback.slice(-limit));
    } catch { resolve(memoryFallback.slice(-limit)); }
  });
}

export async function clearEvents() {
  memoryFallback.length = 0;
  if (!db) return;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).clear();
      tx.oncomplete = resolve;
      tx.onerror = resolve;
    } catch { resolve(); }
  });
}
