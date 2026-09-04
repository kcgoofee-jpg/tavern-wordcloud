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
  return fetch('/api/relay', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal: init?.signal ?? undefined,
    body: JSON.stringify({ url, method: init?.method ?? 'GET', headers, body: typeof init?.body === 'string' ? init.body : undefined }),
  });
};
