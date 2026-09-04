/**
 * Pixel sizes each platform recommends for a single still image.
 * Researched in notes/docs/30; the Chinese platforms do not publish pixel values,
 * so those rows are the long-standing community consensus rather than a spec.
 *
 * Labels are stored per language instead of going through `t()`: they are proper
 * nouns plus a size, not UI copy, and the i18n table would gain fifteen rows for
 * strings that barely change between languages.
 */
export interface PlatformPreset {
  id: string;
  label: { zh: string; en: string };
  w: number;
  h: number;
  /** One line for the option's title attribute. */
  note: { zh: string; en: string };
}

export const PLATFORM_PRESETS: readonly PlatformPreset[] = [
  { id: 'ig-square', label: { zh: 'Instagram 方图', en: 'Instagram square' }, w: 1080, h: 1080, note: { zh: '1:1，上限 30 MB', en: '1:1, up to 30 MB' } }, // i18n-exempt: proper nouns, kept per-language in the table itself
  { id: 'ig-portrait', label: { zh: 'Instagram 竖版', en: 'Instagram portrait' }, w: 1080, h: 1350, note: { zh: '4:5，信息流里最高', en: '4:5, tallest in the feed' } }, // i18n-exempt: proper nouns, kept per-language in the table itself
  { id: 'ig-story', label: { zh: 'Instagram 快拍', en: 'Instagram Story' }, w: 1080, h: 1920, note: { zh: '9:16 全屏', en: '9:16 full screen' } }, // i18n-exempt: proper nouns, kept per-language in the table itself
  { id: 'tiktok', label: { zh: 'TikTok 竖版', en: 'TikTok vertical' }, w: 1080, h: 1920, note: { zh: '9:16，上限 20 MB', en: '9:16, up to 20 MB' } }, // i18n-exempt: proper nouns, kept per-language in the table itself
  { id: 'discord-server', label: { zh: 'Discord 服务器横幅', en: 'Discord server banner' }, w: 1920, h: 1080, note: { zh: '16:9，最小 960×540', en: '16:9, 960×540 minimum' } }, // i18n-exempt: proper nouns, kept per-language in the table itself
  { id: 'discord-profile', label: { zh: 'Discord 个人横幅', en: 'Discord profile banner' }, w: 600, h: 240, note: { zh: '5:2', en: '5:2' } }, // i18n-exempt: proper nouns, kept per-language in the table itself
  { id: 'discord-post', label: { zh: 'Discord 帖子配图', en: 'Discord post image' }, w: 1200, h: 675, note: { zh: '嵌入预览按 16:9 裁', en: 'Embeds crop to 16:9' } }, // i18n-exempt: proper nouns, kept per-language in the table itself
  { id: 'xhs-portrait', label: { zh: '小红书 竖版', en: 'Xiaohongshu portrait' }, w: 1242, h: 1660, note: { zh: '3:4 封面', en: '3:4 cover' } }, // i18n-exempt: proper nouns, kept per-language in the table itself
  { id: 'xhs-square', label: { zh: '小红书 方图', en: 'Xiaohongshu square' }, w: 1080, h: 1080, note: { zh: '1:1 封面', en: '1:1 cover' } }, // i18n-exempt: proper nouns, kept per-language in the table itself
  { id: 'weibo', label: { zh: '微博 配图', en: 'Weibo image' }, w: 1080, h: 1080, note: { zh: '推荐 1080 宽', en: '1080 px wide' } }, // i18n-exempt: proper nouns, kept per-language in the table itself
  { id: 'weibo-long', label: { zh: '微博 长图', en: 'Weibo long image' }, w: 800, h: 2000, note: { zh: '2:5 长图', en: '2:5 long form' } }, // i18n-exempt: proper nouns, kept per-language in the table itself
  { id: 'douban', label: { zh: '豆瓣 相册', en: 'Douban album' }, w: 1080, h: 1440, note: { zh: '3:4', en: '3:4' } }, // i18n-exempt: proper nouns, kept per-language in the table itself
  { id: 'wechat-square', label: { zh: '朋友圈 方图', en: 'WeChat Moments square' }, w: 1080, h: 1080, note: { zh: '1:1，超 20 MB 会被二压', en: '1:1, recompressed past 20 MB' } }, // i18n-exempt: proper nouns, kept per-language in the table itself
  { id: 'wechat-portrait', label: { zh: '朋友圈 竖图', en: 'WeChat Moments portrait' }, w: 1080, h: 1350, note: { zh: '4:5', en: '4:5' } }, // i18n-exempt: proper nouns, kept per-language in the table itself
  { id: 'bilibili', label: { zh: 'B 站动态', en: 'Bilibili post' }, w: 1080, h: 1080, note: { zh: '1:1，横版按 1280×800 裁', en: '1:1; landscape crops to 1280×800' } }, // i18n-exempt: proper nouns, kept per-language in the table itself
] as const;
