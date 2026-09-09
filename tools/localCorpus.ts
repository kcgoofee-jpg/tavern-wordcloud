/**
 * Where the real chat logs live on this machine. Never hard-code a personal path: those paths
 * carry the OS user name and the file names of private chats, and this repository is mirrored
 * publicly (2026-09-05). Set WC_LOCAL_CORPUS to a colon-separated list of directories, or put
 * them in .env.local; tests and eval tools skip themselves when nothing is configured.
 */
import fs from 'node:fs';
import path from 'node:path';

export function localCorpusRoots(): string[] {
  const raw = process.env.WC_LOCAL_CORPUS ?? '';
  return raw.split(':').map((s) => s.trim()).filter(Boolean).filter((d) => fs.existsSync(d));
}

/** A single file used by format tests, e.g. WC_LOCAL_SAMPLE_JSONL. */
export function localSample(name: string): string | null {
  const p = process.env[name];
  return p && fs.existsSync(p) ? p : null;
}

/**
 * Distinguishes "WC_LOCAL_CORPUS was never set" from "it's set, but every directory it
 * names is gone" (the 2026-09-08 decommission). Directory names only, never full paths:
 * a full path carries the OS user name, and on this machine the leaf names are the real
 * SillyTavern export root names too, so this reports counts and basenames, not values.
 */
export interface CorpusStatus {
  configured: boolean;
  /** Directories WC_LOCAL_CORPUS names that exist. */
  roots: string[];
  /** Directories WC_LOCAL_CORPUS names that do not exist (basenames only). */
  missing: string[];
}

export function corpusStatus(): CorpusStatus {
  const raw = process.env.WC_LOCAL_CORPUS ?? '';
  const all = raw.split(':').map((s) => s.trim()).filter(Boolean);
  const roots = all.filter((d) => fs.existsSync(d));
  const missing = all.filter((d) => !fs.existsSync(d)).map((d) => path.basename(d));
  return { configured: all.length > 0, roots, missing };
}

/**
 * One line explaining why a real-corpus-dependent eval branch has nothing to work with:
 * which env var, whether it's set, and which of its directories (by name only) are gone.
 */
export function describeCorpusMissing(): string {
  const { configured, missing, roots } = corpusStatus();
  if (!configured) return 'WC_LOCAL_CORPUS 未设置';
  if (missing.length > 0 && roots.length === 0) {
    return `WC_LOCAL_CORPUS 指向的 ${missing.length} 个目录都不存在（${missing.join(', ')}）`;
  }
  if (missing.length > 0) {
    return `WC_LOCAL_CORPUS 的 ${missing.length} 个目录不存在（${missing.join(', ')}），其余目录下没有可用语料`;
  }
  return 'WC_LOCAL_CORPUS 指向的目录都存在，但没有读到任何语料句子（default-user/chats 下没有可用的 .jsonl）';
}

/**
 * Call after a real-corpus-dependent eval computed its sentence/message count. When the
 * count is 0, print the one-line reason above and exit 2 — distinct from 0 (pass) and 1
 * (an assertion actually failed) — instead of letting the caller either report a silent
 * 0-item "pass" or a misleading assertion failure that looks like a real regression.
 * AGENTS hard rule 3 needs this to be loud: a missing corpus must not read as "clean".
 */
export function requireCorpusOrExit(script: string, count: number): void {
  if (count > 0) return;
  console.error(`[${script}] 真实语料不可用：${describeCorpusMissing()}——这是语料缺失，不是评测结果。退出码 2。`);
  process.exit(2);
}
