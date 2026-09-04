import type { CleanOptions } from './types';
import { applyRules } from './regexScripts';
import { stripInstructLines } from './instructLines';

export const DEFAULT_CLEAN_OPTIONS: CleanOptions = {
  stripCustomTags: true,
  stripCodeBlocks: true,
  stripStructuredLines: true,
  stripOOC: true,
};

/**
 * Standard HTML tags. Any other tag is treated as plugin markup and removed
 * together with its content (allowlist rather than blocklist).
 */
const HTML_TAGS = new Set([
  'a', 'abbr', 'b', 'bdi', 'bdo', 'big', 'blockquote', 'br', 'caption', 'center',
  'cite', 'code', 'col', 'colgroup', 'dd', 'del', 'details', 'dfn', 'div', 'dl',
  'dt', 'em', 'figcaption', 'figure', 'font', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'hr', 'i', 'img', 'ins', 'kbd', 'label', 'li', 'mark', 'ol', 'p', 'pre', 'q',
  'rp', 'rt', 'ruby', 's', 'samp', 'section', 'small', 'span', 'strike', 'strong',
  'sub', 'summary', 'sup', 'table', 'tbody', 'td', 'tfoot', 'th', 'thead', 'time',
  'tr', 'tt', 'u', 'ul', 'var', 'wbr',
]);

function isCustomTag(tag: string): boolean {
  return !HTML_TAGS.has(tag.toLowerCase());
}

/** One Unicode letter. Plugin tag names are not limited to ASCII (`<状态栏>`). */
const LETTER_ONE = /^\p{L}$/u;

function isTagNameStart(code: number): boolean {
  if (code < 128) {
    return code === 95 || code === 58
      || (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
  }
  return LETTER_ONE.test(String.fromCharCode(code));
}

function isTagNameCont(code: number): boolean {
  if (code < 128) {
    return isTagNameStart(code)
      || (code >= 48 && code <= 57)
      || code === 46 || code === 45;
  }
  return isTagNameStart(code);
}

function isNameDelimiter(code: number): boolean {
  return code === 62 || code === 47 || code === 32 || code === 9 || code === 10 || code === 13;
}

interface MarkupTag {
  start: number;
  end: number;
  name: string;
  closing: boolean;
  selfClosing: boolean;
}

/**
 * Read a markup tag at `i` (`s[i]` must be `<`). Linear: no `>` after this
 * opener means no later opener can complete a tag either (`incomplete`).
 * A name must stop at space / `/` / `>` so `<状态栏：…` is not a tag.
 */
function readTag(s: string, i: number): MarkupTag | 'incomplete' | null {
  if (s.charCodeAt(i) !== 60) return null;
  const len = s.length;
  let j = i + 1;
  if (j >= len) return 'incomplete';
  const closing = s.charCodeAt(j) === 47;
  if (closing) j++;
  if (j >= len) return 'incomplete';
  const c0 = s.charCodeAt(j);
  if (c0 === 33 || c0 === 63) return null;
  if (!isTagNameStart(c0)) return null;
  const nameStart = j;
  j++;
  while (j < len && isTagNameCont(s.charCodeAt(j))) j++;
  if (j >= len) return 'incomplete';
  if (!isNameDelimiter(s.charCodeAt(j))) return null;
  const name = s.slice(nameStart, j);
  const gt = s.indexOf('>', j);
  if (gt < 0) return 'incomplete';
  const selfClosing = !closing && gt > j && s.charCodeAt(gt - 1) === 47;
  return { start: i, end: gt + 1, name, closing, selfClosing };
}

function nextTag(s: string, from: number): MarkupTag | 'incomplete' | null {
  let i = from;
  while (i < s.length) {
    const lt = s.indexOf('<', i);
    if (lt < 0) return null;
    const t = readTag(s, lt);
    if (t === 'incomplete') return 'incomplete';
    if (t) return t;
    i = lt + 1;
  }
  return null;
}

const ENTITIES: Record<string, string> = {
  '&nbsp;': ' ', '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"',
  '&#39;': "'", '&apos;': "'", '&mdash;': '—', '&ndash;': '–', '&hellip;': '…',
  '&ldquo;': '“', '&rdquo;': '”', '&lsquo;': '‘', '&rsquo;': '’',
};

function codePoint(n: number): string {
  if (!Number.isInteger(n) || n < 0 || n > 0x10ffff) return ' ';
  try { return String.fromCodePoint(n); } catch { return ' '; }
}

function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-fA-F]+);/gi, (_, h: string) => codePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d: string) => codePoint(Number(d)))
    .replace(/&[a-zA-Z][a-zA-Z0-9]*;/g, (m) => ENTITIES[m] ?? ENTITIES[m.toLowerCase()] ?? ' ');
}

/** Paired custom tags may nest; repeat until stable, with an iteration cap. */
function stripPairedCustomTags(input: string): string {
  let text = input;
  for (let pass = 0; pass < 6; pass++) {
    let changed = false;
    const parts: string[] = [];
    let last = 0;
    let i = 0;
    while (i < text.length) {
      const open = nextTag(text, i);
      if (!open || open === 'incomplete') break;
      if (open.closing || open.selfClosing || !isCustomTag(open.name)) {
        i = open.end;
        continue;
      }
      const openName = open.name.toLowerCase();
      let j = open.end;
      let close: MarkupTag | null = null;
      while (j < text.length) {
        const t = nextTag(text, j);
        if (!t || t === 'incomplete') break;
        if (t.closing && t.name.toLowerCase() === openName) {
          close = t;
          break;
        }
        j = t.end;
      }
      if (!close) {
        i = open.end;
        continue;
      }
      parts.push(text.slice(last, open.start), ' ');
      last = close.end;
      i = close.end;
      changed = true;
    }
    if (!changed) return text;
    parts.push(text.slice(last));
    text = parts.join('');
  }
  return text;
}

/**
 * Mirror of the dangling-open-tag rule: a closing custom tag with no matching
 * opening tag means the message *starts* inside a block (a reasoning trace or a
 * status template whose opening tag was cut off, e.g. `…</status_vars>… </think>正文`).
 * Everything up to and including the last such orphan is scaffolding, not speech.
 * Standard HTML closing tags are ignored, so a stray `</b>` never truncates prose.
 */
function stripOrphanClosingTag(input: string): string {
  const open = new Map<string, number>();
  let cut = -1;
  let i = 0;
  while (i < input.length) {
    const t = nextTag(input, i);
    if (!t || t === 'incomplete') break;
    const tag = t.name.toLowerCase();
    if (isCustomTag(tag)) {
      if (t.closing) {
        const n = open.get(tag) ?? 0;
        if (n > 0) open.set(tag, n - 1);
        else cut = t.end;
      } else if (!t.selfClosing) {
        open.set(tag, (open.get(tag) ?? 0) + 1);
      }
    }
    i = t.end;
  }
  return cut >= 0 ? input.slice(cut) : input;
}

/** Remove an unclosed custom tag and everything after it (truncated output, mismatched closing tag). */
function stripDanglingCustomTag(input: string): string {
  let i = 0;
  while (i < input.length) {
    const t = nextTag(input, i);
    if (!t || t === 'incomplete') return input;
    if (t.closing) { i = t.end; continue; }
    if (isCustomTag(t.name)) return input.slice(0, t.start);
    return input;
  }
  return input;
}

/*
 * Structural tests for "this line is code, not prose": indentation, semicolons,
 * braces, selector shapes. Language-independent.
 */
const CSS_DECL = /^[a-zA-Z-]{2,30}\s*:\s*[^;{}]{1,160};$/;
const CSS_SELECTOR = /^[.#@][^{}\n]{0,160}\{$/;
const CSS_SELECTOR_TAG = /^[a-zA-Z][\w .#:,()[\]="'>~+*-]{0,160}\{$/;
const CSS_KEYFRAME_STOP = /^(from|to|\d{1,3}%)\s*\{$/;
const BRACE_ONLY = /^[{}[\]();,]+$/;
const JS_START = /^(function\b|const\b|let\b|var\b|return\b|import\b|export\b|if\s*\(|else\b|for\s*\(|while\s*\(|switch\s*\(|try\b|catch\s*\(|\$\(|[\w$]+\.[\w$]+\s*\(|\/\/|\/\*)/;
const HAS_CJK = /[\u3400-\u9fff\uf900-\ufaff\u3040-\u30ff]/;

function looksLikeCode(line: string): boolean {
  const t = line.trim();
  if (!t || t.length > 200) return false;
  // Lines with CJK are always prose; code lines with CJK strings are caught by the run rule.
  if (HAS_CJK.test(t)) return false;
  if (CSS_DECL.test(t) || CSS_SELECTOR.test(t) || CSS_KEYFRAME_STOP.test(t)) return true;
  if (BRACE_ONLY.test(t)) return true;
  if (CSS_SELECTOR_TAG.test(t) && /[.#:[]/.test(t)) return true;
  // A JS keyword alone is not enough ("return to the room."); the line must also end like code.
  if (JS_START.test(t) && /[;{})]$/.test(t)) return true;
  return false;
}

/** Remove runs of 3+ consecutive code-like lines. Single code-like lines are kept. */
/**
 * Bare JSON blocks written into message text without any tag.
 * A balanced `{`/`[` region that `JSON.parse` accepts is removed as a whole.
 */
export function stripJsonBlocks(text: string): string {
  if (!/[[{]\s*[{"[]/.test(text)) return text;
  let out = '';
  let i = 0;
  /**
   * Every opening bracket used to start its own full scan, so a wall of `[[[[…`
   * cost O(n²) — 200 k brackets froze the tab. When a scan fails without the
   * nesting depth ever decreasing, no later start inside what it covered can
   * balance either (depth never revisits an earlier value), so the whole scanned
   * span is skipped. Failures that did see the depth come back down are not
   * memoized, so a real `[[ {…} ]` is still found.
   */
  let skipUntil = -1;
  while (i < text.length) {
    const ch = text[i];
    if (i > skipUntil && (ch === '{' || ch === '[') && /[{"[]/.test(text.slice(i + 1, i + 4).trim()[0] ?? '')) {
      const m = matchBracket(text, i);
      if (m.end > i + 20) {
        const slice = text.slice(i, m.end + 1);
        try {
          const v = JSON.parse(slice) as unknown;
          if (v && typeof v === 'object') { out += ' '; i = m.end + 1; continue; }
        } catch { /* not JSON; keep */ }
      } else if (m.end < 0 && m.monotonic) {
        skipUntil = m.scannedTo;
      }
    }
    out += ch; i++;
  }
  return out;
}

/**
 * Index of the bracket matching text[start] as `end` (-1 when there is none).
 * Brackets inside strings are skipped. `scannedTo` is how far the scan got and
 * `monotonic` says the depth never decreased — see the memo in `stripJsonBlocks`.
 */
function matchBracket(text: string, start: number): { end: number; scannedTo: number; monotonic: boolean } {
  let depth = 0, inStr = false, monotonic = true;
  let i = start;
  for (; i < text.length; i++) {
    const c = text[i];
    if (inStr) { if (c === '\\') i++; else if (c === '"') inStr = false; continue; }
    if (c === '"') inStr = true;
    else if (c === '{' || c === '[') depth++;
    else if (c === '}' || c === ']') {
      monotonic = false;
      depth--;
      if (depth === 0) return { end: i, scannedTo: i, monotonic: false };
    }
    if (i - start > 200_000) return { end: -1, scannedTo: i, monotonic };
  }
  return { end: -1, scannedTo: i, monotonic };
}

function stripCodeBlocks(text: string): string {
  const lines = text.split('\n');
  const code = lines.map(looksLikeCode);
  const drop = new Array<boolean>(lines.length).fill(false);
  let i = 0;
  while (i < lines.length) {
    if (!code[i]) { i++; continue; }
    let j = i;
    while (j < lines.length && (code[j] || lines[j].trim() === '')) j++;
    // Trailing blank lines are not counted as code.
    let last = j - 1;
    while (last > i && lines[last].trim() === '') last--;
    let count = 0;
    for (let k = i; k <= last; k++) if (code[k]) count++;
    if (count >= 3) for (let k = i; k <= last; k++) drop[k] = true;
    i = j;
  }
  return lines.filter((_, k) => !drop[k]).join('\n');
}

/** <details> blocks whose <summary> is a scaffolding label (summary, thinking, status, options ...). */
const META_SUMMARY = /^(?:摘要|总结|小结|思考|思维|状态|选项|设定|变量|记忆|大纲|梳理|回顾|提示|summary|thinking|thoughts?|status|options?|memo|variables?|notes?)/i;
function stripMetaDetails(text: string): string {
  return text.replace(/<details\b[^>]*>\s*<summary\b[^>]*>([\s\S]*?)<\/summary>([\s\S]*?)<\/details>/gi,
    (m, label: string) => (META_SUMMARY.test(label.replace(/<[^>]+>/g, '').trim()) ? ' ' : m));
}

/**
 * Status blocks written as plain key/value lines (时间：… / 地点：… / 好感：…).
 * A run of 3+ lines with distinct labels, at least one of which is a known status
 * field, is removed. Dialogue in "speaker: line" form repeats labels and has none
 * of these fields, so it is kept.
 */
const KV_LINE = /^\s*(?:[-*•▪◆●]\s*)?[「【[]?([^：:\n]{1,12}?)[」】\]]?\s*[：:]\s*(.{0,80})$/;
const STATUS_FIELD = /时间|日期|地点|位置|天气|季节|温度|状态|心情|情绪|好感|信任|体力|精力|金钱|金币|资金|穿着|服装|衣着|姓名|关系|进度|目标|任务|等级|经验|数值|属性|称呼|身份|年龄|职业|物品|道具|背包|技能|事件|阶段|回合|轮次|章节|看法|想法|HP|MP|SAN/i;
const NUMERIC_VALUE = /^[\d./:%+\-~\s]+$/;
const ENUM_VALUE = /^(true|false|yes|no|on|off|none|null|n\/a|unknown|待定|无|平静|健康)$/i;

function isNumericStatusValue(v: string): boolean {
  const t = v.trim();
  return NUMERIC_VALUE.test(t) || ENUM_VALUE.test(t);
}

function isStatusRun(labels: string[], values: string[]): boolean {
  if (labels.length < 3) return false;
  if (new Set(labels).size !== labels.length) return false;
  if (labels.some((l) => STATUS_FIELD.test(l))) return true;
  const numeric = values.filter(isNumericStatusValue).length;
  return numeric >= 2 && values.every((v) => v.trim().length <= 24 && !/[。！？]/.test(v));
}

function stripStatusBlocks(text: string): string {
  const lines = text.split('\n');
  const drop = new Array<boolean>(lines.length).fill(false);
  let i = 0;
  while (i < lines.length) {
    const labels: string[] = [];
    const values: string[] = [];
    let j = i;
    while (j < lines.length) {
      // Status lines are short. Running KV_LINE on a 10 k-space line is ReDoS
      // (`^\s*` backtracks against a capture that also matches spaces).
      if (lines[j].length > 200) break;
      const m = KV_LINE.exec(lines[j]);
      if (!m) break;
      labels.push(m[1].trim());
      values.push(m[2]);
      j++;
    }
    if (isStatusRun(labels, values)) {
      for (let k = i; k < j; k++) drop[k] = true;
    }
    i = Math.max(j, i + 1);
  }
  return lines.filter((_, k) => !drop[k]).join('\n');
}

/**
 * Bracket-labelled status headers written without a colon:
 *   [当前时间] 2008-08-08 周五 22:10
 *   [当前地点] 中国-北京-朝阳区某居民楼
 * The bracketed label carries the structure, so two consecutive lines are enough
 * (a plain `key: value` run still needs three — dialogue looks like that, this does not).
 * Labels must be distinct and at least one must be a known status field, so a run of
 * `[高飞] 台词` speaker lines is kept.
 */
const BRACKET_LABEL_LINE = /^\s*[[【]([^\][【】\s:：]{1,12})[\]】]\s*[:：]?\s+\S.{0,120}$/;
function stripBracketStatusBlocks(text: string): string {
  const lines = text.split('\n');
  const drop = new Array<boolean>(lines.length).fill(false);
  let i = 0;
  while (i < lines.length) {
    const labels: string[] = [];
    let j = i;
    for (; j < lines.length && lines[j].length <= 200; ) {
      const m = BRACKET_LABEL_LINE.exec(lines[j]);
      if (!m) break;
      labels.push(m[1].trim());
      if (++j >= lines.length) break;
    }
    if (j - i >= 2 && new Set(labels).size === labels.length && labels.some((l) => STATUS_FIELD.test(l))) {
      for (let k = i; k < j; k++) drop[k] = true;
    }
    i = Math.max(j, i + 1);
  }
  return lines.filter((_, k) => !drop[k]).join('\n');
}

/** Status-bar / table style lines. */
/**
 * Historical wi_format wrap: a line opens `[` / `【`, contains a colon, is not
 * closed on this line, and a later line is only `]` / `】`. Narrative
 * `[他停顿了很久` has no colon and is kept.
 */
function stripWrappedBracketBlocks(text: string): string {
  if (!/[[【]/.test(text)) return text;
  const lines = text.split('\n');
  const drop = new Array<boolean>(lines.length).fill(false);
  for (let i = 0; i < lines.length; i++) {
    if (drop[i]) continue;
    const t = lines[i];
    if (!/^\s*[[【]/.test(t) || /[\]】]/.test(t) || !/[:：]/.test(t)) continue;
    let j = i + 1;
    while (j < lines.length && !/^\s*[\]】]\s*$/.test(lines[j])) j++;
    if (j < lines.length && j - i >= 2) {
      for (let k = i; k <= j; k++) drop[k] = true;
    }
  }
  return drop.some(Boolean) ? lines.filter((_, k) => !drop[k]).join('\n') : text;
}

/** After HTML tags are stripped: ≥3 adjacent `token number` lines are a panel. */
const PANEL_LINE = /^\s*(?:[\p{L}\p{N}_-]{1,20}\s+)+\d{1,5}\s*$/u;
function stripNumericPanelLines(text: string): string {
  const lines = text.split('\n');
  const hit = lines.map((l) => PANEL_LINE.test(l));
  const drop = new Array<boolean>(lines.length).fill(false);
  let i = 0;
  while (i < lines.length) {
    if (!hit[i]) { i++; continue; }
    let j = i;
    while (j < lines.length && hit[j]) j++;
    if (j - i >= 3) for (let k = i; k < j; k++) drop[k] = true;
    i = j;
  }
  return drop.some(Boolean) ? lines.filter((_, k) => !drop[k]).join('\n') : text;
}

/** ≥3 indented `key: value` lines (YAML / dump). A single indented sentence is kept. */
const INDENTED_KV = /^\s{2,}[^\s#:-][^:\n]{0,40}:\s+\S.{0,60}$/;
function stripIndentedKvRuns(text: string): string {
  const lines = text.split('\n');
  const hit = lines.map((l) => l.length <= 200 && INDENTED_KV.test(l));
  const drop = new Array<boolean>(lines.length).fill(false);
  let i = 0;
  while (i < lines.length) {
    if (!hit[i]) { i++; continue; }
    let j = i;
    while (j < lines.length && (hit[j] || lines[j].trim() === '')) j++;
    let last = j - 1;
    while (last > i && lines[last].trim() === '') last--;
    let n = 0;
    for (let k = i; k <= last; k++) if (hit[k]) n++;
    if (n >= 3) for (let k = i; k <= last; k++) drop[k] = true;
    i = j;
  }
  return drop.some(Boolean) ? lines.filter((_, k) => !drop[k]).join('\n') : text;
}

/** `::` / `:::` container fences at column 0. Linear: no `*?` over the whole file. */
function stripColonFences(text: string): string {
  if (!text.includes('::')) return text;
  const lines = text.split('\n');
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    if (/^:{2,}/.test(lines[i])) {
      let j = i + 1;
      while (j < lines.length && !/^:{2,}/.test(lines[j])) j++;
      if (j < lines.length) { out.push(' '); i = j + 1; continue; }
      break;
    }
    out.push(lines[i]);
    i++;
  }
  return out.join('\n');
}

function isStructuredLine(line: string): boolean {
  const t = line.trim();
  if (!t) return false;
  const pipes = (t.match(/\|/g) || []).length;
  if (pipes >= 2 && (t.startsWith('|') || /[[{]/.test(t))) return true;
  if (/^[|+\-=:\s]+$/.test(t) && t.length > 3) return true;   // table separator
  if (/^\s*[[{【][^\]}】]{0,40}[\]}】]\s*$/.test(t)) return true; // bare [title] line
  return false;
}

/**
 * Reduce a raw message to the text that was actually said or written.
 * Order matters: whole blocks first, inline markup next, whitespace last.
 */
/**
 * Per-turn input wrappers injected by presets: when a wrapper tag around the user's
 * own input is recognized, only its content is kept and the surrounding framing is dropped.
 * Detection is by tag name, which is stable per preset.
 */
const INPUT_WRAPPER = /<((?:[^<>\s/]*?)(?:用户输入|本轮输入|user[_-]?input|current[_-]?input|player[_-]?input)(?:[^<>\s/]*?))>([\s\S]*?)<\/\1>/i;

/** Keep only the content of the input wrapper; return the input unchanged when there is none. */
export function unwrapUserInput(input: string): string {
  const m = INPUT_WRAPPER.exec(input);
  return m ? m[2].trim() : input;
}

/**
 * SillyTavern `{{macros}}`. Linear: if `}}` never appears, later `{{` cannot close either.
 */
function stripStMacros(text: string): string {
  let out = '';
  let i = 0;
  let skipUntil = -1;
  while (i < text.length) {
    if (i > skipUntil && text[i] === '{' && text[i + 1] === '{') {
      const close = text.indexOf('}}', i + 2);
      if (close < 0) { skipUntil = text.length; }
      else { out += ' '; i = close + 2; continue; }
    }
    out += text[i]; i++;
  }
  return out;
}

/**
 * `![alt](url)` → space, `[text](url)` → text. Linear: a scan that finds no `]`,
 * or a `]` that is not `](`, cannot complete a link for any `[` before that `]`.
 */
export function stripMarkdownLinks(text: string): string {
  let out = '';
  let i = 0;
  let skipUntil = -1;
  while (i < text.length) {
    const img = text[i] === '!' && text[i + 1] === '[';
    if ((img || text[i] === '[') && i > skipUntil) {
      const open = img ? i + 1 : i;
      const rb = text.indexOf(']', open + 1);
      if (rb < 0) {
        skipUntil = text.length;
      } else if (text[rb + 1] === '(') {
        const rp = text.indexOf(')', rb + 2);
        if (rp >= 0) {
          out += img ? ' ' : text.slice(open + 1, rb);
          i = rp + 1;
          continue;
        }
        skipUntil = rb;
      } else {
        skipUntil = rb;
      }
    }
    out += text[i]; i++;
  }
  return out;
}

/**
 * Replace `open…close` runs with a space. Built from `indexOf`/`split` so a
 * wall of delimiters is linear (per-char `+=` plus overlapping ``` was seconds).
 */
function stripDelimited(text: string, open: string, close: string): string {
  if (open === close) {
    const parts = text.split(open);
    if (parts.length === 1) return text;
    const out: string[] = [parts[0]];
    for (let k = 1; k < parts.length; k += 2) {
      if (k + 1 < parts.length) { out.push(' '); out.push(parts[k + 1]); }
      else { out.push(open); out.push(parts[k]); }
    }
    return out.join('');
  }
  const out: string[] = [];
  let last = 0;
  let i = 0;
  while (i < text.length) {
    const start = text.indexOf(open, i);
    if (start < 0) break;
    const end = text.indexOf(close, start + open.length);
    if (end < 0) break;
    out.push(text.slice(last, start), ' ');
    last = end + close.length;
    i = last;
  }
  out.push(text.slice(last));
  return out.join('');
}

/** Strip `<…>` from positions where `at` is true. No `>` ahead → later openers cannot close. */
function stripUntilGt(text: string, at: (s: string, i: number) => boolean): string {
  let out = '';
  let i = 0;
  let skipUntil = -1;
  while (i < text.length) {
    if (i > skipUntil && at(text, i)) {
      const gt = text.indexOf('>', i + 1);
      if (gt < 0) { skipUntil = text.length; }
      else { out += ' '; i = gt + 1; continue; }
    }
    out += text[i]; i++;
  }
  return out;
}

function stripHtmlTags(text: string): string {
  return stripUntilGt(text, (s, i) => {
    if (s.charCodeAt(i) !== 60) return false;
    const next = s.charCodeAt(i + 1);
    if (next === 47) return i + 2 < s.length && isTagNameStart(s.charCodeAt(i + 2));
    return isTagNameStart(next);
  });
}

const OOC_HEAD = /^[[(（【]\s*OOC\s*[:：]/i;
const OOC_CLOSE: Record<string, string> = { '[': ']', '(': ')', '（': '）', '【': '】' };

function stripOoc(text: string): string {
  let out = '';
  let i = 0;
  let skipUntil = -1;
  while (i < text.length) {
    const closer = OOC_CLOSE[text[i]];
    if (closer && i > skipUntil && OOC_HEAD.test(text.slice(i, i + 16))) {
      const end = text.indexOf(closer, i + 4);
      if (end < 0) { skipUntil = text.length; }
      else { out += ' '; i = end + 1; continue; }
    }
    out += text[i]; i++;
  }
  return out;
}

function unwrapBackticks(text: string): string {
  let out = '';
  let i = 0;
  let skipUntil = -1;
  while (i < text.length) {
    if (i > skipUntil && text[i] === '`') {
      const close = text.indexOf('`', i + 1);
      if (close < 0) { skipUntil = text.length; }
      else { out += text.slice(i + 1, close); i = close + 1; continue; }
    }
    out += text[i]; i++;
  }
  return out;
}

export interface CleanContext {
  /** SillyTavern regex_placement (1 user / 2 AI / 6 reasoning). Omit = do not filter. */
  placement?: number;
}

export function cleanMessageText(
  input: string,
  opts: CleanOptions = DEFAULT_CLEAN_OPTIONS,
  ctx?: CleanContext,
): string {
  if (!input) return '';
  // Must run first: the allowlist pass would otherwise remove the wrapper tag with its content.
  let t = unwrapUserInput(input);
  // Preset-specific rules (regex scripts) know the exact markup; they run before the generic passes
  t = applyRules(t, opts.customRules, ctx?.placement);

  t = stripDelimited(t, '<!--', '-->');
  // <!DOCTYPE ...> / <?xml ...?> — a wall of `<!` with no `>` is linear (see stripUntilGt).
  t = stripUntilGt(t, (s, i) => s[i] === '<' && (s[i + 1] === '!' || s[i + 1] === '?'));

  t = stripJsonBlocks(t);

  if (opts.stripCodeBlocks) {
    t = stripDelimited(t, '```', '```');
    t = stripDelimited(t, '~~~', '~~~');
  }

  // Cheap exit: a delimiter wall may have collapsed to whitespace already.
  if (t.length > 0 && !/[^\s]/.test(t)) return '';

  // Inline base64 images would tokenize into junk; remove before segmentation.
  t = t.replace(/data:[a-zA-Z0-9.+-]+\/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=\s]+/g, ' ');
  t = t.replace(/\b[A-Za-z0-9+/]{120,}={0,2}\b/g, ' ');

  if (opts.stripCustomTags) {
    // <style>/<script>: remove to the end even when unclosed.
    t = t.replace(/<(style|script)\b[\s\S]*?(<\/\1\s*>|$)/gi, ' ');
    if (t.includes('<details')) t = stripMetaDetails(t);
    // No `/>` / `</` in the text means these regexes cannot complete a match,
    // but they would still scan from every `<` (O(n²) on a wall of `<a`).
    if (t.includes('/>')) {
      const parts: string[] = [];
      let last = 0;
      let i = 0;
      while (i < t.length) {
        const tag = nextTag(t, i);
        if (!tag || tag === 'incomplete') break;
        if (tag.selfClosing && isCustomTag(tag.name)) {
          parts.push(t.slice(last, tag.start), ' ');
          last = tag.end;
        }
        i = tag.end;
      }
      parts.push(t.slice(last));
      t = parts.join('');
    }
    if (t.includes('</')) {
      t = stripPairedCustomTags(t);
      t = stripOrphanClosingTag(t);
    }
    if (t.includes('>')) t = stripDanglingCustomTag(t);
  }

  t = stripColonFences(t);
  t = stripInstructLines(t);

  // Remaining (standard HTML) tags: strip the tag, keep the text.
  t = stripHtmlTags(t);
  t = decodeEntities(t);

  if (opts.stripOOC) t = stripOoc(t);

  // Macros, images, links, URLs. Markdown `[text](url)` used to be a regex
  // whose `[^\]]*` retried from every `[` — a wall of brackets was O(n²).
  t = stripStMacros(t);
  t = stripMarkdownLinks(t);
  t = t.replace(/\bhttps?:\/\/\S+/gi, ' ');
  t = t.replace(/\b[\w.+-]+@[\w-]+\.[\w.]+\b/g, ' ');
  t = unwrapBackticks(t);

  if (opts.stripCodeBlocks) {
    // 放在标签处理之后：先把 <style>/<script> 整块拿掉，
    // 剩下的裸 CSS/JS 再交给行级判据。
    t = stripCodeBlocks(t);
  }

  if (opts.stripStructuredLines) {
    t = stripStatusBlocks(t);
    t = stripBracketStatusBlocks(t);
    t = stripWrappedBracketBlocks(t);
    t = stripNumericPanelLines(t);
    t = stripIndentedKvRuns(t);
    t = t.split('\n').filter((l) => !isStructuredLine(l)).join('\n');
  }

  // markdown 强调符号：去符号留字（*动作* 在酒馆里是叙述，正文要留）
  t = t.replace(/^\s{0,3}#{1,6}\s+/gm, ' ');
  t = t.replace(/^\s{0,3}>\s?/gm, ' ');
  t = t.replace(/[*_~`]+/g, ' ');
  t = t.replace(/^\s{0,3}[-+]\s+/gm, ' ');

  return t.replace(/[ \t ]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * Lines that repeat across many messages are template scaffolding (headers,
 * status labels, option prompts), not conversation. A line of 6+ characters
 * found in at least `ratio` of the messages (and at least `min` messages) is
 * removed from all of them. Requires the whole batch.
 */
export function stripRepeatedLines(texts: string[], ratio = 0.25, min = 5): string[] {
  if (texts.length < min) return texts;
  const perLine = new Map<string, number>();
  for (const t of texts) {
    const seen = new Set<string>();
    for (const raw of t.split('\n')) {
      const line = raw.trim();
      if (line.length < 6 || seen.has(line)) continue;
      seen.add(line); perLine.set(line, (perLine.get(line) ?? 0) + 1);
    }
  }
  const threshold = Math.max(min, Math.ceil(texts.length * ratio));
  const drop = new Set([...perLine].filter(([, n]) => n >= threshold).map(([l]) => l));
  if (drop.size === 0) return texts;
  return texts.map((t) => t.split('\n').filter((l) => !drop.has(l.trim())).join('\n'));
}
