/**
 * The layout audit is the one UI gate that blocks the deploy, and since 2026-09-09 it is spread
 * over one CI job per viewport. That split is only worth anything if every job really audits a
 * different viewport and every job's screenshots survive: three ways to get it silently wrong are
 *
 *   - a matrix entry drifting away from the viewports tools/audit.mjs knows about, so a job
 *     either dies on an unknown name or (worse, in an earlier draft) audits nothing and passes;
 *   - the run step losing AUDIT_VIEWPORTS, so all three jobs redo the same full sweep and the
 *     nine minutes come back with three times the runners;
 *   - the artifact name losing the viewport, so the three uploads collide and the failure that
 *     needed looking at is the one that got overwritten.
 *
 * None of those fail the workflow, so they are asserted here instead.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const yml = readFileSync(path.join(ROOT, '.github/workflows/ci.yml'), 'utf8');
const auditMjs = readFileSync(path.join(ROOT, 'tools/audit.mjs'), 'utf8');

/** The `audit:` job's block: from its key to the next job at the same indentation. */
const auditJob = (() => {
  const start = yml.indexOf('\n  audit:\n');
  expect(start, 'ci.yml still has an audit job').toBeGreaterThan(-1);
  const rest = yml.slice(start + 1);
  const next = /\n {2}[a-z][\w-]*:\n/.exec(rest.slice(1));
  return next ? rest.slice(0, next.index + 1) : rest;
})();

/** The viewports the matrix declares, e.g. ['1440x900', …]. */
const matrixViewports = (() => {
  const m = /\n\s*viewport:\s*\[([^\]]*)\]/.exec(auditJob);
  expect(m, 'the audit job declares a viewport matrix').not.toBeNull();
  return (m as RegExpExecArray)[1].split(',').map((s) => s.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);
})();

describe('ci audit matrix', () => {
  it('fans the audit out over exactly the three viewports tools/audit.mjs knows', () => {
    expect(matrixViewports).toHaveLength(3);
    // The same three, in the same order, as ALL_VIEWPORTS in tools/audit.mjs. An entry the tool
    // does not recognise makes the job exit 1 rather than audit nothing, but this catches the
    // drift at `npm test` instead of six minutes into CI.
    const known = [...auditMjs.matchAll(/\['(\d+)', ?'(\d+)'\]/g)].map((m) => `${m[1]}x${m[2]}`);
    expect(known, 'tools/audit.mjs still lists three viewports').toHaveLength(3);
    expect(matrixViewports).toEqual(known);
  });

  it('gives each job its own viewport, or the three jobs repeat the same full sweep', () => {
    const run = /\n\s*- run: ([^\n]*tools\/audit\.mjs[^\n]*)/.exec(auditJob);
    expect(run, 'the audit job runs tools/audit.mjs').not.toBeNull();
    const cmd = (run as RegExpExecArray)[1];
    expect(cmd, 'the viewport comes from the matrix, not a fixed value').toContain('AUDIT_VIEWPORTS=${{ matrix.viewport }}');
    expect(cmd, 'the build already happened in its own step').toContain('SHOT_NO_BUILD=1');
  });

  it('keeps one screenshot artifact per viewport instead of three uploads under one name', () => {
    const name = /\n\s*name: (audit-screenshots[^\n]*)/.exec(auditJob);
    expect(name, 'failing screenshots are still uploaded').not.toBeNull();
    expect((name as RegExpExecArray)[1]).toContain('${{ matrix.viewport }}');
  });

  it('lets a failing viewport report without cancelling the other two', () => {
    expect(auditJob).toMatch(/fail-fast:\s*false/);
  });
});
