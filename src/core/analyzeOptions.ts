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

export const DEFAULT_ANALYZE_OPTIONS: AnalyzeOptions = {
  clean: { ...DEFAULT_CLEAN_OPTIONS },
  tokenize: { ...DEFAULT_TOKENIZE_OPTIONS },
  includeAllSwipes: false,
  roles: ['user'],
  onlySpeakers: [],
  useNamesAsDictionary: true,
  onlyCharacter: null,
  // Every kind on by default (user decision 2026-09-04): the kind buttons are the way to hide names, not a hidden default.
  kinds: ['plain', 'person', 'place', 'time', 'generic', 'brand', 'wear', 'title'],
  source: 'mes',
  onlyModel: null,
  ai: DEFAULT_AI_CONFIG,
  nsfwMode: 'show',
  nsfwKinds: [...NSFW_EXPLICIT_KINDS],
  ignoreOwnerBlocklist: false,
};
