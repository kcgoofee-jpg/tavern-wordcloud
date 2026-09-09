/**
 * The fourth state hook (notes/docs/41 §5): everything about **the analysis result and the
 * file set it came from**. AGENTS hard rule 8 named three homes — settings (`useSettings`),
 * the long job (`useAnalyzeWorker`), overlays (`useOverlay`) — and this group had none, so it
 * all fell back into `App.tsx` (21 `useState` there, 1421 lines). Zustand was evaluated and
 * rejected for the same job: no store needed, one more hook in the shape the repo already has.
 *
 * What lives here:
 *
 * | group | state |
 * |---|---|
 * | result | `result` (frequency run), `sharedWords` (a `#c=…` link or a cloud PNG), `curation` (keyword mode) |
 * | file set | `filesRef`, `hasFiles`, `loadSeq`, `bundle`, `cardFpsRef` |
 * | import flow | `importAsk` (confirmation panel), `pendingImport` (replace-what-is-open dialog) |
 * | card rules | `cardFp`, `cardRuleApplied` (notes/docs/23) |
 * | view of the result | `hovered` (word under the pointer), `share` (built share link) |
 * | run | `busy`, `showProgress`, `error` |
 * | environment | `health`, `onServer`, `served`, `apiBlocked` |
 *
 * What does **not**: anything persisted (that is a setting), the worker channel and its
 * progress (`useAnalyzeWorker`), panel/card/sample visibility (`useOverlay`).
 *
 * The cross-component rules are written once, here, rather than at each call site:
 *  - `clearData()` — the full drop, shared by 清空全部数据 and by a deliberate replacing import.
 *  - `showSharedWords()` — a link or a PNG replaces the run without touching the card rules.
 *  - the progress overlay's 300 ms delay / 500 ms floor, the toast's own lifetime, and the
 *    startup server probe (plus the re-probe a served page does while `/api` is blocked).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { probeServer, type ServerHealth } from '../../net/server';
import { armErrorReporting, reportError } from '../../net/report';
import type { AppError } from '../../core/errors';
import type { AnalysisResult, WordCount } from '../../core/types';
import type { CurateResult } from '../../core/curate';
import type { SourceFile } from '../../core/analyze';
import type { DataBundle } from '../../core/bundle';
import type { CardMatchVia } from '../../core/cardRules';
import type { BuiltShare } from '../../share/share';
import type { ImportSummary } from '../ImportPanel';

/** What a saved card-rule pack contributed to this import, so the note can offer a one-click undo. */
export interface CardRuleApplied {
  appliedOverrideKeys: string[];
  appliedStopwords: string[];
  via: CardMatchVia;
}

/** Keyword-mode output: the curated words plus the model's own rationale. */
export interface Curation {
  words: WordCount[];
  result: CurateResult;
}

export function useAnalysis() {
  /** Loaded chat text. A ref, not state: it is an input to the worker, never rendered. */
  const filesRef = useRef<SourceFile[]>([]);
  /**
   * Strong fingerprints from the last `.zip`, normalized card name -> hash. The worker computes
   * them from the cards' first_mes/description and drops the text; only these hashes arrive here.
   */
  const cardFpsRef = useRef<Record<string, string>>({});

  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [sharedWords, setSharedWords] = useState<AnalysisResult['words'] | null>(null);
  /** Keyword-mode result. Kept alongside `result` so switching modes does not recompute or re-pay. */
  const [curation, setCuration] = useState<Curation | null>(null);

  const [hasFiles, setHasFiles] = useState(false);
  /** Import generation counter: incremented on every import so the analysis effect re-runs even when `hasFiles` stays true. */
  const [loadSeq, setLoadSeq] = useState(0);
  const [bundle, setBundle] = useState<Omit<DataBundle, 'chats'> | null>(null);

  /** Confirmation panel for large imports: reports what was read and lets the user change re-run options first. */
  const [importAsk, setImportAsk] = useState<ImportSummary | null>(null);
  /** A second import while a result is showing must be a deliberate replacement (user decision 2026-09-04). */
  const [pendingImport, setPendingImport] = useState<File[] | null>(null);

  /**
   * Card rule packs (notes/docs/23, local-only first step): the current import's card
   * fingerprint, and what a saved rule pack contributed on top of the session's own
   * overrides/stopwords (shown as a note in the import panel, with a one-click undo).
   */
  const [cardFp, setCardFp] = useState<string | null>(null);
  const [cardRuleApplied, setCardRuleApplied] = useState<CardRuleApplied | null>(null);

  const [hovered, setHovered] = useState<string | null>(null);
  const [share, setShare] = useState<BuiltShare | null>(null);

  const [busy, setBusy] = useState(false);
  /** Progress overlay is delayed 300 ms so quick local recomputes do not flash it. */
  const [showProgress, setShowProgress] = useState(false);
  const [error, setError] = useState<AppError | null>(null);
  /** Whether a server exists behind this page. Static hosting has none. */
  const [health, setHealth] = useState<ServerHealth | null>(null);

  /** The full drop: no files, no result, no share, no card rule state. Side effects (closing overlays, telling the worker) stay with the caller. */
  const clearData = useCallback(() => {
    filesRef.current = [];
    cardFpsRef.current = {};
    setHasFiles(false); setResult(null); setSharedWords(null);
    setShare(null); setBundle(null);
    setCardFp(null); setCardRuleApplied(null);
  }, []);

  /**
   * A share link or a cloud PNG carries a finished word table: it replaces whatever run is on
   * screen but is not itself an import, so the card-rule state is left alone (there is no card).
   */
  const showSharedWords = useCallback((words: AnalysisResult['words']) => {
    filesRef.current = [];
    setHasFiles(false); setResult(null); setShare(null);
    setSharedWords(words);
  }, []);

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

  // Served page without a reachable API: keep probing, and do not analyze locally.
  useEffect(() => {
    if (!served || health?.ok) return;
    const timer = window.setInterval(() => { void probeServer().then((h) => { if (h?.ok) setHealth(h); }); }, 5000);
    return () => window.clearInterval(timer);
  }, [served, health?.ok]);
  const apiBlocked = served && !health?.ok;

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

  return {
    filesRef, cardFpsRef,
    result, setResult, sharedWords, setSharedWords, curation, setCuration,
    hasFiles, setHasFiles, loadSeq, setLoadSeq, bundle, setBundle,
    importAsk, setImportAsk, pendingImport, setPendingImport,
    cardFp, setCardFp, cardRuleApplied, setCardRuleApplied,
    hovered, setHovered, share, setShare,
    busy, setBusy, showProgress, error, setError,
    health, onServer, served, apiBlocked,
    clearData, showSharedWords,
  };
}
