/**
 * Custom font import: user-uploaded .ttf/.otf/.woff/.woff2 files.
 *
 * Files live in IndexedDB (db `wc-fonts`, store `files`, key = file name minus
 * extension). `settings.font` only ever stores `{ family, custom: true }` —
 * never the file bytes — so the file must be re-registered as a FontFace on
 * every startup via `loadAllCustomFonts()`.
 */

const DB_NAME = 'wc-fonts';
const STORE = 'files';
const MAX_BYTES = 10 * 1024 * 1024;

export interface CustomFontError { code: 'too-large' | 'invalid'; message: string }

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** Strips the extension to derive the storage key / font-family name. */
export function fontNameFromFile(fileName: string): string {
  return fileName.replace(/\.[^.]+$/, '');
}

/** Registers a FontFace from bytes and adds it to document.fonts. Throws if the font data is invalid. */
async function registerFontFace(name: string, buf: ArrayBuffer): Promise<void> {
  const face = new FontFace(name, buf);
  await face.load();
  document.fonts.add(face);
}

/**
 * Imports a font file: validates size, registers it live, and persists the
 * bytes to IndexedDB (overwriting any existing font with the same name).
 * Rejects with a CustomFontError on oversize or unparsable data — nothing is
 * stored or registered in that case.
 */
export async function importCustomFont(file: File): Promise<string> {
  if (file.size > MAX_BYTES) {
    throw { code: 'too-large', message: 'font file exceeds 10 MB' } satisfies CustomFontError;
  }
  const name = fontNameFromFile(file.name);
  const buf = await file.arrayBuffer();
  try {
    await registerFontFace(name, buf);
  } catch {
    throw { code: 'invalid', message: 'font file failed to load' } satisfies CustomFontError;
  }
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(buf, name);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
  return name;
}

/** Removes a custom font from IndexedDB. Does not un-register the live FontFace (harmless if it lingers this session). */
export async function deleteCustomFont(name: string): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(name);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

/** Lists the names of custom fonts stored in IndexedDB. */
export async function listCustomFonts(): Promise<string[]> {
  const db = await openDb();
  const names = await new Promise<string[]>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).getAllKeys();
    req.onsuccess = () => resolve(req.result as string[]);
    req.onerror = () => reject(req.error);
  });
  db.close();
  return names;
}

/**
 * Re-registers every stored custom font as a FontFace at startup. A font
 * whose bytes fail to load (corrupted) is skipped silently — the caller's
 * `settings.font` will fall back to the default when it can't resolve.
 */
export async function loadAllCustomFonts(): Promise<string[]> {
  const db = await openDb();
  const entries = await new Promise<{ name: string; buf: ArrayBuffer }[]>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const store = tx.objectStore(STORE);
    const keysReq = store.getAllKeys();
    const valsReq = store.getAll();
    tx.oncomplete = () => {
      const keys = keysReq.result as string[];
      const vals = valsReq.result as ArrayBuffer[];
      resolve(keys.map((name, i) => ({ name, buf: vals[i] })));
    };
    tx.onerror = () => reject(tx.error);
  });
  db.close();
  const loaded: string[] = [];
  for (const { name, buf } of entries) {
    try {
      await registerFontFace(name, buf);
      loaded.push(name);
    } catch {
      // corrupted stored font; skip, caller falls back to default
    }
  }
  return loaded;
}
