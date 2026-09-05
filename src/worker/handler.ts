import { segmentWithAi } from '../core/aiTokenizer';
import { relayFetch } from '../net/relay';
import { analyzeAsync, prepareTexts, type AnalyzeOptions, type SourceFile } from '../core/analyze';
import { parseFileName } from '../core/meta';
import { parseChatFile } from '../core/parse';
import { segmentToChunks } from '../core/tokenize';
import { readDataBundle, type CardIdentity, type DataBundle } from '../core/bundle';
import { normalizeCardName, strongFingerprint } from '../core/cardRules';
import { curateWords, type CurateResult } from '../core/curate';
import { fill, tenKCount, zh, type TextTpl, type UserText } from '../core/zh';
import type { AnalysisResult, WordCount } from '../core/types';

/** Request body and id are defined separately: `Omit` over a union collapses to the common keys. */
export type WorkerRequestBody =
  | { kind: 'load'; files: SourceFile[] }
  /** Full zip export; unzipping runs here so the UI thread is not blocked. */
  | { kind: 'loadBundle'; data: ArrayBuffer; name: string }
  | {
      kind: 'analyze';
      options: AnalyzeOptions;
      /**
       * Actually call the LLM tokenizer. Default false: option changes reuse the
       * cached segmentation, and a new model run must be explicit.
       */
      runAi?: boolean;
      /** Relay LLM requests through the server (browser CORS). */
      relay?: boolean;
    }
  /** Abort the running LLM request */
  | { kind: 'cancel' }
  /**
   * Keyword mode: the model reads the whole chat once and picks words.
   * Distinct from `ai.enabled` (LLM tokenization, one request per chunk).
   * Runs in the worker because it first computes local counts for sizing.
   */
  | { kind: 'curate'; options: AnalyzeOptions; n: number; relay?: boolean }
  /** Context snippets of a word in the cleaned text (for feedback) */
  | { kind: 'context'; options: AnalyzeOptions; word: string }
  | { kind: 'samples'; n: number };

/** `lang` is the UI language at send time: the worker formats counts (see tenKCount) before the UI sees them. */
export type WorkerRequest = WorkerRequestBody & { id: number; lang?: 'zh' | 'en' };

/** Progress report. Every long stage reports. Text is UserText: the UI translates at display time. */
export interface WorkerProgress {
  id: number;
  progress: true;
  phase: 'unzip' | 'scan' | 'read' | 'parse' | 'tokenize' | 'count' | 'ai' | 'aicache' | 'curate';
  done: number;
  total: number;
  label: UserText;
  /** Subtitle: elapsed / speed / estimated remaining */
  detail?: UserText;
  /** Notable event (e.g. a chunk fell back to local). Accumulated into a log by the UI */
  note?: UserText;
  /** Streamed model output; only the latest piece */
  stream?: string;
  /** Model reasoning (`reasoning_content`), separate from `stream`. */
  thinking?: string;
}

/** Final reply of a request; progress messages are not replies. */
export type WorkerResult =
  | { id: number; progress?: false; ok: true; kind: 'load'; fileCount: number; chars: number; characters: string[] }
  | { id: number; progress?: false; ok: true; kind: 'bundle'; fileCount: number; chars: number; characters: string[]; bundle: Omit<DataBundle, 'chats'>; files: SourceFile[];
      /**
       * Strong card fingerprints (notes/docs/23), normalized card name -> hash. Computed here from the
       * cards' `first_mes`/`description`, which are dropped as soon as the hash exists: only the
       * irreversible hash crosses back to the UI thread, never the card text.
       */
      cardFingerprints: Record<string, string> }
  | { id: number; progress?: false; ok: true; kind: 'analyze'; result: AnalysisResult }
  | { id: number; progress?: false; ok: true; kind: 'curate'; words: WordCount[]; curate: CurateResult; base: AnalysisResult }
  | { id: number; progress?: false; ok: true; kind: 'context'; snippets: string[] }
  | { id: number; progress?: false; ok: true; kind: 'samples'; samples: string[] }
  | { id: number; progress?: false; ok: false; error: string };

export type WorkerResponse =
  | WorkerProgress
  | { id: number; progress?: false; ok: true; kind: 'load'; fileCount: number; chars: number; characters: string[] }
  | { id: number; progress?: false; ok: true; kind: 'bundle'; fileCount: number; chars: number; characters: string[]; bundle: Omit<DataBundle, 'chats'>; files: SourceFile[];
      /**
       * Strong card fingerprints (notes/docs/23), normalized card name -> hash. Computed here from the
       * cards' `first_mes`/`description`, which are dropped as soon as the hash exists: only the
       * irreversible hash crosses back to the UI thread, never the card text.
       */
      cardFingerprints: Record<string, string> }
  | { id: number; progress?: false; ok: true; kind: 'analyze'; result: AnalysisResult }
  | { id: number; progress?: false; ok: true; kind: 'curate'; words: WordCount[]; curate: CurateResult; base: AnalysisResult }
  | { id: number; progress?: false; ok: true; kind: 'context'; snippets: string[] }
  | { id: number; progress?: false; ok: true; kind: 'samples'; samples: string[] }
  | { id: number; progress?: false; ok: false; error: string };

/**
 * The whole job runtime, independent of where it runs. `analyze.worker.ts` wires it to a
 * real Worker; `sameThread.ts` wires it to the UI thread for the single-file build, where a
 * second copy of core inside an inlined worker blob costs more than the thread is worth.
 *
 * `post` replaces `self.postMessage`; `yieldFn` is handed to `analyzeAsync` so a
 * same-thread run still gives the event loop (and therefore the stop button) a turn.
 * State, the `job` handle and abortion live in this closure, so there is exactly one of each
 * per handler no matter which wiring is used.
 */
export function createHandler(
  post: (msg: WorkerResponse) => void,
  yieldFn?: () => Promise<void>,
): (req: WorkerRequest) => Promise<void> {
  // File contents stay in the worker; option changes recompute without re-transferring them.
  let files: SourceFile[] = [];
  /** Extra information from a full export: world-info keywords, preset name */
  let bundleExtra: Omit<DataBundle, 'chats'> | null = null;

  /**
   * Last LLM tokenization result with its input fingerprint. The fingerprint covers
   * what changes the request (text, chunk size, model, endpoint); display options
   * are excluded so changing them reuses the cache.
   */
  let aiCache: { sig: string; presegmented: (string[] | undefined)[] } | null = null;

  /**
   * Single entry point for long-running jobs: `job.abort` (cancel), `job.step` (progress
   * with speed and ETA), `job.log` (notable events).
   */
  let job: { id: number; abort: AbortController; t0: number } | null = null;

  /** Start a job, aborting the previous one if still running */
  function startJob(id: number) {
    job?.abort.abort();
    job = { id, abort: new AbortController(), t0: Date.now() };
    return job;
  }

  /** A time span; the unit is part of the key so English can pick its own wording. */
  const span = (x: number): TextTpl => x >= 90
    ? { key: zh('{n} 分钟'), params: { n: Math.round(x / 60) } }
    : { key: zh('{n} 秒'), params: { n: Math.round(x) } };

  /** Elapsed / speed / estimated remaining. Reported by every stage that takes more than an instant. */
  function pace(done: number, total: number, t0: number): UserText {
    const sec = (Date.now() - t0) / 1000;
    if (!total || done <= 0) return { key: zh('已用 {t}'), params: { t: span(sec) } };
    const rate = done / Math.max(0.001, sec);
    return {
      key: zh('已用 {t} · {rate}/秒 · 约剩 {left}'),
      params: { t: span(sec), rate: rate.toFixed(1), left: span(Math.max(0, total - done) / Math.max(0.001, rate)) },
    };
  }

  /** Cheap fingerprint: length + samples; only needs to detect change */
  function signature(texts: string[], ai: { chunkChars: number; model: string; endpoint: string }): string {
    const shape = texts.map((t) => t.length).join(',');
    const sample = texts.map((t) => t.slice(0, 24)).join('|');
    return `${ai.endpoint}\u0000${ai.model}\u0000${ai.chunkChars}\u0000${shape}\u0000${sample}`;
  }

  /** World-info keywords are a curated proper-noun list (full export only). Both paths must use the same options so fingerprints match. */
  function withBundleDictionary(o: AnalyzeOptions): AnalyzeOptions {
    if (!bundleExtra?.worldKeywords.length) return o;
    return { ...o, tokenize: { ...o.tokenize, dictionary: [...o.tokenize.dictionary, ...bundleExtra.worldKeywords] } };
  }

  /** Import summary computed from file names, before parsing contents */
  const summarize = () => ({
    fileCount: files.length,
    chars: files.reduce((a, f) => a + f.content.length, 0),
    characters: [...new Set(files.map((f) => parseFileName(f.name).character))],
  });

  const report = (p: Omit<WorkerProgress, 'progress'>) =>
    post({ ...p, progress: true } as WorkerProgress);

  async function handle(req: WorkerRequest): Promise<void> {
    try {
      if (req.kind === 'cancel') {
        job?.abort.abort();
        post({ id: req.id, ok: true, kind: 'load', ...summarize() } as WorkerResponse);
        return;
      }

      if (req.kind === 'samples') {
        // Longest raw character messages: the ones most likely to carry plugin scaffolding
        const raw: string[] = [];
        for (const f of files) for (const m of parseChatFile(f.name, f.content).messages) if (m.role === 'char' && m.raw.length > 200) raw.push(m.raw);
        raw.sort((a, b) => b.length - a.length);
        post({ id: req.id, ok: true, kind: 'samples', samples: raw.slice(0, req.n) } as WorkerResponse);
        return;
      }

      if (req.kind === 'context') {
        const texts = prepareTexts(files, withBundleDictionary(req.options));
        const snippets: string[] = [];
        for (const t of texts) {
          let i = t.indexOf(req.word);
          while (i !== -1 && snippets.length < 3) {
            snippets.push(t.slice(Math.max(0, i - 60), i + req.word.length + 60).replace(/\s+/g, ' '));
            i = t.indexOf(req.word, i + req.word.length + 120);
          }
          if (snippets.length >= 3) break;
        }
        post({ id: req.id, ok: true, kind: 'context', snippets } as WorkerResponse);
        return;
      }

      if (req.kind === 'load') {
        files = req.files;
        bundleExtra = null;
        post({ id: req.id, ok: true, kind: 'load', ...summarize() } as WorkerResponse);
        return;
      }

      if (req.kind === 'loadBundle') {
        /**
         * Card rule packs (notes/docs/23): the cards' `first_mes`/`description` live in this array
         * only long enough to be hashed into a strong fingerprint, then it is emptied. They are not
         * on `DataBundle` and never leave the worker — the reply carries hashes only.
         */
        const identities: CardIdentity[] = [];
        const bundle = readDataBundle(new Uint8Array(req.data), (p) =>
          report({
            id: req.id, phase: p.phase, done: p.done, total: p.total,
            label: p.label, detail: p.detail, note: p.note,
          }), (c) => identities.push(c));
        const cardFingerprints: Record<string, string> = {};
        for (const c of identities) {
          const fp = await strongFingerprint(c.name, c.firstMes, c.description);
          // Chats are grouped by the PNG file name, which is not always the card's own name.
          cardFingerprints[normalizeCardName(c.name)] = fp;
          cardFingerprints[normalizeCardName(c.fileName)] ??= fp;
        }
        identities.length = 0;
        // The zip directory name is more reliable than the file name for card grouping
        files = bundle.chats.map((c) => ({
          name: c.character && !c.name.startsWith(c.character) ? `${c.character} - ${c.name}` : c.name,
          content: c.content,
        }));
        const { chats: _drop, ...extra } = bundle;
        bundleExtra = extra;
        post({
          id: req.id, ok: true, kind: 'bundle', ...summarize(), bundle: extra, files, cardFingerprints,
        } as WorkerResponse);
        return;
      }

      if (req.kind === 'curate') {
        // Local counts first: sizes for the curated words, and a fallback if the model fails.
        const preT0 = Date.now();
        report({
          id: req.id, phase: 'parse', done: 0, total: 2, label: zh('先做一遍本地统计'),
          note: zh('字号要用真实频次，所以先在本地数一遍——模型不数数'),
        });
        // Async even though nothing awaits the result here: same numbers as `analyze`, but a
        // same-thread handler must not sit on the event loop for the whole local pass.
        const base = await analyzeAsync(files, req.options, undefined, (done, total) =>
          report({ id: req.id, phase: 'parse', done, total, label: zh('正在解析') }),
          undefined, yieldFn);
        const counts = new Map(base.allWords.map((w) => [w.text, w.count]));
        report({
          id: req.id, phase: 'parse', done: 1, total: 2, label: zh('先做一遍本地统计'),
          detail: pace(1, 2, preT0),
          note: { key: zh('本地统计好了：{n} 个不重复词'), params: { n: base.uniqueTokens } },
        });

        // The whole chat is sent in a single request.
        const j = startJob(req.id);
        const text = prepareTexts(files, req.options).join('\n');
        const curating: TextTpl = { key: zh('正在让 {model} 读完整份聊天'), params: { model: req.options.ai.model } };
        report({
          id: req.id, phase: 'curate', done: 0, total: 0,
          label: curating,
          detail: pace(0, 0, j.t0),
          note: {
            key: zh('开始：{model} · 送出 {w} 万字 · 要 {n} 个词'),
            params: { model: req.options.ai.model, w: tenKCount(text.length, req.lang ?? 'zh'), n: req.n },
          },
        });
        // Heartbeat every 5 s during a request that can take minutes; done/total must follow the stream.
        let curDone = 0;
        let curAnswering = false;
        const tick = setInterval(() => report({
          id: req.id, phase: 'curate',
          done: curAnswering ? curDone : 0,
          total: curAnswering ? req.n : 0,
          label: curating,
          detail: pace(curDone, req.n, j.t0),
        }), 5000);
        /** Stream progress so the UI shows the model is producing output. Throttled to 300 ms. */
        let lastTick = 0;
        // Recorded separately: the first frame is `content: ''` while the model may still be reasoning.
        let notedThink = false;
        let notedAnswer = false;
        const r = await curateWords(
          text, req.n, req.options.ai, counts, req.relay ? relayFetch : undefined, j.abort.signal,
          (soFar, thinking) => {
            const now = Date.now();
            if (now - lastTick < 300) return;
            lastTick = now;
            /** One word per line: completed lines are the real progress count. The last line may be partial. */
            const done = Math.min(req.n, soFar.split('\n').length - 1);
            curDone = done;
            // No denominator during the reasoning phase.
            const answering = soFar.length > 0;
            curAnswering = answering;
            let note: UserText | undefined;
            if (thinking && !notedThink) { notedThink = true; note = zh('模型开始思考'); }
            if (answering && !notedAnswer) { notedAnswer = true; note = zh('模型开始吐词'); }
            report({
              id: req.id, phase: 'curate',
              done: answering ? done : 0,
              total: answering ? req.n : 0,
              label: curating,
              detail: answering
                ? pace(done, req.n, j.t0)
                : {
                  key: thinking ? zh('已用 {t} · 模型在思考（{n} 字）') : zh('已用 {t} · 等模型开口'),
                  params: { t: span((now - j.t0) / 1000), n: thinking?.length ?? 0 },
                },
              note,
              // Only the latest piece is sent.
              stream: soFar.slice(-400),
              // Reasoning models think before the first word; the reasoning is shown meanwhile.
              thinking: thinking?.slice(-600),
            });
          },
        ).finally(() => clearInterval(tick));
        if ('error' in r) {
          const stopped = j.abort.signal.aborted;
          report({
            id: req.id, phase: 'curate', done: 0, total: 0,
            label: stopped ? zh('已停止') : zh('挑词失败'),
            note: stopped ? zh('你点了停止') : { key: zh('失败：{msg}'), params: { msg: r.error } },
          });
          post({
            id: req.id, ok: false,
            error: stopped ? zh('已停止') : fill(zh('挑词失败：{msg}'), { msg: r.error }),
          } as WorkerResponse);
          return;
        }
        report({
          id: req.id, phase: 'curate', done: 1, total: 1, label: zh('挑词完成'),
          note: r.result.promptTokens
            ? { key: zh('拿到 {n} 个词 · 用时 {t} · 送出 {tok} token'), params: { n: r.words.length, t: span(r.result.ms / 1000), tok: r.result.promptTokens } }
            : { key: zh('拿到 {n} 个词 · 用时 {t}'), params: { n: r.words.length, t: span(r.result.ms / 1000) } },
        });
        post({
          id: req.id, ok: true, kind: 'curate', words: r.words, curate: r.result, base,
        } as WorkerResponse);
        return;
      }

      report({ id: req.id, phase: 'parse', done: 0, total: files.length, label: zh('正在解析') });
      const opts = withBundleDictionary(req.options);
      // LLM tokenization replaces the segmentation stage only; discovery, dictionary, entities and stop words still run.
      let presegmented: (string[] | undefined)[] | undefined;
      const aiReady = opts.ai.enabled && !!opts.ai.endpoint && !!opts.ai.model;
      const texts0 = aiReady ? prepareTexts(files, opts) : [];
      const sig = aiReady ? signature(texts0, opts.ai) : '';

      // Same text and settings: reuse the previous result without a request.
      if (aiReady && aiCache && aiCache.sig === sig) {
        presegmented = aiCache.presegmented;
        // No note: the UI derives text from the phase; the cache path is instantaneous.
        report({ id: req.id, phase: 'aicache', done: 1, total: 1, label: zh('沿用上次的大模型分词结果') });
      } else if (aiReady && req.runAi) {
        const texts = texts0;
        presegmented = [];
        const j = startJob(req.id);

        /** Progress per chunk, not per message. */
        const totalChunks = texts.reduce(
          (a, t) => a + Math.max(1, Math.ceil(t.length / Math.max(1, opts.ai.chunkChars))), 0);
        let doneChunks = 0;
        let fellBack = 0;
        let lastAiError: string | undefined;
        const t0 = Date.now();

        /** Elapsed / speed / remaining */
        const stats = () => {
          const sec = (Date.now() - t0) / 1000;
          const rate = doneChunks / Math.max(0.001, sec);
          const left = Math.max(0, totalChunks - doneChunks);
          const eta = rate > 0 ? left / rate : 0;
          return { sec, rate, eta };
        };
        const statsText = (): UserText => {
          const st = stats();
          return {
            key: zh('已用 {t} · {rate} 块/秒 · 约剩 {left}'),
            params: { t: span(st.sec), rate: st.rate.toFixed(1), left: span(st.eta) },
          };
        };
        const aiLabel = (): TextTpl => ({
          key: zh('大模型分词 {done}/{total} 块'), params: { done: doneChunks, total: totalChunks },
        });

        /** Report the `ai` phase immediately so the stop button and log appear from the start. */
        report({
          id: req.id, phase: 'ai', done: 0, total: totalChunks,
          label: aiLabel(),
          detail: zh('正在发出第一批请求…'),
          note: {
            key: zh('开始：{model} · 共 {n} 块 · 同时发 {c} 个'),
            params: { model: opts.ai.model, n: totalChunks, c: opts.ai.concurrency },
          },
        });

        for (let i = 0; i < texts.length; i++) {
          const startedAt = doneChunks;
          const { tokens, progress } = await segmentWithAi(
            texts[i],
            opts.ai,
            // A failed chunk falls back to local tokenization.
            (s2) => segmentToChunks(s2).flat(),
            (p) => {
              doneChunks = startedAt + p.done;
              report({
                id: req.id, phase: 'ai', done: doneChunks, total: totalChunks,
                label: aiLabel(),
                detail: statsText(),
                // Fallback chunks are reported so the user knows part of the result is local.
                note: p.fellBack > fellBack
                  ? { key: zh('第 {n} 块退回本地：{err}'), params: { n: doneChunks, err: p.lastError ?? zh('未知原因') } }
                  : undefined,
              });
              fellBack = Math.max(fellBack, p.fellBack);
              if (p.lastError) lastAiError = p.lastError;
            },
            req.relay ? relayFetch : undefined,
            j.abort.signal,
          );
          presegmented.push(tokens);
          doneChunks = startedAt + progress.total;
          if (progress.fellBack > 0 && progress.fellBack === progress.total) {
            // Everything failed: most likely a wrong endpoint or key.
            report({
              id: req.id, phase: 'ai', done: doneChunks, total: totalChunks,
              label: aiLabel(),
              note: { key: zh('第 {n} 条整条退回本地：{err}'), params: { n: i + 1, err: progress.lastError ?? zh('未知原因') } },
            });
          }
        }
        if (fellBack > 0 && fellBack === totalChunks) {
          // Nothing came back from the model: say so loudly instead of silently showing the
          // local result again, which looked like the button did nothing.
          job = null;
          throw new Error(fill(zh('大模型分词全部失败（{n} 块）：{err}'), { n: totalChunks, err: lastAiError ?? zh('未知原因') }));
        }
        if (fellBack > 0) {
          report({
            id: req.id, phase: 'ai', done: totalChunks, total: totalChunks,
            label: zh('大模型分词完成'),
            note: { key: zh('共 {f}/{n} 块退回了本地分词'), params: { f: fellBack, n: totalChunks } },
          });
        }
        aiCache = { sig, presegmented };
        job = null;
      }
      const jobT0 = Date.now();
      let lastTick = 0;
      let saidParse = false;
      const result = await analyzeAsync(files, opts, presegmented, (done, total) => {
        // done/total are characters, so a single 5 MB file is not stuck at 0/1.
        const first = !saidParse;
        saidParse = true;
        report({
          id: req.id, phase: 'parse', done, total, label: zh('正在解析'),
          detail: pace(done, total, jobT0),
          note: first && files.length > 1 ? { key: zh('开始解析 {n} 个文件'), params: { n: files.length } } : undefined,
        });
      }, (done, total) => {
        // Batched tokenization progress, throttled to 120 ms.
        const now = Date.now();
        if (done < total && now - lastTick < 120) return;
        lastTick = now;
        report({
          id: req.id, phase: 'tokenize', done, total,
          label: { key: zh('正在分词 {done}/{total} 千字'), params: { done: Math.round(done / 1000), total: Math.max(1, Math.round(total / 1000)) } },
          detail: pace(done, total, jobT0),
        });
      }, yieldFn, (done, total) => {
        // Counting, generic detection and co-occurrence: half a second on a big corpus,
        // and the last thing the ring shows before the result appears.
        const now = Date.now();
        if (done < total && now - lastTick < 120) return;
        lastTick = now;
        report({ id: req.id, phase: 'count', done, total, label: zh('正在汇总'), detail: pace(done, total, jobT0) });
      });
      report({
        id: req.id, phase: 'tokenize', done: 1, total: 1, label: zh('完成'),
        detail: pace(1, 1, jobT0),
        note: {
          key: zh('{msgs} 条消息 · {w} 万字 · {u} 个不重复词 · 用时 {ms} ms'),
          params: {
            msgs: result.messageCount, w: tenKCount(result.cleanChars, req.lang ?? 'zh'),
            u: result.uniqueTokens, ms: Date.now() - jobT0,
          },
        },
      });
      post({ id: req.id, ok: true, kind: 'analyze', result } as WorkerResponse);
    } catch (err) {
      post({
        id: req.id,
        ok: false,
        error: err instanceof Error ? `${err.message}\n${err.stack ?? ''}` : String(err),
      } as WorkerResponse);
    }
  }

  return (req: WorkerRequest) => handle(req).catch((err: unknown) => {
    post({
      id: req.id,
      ok: false,
      error: err instanceof Error ? `${err.message}\n${err.stack ?? ''}` : String(err),
    } as WorkerResponse);
  });
}
