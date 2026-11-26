import type { ReactNode } from 'react';
import { cn } from '../_internal/cn';
import { toRowStatus } from '../_internal/rowStatus';
import './Table.css';

export interface TableColumn {
  key: string;
  header: string;
  mono?: boolean;
}

export function Table({
  columns,
  rows,
  className,
  rowStatus,
  selectedIndex,
}: {
  columns: ReadonlyArray<TableColumn>;
  rows: ReadonlyArray<Record<string, ReactNode>>;
  className?: string;
  /** v1: status for the 3px left row bar (family name or task status code). */
  rowStatus?: (row: Record<string, ReactNode>, index: number) => string | null | undefined;
  /** v1: highlights one row with the selected tone. */
  selectedIndex?: number;
}) {
  return (
    <div data-ui="table" className={cn('org-table-wrap', className)}>
      <table className="org-table">
        <thead>
          <tr>
            {columns.map((col) => (
              <th key={col.key} className="org-table__th">
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, idx) => (
            <tr
              key={idx}
              className="org-table__tr"
              data-status={rowStatus ? toRowStatus(rowStatus(row, idx)) : undefined}
              data-selected={selectedIndex === idx ? 'true' : undefined}
            >
              {columns.map((col) => (
                <td
                  key={col.key}
                  data-mono={col.mono ? 'true' : undefined}
                  className="org-table__td"
                >
                  {row[col.key]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

