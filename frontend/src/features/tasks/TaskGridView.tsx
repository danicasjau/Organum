import { useQueryClient } from '@tanstack/react-query';
import { flexRender, type SortingState } from '@tanstack/react-table';
import {
  getCoreRowModel,
  getSortedRowModel,
  useLegacyTable,
  type LegacyColumnDef,
} from '@tanstack/react-table/legacy';
import { useVirtualizer } from '@tanstack/react-virtual';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent,
} from 'react';
import {
  Avatar,
  Badge,
  Button,
  CapacityBadgeList,
  Checkbox,
  Popover,
  PriorityFlag,
  Select,
  StatusChip,
  Text,
  useToast,
  DatePicker,
} from '../../components/ui';
import { useCssVarRef } from '../../components/ui/_internal/useCssVar';
import { apiClient, type ClientTaskListItemOut, type TaskListItemOut } from '../../lib/api/client';
import { useAuthStore } from '../auth/authStore';
import { useProjectStore } from '../project/projectStore';
import { canPerformOnTask, isFullTaskItem, isOverdueDate, PRIORITY_OPTIONS } from './taskHelpers';
import { useTasksStore } from './tasksStore';
import './TaskGridView.css';
import { DepartmentTag } from '../departments/DepartmentTag';
import { TaskUnreadDot } from '../reviews/TaskUnreadDot';

type AnyTaskRow = TaskListItemOut | ClientTaskListItemOut;

function ResizableColHeader({
  colId,
  width,
  sorted,
  onToggleSort,
  onResize,
  children,
}: {
  colId: string;
  width: number;
  sorted: false | 'asc' | 'desc';
  onToggleSort: (e: MouseEvent) => void;
  onResize: (colId: string, nextWidth: number) => void;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useCssVarRef(ref, '--tg-col-w', `${width}px`);

  const startResize = (e: MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    const startX = e.clientX;
    const startW = width;
    const onMove = (ev: globalThis.MouseEvent) => {
      onResize(colId, Math.max(70, Math.min(420, Math.round(startW + ev.clientX - startX))));
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  return (
    <div
      ref={ref}
      role="columnheader"
      className="org-tgrid__th"
      onClick={onToggleSort}
      title="Click to sort (Shift+Click for multi-sort)"
    >
      <span className="org-tgrid__th-label">
        {children}
        {sorted === 'asc' ? ' ▲' : sorted === 'desc' ? ' ▼' : ''}
      </span>
      <span
        role="separator"
        aria-orientation="vertical"
        className="org-tgrid__resizer"
        onMouseDown={startResize}
      />
    </div>
  );
}

// Must match --tgrid-row-h in tokens.css (rows are absolutely positioned by the virtualizer).
const GRID_ROW_PX = 30;

interface CellCoord {
  r: number;
  c: number;
}

/** Plain-text value of a cell for clipboard export (TSV). */
function cellText(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (Array.isArray(v)) return v.map(cellText).filter(Boolean).join(', ');
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    return String(o.full_name || o.username || o.name || o.label || '');
  }
  return String(v).replace(/[\t\r\n]+/g, ' ');
}

function GridCellSlot({
  width,
  inRange,
  isFocus,
  edges,
  onMouseDown,
  onMouseEnter,
  children,
}: {
  width: number;
  inRange: boolean;
  isFocus: boolean;
  /** Which sides of the selection rectangle this cell sits on: t r b l */
  edges: string;
  onMouseDown: (e: MouseEvent) => void;
  onMouseEnter: () => void;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useCssVarRef(ref, '--tg-col-w', `${width}px`);
  return (
    <div
      ref={ref}
      role="cell"
      className="org-tgrid__td"
      data-in-range={inRange ? 'true' : undefined}
      data-focus={isFocus ? 'true' : undefined}
      data-edges={edges || undefined}
      onMouseDown={onMouseDown}
      onMouseEnter={onMouseEnter}
    >
      {children}
    </div>
  );
}

function VirtualTableBody({ height, children }: { height: number; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useCssVarRef(ref, '--tg-total-h', `${height}px`);
  return (
    <div ref={ref} className="org-tgrid__vbody">
      {children}
    </div>
  );
}

function VirtualTableRow({
  start,
  selected,
  status,
  onClick,
  children,
}: {
  start: number;
  selected: boolean;
  status?: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useCssVarRef(ref, '--tg-offset', `${start}px`);
  return (
    <div
      ref={ref}
      role="row"
      data-selected={selected ? 'true' : undefined}
      data-status={status}
      className="org-tgrid__row"
      onClick={onClick}
    >
      {children}
    </div>
  );
}

export function TaskGridView({
  tasks,
  total,
  hasMore,
  loadingMore,
  onLoadMore,
  selectedTaskId,
  onSelectTask,
  isClient,
}: {
  tasks: ReadonlyArray<AnyTaskRow>;
  total: number;
  hasMore: boolean;
  loadingMore: boolean;
  onLoadMore: () => void;
  selectedTaskId: string | null;
  onSelectTask: (taskId: string) => void;
  isClient: boolean;
}) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const auth = useAuthStore((s) => s.auth);
  const activeProjectUuid = useProjectStore((s) => s.activeProjectUuid);
  const hiddenCols = useTasksStore((s) => s.hiddenGridCols);
  const setHiddenCols = useTasksStore((s) => s.setHiddenGridCols);

  const [sorting, setSorting] = useState<SortingState>([]);
  const [colWidths, setColWidths] = useState<Record<string, number>>({});
  const [chooserOpen, setChooserOpen] = useState(false);

  const inlinePatch = async (task: TaskListItemOut, patch: Record<string, unknown>) => {
    try {
      await apiClient.patchTask(
        task.id,
        { ...patch, expected_updated_at: task.updated_at },
        activeProjectUuid,
      );
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['tasks', activeProjectUuid] }),
        queryClient.invalidateQueries({ queryKey: ['task', activeProjectUuid, task.id] }),
      ]);
      toast.push('success', `Updated ${task.task_code}`);
    } catch (err) {
      toast.push('danger', err instanceof Error ? err.message : 'Inline edit failed');
    }
  };

  const allColumns = useMemo<Array<LegacyColumnDef<AnyTaskRow>>>(() => {
    if (isClient) {
      return [
        {
          id: 'task_code',
          header: 'Code',
          accessorKey: 'task_code',
          size: 130,
          cell: (ctx) => <span className="org-tgrid__mono">{String(ctx.getValue())}</span>,
        },
        {
          id: 'task_name',
          header: 'Task',
          accessorKey: 'task_name',
          size: 170,
        },
        {
          id: 'entity_name',
          header: 'Entity',
          accessorKey: 'entity_name',
          size: 130,
        },
        {
          id: 'department_name',
          header: 'Department',
          accessorKey: 'department_name',
          size: 120,
          cell: (ctx) => <DepartmentTag name={String(ctx.getValue() ?? '')} />,
        },
        {
          id: 'status',
          header: 'Status',
          accessorKey: 'status',
          size: 100,
          cell: (ctx) => <StatusChip status={String(ctx.getValue())} compact />,
        },
        {
          id: 'ideal_finish_date',
          header: 'Due Date',
          accessorKey: 'ideal_finish_date',
          size: 105,
          cell: (ctx) => <span className="org-tgrid__mono">{String(ctx.getValue() ?? '—')}</span>,
        },
        {
          id: 'description',
          header: 'Description',
          accessorKey: 'description',
          size: 220,
        },
        {
          id: 'shared_versions',
          header: 'Shared Versions',
          size: 120,
          accessorFn: (r) => (!isFullTaskItem(r) ? (r.product?.versions?.length ?? 0) : 0),
        },
      ];
    }

    return [
      {
        id: 'priority',
        header: 'Priority',
        accessorFn: (r) => (isFullTaskItem(r) ? r.priority : 'normal'),
        size: 86,
        cell: ({ row }) => {
          const t = row.original;
          if (!isFullTaskItem(t)) return null;
          const canEdit = canPerformOnTask(auth, 'task.edit_fields', t.my_capacities ?? []);
          if (!canEdit) return <PriorityFlag priority={t.priority ?? 'normal'} />;
          return (
            <div onClick={(e) => e.stopPropagation()}>
              <Select
                ariaLabel={`Priority for ${t.task_code}`}
                value={t.priority ?? 'normal'}
                onChange={(v) => void inlinePatch(t, { priority: v })}
                options={[...PRIORITY_OPTIONS]}
              />
            </div>
          );
        },
      },
      {
        id: 'task_code',
        header: 'Code',
        accessorKey: 'task_code',
        size: 160,
        cell: ({ row }) => {
          const t = row.original;
          return (
            <span className="org-tgrid__code">
              {isFullTaskItem(t) && (
                <TaskUnreadDot
                  taskId={t.id}
                  feedbackAt={t.last_feedback_at}
                  by={t.last_feedback_by}
                />
              )}
              <span className="org-tgrid__mono">{t.task_code}</span>
            </span>
          );
        },
      },
      { id: 'task_name', header: 'Task Name', accessorKey: 'task_name', size: 170 },
      { id: 'entity_name', header: 'Entity', accessorKey: 'entity_name', size: 130 },
      { id: 'entity_rel_path', header: 'Entity Path', accessorKey: 'entity_rel_path', size: 160 },
      {
        id: 'parent_entity_type',
        header: 'Entity Type',
        accessorKey: 'parent_entity_type',
        size: 100,
      },
      {
        id: 'department_name',
        header: 'Department',
        accessorKey: 'department_name',
        size: 130,
        cell: ({ row }) => {
          const t = row.original;
          return isFullTaskItem(t) ? (
            <DepartmentTag
              id={t.department_id}
              name={t.department_name}
              color={t.department_color}
            />
          ) : (
            <DepartmentTag name={t.department_name} />
          );
        },
      },
      {
        id: 'status',
        header: 'Status',
        accessorKey: 'status',
        size: 105,
        cell: (ctx) => <StatusChip status={String(ctx.getValue())} compact />,
      },
      {
        id: 'artists',
        header: 'Artists (DO)',
        size: 130,
        accessorFn: (r) =>
          isFullTaskItem(r)
            ? (r.assignments ?? [])
                .filter((a) => a.assignment_role === 'artist')
                .map((a) => a.full_name)
                .join(', ')
            : '',
        cell: ({ row }) => {
          const t = row.original;
          if (!isFullTaskItem(t)) return null;
          const list = (t.assignments ?? []).filter((a) => a.assignment_role === 'artist');
          return (
            <div className="org-tgrid__avatars">
              {list.map((a) => (
                <Avatar key={a.user_id} username={a.username} fullName={a.full_name} size="sm" />
              ))}
            </div>
          );
        },
      },
      {
        id: 'leads',
        header: 'Leads',
        size: 110,
        accessorFn: (r) =>
          isFullTaskItem(r)
            ? (r.assignments ?? [])
                .filter((a) => a.assignment_role === 'lead')
                .map((a) => a.full_name)
                .join(', ')
            : '',
      },
      {
        id: 'supervisors',
        header: 'Supervisors',
        size: 110,
        accessorFn: (r) =>
          isFullTaskItem(r)
            ? (r.assignments ?? [])
                .filter((a) => a.assignment_role === 'supervisor')
                .map((a) => a.full_name)
                .join(', ')
            : '',
      },
      {
        id: 'my_capacities',
        header: 'My capacity',
        size: 110,
        accessorFn: (r) => (isFullTaskItem(r) ? (r.my_capacities ?? []).join(',') : ''),
        cell: ({ row }) => {
          const t = row.original;
          return isFullTaskItem(t) ? (
            <CapacityBadgeList capacities={t.my_capacities ?? []} />
          ) : null;
        },
      },
      {
        id: 'tags',
        header: 'Tags',
        size: 120,
        accessorFn: (r) => (isFullTaskItem(r) ? (r.tags ?? []).join(', ') : ''),
        cell: ({ row }) => {
          const t = row.original;
          if (!isFullTaskItem(t)) return null;
          return (
            <div className="org-tgrid__tags">
              {(t.tags ?? []).slice(0, 2).map((tg) => (
                <Badge key={tg} tone="neutral">
                  {tg}
                </Badge>
              ))}
            </div>
          );
        },
      },
      {
        id: 'ideal_start_date',
        header: 'Planned Start',
        accessorKey: 'ideal_start_date',
        size: 100,
        cell: (ctx) => <span className="org-tgrid__mono">{String(ctx.getValue() ?? '—')}</span>,
      },
      {
        id: 'ideal_finish_date',
        header: 'Planned Finish',
        accessorKey: 'ideal_finish_date',
        size: 125,
        cell: ({ row }) => {
          const t = row.original;
          if (!isFullTaskItem(t)) return null;
          const canSched = canPerformOnTask(auth, 'task.edit_schedule', t.my_capacities ?? []);
          const over = isOverdueDate(t.ideal_finish_date, t.status);
          if (!canSched) {
            return (
              <span className={`org-tgrid__mono${over ? ' org-tgrid__mono--overdue' : ''}`}>
                {t.ideal_finish_date ?? '—'}
              </span>
            );
          }
          return (
            <DatePicker
              size="sm"
              ariaLabel={`Planned finish for ${t.task_code}`}
              placeholder="—"
              error={over}
              value={t.ideal_finish_date ?? ''}
              onChange={(v) => void inlinePatch(t, { ideal_finish_date: v })}
            />
          );
        },
      },
      {
        id: 'bid_hours',
        header: 'Bid (h)',
        accessorKey: 'bid_hours',
        size: 86,
        cell: ({ row }) => {
          const t = row.original;
          if (!isFullTaskItem(t)) return null;
          const canEdit = canPerformOnTask(auth, 'task.edit_fields', t.my_capacities ?? []);
          if (!canEdit) return <span className="org-tgrid__mono">{t.bid_hours ?? 0}</span>;
          return (
            <input
              type="number"
              aria-label={`Bid hours for ${t.task_code}`}
              className="org-tgrid__inline-input"
              defaultValue={t.bid_hours ?? 0}
              min={0}
              step={1}
              onClick={(e) => e.stopPropagation()}
              onBlur={(e) => {
                const v = Number(e.target.value);
                if (Number.isFinite(v) && v >= 0 && v !== (t.bid_hours ?? 0)) {
                  void inlinePatch(t, { bid_hours: v });
                }
              }}
            />
          );
        },
      },
      {
        id: 'bid_days',
        header: 'Bid (d)',
        accessorKey: 'bid_days',
        size: 76,
        cell: (ctx) => <span className="org-tgrid__mono">{String(ctx.getValue() ?? '—')}</span>,
      },
      {
        id: 'logged_hours',
        header: 'Logged (h)',
        accessorKey: 'logged_hours',
        size: 86,
        cell: (ctx) => <span className="org-tgrid__mono">{String(ctx.getValue() ?? 0)}</span>,
      },
      { id: 'retake_count', header: 'Retakes', accessorKey: 'retake_count', size: 74 },
      { id: 'complexity_rating', header: 'Complexity', accessorKey: 'complexity_rating', size: 88 },
      { id: 'version_count', header: 'Versions', accessorKey: 'version_count', size: 78 },
      { id: 'upstream_count', header: 'Upstream', accessorKey: 'upstream_count', size: 80 },
      {
        id: 'updated_at',
        header: 'Updated',
        accessorKey: 'updated_at',
        size: 135,
        cell: (ctx) => (
          <span className="org-tgrid__mono">{String(ctx.getValue() ?? '').slice(0, 16)}</span>
        ),
      },
      { id: 'folder_name', header: 'Folder', accessorKey: 'folder_name', size: 95 },
    ];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isClient, auth]);

  const visibleColumns = useMemo(
    () =>
      isClient ? allColumns : allColumns.filter((c) => !hiddenCols.includes(String(c.id ?? ''))),
    [allColumns, hiddenCols, isClient],
  );

  const table = useLegacyTable<AnyTaskRow>({
    data: tasks as AnyTaskRow[],
    columns: visibleColumns,
    state: { sorting },
    onSortingChange: setSorting,
    enableMultiSort: true,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  const rows = table.getRowModel().rows;
  const scrollRef = useRef<HTMLDivElement>(null);
  const vizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => GRID_ROW_PX,
    overscan: 15,
  });

  const getWidth = (colId: string, fallback = 115) => colWidths[colId] ?? fallback;

  // ---- Spreadsheet-style range selection (click / drag / shift+click / arrows / Ctrl+C) ----
  const [anchor, setAnchor] = useState<CellCoord | null>(null);
  const [focus, setFocus] = useState<CellCoord | null>(null);
  const draggingRef = useRef(false);
  const leafCols = table.getVisibleLeafColumns();
  const colCount = leafCols.length;
  const range = useMemo(() => {
    if (!anchor || !focus) return null;
    return {
      r0: Math.min(anchor.r, focus.r),
      r1: Math.max(anchor.r, focus.r),
      c0: Math.min(anchor.c, focus.c),
      c1: Math.max(anchor.c, focus.c),
    };
  }, [anchor, focus]);

  useEffect(() => {
    const stop = () => {
      draggingRef.current = false;
    };
    window.addEventListener('mouseup', stop);
    return () => window.removeEventListener('mouseup', stop);
  }, []);

  // Selection indices are positional; reset when the data/columns change shape.
  useEffect(() => {
    setAnchor(null);
    setFocus(null);
  }, [rows.length, colCount]);

  const onCellMouseDown = (e: MouseEvent, r: number, c: number) => {
    if (e.button !== 0) return;
    const el = e.target as HTMLElement;
    if (el.closest('input, select, textarea, button, [role="combobox"], a')) return;
    if (e.shiftKey && anchor) {
      setFocus({ r, c });
    } else {
      setAnchor({ r, c });
      setFocus({ r, c });
    }
    draggingRef.current = true;
    // Keep keyboard focus on the grid so arrows / Ctrl+C work, and avoid text selection.
    e.preventDefault();
    scrollRef.current?.focus({ preventScroll: true });
  };

  const onCellMouseEnter = (r: number, c: number) => {
    if (draggingRef.current) setFocus({ r, c });
  };

  const selectionTsv = useCallback((): string => {
    if (!range) return '';
    const lines: string[] = [];
    for (let r = range.r0; r <= range.r1; r++) {
      const row = rows[r];
      if (!row) continue;
      const vals: string[] = [];
      for (let c = range.c0; c <= range.c1; c++) {
        const col = leafCols[c];
        vals.push(col ? cellText(row.getValue(col.id)) : '');
      }
      lines.push(vals.join('\t'));
    }
    return lines.join('\n');
  }, [range, rows, leafCols]);

  const copySelection = useCallback(async () => {
    const text = selectionTsv();
    if (!text || !range) return;
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
    }
    const cells = (range.r1 - range.r0 + 1) * (range.c1 - range.c0 + 1);
    toast.push('success', `Copied ${cells} cell${cells === 1 ? '' : 's'}`);
  }, [selectionTsv, range, toast]);

  const onGridKeyDown = (e: ReactKeyboardEvent) => {
    const target = e.target as HTMLElement;
    if (target.closest('input, select, textarea')) return;
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === 'c' && range) {
      e.preventDefault();
      void copySelection();
      return;
    }
    if (mod && e.key.toLowerCase() === 'a' && rows.length > 0) {
      e.preventDefault();
      setAnchor({ r: 0, c: 0 });
      setFocus({ r: rows.length - 1, c: colCount - 1 });
      return;
    }
    if (e.key === 'Escape') {
      setAnchor(null);
      setFocus(null);
      return;
    }
    const delta: Record<string, [number, number]> = {
      ArrowUp: [-1, 0],
      ArrowDown: [1, 0],
      ArrowLeft: [0, -1],
      ArrowRight: [0, 1],
    };
    const d = delta[e.key];
    if (!d || !focus) return;
    e.preventDefault();
    const next = {
      r: Math.max(0, Math.min(rows.length - 1, focus.r + d[0])),
      c: Math.max(0, Math.min(colCount - 1, focus.c + d[1])),
    };
    setFocus(next);
    if (!e.shiftKey) setAnchor(next);
    vizer.scrollToIndex(next.r);
    const rowTask = rows[next.r]?.original;
    if (rowTask && !e.shiftKey) onSelectTask(rowTask.id);
  };

  const exportCsv = () => {
    const headers = table.getAllLeafColumns().map((c) => String(c.columnDef.header ?? c.id));
    const lines = [headers.join(',')];
    for (const r of rows) {
      const vals = table.getAllLeafColumns().map((col) => {
        const v = r.getValue(col.id);
        const s = v === null || v === undefined ? '' : String(v);
        return `"${s.replace(/"/g, '""')}"`;
      });
      lines.push(vals.join(','));
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'organum-tasks.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="org-tgrid" data-ui="task-grid-view">
      <div className="org-tgrid__toolbar">
        <Text size="sm" variant="accent">
          Showing {rows.length} of {total} tasks
          {range
            ? ` · ${(range.r1 - range.r0 + 1) * (range.c1 - range.c0 + 1)} cell(s) selected — Ctrl+C to copy`
            : ''}
        </Text>
        <div className="org-tgrid__tools">
          {!isClient && (
            <>
              <Popover
                open={chooserOpen}
                onOpenChange={setChooserOpen}
                trigger={
                  <Button size="sm" aria-label="Choose columns">
                    Columns ({visibleColumns.length}/{allColumns.length})
                  </Button>
                }
              >
                <div className="org-tgrid__chooser">
                  {allColumns.map((col) => {
                    const id = String(col.id ?? '');
                    const visible = !hiddenCols.includes(id);
                    return (
                      <Checkbox
                        key={id}
                        label={String(col.header ?? id)}
                        checked={visible}
                        onChange={(checked) => {
                          if (checked) {
                            setHiddenCols(hiddenCols.filter((x) => x !== id));
                          } else {
                            setHiddenCols([...hiddenCols, id]);
                          }
                        }}
                      />
                    );
                  })}
                </div>
              </Popover>
              <Button size="sm" onClick={exportCsv}>
                Export CSV
              </Button>
            </>
          )}
          {hasMore && (
            <Button size="sm" variant="primary" disabled={loadingMore} onClick={onLoadMore}>
              {loadingMore ? 'Loading...' : 'Load More'}
            </Button>
          )}
        </div>
      </div>

      <div
        ref={scrollRef}
        className="org-tgrid__scroll"
        role="table"
        aria-label="Tasks table"
        tabIndex={0}
        onKeyDown={onGridKeyDown}
      >
        <div className="org-tgrid__thead" role="rowgroup">
          <div className="org-tgrid__tr-hdr" role="row">
            {table.getHeaderGroups()[0]?.headers.map((header) => {
              const colId = header.column.id;
              const defW = Number(header.column.columnDef.size ?? 115);
              return (
                <ResizableColHeader
                  key={header.id}
                  colId={colId}
                  width={getWidth(colId, defW)}
                  sorted={header.column.getIsSorted()}
                  onToggleSort={(e) => header.column.getToggleSortingHandler()?.(e)}
                  onResize={(id, w) => setColWidths((p) => ({ ...p, [id]: w }))}
                >
                  {flexRender(header.column.columnDef.header, header.getContext())}
                </ResizableColHeader>
              );
            })}
          </div>
        </div>

        <VirtualTableBody height={vizer.getTotalSize()}>
          {vizer.getVirtualItems().map((vRow) => {
            const row = rows[vRow.index]!;
            const original = row.original;
            return (
              <VirtualTableRow
                key={original.id}
                start={vRow.start}
                selected={original.id === selectedTaskId}
                status={original.status}
                onClick={() => onSelectTask(original.id)}
              >
                {row.getVisibleCells().map((cell, cIdx) => {
                  const colId = cell.column.id;
                  const defW = Number(cell.column.columnDef.size ?? 115);
                  const rIdx = vRow.index;
                  const inRange =
                    !!range &&
                    rIdx >= range.r0 &&
                    rIdx <= range.r1 &&
                    cIdx >= range.c0 &&
                    cIdx <= range.c1;
                  const edges = inRange
                    ? `${rIdx === range.r0 ? 't' : ''}${cIdx === range.c1 ? 'r' : ''}${
                        rIdx === range.r1 ? 'b' : ''
                      }${cIdx === range.c0 ? 'l' : ''}`
                    : '';
                  return (
                    <GridCellSlot
                      key={cell.id}
                      width={getWidth(colId, defW)}
                      inRange={inRange}
                      isFocus={!!focus && focus.r === rIdx && focus.c === cIdx}
                      edges={edges}
                      onMouseDown={(e) => onCellMouseDown(e, rIdx, cIdx)}
                      onMouseEnter={() => onCellMouseEnter(rIdx, cIdx)}
                    >
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </GridCellSlot>
                  );
                })}
              </VirtualTableRow>
            );
          })}
        </VirtualTableBody>
      </div>
    </div>
  );
}
