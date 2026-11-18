import type { AiSettings, Project } from './types';

/* ---------- tiny IndexedDB key-value store ---------- */

const DB_NAME = 'tarjama';
const STORES = ['kv', 'pdfs', 'backups'] as const;
type StoreName = (typeof STORES)[number];

let dbPromise: Promise<IDBDatabase> | null = null;

function db(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        for (const s of STORES) if (!req.result.objectStoreNames.contains(s)) req.result.createObjectStore(s);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

async function idbGet<T>(store: StoreName, key: string): Promise<T | undefined> {
  try {
    const d = await db();
    return await new Promise((resolve, reject) => {
      const r = d.transaction(store).objectStore(store).get(key);
      r.onsuccess = () => resolve(r.result as T | undefined);
      r.onerror = () => reject(r.error);
    });
  } catch {
    return undefined;
  }
}

async function idbSet(store: StoreName, key: string, value: unknown): Promise<void> {
  try {
    const d = await db();
    await new Promise<void>((resolve, reject) => {
      const tx = d.transaction(store, 'readwrite');
      tx.objectStore(store).put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    /* storage unavailable (private window): the project file on disk is the real copy */
  }
}

/* ---------- AI settings (stay in this browser only) ---------- */

const SETTINGS_KEY = 'tarjama.ai';

export const defaultAi: AiSettings = { provider: 'anthropic', apiKey: '', model: 'claude-opus-5-5', baseUrl: '' };

export function loadAi(): AiSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) return { ...defaultAi, ...JSON.parse(raw) };
  } catch {
    /* ignore */
  }
  return { ...defaultAi };
}

export function saveAi(s: AiSettings) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
  } catch {
    /* ignore */
  }
}

/* ---------- PDF bytes (needed while pages are still being read) ---------- */

export const savePdf = (hash: string, bytes: ArrayBuffer) => idbSet('pdfs', hash, bytes);
export const loadPdf = (hash: string) => idbGet<ArrayBuffer>('pdfs', hash);

export async function hashBytes(bytes: ArrayBuffer): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 32);
}

/* ---------- project files on the translator's computer ---------- */

export interface RecentEntry {
  id: string;
  title: string;
  fileName: string;
  updatedAt: string;
  handle?: FileSystemFileHandle;
}

export const fileApiSupported = typeof window !== 'undefined' && 'showSaveFilePicker' in window;

export async function listRecent(): Promise<RecentEntry[]> {
  return (await idbGet<RecentEntry[]>('kv', 'recent')) ?? [];
}

export async function rememberRecent(e: RecentEntry) {
  const list = (await listRecent()).filter((r) => r.id !== e.id);
  list.unshift(e);
  await idbSet('kv', 'recent', list.slice(0, 12));
}

export async function forgetRecent(id: string) {
  await idbSet('kv', 'recent', (await listRecent()).filter((r) => r.id !== id));
}

const fileTypes = [{ description: 'Tarjama projekat', accept: { 'application/json': ['.tarjama'] } }];

export async function pickSaveFile(suggestedName: string): Promise<FileSystemFileHandle> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (window as any).showSaveFilePicker({ suggestedName: suggestedName + '.tarjama', types: fileTypes });
}

export async function pickOpenFile(): Promise<FileSystemFileHandle> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [h] = await (window as any).showOpenFilePicker({ types: fileTypes, multiple: false });
  return h;
}

/** Asks the browser for write access to a remembered file (one click for the user). */
export async function ensurePermission(h: FileSystemFileHandle): Promise<boolean> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const hh = h as any;
  const opts = { mode: 'readwrite' };
  if ((await hh.queryPermission(opts)) === 'granted') return true;
  return (await hh.requestPermission(opts)) === 'granted';
}

export async function writeProjectFile(h: FileSystemFileHandle, p: Project) {
  const w = await h.createWritable();
  await w.write(JSON.stringify(p));
  await w.close();
}

export async function readProjectFile(h: FileSystemFileHandle): Promise<Project> {
  const f = await h.getFile();
  return parseProject(await f.text());
}

export function parseProject(text: string): Project {
  const p = JSON.parse(text) as Project;
  if (p.format !== 'tarjama') throw new Error('Ovo nije Tarjama projekat.');
  return p;
}

/** Second copy inside the browser, in case the file on disk is lost. */
export const backupProject = (id: string, p: Project) => idbSet('backups', id, p);
export const loadBackup = (id: string) => idbGet<Project>('backups', id);

/** Fallback for browsers without the File System Access API: plain download. */
export function downloadBlob(blob: Blob, name: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
