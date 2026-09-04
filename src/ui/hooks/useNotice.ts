/** Site notice: polled from the server, marked as read once its popover is closed. */
import { useEffect, useRef, useState } from 'react';
import { fetchNotice, type SiteNotice } from '../../net/server';

/** How often the notice is re-fetched. The server caches it for 60 s anyway. */
const POLL_MS = 600_000;
/** The id of the last notice the visitor closed. */
const SEEN_KEY = 'noticeSeen';

const readSeen = (): string => {
  try { return localStorage.getItem(SEEN_KEY) ?? ''; } catch { return ''; }
};

/**
 * `open` is the popover state owned by `useOverlay`; the notice counts as read when it
 * closes again, so a visitor who only glanced at the bell still sees the dot next time.
 */
export function useNotice(open: boolean): { notice: SiteNotice | null; unread: boolean } {
  const [notice, setNotice] = useState<SiteNotice | null>(null);
  const [seen, setSeen] = useState(readSeen);

  useEffect(() => {
    let alive = true;
    const load = () => { void fetchNotice().then((n) => { if (alive) setNotice(n); }); };
    load();
    const timer = window.setInterval(load, POLL_MS);
    return () => { alive = false; window.clearInterval(timer); };
  }, []);

  // Mark as read on close, not on open: the id is only stored once the visitor is done reading.
  const wasOpen = useRef(false);
  useEffect(() => {
    if (open) { wasOpen.current = true; return; }
    if (!wasOpen.current) return;
    wasOpen.current = false;
    if (!notice) return;
    try { localStorage.setItem(SEEN_KEY, notice.id); } catch { /* private mode: the dot comes back */ }
    setSeen(notice.id);
  }, [open, notice]);

  return { notice, unread: !!notice && notice.id !== seen };
}
