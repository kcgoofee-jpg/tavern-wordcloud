import { useEffect, useState } from 'react';

/** Phone-width breakpoint: below this the export sheet becomes a full-screen page. */
export const NARROW_PX = 640;

/**
 * Whether the viewport is narrower than `max`. Driven by `matchMedia` rather than a
 * resize listener so rotating a phone fires once, not on every intermediate width.
 * Falls back to `false` where `matchMedia` is missing (happy-dom without a stub).
 */
export function useIsNarrow(max: number = NARROW_PX): boolean {
  const query = `(max-width: ${max - 1}px)`;
  const read = () => (typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia(query).matches
    : false);
  const [narrow, setNarrow] = useState(read);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia(query);
    const on = () => setNarrow(mq.matches);
    on();
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, [query]);

  return narrow;
}
