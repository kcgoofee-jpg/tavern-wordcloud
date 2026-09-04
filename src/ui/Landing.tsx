import { useEffect, useState } from 'react';
import Icon from './Icons';
import Footer from './Footer';
import { useT, type Lang } from './i18n';
import type { CloudMode } from './settings';

const MOBILE_HINT_KEY = 'tw-mobile-hint-dismissed';
const MOBILE_MAX_WIDTH = 768;

/** Narrow-viewport banner nudging toward desktop for the wider panels and cleaner export; dismissal sticks via localStorage. */
function MobileHint() {
  const t = useT();
  const [narrow, setNarrow] = useState(false);
  const [dismissed, setDismissed] = useState(() => {
    try { return localStorage.getItem(MOBILE_HINT_KEY) === '1'; } catch { return false; }
  });

  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${MOBILE_MAX_WIDTH}px)`);
    const update = () => setNarrow(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);

  if (!narrow || dismissed) return null;
  const dismiss = () => {
    setDismissed(true);
    try { localStorage.setItem(MOBILE_HINT_KEY, '1'); } catch { /* private mode etc: dismissal just won't persist */ }
  };
  return (
    <div className="mobile-hint" role="note">
      <span>{t('手机上能用，但电脑浏览器体验更好：面板更宽、导出更清晰')}</span>
      <button type="button" className="mobile-hint-close" title={t('关闭提示')} onClick={dismiss}>
        <Icon name="close" size={13} />
      </button>
    </div>
  );
}

/**
 * Landing page: shown instead of the bare hero when there is no file, no share
 * link and the sample view is not open. The app-level drop handler on `.app`
 * already covers drops anywhere on this page.
 */
export default function Landing({
  hasServer, keywordMode, aiReady, onCloudMode,
  communityActive, onToggleCommunity,
  dark, onToggleScheme, lang, onToggleLang,
  onPickFile, onShowSample,
}: {
  /** True when this page is served with a working API: text is uploaded for processing. */
  hasServer: boolean;
  keywordMode: boolean;
  aiReady: boolean;
  onCloudMode: (m: CloudMode) => void;
  communityActive: boolean;
  onToggleCommunity: () => void;
  dark: boolean;
  onToggleScheme: () => void;
  lang: Lang;
  onToggleLang: () => void;
  onPickFile: () => void;
  onShowSample: () => void;
}) {
  const t = useT();
  return (
    <div className="landing">
      <MobileHint />
      <header className="land-top">
        <span className="land-logo">{t('酒馆词云')}</span>
        <div className="seg" role="group" aria-label={t('词云模式')}>
          <button type="button" className={!keywordMode ? 'on' : ''} aria-pressed={!keywordMode}
            title={t('统计出现最多的词。免费、半秒出结果')}
            onClick={() => onCloudMode('freq')}>
            <Icon name="chart" size={15} />{t('词频')}
          </button>
          <button type="button" className={keywordMode ? 'on' : ''} aria-pressed={keywordMode}
            title={aiReady
              ? t('让大模型读完整份聊天，挑出这个故事独有的词。整份正文会发给你配的接口')
              : t('还没配接口——点一下去配')}
            onClick={() => onCloudMode('keyword')}>
            <Icon name="chip" size={15} />{t('关键词')}
          </button>
        </div>
        <div className="land-acts">
          <button type="button" className={`land-btn${communityActive ? ' on' : ''}`}
            title={t('社区排行榜')} aria-pressed={communityActive} onClick={onToggleCommunity}>
            <Icon name="chart" size={17} />
          </button>
          <button type="button" className="land-btn"
            title={dark ? t('深色 · 点一下切到淡色') : t('淡色 · 点一下切到深色')}
            onClick={onToggleScheme}>
            <Icon name={dark ? 'moon' : 'sun'} size={17} />
          </button>
          <button type="button" className="land-btn"
            title={lang === 'zh' ? 'Switch to English' : '切换到中文'}
            onClick={onToggleLang}>
            <Icon name="lang" size={17} />
          </button>
        </div>
      </header>

      <main className="land-hero">
        <h1 className="land-title">{t('把酒馆的聊天记录，变成一张词云')}</h1>
        <p className="land-sub">{t('拖入 SillyTavern 的聊天文件，自动洗掉插件残留，按词频或大模型挑出的关键词出图。')}</p>

        <button type="button" className="land-drop" onClick={onPickFile}>
          <span className="land-drop-big">{t('把聊天记录拖进来，或点击选择')}</span>
          <span className="land-drop-hint">{t('支持整包拖入，一次解析全部角色')}</span>
        </button>

        <div className="land-chips" aria-label={t('支持的文件格式')}>
          <span className="land-chip">.jsonl</span>
          <span className="land-chip">.json</span>
          <span className="land-chip">.txt</span>
          <span className="land-chip">{t('整包 .zip')}</span>
          <span className="land-chip">{t('词云 .png')}</span>
        </div>

        <p className="land-privacy">
          {hasServer ? (
            <>
              {t('记录会上传到服务器处理，处理完即丢弃。')}
              <a href="#/privacy">{t('《隐私政策》')}</a>
            </>
          ) : t('所有处理都在这台电脑上，不出网。')}
        </p>

        <div className="land-guide">
          <details className="land-export">
            <summary>{t('聊天记录从哪导出？')}</summary>
            <ol className="land-steps">
              <li>{t('打开 SillyTavern 的数据目录，进入 default-user/chats。')}</li>
              <li>{t('每个角色一个文件夹，里面是按日期命名的 .jsonl 聊天文件。')}</li>
              <li>{t('把文件（或整个文件夹打包成 zip）拖进上面的虚线框即可。')}</li>
            </ol>
          </details>
          <button type="button" className="land-sample" onClick={onShowSample}>{t('先看示例')}</button>
        </div>

        <p className="land-disclaimer">
          {hasServer ? t('上传即表示你有权使用这些记录并用于分析。服务器不保存正文，处理完即丢弃；结果仅供参考。')
            : t('上传即表示你有权使用这些记录并用于分析。所有处理都在这台电脑上完成，不出网；结果仅供参考。')}
          <a href="#/disclaimer">{t('《免责声明》')}</a>
          <a href="#/privacy">{t('《隐私政策》')}</a>
        </p>
      </main>

      <section className="land-feats" aria-label={t('特性')}>
        <article className="land-feat">
          <h2>{t('清洗插件残留')}</h2>
          <p>{t('自动剥掉思维链、状态栏、指令块等插件注入的杂质，只留角色真正说出口的话。')}</p>
        </article>
        <article className="land-feat">
          <h2>{t('大模型挑关键词')}</h2>
          <p>{t('不止数词频——让大模型通读全文，挑出这段故事真正的题眼，可接自己的接口。')}</p>
        </article>
        {hasServer ? (
          <article className="land-feat">
            <h2>{t('完全离线的本地版')}</h2>
            <p>{t('单文件、双击即用，所有处理都在自己电脑上，不出网；敏感记录用它更安心。')}</p>
          </article>
        ) : (
          <article className="land-feat">
            <h2>{t('你正在用本地版')}</h2>
            <p>{t('这份文件就是完整程序，处理全在本机完成、不联网。网页版功能相同，多一个社区排行榜。')}</p>
          </article>
        )}
      </section>

      <Footer local={!hasServer} />
    </div>
  );
}
