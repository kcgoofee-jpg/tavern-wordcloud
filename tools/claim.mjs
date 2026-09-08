/**
 * The claim table in TODO.md, enforced.
 *
 *   node tools/claim.mjs list          # who has claimed which files
 *   node tools/claim.mjs check         # exit 1 if a STAGED file is claimed by someone else
 *   WC_WHO=Grok node tools/claim.mjs check
 *
 * Two agents share this checkout and coordinate only through the 「本轮：**X 认领 …**。独占：`a`、`b`」
 * lines under ## 进行中 in TODO.md. The rule was written down on 2026-09-05 and broken by hand
 * several times since (a rebase that flattened merges, a commit that swept the other side's
 * staged files along). This is the same rule as a script: staging a file the other side has
 * claimed fails, before the commit exists.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ME = process.env.WC_WHO || 'Claude';
const cmd = process.argv[2] || 'check';

const todo = readFileSync(path.join(ROOT, 'TODO.md'), 'utf8');
const start = todo.indexOf('## 进行中');
const block = start < 0 ? '' : todo.slice(start).split('\n## ')[0];

/** [{ who, files[] }] from every line that names an owner and an 独占 list. */
const claims = [];
for (const line of block.split('\n')) {
  if (!/独占/.test(line)) continue;
  const who = /\*\*([A-Za-z一-鿿]+?)\s*认领/.exec(line)?.[1] ?? /\|\s*([A-Za-z一-鿿]+)\s*\|/.exec(line)?.[1];
  if (!who) continue;
  const after = line.slice(line.indexOf('独占'));
  const files = [...after.matchAll(/`([^`]+)`/g)].map((m) => m[1].trim()).filter((f) => /[./]/.test(f));
  if (files.length) claims.push({ who, files });
}

const matches = (claim, file) => {
  const c = claim.replace(/\\/g, '/').replace(/\/$/, '');
  if (c.includes('*')) return new RegExp('^' + c.replace(/[.+^${}()|[\]]/g, '\\$&').replace(/\*/g, '.*') + '$').test(file);
  return file === c || file.startsWith(c + '/');
};

if (cmd === 'list') {
  if (!claims.length) console.log('（TODO.md 里没有认领行）');
  for (const c of claims) console.log(`${c.who}: ${c.files.join(', ')}`);
  process.exit(0);
}

const staged = execFileSync('git', ['diff', '--cached', '--name-only', '-z'], { cwd: ROOT, encoding: 'utf8' }).split('\0').filter(Boolean);
const bad = [];
for (const f of staged) for (const c of claims) if (c.who !== ME && c.files.some((p) => matches(p, f))) bad.push(`${f} ← ${c.who} 认领中`);
if (bad.length) {
  console.error(`认领冲突（你是 ${ME}）：\n  ${bad.join('\n  ')}\n先在 TODO.md 的分工行里交接，或 git restore --staged 这些文件。`);
  process.exit(1);
}
console.log(`认领检查通过（${ME}，${staged.length} 个暂存文件，${claims.length} 条认领）`);
