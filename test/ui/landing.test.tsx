// @vitest-environment happy-dom
/** Landing, footer, legal pages and the #/ route handling. */
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import Landing from '../../src/ui/Landing';
import Footer from '../../src/ui/Footer';
import LegalPage from '../../src/ui/LegalPage';
import { LangContext } from '../../src/ui/i18n';
import { parseRoute } from '../../src/ui/hooks/useHashRoute';
import { readShareFromLocation } from '../../src/share/share';

afterEach(() => { cleanup(); window.location.hash = ''; });

const landingProps = () => ({
  hasServer: false,
  keywordMode: false,
  aiReady: false,
  onCloudMode: vi.fn(),
  communityActive: false,
  onToggleCommunity: vi.fn(),
  dark: true,
  onToggleScheme: vi.fn(),
  lang: 'zh' as const,
  onToggleLang: vi.fn(),
  onPickFile: vi.fn(),
  onShowSample: vi.fn(),
});

describe('Landing', () => {
  it('renders the title, upload card, format chips, guide and feature band', () => {
    render(<Landing {...landingProps()} hasServer />);
    expect(screen.getByRole('heading', { name: '把酒馆的聊天记录，变成一张词云' })).toBeTruthy();
    expect(screen.getByRole('button', { name: /把聊天记录拖进来，或点击选择/ })).toBeTruthy();
    for (const chip of ['.jsonl', '.json', '.txt', '整包 .zip', '词云 .png']) {
      expect(screen.getByText(chip)).toBeTruthy();
    }
    expect(screen.getByText('聊天记录从哪导出？')).toBeTruthy();
    expect(screen.getByText('清洗插件残留')).toBeTruthy();
    expect(screen.getByText('大模型挑关键词')).toBeTruthy();
    expect(screen.getByText('完全离线的本地版')).toBeTruthy();
    expect(screen.getAllByRole('link', { name: '下载本地版' }).length).toBeGreaterThan(0);
  });

  it('the manual link follows the UI language', () => {
    render(<LangContext.Provider value="en"><Footer /></LangContext.Provider>);
    expect(screen.getAllByRole('link', { name: 'User manual' })[0].getAttribute('href')).toContain('manual.en.md');
  });

  it('the local edition neither advertises nor links its own download', () => {
    render(<Landing {...landingProps()} />);
    expect(screen.getByText('你正在用本地版')).toBeTruthy();
    expect(screen.queryByRole('link', { name: '下载本地版' })).toBeNull();
  });

  it('privacy line follows the processing path: server vs local', () => {
    const { unmount } = render(<Landing {...landingProps()} hasServer />);
    expect(screen.getByText(/记录会上传到服务器处理，处理完即丢弃。/)).toBeTruthy();
    expect(screen.getByText(/服务器不保存正文/)).toBeTruthy();
    unmount();
    render(<Landing {...landingProps()} />);
    expect(screen.getByText(/所有处理都在这台电脑上，不出网。/)).toBeTruthy();
    expect(screen.getByText(/不出网；结果仅供参考。/)).toBeTruthy();
  });

  it('upload card, sample button and top bar controls call back', async () => {
    const user = userEvent.setup();
    const props = landingProps();
    render(<Landing {...props} />);
    await user.click(screen.getByRole('button', { name: /把聊天记录拖进来，或点击选择/ }));
    expect(props.onPickFile).toHaveBeenCalledOnce();
    await user.click(screen.getByRole('button', { name: '先看示例' }));
    expect(props.onShowSample).toHaveBeenCalledOnce();
    await user.click(screen.getByTitle('社区排行榜'));
    expect(props.onToggleCommunity).toHaveBeenCalledOnce();
    await user.click(screen.getByTitle('深色 · 点一下切到淡色'));
    expect(props.onToggleScheme).toHaveBeenCalledOnce();
    await user.click(screen.getByTitle('Switch to English'));
    expect(props.onToggleLang).toHaveBeenCalledOnce();
    await user.click(screen.getByRole('button', { name: /关键词/ }));
    expect(props.onCloudMode).toHaveBeenCalledWith('keyword');
  });

  it('disclaimer and privacy lines link to the legal routes', () => {
    render(<Landing {...landingProps()} hasServer />);
    const hrefs = screen.getAllByRole('link').map((a) => a.getAttribute('href'));
    expect(hrefs).toContain('#/disclaimer');
    expect(hrefs).toContain('#/privacy');
  });
});

describe('Footer', () => {
  it('lists the five legal routes plus manual, GitHub, local download and copyright', () => {
    render(<Footer />);
    const byHref = (h: string) => screen.getAllByRole('link').filter((a) => a.getAttribute('href') === h);
    for (const h of ['#/terms', '#/privacy', '#/disclaimer', '#/content', '#/enforcement']) {
      expect(byHref(h).length).toBeGreaterThan(0);
    }
    expect(screen.getAllByRole('link', { name: 'GitHub' })[0].getAttribute('href')).toContain('github.com');
    expect(screen.getAllByRole('link', { name: '使用手册' })[0].getAttribute('href')).toContain('%E4%BD%BF%E7%94%A8%E6%89%8B%E5%86%8C');
    expect(screen.getAllByRole('link', { name: '下载本地版' })[0].getAttribute('href')).toContain('/download/index.html');
    expect(screen.getByText(/与 SillyTavern 官方无关的同人工具/)).toBeTruthy();
  });
});

describe('LegalPage', () => {
  it('renders the Chinese document for the route, with a back link', () => {
    render(<LegalPage route="privacy" />);
    expect(screen.getByRole('heading', { level: 1, name: '隐私政策' })).toBeTruthy();
    expect(screen.getByText(/处理完立即丢弃/)).toBeTruthy();
    for (const back of screen.getAllByRole('link', { name: '← 返回词云' })) {
      expect(back.getAttribute('href')).toBe('#');
    }
  });

  it('follows the UI language and renders the table route', () => {
    render(
      <LangContext.Provider value="en">
        <LegalPage route="enforcement" />
      </LangContext.Provider>,
    );
    expect(screen.getByRole('heading', { level: 1, name: 'Law Enforcement & Legal Request Policy' })).toBeTruthy();
    // The retained-data table becomes a real table
    expect(screen.getByRole('table')).toBeTruthy();
    expect(screen.getByText('Access logs')).toBeTruthy();
  });

  it('cross-document markdown links become in-app routes', () => {
    render(<LegalPage route="disclaimer" />);
    expect(screen.getAllByRole('link', { name: /服务条款/ })[0].getAttribute('href')).toBe('#/terms');
  });
});

describe('hash routing', () => {
  it('parses only the five legal routes', () => {
    expect(parseRoute('#/terms')).toBe('terms');
    expect(parseRoute('#/privacy')).toBe('privacy');
    expect(parseRoute('#/disclaimer')).toBe('disclaimer');
    expect(parseRoute('#/content')).toBe('content');
    expect(parseRoute('#/enforcement')).toBe('enforcement');
    expect(parseRoute('#/nope')).toBeNull();
    expect(parseRoute('')).toBeNull();
    expect(parseRoute('#c=abc')).toBeNull();
  });

  it('readShareFromLocation ignores route hashes', async () => {
    await expect(readShareFromLocation('#/privacy')).resolves.toBeNull();
    // Garbage share payloads still decode-fail to null rather than throwing
    await expect(readShareFromLocation('#c=%%')).resolves.toBeNull();
  });
});
