import { useCallback, useEffect, useRef, useState } from 'react';

/** Transient state such as "copied". Returns [on, flash]; flash(false) clears immediately. */
export function useFlash(ms: number): [boolean, (on?: boolean) => void] {
  const [on, setOn] = useState(false);
  const timer = useRef<number | null>(null);
  const flash = useCallback((v = true) => {
    if (timer.current) window.clearTimeout(timer.current);
    setOn(v);
    if (v) timer.current = window.setTimeout(() => setOn(false), ms);
  }, [ms]);
  useEffect(() => () => { if (timer.current) window.clearTimeout(timer.current); }, []);
  return [on, flash];
}
