/**
 * Minimal markdown renderer for the bundled legal texts: headings, paragraphs,
 * lists, tables, blockquotes, and inline bold / code / links. Deliberately
 * small — no dependency, only what the five documents use.
 */
import type { ReactNode } from 'react';

/** Links between the documents (`terms-of-service.zh.md`) become in-app routes. */
const DOC_ROUTE: [RegExp, string][] = [
  [/terms-of-service\.(zh|en)\.md/, '#/terms'],
  [/privacy-policy\.(zh|en)\.md/, '#/privacy'],
  [/disclaimer\.(zh|en)\.md/, '#/disclaimer'],
  [/content-policy\.(zh|en)\.md/, '#/content'],
  [/law-enforcement-policy\.(zh|en)\.md/, '#/enforcement'],
];

function linkHref(href: string): { href: string; external: boolean } {
  if (href.startsWith('#/')) return { href, external: false };
  for (const [re, route] of DOC_ROUTE) if (re.test(href)) return { href: route, external: false };
  return { href, external: /^https?:\/\//.test(href) };
}

/** Inline: **bold**, `code`, [text](href). Plain regex splitting; no nesting. */
function inline(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /\*\*([^*]+)\*\*|`([^`]+)`|\[([^\]]+)\]\(([^)]+)\)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let k = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    if (m[1] !== undefined) out.push(<strong key={k++}>{m[1]}</strong>);
    else if (m[2] !== undefined) out.push(<code key={k++}>{m[2]}</code>);
    else {
      const { href, external } = linkHref(m[4]);
      out.push(
        <a key={k++} href={href} {...(external ? { target: '_blank', rel: 'noreferrer noopener' } : {})}>
          {m[3]}
        </a>,
      );
    }
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

const isTableLine = (l: string) => l.trim().startsWith('|') && l.trim().endsWith('|');
const isTableSep = (l: string) => /^\|[\s:|-]+\|$/.test(l.trim());
const splitRow = (l: string) => l.trim().slice(1, -1).split('|').map((c) => c.trim());

/** Render a markdown document to React nodes. */
export function renderMarkdown(src: string): ReactNode[] {
  const lines = src.split('\n');
  const blocks: ReactNode[] = [];
  let i = 0;
  let k = 0;
  while (i < lines.length) {
    const line = lines[i];
    const t = line.trim();
    if (!t) { i++; continue; }

    const head = /^(#{1,3})\s+(.*)$/.exec(t);
    if (head) {
      const level = head[1].length;
      const body = inline(head[2]);
      blocks.push(level === 1 ? <h1 key={k++}>{body}</h1> : level === 2 ? <h2 key={k++}>{body}</h2> : <h3 key={k++}>{body}</h3>);
      i++;
      continue;
    }

    if (isTableLine(line)) {
      const rows: string[][] = [];
      while (i < lines.length && isTableLine(lines[i])) {
        if (!isTableSep(lines[i])) rows.push(splitRow(lines[i]));
        i++;
      }
      const [head2, ...body] = rows;
      blocks.push(
        <table key={k++}>
          {head2 && <thead><tr>{head2.map((c, j) => <th key={j}>{inline(c)}</th>)}</tr></thead>}
          <tbody>{body.map((r, ri) => <tr key={ri}>{r.map((c, ci) => <td key={ci}>{inline(c)}</td>)}</tr>)}</tbody>
        </table>,
      );
      continue;
    }

    if (t.startsWith('>')) {
      const quote: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith('>')) quote.push(lines[i++].trim().slice(1).trim());
      blocks.push(<blockquote key={k++}>{inline(quote.join(' '))}</blockquote>);
      continue;
    }

    if (t.startsWith('- ')) {
      const items: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith('- ')) items.push(lines[i++].trim().slice(2));
      blocks.push(<ul key={k++}>{items.map((it, j) => <li key={j}>{inline(it)}</li>)}</ul>);
      continue;
    }

    if (/^\d+\.\s/.test(t)) {
      const items: string[] = [];
      while (i < lines.length && /^\d+\.\s/.test(lines[i].trim())) items.push(lines[i++].trim().replace(/^\d+\.\s/, ''));
      blocks.push(<ol key={k++}>{items.map((it, j) => <li key={j}>{inline(it)}</li>)}</ol>);
      continue;
    }

    // Paragraph: consume continuation lines that are not another block opener
    const para: string[] = [t];
    i++;
    while (i < lines.length) {
      const n = lines[i].trim();
      if (!n || /^(#{1,3}\s|>|- |\d+\.\s)/.test(n) || isTableLine(lines[i])) break;
      para.push(n);
      i++;
    }
    blocks.push(<p key={k++}>{inline(para.join(' '))}</p>);
  }
  return blocks;
}
