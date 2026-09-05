import { useEffect, useRef, useState } from 'react';
import { useT } from '../i18n';
import { segmentChunk, listModels, PROVIDER_PRESETS, type AiTokenizerConfig } from '../../core/aiTokenizer';
import { labelKinds, labelPayload, labelChars } from '../../core/labelKinds';
import type { EntityKind } from '../../core/entities';
import { classifyError } from '../../core/errors';
import { tx, txv } from '../i18n';
import Icon, { type IconName } from '../Icons';
import Note from '../Note';
import Slider from './Slider';
import { relayFetch } from '../../net/relay';

/** Preset id -> icon. Icon only: the brand mark is the label, the name is the tooltip. */
const PRESET_ICON: Record<string, IconName> = {
  deepseek: 'deepseek', openrouter: 'openrouter', zen: 'opencode', ollama: 'ollama',
  openai: 'openai', siliconflow: 'siliconflow', moonshot: 'moonshot',
  dashscope: 'dashscope', lmstudio: 'lmstudio',
};

export function AiPanel({
  ai, setAi, canRun, busy, onRun, relay, onProposeRules, proposing, focus,
  labelWords, onLabeled,
}: {
  /** Words the user can ask the model to file into kinds. Only these are ever sent. */
  labelWords?: string[];
  /** Receives word -> kind; the caller writes it into settings.overrides. */
  onLabeled?: (kinds: Record<string, EntityKind>) => void;
  /** Field to put the cursor in when the panel opens because that field is empty. */
  focus?: 'endpoint' | 'model' | 'key';
  /** Ask the model for cleaning rules; undefined when no files are loaded. */
  onProposeRules?: () => void;
  proposing?: boolean;
  /** Relay through the server when available (provider CORS). */
  relay: boolean;
  ai: AiTokenizerConfig;
  setAi: (c: AiTokenizerConfig) => void;
  /** Configuration complete and enabled: a run can start. */
  canRun: boolean;
  busy: boolean;
  onRun: () => void;
}) {
  const t = useT();
  /** The switch that opened this panel says which field is missing; put the cursor there. */
  const endpointRef = useRef<HTMLInputElement>(null);
  const modelRef = useRef<HTMLInputElement>(null);
  const keyRef = useRef<HTMLInputElement>(null);
  const testRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!focus) return undefined;
    /**
     * The target can be missing or still disabled on the first pass: this panel arrives through
     * React.lazy, and the test button stays disabled until the saved endpoint is read back.
     * focus() on a disabled element does nothing, and the overlay shell then takes the focus
     * itself — which is what made this flaky on CI (2026-09-05). Retry for a few ticks.
     */
    let timer: ReturnType<typeof setTimeout> | undefined;
    let tries = 0;
    const put = (): void => {
      const el = focus === 'endpoint' ? endpointRef.current
        // No model box until the list is fetched: the missing-model shortcut lands on the test button.
        : focus === 'model' ? (modelRef.current ?? testRef.current)
          : focus === 'key' ? keyRef.current : null;
      if (el && !el.disabled) { el.focus(); return; }
      if (++tries < 6) timer = setTimeout(put, 16);
    };
    put();
    return () => { if (timer !== undefined) clearTimeout(timer); };
  }, [focus]);
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; hint?: string } | null>(null);
  /** Model list, filled by a successful connection test; manual entry stays available. */
  const [models, setModels] = useState<string[] | null>(null);
  /** Endpoint has no /models list: let the user type the name. */
  const [manual, setManual] = useState(false);
  /** Key box reads as dots until the eye is pressed. */
  const [showKey, setShowKey] = useState(false);

  /**
   * One button does everything: probe the endpoint, then — if it answered — fill the
   * model box from `/models`. Failures are classified by shape into one actionable line.
   */
  const test = async () => {
    setTesting(true);
    setResult(null);
    // i18n-exempt: test data, not UI copy; exercises the Chinese tokenization path
    const probe = '沈砚秋把通告单递给制片主任。';
    const doFetch = relay ? relayFetch : fetch;
    /**
     * Models first, probe second. A fresh setup has no model name yet, and probing with an
     * empty one only ever produces a 400 ("Model field cannot be empty"), which told the user
     * nothing. When the list comes back and the box is empty, the first model is filled in.
     */
    const list = await listModels(ai, doFetch);
    let cfg = ai;
    if ('models' in list) {
      setModels(list.models);
      if (!ai.model.trim()) { cfg = { ...ai, model: list.models[0] }; setAi(cfg); }
    } else {
      setManual(true);
      if (!ai.model.trim()) { setTesting(false); setResult({ ok: false, hint: t('这个接口没有模型列表，请手动填模型名再测') }); return; }
    }
    const r = await segmentChunk(probe, cfg, doFetch);

    if (!r.fellBack) {
      setTesting(false);
      setResult({ ok: true });
      return;
    }
    setTesting(false);

    const e = r.error ?? '';
    const say = (hint: string) => setResult({ ok: false, hint });
    if (/Failed to fetch|NetworkError|ERR_/i.test(e)) say(t('连不上这个地址，检查地址和网络'));
    else if (/\b401\b|Unauthorized/i.test(e)) say(t('密钥不对'));
    else if (/\b402\b|insufficient|balance|quota/i.test(e)) say(t('余额或额度不够'));
    else if (/\b403\b|Forbidden/i.test(e)) say(t('密钥没有这个权限'));
    else if (/\b404\b/i.test(e)) say(t('地址或模型名不对'));
    else if (/\b400\b/i.test(e)) say(cfg.model.trim() ? t('对方拒绝了请求：检查模型名') : t('先选一个模型'));
    else if (/\b429\b|rate.?limit/i.test(e)) say(t('被限流了，稍后再试'));
    else if (/\b5\d\d\b/.test(e)) say(t('对方服务器出错，稍后再试'));
    // i18n-exempt: matches an internal error message
    else if (/不是 JSON|没有 choices/i.test(e)) say(t('模型没按格式回话，换个更强的'));
    // i18n-exempt: same
    else if (/拼不回原文/i.test(e)) say(t('模型改了字或漏了字，这个模型不适合切词'));
    else say(e || t('没见过的错误'));
  };

  /** null: idle. 'preview': the confirmation is up. */
  const [labelStage, setLabelStage] = useState<null | 'preview' | 'running'>(null);
  const [labelMsg, setLabelMsg] = useState<string | null>(null);
  const toSend = labelPayload(labelWords ?? []);

  const runLabel = async () => {
    setLabelStage('running');
    setLabelMsg(null);
    const res = await labelKinds(toSend, ai, (relay ? relayFetch : fetch) as typeof fetch);
    setLabelStage(null);
    if ('error' in res) {
      const err = classifyError(new Error(res.error));
      setLabelMsg([txv(err.titleTpl ?? err.title), err.hintTpl ? txv(err.hintTpl) : err.hint ? tx(err.hint) : '']
        .filter(Boolean).join(' — '));
      return;
    }
    const n = Object.keys(res.kinds).length;
    onLabeled?.(res.kinds);
    setLabelMsg(t('已标注 {n} 个词，去「检查」面板可以逐个改', { n }));
  };

  const ready = ai.endpoint.trim().length > 0 && ai.model.trim().length > 0;
  const preset = PROVIDER_PRESETS.find((p) => p.endpoint === ai.endpoint && p.model === ai.model);

  return (
    <>
      {/* Address line: the address takes the whole row; the provider shortcuts sit at the bottom. */}
      <div className="ai-line ai-line-url">
        <input className="ai-url" type="url" ref={endpointRef} placeholder="https://…/v1" aria-label={t('地址')}
          title={t('地址')}
          value={ai.endpoint} onChange={(e) => { setResult(null); setModels(null); setAi({ ...ai, endpoint: e.target.value }); }} />
      </div>

      {/* Key line: the box fills the row, the eye sits at its end. */}
      <div className="ai-line ai-line-key">
        <input className="ai-key" type={showKey ? 'text' : 'password'} ref={keyRef} aria-label={t('密钥')}
          title={t('密钥只存在你自己的浏览器里')}
          placeholder={preset && !preset.needsKey ? t('本地不用填') : 'sk-…'}
          value={ai.apiKey} onChange={(e) => { setResult(null); setAi({ ...ai, apiKey: e.target.value }); }} />
        <button type="button" className="ai-eye" aria-pressed={showKey}
          title={showKey ? t('隐藏密钥') : t('显示密钥')} aria-label={showKey ? t('隐藏密钥') : t('显示密钥')}
          onClick={() => setShowKey((v) => !v)}>
          <Icon name={showKey ? 'eyeOff' : 'eye'} size={16} />
        </button>
      </div>

      {/* Model line, then the action that fills it: address, key, model, button — a form reads top to bottom. */}
      <div className="ai-line ai-line-model">
        {models ? (
          <select className="ai-model" aria-label={t('模型')} title={t('模型')}
            value={ai.model} onChange={(e) => { setResult(null); setAi({ ...ai, model: e.target.value }); }}>
            {!models.includes(ai.model) && ai.model && <option value={ai.model}>{ai.model}</option>}
            {models.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        ) : manual || ai.model ? (
          <input className="ai-model" type="text" ref={modelRef} placeholder={t('模型名')}
            aria-label={t('模型')} title={t('这个接口没有模型列表，手动填模型名')}
            value={ai.model} onChange={(e) => { setResult(null); setAi({ ...ai, model: e.target.value }); }} />
        ) : (
          /* Nothing to pick from yet: a disabled select says so instead of a text box that
             looked like it wanted a name typed in. Typing is only a fallback for endpoints
             without a /models list (the test flips `manual` when the list fails). */
          <select className="ai-model" aria-label={t('模型')} title={t('先点「测试连接」，模型会列在这里')} disabled>
            <option>{t('测试连接后在这里选')}</option>
          </select>
        )}
      </div>

      <div className="ai-line ai-line-test">
        <button type="button" className={`more ai-test${result?.ok ? ' ok' : ''}`}
          ref={testRef} disabled={!ai.endpoint.trim() || testing} onClick={() => void test()}>
          {testing ? t('正在试…') : result?.ok ? <><Icon name="check" size={15} />{t('已连通')}</> : t('测试连接')}
        </button>
      </div>
      {result && !result.ok && <p className="ai-err">{result.hint}</p>}

      {/* One switch for the whole feature: tokenizing and keyword picking both go to this endpoint. */}
      <label className="check">
        <input type="checkbox" checked={ai.enabled} disabled={!ready}
          onChange={(e) => setAi({ ...ai, enabled: e.target.checked })} />
        <span>
          {t('分词和挑词都走这个接口')}
          <Note>{t('几十万字要拆成几百块、发几百次请求，所以慢。每块切完都和原文核对，对不上整块退回默认分词，数字不会错。')}</Note>
        </span>
      </label>
      {canRun && (
        <button type="button" className="more" disabled={busy} onClick={onRun}>
          {busy ? t('正在跑…') : t('用大模型重新分词')}
        </button>
      )}

      <Slider label={t("一次送多少字")} value={ai.chunkChars} min={200} max={4000} step={100}
        onChange={(v) => setAi({ ...ai, chunkChars: v })} />
      <Slider label={t("同时发几个请求")} value={ai.concurrency} min={1} max={8}
        onChange={(v) => setAi({ ...ai, concurrency: v })} />

      {/* Kind labelling: word list only, never chat text. The preview says exactly what goes out. */}
      {!!toSend.length && (
        <div className="ai-line">
          <button type="button" className="more" disabled={!ready || labelStage === 'running'}
            title={t('只把词表发给上面的接口，不发聊天正文')}
            aria-label={t('让模型分类')}
            onClick={() => { setLabelMsg(null); setLabelStage('preview'); }}>
            <Icon name="tag" size={15} />{labelStage === 'running' ? t('正在分类…') : t('让模型分类')}
          </button>
        </div>
      )}
      {labelStage === 'preview' && (
        <div className="confirm-veil" onClick={(e) => { if (e.target === e.currentTarget) setLabelStage(null); }}>
          <div className="confirm-card" role="dialog" aria-modal="true" aria-label={t('让模型分类')}>
            <div className="confirm-head">
              <span className="confirm-title">{t('让模型分类')}</span>
              <button type="button" className="sheet-close" title={t('取消')} onClick={() => setLabelStage(null)}>
                <Icon name="close" size={17} />
              </button>
            </div>
            <div className="confirm-body">
              <p className="note">{t('将发送 {n} 个词，约 {m} 字符，不含聊天正文', { n: toSend.length, m: labelChars(toSend) })}</p>
            </div>
            <div className="confirm-foot">
              <button type="button" className="confirm-btn" onClick={() => setLabelStage(null)}>{t('取消')}</button>
              <button type="button" className="confirm-btn primary"
                onClick={() => { setLabelStage(null); void runLabel(); }}>{t('发送')}</button>
            </div>
          </div>
        </div>
      )}
      {labelMsg && <p className="ai-err">{labelMsg}</p>}

      {/* The (i) sits beside the button, never inside it: a button inside a button is invalid. */}
      <div className="ai-line">
        <button type="button" className="more" disabled={!onProposeRules || !ready || !!proposing} onClick={onProposeRules}>
          {proposing ? t('正在写规则…') : t('让模型为这份记录写清洗规则')}
        </button>
        <Note>{t('从这份记录里挑最多 5 条原文，发给你在上面填的那个接口，请它写出正则来删掉状态栏、变量块这类非剧情内容。网页版为绕开跨域会经本站中转，中转不保存内容；单文件版直连。写回来的每条规则都先在样本上跑过，确认只删掉该删的才会加进来。')}</Note>
      </div>

      {/* Provider shortcuts last: they fill the two boxes above, so they read as a footer, not a toolbar. */}
      <div className="ai-line ai-presets-row">
        <span className="ai-presets">
          {PROVIDER_PRESETS.map((p) => (
            <button key={p.id} type="button" className={`ai-preset${preset?.id === p.id ? ' on' : ''}`}
              /* Brand names, not translated */
              title={t('用 {name} 的地址填上面', { name: p.label })} aria-label={p.label} aria-pressed={preset?.id === p.id}
              onClick={() => { setResult(null); setModels(null); setAi({ ...ai, endpoint: p.endpoint, model: p.model }); }}>
              <Icon name={PRESET_ICON[p.id] ?? 'plug'} size={16} />
            </button>
          ))}
        </span>
      </div>
    </>
  );
}
