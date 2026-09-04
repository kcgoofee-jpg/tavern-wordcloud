/** English lemmatization: merge inflections, never invent forms absent from the corpus. */
import { describe, expect, it } from 'vitest';
import { baseForms, planMerge, detectEnglishNames } from '../src/core/english';

const plan = (words: Record<string, number>, stop: string[] = []) => {
  const stops = new Set(stop);
  return planMerge(new Map(Object.entries(words)), (w) => stops.has(w));
};

describe('candidate bases', () => {
  it.each([
    ['looks', 'look'], ['looking', 'look'], ['looked', 'look'],
    ['sliding', 'slide'], ['amused', 'amuse'],
    ['stopped', 'stop'], ['running', 'run'],
    ['stories', 'story'], ['tried', 'try'],
    ["kestrel's", 'kestrel'], ["holdings'", 'holdings'],
  ])('%s 的候选里有 %s', (w, base) => {
    expect(baseForms(w)).toContain(base);
  });

  it.each(['business', 'address', 'thing', 'during', 'nothing', 'red', 'hundred', 'focus', 'crisis'])(
    '%s 不该被当成变形',
    (w) => {
      // Either no candidate, or the candidate is not adopted (see the merge tests)
      const b = baseForms(w);
      expect(b).not.toContain(w.slice(0, -1));
    },
  );
});

describe('merge only with evidence', () => {
  it('merges when the base is attested', () => {
    const { map } = plan({ walk: 5, walked: 3, walking: 2 });
    expect(map.get('walked')).toBe('walk');
    expect(map.get('walking')).toBe('walk');
  });

  it('merges when two forms share an unattested base', () => {
    const { map } = plan({ negotiated: 4, negotiating: 3 });
    // Merged into the most frequent surface form, not an invented `negotiat`
    expect(map.get('negotiating')).toBe('negotiated');
    expect([...map.values()]).not.toContain('negotiat');
  });

  it('a lone form with an unattested base never merges', () => {
    /** These words produce candidate bases (hotel / avocado / tiara) that are absent from the counts; they must not merge. Pins behaviour, not a specific guard. */
    const { map } = plan({ hotels: 4, avocados: 3, tiaras: 2 });
    expect(map.size).toBe(0);
  });

  it('never invents a word absent from the corpus', () => {
    const words = { business: 9, happiness: 5, organization: 4, negotiating: 2, negotiated: 3 };
    const { map } = plan(words);
    for (const target of map.values()) {
      expect(Object.keys(words)).toContain(target);
    }
  });

  it('the most frequent form is displayed', () => {
    const { map } = plan({ looked: 2, looking: 9 });
    expect(map.get('looked')).toBe('looking');
  });
});

describe('inflections of stop words are filtered too', () => {
  it('looking / looks merge into the stop word look', () => {
    // look/looked were in the list while looking/looks were missing
    const { map } = plan({ look: 3, looked: 2, looking: 7, looks: 4 }, ['look', 'looked']);
    expect(map.get('looking')).toBe('look');
    expect(map.get('looks')).toBe('look');
  });

  it('merges into a stop-word base even when unattested', () => {
    const { map } = plan({ looking: 7, looks: 4 }, ['look']);
    expect(map.get('looking')).toBe('look');
    expect(map.get('looks')).toBe('look');
  });
});

describe('English proper nouns', () => {
  const lines = [
    'Adrian Kestrel did not look up when she came in.',
    'She had heard about Adrian Kestrel long before Kestrel Holdings existed.',
    'The rain over Ravensmoor never stopped. Kestrel Holdings owned half of it.',
  ];

  it('capitalized runs are detected', () => {
    const names = detectEnglishNames(lines);
    expect(names).toContain('Adrian Kestrel');
    expect(names).toContain('Kestrel Holdings');
  });

  it('sentence-initial capitals do not count', () => {
    const names = detectEnglishNames([
      'She had heard about it. She had heard about it again. She had heard once more.',
      'The rain fell. The rain fell harder. The rain never stopped at all.',
    ]);
    expect(names.join(' ')).not.toMatch(/^She |^The /);
    expect(names).toHaveLength(0);
  });

  it('a combination seen once does not count', () => {
    expect(detectEnglishNames(['Once Nora Vance walked in and nobody said a word.'])).toHaveLength(0);
  });

  it('words separated by punctuation are not one name', () => {
    const names = detectEnglishNames([
      'He turned to Priya, Dominic waited. He turned to Priya, Dominic waited again.',
    ]);
    expect(names).not.toContain('Priya Dominic');
  });
});

/** End-to-end regression on a real-sized English corpus. */
import fs from 'node:fs';
import path from 'node:path';
import { analyze, DEFAULT_ANALYZE_OPTIONS } from '../src/core/analyze';

const FIXTURE = path.join(process.cwd(), 'fixtures', 'ceo-en.jsonl');

describe.skipIf(!fs.existsSync(FIXTURE))('英文语料端到端', () => {
  // describe.skipIf skips tests only; the describe body still runs, so file reads must be guarded (no fixtures/ on CI)
  const content = fs.existsSync(FIXTURE) ? fs.readFileSync(FIXTURE, 'utf8') : '';
  const r = analyze([{ name: 'ceo-en.jsonl', content }], {
    ...DEFAULT_ANALYZE_OPTIONS,
    roles: ['user', 'char'],
    kinds: ['plain', 'person', 'place', 'time'],
    tokenize: { ...DEFAULT_ANALYZE_OPTIONS.tokenize, maxWords: 200, minCount: 2 },
  });

  it('every cloud word occurs verbatim in the text', () => {
    // Lemmatization must never produce a form such as `walke` / `busi`
    /** Presence is checked by whole-word match for Latin words; `includes` would make any stem match its inflection. */
    const corpus = content.toLowerCase();
    const inCorpus = (w: string) => (/^[a-z][a-z' -]*$/.test(w)
      ? new RegExp(`(?<![a-z])${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![a-z])`).test(corpus)
      : corpus.includes(w));
    const ghosts = r.words.filter((w) => !inCorpus(w.text.toLowerCase()));

    expect(ghosts.map((w) => w.text)).toEqual([]);
  });

  it('inflections of one word do not take separate slots', () => {
    const texts = new Set(r.words.map((w) => w.text));
    /** Groups measured on this corpus whose merge target is not a stop word, so disabling lemmatization turns this red. */
    for (const group of [['need', 'needs', 'needed', 'needing'],
      ['work', 'works', 'worked', 'working'],
      ['settle', 'settled', 'settling']]) {
      expect(group.filter((f) => texts.has(f)).length).toBeLessThanOrEqual(1);
    }
  });

  it('possessives merge into the base name', () => {
    const texts = new Set(r.words.map((w) => w.text));
    // adrian's / nora's / whitlock's occur in the corpus
    for (const p of ["adrian's", "nora's", "whitlock's", "priya's", "company's"]) {
      expect(texts.has(p)).toBe(false);
    }
  });

  it('multi-word names are one token', () => {
    const texts = new Set(r.words.map((w) => w.text));
    // Kestrel Holdings occurs 37 times; unmerged, kestrel would mix with the person name
    expect(texts.has('kestrel holdings')).toBe(true);
  });

  it('contractions and possessives do not enter the cloud as fragments', () => {
    const frags = r.words.filter((w) => /^(s|t|ll|ve|re|d|m)$/.test(w.text));
    expect(frags.map((w) => w.text)).toEqual([]);
  });
});

describe('single-word English names', () => {
  it('a word capitalized mid-sentence several times and never in lower case is a name; sentence starts alone are not', () => {
    const lines = [
      'She looked at Nicole and smiled.', 'Then Nicole left the room.', 'Sam told Nicole to wait.',
      'Everyone except Nicole agreed.', 'Wrap her up before the shot.', 'Wrap it now.', 'Wrap it again.', 'Wrap it once more.',
      'The touch was gentle.', 'A gentle Touch again.', 'He said touch was fine.',
    ];
    const names = detectEnglishNames(lines);
    expect(names).toContain('Nicole');
    expect(names).not.toContain('Wrap');    // only ever sentence-initial
    expect(names).not.toContain('Touch');   // also written in lower case
  });
});
