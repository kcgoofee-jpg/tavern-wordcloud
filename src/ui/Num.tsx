import { useEffect, useRef, useState } from 'react';

/**
 * Animated number. Three guards make sure the displayed value is always the
 * real one: no animation while the page is hidden, jump to the target when the
 * page is hidden mid-animation, and no animation under prefers-reduced-motion.
 */
export default function Num({ value, digits = 0, suffix = '' }: { value: number; digits?: number; suffix?: string }) {
  const [shown, setShown] = useState(value);
  const from = useRef(value);
  const raf = useRef(0);

  useEffect(() => {
    const b = value;
    const snap = () => { cancelAnimationFrame(raf.current); from.current = b; setShown(b); };

    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (document.hidden || reduced) { snap(); return; }

    const a = from.current;
    if (a === b) return;
    const start = performance.now();
    const dur = 380;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / dur);
      // Quintic smoothstep
      const e = t * t * t * (t * (6 * t - 15) + 10);
      const v = a + (b - a) * e;
      setShown(v);
      from.current = v;
      if (t < 1) raf.current = requestAnimationFrame(tick);
      else from.current = b;
    };
    raf.current = requestAnimationFrame(tick);

    // Page hidden mid-animation: rAF stops, so jump to the target
    const onHide = () => { if (document.hidden) snap(); };
    document.addEventListener('visibilitychange', onHide);
    return () => {
      cancelAnimationFrame(raf.current);
      document.removeEventListener('visibilitychange', onHide);
    };
  }, [value]);

  return <>{shown.toFixed(digits)}{suffix}</>;
}
