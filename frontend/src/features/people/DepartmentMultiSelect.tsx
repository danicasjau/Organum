import { useMemo, useState } from 'react';
import { Button, Checkbox, Popover, Text, TextField } from '../../components/ui';
import type { DepartmentOut } from '../../lib/api/client';
import { DepartmentTag } from '../departments/DepartmentTag';
import './people.css';

/** Searchable multi-select of departments; the trigger shows the chosen ones as tags. */
export function DepartmentMultiSelect({
  departments,
  selectedIds,
  onChange,
  ariaLabel,
  disabled = false,
}: {
  departments: ReadonlyArray<DepartmentOut>;
  selectedIds: ReadonlyArray<string>;
  onChange: (ids: string[]) => void;
  ariaLabel: string;
  disabled?: boolean;
}) {
  const [query, setQuery] = useState('');
  const selected = departments.filter((d) => selectedIds.includes(d.id));
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return departments.filter(
      (d) => !q || d.name.toLowerCase().includes(q) || d.short_code.toLowerCase().includes(q),
    );
  }, [departments, query]);

  return (
    <div className="org-deptms" data-ui="department-multiselect">
      <div className="org-deptms__tags">
        {selected.length === 0 ? (
          <Text size="sm" variant="muted">
            No departments
          </Text>
        ) : (
          selected.map((d) => <DepartmentTag key={d.id} id={d.id} name={d.name} color={d.color} />)
        )}
      </div>
      {!disabled && (
        <Popover
          trigger={
            <Button size="sm" aria-label={ariaLabel}>
              Edit…
            </Button>
          }
        >
          <div className="org-deptms__menu" role="group" aria-label={ariaLabel}>
            <TextField
              aria-label={`Search ${ariaLabel}`}
              placeholder="Search departments…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            {filtered.map((d) => (
              <Checkbox
                key={d.id}
                label={`${d.short_code} · ${d.name}`}
                checked={selectedIds.includes(d.id)}
                onChange={(on) =>
                  onChange(on ? [...selectedIds, d.id] : selectedIds.filter((x) => x !== d.id))
                }
              />
            ))}
            {filtered.length === 0 && (
              <Text size="sm" variant="muted">
                No match
              </Text>
            )}
          </div>
        </Popover>
      )}
    </div>
  );
}
