/**
 * Where the real chat logs live on this machine. Never hard-code a personal path: those paths
 * carry the OS user name and the file names of private chats, and this repository is mirrored
 * publicly (2026-09-05). Set WC_LOCAL_CORPUS to a colon-separated list of directories, or put
 * them in .env.local; tests and eval tools skip themselves when nothing is configured.
 */
import fs from 'node:fs';

export function localCorpusRoots(): string[] {
  const raw = process.env.WC_LOCAL_CORPUS ?? '';
  return raw.split(':').map((s) => s.trim()).filter(Boolean).filter((d) => fs.existsSync(d));
}

/** A single file used by format tests, e.g. WC_LOCAL_SAMPLE_JSONL. */
export function localSample(name: string): string | null {
  const p = process.env[name];
  return p && fs.existsSync(p) ? p : null;
}
