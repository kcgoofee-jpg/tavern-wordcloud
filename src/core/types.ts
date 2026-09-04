/** A raw message as read from a chat file (one JSONL line). */
export interface RawMessage {
  name?: string;
  is_user?: boolean;
  is_system?: boolean;
  mes?: string;
  send_date?: string | number;
  extra?: Record<string, unknown> | unknown[];
  swipes?: string[];
  swipe_id?: number;
}

export type Role = 'user' | 'char' | 'system';

/** A normalized message. */
export interface ChatMessage {
  /** Index within the file. */
  index: number;
  /** Speaker display name. */
  name: string;
  role: Role;
  /** Text before cleaning. */
  raw: string;
  /** Text after cleaning. */
  text: string;
  date?: string;
  /** Model reasoning trace. Not part of the main cloud; can be analyzed separately. */
  reasoning?: string;
  /** Model that generated the message (character messages only). */
  model?: string;
  api?: string;
  /** Generation time in seconds (gen_started -> gen_finished). */
  genSeconds?: number;
  /** Number of swipes for this turn (1 = none). */
  swipeCount: number;
}

export interface ParsedChat {
  /** File name. */
  source: string;
  userName?: string;
  charName?: string;
  /** World-info name, from chat_metadata.world_info. */
  worldInfo?: string;
  /** Author's note, from chat_metadata.note_prompt. */
  authorNote?: string;
  messages: ChatMessage[];
  /** Parse problems; always surfaced in the UI. UserText: translated at display time. */
  warnings: import('./zh').UserText[];
  /** Character counts before and after cleaning. */
  rawChars: number;
  cleanChars: number;
  /**
   * Last message index that still fit in the model context
   * (`chat_metadata.lastInContextMessageId`). HUD display is a separate feature.
   */
  lastInContextMessageId?: number;
}

export interface WordCount {
  text: string;
  count: number;
  /**
   * Highest-confidence entity kind, assigned by entities.ts after tokenization.
   * Kept alongside `kinds` so existing callers and share links keep working.
   */
  kind?: import('./entities').EntityKind;
  /** Every kind the word matched, strongest first. `kind` is `kinds[0].kind`. */
  kinds?: { kind: import('./entities').EntityKind; conf: number }[];
  /** Explicit-word category, if any. */
  nsfw?: import('./nsfw').NsfwKind;
  /** Set on words injected/replaced by the priority-words override. */
  priority?: true;
  /** User-set display text; only changes what is drawn, not `text`/`count`/`kind`. */
  display?: string;
  /** User-forced rotation; overrides the random rotateRatio draw. */
  rotate?: 'h' | 'v';
}

/** Per-word user overrides, keyed by the tokenizer's original word (lowercased). */
export interface WordOverride {
  /** Only changes what is drawn on the cloud. */
  display?: string;
  /** This word's count merges into the target word (directed; cycles are ignored). */
  alias?: string;
  /** Forced horizontal/vertical rotation. */
  rotate?: 'h' | 'v';
  /** User-reassigned entity kind. */
  kind?: import('./entities').EntityKind;
}

export interface CleanOptions {
  /** Remove non-standard HTML tags together with their content. */
  stripCustomTags: boolean;
  /** Remove code blocks. */
  stripCodeBlocks: boolean;
  /** Remove structured lines such as |a|b|c| or {x|y}. */
  stripStructuredLines: boolean;
  /** Remove [OOC: ...]. */
  stripOOC: boolean;
  /** Rules imported from SillyTavern regex scripts or proposed by a model; applied first. */
  customRules?: import('./regexScripts').CleanRule[];
}

export interface TokenizeOptions {
  /** Minimum word length (characters for CJK, letters for Latin). */
  minLength: number;
  /** Enable new-word discovery (merging adjacent tokens into proper nouns). */
  discoverPhrases: boolean;
  /** Extra discovery criterion: branching entropy of neighbours. Off by default. */
  discoverFreedom?: boolean;
  /** Minimum count for a discovered word. */
  discoverMinCount: number;
  /** Cohesion threshold for discovery. Unset means `DISCOVER_COHESION`; only `tools/eval/sweep.ts` varies it. */
  discoverCohesion?: number;
  /** Filter stop words. */
  useStopwords: boolean;
  /** Remove narrative filler words (looked / stood / nodded). On by default. */
  useNarrativeStopwords: boolean;
  /** English lemmatization (look/looks/looked/looking count as one). On by default. */
  mergeEnglishForms: boolean;
  /** User-supplied stop words. */
  extraStopwords: string[];
  /** Minimum count for a word to enter the cloud. */
  minCount: number;
  /** Maximum number of words in the cloud. */
  maxWords: number;
  /** Known proper nouns forced to be single tokens. */
  dictionary: string[];
  /** User-forced multi-character words. */
  forceWords: string[];
  /** User-forced splits. */
  splitWords: string[];
}

export interface AnalysisResult {
  /** Words in the cloud (after minCount / maxWords). */
  words: WordCount[];
  /** Full frequency table, for CSV export. */
  allWords: WordCount[];
  totalTokens: number;
  /** Tokens counted in the table; the denominator for percentages. */
  countedTokens: number;
  uniqueTokens: number;
  /** Messages included in the count. */
  messageCount: number;
  /** Total messages in the file, including filtered ones. */
  totalMessages: number;
  rawChars: number;
  cleanChars: number;
  /** Discovered words, by frequency. */
  discovered: string[];
  warnings: import('./zh').UserText[];
  /** Intl.Segmenter unavailable; fell back to per-character splitting. */
  usedFallbackSegmenter: boolean;
  perSource: { source: string; messages: number; rawChars: number; cleanChars: number }[];
  /** Speakers seen in the file, for filtering. */
  speakers: { name: string; role: Role; messages: number }[];
  /** Start of the cleaned text, for eyeballing the cleaning result. */
  sample: string;
  elapsedMs: number;
  /** Explicit words in the cloud, counted with the selected categories. */
  sensitive: number;
  /** Hits per explicit-word category, independent of selection. */
  nsfwByKind: { kind: import('./nsfw').NsfwKind; words: number }[];
  /** Words removed by the owner blocklists. */
  blocked: import('./blocklist').BlockedSummary;
  /** Availability of reasoning traces. */
  cot: { available: number; models: string[]; boilerplateSentences: number };
  /** Detected entities, for the kind toggles and manual edits. */
  entities: {
    persons: { text: string; confidence: number }[];
    byKind: { kind: import('./entities').EntityKind; words: number }[];
  };
  /**
   * Proposed coreference groups: a full name and the short forms that refer to
   * the same person (entities.ts `detectCoref`).
   *
   * **A proposal, not a merge.** `words` / `allWords` are untouched: the local
   * corpus measures the rule's mis-merge rate at 40% (`npm run eval:persons`),
   * far above the 5% bar in the design note, so the UI only offers the grouping
   * and the user applies it through the ordinary `alias` override.
   */
  coref?: import('./entities').CorefGroup[];
  /** Results grouped by character card. */
  groups: import('./meta').CharacterGroup[];
  /** Card info for the current scope. */
  meta: import('./meta').ChatMeta | null;
  /**
   * Word co-occurrence over the head of the frequency list, used only by the
   * equivalence picker. Analysis-time scratch data: stripped before sharing,
   * exporting or contributing (core/cooccur.ts `stripCooccur`).
   */
  cooccur?: import('./cooccur').Cooccur;
}
