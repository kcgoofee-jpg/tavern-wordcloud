import type { CleanOptions } from './types';
import { applyRules } from './regexScripts';

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

const ENTITIES: Record<string, string> = {
  '&nbsp;': ' ', '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"',
  '&#39;': "'", '&apos;': "'", '&mdash;': '—', '&ndash;': '–', '&hellip;': '…',
  '&ldquo;': '“', '&rdquo;': '”', '&lsquo;': '‘', '&rsquo;': '’',
};

function decodeEntities(s: string): string {
  return s
    .replace(/&[a-zA-Z#0-9]+;/g, (m) => ENTITIES[m] ?? ENTITIES[m.toLowerCase()] ?? ' ')
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)));
}

/** Paired custom tags may nest; repeat until stable, with an iteration cap. */
function stripPairedCustomTags(input: string): string {
  const re = /<([A-Za-z_][\w:.-]*)\b[^>]*>([\s\S]*?)<\/\1\s*>/g;
  let text = input;
  for (let pass = 0; pass < 6; pass++) {
    let changed = false;
    const next = text.replace(re, (match, tag: string, inner: string) => {
      if (isCustomTag(tag)) {
        changed = true;
        return ' ';
      }
      return match.length === inner.length ? match : match;
    });
    if (!changed) return next;
    text = next;
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
  const re = /<(\/?)([A-Za-z_][\w:.-]*)\b[^>]*>/g;
  const open = new Map<string, number>();
  let cut = -1;
  for (let m = re.exec(input); m; m = re.exec(input)) {
    const tag = m[2].toLowerCase();
    if (!isCustomTag(tag)) continue;
    if (m[1] === '/') {
      const n = open.get(tag) ?? 0;
      if (n > 0) open.set(tag, n - 1);
      else cut = re.lastIndex;
    } else {
      open.set(tag, (open.get(tag) ?? 0) + 1);
    }
  }
  return cut >= 0 ? input.slice(cut) : input;
}

/** Remove an unclosed custom tag and everything after it (truncated output, mismatched closing tag). */
function stripDanglingCustomTag(input: string): string {
  const m = /<([A-Za-z_][\w:.-]*)\b[^>]*>/.exec(input);
  if (m && isCustomTag(m[1])) return input.slice(0, m.index);
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
function stripJsonBlocks(text: string): string {
  if (!/[[{]\s*[{"[]/.test(text)) return text;
  let out = '';
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if ((ch === '{' || ch === '[') && /[{"[]/.test(text.slice(i + 1, i + 4).trim()[0] ?? '')) {
      const end = matchBracket(text, i);
      if (end > i + 20) {
        const slice = text.slice(i, end + 1);
        try {
          const v = JSON.parse(slice) as unknown;
          if (v && typeof v === 'object') { out += ' '; i = end + 1; continue; }
        } catch { /* not JSON; keep */ }
      }
    }
    out += ch; i++;
  }
  return out;
}

/** Index of the bracket matching text[start], or -1. Skips brackets inside strings. */
function matchBracket(text: string, start: number): number {
  let depth = 0, inStr = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (inStr) { if (c === '\\') i++; else if (c === '"') inStr = false; continue; }
    if (c === '"') inStr = true;
    else if (c === '{' || c === '[') depth++;
    else if (c === '}' || c === ']') { depth--; if (depth === 0) return i; }
    if (i - start > 200_000) return -1;
  }
  return -1;
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
function stripStatusBlocks(text: string): string {
  const lines = text.split('\n');
  const drop = new Array<boolean>(lines.length).fill(false);
  let i = 0;
  while (i < lines.length) {
    const labels: string[] = [];
    let j = i;
    while (j < lines.length) {
      const m = KV_LINE.exec(lines[j]);
      if (!m) break;
      labels.push(m[1].trim()); j++;
    }
    if (j - i >= 3 && new Set(labels).size === labels.length && labels.some((l) => STATUS_FIELD.test(l))) {
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
    for (let m = BRACKET_LABEL_LINE.exec(lines[j]); m; m = BRACKET_LABEL_LINE.exec(lines[j])) {
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

export function cleanMessageText(input: string, opts: CleanOptions = DEFAULT_CLEAN_OPTIONS): string {
  if (!input) return '';
  // Must run first: the allowlist pass would otherwise remove the wrapper tag with its content.
  let t = unwrapUserInput(input);
  // Preset-specific rules (regex scripts) know the exact markup; they run before the generic passes
  t = applyRules(t, opts.customRules);

  t = t.replace(/<!--[\s\S]*?-->/g, ' ');
  // <!DOCTYPE ...> and similar are not matched by the generic tag regex below.
  t = t.replace(/<![^>]*>/g, ' ');
  t = t.replace(/<\?[\s\S]*?\?>/g, ' ');

  t = stripJsonBlocks(t);

  if (opts.stripCodeBlocks) {
    t = t.replace(/```[\s\S]*?```/g, ' ').replace(/~~~[\s\S]*?~~~/g, ' ');
  }

  // Inline base64 images would tokenize into junk; remove before segmentation.
  t = t.replace(/data:[a-zA-Z0-9.+-]+\/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=\s]+/g, ' ');
  t = t.replace(/\b[A-Za-z0-9+/]{120,}={0,2}\b/g, ' ');

  if (opts.stripCustomTags) {
    // <style>/<script>: remove to the end even when unclosed.
    t = t.replace(/<(style|script)\b[\s\S]*?(<\/\1\s*>|$)/gi, ' ');
    t = stripMetaDetails(t);
    // Self-closing custom tags
    t = t.replace(/<([A-Za-z_][\w:.-]*)\b[^>]*\/>/g, (m, tag: string) => (isCustomTag(tag) ? ' ' : m));
    t = stripPairedCustomTags(t);
    t = stripOrphanClosingTag(t);
    t = stripDanglingCustomTag(t);
  }

  // ::: container blocks
  t = t.replace(/^:::[\s\S]*?^:::[^\n]*$/gm, ' ');
  t = t.replace(/^:::[\s\S]*$/m, ' ');

  // Remaining (standard HTML) tags: strip the tag, keep the text.
  t = t.replace(/<\/?[A-Za-z][^>]*>/g, ' ');
  t = decodeEntities(t);

  if (opts.stripOOC) {
    t = t.replace(/[[(（【]\s*(OOC|ooc|Ooc)\s*[:：][\s\S]*?[\])）】]/g, ' ');
  }

  // Macros, images, links, URLs
  t = t.replace(/\{\{[^}]*\}\}/g, ' ');
  t = t.replace(/!\[[^\]]*\]\([^)]*\)/g, ' ');
  t = t.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1');
  t = t.replace(/\bhttps?:\/\/\S+/gi, ' ');
  t = t.replace(/\b[\w.+-]+@[\w-]+\.[\w.]+\b/g, ' ');
  t = t.replace(/`([^`]*)`/g, '$1');

  if (opts.stripCodeBlocks) {
    // 放在标签处理之后：先把 <style>/<script> 整块拿掉，
    // 剩下的裸 CSS/JS 再交给行级判据。
    t = stripCodeBlocks(t);
  }

  if (opts.stripStructuredLines) {
    t = stripStatusBlocks(t);
    t = stripBracketStatusBlocks(t);
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
