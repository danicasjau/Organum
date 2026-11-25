import { useEffect, useMemo, useState } from 'react';
import {
  Banner,
  Button,
  DataGrid,
  SearchField,
  Spinner,
  Text,
  type DataGridColumn,
} from '../../../components/ui';
import { apiClient } from '../../../lib/api/client';
import type { ViewerModuleProps } from '../moduleRegistry';
import './DataViewer.css';

function parseCsvText(text: string): { headers: string[]; rows: string[][] } {
  const rows: string[][] = [];
  let row: string[] = [];
  let cur = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];
    if (inQuotes) {
      if (ch === '"' && next === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(cur);
      cur = '';
    } else if (ch === '\r' && next === '\n') {
      row.push(cur);
      rows.push(row);
      row = [];
      cur = '';
      i++;
    } else if (ch === '\n' || ch === '\r') {
      row.push(cur);
      rows.push(row);
      row = [];
      cur = '';
    } else {
      cur += ch;
    }
  }
  if (cur.length > 0 || row.length > 0) {
    row.push(cur);
    rows.push(row);
  }
  const nonEmpty = rows.filter((r) => !(r.length === 1 && r[0] === ''));
  const headers = nonEmpty[0] ?? [];
  return { headers, rows: nonEmpty.slice(1) };
}

function JsonTreeNode({
  name,
  value,
  query,
  depth = 0,
}: {
  name: string;
  value: unknown;
  query: string;
  depth?: number;
}) {
  const [open, setOpen] = useState(depth < 2);
  const isObj = typeof value === 'object' && value !== null;
  const q = query.trim().toLowerCase();
  const keyMatch = Boolean(q && name.toLowerCase().includes(q));

  if (!isObj) {
    const valStr = JSON.stringify(value);
    const valMatch = Boolean(q && valStr.toLowerCase().includes(q));
    const cls =
      typeof value === 'number'
        ? 'org-dataviewer__jnum'
        : typeof value === 'boolean' || value === null
          ? 'org-dataviewer__jbool'
          : 'org-dataviewer__jstr';
    return (
      <div className="org-dataviewer__jrow" data-match={keyMatch || valMatch ? 'true' : undefined}>
        <span className="org-dataviewer__jkey">{name}:</span>
        <span className={cls}>{valStr}</span>
      </div>
    );
  }

  const entries = Array.isArray(value)
    ? value.map((v, i) => [`[${i}]`, v] as const)
    : Object.entries(value as Record<string, unknown>);

  return (
    <div>
      <div className="org-dataviewer__jrow" data-match={keyMatch ? 'true' : undefined}>
        <button
          type="button"
          className="org-dataviewer__jtoggle"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
        >
          {open ? '▼' : '▶'}
        </button>
        <span className="org-dataviewer__jkey">{name}</span>
        <Text size="sm" variant="muted">
          {Array.isArray(value) ? `[${entries.length}]` : `{${entries.length}}`}
        </Text>
      </div>
      {open && (
        <div className="org-dataviewer__jnode">
          {entries.map(([k, v]) => (
            <JsonTreeNode key={k} name={k} value={v} query={query} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  );
}

export function DataViewer({ file }: ViewerModuleProps) {
  const ext = file.detected_format.toLowerCase();
  const [rawText, setRawText] = useState('');
  const [parsedJson, setParsedJson] = useState<unknown>(undefined);
  const [viewMode, setViewMode] = useState<'tree' | 'raw'>('tree');
  const [search, setSearch] = useState('');
  const [csvRows, setCsvRows] = useState<Array<Record<string, unknown>>>([]);
  const [csvCols, setCsvCols] = useState<DataGridColumn[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function loadData() {
      setLoading(true);
      setError(null);
      try {
        const resp = await fetch(apiClient.fileContentUrl(file.id));
        if (!resp.ok) throw new Error(`Failed to fetch file (${resp.status})`);
        const text = await resp.text();
        if (cancelled) return;
        setRawText(text);

        if (ext === 'csv') {
          const parsed = parseCsvText(text);
          const cols: DataGridColumn[] = parsed.headers.map((h, idx) => {
            const sample = parsed.rows.map((r) => r[idx] ?? '').filter((v) => v.trim() !== '');
            const isNum = sample.length > 0 && sample.every((v) => Number.isFinite(Number(v)));
            return {
              key: h || `col_${idx}`,
              header: h || `col_${idx}`,
              numeric: isNum,
              width: isNum ? 110 : 140,
            };
          });
          const objs = parsed.rows.map((r) => {
            const rec: Record<string, unknown> = {};
            cols.forEach((c, idx) => {
              const raw = r[idx] ?? '';
              rec[c.key] = c.numeric && raw.trim() !== '' ? Number(raw) : raw;
            });
            return rec;
          });
          setCsvCols(cols);
          setCsvRows(objs);
        } else if (ext === 'json') {
          setParsedJson(JSON.parse(text));
        } else {
          // YAML -> derive parsed_json via PyYAML backend so complex YAML constructs parse identically
          const art = await apiClient.createArtifact(file.id, 'parsed_json', {});
          const jResp = await fetch(art.content_url);
          if (jResp.ok && !cancelled) {
            setParsedJson(await jResp.json());
          }
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to parse data');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void loadData();
    return () => {
      cancelled = true;
    };
  }, [file.id, ext]);

  const matchCount = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q || !rawText) return 0;
    let count = 0;
    const lower = rawText.toLowerCase();
    let pos = 0;
    while ((pos = lower.indexOf(q, pos)) !== -1) {
      count++;
      pos += q.length;
    }
    return count;
  }, [rawText, search]);

  if (loading) {
    return (
      <div className="org-dataviewer">
        <div className="org-dataviewer__body">
          <Spinner />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="org-dataviewer">
        <div className="org-dataviewer__body">
          <Banner severity="danger" title="Data Parse Error">
            {error}
          </Banner>
        </div>
      </div>
    );
  }

  if (ext === 'csv') {
    return (
      <div className="org-dataviewer">
        <div className="org-dataviewer__body">
          <DataGrid
            ariaLabel={`${file.filename} CSV Grid`}
            columns={csvCols}
            rows={csvRows}
            editable
            onCellEdit={(rowIndex, columnKey, nextValue) =>
              setCsvRows((prev) =>
                prev.map((row, idx) =>
                  idx === rowIndex
                    ? {
                        ...row,
                        [columnKey]:
                          csvCols.find((c) => c.key === columnKey)?.numeric &&
                          nextValue.trim() !== '' &&
                          Number.isFinite(Number(nextValue))
                            ? Number(nextValue)
                            : nextValue,
                      }
                    : row,
                ),
              )
            }
          />
        </div>
      </div>
    );
  }

  return (
    <div className="org-dataviewer">
      <div className="org-dataviewer__bar">
        <Button size="sm" pressed={viewMode === 'tree'} onClick={() => setViewMode('tree')}>
          Tree
        </Button>
        <Button size="sm" pressed={viewMode === 'raw'} onClick={() => setViewMode('raw')}>
          Raw
        </Button>
        <span className="org-dataviewer__spacer" />
        <SearchField
          className="org-dataviewer__search"
          value={search}
          onChange={setSearch}
          placeholder="Search keys/values..."
          ariaLabel="Search data document"
        />
        {search.trim() !== '' && (
          <Text size="sm" variant="mono">
            {matchCount} matches
          </Text>
        )}
      </div>
      <div className="org-dataviewer__body">
        {viewMode === 'raw' || parsedJson === undefined ? (
          <pre className="org-dataviewer__raw">{rawText}</pre>
        ) : (
          <div className="org-dataviewer__jtree" role="tree" aria-label="Structured data tree">
            <JsonTreeNode name={file.filename} value={parsedJson} query={search} />
          </div>
        )}
      </div>
    </div>
  );
}
