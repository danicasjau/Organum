import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Badge,
  Banner,
  Button,
  Checkbox,
  Dialog,
  Select,
  Text,
  TextField,
} from '../../components/ui';
import {
  ApiHttpError,
  apiClient,
  type ConfoColumnOut,
  type ConfoImportMappingIn,
  type ConfoImportPreviewOut,
  type ConfoImportRequest,
} from '../../lib/api/client';
import {
  CONFO_TYPES,
  dateStamp,
  downloadText,
  errorReportCsv,
  isCellIssueList,
  keyFromLabel,
  type CellIssue,
} from './confoModel';

const NEW = '__new__';
const STATUS_LABEL: Record<string, string> = {
  matched: 'Matched',
  create: 'Create',
  unmatched: 'Unmatched',
  ambiguous: 'Ambiguous',
  duplicate: 'Duplicate',
};
const STATUS_TONE: Record<string, 'success' | 'info' | 'warning' | 'danger' | 'neutral'> = {
  matched: 'success',
  create: 'info',
  unmatched: 'warning',
  ambiguous: 'danger',
  duplicate: 'danger',
};
const MAX_PREVIEW_ROWS = 200;

export function ConfoImportDialog({
  open,
  onOpenChange,
  projectUuid,
  columns,
  canManage,
  canCreateEntities,
  onImported,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectUuid: string | null;
  columns: ReadonlyArray<ConfoColumnOut>;
  canManage: boolean;
  canCreateEntities: boolean;
  onImported: (message: string) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState('');
  const [csvText, setCsvText] = useState('');
  const [matchBy, setMatchBy] = useState('auto');
  const [matchHeader, setMatchHeader] = useState<string | null>(null);
  const [mapping, setMapping] = useState<ConfoImportMappingIn[] | null>(null);
  const [createMissing, setCreateMissing] = useState(false);
  const [skipUnmatched, setSkipUnmatched] = useState(false);
  const [preview, setPreview] = useState<ConfoImportPreviewOut | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [commitIssues, setCommitIssues] = useState<CellIssue[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) return;
    setFileName('');
    setCsvText('');
    setMatchBy('auto');
    setMatchHeader(null);
    setMapping(null);
    setCreateMissing(false);
    setSkipUnmatched(false);
    setPreview(null);
    setError(null);
    setCommitIssues([]);
  }, [open]);

  const request = useMemo<ConfoImportRequest | null>(
    () =>
      csvText
        ? {
            csv_text: csvText,
            match_by: matchBy,
            match_header: matchHeader,
            mapping,
            create_missing: createMissing,
            skip_unmatched: skipUnmatched,
          }
        : null,
    [csvText, matchBy, matchHeader, mapping, createMissing, skipUnmatched],
  );

  // Re-run the server preview whenever the file or any choice changes.
  useEffect(() => {
    if (!request || !open) return;
    let cancelled = false;
    const t = window.setTimeout(async () => {
      setBusy(true);
      try {
        const res = await apiClient.previewConfoImport(request, projectUuid);
        if (cancelled) return;
        setPreview(res);
        setError(null);
        setCommitIssues([]);
        if (matchHeader === null) setMatchHeader(res.match_header ?? null);
        if (mapping === null) setMapping(res.mapping);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Preview failed');
      } finally {
        if (!cancelled) setBusy(false);
      }
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, [request, open, projectUuid, matchHeader, mapping]);

  const issues: CellIssue[] =
    commitIssues.length > 0 ? commitIssues : ((preview?.errors as CellIssue[] | undefined) ?? []);
  const summary = preview?.summary ?? {};
  const colOptions = [
    { value: '', label: '— skip —' },
    ...columns.map((c) => ({ value: c.key, label: `${c.label} (${c.key})` })),
    ...(canManage ? [{ value: NEW, label: '+ New column…' }] : []),
  ];

  const setMap = (header: string, patch: Partial<ConfoImportMappingIn>) =>
    setMapping((prev) => (prev ?? []).map((m) => (m.header === header ? { ...m, ...patch } : m)));

  const commit = async () => {
    if (!request) return;
    setBusy(true);
    setError(null);
    try {
      const res = await apiClient.commitConfoImport(request, projectUuid);
      onImported(
        `Imported ${res.updated_cells} cell(s)` +
          ((res.created_columns ?? []).length
            ? `, new columns: ${(res.created_columns ?? []).join(', ')}`
            : '') +
          (res.created_entities ? `, ${res.created_entities} new entit(ies)` : ''),
      );
      onOpenChange(false);
    } catch (err) {
      if (err instanceof ApiHttpError && isCellIssueList(err.details)) {
        setCommitIssues(err.details);
      }
      setError(err instanceof Error ? err.message : 'Import failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Import Confo data from CSV" wide>
      <div className="org-confo-import" data-ui="confo-import">
        <div className="org-confo-inline">
          <input
            ref={fileRef}
            type="file"
            accept=".csv,text/csv,text/plain"
            className="org-confo-hidden"
            aria-label="CSV file"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              setFileName(f.name);
              setMapping(null);
              setMatchHeader(null);
              setPreview(null);
              setCsvText(await f.text());
              e.target.value = '';
            }}
          />
          <Button size="sm" onClick={() => fileRef.current?.click()}>
            Choose CSV…
          </Button>
          <Text size="sm" variant="muted">
            {fileName || 'Comma, semicolon or tab separated; first row is the header.'}
          </Text>
        </div>

        {error && <Banner severity="danger">{error}</Banner>}

        {preview && (
          <>
            <div className="org-confo-inline">
              <Text size="sm">Match rows by</Text>
              <Select
                ariaLabel="Match rows by"
                value={matchBy === 'auto' ? preview.match_by : matchBy}
                onChange={setMatchBy}
                options={[
                  { value: 'name', label: 'Entity name' },
                  { value: 'path', label: 'Folder path' },
                  { value: 'id', label: 'Entity id / uuid' },
                ]}
              />
              <Text size="sm">using column</Text>
              <Select
                ariaLabel="Identity column"
                value={matchHeader ?? preview.match_header ?? ''}
                onChange={(h) => {
                  setMatchHeader(h);
                  setMapping((prev) => {
                    const rest = (prev ?? []).filter((m) => m.header !== h);
                    const back = preview.headers.filter(
                      (x) => x !== h && !rest.some((m) => m.header === x),
                    );
                    return [
                      ...rest,
                      ...back.map((header) => ({ header, target_key: null, new_options: [] })),
                    ];
                  });
                }}
                options={preview.headers.map((h) => ({ value: h, label: h }))}
              />
            </div>

            <table className="org-confo-map" aria-label="Column mapping">
              <thead>
                <tr>
                  <th>CSV column</th>
                  <th>Confo column</th>
                  <th>New column type</th>
                </tr>
              </thead>
              <tbody>
                {(mapping ?? preview.mapping).map((m) => {
                  const isNew = Boolean(m.new_type) && !columns.some((c) => c.key === m.target_key);
                  return (
                    <tr key={m.header}>
                      <td>{m.header}</td>
                      <td>
                        <Select
                          ariaLabel={`Map ${m.header}`}
                          value={isNew ? NEW : (m.target_key ?? '')}
                          onChange={(v) =>
                            v === NEW
                              ? setMap(m.header, {
                                  target_key: keyFromLabel(m.header),
                                  new_label: m.header,
                                  new_type: 'text',
                                })
                              : setMap(m.header, {
                                  target_key: v || null,
                                  new_type: null,
                                  new_label: null,
                                })
                          }
                          options={colOptions}
                        />
                      </td>
                      <td>
                        {isNew && (
                          <div className="org-confo-inline">
                            <TextField
                              aria-label={`New key for ${m.header}`}
                              value={m.target_key ?? ''}
                              onChange={(e) => setMap(m.header, { target_key: e.target.value })}
                            />
                            <Select
                              ariaLabel={`New type for ${m.header}`}
                              value={m.new_type ?? 'text'}
                              onChange={(t) => setMap(m.header, { new_type: t })}
                              options={CONFO_TYPES.map((t) => ({ value: t.value, label: t.label }))}
                            />
                            {(m.new_type === 'select' || m.new_type === 'multiselect') && (
                              <TextField
                                aria-label={`Options for ${m.header}`}
                                placeholder="a, b, c"
                                value={(m.new_options ?? []).join(', ')}
                                onChange={(e) =>
                                  setMap(m.header, {
                                    new_options: e.target.value.split(',').map((o) => o.trim()),
                                  })
                                }
                              />
                            )}
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            <div className="org-confo-inline">
              {canCreateEntities && (
                <Checkbox
                  label="Create entities for unmatched rows"
                  checked={createMissing}
                  onChange={setCreateMissing}
                />
              )}
              <Checkbox
                label="Skip unmatched rows"
                checked={skipUnmatched}
                onChange={setSkipUnmatched}
              />
              <Text size="sm" variant="muted">
                Empty cells leave existing values unchanged.
              </Text>
            </div>

            <div className="org-confo-inline" aria-live="polite" data-ui="confo-import-summary">
              {(['matched', 'create', 'unmatched', 'ambiguous', 'duplicate'] as const).map((s) =>
                summary[s] ? (
                  <Badge key={s} tone={STATUS_TONE[s]}>
                    {STATUS_LABEL[s]}: {summary[s]}
                  </Badge>
                ) : null,
              )}
              <Badge tone="neutral">Cells: {summary.cells ?? 0}</Badge>
              <Badge tone={issues.length ? 'danger' : 'success'}>Errors: {issues.length}</Badge>
              {issues.length > 0 && (
                <Button
                  size="sm"
                  onClick={() =>
                    downloadText(`confo_import_errors_${dateStamp()}.csv`, errorReportCsv(issues))
                  }
                >
                  Download error report
                </Button>
              )}
            </div>

            <div className="org-confo-preview">
              <table aria-label="Import preview">
                <thead>
                  <tr>
                    <th>Line</th>
                    <th>Identity</th>
                    <th>Status</th>
                    <th>Entity</th>
                    <th>Values / problems</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.rows.slice(0, MAX_PREVIEW_ROWS).map((r) => (
                    <tr key={r.line} data-status={r.status}>
                      <td>{r.line}</td>
                      <td>{r.identity}</td>
                      <td>
                        <Badge tone={STATUS_TONE[r.status] ?? 'neutral'}>
                          {STATUS_LABEL[r.status] ?? r.status}
                        </Badge>
                      </td>
                      <td>{r.entity_name ?? r.message ?? ''}</td>
                      <td>
                        {Object.entries(r.cells ?? {}).map(([k, v]) => {
                          const bad =
                            v && typeof v === 'object' && !Array.isArray(v) && 'error' in v;
                          return (
                            <span
                              key={k}
                              className="org-confo-chip"
                              data-error={bad ? 'true' : undefined}
                            >
                              {k}:{' '}
                              {bad
                                ? `⚠ ${(v as { error: string }).error}`
                                : Array.isArray(v)
                                  ? v.join(', ')
                                  : String(v)}
                            </span>
                          );
                        })}
                        {r.status !== 'matched' && r.message && r.entity_name && (
                          <Text size="sm" variant="muted">
                            {r.message}
                          </Text>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {preview.rows.length > MAX_PREVIEW_ROWS && (
                <Text size="sm" variant="muted">
                  Showing the first {MAX_PREVIEW_ROWS} of {preview.rows.length} rows.
                </Text>
              )}
            </div>
          </>
        )}

        <div className="org-confo-actions">
          <Button onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            variant="primary"
            disabled={!preview || busy || issues.length > 0 || (!summary.cells && !summary.create)}
            onClick={() => void commit()}
            title={
              issues.length > 0 ? 'Fix the errors first: imports are all-or-nothing' : undefined
            }
          >
            {busy ? 'Working…' : 'Import'}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
