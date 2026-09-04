import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useT } from './i18n';
import { createPortal } from 'react-dom';
import Icon from './Icons';

/**
 * Info popover behind an (i) button. Rendered through a portal with fixed
 * positioning so scrolling ancestors do not clip it. Opens on click (touch
 * friendly), closes on outside click, Escape and scroll, and flips below when
 * there is no room above.
 */
export default function Note({ children }: { children: React.ReactNode }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  const pop = useRef<HTMLSpanElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  // Position is computed before paint to avoid a visible jump
  useLayoutEffect(() => {
    if (!open || !btn.current || !pop.current) { setPos(null); return; }
    const b = btn.current.getBoundingClientRect();
    const p = pop.current.getBoundingClientRect();
    const M = 8;
    // Flip below when there is no room above
    const above = b.top - p.height - M;
    const top = above >= M ? above : Math.min(b.bottom + M, window.innerHeight - p.height - M);
    // Clamp horizontally to the viewport
    const left = Math.max(M, Math.min(b.left + b.width / 2 - p.width / 2, window.innerWidth - p.width - M));
    setPos({ top, left });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const close = (e: Event) => {
      if (btn.current?.contains(e.target as Node) || pop.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    // Close on scroll: the position was computed at open time. Named so the cleanup removes the same functions.
    const onScroll = () => setOpen(false);
    const onResize = () => setOpen(false);
    // Capture phase: the panel may stop propagation
    document.addEventListener('pointerdown', close, true);
    document.addEventListener('keydown', onKey);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onResize);
    return () => {
      document.removeEventListener('pointerdown', close, true);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onResize);
    };
  }, [open]);

  return (
    <span className={`note-dot${open ? ' open' : ''}`}>
      <button ref={btn} type="button" aria-expanded={open} aria-label={open ? t('收起说明') : t('说明')}
        title={open ? t('收起说明') : t('说明')} onClick={() => setOpen(!open)}>
        <Icon name="info" size={14} />
      </button>
      {open && createPortal(
        <span
          ref={pop}
          className="note-pop"
          role="note"
          // Hidden until measured; it must render first to have a height
          style={pos ? { top: pos.top, left: pos.left } : { top: 0, left: 0, visibility: 'hidden' }}
        >
          {children}
        </span>,
        document.body,
      )}
    </span>
  );
}
