/**
 * i18n markers for layers below the UI (core / theme / worker / server).
 *
 * `zh()` marks a user-visible Chinese source string so test/i18n.test.ts collects
 * it and requires an English entry; at runtime it is the identity function.
 *
 * `UserText` carries dynamic values across the worker/server boundary: either a
 * plain zh()-marked string, or a `{ key, params }` template that the UI renders
 * through t(). Worker progress and parse warnings use it so numbers and file
 * names stay out of the translation keys.
 */

/** Identity; exists only so the scanner sees the literal. Argument must be a string literal. */
export const zh = <S extends string>(s: S): S => s;

export interface TextTpl {
  /** zh() literal template with {name} placeholders. */
  key: string;
  params?: Record<string, TplParam>;
  /** Leading context shown verbatim (usually a file name); rendered as "src: message". */
  src?: string;
}

/** A param is shown verbatim, translated when it is itself a zh() string, or resolved when nested. */
export type TplParam = string | number | TextTpl;

export type UserText = string | TextTpl;

/**
 * A character count for the `… 万字` templates, formatted for the language that
 * will render them. Chinese counts in 万 because the key carries that unit;
 * English has no ×10,000 unit, so it counts in thousands — "5.2 万字" and
 * "52k characters" are the same number. The value has to be chosen here rather
 * than in the dictionary: no substitution can turn "5.2" into "52".
 */
export function tenKCount(chars: number, lang: 'zh' | 'en'): string {
  if (lang === 'zh') return (chars / 1e4).toFixed(1);
  const k = chars / 1000;
  if (k >= 1000) return `${(k / 1000).toFixed(1)}M`;
  return `${k < 10 ? k.toFixed(1) : Math.round(k)}k`;
}

/** {name} placeholder substitution, same rule as the UI's translate(). */
export function fill(tpl: string, params?: Record<string, string | number>): string {
  if (!params) return tpl;
  return tpl.replace(/\{(\w+)\}/g, (m, k: string) => (k in params ? String(params[k]) : m));
}

/**
 * Render a UserText in Chinese, without the UI dictionary. For tests, CLI tools
 * and server logs, where no language setting exists. Nested params resolve
 * recursively; a `src` prefix renders as "src：message".
 */
export function toZh(value: UserText): string {
  if (typeof value === 'string') return value;
  const params = value.params && Object.fromEntries(
    Object.entries(value.params).map(([k, v]) => [k, typeof v === 'object' ? toZh(v) : v]),
  );
  const s = fill(value.key, params);
  return value.src ? `${value.src}：${s}` : s;
}
