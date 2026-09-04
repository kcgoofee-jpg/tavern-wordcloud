/**
 * Coarse class of an API endpoint, for the community board's "where people call"
 * split. Only the class ever leaves the browser — never the address, never the key.
 */
export type EndpointKind = 'official' | 'openrouter' | 'relay' | 'local' | 'other';

/** First-party hosts of the model vendors themselves. */
const OFFICIAL = [
  'api.openai.com', 'api.anthropic.com', 'generativelanguage.googleapis.com',
  'api.deepseek.com', 'api.x.ai', 'api.mistral.ai', 'api.moonshot.cn',
  'open.bigmodel.cn', 'dashscope.aliyuncs.com', 'api.cohere.com', 'api.groq.com',
];

/** A private address, or a name that only resolves on this machine / LAN. */
function isLocal(host: string): boolean {
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) return true;
  if (host === '::1' || host === '0.0.0.0') return true;
  return /^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host)
    || /^172\.(1[6-9]|2\d|3[01])\./.test(host);
}

/**
 * Classify an endpoint address. Anything on a public host that is not a known
 * vendor is called a relay: that is what a third-party OpenAI-compatible base URL
 * is, and it is the honest label for the majority case in this community.
 */
export function endpointKind(endpoint: string): EndpointKind | undefined {
  const raw = endpoint.trim();
  if (!raw) return undefined;
  let host: string;
  try { host = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`).hostname.toLowerCase(); } catch { return 'other'; }
  if (!host) return 'other';
  if (isLocal(host)) return 'local';
  if (host === 'openrouter.ai' || host.endsWith('.openrouter.ai')) return 'openrouter';
  if (OFFICIAL.some((h) => host === h || host.endsWith(`.${h}`))) return 'official';
  return host.includes('.') ? 'relay' : 'other';
}
