/** Report browser errors to the server (message, stack, path, UA only). Shown on /admin. */
let armed = false;
export function armErrorReporting(): void {
  if (armed || typeof window === 'undefined') return;
  armed = true;
  const send = (message: string, stack?: string) => {
    // Also sent as a Matomo event when available
    try { (window as unknown as { _paq?: unknown[][] })._paq?.push(['trackEvent', 'error', message.slice(0, 120)]); } catch { /* none */ }
    try {
      void fetch('/api/client-error', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, keepalive: true,
        body: JSON.stringify({ message, stack, page: location.pathname + location.hash.slice(0, 20), ua: navigator.userAgent }),
      });
    } catch { /* ignore reporting failures */ }
  };
  window.addEventListener('error', (e) => send(e.message || 'error', e.error instanceof Error ? e.error.stack : undefined));
  window.addEventListener('unhandledrejection', (e) => {
    const r = e.reason as unknown;
    send(r instanceof Error ? r.message : String(r), r instanceof Error ? r.stack : undefined);
  });
}
/** Errors classified as unknown by the UI are also reported */
export function reportError(title: string, detail?: string): void {
  if (!armed) return;
  try {
    void fetch('/api/client-error', { method: 'POST', headers: { 'Content-Type': 'application/json' }, keepalive: true,
      body: JSON.stringify({ message: title, stack: detail?.slice(0, 2000), page: location.pathname, ua: navigator.userAgent }) });
  } catch { /* ignore */ }
}
