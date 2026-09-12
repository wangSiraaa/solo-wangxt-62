import { Project } from './types';

const DB_NAME = 'seating-planner';
const STORE = 'projects';
const META_STORE = 'meta';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(META_STORE)) db.createObjectStore(META_STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx<T>(db: IDBDatabase, store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const req = fn(t.objectStore(store));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function saveProject(p: Project): Promise<void> {
  const db = await openDb();
  await tx(db, STORE, 'readwrite', (s) => s.put({ ...p, updatedAt: Date.now() }));
  await tx(db, META_STORE, 'readwrite', (s) => s.put(p.id, 'lastProjectId'));
  db.close();
}

export async function loadProject(id: string): Promise<Project | undefined> {
  const db = await openDb();
  const p = await tx(db, STORE, 'readonly', (s) => s.get(id));
  db.close();
  return p as Project | undefined;
}

export async function listProjects(): Promise<Project[]> {
  const db = await openDb();
  const all = await tx(db, STORE, 'readonly', (s) => s.getAll());
  db.close();
  return (all as Project[]).sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function lastProjectId(): Promise<string | undefined> {
  const db = await openDb();
  const id = await tx(db, META_STORE, 'readonly', (s) => s.get('lastProjectId'));
  db.close();
  return id as string | undefined;
}

export async function deleteProject(id: string): Promise<void> {
  const db = await openDb();
  await tx(db, STORE, 'readwrite', (s) => s.delete(id));
  db.close();
}
