/**
 * Finite catalog of data-rule structures taken from SillyTavern reserved
 * interfaces and core write paths. Classes are regularities (tag pair, KV run,
 * fence, prefix length…), not character encodings and not plugin names.
 *
 * Detectors live in clean.ts / parse.ts / regexScripts.ts.
 * Human-maintained literals live in instructLines.ts and blocklist/manual.ts.
 * The generator (test/shapeGen.ts) instantiates these classes; it is not the cleaner.
 */
export type ShapeLayer = 'parse' | 'detector' | 'human';
export type ShapeStatus = 'landed' | 'deferred';

export interface ShapeClass {
  id: string;
  /** One-sentence regularity. */
  regularity: string;
  /** SillyTavern write path this class comes from. */
  writePath: string;
  layer: ShapeLayer;
  status: ShapeStatus;
  /** Required when status is deferred. */
  deferReason?: string;
}

export const SHAPE_CATALOG = [
  {
    id: 'jsonl_header',
    regularity: 'First JSONL line is metadata (chat_metadata / unused names), not a message.',
    writePath: 'chats-endpoint.js importOobaChat header; chats.js save',
    layer: 'parse',
    status: 'landed',
  },
  {
    id: 'hide_is_system',
    regularity: '/hide only flips is_system; speaker name is unchanged.',
    writePath: 'chats.js hideChatMessageRange',
    layer: 'parse',
    status: 'landed',
  },
  {
    id: 'system_extra_type',
    regularity: 'extra.type in the ST system_message_types enum is a notice, not story speech.',
    writePath: 'system-messages.js system_message_types; slash-commands.js sendNarratorMessage',
    layer: 'parse',
    status: 'landed',
  },
  {
    id: 'display_text',
    regularity: 'extra.display_text is what the UI showed; it beats mes.',
    writePath: 'regex-engine.js MD display; translate/index.js',
    layer: 'parse',
    status: 'landed',
  },
  {
    id: 'swipe_id',
    regularity: 'swipe_id indexes swipes[]; ST writes mes = swipes[swipe_id] on swipe.',
    writePath: 'slash-commands.js addSwipeCallback',
    layer: 'parse',
    status: 'landed',
  },
  {
    id: 'reasoning_display_text',
    regularity: 'extra.reasoning_display_text is the UI trace; it beats extra.reasoning.',
    writePath: 'reasoning.js; translate/index.js',
    layer: 'parse',
    status: 'landed',
  },
  {
    id: 'file_length_prefix',
    regularity: 'extra.fileLength is the byte/char length of attachment text prepended onto mes.',
    writePath: 'chats.js appendFileContent',
    layer: 'parse',
    status: 'landed',
  },
  {
    id: 'paired_custom_tag',
    regularity: 'A non-HTML tag pair (ASCII or Unicode name) is plugin markup; drop tag and inner text.',
    writePath: 'mes HTML dumped by extensions; not a core field, reserved tag shape',
    layer: 'detector',
    status: 'landed',
  },
  {
    id: 'dangling_custom_tag',
    regularity: 'An unclosed custom open tag cuts everything after it.',
    writePath: 'truncated model output / mismatched close',
    layer: 'detector',
    status: 'landed',
  },
  {
    id: 'orphan_custom_tag',
    regularity: 'An unmatched custom close tag cuts everything before it.',
    writePath: 'truncated model output starting mid-block',
    layer: 'detector',
    status: 'landed',
  },
  {
    id: 'colon_fence',
    regularity: 'A line starting with two or more colons opens a container; drop through the matching close (or EOF).',
    writePath: 'markdown-like plugin containers (::: and ::); ST regex-half dumps',
    layer: 'detector',
    status: 'landed',
  },
  {
    id: 'kv_run',
    regularity: '≥3 consecutive distinct short label:value lines are a status block when a known field or ≥2 numeric values are present. Repeated labels are dialogue.',
    writePath: 'plugin status bars written as plain text into mes',
    layer: 'detector',
    status: 'landed',
  },
  {
    id: 'bracket_status',
    regularity: '≥2 consecutive [label] value lines with a known status field are a header, not speech.',
    writePath: 'plugin status headers without a colon',
    layer: 'detector',
    status: 'landed',
  },
  {
    id: 'wi_bracket_wrap',
    regularity: 'A line that opens [ or 【, contains a colon, and is not closed on the same line starts a wrap that ends at a lone ] / 】 (≥2 inner lines).',
    writePath: 'world-info.js wrap via historical wi_format `[Details…:\\n{0}]\\n` (current default `{0}` has no wrap)',
    layer: 'detector',
    status: 'landed',
  },
  {
    id: 'instruct_whole_line',
    regularity: 'A whole line equal to an ST-core instruct sequence is scaffolding, not speech.',
    writePath: 'instruct-mode.js sequences; default presets (### Instruction:, <|im_start|>, [INST], </s>, …)',
    layer: 'human',
    status: 'landed',
  },
  {
    id: 'instruct_turn_wrap',
    regularity: 'formatInstructModeChat renders one turn as prefix+separator+mes+suffix. wrap:false puts the whole turn on one line between a paired open/close sequence; wrap:true leaves the prompt body between a prompt-side sequence and the next reply-side sequence (≤6 lines).',
    writePath: 'instruct-mode.js formatInstructModeChat; presets Llama 2 Chat (wrap false, "[INST] "/" [/INST]") and Alpaca/ChatML (wrap true, whitespace-only input_suffix)',
    layer: 'human',
    status: 'landed',
  },
  {
    id: 'numeric_panel',
    regularity: '≥3 consecutive short “token number” lines are an HTML-stripped status panel.',
    writePath: 'plugin UI that uses only div/span (inner text kept by the HTML allowlist)',
    layer: 'detector',
    status: 'landed',
  },
  {
    id: 'indented_kv',
    regularity: '≥3 consecutive indented key: value lines are a YAML/dump run, not prose.',
    writePath: 'plugin variable dumps that JSON.parse rejects',
    layer: 'detector',
    status: 'landed',
  },
  {
    id: 'ooc',
    regularity: '[OOC: …] / （OOC：…） blocks are out-of-character notes.',
    writePath: 'common ST OOC convention in mes',
    layer: 'detector',
    status: 'landed',
  },
  {
    id: 'code_fence',
    regularity: '``` / ~~~ delimited blocks are code, not speech.',
    writePath: 'markdown in mes',
    layer: 'detector',
    status: 'landed',
  },
  {
    id: 'regex_script',
    regularity: 'Imported ST regex scripts (findRegex/replaceString/disabled/promptOnly/markdownOnly/placement/trimStrings) run before generic passes; markdownOnly first; placement filters by role.',
    writePath: 'regex-engine.js getRegexedString / runRegexScript / filterString',
    layer: 'human',
    status: 'landed',
  },
  {
    id: 'imported_regex',
    regularity: 'User-imported regex JSON is a human-maintained rule list, not a detector.',
    writePath: 'regex-engine.js script object; UI import',
    layer: 'human',
    status: 'landed',
  },
  {
    id: 'owner_blocklist',
    regularity: 'Owner manual/auto blocklists are a human-maintained word set after tokenize.',
    writePath: 'n/a (this repo); applied in analyze.ts',
    layer: 'human',
    status: 'landed',
  },
  {
    id: 'files_meta',
    regularity: 'extra.files[].name is metadata; after fileLength slice it is not in mes.',
    writePath: 'chats.js extra.files',
    layer: 'parse',
    status: 'deferred',
    deferReason: 'Names are not in mes once fileLength is sliced; listing them is a feature, not a cloud leak.',
  },
  {
    id: 'names_force_prefix',
    regularity: 'instruct names_behavior FORCE prepends `Name: ` to every line.',
    writePath: 'instruct-mode.js names_behavior',
    layer: 'detector',
    status: 'deferred',
    deferReason: 'Same shape as dialogue (speaker：line). Stripping needs a speaker dictionary and would eat story speech. Not a scaffolding-token leak.',
  },
] as const satisfies readonly ShapeClass[];

export type ShapeId = (typeof SHAPE_CATALOG)[number]['id'];

export function landedShapeIds(): ShapeId[] {
  return SHAPE_CATALOG.filter((c) => c.status === 'landed').map((c) => c.id);
}

export function deferredShapeIds(): ShapeId[] {
  return SHAPE_CATALOG.filter((c) => c.status === 'deferred').map((c) => c.id);
}
