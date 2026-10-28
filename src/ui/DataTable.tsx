import type { ReactNode } from 'react';

export interface Column<T> { key: string; header: string; align?: 'start' | 'end'; render: (row: T) => ReactNode }
/** Semantic table inside its own horizontally scrollable, labelled region — never scrolls the page. */
export function DataTable<T>({ caption, columns, rows, rowKey, empty, rowAction }: { caption: string; columns: Column<T>[]; rows: T[]; rowKey: (r: T) => string; empty?: ReactNode; rowAction?: { label: (r: T) => string; onSelect: (r: T) => void; selected?: (r: T) => boolean } }) {
  if (rows.length === 0 && empty) return <>{empty}</>;
  return (
    <div className="pe-table-wrap" role="region" aria-label={caption} tabIndex={0}>
      <table className="pe-table">
        <caption className="pe-sr">{caption}</caption>
        <thead><tr>{columns.map((c) => <th key={c.key} scope="col" className={c.align === 'end' ? 'pe-end' : ''}>{c.header}</th>)}</tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={rowKey(r)} className={rowAction?.selected?.(r) ? 'is-selected' : ''}>
              {columns.map((c, i) => (
                <td key={c.key} className={c.align === 'end' ? 'pe-end pe-financial-number' : ''}>
                  {rowAction && i === 0 ? <button type="button" className="pe-link-btn" aria-pressed={rowAction.selected?.(r) ?? false} aria-label={rowAction.label(r)} onClick={() => rowAction.onSelect(r)}>{c.render(r)}</button> : c.render(r)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
