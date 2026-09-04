import type { AnalysisResult, CleanOptions, Role, TokenizeOptions } from './types';
import { DEFAULT_CLEAN_OPTIONS, stripRepeatedLines } from './clean';
import { collectNames, parseChatFile } from './parse';
import { DEFAULT_AI_CONFIG, type AiTokenizerConfig } from './aiTokenizer';
import { cleanMessageText } from './clean';
import { cleanReasoning, COT_SCHEMA_STOPWORDS } from './cot';
import { classifyKinds, detectEntities, systemWords, type EntityKind } from './entities';
import { detectEnglishNames } from './english';
import { countSensitive, NSFW_EXPLICIT_KINDS, NSFW_KINDS, nsfwKind, type NsfwKind } from './nsfw';
import { applyBlocklist } from './blocklist';
import { describeChat, groupByCharacter } from './meta';
import { DEFAULT_TOKENIZE_OPTIONS, tokenizeCorpus, tokenizeCorpusAsync, type TokenizeResult } from './tokenize';

export interface SourceFile {
  name: string;
  content: string;
}

export interface AnalyzeOptions {
  clean: CleanOptions;
  tokenize: TokenizeOptions;
  includeAllSwipes: boolean;
  /** Roles whose messages are counted. */
  roles: Role[];
  /** Restrict to these speaker names (empty = all). */
  onlySpeakers: string[];
  /** Feed character names to the tokenizer as a dictionary. */
  useNamesAsDictionary: boolean;
  /** Restrict to one character card; null = merge all. */
  onlyCharacter: string | null;
  /** Entity kinds shown in the cloud. Person names are off by default because they dominate the counts. */
  kinds: EntityKind[];
  /** What to count: message text, or the model's reasoning trace. */
  source: 'mes' | 'reasoning';
  /** Restrict reasoning traces to one model; null = all. */
  onlyModel: string | null;
  /** LLM-assisted tokenization. Off by default; when enabled, text is sent to the configured endpoint. */
  ai: AiTokenizerConfig;
  /** How explicit words are treated: show (default), hide, or only. */
  nsfwMode: 'show' | 'hide' | 'only';
  /** Categories that count as explicit. Detection is unaffected; this only drives hide/only. */
  nsfwKinds: NsfwKind[];
  /** Skip the owner-maintained manual and auto blocklists. */
  ignoreOwnerBlocklist: boolean;
}

/**
 * Generic-word detection (see finish()). DP below the threshold = the word's occurrences follow
 * the message lengths, i.e. it belongs to the language, not to this story. Calibrated on the
 * local 200-message logs: story nouns sit above 0.5 (办公室 .54, 合同 .65), narrative filler below 0.35 (窗外 .33).
 */
const GENERIC_DP = 0.35;
const GENERIC_MIN_MESSAGES = 8;
/** Words checked (the frequency list head is all that can reach the cloud). */
const GENERIC_SCAN = 150;
/** Filler appears about once per message where it appears; a word repeated inside messages is content. */
const GENERIC_PER_MESSAGE = 2.0;

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

/**
 * Parse, filter and clean the input, returning the texts to tokenize.
 * Split out so a caller can run an external (async) tokenizer before calling `analyze`.
 */
export function prepareTexts(files: SourceFile[], options: AnalyzeOptions): string[] {
  const parseOpts = { clean: options.clean, includeAllSwipes: options.includeAllSwipes };
  const chats = files.map((f) => parseChatFile(f.name, f.content, parseOpts));
  const scoped = options.onlyCharacter
    ? chats.filter((c) => (c.charName ?? c.source) === options.onlyCharacter)
    : chats;
  const roleSet = new Set<Role>(options.roles);
  const speakerSet = new Set(options.onlySpeakers);
  const kept = scoped.flatMap((c) =>
    c.messages.filter((m) => roleSet.has(m.role) && (speakerSet.size === 0 || speakerSet.has(m.name))),
  );
  if (options.source === 'reasoning') {
    const rows = kept
      .filter((m) => m.reasoning && (!options.onlyModel || m.model === options.onlyModel))
      .map((m) => m.reasoning!);
    return cleanReasoning(rows, (t) => cleanMessageText(t, options.clean)).texts;
  }
  return stripRepeatedLines(kept.map((m) => m.text));
}

/**
 * Parse -> filter -> clean -> tokenize -> count. Pure and synchronous.
 *
 * @param presegmented externally tokenized texts, aligned with `prepareTexts` order
 */
export function analyze(
  files: SourceFile[],
  options: AnalyzeOptions,
  presegmented?: (string[] | undefined)[],
  onParse?: (done: number, total: number) => void,
): AnalysisResult {
  const p = prepare(files, options, onParse);
  return p.finish(tokenizeCorpus(p.texts, p.tokOpts, presegmented));
}

/**
 * Async variant: tokenizes in batches, reports progress and yields between batches.
 * Produces the same result as `analyze`.
 */
export async function analyzeAsync(
  files: SourceFile[],
  options: AnalyzeOptions,
  presegmented?: (string[] | undefined)[],
  onParse?: (done: number, total: number) => void,
  /** (doneChars, totalChars) — see tokenizeCorpusAsync */
  onTokenize?: (done: number, total: number) => void,
  yieldFn?: () => Promise<void>,
): Promise<AnalysisResult> {
  const p = prepare(files, options, onParse);
  if (yieldFn) await yieldFn();
  const tok = await tokenizeCorpusAsync(p.texts, p.tokOpts, presegmented, onTokenize, yieldFn);
  return p.finish(tok);
}

/** Everything before tokenization: parse, filter, entity detection. Returns the tokenizer input and a finisher. */
function prepare(
  files: SourceFile[],
  options: AnalyzeOptions,
  /** Parse progress in **bytes of source text**, so one big file still moves. */
  onParse?: (done: number, total: number) => void,
): { texts: string[]; tokOpts: Partial<TokenizeOptions>; finish: (tok: TokenizeResult) => AnalysisResult } {
  const t0 = Date.now();
  const parseOpts = { clean: options.clean, includeAllSwipes: options.includeAllSwipes };
  let parsedChars = 0;
  const totalChars = Math.max(1, files.reduce((n, f) => n + f.content.length, 0));
  const chats = files.map((f) => {
    const c = parseChatFile(f.name, f.content, parseOpts);
    parsedChars += f.content.length;
    onParse?.(parsedChars, totalChars);
    return c;
  });

  const groups = groupByCharacter(chats);
  const scoped = options.onlyCharacter
    ? chats.filter((c) => (c.charName ?? c.source) === options.onlyCharacter)
    : chats;

  const roleSet = new Set<Role>(options.roles);
  const speakerSet = new Set(options.onlySpeakers);

  const speakerTally = new Map<string, { role: Role; messages: number }>();
  for (const c of scoped) {
    for (const m of c.messages) {
      const e = speakerTally.get(m.name);
      if (e) e.messages++;
      else speakerTally.set(m.name, { role: m.role, messages: 1 });
    }
  }

  const kept = scoped.flatMap((c) =>
    c.messages.filter(
      (m) => roleSet.has(m.role) && (speakerSet.size === 0 || speakerSet.has(m.name)),
    ),
  );

  // Reasoning traces use a separate cleaning path (see cot.ts).
  let texts: string[];
  let cotBoilerplate = 0;
  let cotStopwords: string[] = [];
  if (options.source === 'reasoning') {
    const rows = kept
      .filter((m) => m.reasoning && (!options.onlyModel || m.model === options.onlyModel))
      .map((m) => m.reasoning!);
    const cleaned = cleanReasoning(rows, (t) => cleanMessageText(t, options.clean));
    texts = cleaned.texts;
    cotBoilerplate = cleaned.boilerplateSentences;
    cotStopwords = COT_SCHEMA_STOPWORDS;
  } else {
    texts = stripRepeatedLines(kept.map((m) => m.text));
  }

  // Entities first: names go straight into the dictionary.
  // Name detection runs on all messages of the card, not only the filtered ones; names are a property of the story, not of the speaker.
  const allTexts = scoped.flatMap((c) => c.messages.map((m) => m.text));
  const entities = detectEntities(allTexts, systemWords(scoped.flatMap((c) => c.messages)));
  // English proper nouns use capitalization as evidence; both name sets feed the dictionary.
  const englishNames = detectEnglishNames(allTexts);
  for (const n of englishNames) entities.kindOf.set(n.toLowerCase(), 'person');
  const dictionary = options.useNamesAsDictionary ? collectNames(scoped) : [];

  const tokOpts: Partial<TokenizeOptions> = {
    ...options.tokenize,
    extraStopwords: [...options.tokenize.extraStopwords, ...cotStopwords],
    dictionary: [...dictionary, ...entities.personNames, ...englishNames, ...options.tokenize.dictionary],
  };

  const finish = (tok: TokenizeResult): AnalysisResult => {

  // Entity kinds are assigned after tokenization.
  const kindSet = new Set<EntityKind>(options.kinds);
  // Blocklists are the last stage; the number removed is reported to the UI.
  const { kept: allowed, blocked } = applyBlocklist(tok.allWords, !options.ignoreOwnerBlocklist);
  // Template words: present in most messages, about once each. Scaffolding
  // such as labels and option markers behaves this way; story words do not.
  const msgN = texts.length;
  if (msgN >= 8) {
    const dict = new Set(tokOpts.dictionary);
    const drop = new Set<string>();
    for (const w of allowed) {
      if (w.count < msgN * 0.5) continue;
      if (dict.has(w.text) || entities.kindOf.get(w.text) === 'person') continue;
      // Present in most messages, about once each, and anchored at the start or end of the message
      let inMsgs = 0; let edge = 0;
      for (const t of texts) {
        const i = t.indexOf(w.text);
        if (i < 0) continue;
        inMsgs++;
        const rel = i / Math.max(1, t.length);
        if (rel <= 0.2 || rel >= 0.8) edge++;
      }
      if (inMsgs >= msgN * 0.6 && w.count <= inMsgs * 1.15 && edge >= inMsgs * 0.8) drop.add(w.text);
    }
    if (drop.size) {
      for (const w of allowed) if (drop.has(w.text)) {
        blocked.total++; blocked.byReason.template++;
        if (blocked.samples.length < 20) blocked.samples.push({ word: w.text, reason: 'template', detail: 'once per message' });
      }
      for (let i = allowed.length - 1; i >= 0; i--) if (drop.has(allowed[i].text)) allowed.splice(i, 1);
    }
  }
  // Generic words: spread evenly over the messages, about once per message (那只 / 几乎 / 顺着 …
  // that escaped the stop list). Story words cluster in a few messages. Gries' DP over the message
  // partition; only the words that could reach the cloud are measured, dictionary words and names never.
  const generic = new Set<string>();
  if (msgN >= GENERIC_MIN_MESSAGES) {
    const dict = new Set(tokOpts.dictionary);
    const totalLen = texts.reduce((a, t) => a + t.length, 0) || 1;
    // The expected share of each message is the same for every word, so it is computed once
    // instead of `t.length / totalLen` inside the per-word loop; `occ` is a reused typed
    // array rather than a fresh 1500-element array per word.
    const share = texts.map((t) => t.length / totalLen);
    const occ = new Int32Array(texts.length);
    for (const w of allowed.slice(0, GENERIC_SCAN)) {
      if (w.count < 4 || dict.has(w.text) || entities.kindOf.has(w.text)) continue;
      let dp = 0, inMsgs = 0, total = 0;
      const word = w.text, wlen = word.length;
      for (let k = 0; k < texts.length; k++) {
        const t = texts[k];
        let n = 0, i = 0;
        while ((i = t.indexOf(word, i)) >= 0) { n++; i += wlen; }
        occ[k] = n; total += n;
      }
      if (!total) continue;
      for (let k = 0; k < texts.length; k++) { if (occ[k]) inMsgs++; dp += Math.abs(occ[k] / total - share[k]); }
      if (dp * 0.5 < GENERIC_DP && total <= inMsgs * GENERIC_PER_MESSAGE) generic.add(w.text);
    }
  }
  const typed = allowed.map((w) => {
    const n = nsfwKind(w.text);
    // A word can match several kinds (赵总 is a person and a title); `kind` stays the strongest.
    let kinds = classifyKinds(w.text, entities);
    if (kinds.length === 1 && kinds[0].kind === 'plain' && generic.has(w.text)) kinds = [{ kind: 'generic' as const, conf: kinds[0].conf }];
    return { ...w, kind: kinds[0].kind, kinds, ...(n ? { nsfw: n } : {}) };
  });
  // Explicitness is decided by the selected categories; detection always runs so the word table can label every hit.
  const nsfwSet = new Set<NsfwKind>(options.nsfwKinds);
  const explicit = (w: { nsfw?: NsfwKind }) => w.nsfw !== undefined && nsfwSet.has(w.nsfw);
  // A multi-kind word is shown when *any* of its kinds is switched on.
  const anyKindOn = (w: { kinds: { kind: EntityKind }[] }) => w.kinds.some((k) => kindSet.has(k.kind));
  const eligible = typed.filter((w) => anyKindOn(w) && w.count >= options.tokenize.minCount);
  const visible = eligible
    .filter((w) => (options.nsfwMode === 'only' ? explicit(w) : options.nsfwMode === 'hide' ? !explicit(w) : true))
    .slice(0, options.tokenize.maxWords);

  const rawChars = kept.reduce((a, m) => a + m.raw.length, 0);
  const cleanChars = kept.reduce((a, m) => a + m.text.length, 0);

  return {
    words: visible,
    allWords: typed,
    totalTokens: tok.totalTokens,
    countedTokens: tok.countedTokens,
    uniqueTokens: tok.uniqueTokens,
    messageCount: kept.length,
    totalMessages: scoped.reduce((a, c) => a + c.messages.length, 0),
    rawChars,
    cleanChars,
    discovered: tok.discovered,
    warnings: chats.flatMap((c) => c.warnings),
    usedFallbackSegmenter: tok.usedFallbackSegmenter,
    perSource: scoped.map((c) => ({
      source: c.source,
      messages: c.messages.length,
      rawChars: c.rawChars,
      cleanChars: c.cleanChars,
    })),
    speakers: [...speakerTally.entries()]
      .map(([name, v]) => ({ name, role: v.role, messages: v.messages }))
      .sort((a, b) => b.messages - a.messages),
    sample: texts.find((t) => t.length > 80)?.slice(0, 600) ?? '',
    sensitive: countSensitive(eligible, nsfwSet),
    nsfwByKind: NSFW_KINDS.map((kind) => ({ kind, words: eligible.filter((w) => w.nsfw === kind).length })),
    blocked,
    cot: {
      /** Messages that carry a reasoning trace. */
      available: kept.filter((m) => m.reasoning).length,
      /** Models seen, for the per-model filter. */
      models: [...new Set(kept.filter((m) => m.reasoning && m.model).map((m) => m.model!))],
      /** Template sentences removed because they appeared in every message. */
      boilerplateSentences: cotBoilerplate,
    },
    entities: {
      persons: entities.personNames
        .map((n) => ({ text: n, confidence: entities.personConfidence.get(n) ?? 0 }))
        .sort((a, b) => b.confidence - a.confidence),
      // Per-kind counts so the UI can show what enabling a kind would add.
      // Counted on any hit, so the sum can exceed the number of words.
      byKind: (['person', 'time', 'place', 'system', 'plain', 'generic', 'brand', 'wear', 'title'] as EntityKind[]).map((k) => ({
        kind: k,
        words: typed.filter((w) => w.kinds.some((x) => x.kind === k) && w.count >= options.tokenize.minCount).length,
      })),
    },
    elapsedMs: Date.now() - t0,
    groups,
    meta: scoped.length
      ? describeChat({
          source: options.onlyCharacter ?? '全部',
          charName: options.onlyCharacter ?? (groups.length === 1 ? groups[0].character : `${groups.length} 张角色卡`),
          worldInfo: scoped.find((c) => c.worldInfo)?.worldInfo,
          authorNote: scoped.find((c) => c.authorNote)?.authorNote,
          messages: scoped.flatMap((c) => c.messages),
          warnings: [],
          rawChars: scoped.reduce((a, c) => a + c.rawChars, 0),
          cleanChars: scoped.reduce((a, c) => a + c.cleanChars, 0),
        })
      : null,
  };
  };
  return { texts, tokOpts, finish };
}
