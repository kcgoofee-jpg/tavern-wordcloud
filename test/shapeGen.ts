/**
 * Seeded generator over the finite shape catalog. Not the cleaner:
 * it only emits dirty text plus leak/keep tokens. Tests must run the
 * shipped cleanMessageText / parseChatFile / analyze.
 */
import type { CleanRule } from '../src/core/regexScripts';
import type { ShapeId } from '../src/core/shapes';

export interface ShapeSample {
  id: ShapeId;
  seed: number;
  text: string;
  format: 'mes' | 'jsonl';
  leak: string[];
  keep: string[];
  rules?: CleanRule[];
  source?: 'mes' | 'reasoning';
}

const KEEP = '她推开门。';

function leakWord(seed: number): string {
  return `ZXLEAK${seed}`;
}

function jsonl(mes: string, extra: Record<string, unknown> = {}, more: Record<string, unknown> = {}): string {
  return [
    JSON.stringify({ user_name: 'unused', character_name: 'unused', chat_metadata: {} }),
    JSON.stringify({ name: '角色', is_user: false, mes, extra, ...more }),
  ].join('\n');
}

export const INSTANTIABLE_IDS: ShapeId[] = [
  'paired_custom_tag',
  'dangling_custom_tag',
  'orphan_custom_tag',
  'colon_fence',
  'kv_run',
  'bracket_status',
  'wi_bracket_wrap',
  'instruct_whole_line',
  'numeric_panel',
  'indented_kv',
  'ooc',
  'code_fence',
  'file_length_prefix',
  'swipe_id',
  'display_text',
  'reasoning_display_text',
  'regex_script',
];

/** Landed classes that are parse identity / human lists, covered by existing tests. */
export const PARSE_ONLY_LANDED: ShapeId[] = [
  'jsonl_header',
  'hide_is_system',
  'system_extra_type',
  'imported_regex',
  'owner_blocklist',
];

export function generateShape(id: ShapeId, seed: number): ShapeSample {
  const leak = leakWord(seed);
  const base = { id, seed, leak: [leak], keep: [KEEP] as string[] };
  switch (id) {
    case 'paired_custom_tag':
      return { ...base, format: 'mes', text: `<状态栏>${leak} 99</状态栏>${KEEP}` };
    case 'dangling_custom_tag':
      return { ...base, format: 'mes', text: `${KEEP}<状态栏>${leak} 99` };
    case 'orphan_custom_tag':
      return { ...base, format: 'mes', text: `${leak} 垃圾</状态栏>${KEEP}` };
    case 'colon_fence':
      return { ...base, format: 'mes', text: `::panel\n${leak} 潮位\n::\n${KEEP}` };
    case 'kv_run':
      return { ...base, format: 'mes', text: `Time: 08:15\nLocation: ${leak}\nTrust: 45\n${KEEP}` };
    case 'bracket_status':
      return { ...base, format: 'mes', text: `[当前时间] 2008-08-08\n[当前地点] ${leak}港\n\n${KEEP}` };
    case 'wi_bracket_wrap':
      return { ...base, format: 'mes', text: `[Details of the fictional world:\n${leak} 潮汐表 港务处\n更多设定\n]\n${KEEP}` };
    case 'instruct_whole_line':
      return { ...base, format: 'mes', text: `### Instruction:\n${KEEP}\n<|im_end|>\n` };
    case 'numeric_panel':
      return { ...base, format: 'mes', text: `<div><span>trust 3</span></div>\n${leak} 99\ntension 7\naffection 12\n${KEEP}` };
    case 'indented_kv':
      return { ...base, format: 'mes', text: `  title: ${leak}\n  trust: 3\n  tension: 7\n${KEEP}` };
    case 'ooc':
      return { ...base, format: 'mes', text: `[OOC: ${leak} 换方向]${KEEP}` };
    case 'code_fence':
      return { ...base, format: 'mes', text: '```json\n{"' + leak + '":1}\n```\n' + KEEP };
    case 'file_length_prefix': {
      const prefix = `${leak} 附件正文周转\n\n`;
      return {
        ...base,
        format: 'jsonl',
        text: jsonl(prefix + KEEP, { fileLength: prefix.length }),
      };
    }
    case 'swipe_id':
      return {
        ...base,
        format: 'jsonl',
        text: jsonl('旧' + leak, {}, { swipes: ['旧' + leak, KEEP], swipe_id: 1 }),
      };
    case 'display_text':
      return {
        ...base,
        format: 'jsonl',
        text: jsonl('原文' + leak, { display_text: KEEP }),
      };
    case 'reasoning_display_text':
      return {
        ...base,
        format: 'jsonl',
        source: 'reasoning',
        text: jsonl(KEEP, { reasoning: '内部' + leak, reasoning_display_text: KEEP, model: 'm' }),
      };
    case 'regex_script':
      return {
        ...base,
        format: 'mes',
        text: `<Zhuangtailan>${leak} 好感 3</Zhuangtailan>${KEEP}`,
        rules: [{ find: '<Zhuangtailan>[\\s\\S]*?<\\/Zhuangtailan>', flags: 'g', replace: '', markdownOnly: true, placement: [2] }],
      };
    default:
      return { ...base, format: 'mes', text: KEEP };
  }
}

export function generateBatch(seed0: number, n: number): ShapeSample[] {
  const out: ShapeSample[] = [];
  for (let i = 0; i < n; i++) {
    for (const id of INSTANTIABLE_IDS) out.push(generateShape(id, seed0 + i));
  }
  return out;
}
