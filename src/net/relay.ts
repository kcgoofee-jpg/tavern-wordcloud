/**
 * Call the user's LLM endpoint through the server. Many providers do not enable CORS,
 * so a direct browser fetch fails. Only the target URL, body and Authorization are
 * forwarded; the server keeps neither keys nor text and allows only
 * /chat/completions and /models. Same shape as fetch.
 */
export const relayFetch: typeof fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  const headers: Record<string, string> = {};
  new Headers(init?.headers).forEach((v, k) => { if (/^(authorization|content-type|accept)$/i.test(k)) headers[k] = v; });
  // Absolute URL: inside a Web Worker a relative path has no base to resolve against and
  // fetch throws "Failed to parse URL from /api/relay" (seen 14× in the wild, 2026-09-04).
  const base = typeof self !== 'undefined' && self.location ? self.location.origin : '';
  return fetch(`${base}/api/relay`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal: init?.signal ?? undefined,
    body: JSON.stringify({ url, method: init?.method ?? 'GET', headers, body: typeof init?.body === 'string' ? init.body : undefined }),
  });
};
