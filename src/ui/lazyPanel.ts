/**
 * `lazy()` that can be warmed up before its first render.
 *
 * Every panel is a `React.lazy` behind a `<Suspense>`. The first time one is opened React
 * has to suspend (the loader returns a promise even when the module is already in the
 * bundle), shows the fallback, and then holds the real content back for its 300 ms fallback
 * throttle — measured 310 ms per first open, 10 ms after that (2026-09-08). Visitors read
 * that as "the panel stalls, then pops".
 *
 * `lazyInitializer` marks the component resolved inside the thenable's `then` callback. A
 * thenable that calls back synchronously therefore resolves the component before React gets
 * to throw — no suspension, no fallback, no throttle. `preload()` loads the module ahead of
 * time (on idle, from App); once it has, the loader hands React such a synchronous thenable.
 * Until then the ordinary promise path applies, so an early click still works.
 */
import { lazy, type ComponentType, type LazyExoticComponent } from 'react';

type Loader<T> = () => Promise<{ default: T }>;

export interface PreloadableLazy<T extends ComponentType<unknown>> extends LazyExoticComponent<T> {
  /** Load the module now; resolves when it is in. Safe to call more than once. */
  preload: () => Promise<void>;
}

export function lazyPanel<T extends ComponentType<any>>(load: Loader<T>): PreloadableLazy<T> {
  let mod: { default: T } | undefined;
  let pending: Promise<void> | undefined;
  const preload = () => {
    pending ??= load().then((m) => { mod = m; });
    return pending;
  };
  const Comp = lazy(() => {
    if (mod) {
      const ready = mod;
      // Synchronous thenable: React's `lazy` resolves the payload inside `then`, so calling
      // back before returning makes the first render succeed without suspending.
      return { then: (res: (v: { default: T }) => void) => { res(ready); } } as unknown as Promise<{ default: T }>;
    }
    return load().then((m) => { mod = m; return m; });
  }) as PreloadableLazy<T>;
  Comp.preload = preload;
  return Comp;
}

/** Run `fn` when the browser is idle; Safari has no requestIdleCallback, so fall back to a timer. */
export function whenIdle(fn: () => void): () => void {
  if (typeof requestIdleCallback === 'function') {
    const h = requestIdleCallback(fn, { timeout: 2000 });
    return () => cancelIdleCallback(h);
  }
  const h = setTimeout(fn, 600);
  return () => clearTimeout(h);
}
