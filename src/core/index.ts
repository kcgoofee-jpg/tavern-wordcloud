/**
 * Public API of `src/core`. Pure logic: no DOM, no React, no browser APIs
 * except `Intl.Segmenter`. Internal modules may be refactored; changes to this
 * file are breaking changes.
 *
 * ```ts
 * import { analyze, DEFAULT_ANALYZE_OPTIONS } from './core';
 * const result = analyze([{ name: 'card - 2026-08-31@20h00m08s527ms.jsonl', content }], DEFAULT_ANALYZE_OPTIONS);
 * ```
 */

/* ---------- One call: files -> word counts ---------- */
export { analyze, DEFAULT_ANALYZE_OPTIONS } from './analyze';
export type { AnalyzeOptions, SourceFile } from './analyze';

/* ---------- Individual stages ---------- */
export { parseChatFile, collectNames, DEFAULT_PARSE_OPTIONS } from './parse';
export type { ParseOptions } from './parse';

export { cleanMessageText, DEFAULT_CLEAN_OPTIONS } from './clean';

export { tokenizeCorpus, segmentToChunks, discoverPhrases, hasIntlSegmenter, DEFAULT_TOKENIZE_OPTIONS } from './tokenize';
export type { TokenizeResult } from './tokenize';

export { buildStopwords, DEFAULT_STOPWORDS } from './stopwords';

/* ---------- Input formats ---------- */
export { detectFormat, parseTxtChat } from './formats';
export type { ChatFormat } from './formats';

export { readDataBundle } from './bundle';
export type { DataBundle, BundleChat, BundleProgress } from './bundle';

/* ---------- Reasoning traces ---------- */
export { cleanReasoning, findBoilerplate, COT_SCHEMA_STOPWORDS } from './cot';

/* ---------- Entities ---------- */
export { classify, classifyKinds, detectEntities, systemWords, ENTITY_LABEL, EXPERIMENTAL_KINDS } from './entities';
export type { EntityKind, EntityIndex, KindTag } from './entities';

/* ---------- LLM tokenization (optional) ---------- */
export { segmentWithAi, segmentChunk, DEFAULT_AI_CONFIG } from './aiTokenizer';
export type { AiTokenizerConfig, AiProgress } from './aiTokenizer';

/* ---------- Metadata and grouping ---------- */
export { describeChat, groupByCharacter, parseFileName } from './meta';
export type { ChatMeta, CharacterGroup } from './meta';

/* ---------- Error classification ---------- */
export { classifyError } from './errors';
export type { AppError } from './errors';

/* ---------- Types ---------- */
export type {
  AnalysisResult,
  ChatMessage,
  CleanOptions,
  ParsedChat,
  RawMessage,
  Role,
  TokenizeOptions,
  WordCount,
} from './types';
