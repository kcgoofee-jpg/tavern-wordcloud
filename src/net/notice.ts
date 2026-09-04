/**
 * The site notice, as the bell shows it: a short title and a body, either of which may be
 * empty. Fetched here rather than in net/server.ts so the notice shape and the analysis
 * client can move independently.
 *
 * Old notices carry no title at all; the server hands out their first line as one
 * (see `migrateNotice` in server/index.ts), so nothing is derived on this side — an
 * absent title simply means the notice has no heading and none is rendered.
 */

/** One published notice. `title` and `text` are plain text: HTML was stripped before storing. */
export interface SiteNotice {
  id: string;
  /** Empty when the notice is a body alone. */
  title: string;
  text: string;
  level: 'info' | 'warn';
  /** Publication time, epoch ms. */
  updatedAt: number;
}

/**
 * The current site notice, or null when there is none. The single-file build has no
 * server behind it, so the request fails and the bell never appears.
 */
export async function fetchNotice(signal?: AbortSignal): Promise<SiteNotice | null> {
  try {
    const r = await fetch('/api/notice', { signal });
    if (!r.ok) return null;
    const b = (await r.json()) as Partial<SiteNotice> | null;
    if (!b?.id || !(b.text || b.title)) return null;
    return {
      id: String(b.id),
      title: String(b.title ?? ''),
      text: String(b.text ?? ''),
      level: b.level === 'warn' ? 'warn' : 'info',
      updatedAt: Number(b.updatedAt) || 0,
    };
  } catch {
    return null;   // Static hosting, offline or blocked all count as no notice
  }
}
