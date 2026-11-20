// Tiny IndexedDB wrapper — everything persists on-device only.
// v1: studies · v2: + sessions (Live recordings for Replay)

import type { StudyRecord } from "./types";
import type { LiveRecord } from "../replay/types";

const DB = "lucid", VERSION = 2;
type Store = "studies" | "sessions";

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const s of ["studies", "sessions"]) if (!db.objectStoreNames.contains(s)) db.createObjectStore(s, { keyPath: "id" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx<T>(store: Store, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const req = fn(t.objectStore(store));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    t.oncomplete = () => db.close();
  });
}

const byNewest = <T extends { startedAt: number }>(all: T[]) => all.sort((a, b) => b.startedAt - a.startedAt);

export const saveStudy = (s: StudyRecord) => tx("studies", "readwrite", (st) => st.put(s)).then(() => undefined);
export const getStudy = (id: string) => tx<StudyRecord | undefined>("studies", "readonly", (st) => st.get(id));
export const deleteStudy = (id: string) => tx("studies", "readwrite", (st) => st.delete(id)).then(() => undefined);
export const listStudies = () => tx<StudyRecord[]>("studies", "readonly", (st) => st.getAll()).then(byNewest);

export const saveSession = (s: LiveRecord) => tx("sessions", "readwrite", (st) => st.put(s)).then(() => undefined);
export const deleteSession = (id: string) => tx("sessions", "readwrite", (st) => st.delete(id)).then(() => undefined);
export const listSessions = () => tx<LiveRecord[]>("sessions", "readonly", (st) => st.getAll()).then(byNewest);
