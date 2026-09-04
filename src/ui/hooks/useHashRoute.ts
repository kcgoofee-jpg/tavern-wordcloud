/** Hash routing for the legal pages: `#/terms` etc. Share links use `#c=…` and are untouched. */
import { useEffect, useState } from 'react';

export type LegalRoute = 'terms' | 'privacy' | 'disclaimer' | 'content' | 'enforcement';

const ROUTES: Record<string, LegalRoute> = {
  '/terms': 'terms',
  '/privacy': 'privacy',
  '/disclaimer': 'disclaimer',
  '/content': 'content',
  '/enforcement': 'enforcement',
};

export function parseRoute(hash: string): LegalRoute | null {
  if (!hash.startsWith('#/')) return null;
  return ROUTES[hash.slice(1)] ?? null;
}

/** Current legal route, live with hashchange. */
export function useHashRoute(): LegalRoute | null {
  const [route, setRoute] = useState<LegalRoute | null>(() =>
    typeof window === 'undefined' ? null : parseRoute(window.location.hash));
  useEffect(() => {
    const onChange = () => setRoute(parseRoute(window.location.hash));
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return route;
}
