/**
 * Host of a URL for display. Invalid input (a half-typed endpoint) falls back
 * to the raw string instead of throwing during render.
 */
export function hostOf(url: string): string {
  try { return new URL(url).host; } catch { return url; }
}
