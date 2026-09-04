import { useContext } from 'react';
import { LangContext, useT } from './i18n';
import { renderMarkdown } from '../legal/markdown';
import type { LegalRoute } from './hooks/useHashRoute';
import termsZh from '../legal/terms.zh.md?raw';
import termsEn from '../legal/terms.en.md?raw';
import privacyZh from '../legal/privacy.zh.md?raw';
import privacyEn from '../legal/privacy.en.md?raw';
import disclaimerZh from '../legal/disclaimer.zh.md?raw';
import disclaimerEn from '../legal/disclaimer.en.md?raw';
import contentZh from '../legal/content.zh.md?raw';
import contentEn from '../legal/content.en.md?raw';
import enforcementZh from '../legal/enforcement.zh.md?raw';
import enforcementEn from '../legal/enforcement.en.md?raw';

const CONTENT: Record<LegalRoute, Record<'zh' | 'en', string>> = {
  terms: { zh: termsZh, en: termsEn },
  privacy: { zh: privacyZh, en: privacyEn },
  disclaimer: { zh: disclaimerZh, en: disclaimerEn },
  content: { zh: contentZh, en: contentEn },
  enforcement: { zh: enforcementZh, en: enforcementEn },
};

/** A function of `t` so titles are literal `t('…')` calls. */
const titleOf = (t: (s: string) => string): Record<LegalRoute, string> => ({
  terms: t('服务条款'),
  privacy: t('隐私政策'),
  disclaimer: t('免责声明'),
  content: t('内容政策'),
  enforcement: t('执法配合政策'),
});

/** Full-screen legal document page for the `#/…` routes. Follows the UI language. */
export default function LegalPage({ route }: { route: LegalRoute }) {
  const t = useT();
  const lang = useContext(LangContext);
  const back = <a className="legal-back" href="#">{t('← 返回词云')}</a>;
  return (
    <div className="legal-page" role="document" aria-label={titleOf(t)[route]}>
      <div className="legal-body">
        {back}
        {renderMarkdown(CONTENT[route][lang])}
        {back}
      </div>
    </div>
  );
}
