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
