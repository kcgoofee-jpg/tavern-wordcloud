/**
 * Two layers over the same `EntityKind` tags (notes/docs/33).
 *
 * Fine kinds stay the implemented inventory: review, `eval:kinds`, and alias scoring
 * still see them. Ops filters get a handful of buckets published tagsets actually
 * agree on (CoNLL PER/LOC/ORG + TIME, OntoNotes DATE/TIME vs ORG/EVENT/WORK_OF_ART,
 * 词林 A人 / C时空 / D抽象, community's person/place/time/other fold).
 *
 * `generic` and `system` are flags, not buckets: a drink that is also filler
 * (`咖啡`) stays `drink` as its primary kind; turning 常见词 off hides it anyway.
 */
import { ALL_KINDS, type EntityKind } from './entities';
import { zh } from './zh';

/** Ops-facing exclusive bucket. Every implemented kind except the two flags lands in one. */
export type KindBucket = 'person' | 'place' | 'time' | 'social' | 'other';
/** Orthogonal to the bucket: `generic` is a suppress flag; `system` is never in the cloud. */
export type KindFlag = 'generic' | 'system';
export type KindLayer = KindBucket | KindFlag;

/**
 * Many-to-one map. Intersection of the fine and coarse reviews:
 * person ← PER + 词林 A (names, titles, kinship, jobs, relations, ethnicity, rank);
 * place  ← LOC/GPE/FAC + 词林 C 空间 (place, building, room, nature, region, path);
 * time   ← DATE/TIME + 词林 Ca (time, festival — not money: OntoNotes MONEY ≠ DATE);
 * social ← ORG/EVENT/WORK_OF_ART + 词林 D 抽象里的机构/文书/作品/法律;
 * other  ← residual, including WordNet artifact/food/feeling splits the ops view does not hide separately.
 */
export const KIND_BUCKETS = {
  person: 'person',
  title: 'person',
  kinship: 'person',
  occupation: 'person',
  relation: 'person',
  ethnicity: 'person',
  rank: 'person',
  place: 'place',
  building: 'place',
  room: 'place',
  nature: 'place',
  region: 'place',
  path: 'place',
  time: 'time',
  festival: 'time',
  org: 'social',
  document: 'social',
  media: 'social',
  event: 'social',
  law: 'social',
  brand: 'social',
  myth: 'social',
  martial: 'social',
  plain: 'other',
  money: 'other',
  measure: 'other',
  number: 'other',
  onomatopoeia: 'other',
  wear: 'other',
  food: 'other',
  drink: 'other',
  furniture: 'other',
  container: 'other',
  vehicle: 'other',
  device: 'other',
  weapon: 'other',
  jewelry: 'other',
  material: 'other',
  plant: 'other',
  animal: 'other',
  weather: 'other',
  body: 'other',
  color: 'other',
  sound: 'other',
  smell: 'other',
  texture: 'other',
  illness: 'other',
  emotion: 'other',
  speech: 'other',
  thought: 'other',
  desire: 'other',
  generic: 'generic',
  system: 'system',
} as const satisfies Record<EntityKind, KindLayer>;

export const BUCKET_ORDER = ['person', 'place', 'time', 'social', 'other'] as const satisfies readonly KindBucket[];

export const BUCKET_LABEL: Record<KindBucket, ReturnType<typeof zh>> = {
  person: zh('人物'),
  place: zh('地点'),
  time: zh('时间'),
  social: zh('文书与组织'),
  other: zh('其他'),
};

/** Fine kinds whose primary tag lives in this bucket. `generic` / `system` are not members. */
export const BUCKET_MEMBERS: Record<KindBucket, EntityKind[]> = {
  person: [],
  place: [],
  time: [],
  social: [],
  other: [],
};
for (const k of ALL_KINDS) {
  const layer = KIND_BUCKETS[k];
  if (layer === 'generic' || layer === 'system') continue;
  BUCKET_MEMBERS[layer].push(k);
}

export function bucketOf(kind: string): KindLayer {
  return (KIND_BUCKETS as Record<string, KindLayer>)[kind] ?? 'other';
}

/** Community pie uses the same five ops buckets. Flags collapse into other. */
export function foldCommunityKind(kind: string): KindBucket {
  const layer = bucketOf(kind);
  if (layer === 'generic' || layer === 'system') return 'other';
  return layer;
}

export function bucketOn(kinds: readonly EntityKind[], bucket: KindBucket): boolean {
  const members = BUCKET_MEMBERS[bucket];
  return members.length > 0 && members.every((k) => kinds.includes(k));
}

/** All-on ↔ all-off. A mixed 详细 selection looks off and a click turns every member on. */
export function toggleBucket(kinds: readonly EntityKind[], bucket: KindBucket): EntityKind[] {
  const members = BUCKET_MEMBERS[bucket];
  if (bucketOn(kinds, bucket)) return kinds.filter((k) => !members.includes(k));
  return [...new Set([...kinds, ...members])];
}

/**
 * Cloud visibility. Primary kind is the exclusive bucket (`w.kind` = strongest tag);
 * `generic` is a suppress flag on top. `system` never shows.
 *
 * Replaces the old any-tag-on predicate, which left 赵总 on the cloud after
 * 「人物」 was switched off (it also carries `title`) and left 咖啡 on after
 * 「常见词」 was switched off (it also carries `drink`).
 */
export function wordVisible(
  // conf comes along on the real Word shape (see types.ts); accept it rather than reject the literal
  w: { kind: EntityKind; kinds?: { kind: EntityKind; conf?: number }[] },
  on: ReadonlySet<EntityKind>,
): boolean {
  if (w.kind === 'system') return false;
  if (!on.has(w.kind)) return false;
  const tags = w.kinds ?? [{ kind: w.kind }];
  if (tags.some((k) => k.kind === 'generic') && !on.has('generic')) return false;
  return true;
}
