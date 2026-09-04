import { useContext } from 'react';
import { LangContext, useT } from './i18n';

const GITHUB = 'https://github.com/kcgoofee-jpg/tavern-wordcloud';
const MANUAL_ZH = 'https://github.com/kcgoofee-jpg/tavern-wordcloud/blob/main/docs/%E4%BD%BF%E7%94%A8%E6%89%8B%E5%86%8C.md';
const MANUAL_EN = 'https://github.com/kcgoofee-jpg/tavern-wordcloud/blob/main/docs/manual.en.md';
/** The hosted server hands out the same single-file build (server/index.ts `/download/index.html`). */
const LOCAL = 'https://wordcloud.davidzhao.top/download/index.html';

/**
 * Site footer: legal pages, manual, GitHub, local version, copyright. Shown on
 * the landing only; the cloud view keeps its bottom edge free for the rail.
 * On narrow screens the links collapse into a <details> menu (CSS).
 */
/** `local`: the page is the offline single file; no point offering itself for download. */
export default function Footer({ local = false }: { local?: boolean }) {
  const t = useT();
  const lang = useContext(LangContext);
  const links: { label: string; href: string; external?: boolean }[] = [
    { label: t('服务条款'), href: '#/terms' },
    { label: t('隐私政策'), href: '#/privacy' },
    { label: t('免责声明'), href: '#/disclaimer' },
    { label: t('内容政策'), href: '#/content' },
    { label: t('执法配合政策'), href: '#/enforcement' },
    { label: t('使用手册'), href: lang === 'en' ? MANUAL_EN : MANUAL_ZH, external: true },
    { label: 'GitHub', href: GITHUB, external: true },
    ...(local ? [] : [{ label: t('下载本地版'), href: LOCAL, external: true }]),
  ];
  const nav = (
    <nav aria-label={t('站点链接')}>
      {links.map((l) => (
        <a key={l.href} href={l.href} {...(l.external ? { target: '_blank', rel: 'noreferrer noopener' } : {})}>
          {l.label}
        </a>
      ))}
    </nav>
  );
  return (
    <footer className="foot">
      {nav}
      <details className="foot-menu">
        <summary>{t('链接')}</summary>
        {nav}
      </details>
      <p>{t('© {y} 酒馆词云 · 与 SillyTavern 官方无关的同人工具', { y: new Date().getFullYear() })}</p>
    </footer>
  );
}
