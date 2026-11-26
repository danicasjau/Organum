import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  Badge,
  Banner,
  Button,
  ButtonGroup,
  ConfirmDialog,
  DataGrid,
  Dialog,
  Icon,
  Select,
  SortableList,
  Spinner,
  Text,
  TextField,
  dataGridCellKey,
  useToast,
  type DataGridCellChange,
  type DataGridColumn,
  type DataGridEditorProps,
  type DataGridViewState,
  type DataGridVisibleData,
} from '../../components/ui';
import {
  ApiHttpError,
  apiClient,
  type ConfoColumnOut,
  type ConfoGridOut,
} from '../../lib/api/client';
import { useCssVarRef } from '../../components/ui/_internal/useCssVar';
import { useProjectStore } from '../project/projectStore';
import { ConfoColumnDialog, type ConfoColumnDraft } from './ConfoColumnDialog';
import { ConfoImportDialog } from './ConfoImportDialog';
import {
  EMPTY_HISTORY,
  afterRedo,
  afterUndo,
  confoGroupFor,
  dateStamp,
  downloadText,
  formatConfoValue,
  isCellIssueList,
  pushHistory,
  redoPayload,
  toCsv,
  undoPayload,
  type AppliedChange,
  type ConfoGroupBy,
  type HistoryState,
  type RefLookup,
} from './confoModel';
import './ConfoView.css';

const VIEW_KEY = 'organum.confo.view.v1';
const GROUP_KEY = 'organum.confo.groupBy';

type Row = Record<string, unknown>;

function readLocal<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeLocal(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // storage unavailable: preference simply not remembered
  }
}

function SelectEditor({
  props,
  options,
}: {
  props: DataGridEditorProps;
  options: ReadonlyArray<{ value: string; label: string }>;
}) {
  return (
    <select
      className="org-datagrid__cell-edit"
      autoFocus
      aria-label="Choose value"
      defaultValue={props.initialText}
      onChange={(e) => props.onCommit(e.target.value)}
      onBlur={() => props.onCancel()}
      onKeyDown={(e) => {
        if (e.key === 'Escape') props.onCancel();
      }}
    >
      <option value="">—</option>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

function InputEditor({
  props,
  type,
  list,
}: {
  props: DataGridEditorProps;
  type: 'date' | 'color' | 'text';
  list?: string;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const initial = type === 'color' && !props.initialText ? '#808080' : props.initialText;
  return (
    <input
      ref={ref}
      className="org-datagrid__cell-edit"
      autoFocus
      type={type}
      list={list}
      aria-label="Edit value"
      defaultValue={initial}
      onKeyDown={(e) => {
        if (e.key === 'Enter') props.onCommit(ref.current?.value ?? '');
        if (e.key === 'Escape') props.onCancel();
      }}
      onBlur={() => props.onCommit(ref.current?.value ?? '')}
    />
  );
}

export function ConfoView() {
  const projectUuid = useProjectStore((s) => s.activeProjectUuid);
  const queryClient = useQueryClient();
  const toast = useToast();
  const queryKey = useMemo(() => ['confo', projectUuid], [projectUuid]);

  const { data, isLoading, error } = useQuery({
    queryKey,
    queryFn: () => apiClient.getConfo(projectUuid),
    enabled: Boolean(projectUuid),
  });
  const usersQuery = useQuery({
    queryKey: ['users', projectUuid],
    queryFn: () => apiClient.listUsers(projectUuid),
    enabled: Boolean(projectUuid),
    retry: false,
  });
  const savedViewsQuery = useQuery({
    queryKey: ['saved-views', 'confo', projectUuid],
    queryFn: () => apiClient.listSavedViews('confo', projectUuid),
    enabled: Boolean(projectUuid),
  });

  const [groupBy, setGroupBy] = useState<ConfoGroupBy>(() => readLocal(GROUP_KEY, 'path'));
  const [history, setHistory] = useState<HistoryState>(EMPTY_HISTORY);
  const [cellErrors, setCellErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [viewVersion, setViewVersion] = useState(0);
  const [initialView, setInitialView] = useState<Partial<DataGridViewState>>(() =>
    readLocal(VIEW_KEY, {}),
  );
  const currentView = useRef<DataGridViewState | null>(null);
  const visibleData = useRef<DataGridVisibleData | null>(null);
  const [columnDialog, setColumnDialog] = useState<{
    open: boolean;
    column: ConfoColumnOut | null;
  }>({ open: false, column: null });
  const [manageOpen, setManageOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<ConfoColumnOut | null>(null);
  const [saveViewName, setSaveViewName] = useState('');
  const [saveViewOpen, setSaveViewOpen] = useState(false);

  const columnsOut = useMemo(() => data?.columns ?? [], [data?.columns]);
  const lookup = useMemo<RefLookup>(
    () => ({
      users: new Map((usersQuery.data ?? []).map((u) => [u.id, u.full_name])),
      entities: new Map((data?.rows ?? []).map((r) => [r.entity_id, r.name])),
    }),
    [usersQuery.data, data?.rows],
  );

  const rows = useMemo<Row[]>(
    () =>
      (data?.rows ?? []).map((r) => ({
        ...r.values,
        __id: r.entity_id,
        __name: r.name,
        __path: r.rel_path,
        __type: r.entity_type ?? '',
        rel_path: r.rel_path,
        entity_type: r.entity_type,
      })),
    [data?.rows],
  );

  const renderTyped = useCallback(
    (col: ConfoColumnOut, value: unknown): ReactNode => {
      if (value === null || value === undefined || value === '') return '';
      const text = formatConfoValue(col.col_type, value, lookup);
      switch (col.col_type) {
        case 'boolean':
          return (
            <span className="org-confo-bool" data-on={value ? 'true' : 'false'}>
              {value ? '✓ Yes' : '✗ No'}
            </span>
          );
        case 'color':
          return <ConfoSwatch hex={String(value)} />;
        case 'url':
          return (
            <a
              href={String(value)}
              target="_blank"
              rel="noreferrer noopener"
              className="org-confo-link"
            >
              {text}
            </a>
          );
        case 'multiselect':
          return (
            <span className="org-confo-tags">
              {(Array.isArray(value) ? value : [value]).map((v) => (
                <span key={String(v)} className="org-confo-chip">
                  {String(v)}
                </span>
              ))}
            </span>
          );
        default:
          return text;
      }
    },
    [lookup],
  );

  const gridColumns = useMemo<DataGridColumn[]>(() => {
    const fixed: DataGridColumn[] = [
      { key: '__name', header: 'Entity', width: 160, editable: false },
      { key: '__path', header: 'Path', width: 200, editable: false },
      { key: '__type', header: 'Type', width: 90, editable: false },
    ];
    const userOptions = (usersQuery.data ?? []).map((u) => ({
      value: u.username,
      label: u.full_name,
    }));
    const custom = columnsOut.map<DataGridColumn>((c) => ({
      key: c.key,
      header: c.label,
      headerTitle: `${c.key} · ${c.col_type}${c.can_edit ? '' : ' · read-only for you'}`,
      width: c.col_type === 'boolean' ? 90 : 140,
      numeric: c.col_type === 'integer' || c.col_type === 'float',
      editable: c.can_edit,
      toText: (v) => formatConfoValue(c.col_type, v, lookup),
      renderCell: (v) => renderTyped(c, v),
      renderEditor:
        c.col_type === 'select'
          ? (p) => (
              <SelectEditor
                props={p}
                options={(c.options ?? []).map((o) => ({ value: o, label: o }))}
              />
            )
          : c.col_type === 'boolean'
            ? (p) => (
                <SelectEditor
                  props={{
                    ...p,
                    initialText: p.value === true ? 'yes' : p.value === false ? 'no' : '',
                  }}
                  options={[
                    { value: 'yes', label: 'Yes' },
                    { value: 'no', label: 'No' },
                  ]}
                />
              )
            : c.col_type === 'user'
              ? (p) => (
                  <SelectEditor
                    props={{
                      ...p,
                      initialText:
                        (usersQuery.data ?? []).find((u) => u.id === p.value)?.username ?? '',
                    }}
                    options={userOptions}
                  />
                )
              : c.col_type === 'date'
                ? (p) => <InputEditor props={p} type="date" />
                : c.col_type === 'color'
                  ? (p) => <InputEditor props={p} type="color" />
                  : c.col_type === 'entity'
                    ? (p) => <InputEditor props={p} type="text" list="org-confo-entities" />
                    : undefined,
    }));
    return [...fixed, ...custom];
  }, [columnsOut, lookup, renderTyped, usersQuery.data]);

  const hiddenByDefault = useMemo(() => {
    const vis: Record<string, boolean> = {};
    for (const c of columnsOut) if (!c.is_visible) vis[c.key] = false;
    return vis;
  }, [columnsOut]);

  const mergedInitialView = useMemo<Partial<DataGridViewState>>(
    () => ({
      frozenCount: 1,
      ...initialView,
      columnVisibility: { ...hiddenByDefault, ...(initialView.columnVisibility ?? {}) },
    }),
    [initialView, hiddenByDefault],
  );

  /** Send a batch; on success update the cache, record history, clear those errors. */
  const sendChanges = useCallback(
    async (
      changes: { entity_id: string; column_key: string; value: unknown }[],
      mode: 'edit' | 'undo' | 'redo',
    ): Promise<boolean> => {
      if (changes.length === 0 || !projectUuid) return false;
      setBusy(true);
      try {
        const res = await apiClient.patchConfoCells(changes, projectUuid);
        const applied = res.applied as unknown as AppliedChange[];
        queryClient.setQueryData<ConfoGridOut>(queryKey, (prev) => {
          if (!prev) return prev;
          const byEntity = new Map<string, AppliedChange[]>();
          for (const a of applied) {
            byEntity.set(a.entity_id, [...(byEntity.get(a.entity_id) ?? []), a]);
          }
          return {
            ...prev,
            rows: (prev.rows ?? []).map((r) => {
              const list = byEntity.get(r.entity_id);
              if (!list) return r;
              const values = { ...r.values };
              for (const a of list) {
                if (a.after === null || a.after === undefined) delete values[a.column_key];
                else values[a.column_key] = a.after;
              }
              return { ...r, values };
            }),
          };
        });
        setCellErrors((prev) => {
          const next = { ...prev };
          for (const c of changes) delete next[dataGridCellKey(c.entity_id, c.column_key)];
          return next;
        });
        if (mode === 'edit') setHistory((h) => pushHistory(h, applied));
        void queryClient.invalidateQueries({ queryKey });
        return true;
      } catch (err) {
        if (err instanceof ApiHttpError && isCellIssueList(err.details)) {
          const next: Record<string, string> = {};
          for (const i of err.details) next[dataGridCellKey(i.entity_id, i.column_key)] = i.message;
          setCellErrors((prev) => ({ ...prev, ...next }));
          toast.push('danger', `${err.details.length} cell(s) rejected; nothing was saved`);
        } else {
          toast.push('danger', err instanceof Error ? err.message : 'Save failed');
        }
        return false;
      } finally {
        setBusy(false);
      }
    },
    [projectUuid, queryClient, queryKey, toast],
  );

  const onCellsChange = (changes: DataGridCellChange[]) => {
    const custom = new Set(columnsOut.filter((c) => c.can_edit).map((c) => c.key));
    void sendChanges(
      changes
        .filter((c) => custom.has(c.colKey))
        .map((c) => ({ entity_id: c.rowId, column_key: c.colKey, value: c.value })),
      'edit',
    );
  };

  const undo = async () => {
    const batch = history.undo[history.undo.length - 1];
    if (batch && (await sendChanges(undoPayload(batch), 'undo'))) setHistory(afterUndo);
  };
  const redo = async () => {
    const batch = history.redo[history.redo.length - 1];
    if (batch && (await sendChanges(redoPayload(batch), 'redo'))) setHistory(afterRedo);
  };

  const exportCsv = () => {
    const vis = visibleData.current;
    if (!vis) return;
    const header = vis.columns.map((c) => c.header);
    const body = vis.rows.map((r) =>
      vis.columns.map((c) =>
        c.toText ? c.toText(r[c.key], r) : formatConfoValue('text', r[c.key]),
      ),
    );
    downloadText(`confo_${dateStamp()}.csv`, toCsv(header, body));
    toast.push('success', `Exported ${body.length} row(s) as CSV`);
  };

  const refresh = () => queryClient.invalidateQueries({ queryKey });

  const saveColumn = async (draft: ConfoColumnDraft) => {
    if (columnDialog.column) {
      await apiClient.updateConfoColumn(columnDialog.column.id, draft, projectUuid);
      toast.push('success', `Saved column "${draft.label}"`);
    } else {
      await apiClient.createConfoColumn(draft, projectUuid);
      toast.push('success', `Created column "${draft.label}"`);
    }
    await refresh();
  };

  const applySavedView = (id: string) => {
    const sv = (savedViewsQuery.data ?? []).find((v) => v.id === id);
    if (!sv) return;
    const cfg = sv.config_json as { grid?: Partial<DataGridViewState>; groupBy?: ConfoGroupBy };
    setInitialView(cfg.grid ?? {});
    if (cfg.groupBy) setGroupBy(cfg.groupBy);
    setViewVersion((v) => v + 1);
  };

  if (isLoading) return <Spinner label="Loading Confo" />;
  if (error || !data) {
    return (
      <Banner severity="danger">
        {error instanceof Error ? error.message : 'Confo is not available.'}
      </Banner>
    );
  }

  const groupFn = groupBy === 'none' ? undefined : (r: Row) => confoGroupFor(groupBy, r);

  return (
    <div className="org-confo" data-ui="confo-view">
      <div className="org-confo__bar">
        <ButtonGroup>
          {(['path', 'type', 'none'] as const).map((g) => (
            <Button
              key={g}
              size="sm"
              variant="toggle"
              pressed={groupBy === g}
              onClick={() => {
                setGroupBy(g);
                writeLocal(GROUP_KEY, g);
              }}
            >
              {g === 'path' ? 'Path Hierarchy' : g === 'type' ? 'Entity Type' : 'No Grouping'}
            </Button>
          ))}
        </ButtonGroup>
        <Button
          size="sm"
          disabled={history.undo.length === 0 || busy}
          onClick={() => void undo()}
          title="Undo (Ctrl+Z)"
        >
          Undo
        </Button>
        <Button
          size="sm"
          disabled={history.redo.length === 0 || busy}
          onClick={() => void redo()}
          title="Redo (Ctrl+Y)"
        >
          Redo
        </Button>
        {data.can_manage && (
          <>
            <Button size="sm" onClick={() => setColumnDialog({ open: true, column: null })}>
              <Icon name="plus" size="sm" /> New column
            </Button>
            <Button size="sm" onClick={() => setManageOpen(true)}>
              Manage columns
            </Button>
          </>
        )}
        {data.can_edit && (
          <Button size="sm" onClick={() => setImportOpen(true)}>
            Import CSV
          </Button>
        )}
        <Button size="sm" onClick={exportCsv}>
          Export CSV
        </Button>
        <span className="org-confo__spacer" />
        <div className="org-confo__views">
          <Select
            ariaLabel="Saved Confo views"
            value=""
            placeholder="Saved views…"
            onChange={applySavedView}
            options={(savedViewsQuery.data ?? []).map((v) => ({ value: v.id, label: v.name }))}
          />
        </div>
        <Button size="sm" onClick={() => setSaveViewOpen(true)}>
          Save view
        </Button>
        {!data.can_edit && <Badge tone="neutral">Read-only</Badge>}
        {Object.keys(cellErrors).length > 0 && (
          <Badge tone="danger">⚠ {Object.keys(cellErrors).length} invalid</Badge>
        )}
      </div>

      {columnsOut.length === 0 && (
        <Banner severity="info">
          No custom columns yet.{' '}
          {data.can_manage
            ? 'Use “New column” or import a CSV to start (e.g. camera_movement, 2d_vfx).'
            : 'Ask a producer to create some.'}
        </Banner>
      )}

      <datalist id="org-confo-entities">
        {(data.rows ?? []).map((r) => (
          <option key={r.entity_id} value={r.rel_path} />
        ))}
      </datalist>

      <div className="org-confo__grid">
        <DataGrid
          ariaLabel="Confo entity data"
          columns={gridColumns}
          rows={rows}
          getRowId={(r) => String(r.__id)}
          editable={data.can_edit}
          onCellsChange={onCellsChange}
          cellErrors={cellErrors}
          groupBy={groupFn}
          initialViewState={mergedInitialView}
          viewStateVersion={viewVersion}
          onViewStateChange={(s) => {
            currentView.current = s;
            writeLocal(VIEW_KEY, s);
          }}
          onUndo={() => void undo()}
          onRedo={() => void redo()}
          enableLayoutTools
          visibleDataRef={visibleData}
        />
      </div>

      <ConfoColumnDialog
        open={columnDialog.open}
        onOpenChange={(open) => setColumnDialog((d) => ({ ...d, open }))}
        column={columnDialog.column}
        projectUuid={projectUuid}
        onSubmit={saveColumn}
      />

      <ConfoManageDialog
        open={manageOpen}
        onOpenChange={setManageOpen}
        columns={columnsOut}
        projectUuid={projectUuid}
        onEdit={(c) => setColumnDialog({ open: true, column: c })}
        onDelete={setConfirmDelete}
        onChanged={() => void refresh()}
      />

      <ConfirmDialog
        open={Boolean(confirmDelete)}
        onOpenChange={(o) => !o && setConfirmDelete(null)}
        title={`Delete column "${confirmDelete?.label ?? ''}"?`}
        onConfirm={async () => {
          if (!confirmDelete) return;
          await apiClient.deleteConfoColumn(confirmDelete.id, projectUuid);
          toast.push('success', `Deleted "${confirmDelete.label}". Restore it within 30 days.`);
          await refresh();
        }}
      >
        <Text>
          The column disappears from Confo, but its values are kept for 30 days. You can restore it
          from Manage columns → Deleted.
        </Text>
      </ConfirmDialog>

      <ConfoImportDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        projectUuid={projectUuid}
        columns={columnsOut}
        canManage={data.can_manage}
        canCreateEntities={data.can_create_entities}
        onImported={(msg) => {
          toast.push('success', msg);
          void refresh();
          void queryClient.invalidateQueries({ queryKey: ['entities', projectUuid] });
        }}
      />

      <Dialog
        open={saveViewOpen}
        onOpenChange={setSaveViewOpen}
        title="Save Confo view"
        footer={
          <>
            <Button onClick={() => setSaveViewOpen(false)}>Cancel</Button>
            <Button
              variant="primary"
              disabled={!saveViewName.trim()}
              onClick={async () => {
                await apiClient.createSavedView(
                  {
                    view_kind: 'confo',
                    name: saveViewName.trim(),
                    config_json: { grid: currentView.current ?? {}, groupBy },
                  },
                  projectUuid,
                );
                setSaveViewOpen(false);
                setSaveViewName('');
                await queryClient.invalidateQueries({
                  queryKey: ['saved-views', 'confo', projectUuid],
                });
                toast.push('success', 'View saved');
              }}
            >
              Save
            </Button>
          </>
        }
      >
        <TextField
          aria-label="View name"
          placeholder="e.g. Layout check"
          value={saveViewName}
          onChange={(e) => setSaveViewName(e.target.value)}
        />
        <Text size="sm" variant="muted">
          Saves sort, filters, search, hidden and frozen columns, hidden rows, widths and grouping.
        </Text>
      </Dialog>
    </div>
  );
}

function ConfoSwatch({ hex }: { hex: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  useCssVarRef(ref, '--confo-swatch', hex);
  return (
    <span className="org-confo-color">
      <span ref={ref} className="org-confo-color__chip" aria-hidden="true" />
      {hex}
    </span>
  );
}

function ConfoManageDialog({
  open,
  onOpenChange,
  columns,
  projectUuid,
  onEdit,
  onDelete,
  onChanged,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  columns: ReadonlyArray<ConfoColumnOut>;
  projectUuid: string | null;
  onEdit: (c: ConfoColumnOut) => void;
  onDelete: (c: ConfoColumnOut) => void;
  onChanged: () => void;
}) {
  const toast = useToast();
  const trashQuery = useQuery({
    queryKey: ['confo-trash', projectUuid, columns.length],
    queryFn: () => apiClient.listConfoTrash(projectUuid),
    enabled: open && Boolean(projectUuid),
  });
  const [order, setOrder] = useState<ConfoColumnOut[] | null>(null);
  const list = order ?? [...columns];

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOrder(null);
        onOpenChange(o);
      }}
      title="Manage Confo columns"
      wide
    >
      <div className="org-confo-manage" data-ui="confo-manage">
        <Text size="sm" variant="muted">
          Drag to reorder. Keys are used by CSV import; renaming a key keeps the data.
        </Text>
        <SortableList
          ariaLabel="Confo columns"
          items={list}
          getId={(c) => c.id}
          getLabel={(c) => c.label}
          onReorder={async (ids) => {
            setOrder(ids.map((id) => list.find((c) => c.id === id)!));
            await apiClient.reorderConfoColumns(ids, projectUuid);
            onChanged();
          }}
          renderItem={(c) => (
            <div className="org-confo-manage__row">
              <span className="org-confo-manage__label">{c.label}</span>
              <code>{c.key}</code>
              <Badge tone="neutral">{c.col_type}</Badge>
              {!c.is_visible && <Badge tone="neutral">hidden</Badge>}
              {(c.edit_roles ?? []).length > 0 && (
                <Badge tone="info">edit: {(c.edit_roles ?? []).join(', ')}</Badge>
              )}
              <Button size="sm" onClick={() => onEdit(c)}>
                Edit
              </Button>
              <Button
                size="sm"
                variant="icon"
                aria-label={`Delete column ${c.label}`}
                onClick={() => onDelete(c)}
              >
                <Icon name="trash" size="sm" />
              </Button>
            </div>
          )}
        />
        <Text size="sm" variant="accent">
          Deleted (kept 30 days)
        </Text>
        {(trashQuery.data ?? []).length === 0 ? (
          <Text size="sm" variant="muted">
            Nothing deleted.
          </Text>
        ) : (
          <ul className="org-confo-trash" aria-label="Deleted columns">
            {(trashQuery.data ?? []).map((c) => (
              <li key={c.id}>
                <span>
                  {c.label} <code>{c.key}</code>
                </span>
                <Button
                  size="sm"
                  onClick={async () => {
                    await apiClient.restoreConfoColumn(c.id, projectUuid);
                    toast.push('success', `Restored "${c.label}"`);
                    await trashQuery.refetch();
                    onChanged();
                  }}
                >
                  Restore
                </Button>
                <Button
                  size="sm"
                  variant="danger"
                  onClick={async () => {
                    await apiClient.purgeConfoColumn(c.id, projectUuid);
                    toast.push('success', `Permanently removed "${c.label}"`);
                    await trashQuery.refetch();
                  }}
                >
                  Delete forever
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Dialog>
  );
}
