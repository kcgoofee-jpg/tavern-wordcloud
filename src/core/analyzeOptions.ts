/**
 * The default AnalyzeOptions, split out of `analyze.ts` so the UI can read them without
 * pulling the whole pipeline (parse, entities, the blocklists) into the first-screen bundle —
 * the analysis itself only ever runs in the worker or on the server. `analyze.ts` re-exports
 * this, so `import { DEFAULT_ANALYZE_OPTIONS } from './analyze'` keeps working.
 */
import type { AnalyzeOptions } from './analyze';
import { DEFAULT_CLEAN_OPTIONS } from './clean';
import { DEFAULT_TOKENIZE_OPTIONS } from './tokenize';
import { DEFAULT_AI_CONFIG } from './aiTokenizer';
import { NSFW_EXPLICIT_KINDS } from './nsfw';
import { ALL_KINDS } from './entities';

export const DEFAULT_ANALYZE_OPTIONS: AnalyzeOptions = {
  clean: { ...DEFAULT_CLEAN_OPTIONS },
  tokenize: { ...DEFAULT_TOKENIZE_OPTIONS },
  includeAllSwipes: false,
  // Both speakers by default (user decision 2026-09-05). This reverses notes/docs/13
  // «默认只统计「我说的」»: a chat has two sides, and a fresh import that silently drops the
  // character's half looked broken — the «你自己说的话只有 N 条» notice existed only to dig
  // people out of it. `system` stays off: those are SillyTavern's own UI notices, not dialogue.
  // Saved settings keep whatever they stored (see ui/hooks/useSettings.ts loadSettings).
  roles: ['user', 'char'],
  onlySpeakers: [],
  useNamesAsDictionary: true,
  onlyCharacter: null,
  // Every kind on by default (user decision 2026-09-04): the kind buttons are the way to hide names, not a hidden default.
  kinds: [...ALL_KINDS],
  source: 'mes',
  onlyModel: null,
  ai: DEFAULT_AI_CONFIG,
  nsfwMode: 'show',
  nsfwKinds: [...NSFW_EXPLICIT_KINDS],
  ignoreOwnerBlocklist: false,
};
