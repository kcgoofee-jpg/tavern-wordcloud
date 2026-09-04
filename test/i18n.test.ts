/**
 * Translation completeness. Chinese source strings are the keys, so a changed
 * string silently loses its translation; this test scans every `t('…')` call
 * site and fails on missing English. Call sites must use literal arguments.
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { englishKeys, translate, detectLang } from '../src/ui/i18n';

const ROOT = process.cwd();
const UI = path.join(ROOT, 'src', 'ui');
/** Layers below the UI mark user-visible Chinese with zh('…') (src/core/zh.ts); those literals are dictionary keys too. */
const LOWER = ['src/core', 'src/theme', 'src/worker', 'src/net', 'src/share', 'server'].map((d) => path.join(ROOT, d));
// Recursive: panels and hooks live in subdirectories
const walk = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
  const p = path.join(dir, e.name);
  if (e.isDirectory()) return walk(p);
  return (e.name.endsWith('.tsx') || (e.name.endsWith('.ts') && e.name !== 'i18n.ts')) ? [p] : [];
});
const sources = walk(UI)
  .map((p) => ({ file: path.relative(UI, p), text: fs.readFileSync(p, 'utf8') }));
const lowerSources = LOWER.filter((d) => fs.existsSync(d)).flatMap(walk)
  .filter((p) => !p.endsWith(path.join('core', 'zh.ts')))
  .map((p) => ({ file: path.relative(ROOT, p), text: fs.readFileSync(p, 'utf8') }));

/** Collect the literal arguments of `t('…')` / `t("…")` calls, with comments stripped first. */
function stripComments(text: string): string {
  return text
    // Block comments become the same number of newlines so line numbers are preserved
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ''))
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

function callSites(raw: string, fn = 't'): string[] {
  const text = stripComments(raw);
  const out: string[] = [];
  for (const m of text.matchAll(new RegExp(`\\b${fn}\\(\\s*(['"])((?:(?!\\1)[^\\\\]|\\\\.)*)\\1\\s*[,)]`, 'g'))) {
    out.push(m[2].replace(/\\'/g, "'").replace(/\\"/g, '"'));
  }
  return out;
}

/** zh('…') literals in the lower layers: keys the UI resolves through tx()/txv(). */
const zhSites = (): string[] => lowerSources.flatMap((s) => callSites(s.text, 'zh'));

describe('UI translation', () => {
  it('every t() call has English', () => {
    const known = new Set(englishKeys());
    const missing: string[] = [];
    for (const { file, text } of sources) {
      for (const key of callSites(text)) {
        if (!known.has(key)) missing.push(`${file}: ${key}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it('every zh() literal below the UI has English', () => {
    const known = new Set(englishKeys());
    const missing: string[] = [];
    for (const { file, text } of lowerSources) {
      for (const key of callSites(text, 'zh')) {
        if (!known.has(key)) missing.push(`${file}: ${key}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it('zh() arguments must be literals', () => {
    const bad: string[] = [];
    for (const { file, text } of lowerSources) {
      for (const m of stripComments(text).matchAll(/\bzh\(\s*([^'")\s][^),]*)\)/g)) {
        bad.push(`${file}: zh(${m[1].slice(0, 40)})`);
      }
      for (const m of stripComments(text).matchAll(/\bzh\(\s*`/g)) bad.push(`${file}: zh(\`…\`) at ${m.index}`);
    }
    expect(bad).toEqual([]);
  });

  it('the English table has no stale entries', () => {
    // Stale entries mislead when editing copy
    const used = new Set([...sources.flatMap((s) => callSites(s.text)), ...zhSites()]);
    const stale = englishKeys().filter((k) => !used.has(k));
    expect(stale).toEqual([]);
  });

  it('t() arguments must be literals', () => {
    const bad: string[] = [];
    for (const { file, text } of sources) {
      // `t(variable)` / `t(`template`)` / `t('a' + b)`
      for (const m of stripComments(text).matchAll(/\bt\(\s*([^'")\s][^),]*)\)/g)) {
        bad.push(`${file}: t(${m[1].slice(0, 40)})`);
      }
      for (const m of stripComments(text).matchAll(/\bt\(\s*`/g)) bad.push(`${file}: t(\`…\`) at ${m.index}`);
    }
    expect(bad).toEqual([]);
  });

  /** Bare Chinese outside `t()` is neither a call site nor a dictionary key; scan the source for it. Exemptions: comments, `t('…')` arguments, and ALLOW. */
  it('no bare Chinese outside t() in UI sources', () => {
    /** Deliberately Chinese, not translated */
    const ALLOW = [
      /toLocaleString\('zh-CN'/,     // Locale name for date formatting
      /'zh'/, /'中文'/,               // The language option itself
      /console\.(log|warn|error)/,   // Developer logs
    ];
    const leftovers: string[] = [];
    for (const { file, text } of sources) {
      if (file === 'i18n.ts') continue;
      const code = stripComments(text);
      // A `// i18n-exempt` comment exempts the next line (test data, regexes matching internal errors). Comments are stripped later, so line numbers are found in the original.
      const exempt = new Set<number>();
      text.split('\n').forEach((l, i) => { if (l.includes('i18n-exempt')) exempt.add(i + 1); });

      code.split('\n').forEach((line, i) => {
        if (!/[\u4e00-\u9fff]/.test(line)) return;
        if (ALLOW.some((re) => re.test(line))) return;
        // The marker applies to the first following line containing Chinese; it may be part of a multi-line comment
        if ([...exempt].some((e) => e <= i + 1 && i + 1 - e <= 4)) return;
        // Remove the literal argument after each `t(`; `t('…', { n })` would otherwise leave a tail that looks like bare Chinese
        const rest = line.replace(/\bt\(\s*(['"])(?:(?!\1)[^\\]|\\.)*\1/g, 't(');
        if (/[\u4e00-\u9fff]/.test(rest)) leftovers.push(`${file}:${i + 1} ${line.trim().slice(0, 60)}`);
      });
    }
    expect(leftovers).toEqual([]);
  });

  /** The component that renders LangContext.Provider must not call useT(): useContext reads the provider above it and would always see the default. */
  it('the component rendering LangContext.Provider must not use useT()', () => {
    const offenders = sources
      .filter(({ text }) => {
        const code = stripComments(text);
        return code.includes('LangContext.Provider') && /\buseT\(\)/.test(code);
      })
      .map(({ file }) => file);
    expect(offenders).toEqual([]);
  });

  it('unknown keys return the Chinese text', () => {
    expect(translate('en', '这条没翻译过')).toBe('这条没翻译过');
    expect(translate('zh', '风格与配色')).toBe('风格与配色');
    expect(translate('en', '风格与配色')).toBe('Style & colors');
  });

  it('English translations contain no Chinese', () => {
    const leftovers = englishKeys().filter((k) => /[一-鿿]/.test(translate('en', k)));
    expect(leftovers).toEqual([]);
  });

  it('default language follows the browser', () => {
    expect(['zh', 'en']).toContain(detectLang());
  });
});
