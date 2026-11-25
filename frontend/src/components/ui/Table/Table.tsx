import type { ReactNode } from 'react';
import { cn } from '../_internal/cn';
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
}: {
  columns: ReadonlyArray<TableColumn>;
  rows: ReadonlyArray<Record<string, ReactNode>>;
  className?: string;
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
            <tr key={idx} className="org-table__tr">
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

