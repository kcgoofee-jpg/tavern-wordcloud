import type { NsfwKind } from '../core/nsfw';

/** UI labels for explicit-word categories. A function of `t` so every entry is a literal `t('…')` call. */
export const nsfwLabel = (t: (s: string) => string): Record<NsfwKind, string> => ({
  act: t('性行为'),
  organ: t('性器官'),
  fluid: t('体液'),
  arousal: t('情欲'),
  voice: t('淫声'),
  face: t('五官'),
  kink: t('性癖'),
  slur: t('露骨称呼'),
  profanity: t('粗口'),
  taboo: t('禁忌与交易'),
  porn: t('色情作品'),
  body: t('身体'),
  scent: t('气味'),
  bdsm: t('调教道具'),
  wear: t('衣物用品'),
  maybe: t('可能误判'),
});
