import { MANUAL_BLOCKLIST } from './manual';
import { AUTO_BLOCKLIST } from './auto';

/** Why a word was removed. Only the owner-maintained lists are reported. */
export type BlockReason = 'manual' | 'auto' | 'template';
export const BLOCK_REASON_LABEL: Record<BlockReason, string> = { manual: '手动', auto: '自动', template: '模板' };

const manual = new Map(MANUAL_BLOCKLIST.map((e) => [e.word, e.reason]));
const auto = new Map(AUTO_BLOCKLIST.filter((e) => e.apply).map((e) => [e.word, e.source]));

/** Server-side baseline list, injected at startup. Applied silently and never reported. */
let baseline = new Set<string>();
let baselineParts: string[] = [];

export function setBaselineWords(words: readonly string[]): void {
  baseline = new Set(words.map((w) => w.trim()).filter(Boolean));
  baselineParts = [...baseline].filter((w) => w.length >= 2 && /^[一-鿿]+$/.test(w));
}
export const baselineSize = (): number => baseline.size;

function inBaseline(word: string): boolean {
  if (baseline.has(word)) return true;
  for (const p of baselineParts) if (word.length > p.length && word.includes(p)) return true;
  return false;
}

/** Returns the owner-list reason for a word, or null. Baseline hits return null and are handled by applyBlocklist. */
export function blockReason(word: string, ownerLists = true): { reason: BlockReason; detail: string } | null {
  if (!ownerLists) return null;
  const m = manual.get(word); if (m !== undefined) return { reason: 'manual', detail: m };
  const a = auto.get(word); if (a !== undefined) return { reason: 'auto', detail: a };
  return null;
}

export interface BlockedSummary { total: number; byReason: Record<BlockReason, number>; samples: { word: string; reason: BlockReason; detail: string }[] }

/** Filters a word list. `blocked` counts only the owner lists so the UI can show what was removed. */
export function applyBlocklist<T extends { text: string }>(words: T[], ownerLists = true): { kept: T[]; blocked: BlockedSummary } {
  const kept: T[] = [];
  const blocked: BlockedSummary = { total: 0, byReason: { manual: 0, auto: 0, template: 0 }, samples: [] };
  for (const w of words) {
    if (inBaseline(w.text)) continue;
    const b = blockReason(w.text, ownerLists);
    if (!b) { kept.push(w); continue; }
    blocked.total++; blocked.byReason[b.reason]++;
    if (blocked.samples.length < 20) blocked.samples.push({ word: w.text, ...b });
  }
  return { kept, blocked };
}
