import { useState } from 'react';
import { useT, tx } from './i18n';
import { ENTITY_LABEL, EXPERIMENTAL_KINDS, KIND_GROUPS, type EntityKind, type KindGroupId } from '../core/entities';

/*
 * Lives beside ImportPanel rather than in panels/: the import panel is on the
 * first-screen bundle and test/lazy.test.ts forbids it from statically reaching
 * src/ui/panels/.
 */

/**
 * The kind buttons, one collapsible section per group (notes/docs/33 §3).
 *
 * The 60-kind design cannot lay its buttons out flat, so every panel that shows
 * kinds renders this: 「常用」 is open, the rest are `<details>` the user opens.
 * `groups` narrows the sections (the import panel shows only 「常用」).
 */
export function KindGroups({
  value, onToggle, countOf, groups, title,
}: {
  /** Kinds currently switched on. */
  value: EntityKind[];
  onToggle: (k: EntityKind) => void;
  /** Words carrying the kind, shown on the button. */
  countOf?: (k: EntityKind) => number;
  /** Restrict to these groups; default is all of them. */
  groups?: readonly KindGroupId[];
  /** Extra tooltip per kind, on top of the experimental warning. */
  title?: (k: EntityKind) => string | undefined;
}) {
  const t = useT();
  const shown = KIND_GROUPS.filter((g) => !groups || groups.includes(g.id));

  const button = (k: EntityKind) => {
    const on = value.includes(k);
    const n = countOf?.(k);
    return (
      <button key={k} type="button" className={`kind${on ? ' on' : ''}`} aria-pressed={on}
        title={EXPERIMENTAL_KINDS.includes(k) ? t('实验，可能有误判') : title?.(k)}
        onClick={() => onToggle(k)}>
        <span>{tx(ENTITY_LABEL[k])}{EXPERIMENTAL_KINDS.includes(k) ? <i className="kind-exp">{t('实验')}</i> : null}</span>
        {n === undefined ? null : <em>{n}</em>}
      </button>
    );
  };

  return (
    <div className="kind-groups">
      {shown.map((g) => (
        g.id === 'common'
          ? <div key={g.id} className="kinds">{g.kinds.map(button)}</div>
          : (
            <details key={g.id} className="kind-group">
              <summary>{tx(g.label)}<em>{g.kinds.filter((k) => value.includes(k)).length}/{g.kinds.length}</em></summary>
              <div className="kinds">{g.kinds.map(button)}</div>
            </details>
          )
      ))}
    </div>
  );
}

/** Flat menu of every kind, for the «move this word» menus. Grouped by a `<optgroup>`-like heading. */
export function KindMenuItems({ current, onPick }: { current: EntityKind | undefined; onPick: (k: EntityKind) => void }) {
  const [openGroup, setOpenGroup] = useState<KindGroupId | null>('common');
  return (
    <>
      {KIND_GROUPS.map((g) => (
        <span key={g.id} className="kind-menu-group">
          <button type="button" role="menuitem" className="kind-menu-head"
            aria-expanded={openGroup === g.id}
            onClick={() => setOpenGroup(openGroup === g.id ? null : g.id)}>{tx(g.label)}</button>
          {openGroup === g.id && g.kinds.map((k) => (
            <button key={k} type="button" role="menuitem" className={current === k ? 'on' : ''}
              onClick={() => onPick(k)}>{tx(ENTITY_LABEL[k])}</button>
          ))}
        </span>
      ))}
    </>
  );
}
