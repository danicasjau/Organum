import { useQueryClient } from '@tanstack/react-query';
import {
  flexRender,
  type SortingState,
} from '@tanstack/react-table';
import {
  getCoreRowModel,
  getSortedRowModel,
  useLegacyTable,
  type LegacyColumnDef,
} from '@tanstack/react-table/legacy';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useMemo, useRef, useState, type MouseEvent } from 'react';
import {
  Avatar,
  Badge,
  Button,
  CapacityBadgeList,
  Checkbox,
  Popover,
  PriorityMarker,
  Select,
  StatusChip,
  Text,
  useToast,
} from '../../components/ui';
import { useCssVarRef } from '../../components/ui/_internal/useCssVar';
import {
  apiClient,
  type ClientTaskListItemOut,
  type TaskListItemOut,
} from '../../lib/api/client';
import { useAuthStore } from '../auth/authStore';
import { useProjectStore } from '../project/projectStore';
import {
  canPerformOnTask,
  isFullTaskItem,
  isOverdueDate,
  PRIORITY_OPTIONS,
} from './taskHelpers';
import { useTasksStore } from './tasksStore';
import './TaskGridView.css';

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

function GridCellSlot({
  width,
  children,
}: {
  width: number;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useCssVarRef(ref, '--tg-col-w', `${width}px`);
  return (
    <div ref={ref} role="cell" className="org-tgrid__td">
      {children}
    </div>
  );
}

function VirtualTableBody({
  height,
  children,
}: {
  height: number;
  children: React.ReactNode;
}) {
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
  onClick,
  children,
}: {
  start: number;
  selected: boolean;
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
          size: 110,
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
          cell: (ctx) => (
            <span className="org-tgrid__mono">{String(ctx.getValue() ?? '—')}</span>
          ),
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
          accessorFn: (r) =>
            !isFullTaskItem(r) ? (r.product?.versions?.length ?? 0) : 0,
        },
      ];
    }

    return [
      {
        id: 'task_code',
        header: 'Code',
        accessorKey: 'task_code',
        size: 145,
        cell: (ctx) => <span className="org-tgrid__mono">{String(ctx.getValue())}</span>,
      },
      { id: 'task_name', header: 'Task Name', accessorKey: 'task_name', size: 170 },
      { id: 'entity_name', header: 'Entity', accessorKey: 'entity_name', size: 130 },
      { id: 'entity_rel_path', header: 'Entity Path', accessorKey: 'entity_rel_path', size: 160 },
      { id: 'parent_entity_type', header: 'Entity Type', accessorKey: 'parent_entity_type', size: 100 },
      { id: 'department_name', header: 'Department', accessorKey: 'department_name', size: 115 },
      {
        id: 'status',
        header: 'Status',
        accessorKey: 'status',
        size: 105,
        cell: (ctx) => <StatusChip status={String(ctx.getValue())} compact />,
      },
      {
        id: 'priority',
        header: 'Priority',
        accessorFn: (r) => (isFullTaskItem(r) ? r.priority : 'normal'),
        size: 115,
        cell: ({ row }) => {
          const t = row.original;
          if (!isFullTaskItem(t)) return null;
          const canEdit = canPerformOnTask(auth, 'task.edit_fields', t.my_capacities ?? []);
          if (!canEdit) return <PriorityMarker priority={t.priority ?? 'normal'} />;
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
        header: 'Ideal Start',
        accessorKey: 'ideal_start_date',
        size: 100,
        cell: (ctx) => <span className="org-tgrid__mono">{String(ctx.getValue() ?? '—')}</span>,
      },
      {
        id: 'ideal_finish_date',
        header: 'Ideal Finish',
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
            <input
              type="date"
              aria-label={`Due date for ${t.task_code}`}
              className={`org-tgrid__inline-input${over ? ' org-tgrid__inline-input--overdue' : ''}`}
              value={t.ideal_finish_date ?? ''}
              onClick={(e) => e.stopPropagation()}
              onChange={(e) =>
                void inlinePatch(t, { ideal_finish_date: e.target.value || null })
              }
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
      isClient
        ? allColumns
        : allColumns.filter((c) => !hiddenCols.includes(String(c.id ?? ''))),
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
    estimateSize: () => 22,
    overscan: 15,
  });

  const getWidth = (colId: string, fallback = 115) => colWidths[colId] ?? fallback;

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

      <div ref={scrollRef} className="org-tgrid__scroll" role="table" aria-label="Tasks table">
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
                onClick={() => onSelectTask(original.id)}
              >
                {row.getVisibleCells().map((cell) => {
                  const colId = cell.column.id;
                  const defW = Number(cell.column.columnDef.size ?? 115);
                  return (
                    <GridCellSlot key={cell.id} width={getWidth(colId, defW)}>
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

