/** Contract test: the export list of src/core/index.ts is pinned; removing an export is a breaking change. Also runs the API end to end. */
import { describe, expect, it } from 'vitest';
import * as core from '../src/core';

const PUBLIC_API = [
  // One call
  'analyze', 'DEFAULT_ANALYZE_OPTIONS',
  // Stages
  'parseChatFile', 'collectNames', 'DEFAULT_PARSE_OPTIONS',
  'cleanMessageText', 'DEFAULT_CLEAN_OPTIONS',
  'tokenizeCorpus', 'segmentToChunks', 'discoverPhrases', 'hasIntlSegmenter', 'DEFAULT_TOKENIZE_OPTIONS',
  'buildStopwords', 'DEFAULT_STOPWORDS',
  // Input formats
  'detectFormat', 'parseTxtChat', 'readDataBundle',
  // Reasoning
  'cleanReasoning', 'findBoilerplate', 'COT_SCHEMA_STOPWORDS',
  // Entities
  'classify', 'detectEntities', 'systemWords', 'ENTITY_LABEL',
  // LLM tokenization (optional)
  'segmentWithAi', 'segmentChunk', 'DEFAULT_AI_CONFIG',
  // Metadata
  'describeChat', 'groupByCharacter', 'parseFileName',
  // Errors
  'classifyError',
].sort();

describe('public API', () => {
  it('export list unchanged', () => {
    expect(Object.keys(core).sort()).toEqual(PUBLIC_API);
  });

  it('runs from this file alone', () => {
    const meta = JSON.stringify({ chat_metadata: { world_info: '测试世界书' }, user_name: 'unused', character_name: 'unused' });
    const msg = (o: Record<string, unknown>) => JSON.stringify(o);
    const content = [
      meta,
      msg({ name: '我', is_user: true, mes: '沈砚秋推开门，沈砚秋看了他一眼。' }),
      msg({ name: '角色', is_user: false, mes: '沈砚秋没有回答。<fate_ui>状态块</fate_ui>', extra: { model: 'x-1' } }),
      msg({ name: '我', is_user: true, mes: '沈砚秋走了。沈砚秋没有回头。' }),
    ].join('\n');

    const result = core.analyze(
      [{ name: '测试角色 - 2026-08-31@20h00m08s527ms.jsonl', content }],
      { ...core.DEFAULT_ANALYZE_OPTIONS, roles: ['user', 'char'], tokenize: { ...core.DEFAULT_ANALYZE_OPTIONS.tokenize, minCount: 1, discoverMinCount: 2 } },
    );

    expect(result.words.length).toBeGreaterThan(0);
    // The name is detected as a person and hidden by default; it is in the full table
    expect(result.allWords.find((w) => w.text === '沈砚秋')?.kind).toBe('person');
    // Plugin blocks never enter the cloud
    expect(result.words.map((w) => w.text)).not.toContain('状态块');
    // Metadata is available
    expect(result.meta?.character).toBe('测试角色');
    expect(result.meta?.worldInfo).toBe('测试世界书');
    expect(result.meta?.models).toContain('x-1');
    expect(result.groups).toHaveLength(1);
  });

  it('the card name is parsed from the file name', () => {
    expect(core.parseFileName('逐梦演艺圈4.2 - 2026-08-31@20h00m08s527ms.jsonl')).toEqual({
      character: '逐梦演艺圈4.2',
      startedAt: '2026-08-31T20:00:08',
    });
  });

  it('unrecognized files get a readable message', () => {
    const e = core.classifyError(new Error('a.jsonl：认不出格式，既不是 JSON 也不是 JSONL'));
    expect(e.kind).toBe('known');
    expect(e.hint).toBeTruthy();
  });
});
