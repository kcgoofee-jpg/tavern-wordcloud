import { describe, expect, it } from 'vitest';
import { applyRules, isRegexScriptFile, parseRegexScripts } from '../src/core/regexScripts';
import { cleanMessageText, DEFAULT_CLEAN_OPTIONS } from '../src/core/clean';

const scripts = [
  { scriptName: 'hide status', findRegex: '<Zhuangtailan>[\\s\\S]*?<\\/Zhuangtailan>', replaceString: '', placement: [2], markdownOnly: true, promptOnly: false },
  { scriptName: 'beautify', findRegex: '/<Emo>([\\s\\S]*?)<\\/Emo>/g', replaceString: '<div class="x">$1</div>', placement: [2], markdownOnly: true, promptOnly: false },
  { scriptName: 'keep content', findRegex: '/[\\s\\S]*(<content>[\\s\\S]*<\\/content>)[\\s\\S]*/', replaceString: '$1', placement: [2], markdownOnly: true, promptOnly: true },
  { scriptName: 'wrap', findRegex: '^([\\s\\S]*)$', replaceString: '<peip>\n$1{{getvar::x}}\n</peip>', placement: [1], markdownOnly: false, promptOnly: true },
  { scriptName: 'macro', findRegex: '(<thinking>)(.*?)(</thinking>)', replaceString: '$1$fn:replace($2,"<","")$3', placement: [2], markdownOnly: true, promptOnly: false },
  { scriptName: 'off', findRegex: '<Off>[\\s\\S]*?</Off>', replaceString: '', disabled: true },
];

describe('regex scripts as cleaning rules', () => {
  it('recognizes an export file', () => {
    expect(isRegexScriptFile(scripts)).toBe(true);
    expect(isRegexScriptFile([{ a: 1 }])).toBe(false);
    expect(isRegexScriptFile({ findRegex: 'x' })).toBe(false);
  });
  it('keeps removal and beautifier scripts, skips prompt shaping, macros and disabled ones', () => {
    const rules = parseRegexScripts(scripts);
    expect(rules.map((r) => r.name)).toEqual(['hide status', 'beautify']);
    expect(rules[1].replace).toBe('');
    expect(rules[1].flags).toContain('g');
  });
  it('applies rules before the generic passes', () => {
    const rules = parseRegexScripts(scripts);
    const text = '她推开门。<Zhuangtailan>姓名：霜月 好感：3</Zhuangtailan><Emo>心情平静</Emo>然后坐下。';
    expect(applyRules(text, rules)).toBe('她推开门。然后坐下。');
    const cleaned = cleanMessageText(text, { ...DEFAULT_CLEAN_OPTIONS, customRules: rules });
    expect(cleaned).toContain('推开门');
    expect(cleaned).not.toContain('好感');
  });
  it('skips a rule that would wipe the text', () => {
    const rules = [{ find: '[\\s\\S]+', flags: 'g', replace: '' }];
    const long = '正文'.repeat(200);
    expect(applyRules(long, rules)).toBe(long);
  });
  it('nested-quantifier scripts are ignored so they cannot hang the tab', () => {
    const wall = 'a'.repeat(24) + '!';
    const t0 = Date.now();
    const out = applyRules(wall, [{ find: '(a+)+$', flags: 'g', replace: '' }]);
    expect(Date.now() - t0).toBeLessThan(50);
    expect(out).toBe(wall);
    expect(parseRegexScripts([{ findRegex: '(a+)+$', replaceString: '' }])).toEqual([]);
  });
});
