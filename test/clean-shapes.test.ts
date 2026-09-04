/**
 * One representative instance per catalogued structure class.
 * Drives shipped cleanMessageText / parseChatFile / analyze. Does not touch clean.test.ts.
 */
import { describe, expect, it } from 'vitest';
import { analyze, DEFAULT_ANALYZE_OPTIONS } from '../src/core/analyze';
import { cleanMessageText, DEFAULT_CLEAN_OPTIONS } from '../src/core/clean';
import { instructExactSize } from '../src/core/instructLines';
import { parseChatFile } from '../src/core/parse';
import { applyRules, parseRegexScripts, REGEX_PLACEMENT } from '../src/core/regexScripts';
import { deferredShapeIds, landedShapeIds, SHAPE_CATALOG } from '../src/core/shapes';
import { INSTANTIABLE_IDS, PARSE_ONLY_LANDED } from './shapeGen';

const clean = (s: string) => cleanMessageText(s, DEFAULT_CLEAN_OPTIONS);
const KEEP = '她推开门。';

describe('shape catalog is finite and source-derived', () => {
  it('every class names a write path and a regularity; deferred classes have a reason', () => {
    expect(SHAPE_CATALOG.length).toBeGreaterThan(10);
    expect(SHAPE_CATALOG.length).toBeLessThan(40);
    for (const c of SHAPE_CATALOG) {
      expect(c.regularity.length).toBeGreaterThan(10);
      expect(c.writePath.length).toBeGreaterThan(3);
      if (c.status === 'deferred') expect(c.deferReason?.length).toBeGreaterThan(10);
    }
  });

  it('every landed class is instantiable or documented parse/human-only', () => {
    const covered = new Set<string>([...INSTANTIABLE_IDS, ...PARSE_ONLY_LANDED]);
    expect(landedShapeIds().sort()).toEqual([...covered].sort());
  });

  it('docs/32 correctness leftovers are either landed or explicitly deferred', () => {
    const ids = new Set(SHAPE_CATALOG.map((c) => c.id));
    for (const need of [
      'regex_script', 'wi_bracket_wrap', 'instruct_whole_line', 'colon_fence',
      'kv_run', 'numeric_panel', 'indented_kv', 'paired_custom_tag',
    ]) expect(ids.has(need)).toBe(true);
    expect(deferredShapeIds()).toEqual(['files_meta', 'names_force_prefix']);
  });

  it('instruct table is a finite literal set, not an encoding explosion', () => {
    expect(instructExactSize()).toBeGreaterThan(10);
    expect(instructExactSize()).toBeLessThan(40);
  });
});

describe('shipped cleaner on each structure class', () => {
  it('paired CJK custom tag', () => {
    const out = clean(`<状态栏>ZXLEAK 99 金币 5000</状态栏>${KEEP}`);
    expect(out).toContain(KEEP);
    expect(out).not.toContain('ZXLEAK');
    expect(out).not.toContain('金币');
  });

  it(':: colon fence', () => {
    const out = clean(`::panel\nZXLEAK 潮位\n::\n${KEEP}`);
    expect(out).toContain(KEEP);
    expect(out).not.toContain('ZXLEAK');
    expect(out).not.toContain('潮位');
  });

  it('::: still works', () => {
    const out = clean(`:::schedule\nZXLEAK\n:::\n${KEEP}`);
    expect(out).toContain(KEEP);
    expect(out).not.toContain('ZXLEAK');
  });

  it('English KV run with numeric values, no Chinese STATUS_FIELD', () => {
    const out = clean(`Time: 08:15\nLocation: ZXLEAK hall\nTrust: 45\n${KEEP}`);
    expect(out).toContain(KEEP);
    expect(out).not.toContain('ZXLEAK');
    expect(out).not.toContain('08:15');
  });

  it('dialogue with short replies is kept', () => {
    const out = clean(`高飞：走吧\n沈砚秋：好\n周敬亭：嗯\n${KEEP}`);
    expect(out).toContain('走吧');
    expect(out).toContain(KEEP);
  });

  it('wi_format bracket wrap', () => {
    const out = clean(`[Details of the fictional world:\nZXLEAK 潮汐表 港务处\n设定续行\n]\n${KEEP}`);
    expect(out).toContain(KEEP);
    expect(out).not.toContain('ZXLEAK');
    expect(out).not.toContain('潮汐表');
  });

  it('narrative bracket without colon is kept', () => {
    const out = clean(`[他停顿了很久才开口。\n${KEEP}`);
    expect(out).toContain('停顿了很久');
    expect(out).toContain(KEEP);
  });

  it('instruct whole lines', () => {
    const out = clean(`### Instruction:\n${KEEP}\n<|im_start|>user\n<|im_end|>\n[INST]\n`);
    expect(out).toContain(KEEP);
    expect(out).not.toContain('Instruction');
    expect(out).not.toContain('im_start');
    expect(out).not.toContain('[INST]');
  });

  it('instruct paired turn on one line (wrap:false presets)', () => {
    const out = clean(`[INST] ZXLEAK 保持人称一致 [/INST]\n${KEEP}`);
    expect(out).toContain(KEEP);
    expect(out).not.toContain('ZXLEAK');
    expect(out).not.toContain('人称');
  });

  it('instruct prompt block ends at the reply sequence, the reply survives', () => {
    const out = clean(`### Instruction:\nZXLEAK 继续这一轮的叙述\n\n### Response:\n${KEEP}`);
    expect(out).toContain(KEEP);
    expect(out).not.toContain('ZXLEAK');
    expect(out).not.toContain('叙述');
  });

  it('instruct prompt block does not eat a run with no reply sequence after it', () => {
    const out = clean(`### Instruction:\n${KEEP}\n<|im_start|>user\n<|im_end|>\n[INST]\n`);
    expect(out).toContain(KEEP);
  });

  it('instruct prompt block leaves long spans alone', () => {
    const body = Array.from({ length: 8 }, (_, i) => `第${i}行她推开门又关上。`).join('\n');
    const out = clean(`### Instruction:\n${body}\n### Response:\n${KEEP}`);
    expect(out).toContain('第7行');
    expect(out).toContain(KEEP);
  });

  it('numeric panel after HTML strip', () => {
    const out = clean(`<div><span>trust 3</span></div>\nZXLEAK 99\ntension 7\naffection 12\n${KEEP}`);
    expect(out).toContain(KEEP);
    expect(out).not.toMatch(/\btrust\b/);
    expect(out).not.toContain('ZXLEAK');
  });

  it('indented YAML kv run', () => {
    const out = clean(`  title: ZXLEAK\n  trust: 3\n  tension: 7\n${KEEP}`);
    expect(out).toContain(KEEP);
    expect(out).not.toContain('ZXLEAK');
  });

  it('regex markdownOnly + placement + trimStrings', () => {
    const scripts = [
      { scriptName: 'ai only', findRegex: '<AI>[\\s\\S]*?</AI>', replaceString: '', placement: [2], markdownOnly: true },
      { scriptName: 'user only', findRegex: '<US>[\\s\\S]*?</US>', replaceString: '', placement: [1] },
      { scriptName: 'trim', findRegex: '/<x>(.*)<\\/x>/', replaceString: '$1', trimStrings: ['ZXLEAK'] },
    ];
    const rules = parseRegexScripts(scripts);
    expect(rules[0].markdownOnly).toBe(true);
    const ai = applyRules('前<AI>ZXLEAK</AI>后<US>U</US>', rules, REGEX_PLACEMENT.AI_OUTPUT);
    expect(ai).not.toContain('ZXLEAK');
    expect(ai).toContain('<US>');
    const user = applyRules('前<AI>ZXLEAK</AI>后<US>U</US>', rules, REGEX_PLACEMENT.USER_INPUT);
    expect(user).toContain('ZXLEAK');
    expect(user).not.toContain('<US>');
    const trimmed = applyRules(`keep <x>ZXLEAK ${KEEP}</x>`, rules);
    expect(trimmed).toContain(KEEP);
    expect(trimmed).not.toContain('ZXLEAK');
  });
});

describe('shipped parse/analyze on reserved extra fields', () => {
  const analyzeOpts = {
    ...DEFAULT_ANALYZE_OPTIONS,
    roles: ['user', 'char'] as ('user' | 'char')[],
    tokenize: { ...DEFAULT_ANALYZE_OPTIONS.tokenize, minCount: 1, minLength: 2 },
  };

  it('fileLength prefix is not in the cloud', () => {
    const prefix = 'ZXLEAK 周转文件全文\n\n';
    const content = [
      JSON.stringify({ user_name: 'unused', character_name: 'unused', chat_metadata: {} }),
      JSON.stringify({ name: '角色', is_user: false, mes: prefix + KEEP, extra: { fileLength: prefix.length } }),
    ].join('\n');
    expect(parseChatFile('a.jsonl', content).messages[0].raw).toBe(KEEP);
    const bag = analyze([{ name: '卡.jsonl', content }], analyzeOpts).words.map((w) => w.text).join(' ');
    expect(bag).not.toMatch(/ZXLEAK|周转/);
  });

  it('swipe_id selects the current swipe', () => {
    const rec = JSON.stringify({ name: 'a', mes: '旧ZXLEAK', swipes: ['旧ZXLEAK', KEEP], swipe_id: 1 });
    expect(parseChatFile('a.jsonl', rec).messages[0].raw).toBe(KEEP);
  });
});
