/**
 * Dual-layer kinds: every fine EntityKind maps to one ops bucket or flag;
 * cloud visibility is primary-kind + generic-as-flag, not any-tag-on.
 */
import { describe, expect, it } from 'vitest';
import { analyze, DEFAULT_ANALYZE_OPTIONS } from '../src/core/analyze';
import type { Role } from '../src/core/types';
import {
  ALL_KINDS, classifyKinds, ENTITY_LABEL, markGeneric, type EntityKind, type EntityIndex,
} from '../src/core/entities';
import {
  BUCKET_MEMBERS, BUCKET_ORDER, KIND_BUCKETS, bucketOf, foldCommunityKind, toggleBucket, wordVisible,
} from '../src/core/kindBuckets';

const emptyIndex = {
  kindOf: new Map(), personNames: [], hits: new Map(), brands: new Set(),
} as unknown as EntityIndex;

const onExcept = (...off: EntityKind[]) => new Set(ALL_KINDS.filter((k) => !off.includes(k)));

describe('KIND_BUCKETS covers the implemented inventory', () => {
  it('every EntityKind in ENTITY_LABEL has a layer', () => {
    expect(Object.keys(KIND_BUCKETS).sort()).toEqual(Object.keys(ENTITY_LABEL).sort());
  });

  it('every ALL_KINDS member sits in exactly one bucket, except generic which is a flag', () => {
    const seen = new Set<EntityKind>();
    for (const b of BUCKET_ORDER) {
      for (const k of BUCKET_MEMBERS[b]) {
        expect(seen.has(k), k).toBe(false);
        seen.add(k);
        expect(KIND_BUCKETS[k]).toBe(b);
      }
    }
    expect(KIND_BUCKETS.generic).toBe('generic');
    expect(KIND_BUCKETS.system).toBe('system');
    expect(seen.has('generic')).toBe(false);
    expect([...seen, 'generic'].sort()).toEqual([...ALL_KINDS].sort());
  });

  it('community fold uses the five ops buckets; flags land in other', () => {
    expect(foldCommunityKind('title')).toBe('person');
    expect(foldCommunityKind('kinship')).toBe('person');
    expect(foldCommunityKind('ethnicity')).toBe('person');
    expect(foldCommunityKind('rank')).toBe('person');
    expect(foldCommunityKind('building')).toBe('place');
    expect(foldCommunityKind('region')).toBe('place');
    expect(foldCommunityKind('path')).toBe('place');
    expect(foldCommunityKind('festival')).toBe('time');
    expect(foldCommunityKind('org')).toBe('social');
    expect(foldCommunityKind('document')).toBe('social');
    expect(foldCommunityKind('law')).toBe('social');
    expect(foldCommunityKind('money')).toBe('other');
    expect(foldCommunityKind('drink')).toBe('other');
    expect(foldCommunityKind('measure')).toBe('other');
    expect(foldCommunityKind('number')).toBe('other');
    expect(foldCommunityKind('onomatopoeia')).toBe('other');
    expect(foldCommunityKind('generic')).toBe('other');
  });
});

describe('wordVisible: primary bucket + generic flag', () => {
  it('赵总 leaves the cloud when person is off even if title stays on', () => {
    const tags = classifyKinds('赵总', emptyIndex);
    expect(tags.map((t) => t.kind)).toEqual(expect.arrayContaining(['person', 'title']));
    const w = { kind: tags[0].kind, kinds: tags };
    expect(w.kind).toBe('person');
    expect(wordVisible(w, new Set(ALL_KINDS))).toBe(true);
    expect(wordVisible(w, onExcept('person'))).toBe(false);
    expect(wordVisible(w, onExcept('title'))).toBe(true);
  });

  it('咖啡 leaves the cloud when generic is off even if drink stays on', () => {
    const tags = markGeneric(classifyKinds('咖啡', emptyIndex));
    expect(tags.map((t) => t.kind)).toEqual(expect.arrayContaining(['drink', 'generic']));
    const w = { kind: tags[0].kind, kinds: tags };
    expect(w.kind).toBe('drink');
    expect(wordVisible(w, new Set(ALL_KINDS))).toBe(true);
    expect(wordVisible(w, onExcept('generic'))).toBe(false);
    expect(wordVisible(w, onExcept('drink'))).toBe(false);
  });

  it('公司 follows its primary place tag, not the extra org tag', () => {
    const tags = classifyKinds('公司', emptyIndex);
    expect(tags.map((t) => t.kind)).toEqual(expect.arrayContaining(['place', 'org']));
    const w = { kind: tags[0].kind, kinds: tags };
    expect(w.kind).toBe('place');
    expect(wordVisible(w, onExcept('place'))).toBe(false);
    expect(wordVisible(w, onExcept('org'))).toBe(true);
  });

  it('system never shows', () => {
    expect(wordVisible({ kind: 'system', kinds: [{ kind: 'system', conf: 1 }] }, new Set(ALL_KINDS))).toBe(false);
  });
});

describe('toggleBucket', () => {
  it('turning 人物 off drops the person-bucket kinds and nothing else', () => {
    const next = toggleBucket(ALL_KINDS, 'person');
    expect(next).not.toContain('person');
    expect(next).not.toContain('title');
    expect(next).not.toContain('ethnicity');
    expect(next).not.toContain('rank');
    expect(next).toContain('place');
    expect(next).toContain('generic');
    expect(toggleBucket(next, 'person').sort()).toEqual([...ALL_KINDS].sort());
  });
});

describe('analyze uses the primary+flag predicate', () => {
  const chatOf = (mes: string) => [
    JSON.stringify({ user_name: 'u', character_name: 'c' }),
    JSON.stringify({ name: 'u', is_user: true, mes }),
  ].join('\n');
  const files = [{ name: 'a.jsonl', content: chatOf('赵总来了。赵总说可以。赵总点点头。') }];
  const base = {
    ...DEFAULT_ANALYZE_OPTIONS,
    roles: ['user', 'char'] as Role[],
    tokenize: { ...DEFAULT_ANALYZE_OPTIONS.tokenize, minCount: 1, discoverMinCount: 2 },
  };

  it('赵总 is in the cloud by default and gone when person is off with title still on', () => {
    const shown = analyze(files, base);
    expect(shown.words.map((w) => w.text)).toContain('赵总');
    const hidden = analyze(files, { ...base, kinds: ALL_KINDS.filter((k) => k !== 'person') });
    expect(hidden.words.map((w) => w.text)).not.toContain('赵总');
    expect(hidden.allWords.find((w) => w.text === '赵总')?.kind).toBe('person');
  });
});

describe('bucketOf fallback', () => {
  it('unknown ids land in other', () => {
    expect(bucketOf('not_a_kind')).toBe('other');
  });
});
