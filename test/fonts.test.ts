// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Minimal in-memory IndexedDB stub: just enough of the API surface that
 * theme/customFonts.ts uses (open/upgradeneeded, one object store, get/put/
 * delete/getAll/getAllKeys, transaction complete/error events).
 */
function installFakeIndexedDB() {
  const stores = new Map<string, Map<string, unknown>>();

  class FakeRequest<T = unknown> {
    result: T = undefined as unknown as T;
    error: unknown = null;
    onsuccess: (() => void) | null = null;
    onerror: (() => void) | null = null;
    _resolve(result: T) {
      this.result = result;
      queueMicrotask(() => this.onsuccess?.());
    }
    _reject(error: unknown) {
      this.error = error;
      queueMicrotask(() => this.onerror?.());
    }
  }

  class FakeStore {
    map: Map<string, unknown>;
    constructor(map: Map<string, unknown>) { this.map = map; }
    put(value: unknown, key: string) {
      const req = new FakeRequest<void>();
      this.map.set(key, value);
      req._resolve(undefined);
      return req;
    }
    delete(key: string) {
      const req = new FakeRequest<void>();
      this.map.delete(key);
      req._resolve(undefined);
      return req;
    }
    getAllKeys() {
      const req = new FakeRequest<string[]>();
      req._resolve([...this.map.keys()]);
      return req;
    }
    getAll() {
      const req = new FakeRequest<unknown[]>();
      req._resolve([...this.map.values()]);
      return req;
    }
  }

  class FakeTx {
    oncomplete: (() => void) | null = null;
    onerror: (() => void) | null = null;
    map: Map<string, unknown>;
    constructor(map: Map<string, unknown>) {
      this.map = map;
      queueMicrotask(() => this.oncomplete?.());
    }
    objectStore() {
      return new FakeStore(this.map);
    }
  }

  class FakeDB {
    objectStoreNames = { contains: (name: string) => stores.has(name) };
    createObjectStore(name: string) {
      stores.set(name, new Map());
    }
    transaction(name: string) {
      return new FakeTx(stores.get(name)!);
    }
    close() {}
  }

  (globalThis as Record<string, unknown>).indexedDB = {
    open() {
      const req = new FakeRequest<FakeDB>();
      const db = new FakeDB();
      // Mimic the real API: `result` is available to onupgradeneeded before onsuccess fires.
      req.result = db;
      queueMicrotask(() => {
        (req as unknown as { onupgradeneeded?: () => void }).onupgradeneeded?.();
        req._resolve(db);
      });
      return req;
    },
  };
}

/** Minimal FontFace stub: `bad` bytes reject load(), everything else resolves. */
function installFakeFontFace() {
  class FakeFontFace {
    family: string;
    source: ArrayBuffer | string;
    constructor(family: string, source: ArrayBuffer | string) {
      this.family = family;
      this.source = source;
    }
    load() {
      const text = typeof this.source === 'string' ? this.source : new TextDecoder().decode(this.source as ArrayBuffer);
      if (text === 'bad') return Promise.reject(new Error('invalid font data'));
      return Promise.resolve(this);
    }
  }
  (globalThis as Record<string, unknown>).FontFace = FakeFontFace;
  const added = new Set<unknown>();
  (document as unknown as { fonts: { add: (f: unknown) => void; has: (f: unknown) => boolean } }).fonts = {
    add: (f: unknown) => added.add(f),
    has: (f: unknown) => added.has(f),
  };
}

function buf(text: string): ArrayBuffer {
  return new TextEncoder().encode(text).buffer;
}

function fakeFile(name: string, text: string, size?: number): File {
  const bytes = new TextEncoder().encode(text);
  const file = new File([bytes], name);
  if (size !== undefined) Object.defineProperty(file, 'size', { value: size });
  return file;
}

describe('customFonts', () => {
  beforeEach(() => {
    vi.resetModules();
    installFakeIndexedDB();
    installFakeFontFace();
  });

  it('registers a valid font and lists it', async () => {
    const { importCustomFont, listCustomFonts } = await import('../src/theme/customFonts');
    const name = await importCustomFont(fakeFile('MyFont.ttf', 'good'));
    expect(name).toBe('MyFont');
    expect(await listCustomFonts()).toEqual(['MyFont']);
  });

  it('rejects files over the 10 MB cap without storing anything', async () => {
    const { importCustomFont, listCustomFonts } = await import('../src/theme/customFonts');
    const oversized = fakeFile('Huge.otf', 'good', 11 * 1024 * 1024);
    await expect(importCustomFont(oversized)).rejects.toMatchObject({ code: 'too-large' });
    expect(await listCustomFonts()).toEqual([]);
  });

  it('falls back on a corrupted font: load() rejects, nothing is stored', async () => {
    const { importCustomFont, listCustomFonts } = await import('../src/theme/customFonts');
    await expect(importCustomFont(fakeFile('Broken.woff2', 'bad'))).rejects.toMatchObject({ code: 'invalid' });
    expect(await listCustomFonts()).toEqual([]);
  });

  it('overwrites a same-named font on re-import', async () => {
    const { importCustomFont, listCustomFonts } = await import('../src/theme/customFonts');
    await importCustomFont(fakeFile('MyFont.ttf', 'good'));
    await importCustomFont(fakeFile('MyFont.otf', 'good'));
    expect(await listCustomFonts()).toEqual(['MyFont']);
  });

  it('deletes a stored font', async () => {
    const { importCustomFont, deleteCustomFont, listCustomFonts } = await import('../src/theme/customFonts');
    await importCustomFont(fakeFile('MyFont.ttf', 'good'));
    await deleteCustomFont('MyFont');
    expect(await listCustomFonts()).toEqual([]);
  });

  it('re-registers every stored font at startup, skipping corrupted ones', async () => {
    const { importCustomFont } = await import('../src/theme/customFonts');
    await importCustomFont(fakeFile('Good.ttf', 'good'));
    // Directly seed a corrupted entry by bypassing import's own load-check:
    // re-open the same fake DB and put bad bytes under a second key.
    const req = (globalThis as unknown as { indexedDB: { open: () => IDBOpenDBRequest } }).indexedDB.open();
    await new Promise<void>((resolve) => {
      (req as unknown as { onsuccess: () => void }).onsuccess = () => resolve();
    });
    const db = (req as unknown as { result: IDBDatabase }).result;
    const tx = db.transaction('files', 'readwrite');
    tx.objectStore('files').put(buf('bad'), 'Corrupted');

    const { loadAllCustomFonts } = await import('../src/theme/customFonts');
    const loaded = await loadAllCustomFonts();
    expect(loaded).toContain('Good');
    expect(loaded).not.toContain('Corrupted');
  });
});

describe('fonts: resolveFontStack / ensureGoogleFont', () => {
  it('resolves built-in keys to their stack, custom names to a TC-friendly fallback', async () => {
    const { resolveFontStack, FONT_STACKS } = await import('../src/theme/fonts');
    expect(resolveFontStack('sans')).toBe(FONT_STACKS.sans);
    expect(resolveFontStack('tc-sans')).toContain('Noto Sans TC');
    expect(resolveFontStack('MyCustomFont')).toContain('"MyCustomFont"');
    expect(resolveFontStack('MyCustomFont')).toContain('PingFang TC');
  });

  it('injects the Google Fonts stylesheet for a web font key only once', async () => {
    document.head.innerHTML = '';
    // Prevent happy-dom from actually fetching the injected <link> over the network.
    const happyDom = (window as unknown as { happyDOM?: { settings: { disableCSSFileLoading: boolean } } }).happyDOM;
    if (happyDom) happyDom.settings.disableCSSFileLoading = true;
    const { ensureGoogleFont } = await import('../src/theme/fonts');
    ensureGoogleFont('tc-sans');
    ensureGoogleFont('tc-sans');
    const links = document.head.querySelectorAll('link[href*="fonts.googleapis.com"]');
    expect(links.length).toBe(1);
  });

  it('does nothing for a non-web-font key', async () => {
    document.head.innerHTML = '';
    const { ensureGoogleFont } = await import('../src/theme/fonts');
    ensureGoogleFont('sans');
    expect(document.head.querySelectorAll('link[href*="fonts.googleapis.com"]').length).toBe(0);
  });
});
