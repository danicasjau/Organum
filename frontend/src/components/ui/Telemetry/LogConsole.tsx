import { useMemo, useState } from 'react';
import { Button } from '../Button/Button';
import { Select } from '../Select/Select';
import { SearchField } from '../TextField/TextField';
import './Telemetry.css';

export interface LogEntry {
  id: string;
  timestamp: string;
  level: 'INFO' | 'WARN' | 'ERROR';
  message: string;
}

export function LogConsole({
  entries,
  onClear,
}: {
  entries: ReadonlyArray<LogEntry>;
  onClear?: () => void;
}) {
  const [level, setLevel] = useState('ALL');
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return entries.filter((e) => {
      if (level !== 'ALL' && e.level !== level) return false;
      if (!q) return true;
      return e.message.toLowerCase().includes(q) || e.timestamp.includes(q);
    });
  }, [entries, level, query]);

  return (
    <div className="org-logconsole" role="log" aria-label="Log Console">
      <div className="org-logconsole__bar">
        <Select
          value={level}
          onChange={setLevel}
          options={[
            { value: 'ALL', label: 'ALL' },
            { value: 'INFO', label: 'INFO' },
            { value: 'WARN', label: 'WARN' },
            { value: 'ERROR', label: 'ERROR' },
          ]}
          ariaLabel="Log level filter"
        />
        <SearchField
          value={query}
          onChange={setQuery}
          placeholder="Filter logs..."
          ariaLabel="Filter log messages"
        />
        {onClear && (
          <Button size="sm" onClick={onClear}>
            Clear
          </Button>
        )}
      </div>
      <div className="org-logconsole__list">
        {filtered.map((e) => (
          <div key={e.id} className="org-logconsole__line">
            <span>{e.timestamp}</span>
            <span className="org-logconsole__lvl" data-level={e.level}>
              {e.level}
            </span>
            <span>{e.message}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
