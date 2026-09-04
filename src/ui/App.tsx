import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { copyText } from './clipboard';
import { endpointKind } from './endpointKind';
import { LangContext, tx, txv, type UserText } from './i18n';
import { probeServer, analyzeOnServer, type ServerHealth } from '../net/server';
import CardInfo from './CardInfo';
import CloudCanvas, { type CloudApi } from './CloudCanvas';
import Icon, { type IconName } from './Icons';
import ImportPanel, { type ImportSummary } from './ImportPanel';
import ConfirmDialog from './ConfirmDialog';
import Landing from './Landing';
import LegalPage from './LegalPage';
import Note from './Note';
import Progress from './Progress';
import { AdvancedPanel, AiPanel, CommunityPanel, ExportPanel, FilterPanel, FontPanel, PriorityPanel, ReviewPanel, ThemePanel, WordsPanel, type CommunityStats } from './panels';
import { FEATURES } from './flags';
import type { SourceFile } from '../core/analyze';
import { classifyError, notice, type AppError } from '../core/errors';
import { buildShareUrl, decodeSharePayload, encodeSharePayload, readShareFromLocation, type BuiltShare } from '../share/share';
import { PNG_KEYWORD, readText } from '../share/png';
import { isRegexScriptFile, mergeRules, parseRegexScripts } from '../core/regexScripts';
import { proposeCleanRules } from '../core/proposeRules';
import { applyOverrides, applyPriority, parsePriority } from '../core/overrides';
import { relayFetch } from '../net/relay';
import { resolveMode } from '../theme/themes';
import { toTraditional } from '../theme/s2t';
import { isDirty, resetSlice, type ResetScope } from './settings';
import { useSettings } from './hooks/useSettings';
import { useAnalyzeWorker } from './hooks/useAnalyzeWorker';
import { useOverlay } from './hooks/useOverlay';
import { useNotice } from './hooks/useNotice';
import { useFlash } from './hooks/useFlash';
import { useHashRoute } from './hooks/useHashRoute';
import { useIsNarrow } from './hooks/useIsNarrow';
import { downloadBlob, exportName, outputSize, svgBlob, wordsToCsv, wordsToJson, wordsToTsv } from './export';
import { watermarkPayload } from './watermark';
import { hostOf } from './url';
import { armErrorReporting, reportError } from '../net/report';
import { DEMO_WORDS } from './demo';
import type { AnalysisResult, WordCount } from '../core/types';
import type { CurateResult } from '../core/curate';
import type { WorkerProgress } from '../worker/analyze.worker';
import type { DataBundle } from '../core/bundle';
import './styles/index.css';

type PanelId = 'theme' | 'font' | 'filter' | 'advanced' | 'words' | 'review' | 'ai' | 'export' | 'community';

/** Panel -> title + reset scope. Panels without a scope have no reset button. A function of `t` so titles are literal `t('…')` calls. */
const panelMeta = (t: (s: string) => string): Record<PanelId, { title: string; reset?: ResetScope; resetHint?: string }> => ({
  theme: { title: t('风格与配色'), reset: 'theme', resetHint: t('主题、配色和深浅模式') },
  font: { title: t('词云字体'), reset: 'font', resetHint: t('字体设置') },
  filter: { title: t('筛选与分词'), reset: 'filter', resetHint: t('统计范围、词类、NSFW、清洗开关和竖排比例；不动接口和密钥') },
  advanced: { title: t('高级设置'), reset: 'advanced', resetHint: t('新词发现、自定义词、禁词表和清洗细项') },
  words: { title: t('词频表'), reset: 'words', resetHint: t('拆开的词') },
  review: { title: t('检查分类') },
  ai: { title: t('大模型接口'), reset: 'ai', resetHint: t('接口地址、模型、密钥和关键词个数') },
  export: { title: t('导出'), reset: 'export', resetHint: t('导出选项') },
  community: { title: t('社区排行榜') },
});


/** The rail holds functional tools; design tools (palette, font) live in the bottom-left dock. */
/** Icon-only rail: the label is the tooltip and the accessible name, never printed under the icon. */
const tools = (t: (s: string) => string): { id: PanelId; icon: IconName; label: string }[] => [
  { id: 'filter', icon: 'sliders', label: t('筛选与分词') },
  { id: 'words', icon: 'list', label: t('词频表') },
  { id: 'review', icon: 'check', label: t('检查分类') },
  { id: 'advanced', icon: 'gear', label: t('高级设置') },
  { id: 'ai', icon: 'plug', label: t('大模型接口 · 密钥') },
];

export default function App() {
  const filesRef = useRef<SourceFile[]>([]);
  const cloudRef = useRef<CloudApi>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // All adjustable state lives in one object (settings); load/persist/theme are in the hook
  const { settings, setSettings, patch, setOptions, t, theme } = useSettings();
  const { themeId, custom, options, rotateRatio } = settings;
  const [error, setError] = useState<AppError | null>(null);
  const onWorkerError = useCallback((e: Error) => setError(classifyError(e)), []);
  const workerDown = useCallback(() => t('worker 没起来'), [t]);
  const { send, progress, pct, setProgress, progressLog, setProgressLog, applyNetProgress } =
    useAnalyzeWorker(onWorkerError, workerDown);
  // Panel / card / confirm-dialog exclusivity, sample view and click-outside handling live in the hook
  const { panel, cardOpen, openPanel, openCard, closeAll, confirm, askConfirm, closeConfirm, sampleOpen, openSample, closeSample, communityCloud, cycleCommunity, noticeOpen, toggleNotice, versionOpen, toggleVersion } = useOverlay<PanelId>();
  // Enter starts whatever primary action is on screen (import "开始", keyword-mode "hero" run) —
  // but never while the user is typing in a text control (textarea/input/select/contenteditable).
  /** Legal page route from `#/…` hashes; null on the main page and on `#c=…` share links. */
  const legalRoute = useHashRoute();
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [sharedWords, setSharedWords] = useState<AnalysisResult['words'] | null>(null);
  const [hasFiles, setHasFiles] = useState(false);
  /** Import generation counter: incremented on every import so the analysis effect re-runs even when `hasFiles` stays true. */
  const [loadSeq, setLoadSeq] = useState(0);
  const [share, setShare] = useState<BuiltShare | null>(null);
  const [copied, flashCopied] = useFlash(1800);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  /** Site notice from the server. The single-file build has none, so the bell stays hidden. */
  const { notice: siteNotice, unread: noticeUnread, updateAvailable } = useNotice(noticeOpen, busy);
  /** Progress overlay is delayed 300 ms so quick local recomputes do not flash it. */
  const [showProgress, setShowProgress] = useState(false);
  /** Whether a server exists behind this page. Static hosting has none. */
  const [health, setHealth] = useState<ServerHealth | null>(null);
  /** Abort controller for server-side runs. */
  const netAbort = useRef<AbortController | null>(null);
  const [bundle, setBundle] = useState<Omit<DataBundle, 'chats'> | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const [copiedErr, flashCopiedErr] = useFlash(2000);
  /** "Copied" tick on the export panel's clipboard button. */
  const [copiedWords, flashCopiedWords] = useFlash(1800);
  /** Confirmation panel for large imports: reports what was read and lets the user change re-run options first. */
  const [importAsk, setImportAsk] = useState<ImportSummary | null>(null);
  /** Keyword-mode result. Kept alongside `result` so switching modes does not recompute or re-pay. */
  const [curation, setCuration] = useState<{ words: WordCount[]; result: CurateResult } | null>(null);

  /** Whether keyword mode can run: locally the user must fill endpoint, model and key; on the server a configured server key suffices. */
  const localAiReady = !!options.ai.endpoint && !!options.ai.model && !!options.ai.apiKey;
  /** Which field of the local endpoint is still empty: "needs an API" never said which one. */
  const aiMissing: 'endpoint' | 'model' | 'key' | null =
    !options.ai.endpoint ? 'endpoint' : !options.ai.model ? 'model' : !options.ai.apiKey ? 'key' : null;
  const keywordMode = settings.cloudMode === 'keyword';
  /** Sample cloud: entered from the landing's "sample" button; any click returns to the landing. */
  const demoMode = !hasFiles && !sharedWords && !result && sampleOpen;
  /** Landing page: no data, no share link, not in the sample view, nothing loading. */
  const showLanding = !hasFiles && !sharedWords && !result && !sampleOpen && !busy && !importAsk;

  /** Community board: while the panel is open the canvas shows the aggregate cloud. */
  const [community, setCommunity] = useState<CommunityStats | null>(null);
  const [communityLoading, setCommunityLoading] = useState(false);
  const words = useMemo(() => {
    const base = computeWords();
    // Display only: convert after every other override so a user-set display name is also
    // converted. Original (Simplified) text stays untouched for CSV/JSON/search.
    if (!settings.traditional) return base;
    return base.map((w) => ({ ...w, display: toTraditional(w.display ?? w.text) }));

    function computeWords(): WordCount[] {
    // Community panel: swap the canvas only when the aggregate is available
    if ((panel === 'community' || communityCloud) && community && community.words.length > 0) return community.words.map((w) => ({ text: w.text, count: w.count }));
    if (demoMode) return DEMO_WORDS;
    /**
     * Priority words sit above every other override (notes/docs/27 §1): they run before
     * applyOverrides so a user-hidden word the priority list names still wins. Neither the
     * sample cloud nor the community cloud takes them — those are not the user's own words.
     */
    const pri = parsePriority(settings.priority);
    const apply = (ws: WordCount[]) => applyOverrides(applyPriority(ws, pri), settings.overrides);
    // Keyword mode with no curated words yet is empty; it does not fall back to frequency results.
    if (keywordMode) return apply(curation?.words ?? []);
    if (!result) return apply(sharedWords ?? []);
    // Per-word user overrides (display name / forced rotation) sit between the tokenizer and
    // both consumers, so the cloud and the word table always agree. CSV keeps the original text.
    const ov = settings.kindOverrides;
    if (Object.keys(ov).length === 0) return apply(result.words);
    /**
     * Hand-filed words. The core classification stands; this only moves words across
     * the kind buttons: drop what the user re-filed into a hidden kind, and bring back
     * what was hidden but now belongs to a shown one (same minCount the core used).
     */
    const shown = new Set(options.kinds);
    const kept = result.words.filter((w) => !(w.text in ov) || shown.has(ov[w.text]));
    const inCloud = new Set(kept.map((w) => w.text));
    const added = result.allWords.filter((w) => (
      w.text in ov && shown.has(ov[w.text]) && !inCloud.has(w.text)
      && w.count >= options.tokenize.minCount
    ));
    const filed = [...kept, ...added].sort((a, b) => b.count - a.count).slice(0, options.tokenize.maxWords);
    return apply(filed);
    }
  }, [demoMode, keywordMode, curation, result, sharedWords, panel, communityCloud, community, settings.kindOverrides, settings.overrides, settings.priority, options.kinds, options.tokenize.minCount, options.tokenize.maxWords, settings.traditional]);
  // Denominator is countedTokens (tokens in the table), not totalTokens.
  const totalTokens = result?.countedTokens ?? words.reduce((a, w) => a + w.count, 0);
  const active = hovered ? words.find((w) => w.text === hovered) : undefined;
  const ratio = active && totalTokens > 0 ? active.count / totalTokens : 0;

  // Probe the server once at startup; failures count as no server
  useEffect(() => {
    const ac = new AbortController();
    void probeServer(ac.signal).then((h) => {
      setHealth(h);
      if (h?.ok) armErrorReporting();
      // Served by the server but the API is unreachable: a browser extension or network filter is blocking it
    });
    return () => ac.abort();
  }, []);

  /** The hosted version always runs on the server; local computation only when no server is detected. */
  const onServer = !!health?.ok;
  /** Page served by the site's own server: analysis must go through the API, never local. */
  const served = typeof document !== 'undefined' && !!document.querySelector('meta[name="wc-served"]');
  /** Model name used for curation: always the visitor's own endpoint. */
  const curateModel = options.ai.model;

  // Filter changes invalidate the curated words: the model saw a different text.
  useEffect(() => { setCuration(null); }, [options.roles, options.onlyCharacter, options.source, options.clean]);

  // Share links carry the cloud; hashchange covers pasting into an open page.
  useEffect(() => {
    const apply = () => {
      void readShareFromLocation(window.location.hash).then((p) => {
        if (!p || p.words.length === 0) return;
        filesRef.current = [];
        setHasFiles(false); setResult(null); setShare(null);
        setSharedWords(p.words);
        // Apply the palette from the link as well
        if (p.themeConf) {
          patch({ themeId: p.themeConf.themeId, mode: p.themeConf.mode });
        } else if (p.theme) {
          patch({ themeId: p.theme });
        }
      });
    };
    apply();
    window.addEventListener('hashchange', apply);
    return () => window.removeEventListener('hashchange', apply);
  }, [patch]);

  /** Parse warnings: the toast shows the first with a count; all of them land in the progress log. */
  const showWarnings = useCallback((warnings: UserText[]) => {
    if (!warnings.length) return;
    const first = txv(warnings[0]);
    setError(notice(warnings.length > 1
      ? t('{first}（共 {n} 条）', { first, n: warnings.length })
      : first));
    setProgressLog((l) => [...l, ...warnings.map(txv)].slice(-8));
  }, [t, setProgressLog]);

  /** A second import while a result is showing must be a deliberate replacement (user decision 2026-09-04). */
  const [pendingImport, setPendingImport] = useState<File[] | null>(null);
  const ingest = useCallback(async (list: File[], replace = false) => {
    if (!replace && (filesRef.current.length > 0 || result || sharedWords)) { setPendingImport(list); return; }
    if (replace) { filesRef.current = []; setHasFiles(false); setResult(null); setSharedWords(null); setShare(null); setBundle(null); }
    // Inputs: single chat (jsonl/json), plain-text export (txt), full export (zip),
    // and cloud PNGs, which carry their word table
    const pngs = list.filter((f) => /\.png$/i.test(f.name));
    if (pngs.length) {
      // A cloud PNG is a result, not input text; mixing it with chat logs would silently drop one side
      if (pngs.length < list.length) setError(notice(t('图片不能和聊天记录一起拖入，已只读图片')));
      else if (pngs.length > 1) setError(notice(t('一次只读一张词云图，已用第一张')));
      const p = await decodeSharePayload(readText(new Uint8Array(await pngs[0].arrayBuffer()), PNG_KEYWORD) ?? '');
      if (!p || p.words.length === 0) { setError(notice(t('这张图里没有词云数据（只有本站导出的 PNG 才带）'))); return; }
      filesRef.current = []; setHasFiles(false); setResult(null); setShare(null); closeSample();
      setSharedWords(p.words);
      if (p.themeConf) {
        const font = p.themeConf.font as Partial<typeof settings.font> | undefined;
        patch({ themeId: p.themeConf.themeId, mode: p.themeConf.mode, ...(p.themeConf.custom ? { custom: p.themeConf.custom } : {}), ...(font ? { font: { ...settings.font, ...font } } : {}) });
      }
      return;
    }
    const zips = list.filter((f) => /\.zip$/i.test(f.name));
    let plain = list.filter((f) => /\.(jsonl|json|txt)$/i.test(f.name));
    // SillyTavern regex exports (.json arrays of scripts) become cleaning rules rather than chats
    const ruleFiles: File[] = [];
    for (const f of plain.filter((x) => /\.json$/i.test(x.name))) {
      try { const j = JSON.parse(await f.text()) as unknown; if (isRegexScriptFile(j)) ruleFiles.push(f); } catch { /* not JSON: parsed as a chat later */ }
    }
    if (ruleFiles.length) {
      plain = plain.filter((f) => !ruleFiles.includes(f));
      let added = 0;
      for (const f of ruleFiles) {
        const rules = parseRegexScripts(JSON.parse(await f.text()) as unknown);
        added += rules.length;
        setOptions((o) => ({ ...o, clean: { ...o.clean, customRules: mergeRules(o.clean.customRules, rules) } }));
      }
      setError(notice(t('读到 {n} 条正则规则，会用来清洗这份记录', { n: added })));
      if (zips.length === 0 && plain.length === 0) return;
    }
    if (zips.length === 0 && plain.length === 0) {
      setError(classifyError(new Error(t('认不出格式：需要 .jsonl / .json / .txt、整包 .zip、正则脚本 .json，或本站导出的词云 .png'))));
      return;
    }
    setBusy(true); setError(null); setProgressLog([]);
    try {
      if (zips.length) {
        // Full export: unzipped in the worker
        const z = zips[0];
        if (zips.length > 1) setError(notice(t('一次只能读一个整包，已经用了第一个')));
        setProgress({ phase: 'unzip', done: 0, total: 1, label: t('正在读压缩包') });
        const buf = await z.arrayBuffer();
        const res = await send({ kind: 'loadBundle', data: buf, name: z.name });
        if (res.ok && res.kind === 'bundle') {
          setBundle(res.bundle);
          setSharedWords(null);
          if (res.bundle.regexScripts?.length) setOptions((o) => ({ ...o, clean: { ...o.clean, customRules: mergeRules(o.clean.customRules, res.bundle.regexScripts) } }));
          setOptions((o) => ({ ...o, onlyCharacter: null, roles: o.roles.filter((r) => r !== 'system') }));
          if (res.bundle.warnings.length) showWarnings(res.bundle.warnings);
          // Full exports always go through the confirmation panel
          setImportAsk({
            fileCount: res.fileCount, chars: res.chars,
            characters: res.characters, bundle: res.bundle, fromZip: true,
          });
          setLoadSeq((n) => n + 1);
        } else if (!res.ok) {
          setError(classifyError(new Error(res.error)));
        }
        return;
      }

      // Per-file read progress
      const read: SourceFile[] = [];
      for (let i = 0; i < plain.length; i++) {
        setProgress({ phase: 'read', done: i, total: plain.length, label: t('正在读文件 {i}/{n}', { i: i + 1, n: plain.length }) });
        read.push({ name: plain[i].name, content: await plain[i].text() });
      }
      // Keep what was loaded before: if the new files turn out to be no chat at all (a preset
      // JSON, a character card), they must not stick around and poison every later import.
      const before = filesRef.current;
      const merged = new Map(before.map((f) => [f.name, f]));
      for (const f of read) merged.set(f.name, f);
      filesRef.current = [...merged.values()];
      setBundle(null);
      setSharedWords(null);
      setOptions((o) => ({ ...o, onlyCharacter: null, roles: o.roles.filter((r) => r !== 'system') }));
      const res = await send({ kind: 'load', files: filesRef.current });
      if (!res.ok) {
        filesRef.current = before;
        if (before.length) void send({ kind: 'load', files: before });
        const bad = read.map((f) => f.name).join('、');
        setError(classifyError(new Error(`${res.error}（${bad}）`)));
        return;
      }
      const chars = filesRef.current.reduce((a, f) => a + f.content.length, 0);
      // Small imports skip the confirmation panel.
      setLoadSeq((n) => n + 1);
      if (res.ok && res.kind === 'load' && (filesRef.current.length >= 3 || chars > 1_500_000)) {
        setImportAsk({ fileCount: res.fileCount, chars, characters: res.characters, bundle: null, fromZip: false });
      } else {
        setHasFiles(true);
      }
    } catch (e) {
      setError(classifyError(e));
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }, [send, setOptions, t, setProgress, setProgressLog, patch, settings.font, showWarnings, closeSample, result, sharedWords]);

  const clearAll = useCallback(() => {
    filesRef.current = [];
    setHasFiles(false); setResult(null); setSharedWords(null);
    setShare(null); closeAll(); setError(null); setBundle(null);
    void send({ kind: 'load', files: [] });
  }, [send, closeAll]);

  /** Recompute only for options that affect the result. */
  const analyzeKey = useMemo(() => JSON.stringify({
    ...options,
    // Endpoint settings only matter when the model is actually called
    ai: { enabled: options.ai.enabled },
  }), [options]);

  /** Post-processing shared by the local and server paths. */
  const applyResult = useCallback((r: AnalysisResult) => {
    setResult(r);
    // No popup for explicit words; the switches are in the filter panel.
    if (r.warnings.length) showWarnings(r.warnings);
    // Only "my messages" selected and the user barely wrote anything: explain and offer to add character messages
    else if (r.words.length < 10 && r.messageCount < r.totalMessages && options.roles.length === 1 && options.roles[0] === 'user' && options.nsfwMode !== 'only') {
      setError({
        kind: 'notice',
        title: t('你自己说的话只有 {n} 条，出不了几个词', { n: r.messageCount }),
        hint: t('默认只统计「我说的」。把角色说的也算进来，词云就有内容了。'),
        action: { label: t('加上角色说的'), run: () => setOptions((o) => ({ ...o, roles: ['user', 'char'] })) },
      });
    }
    else setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [options.roles, setOptions, t, showWarnings]);

  // Served page without a reachable API: keep probing, and do not analyze locally.
  useEffect(() => {
    if (!served || health?.ok) return;
    const timer = window.setInterval(() => { void probeServer().then((h) => { if (h?.ok) setHealth(h); }); }, 5000);
    return () => window.clearInterval(timer);
  }, [served, health?.ok]);
  const apiBlocked = served && !health?.ok;

  useEffect(() => {
    if (!hasFiles) return;
    if (apiBlocked) {
      setBusy(false);
      setError({
        kind: 'known',
        title: t('连不上站点接口'),
        hint: t('这份记录要上传到服务器处理，但 /api 被拦截了，通常是浏览器扩展（广告拦截）或网络过滤。关掉拦截后会自动继续。'),
      });
      return;
    }
    let cancelled = false;
    // Not named `t`: that is the translation function
    const timer = window.setTimeout(() => {
      setBusy(true);
      // Server path: text is uploaded and analyzed with the same core
      if (onServer && filesRef.current[0]) {
        netAbort.current?.abort();
        netAbort.current = new AbortController();
        void analyzeOnServer(filesRef.current[0], options, applyNetProgress, netAbort.current.signal)
          .then((r) => { if (!cancelled) applyResult(r); })
          .catch((e: unknown) => { if (!cancelled) setError(classifyError(e)); })
          .finally(() => { if (!cancelled) { setBusy(false); setProgress(null); } });
        return;
      }
      void send({ kind: 'analyze', options, relay: !!health?.ok }).then((res) => {   // Without runAi: automatic recomputes use the cache only
        if (cancelled) return;
        setBusy(false);
        if (!res.ok) setError(classifyError(new Error(res.error)));
        else if (res.kind === 'analyze') {
          applyResult(res.result);
        }
      });
    }, 140);
    return () => { cancelled = true; window.clearTimeout(timer); };
    // Excluded from deps: including it would re-run analysis on every notice.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [analyzeKey, hasFiles, loadSeq, send, onServer, apiBlocked]);

  /** Progress overlay: appears after 300 ms and stays at least 500 ms once shown. */
  const shownAt = useRef(0);
  useEffect(() => {
    if (busy) {
      const t = window.setTimeout(() => { shownAt.current = Date.now(); setShowProgress(true); }, 300);
      return () => window.clearTimeout(t);
    }
    if (!showProgress) return;
    const left = Math.max(0, 500 - (Date.now() - shownAt.current));
    const t = window.setTimeout(() => setShowProgress(false), left);
    return () => window.clearTimeout(t);
  }, [busy, showProgress]);

  // Unknown errors and toasts with an action stay up longer: they need reading or a click. The rest dismiss after 5 s.
  useEffect(() => { if (error?.kind === 'unknown') reportError(error.title, error.detail); }, [error]);
  useEffect(() => {
    if (!error) return;
    const timer = window.setTimeout(() => setError(null), error.kind === 'unknown' || error.action ? 15000 : 5000);
    return () => window.clearTimeout(timer);
  }, [error]);

  /** Run keyword mode. Manual trigger only; every run is a paid request. Always uses the visitor's own endpoint. */
  const runCurate = useCallback(async () => {
    setBusy(true); setError(null); setProgressLog([]);
    const res = await send({ kind: 'curate', options, n: settings.keywordN, relay: !!health?.ok });
    setBusy(false); setProgress(null);
    if (!res.ok) { setError(classifyError(new Error(res.error))); return; }
    if (res.kind !== 'curate') return;
    setCuration({ words: res.words, result: res.curate });
    setResult(res.base);   // Keep the local result so switching back to frequency mode needs no recompute
    if (res.words.length < settings.keywordN * 0.6) {
      setError({
        kind: 'notice',
        title: t('只挑出 {got} 个（要的是 {want}）', { got: res.words.length, want: settings.keywordN }),
        hint: t('模型编出来的词（原文里没有）已剔除。换个模型通常好些。'),
      });
    }
  }, [send, options, settings.keywordN, t, setProgress, setProgressLog, health?.ok]);

  /** Build a self-contained error report: app, action, environment. Excludes keys, chat text and file names. */
  const errorReport = useCallback((e: AppError) => {
    const L: string[] = [];
    L.push(t('【背景】酒馆词云（tavern-wordcloud）：读 SillyTavern 导出的聊天记录，分词后画词云。网页版正文上传到服务器处理、处理完即丢；「大模型分词/关键词」走用户自己填的接口。'));
    L.push('');
    L.push(t('【在做什么】{what}', {
      what: settings.cloudMode === 'keyword'
        ? t('关键词模式：让大模型读完整份聊天挑词')
        : t('词频模式：本地统计词频'),
    }));
    L.push(t('【读入】{n} 个文件{zip}{stat}', {
      n: filesRef.current.length,
      zip: bundle ? t('（来自整包 .zip）') : '',
      stat: result
        ? t('，{msgs} 条消息、{w} 万字', { msgs: result.messageCount, w: (result.cleanChars / 1e4).toFixed(1) })
        : '',
    }));
    if (options.ai.endpoint) {
      // Host and model only, never the key; an invalid address is kept as-is, it is useful in the report
      L.push(t('【接口】{host} · 模型 {model} · 密钥{key}', {
        host: hostOf(options.ai.endpoint),
        model: options.ai.model || t('（没填）'),
        key: options.ai.apiKey ? t('已填') : t('没填'),
      }));
    }
    L.push(t('【环境】{ua}', { ua: navigator.userAgent }));
    L.push(t('【页面】{url}', { url: `${location.origin}${location.pathname}` }));
    L.push('');
    L.push(t('【报错】{title}', { title: e.title }));
    if (e.hint) L.push(e.hint);
    L.push('');
    L.push(t('【原始信息】'));
    L.push(e.detail ?? t('（没有更多信息）'));
    L.push('');
    L.push(t('【反馈】把这段贴到 {url}', { url: 'https://github.com/kcgoofee-jpg/tavern-wordcloud/issues/new' }));
    return L.join('\n');
  }, [settings.cloudMode, bundle, result, options.ai, t]);

  /** Progress labels are generated by phase; the worker label is only a fallback. */
  const phaseText = (phase: WorkerProgress['phase'] | 'upload' | undefined, fallback: string): string => {
    const table: Partial<Record<NonNullable<typeof phase>, string>> = {
      unzip: t('正在解压'),
      scan: t('正在归类'),
      read: t('正在读文件'),
      upload: t('正在上传'),
      parse: t('正在解析'),
      tokenize: t('正在分词'),
      ai: t('大模型分词中'),
      curate: t('模型正在读完整份聊天'),
      // Unchanged text reuses the previous segmentation without a request
      aicache: t('沿用上次的大模型分词结果'),
    };
    return (phase && table[phase]) || fallback;
  };

  /** Run LLM tokenization explicitly. Enabling the option does not start a run. */
  const runAiTokenize = useCallback(async () => {
    setBusy(true); setError(null); setProgressLog([]);
    // The button means "use the model now": it turns the switch on rather than silently
    // re-running the local tokenizer when the switch was still off.
    const o = options.ai.enabled ? options : { ...options, ai: { ...options.ai, enabled: true } };
    if (o !== options) setOptions(() => o);
    const res = await send({ kind: 'analyze', options: o, runAi: true, relay: !!health?.ok });
    setBusy(false); setProgress(null);
    if (!res.ok) setError(classifyError(new Error(res.error)));
    else if (res.kind === 'analyze') setResult(res.result);
  }, [send, options, setOptions, setProgress, setProgressLog, health?.ok]);

  /** Abort the running LLM tokenization; finished chunks are kept, the rest falls back to local. */
  const cancelRun = useCallback(() => {
    // Server path: closing the connection aborts the upstream call
    netAbort.current?.abort();
    void send({ kind: 'cancel' });
    setProgressLog((l) => [...l, t('已停止——切好的部分保留，没跑到的用本地分词')].slice(-8));
  }, [send, t, setProgressLog]);


  const narrow = useIsNarrow();

  const toggleShare = useCallback(async () => {
    if (share) { setShare(null); flashCopied(false); return; }
    if (words.length === 0) return;
    try {
      const base = window.location.origin + window.location.pathname;
      setShare(await buildShareUrl({
        theme: themeId,
        words,
        // The palette travels with the share
        themeConf: {
          themeId, mode: settings.mode,
          custom: themeId === 'custom' ? custom : undefined,
          font: settings.font,
        },
      }, base));
      flashCopied(false);
    } catch (e) { setError(classifyError(e)); }
  }, [share, words, themeId, settings.mode, settings.font, custom, flashCopied]);

  /** Save PNG: the QR view in share mode, the cloud otherwise; separate file names. */
  const savePng = useCallback(async () => {
    // The full word table and palette are embedded so the PNG can be re-imported
    let embed: string | undefined;
    try {
      embed = await encodeSharePayload({
        theme: themeId, words,
        themeConf: { themeId, mode: settings.mode, custom: themeId === 'custom' ? custom : undefined, font: settings.font },
      });
    } catch { embed = undefined; }
    const o = settings.exportOpts;
    const card = result?.meta?.character ?? null;
    const out = outputSize(cloudRef.current?.pixelSize() ?? { w: 0, h: 0 }, o);
    const name = exportName('png', {
      card, mode: settings.cloudMode, words: words.length, lang: settings.lang,
      tpl: o.nameTpl, ext: o.format,
    });
    // The QR stamp reuses the share link when one is open; otherwise it is built on the spot
    let qrUrl: string | null = null;
    if (o.qr) {
      if (share) qrUrl = share.url;
      else {
        try {
          const base = window.location.origin + window.location.pathname;
          qrUrl = (await buildShareUrl({
            theme: themeId, words,
            themeConf: { themeId, mode: settings.mode, custom: themeId === 'custom' ? custom : undefined, font: settings.font },
          }, base)).url;
        } catch { qrUrl = null; }
      }
    }
    const stamp = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    const paintOpts = {
      width: out.w, height: out.h,
      bg: o.bg, bgColor: o.bgColor, radius: o.radius,
      // i18n-exempt: a date and the card name, no translatable words
      watermark: o.watermark
        ? [
            `${card ?? ''} · ${stamp.getFullYear()}-${pad(stamp.getMonth() + 1)}-${pad(stamp.getDate())}`.trim(),
            o.watermarkText.trim(),
          ].filter(Boolean).join(' · ')
        : null,
      watermarkPos: o.watermarkPos,
      watermarkOpacity: o.watermarkOpacity,
      qr: qrUrl,
      hiddenText: o.hiddenMeta ? watermarkPayload(o.watermarkText, stamp) : null,
    };
    // Vector: no bitmap, no re-encode, so it goes straight out as text.
    if (o.format === 'svg') {
      const svg = cloudRef.current?.toSvg(paintOpts);
      if (!svg) { setError(notice(t('这个尺寸导不出来，把宽高调小一点再试'))); return; }
      downloadBlob(svgBlob(svg), name);
      return;
    }
    // The invisible carriers hold the user's own line, not the card name: the picture may leave the owner.
    const hidden = o.hiddenMeta || o.hiddenLsb
      ? { text: watermarkPayload(o.watermarkText, stamp), meta: o.hiddenMeta, lsb: o.hiddenLsb }
      : undefined;
    const ok = cloudRef.current?.exportImage(
      share ? t('词云二维码.png') : name,
      o.embed && o.format === 'png' ? embed : undefined,
      paintOpts, o.format, hidden,
    );
    if (ok === false) setError(notice(t('这个尺寸导不出来，把宽高调小一点再试')));
  }, [share, t, themeId, words, settings.mode, settings.font, custom, settings.exportOpts, result, settings.cloudMode, settings.lang, setError]);

  /** Ask the configured model for cleaning rules based on a few raw messages (opt-in; sends up to 5 messages). */
  const [proposing, setProposing] = useState(false);
  const proposeRules = useCallback(async () => {
    setProposing(true);
    try {
      const res = await send({ kind: 'samples', n: 5 });
      if (!res.ok || res.kind !== 'samples' || res.samples.length === 0) { setError(notice(t('没有可用的样本：先导入角色说过话的记录'))); return; }
      const rules = await proposeCleanRules(res.samples, options.ai, health?.ok ? relayFetch : fetch);
      if (rules.length === 0) { setError(notice(t('模型没有给出可用的规则'))); return; }
      setOptions((o) => ({ ...o, clean: { ...o.clean, customRules: mergeRules(o.clean.customRules, rules) } }));
      setError(notice(t('加了 {n} 条模型写的清洗规则', { n: rules.length })));
    } catch (e) {
      setError(classifyError(e));
    } finally { setProposing(false); }
  }, [send, options.ai, health?.ok, setOptions, t]);

  /** CSV export uses the full counts (allWords), not the truncated cloud. BOM for Excel. */
  const saveCsv = useCallback(() => {
    if (!result) return;
    // CSV carries the priority words too, flagged in the `source` column.
    const list = applyPriority(result.allWords, parsePriority(settings.priority))
      .sort((a, b) => b.count - a.count)
      .slice(0, settings.exportOpts.csvN);
    downloadBlob(wordsToCsv(list), exportName('csv', {
      card: result.meta?.character, mode: settings.cloudMode, words: list.length,
      lang: settings.lang, tpl: settings.exportOpts.nameTpl,
    }));
  }, [result, settings.exportOpts.csvN, settings.exportOpts.nameTpl, settings.cloudMode, settings.lang, settings.priority]);

  /** JSON keeps every counted word plus the metadata the CSV's three columns cannot carry. */
  const saveJson = useCallback(() => {
    if (!result) return;
    const list = applyPriority(result.allWords, parsePriority(settings.priority)).sort((a, b) => b.count - a.count);
    downloadBlob(
      wordsToJson(list, { card: result.meta?.character, mode: settings.cloudMode, total: list.length }),
      exportName('json', {
        card: result.meta?.character, mode: settings.cloudMode, words: list.length,
        lang: settings.lang, tpl: settings.exportOpts.nameTpl,
      }),
    );
  }, [result, settings.exportOpts.nameTpl, settings.cloudMode, settings.lang, settings.priority]);

  /** Tab-separated so it pastes into a spreadsheet as three columns. */
  const copyWords = useCallback(() => {
    if (!result) return;
    const list = applyPriority(result.allWords, parsePriority(settings.priority))
      .sort((a, b) => b.count - a.count)
      .slice(0, settings.exportOpts.csvN);
    void copyText(wordsToTsv(list)).then((ok) => flashCopiedWords(ok));
  }, [result, settings.exportOpts.csvN, settings.priority, flashCopiedWords]);

  /** Report a word as noise: fetch its context snippets from the worker; the user reviews them in an in-app dialog before anything is sent. */
  const reportWord = useCallback(async (word: string) => {
    const res = await send({ kind: 'context', options, word });
    if (!res.ok || res.kind !== 'context' || res.snippets.length === 0) { setError(notice(t('没找到「{w}」的上下文', { w: word }))); return; }
    askConfirm({ word, snippets: res.snippets });
  }, [send, options, t, askConfirm]);

  /** Send the reviewed feedback; cancel just closes the dialog. */
  const sendFeedback = useCallback(async () => {
    if (!confirm) return;
    const { word, snippets } = confirm;
    closeConfirm();
    try {
      await fetch('/api/feedback', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ word, snippets, kind: 'leak' }) });
      setError(notice(t('已发送，谢谢')));
    } catch (e) { setError(classifyError(e)); }
  }, [confirm, closeConfirm, t]);

  // Fetch once when the panel opens; the server caches for 5 minutes
  useEffect(() => {
    if (panel !== 'community' || !health?.ok) return;
    setCommunityLoading(true);
    fetch('/api/community').then((r) => r.json()).then((s: CommunityStats) => setCommunity(s)).catch(() => setCommunity(null)).finally(() => setCommunityLoading(false));
  }, [panel, health?.ok]);

  /** Contribute anonymous statistics: only when enabled and computed on the server; once per result. Card name, top 100 non-name words, counts. */
  const contributedFor = useRef<AnalysisResult | null>(null);
  useEffect(() => {
    if (!settings.contribute || !health?.ok || !result || contributedFor.current === result || result.messageCount === 0) return;
    contributedFor.current = result;
    const body = {
      words: result.allWords.filter((w) => !w.priority && w.kind !== 'person' && w.kind !== 'generic' && w.nsfw === undefined && w.count >= 2).slice(0, 100).map((w) => ({ text: w.text, count: w.count })),
      messages: result.messageCount, chars: result.cleanChars,
      // Share of CJK words; a ratio, not text
      zh: result.allWords.length ? result.allWords.filter((w) => /[\u4e00-\u9fff]/.test(w.text)).length / result.allWords.length : 0,
      // The model name the visitor typed themselves, else the one the log records.
      // Never the address and never the key: only the class of the address goes out.
      model: (settings.options.ai.model || result.meta?.models[0] || '').trim().slice(0, 60) || undefined,
      endpointKind: endpointKind(settings.options.ai.endpoint),
      // Only present when the log carried gen_started / gen_finished timings.
      avgGenMs: result.meta?.avgGenSeconds != null ? Math.round(result.meta.avgGenSeconds * 1000) : undefined,
      // Word counts per category, for the community's person / place / time split.
      kinds: (result.entities?.byKind ?? []).map((k) => ({ kind: k.kind, words: k.words })),
    };
    void fetch('/api/contribute', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), keepalive: true }).catch(() => {});
  }, [result, settings.contribute, settings.options.ai.model, settings.options.ai.endpoint, health?.ok]);

  const copyLink = useCallback(async () => {
    if (!share) return;
    try {
      // navigator.clipboard is missing over LAN http; copyText falls back
      if (!await copyText(share.url)) {
        setError({
          kind: 'notice',
          title: t('这个浏览器不让自动复制'),
          hint: t('多半是因为地址不是 https。链接在二维码里，扫一下也行。'),
        });
        return;
      }
      flashCopied();
    } catch (e) { setError(classifyError(e)); }
  }, [share, flashCopied, t]);

  const META = panelMeta(t);
  const panelTitle = panel ? META[panel].title : '';
  const resetScope = panel ? META[panel].reset : undefined;
  const empty = words.length === 0;
  /** The sample cloud cannot be exported or shared. */
  const exportable = !empty && !demoMode;
  /** Characters after cleaning; shown before a request so the user knows how much is sent. */
  const charsOf = (r: AnalysisResult | null) => r?.cleanChars ?? 0;
  const noise = result && result.rawChars > 0 ? (1 - result.cleanChars / result.rawChars) * 100 : 0;

  return (
    <LangContext.Provider value={settings.lang}>
    <div
      className={`app${dragging ? ' dragging' : ''}`}
      data-mode={theme.mode}
      onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
      onDragLeave={(e) => { if (e.currentTarget === e.target) setDragging(false); }}
      onDrop={(e) => { e.preventDefault(); setDragging(false); void ingest([...e.dataTransfer.files]); }}
    >
      <CloudCanvas
        ref={cloudRef}
        words={words}
        theme={theme}
        rotateRatio={rotateRatio}
        shareUrl={share?.url ?? null}
        highlight={hovered}
        onWordClick={(w) => (demoMode ? closeSample() : setHovered(w))}
        onWordHover={demoMode ? undefined : setHovered}
      />

      {/* Keyword mode with no curated words yet: the empty state is the run button itself. */}
      {empty && !busy && hasFiles && keywordMode && !curation && (
        <button type="button" className="hero" disabled={!localAiReady}
          onClick={() => (localAiReady ? void runCurate() : openPanel('ai'))}>
          <span className="hero-ring" />
          <Icon name={localAiReady ? 'play' : 'plug'} size={44} />
          <span className="hero-text">
            {localAiReady ? t('让 {model} 读完整份聊天挑词', { model: curateModel }) : t('先配置大模型接口')}
          </span>
          <span className="hero-sub">
            {localAiReady
              ? t('{w} 万字 · 一次请求 · 大约要等 1~5 分钟', { w: (charsOf(result) / 1e4).toFixed(1) })
              : t('关键词模式要联网，先填接口和密钥')}
          </span>
          <span className="hero-sub dim">
            {t('用你自己填的接口，正文会发到你填的那个地址')}
          </span>
          <span className="hero-sub dim">
            {t('不想调用模型就切回「词频」：免费、半秒出结果')}
          </span>
        </button>
      )}

      {demoMode && <button type="button" className="demo-catch" aria-label={t('开始')} onClick={closeSample} />}
      {demoMode && (
        <button type="button" className="demo-hint" onClick={closeSample}>
          {t('示例词云 · 点任意位置开始导入')}
        </button>
      )}
      {/* Community cloud without the board: say whose cloud this is and how to get back */}
      {communityCloud && !panel && (
        <button type="button" className="demo-hint" onClick={cycleCommunity}>
          {t('社区词云 · 点这里回到自己的词云')}
        </button>
      )}

      {showLanding && (
        <Landing
          hasServer={onServer || served}
          keywordMode={keywordMode}
          aiReady={localAiReady}
          onCloudMode={(m) => {
            if (m === 'keyword' && !localAiReady) { openPanel('ai'); return; }
            patch({ cloudMode: m });
          }}
          communityActive={panel === 'community'}
          onToggleCommunity={() => openPanel(panel === 'community' ? null : 'community')}
          dark={resolveMode(settings.mode) === 'dark'}
          onToggleScheme={() => patch({ mode: resolveMode(settings.mode) === 'dark' ? 'light' : 'dark' })}
          lang={settings.lang}
          onToggleLang={() => patch({ lang: settings.lang === 'zh' ? 'en' : 'zh' })}
          onPickFile={() => fileInputRef.current?.click()}
          onShowSample={openSample}
        />
      )}

      {/* Extensions alone get mis-mapped to image/* on some Android builds, hiding the document
          picker behind the camera/gallery sheet (notes/docs/29). Pairing every extension with its
          MIME type keeps the full file browser reachable; ingest() itself still filters by filename. */}
      <input ref={fileInputRef} type="file" multiple
        accept="application/json,text/plain,application/zip,application/x-zip-compressed,image/png,.jsonl,.json,.txt,.zip,.png" hidden
        onChange={(e) => { void ingest([...(e.target.files ?? [])]); e.target.value = ''; }} />

      {/* Two schemes only (light / dark). On the landing these controls live in the top bar instead. */}
      {!showLanding && (
      <button
        type="button" className="mode-quick"
        title={resolveMode(settings.mode) === 'dark' ? t('深色 · 点一下切到淡色') : t('淡色 · 点一下切到深色')}
        onClick={() => patch({ mode: resolveMode(settings.mode) === 'dark' ? 'light' : 'dark' })}
      >
        <Icon name={resolveMode(settings.mode) === 'dark' ? 'moon' : 'sun'} size={19} />
      </button>
      )}

      {/* Cloud mode switch: top-level, always visible. Keyword mode has its own run action; switching never sends a request. */}
      {/* Shown when files are loaded, not when the canvas has content; keyword mode may be empty. */}
      {hasFiles && (
        <div className="cloudmode" role="group" aria-label={t('词云模式')}>
          <button type="button" className={!keywordMode ? 'on' : ''}
            title={t("统计出现最多的词。免费、半秒出结果")}
            onClick={() => patch({ cloudMode: 'freq' })}>
            <Icon name="chart" size={15} />{t('词频')}
          </button>
          <button type="button" className={keywordMode ? 'on' : ''}
            title={localAiReady
              ? t('让大模型读完整份聊天，挑出这个故事独有的词。整份正文会发给你配的接口')
              : aiMissing === 'endpoint' ? t('还没填接口地址——点一下去配')
                : aiMissing === 'model' ? t('还没选模型——点一下去配')
                  : aiMissing === 'key' ? t('还没填密钥——点一下去配') : t('还没配接口——点一下去配')}
            onClick={() => {
              if (!localAiReady) { openPanel('ai'); return; }
              patch({ cloudMode: 'keyword' });
            }}>
            <Icon name="chip" size={15} />{t('关键词')}
            {/* The missing field is named in the tooltip, not printed next to the label. */}
          </button>
        </div>
      )}

      {/* Share of the pointed word, centered below the cloud. Number only; empty when nothing is pointed at. */}
      {!empty && !share && (
        <div className="ratio" aria-live="polite">
          {active && (
            <span><b>{active.count} {t('次')}</b> · {(ratio * 100).toFixed(ratio < 0.01 ? 2 : 1)}%</span>
          )}
        </div>
      )}

      {/* Language switch next to the scheme switch: both are display-only settings; on the landing they live in the top bar */}
      {!showLanding && (
      <button
        type="button" className="lang-quick"
        title={settings.lang === 'zh' ? 'Switch to English' : '切换到中文'}
        onClick={() => patch({ lang: settings.lang === 'zh' ? 'en' : 'zh' })}
      >
        <Icon name="lang" size={19} />
      </button>
      )}

      {/* Community board opens as a full page, not a side sheet */}
      {!showLanding && (
      <button
        type="button" className={`community-quick${panel === 'community' || communityCloud ? ' on' : ''}`}
        title={panel === 'community' ? t('再点一下：只看社区词云') : communityCloud ? t('再点一下：回到自己的词云') : t('社区排行榜')}
        aria-pressed={panel === 'community' || communityCloud}
        onClick={cycleCommunity}
      >
        <Icon name="chart" size={19} />
      </button>
      )}

      {/* Site notice: only the served version has one; the bell is absent without a server */}
      {!showLanding && siteNotice && (
      <button
        type="button" className={`notice-quick${noticeOpen ? ' on' : ''}${siteNotice.level === 'warn' ? ' warn' : ''}`}
        title={t('站内通知')} aria-pressed={noticeOpen}
        onClick={toggleNotice}
      >
        <Icon name="bell" size={19} />
        {noticeUnread && <span className="dot" />}
      </button>
      )}
      {noticeOpen && siteNotice && (
        <div className="notice-pop" role="note" aria-label={t('站内通知')}>
          <p>{siteNotice.text}</p>
          <time dateTime={new Date(siteNotice.updatedAt).toISOString()}>{new Date(siteNotice.updatedAt).toLocaleString()}</time>
        </div>
      )}

      {/* Deploy update: only shown once a version change was detected and no analysis is running */}
      {!showLanding && updateAvailable && (
      <button
        type="button" className={`version-quick${versionOpen ? ' on' : ''}`}
        title={t('网站更新了')} aria-pressed={versionOpen}
        onClick={toggleVersion}
      >
        <Icon name="reset" size={19} />
        <span className="dot" />
      </button>
      )}
      {versionOpen && updateAvailable && (
        <div className="version-pop" role="note" aria-label={t('网站更新了')}>
          <p>{t('网站更新了，刷新一下用新版；不刷新也能继续用，正在算的结果不受影响')}</p>
          <button type="button" className="version-reload" onClick={() => location.reload()}>{t('刷新')}</button>
        </div>
      )}

      {panel === 'community' && (
        <section className="community-page" role="dialog" aria-label={t('社区排行榜')}>
          <div className="community-head">
            <h2>{t('社区排行榜')}</h2>
            <button type="button" className="sheet-close" title={t("关闭")} onClick={() => openPanel(null)}>
              <Icon name="close" size={18} />
            </button>
          </div>
          <div className="community-body">
            <CommunityPanel stats={community} loading={communityLoading} offline={!health?.ok} contribute={settings.contribute} setContribute={(v) => patch({ contribute: v })} />
          </div>
        </section>
      )}

      {/* The landing has its own upload entry; the rail appears once it is gone */}
      {!showLanding && (
      <nav className="rail" aria-label={t('工具')}>
        <button type="button" className="tool" title={t("添加聊天记录")}
          onClick={() => fileInputRef.current?.click()}><Icon name="plus" /></button>
        {/* Loop variable is `tool`, not `t` (the translation function) */}
        {tools(t).map((tool, i) => (
          <button key={tool.id} type="button" className={`tool${panel === tool.id ? ' on' : ''}`}
            title={tool.label} aria-pressed={panel === tool.id}
            style={{ animationDelay: `${60 + i * 45}ms` }}
            disabled={tool.id !== 'theme' && tool.id !== 'ai' && !result}
            onClick={() => openPanel(panel === tool.id ? null : tool.id)}>
            <Icon name={tool.icon} />
          </button>
        ))}
        {/* Export: one QR entry; the options appear after it. */}
        {/* QR sharing is disabled (src/ui/flags.ts); the implementation and link decoding remain */}
        {FEATURES.shareQr && (
          <button type="button" className={`tool${share ? ' on' : ''}`}
            title={share ? t('回到词云') : t('导出 · 分享')} disabled={!exportable}
            onClick={() => void toggleShare()}>
            <Icon name={share ? 'cloud' : 'qr'} />
          </button>
        )}
        {FEATURES.shareQr && share && (
          <button type="button" className={`tool sub${copied ? ' ok' : ''}`} title={t("复制分享链接")}
            onClick={() => void copyLink()}><Icon name={copied ? 'check' : 'link'} /></button>
        )}
        {/* Export opens a panel (resolution, background, embedded table, CSV scope) */}
        <button type="button" className={`tool${panel === 'export' ? ' on' : ''}`} title={t("导出")} disabled={!exportable}
          aria-pressed={panel === 'export'} onClick={() => openPanel(panel === 'export' ? null : 'export')}><Icon name="upload" /></button>
        {hasFiles && <button type="button" className="tool" title={t("清空全部数据")} onClick={clearAll}><Icon name="trash" /></button>}
      </nav>
      )}

      {/* The export panel has the most controls, so on a phone it takes the whole screen. */}
      {panel && panel !== 'community' && (
        <aside
          className={`sheet${panel === 'words' ? ' wide' : ''}${narrow && panel === 'export' ? ' fullscreen' : ''}`}
          role="dialog" aria-label={panelTitle}
        >
          <div className="sheet-bar">
            <span className="sheet-title">{panelTitle}</span>
            <span className="sheet-acts">
              {/* Reset button per panel */}
              {resetScope && (
                <button
                  type="button" className="sheet-close"
                  title={isDirty(settings, resetScope)
                    ? t('恢复默认：{what}', { what: META[panel].resetHint ?? '' })
                    : t('还是默认值')}
                  disabled={!isDirty(settings, resetScope)}
                  onClick={() => setSettings((s) => resetSlice(s, resetScope))}
                ><Icon name="reset" size={16} /></button>
              )}
              <button type="button" className="sheet-close" title={t("关闭")} onClick={() => openPanel(null)}>
                <Icon name="close" size={17} />
              </button>
            </span>
          </div>
          <div className="sheet-body">
            {panel === 'theme' && <ThemePanel settings={settings} patch={patch} />}
            {panel === 'font' && (
              <FontPanel
                font={settings.font}
                setFont={(f) => patch({ font: f })}
                traditional={settings.traditional}
                setTraditional={(v) => patch({ traditional: v })}
              />
            )}
            {panel === 'filter' && (
              <FilterPanel options={options} setOptions={setOptions} result={result}
                kindOverrides={settings.kindOverrides}
                setKindOverrides={(o) => patch({ kindOverrides: o })}
                rotateRatio={rotateRatio} setRotateRatio={(v) => patch({ rotateRatio: v })} />
            )}
            {panel === 'advanced' && (
              <>
                {/* Priority words live under advanced settings: they are a tuning tool, not a daily control. */}
                <PriorityPanel value={settings.priority} setValue={(v) => patch({ priority: v })} />
                <AdvancedPanel options={options} setOptions={setOptions} />
              </>
            )}
            {panel === 'words' && (
              <WordsPanel words={words} options={options} setOptions={setOptions}
                overrides={settings.overrides}
                setOverrides={(fn) => setSettings((s) => ({ ...s, overrides: fn(s.overrides) }))}
                priority={parsePriority(settings.priority)}
                onHover={setHovered} hovered={hovered} onReport={health?.ok ? (w) => void reportWord(w) : undefined} />
            )}
            {panel === 'review' && (
              <ReviewPanel words={result?.allWords ?? words}
                overrides={settings.overrides}
                setOverrides={(fn) => setSettings((s) => ({ ...s, overrides: fn(s.overrides) }))}
                extraStopwords={options.tokenize.extraStopwords}
                setExtraStopwords={(v) => setOptions((o) => ({ ...o, tokenize: { ...o.tokenize, extraStopwords: v } }))} />
            )}
            {panel === 'export' && (
              <ExportPanel opts={settings.exportOpts} setOpts={(o) => patch({ exportOpts: o })}
                size={cloudRef.current?.pixelSize() ?? { w: 0, h: 0 }}
                all={result?.allWords.length ?? words.length}
                paint={(c, o) => cloudRef.current?.paint(c, o) ?? false}
                onPng={() => void savePng()} onCsv={result ? saveCsv : undefined}
                onJson={result ? saveJson : undefined} onCopy={result ? copyWords : undefined}
                copied={copiedWords} />
            )}
            {panel === 'ai' && (
              <AiPanel ai={options.ai} setAi={(c) => setOptions((o) => ({ ...o, ai: c }))}
                canRun={!!result && options.ai.enabled && !!options.ai.endpoint && !!options.ai.model}
                busy={busy} onRun={() => void runAiTokenize()} relay={!!health?.ok}
                onProposeRules={hasFiles ? () => void proposeRules() : undefined} proposing={proposing}
                focus={aiMissing ?? undefined} />
            )}
          </div>
        </aside>
      )}

      {/* Bottom-left dock: design tools (palette, font), the card info and the figures; the landing replaces it */}
      {!showLanding && (
      <div className="dock">
        <button
          type="button"
          className={`dock-style${panel === 'theme' ? ' on' : ''}`}
          title={t("风格与配色")}
          aria-pressed={panel === 'theme'}
          onClick={() => openPanel(panel === 'theme' ? null : 'theme')}
        >
          <Icon name="palette" size={17} />
          <span className="dock-ramp">
            {theme.ramp.map((c) => <i key={c} style={{ background: c }} />)}
          </span>
          
        </button>
        {/* Font is its own button: colors and fonts change independently */}
        <button
          type="button"
          className={`dock-style icon-only${panel === 'font' ? ' on' : ''}`}
          title={t("词云字体")}
          aria-pressed={panel === 'font'}
          onClick={() => openPanel(panel === 'font' ? null : 'font')}
        >
          <Icon name="font" size={17} />
          
        </button>
        {result?.meta && !share && (
        <CardInfo
          meta={result.meta} bundle={bundle} groups={result.groups}
          perSource={result.perSource} accent={theme.accent}
          onlyCharacter={options.onlyCharacter}
          setOnlyCharacter={(c) => setOptions((o) => ({ ...o, onlyCharacter: c }))}
          open={cardOpen} setOpen={openCard}
          stats={{ messages: result.messageCount, total: result.totalMessages, noise, unique: result.uniqueTokens }}
        />
      )}
        {/* No card metadata (rare: bare text input): the figures fall back to the dock. */}
        {result && !result.meta && !share && (
          <div className="dock-stats" role="status">
            <span title={t('统计了 {kept} 条消息，共 {all} 条', { kept: result.messageCount, all: result.totalMessages })}><Icon name="speaker" size={14} />{t('{n} 条', { n: result.messageCount })}</span>
            <span title={t('清洗掉的插件内容占原文的比例')}><Icon name="trash" size={14} />{t('清洗 {p}%', { p: Math.round(noise) })}</span>
            <span title={t('{n} 个不重复词', { n: result.uniqueTokens })}><Icon name="list" size={14} />{t('{u} 词', { u: result.uniqueTokens })}</span>
          </div>
        )}
        {/* Keyword mode: why the model picked these words (the figures moved into the card popover). */}
        {result && !share && keywordMode && curation?.result.rationale && (
          <div className="dock-stats" role="status">
            <Note>
              <b>{t('模型为什么挑这些词')}</b>{'\n'}{curation.result.rationale}
            </Note>
          </div>
        )}
        {share && (
          <div className="dock-stats" role="status">
            <span title={share.wordCount > 0
              ? t('二维码带了 {n} 个词，扫码即得同一张图', { n: share.wordCount })
              : t('词太多，二维码只编了网址')}>
              <Icon name="qr" size={14} />{share.wordCount || '—'}
            </span>
            {share.truncated && <span title={t('二维码只带了高频词')}><Icon name="alert" size={14} /></span>}
          </div>
        )}
      </div>
      )}

      {error && (
        <div className={`toast ${error.kind}`} role="alert">
          <span className="toast-icon"><Icon name="alert" size={18} /></span>
          <div className="toast-body">
            <b>{error.titleTpl ? txv(error.titleTpl) : tx(error.title)}</b>
            {(error.hint || error.hintTpl) && <p>{error.hintTpl ? txv(error.hintTpl) : tx(error.hint!)}</p>}
            {error.action && (
              <button type="button" className="copy-btn"
                onClick={() => { error.action!.run(); setError(null); }}>
                {tx(error.action.label)}
              </button>
            )}
            {error.kind === 'unknown' && error.detail && (
              <>
                <pre>{error.detail.slice(0, 400)}</pre>
                <button type="button" className={`copy-btn${copiedErr ? ' ok' : ''}`}
                  onClick={() => {
                    void copyText(errorReport(error)).then((ok) => flashCopiedErr(ok));
                  }}>
                  <Icon name={copiedErr ? 'check' : 'link'} size={14} />
                  {copiedErr ? t('已复制到剪贴板') : t('复制，拿去问你的 AI')}
                </button>
              </>
            )}
          </div>
          <button type="button" title={t("关闭")} onClick={() => setError(null)}><Icon name="close" size={15} /></button>
        </div>
      )}

      {importAsk && (
        <ImportPanel
          summary={importAsk} options={options} setOptions={setOptions}
          busy={busy} progress={progress} hasServer={onServer || served} load={health?.load}
          onStart={() => { setImportAsk(null); setHasFiles(true); }}
          onCancel={() => { setImportAsk(null); clearAll(); }}
          onConfigureAi={() => { setImportAsk(null); setHasFiles(true); openPanel('ai'); }}
          contribute={settings.contribute}
        />
      )}

      {pendingImport && (
        <div className="confirm-veil" onClick={(e) => { if (e.target === e.currentTarget) setPendingImport(null); }}>
          <div className="confirm-card" role="dialog" aria-modal="true" aria-label={t('已有一份分析')}>
            <div className="confirm-head">
              <span className="confirm-title">{t('已有一份分析')}</span>
              <button type="button" className="sheet-close" title={t('取消')} onClick={() => setPendingImport(null)}>
                <Icon name="close" size={17} />
              </button>
            </div>
            <div className="confirm-body">
              <p className="note">{t('导入新的会清掉当前这份。要留着就先导出图片或词表。一次要分析多份，请在选文件时一起选中。')}</p>
            </div>
            <div className="confirm-foot">
              <button type="button" className="confirm-btn" onClick={() => setPendingImport(null)}>{t('取消')}</button>
              <button type="button" className="confirm-btn primary" onClick={() => { const l = pendingImport; setPendingImport(null); void ingest(l, true); }}>{t('清掉并导入')}</button>
            </div>
          </div>
        </div>
      )}
      {confirm && (
        <ConfirmDialog word={confirm.word} snippets={confirm.snippets}
          onConfirm={() => void sendFeedback()} onCancel={closeConfirm} />
      )}

      {showProgress && !importAsk && (
        <Progress
          phase={progress?.phase}
          pct={pct}
          done={progress?.done}
          total={progress?.total}
          label={progress?.label || phaseText(progress?.phase, hasFiles ? t('正在分词') : t('正在读文件'))}
          detail={progress?.detail}
          stream={progress?.stream}
          thinking={progress?.thinking}
          log={progressLog}
          onCancel={progress?.phase === 'ai' || progress?.phase === 'curate' ? cancelRun : undefined}
          cancelLabel={t('停止')}
        />
      )}
      {dragging && <div className="dropveil"><Icon name="upload" size={44} /></div>}

      {/* Persistent one-line footer once data is in; the landing carries the full footer */}

      {/* Legal pages: `#/terms` etc., on top of everything */}
      {legalRoute && <LegalPage route={legalRoute} />}
    </div>
    </LangContext.Provider>
  );
}
