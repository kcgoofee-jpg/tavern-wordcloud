/**
 * User-facing error classification. Known errors explain what happened and what
 * to do; unknown errors show the raw message with a copy button.
 *
 * Titles and hints are zh()-marked Chinese; the toast translates them via tx().
 * Server errors carry a `code` (see server/index.ts) looked up in SERVER_CODES,
 * so an English UI never shows the raw Chinese message; without a code the raw
 * message is the fallback.
 */
import { fill, zh, type TextTpl } from './zh';

export interface AppError {
  /**
   * notice  informational, not a failure
   * known   recognized error with guidance
   * unknown unrecognized error, raw message shown
   */
  kind: 'notice' | 'known' | 'unknown';
  title: string;
  hint?: string;
  detail?: string;
  /**
   * Templated title/hint (server codes carry numbers). When present the toast
   * renders txv(titleTpl) / txv(hintTpl) instead of the pre-filled strings.
   */
  titleTpl?: TextTpl;
  hintTpl?: TextTpl;
  /** An action attached to the notice. */
  action?: { label: string; run: () => void };
}

const KNOWN: { match: RegExp; title: string; hint: string }[] = [
  {
    // LongCat: {"code":"security_audit_fail","message":"…含有违规信息…"}; others say content_filter / moderation.
    match: /security_audit|content_filter|content_policy|moderation|违规信息|敏感内容/i,
    title: zh('这家接口的内容审核拒绝了这段文字'),
    hint: zh('成人向文本会被有审核的模型拒收，接口本身没坏。换一家不做内容审核的接口（如 DeepSeek 直连、OpenRouter 上的开源模型、本地 Ollama），或只用不需要发正文的功能。'),
  },
  {
    match: /认不出格式|不是合法 JSON/,
    title: zh('这个文件不像酒馆的聊天记录'),
    hint: zh('要 .jsonl 或 .json。在酒馆数据目录的 default-user/chats/<角色名>/ 里找。'),
  },
  { match: /文件是空的/, title: zh('文件是空的'), hint: zh('换一个有内容的聊天记录。') },
  {
    match: /一条消息都没有/,
    title: zh('文件能读，但里面没有消息'),
    hint: zh('这可能是角色卡或世界书——它们也是 .json，但结构不一样。'),
  },
  {
    match: /clipboard|Clipboard|not allowed|NotAllowedError|Document is not focused/,
    title: zh('浏览器不让复制'),
    hint: zh('手动选中，或直接截图二维码。'),
  },
  {
    match: /Failed to construct 'Worker'|worker script|importScripts|Worker is not defined|worker error/i,
    title: zh('后台线程没起来'),
    hint: zh('刷新一次。一直这样多半是浏览器太旧。'),
  },
  {
    match: /没填接口|endpoint.*(empty|missing)|no endpoint/i,
    title: zh('还没填接口地址或模型'),
    hint: zh('打开「大模型接口」面板，填地址、模型和密钥。'),
  },
  {
    match: /\b401\b|\b403\b|Unauthorized|invalid[_ ]api[_ ]key|authentication/i,
    title: zh('密钥不对或没有权限'),
    hint: zh('检查密钥有没有复制全、是不是这家接口的。'),
  },
  {
    match: /\b404\b|model_not_found|does not exist|not found/i,
    title: zh('地址或模型名不对'),
    hint: zh('地址要到 /v1/chat/completions；模型名点「测试连接」后选。'),
  },
  {
    match: /\b429\b|rate limit|quota|insufficient/i,
    title: zh('接口限流或余额不足'),
    hint: zh('等一会儿再试，或换一家接口。'),
  },
  {
    match: /Failed to fetch|NetworkError|ECONNREFUSED|ENOTFOUND|net::|CORS/i,
    title: zh('连不上这个接口'),
    hint: zh('网页版会经服务器中转；本地版遇到不开跨域的供应商会失败，换网页版或换一家。'),
  },
  {
    match: /QuotaExceeded|quota|Maximum call stack|out of memory|Array buffer allocation/i,
    title: zh('文件太大，浏览器扛不住了'),
    hint: zh('少拖几个，或把「最多显示几个词」调小。'),
  },
];

/**
 * Errors the server sends with a `code` field. The Chinese message remains in
 * the response as a fallback for old clients; the numbers travel as params.
 */
const SERVER_CODES: Record<string, { title: string; hint?: string }> = {
  too_large: { title: zh('文件太大（上限 {mb} MB）') },
  // Refused in the browser before the upload starts (net/server.ts), so the size is known exactly.
  too_large_local: { title: zh('网页版上限 10 MB，这份传上去有 {size} MB。上限按序列化后真正发出去的字节算，不是文件在硬盘上显示的大小。下载本地版可以在你自己的电脑上算，多大都行。') },
  rate_limited: { title: zh('这一小时已经分析了 {n} 次，约 {m} 分钟后可以继续；本地版没有次数限制。'), hint: zh('下载本地版可以立刻继续，而且不用上传。') },
  queue_full: { title: zh('服务器正忙（同时分析的人太多），过一分钟再试。') },
  maintenance: { title: zh('网站正在维护，暂时只能下载本地版；请稍后再来。') },
  relay_rate_limited: { title: zh('这一小时经服务器中转的请求太多了，歇一会儿。') },
  relay_path_denied: { title: zh('只中转 /chat/completions 和 /models') },
  relay_method_denied: { title: zh('只中转 GET 和 POST') },
  relay_https_only: { title: zh('只中转 https 目标') },
  relay_internal_denied: { title: zh('不中转内网地址') },
  relay_failed: { title: zh('中转失败：{msg}') },
  feedback_limited: { title: zh('今天反馈得够多了，谢谢。') },
  stats_down: { title: zh('统计后台没起来') },
  claim_limited: { title: zh('今天提交得够多了，明天再来。') },
  claim_bad_card: { title: zh('卡名不对（最多 60 字）') },
  claim_bad_url: { title: zh('链接要是完整的 https 网址') },
  claim_bad_token: { title: zh('校验串不对，回表单里重新取一个') },
};

/** An error carrying a server code; net/server.ts throws these for coded responses. */
export interface CodedError {
  code?: string;
  params?: Record<string, string | number>;
}

/** Informational notice. Warnings are not rendered as errors. */
export function notice(text: string): AppError {
  const [head, ...rest] = text.split(/[：:]\s*/);
  return rest.length
    ? { kind: 'notice', title: head, hint: rest.join('：') }
    : { kind: 'notice', title: text };
}

export function classifyError(raw: unknown): AppError {
  const msg = raw instanceof Error ? raw.message : String(raw ?? '');
  const { code, params } = (raw ?? {}) as CodedError;
  if (code && code in SERVER_CODES) {
    const c = SERVER_CODES[code];
    return {
      kind: 'known',
      title: fill(c.title, params),
      hint: c.hint && fill(c.hint, params),
      titleTpl: { key: c.title, params },
      hintTpl: c.hint ? { key: c.hint, params } : undefined,
      detail: msg,
    };
  }
  for (const k of KNOWN) {
    if (k.match.test(msg)) return { kind: 'known', title: k.title, hint: k.hint, detail: msg };
  }
  return {
    kind: 'unknown',
    title: zh('出了个没见过的问题'),
    hint: zh('下面是原始信息。'),
    detail: raw instanceof Error ? `${msg}\n${raw.stack ?? ''}`.trim() : msg,
  };
}
