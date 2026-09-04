/**
 * Site notice and deploy-version watch: both polled from the server on the same 10-minute
 * timer (one `setInterval`, not two) since neither needs to be fresher than that. The notice
 * is marked read once its popover is closed; the version check just remembers the first
 * value seen and flags when the server starts reporting a different one (a deploy happened
 * under the visitor's feet).
 */
import { useEffect, useRef, useState } from 'react';
import { probeServer } from '../../net/server';
import { fetchNotice, type SiteNotice } from '../../net/notice';

/** How often the notice and version are re-fetched. The server caches the notice for 60 s anyway. */
const POLL_MS = 600_000;
/** The id of the last notice the visitor closed. */
const SEEN_KEY = 'noticeSeen';

const readSeen = (): string => {
  try { return localStorage.getItem(SEEN_KEY) ?? ''; } catch { return ''; }
};

/**
 * `open` is the notice popover state owned by `useOverlay`; the notice counts as read when
 * it closes again, so a visitor who only glanced at the bell still sees the dot next time.
 * `busy` holds back `updateAvailable` while an analysis is running — the deploy is detected
 * either way, it just is not surfaced until the visitor is free to act on it.
 */
export function useNotice(open: boolean, busy: boolean): { notice: SiteNotice | null; unread: boolean; updateAvailable: boolean } {
  const [notice, setNotice] = useState<SiteNotice | null>(null);
  const [seen, setSeen] = useState(readSeen);
  /** First version this tab saw. Null until the first successful health probe. */
  const initialVersion = useRef<string | null>(null);
  const [changed, setChanged] = useState(false);

  useEffect(() => {
    let alive = true;
    const load = () => {
      void fetchNotice().then((n) => { if (alive) setNotice(n); });
      void probeServer().then((h) => {
        if (!alive || !h?.version) return;
        if (initialVersion.current === null) { initialVersion.current = h.version; return; }
        if (h.version !== initialVersion.current) setChanged(true);
      });
    };
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

  return { notice, unread: !!notice && notice.id !== seen, updateAvailable: changed && !busy };
}
