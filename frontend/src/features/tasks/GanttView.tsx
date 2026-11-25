import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useVirtualizer } from '@tanstack/react-virtual';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from 'react';
import {
  Avatar,
  Badge,
  Button,
  Dialog,
  Icon,
  PriorityMarker,
  Select,
  StatusChip,
  Text,
  useToast,
} from '../../components/ui';
import { useCssVarRef } from '../../components/ui/_internal/useCssVar';
import {
  apiClient,
  type CompanyOut,
  type TaskGraphEdgeOut,
  type TaskListItemOut,
  type UserOut,
} from '../../lib/api/client';
import { hasPerm, useAuthStore } from '../auth/authStore';
import { useProjectStore } from '../project/projectStore';
import {
  addDays,
  buildGanttRows,
  collectDependencyChain,
  computeDependencyViolations,
  computePushDependents,
  computeTimelineBounds,
  diffDays,
  edgeKey,
  isWorkingDay,
  todayIsoUtc,
  type GanttGroupRow,
  type GanttRow,
  type GanttTaskRow,
} from './planningHelpers';
import { canPerformOnTask } from './taskHelpers';
import {
  useTasksStore,
  type GanttGroupBy,
  type GanttPatchItem,
  type GanttZoom,
} from './tasksStore';
import './GanttView.css';

const EMPTY_EDGES: TaskGraphEdgeOut[] = [];
const DEFAULT_WORKING_DAYS = [0, 1, 2, 3, 4];
const ROW_HEIGHT_PX = 22;
const DAY_PX_BY_ZOOM: Record<GanttZoom, number> = {
  day: 28,
  week: 12,
  month: 5,
};

interface DragPreviewState {
  taskId: string;
  mode: 'move' | 'resize-start' | 'resize-end' | 'reassign';
  startX: number;
  startY: number;
  origStart: string;
  origFinish: string;
  previewStart: string;
  previewFinish: string;
  deltaDays: number;
  hoverGroupKey: string | null;
}

interface PendingReassign {
  task: TaskListItemOut;
  targetType: 'user' | 'company';
  targetId: string | null;
  targetLabel: string;
}

function TreeVirtualRow({
  row,
  topPx,
  selectedTaskId,
  chainDimmed,
  violated,
  dropHighlight,
  onToggleGroup,
  onSelectTask,
}: {
  row: GanttRow;
  topPx: number;
  selectedTaskId: string | null;
  chainDimmed: boolean;
  violated: boolean;
  dropHighlight: boolean;
  onToggleGroup: (groupKey: string) => void;
  onSelectTask: (taskId: string) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useCssVarRef(ref, '--gantt-row-top', `${topPx}px`);

  if (row.kind === 'group') {
    const g: GanttGroupRow = row;
    return (
      <div
        ref={ref}
        className={`org-gantt__tree-group ${dropHighlight ? 'is-drop-target' : ''}`}
        data-group-key={g.groupKey}
        onClick={() => onToggleGroup(g.groupKey)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onToggleGroup(g.groupKey);
          }
        }}
      >
        <Icon name={g.collapsed ? 'chevron-right' : 'chevron-down'} size="sm" />
        <span className="org-gantt__tree-label" title={g.label}>
          {g.label}
        </span>
        {g.sublabel && <span className="org-gantt__tree-sub">{g.sublabel}</span>}
        <Badge tone="neutral">{g.taskCount}</Badge>
        <StatusChip status={g.rollupStatus} compact />
      </div>
    );
  }

  const { task } = row as GanttTaskRow;
  const assignments = task.assignments ?? [];
  const primaryArtist =
    assignments.find((a) => a.assignment_role === 'artist') ?? assignments[0];

  return (
    <div
      ref={ref}
      className={`org-gantt__tree-task ${selectedTaskId === task.id ? 'is-selected' : ''} ${
        chainDimmed ? 'is-dimmed' : ''
      }`}
      data-task-id={task.id}
      onClick={() => onSelectTask(task.id)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelectTask(task.id);
        }
      }}
    >
      <PriorityMarker priority={task.priority} />
      <span className="org-gantt__tree-code" title={`${task.task_code} — ${task.name}`}>
        {task.task_code}
      </span>
      {violated && (
        <span
          className="org-gantt__viol-tag"
          title="Starts before upstream dependency finishes"
        >
          <Icon name="alert" size="sm" />
        </span>
      )}
      <span className="org-gantt__tree-meta">
        {primaryArtist && (
          <Avatar
            username={primaryArtist.username}
            fullName={primaryArtist.full_name}
            size="sm"
          />
        )}
        <StatusChip status={task.status} compact />
      </span>
    </div>
  );
}

function TimelineGroupBar({
  row,
  topPx,
  startIso,
  dayPx,
  dropHighlight,
}: {
  row: GanttGroupRow;
  topPx: number;
  startIso: string;
  dayPx: number;
  dropHighlight: boolean;
}) {
  const rowRef = useRef<HTMLDivElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  useCssVarRef(rowRef, '--gantt-row-top', `${topPx}px`);

  const hasSpan = Boolean(row.minStart && row.maxFinish);
  const leftPx = row.minStart ? diffDays(startIso, row.minStart) * dayPx : 0;
  const widthPx =
    row.minStart && row.maxFinish
      ? Math.max(8, (diffDays(row.minStart, row.maxFinish) + 1) * dayPx)
      : 0;
  useCssVarRef(barRef, '--gantt-bar-x', `${leftPx}px`);
  useCssVarRef(barRef, '--gantt-bar-w', `${widthPx}px`);

  return (
    <div
      ref={rowRef}
      className={`org-gantt__tl-group-row ${dropHighlight ? 'is-drop-target' : ''}`}
      data-group-key={row.groupKey}
    >
      {hasSpan && (
        <div
          ref={barRef}
          className="org-gantt__summary-bar"
          title={`${row.label}: ${row.minStart} to ${row.maxFinish} (${row.rollupStatus})`}
        />
      )}
    </div>
  );
}

function TimelineTaskRow({
  row,
  topPx,
  startIso,
  dayPx,
  selected,
  chainDimmed,
  violated,
  canEditDates,
  canAssign,
  dragPreview,
  onSelectTask,
  onBeginDrag,
}: {
  row: GanttTaskRow;
  topPx: number;
  startIso: string;
  dayPx: number;
  selected: boolean;
  chainDimmed: boolean;
  violated: boolean;
  canEditDates: boolean;
  canAssign: boolean;
  dragPreview: DragPreviewState | null;
  onSelectTask: (taskId: string) => void;
  onBeginDrag: (
    e: ReactMouseEvent,
    task: TaskListItemOut,
    mode: 'move' | 'resize-start' | 'resize-end' | 'reassign',
  ) => void;
}) {
  const rowRef = useRef<HTMLDivElement>(null);
  const idealBarRef = useRef<HTMLDivElement>(null);
  const fillRef = useRef<HTMLDivElement>(null);
  const actualBarRef = useRef<HTMLDivElement>(null);
  const { task } = row;

  const isPreview = dragPreview?.taskId === task.id;
  const startDate = isPreview ? dragPreview.previewStart : task.ideal_start_date;
  const finishDate = isPreview ? dragPreview.previewFinish : task.ideal_finish_date ?? task.ideal_start_date;

  const hasIdeal = Boolean(startDate && finishDate);
  const idealX = startDate ? diffDays(startIso, startDate) * dayPx : 0;
  const idealW =
    startDate && finishDate ? Math.max(dayPx, (diffDays(startDate, finishDate) + 1) * dayPx) : 0;
  const progressPct =
    task.bid_hours && task.bid_hours > 0
      ? Math.min(100, Math.round((task.logged_hours / task.bid_hours) * 100))
      : 0;

  const hasActual = Boolean(task.actual_start_date);
  const actStart = task.actual_start_date ?? '';
  const actFinish = task.actual_finish_date ?? actStart;
  const actX = hasActual ? diffDays(startIso, actStart) * dayPx : 0;
  const actW = hasActual ? Math.max(dayPx, (diffDays(actStart, actFinish) + 1) * dayPx) : 0;

  useCssVarRef(rowRef, '--gantt-row-top', `${topPx}px`);
  useCssVarRef(idealBarRef, '--gantt-bar-x', `${idealX}px`);
  useCssVarRef(idealBarRef, '--gantt-bar-w', `${idealW}px`);
  useCssVarRef(fillRef, '--gantt-fill-pct', `${progressPct}%`);
  useCssVarRef(actualBarRef, '--gantt-act-x', `${actX}px`);
  useCssVarRef(actualBarRef, '--gantt-act-w', `${actW}px`);

  return (
    <div
      ref={rowRef}
      className={`org-gantt__tl-task-row ${selected ? 'is-selected' : ''} ${
        chainDimmed ? 'is-dimmed' : ''
      }`}
      data-task-row-id={task.id}
    >
      {hasIdeal ? (
        <div
          ref={idealBarRef}
          className={`org-gantt__bar ${canEditDates ? 'is-editable' : ''} ${
            violated ? 'is-violated' : ''
          } ${selected ? 'is-selected' : ''} org-gantt__bar--${task.status.toLowerCase()}`}
          data-gantt-bar={task.id}
          title={`${task.task_code}: ${startDate} → ${finishDate} (${task.status}, ${task.logged_hours}h / ${task.bid_hours ?? 0}h)`}
          onClick={(e) => {
            e.stopPropagation();
            onSelectTask(task.id);
          }}
          onMouseDown={(e) => {
            if (e.button !== 0) return;
            if (canEditDates) {
              onBeginDrag(e, task, 'move');
            } else if (canAssign) {
              onBeginDrag(e, task, 'reassign');
            }
          }}
        >
          {canEditDates && (
            <span
              className="org-gantt__handle org-gantt__handle--left"
              title="Drag to adjust start date"
              onMouseDown={(e) => {
                e.stopPropagation();
                onBeginDrag(e, task, 'resize-start');
              }}
            />
          )}
          <div ref={fillRef} className="org-gantt__bar-fill" />
          <span className="org-gantt__bar-label">
            {violated ? '! ' : ''}
            {task.task_code}
          </span>
          {canEditDates && (
            <span
              className="org-gantt__handle org-gantt__handle--right"
              title="Drag to adjust finish date"
              onMouseDown={(e) => {
                e.stopPropagation();
                onBeginDrag(e, task, 'resize-end');
              }}
            />
          )}
        </div>
      ) : (
        <button
          type="button"
          className="org-gantt__unscheduled-pill"
          onClick={(e) => {
            e.stopPropagation();
            onSelectTask(task.id);
          }}
        >
          Unscheduled — open dock
        </button>
      )}
      {hasActual && (
        <div
          ref={actualBarRef}
          className="org-gantt__actual-bar"
          title={`Actual: ${actStart}${task.actual_finish_date ? ` → ${task.actual_finish_date}` : ' (ongoing)'}`}
        />
      )}
    </div>
  );
}

export function GanttView({
  tasks,
  users,
  companies,
  selectedTaskId,
  onSelectTask,
}: {
  tasks: ReadonlyArray<TaskListItemOut>;
  users: ReadonlyArray<UserOut>;
  companies: ReadonlyArray<CompanyOut>;
  selectedTaskId: string | null;
  onSelectTask: (taskId: string) => void;
}) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const auth = useAuthStore((s) => s.auth);
  const activeProjectUuid = useProjectStore((s) => s.activeProjectUuid);
  const isClient = auth?.user.role_name === 'client';
  const canViewGraph = !isClient && hasPerm(auth?.permissions, 'views.graph');

  const ganttGroupBy = useTasksStore((s) => s.ganttGroupBy);
  const setGanttGroupBy = useTasksStore((s) => s.setGanttGroupBy);
  const ganttZoom = useTasksStore((s) => s.ganttZoom);
  const setGanttZoom = useTasksStore((s) => s.setGanttZoom);
  const ganttShowLinks = useTasksStore((s) => s.ganttShowLinks);
  const setGanttShowLinks = useTasksStore((s) => s.setGanttShowLinks);
  const ganttPushDependents = useTasksStore((s) => s.ganttPushDependents);
  const setGanttPushDependents = useTasksStore((s) => s.setGanttPushDependents);
  const ganttCollapsedGroups = useTasksStore((s) => s.ganttCollapsedGroups);
  const toggleGanttGroupCollapsed = useTasksStore((s) => s.toggleGanttGroupCollapsed);
  const ganttUndoStack = useTasksStore((s) => s.ganttUndoStack);
  const ganttRedoStack = useTasksStore((s) => s.ganttRedoStack);
  const pushGanttUndo = useTasksStore((s) => s.pushGanttUndo);
  const popGanttUndo = useTasksStore((s) => s.popGanttUndo);
  const pushGanttRedo = useTasksStore((s) => s.pushGanttRedo);
  const popGanttRedo = useTasksStore((s) => s.popGanttRedo);

  const [dragPreview, setDragPreview] = useState<DragPreviewState | null>(null);
  const [pendingReassign, setPendingReassign] = useState<PendingReassign | null>(null);
  const [busyMutation, setBusyMutation] = useState(false);

  const treeScrollRef = useRef<HTMLDivElement>(null);
  const timelineScrollRef = useRef<HTMLDivElement>(null);
  const syncingRef = useRef(false);

  const { data: settings } = useQuery({
    queryKey: ['project-settings', activeProjectUuid],
    queryFn: () => apiClient.getProjectSettings(activeProjectUuid),
    enabled: Boolean(activeProjectUuid && !isClient),
  });

  const { data: graphData } = useQuery({
    queryKey: ['task-graph', activeProjectUuid, 'all', 'gantt'],
    queryFn: () => apiClient.getTaskGraph({ limit: 500 }, activeProjectUuid),
    enabled: Boolean(activeProjectUuid && canViewGraph),
  });

  const edges = graphData?.edges ?? EMPTY_EDGES;
  const workingDays = settings?.working_days ?? DEFAULT_WORKING_DAYS;
  const enforceDeps = Boolean(settings?.enforce_dependencies_in_gantt);
  const dayPx = DAY_PX_BY_ZOOM[ganttZoom];
  const todayIso = useMemo(() => todayIsoUtc(), []);

  const collapsedSet = useMemo(() => new Set(ganttCollapsedGroups), [ganttCollapsedGroups]);
  const { rows, firstRowKeyByTaskId } = useMemo(
    () =>
      buildGanttRows({
        tasks,
        groupBy: ganttGroupBy,
        collapsedGroups: collapsedSet,
        users,
        companies,
      }),
    [tasks, ganttGroupBy, collapsedSet, users, companies],
  );

  const tasksById = useMemo(() => {
    const m = new Map<string, TaskListItemOut>();
    for (const t of tasks) m.set(t.id, t);
    return m;
  }, [tasks]);

  const effectiveTasksById = useMemo(() => {
    if (!dragPreview || dragPreview.mode === 'reassign') return tasksById;
    const orig = tasksById.get(dragPreview.taskId);
    if (!orig) return tasksById;
    const copy = new Map(tasksById);
    copy.set(orig.id, {
      ...orig,
      ideal_start_date: dragPreview.previewStart,
      ideal_finish_date: dragPreview.previewFinish,
    });
    return copy;
  }, [tasksById, dragPreview]);

  const { startIso, totalDays } = useMemo(
    () => computeTimelineBounds(tasks, todayIso),
    [tasks, todayIso],
  );
  const timelineWidthPx = totalDays * dayPx;
  const todayX = diffDays(startIso, todayIso) * dayPx;

  const { violatedEdgeKeys, violatedTaskIds } = useMemo(
    () => computeDependencyViolations(edges, effectiveTasksById),
    [edges, effectiveTasksById],
  );

  const selectedChain = useMemo(
    () => (selectedTaskId ? collectDependencyChain(selectedTaskId, edges) : null),
    [selectedTaskId, edges],
  );

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => timelineScrollRef.current,
    estimateSize: () => ROW_HEIGHT_PX,
    overscan: 14,
  });

  const totalHeightPx = virtualizer.getTotalSize();
  const virtualItems = virtualizer.getVirtualItems();

  const rowIndexByTaskId = useMemo(() => {
    const m = new Map<string, number>();
    rows.forEach((r, idx) => {
      if (r.kind === 'task' && !m.has(r.task.id) && firstRowKeyByTaskId.get(r.task.id) === r.rowKey) {
        m.set(r.task.id, idx);
      }
    });
    return m;
  }, [rows, firstRowKeyByTaskId]);

  // Synchronize vertical scroll between left tree pane and right timeline pane
  const syncVerticalScroll = (source: 'tree' | 'timeline') => {
    if (syncingRef.current) return;
    syncingRef.current = true;
    const tree = treeScrollRef.current;
    const tl = timelineScrollRef.current;
    if (tree && tl) {
      if (source === 'tree') tl.scrollTop = tree.scrollTop;
      else tree.scrollTop = tl.scrollTop;
    }
    requestAnimationFrame(() => {
      syncingRef.current = false;
    });
  };

  const scrollToToday = useCallback(() => {
    const tl = timelineScrollRef.current;
    if (!tl) return;
    tl.scrollLeft = Math.max(0, todayX - Math.round(tl.clientWidth * 0.35));
  }, [todayX]);

  useEffect(() => {
    const tl = timelineScrollRef.current;
    if (tl && tl.scrollLeft === 0 && todayX > 120) {
      tl.scrollLeft = Math.max(0, todayX - 180);
    }
  }, [todayX]);

  const applyPatches = useCallback(
    async (
      patches: ReadonlyArray<{ taskId: string; start: string | null; finish: string | null; updatedAt?: string }>,
      label: string,
    ) => {
      setBusyMutation(true);
      try {
        for (const p of patches) {
          await apiClient.patchTask(
            p.taskId,
            {
              ideal_start_date: p.start,
              ideal_finish_date: p.finish,
              expected_updated_at: p.updatedAt,
            },
            activeProjectUuid,
          );
        }
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: ['tasks', activeProjectUuid] }),
          queryClient.invalidateQueries({ queryKey: ['task', activeProjectUuid] }),
          queryClient.invalidateQueries({ queryKey: ['workload', activeProjectUuid] }),
          queryClient.invalidateQueries({ queryKey: ['task-graph', activeProjectUuid] }),
        ]);
        toast.push('success', label);
      } catch (err) {
        toast.push('danger', err instanceof Error ? err.message : 'Schedule update failed');
      } finally {
        setBusyMutation(false);
      }
    },
    [activeProjectUuid, queryClient, toast],
  );

  const handleUndo = useCallback(async () => {
    const action = popGanttUndo();
    if (!action) return;
    await applyPatches(
      action.patches.map((p) => ({
        taskId: p.taskId,
        start: p.prevStart,
        finish: p.prevFinish,
      })),
      `Undid ${action.label}`,
    );
    pushGanttRedo(action);
  }, [popGanttUndo, applyPatches, pushGanttRedo]);

  const handleRedo = useCallback(async () => {
    const action = popGanttRedo();
    if (!action) return;
    await applyPatches(
      action.patches.map((p) => ({
        taskId: p.taskId,
        start: p.nextStart,
        finish: p.nextFinish,
      })),
      `Redid ${action.label}`,
    );
    pushGanttUndo(action);
  }, [popGanttRedo, applyPatches, pushGanttUndo]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;
      if (e.key.toLowerCase() === 'z' && !e.shiftKey) {
        e.preventDefault();
        void handleUndo();
      } else if (
        (e.key.toLowerCase() === 'z' && e.shiftKey) ||
        e.key.toLowerCase() === 'y'
      ) {
        e.preventDefault();
        void handleRedo();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [handleUndo, handleRedo]);

  const beginDrag = (
    e: ReactMouseEvent,
    task: TaskListItemOut,
    mode: 'move' | 'resize-start' | 'resize-end' | 'reassign',
  ) => {
    const origStart = task.ideal_start_date;
    const origFinish = task.ideal_finish_date ?? task.ideal_start_date;
    if (mode !== 'reassign' && (!origStart || !origFinish)) return;

    const initialState: DragPreviewState = {
      taskId: task.id,
      mode,
      startX: e.clientX,
      startY: e.clientY,
      origStart: origStart ?? todayIso,
      origFinish: origFinish ?? todayIso,
      previewStart: origStart ?? todayIso,
      previewFinish: origFinish ?? todayIso,
      deltaDays: 0,
      hoverGroupKey: null,
    };

    let latest = initialState;

    const onMove = (ev: globalThis.MouseEvent) => {
      const dx = ev.clientX - initialState.startX;
      const dy = ev.clientY - initialState.startY;
      const deltaDays = Math.round(dx / dayPx);

      let hoverGroupKey: string | null = null;
      if (
        (ganttGroupBy === 'user' || ganttGroupBy === 'company') &&
        Math.abs(dy) >= ROW_HEIGHT_PX * 0.75
      ) {
        const el = document.elementFromPoint(ev.clientX, ev.clientY);
        const grp = el?.closest<HTMLElement>('[data-group-key]');
        if (grp?.dataset.groupKey) hoverGroupKey = grp.dataset.groupKey;
      }

      let previewStart = initialState.origStart;
      let previewFinish = initialState.origFinish;
      if (mode === 'move' && !hoverGroupKey) {
        previewStart = addDays(initialState.origStart, deltaDays);
        previewFinish = addDays(initialState.origFinish, deltaDays);
      } else if (mode === 'resize-start') {
        const candidate = addDays(initialState.origStart, deltaDays);
        previewStart = candidate <= initialState.origFinish ? candidate : initialState.origFinish;
      } else if (mode === 'resize-end') {
        const candidate = addDays(initialState.origFinish, deltaDays);
        previewFinish = candidate >= initialState.origStart ? candidate : initialState.origStart;
      }

      latest = {
        ...initialState,
        deltaDays,
        previewStart,
        previewFinish,
        hoverGroupKey,
      };
      setDragPreview(latest);
    };

    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      setDragPreview(null);

      // Reassignment drop onto User or Company header
      if (latest.hoverGroupKey) {
        const canAssign = canPerformOnTask(auth, 'task.assign', task.my_capacities);
        if (!canAssign) {
          toast.push('warning', 'Missing task.assign permission');
          return;
        }
        if (latest.hoverGroupKey.startsWith('user:')) {
          const uid = latest.hoverGroupKey.slice('user:'.length);
          const u = users.find((x) => x.id === uid);
          setPendingReassign({
            task,
            targetType: 'user',
            targetId: uid === '__unassigned__' ? null : uid,
            targetLabel: u ? u.full_name || u.username : 'Unassigned',
          });
          return;
        }
        if (latest.hoverGroupKey.startsWith('company:')) {
          const cid = latest.hoverGroupKey.slice('company:'.length);
          const c = companies.find((x) => x.id === cid);
          setPendingReassign({
            task,
            targetType: 'company',
            targetId: cid === '__internal__' ? null : cid,
            targetLabel: c ? c.name : 'In-house / Unscoped',
          });
          return;
        }
      }

      if (
        mode === 'reassign' ||
        (latest.previewStart === initialState.origStart &&
          latest.previewFinish === initialState.origFinish)
      ) {
        return;
      }

      if (enforceDeps) {
        for (const edge of edges) {
          if (edge.kind !== 'dependency' || edge.target_task_id !== task.id) continue;
          const up = tasksById.get(edge.source_task_id);
          if (up?.ideal_finish_date && latest.previewStart < up.ideal_finish_date) {
            toast.push(
              'danger',
              `Blocked by upstream ${up.task_code} (finishes ${up.ideal_finish_date})`,
            );
            return;
          }
        }
      }

      const patches: GanttPatchItem[] = [
        {
          taskId: task.id,
          prevStart: task.ideal_start_date ?? null,
          prevFinish: task.ideal_finish_date ?? null,
          nextStart: latest.previewStart,
          nextFinish: latest.previewFinish,
          updatedAt: task.updated_at,
        },
      ];

      if (ganttPushDependents) {
        const downstream = computePushDependents({
          rootTaskId: task.id,
          newRootFinish: latest.previewFinish,
          edges,
          tasksById,
        });
        for (const d of downstream) {
          const t = tasksById.get(d.taskId);
          if (!t || !canPerformOnTask(auth, 'task.edit_schedule', t.my_capacities)) continue;
          patches.push(d);
        }
      }

      const actionLabel =
        patches.length > 1
          ? `${task.task_code} + ${patches.length - 1} dependent(s)`
          : task.task_code;

      pushGanttUndo({ label: actionLabel, patches });
      void applyPatches(
        patches.map((p) => ({
          taskId: p.taskId,
          start: p.nextStart,
          finish: p.nextFinish,
          updatedAt: p.updatedAt,
        })),
        `Updated ${actionLabel}`,
      );
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  const confirmReassign = async () => {
    if (!pendingReassign) return;
    setBusyMutation(true);
    try {
      const { task, targetType, targetId, targetLabel } = pendingReassign;
      if (targetType === 'user') {
        const preservedNonArtists = (task.assignments ?? [])
          .filter((a) => a.assignment_role !== 'artist')
          .map((a) => ({ user_id: a.user_id, assignment_role: a.assignment_role }));
        const nextAssignments = targetId
          ? [...preservedNonArtists, { user_id: targetId, assignment_role: 'artist' as const }]
          : preservedNonArtists;
        await apiClient.putTaskAssignments(task.id, nextAssignments, activeProjectUuid);
      } else {
        const candidateUser = targetId
          ? users.find((u) => u.is_active && u.company_id === targetId)
          : undefined;
        if (targetId && !candidateUser) {
          toast.push('warning', `No active user in company ${targetLabel} to assign`);
          setPendingReassign(null);
          setBusyMutation(false);
          return;
        }
        const preservedNonArtists = (task.assignments ?? [])
          .filter((a) => a.assignment_role !== 'artist')
          .map((a) => ({ user_id: a.user_id, assignment_role: a.assignment_role }));
        const nextAssignments = candidateUser
          ? [
              ...preservedNonArtists,
              { user_id: candidateUser.id, assignment_role: 'artist' as const },
            ]
          : preservedNonArtists;
        await apiClient.putTaskAssignments(task.id, nextAssignments, activeProjectUuid);
      }
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['tasks', activeProjectUuid] }),
        queryClient.invalidateQueries({ queryKey: ['task', activeProjectUuid] }),
        queryClient.invalidateQueries({ queryKey: ['workload', activeProjectUuid] }),
      ]);
      toast.push('success', `Assigned ${task.task_code} → ${targetLabel}`);
      setPendingReassign(null);
    } catch (err) {
      toast.push('danger', err instanceof Error ? err.message : 'Reassignment failed');
    } finally {
      setBusyMutation(false);
    }
  };

  // Precompute day ticks and week/month columns
  const dayColumns = useMemo(() => {
    const list: Array<{ iso: string; dayIdx: number; label: string; isNonWorking: boolean; isWeekStart: boolean }> = [];
    for (let i = 0; i < totalDays; i++) {
      const iso = addDays(startIso, i);
      const nonWorking = !isWorkingDay(iso, workingDays);
      const isWeekStart = new Date(`${iso}T00:00:00Z`).getUTCDay() === 1;
      list.push({
        iso,
        dayIdx: i,
        label: iso.slice(8, 10),
        isNonWorking: nonWorking,
        isWeekStart,
      });
    }
    return list;
  }, [startIso, totalDays, workingDays]);

  const headerBands = useMemo(() => {
    const bands: Array<{ key: string; label: string; startIdx: number; spanDays: number }> = [];
    let curKey = '';
    for (let i = 0; i < dayColumns.length; i++) {
      const d = dayColumns[i]!;
      const bandKey =
        ganttZoom === 'month' ? d.iso.slice(0, 7) : d.iso.slice(0, 7);
      if (bandKey !== curKey) {
        bands.push({ key: `${bandKey}-${i}`, label: bandKey, startIdx: i, spanDays: 1 });
        curKey = bandKey;
      } else {
        bands[bands.length - 1]!.spanDays += 1;
      }
    }
    return bands;
  }, [dayColumns, ganttZoom]);

  const tlCanvasRef = useRef<HTMLDivElement>(null);
  const tlHeaderRef = useRef<HTMLDivElement>(null);
  const todayRef = useRef<HTMLDivElement>(null);
  useCssVarRef(tlCanvasRef, '--gantt-tl-w', `${timelineWidthPx}px`);
  useCssVarRef(tlCanvasRef, '--gantt-tl-h', `${totalHeightPx}px`);
  useCssVarRef(tlHeaderRef, '--gantt-tl-w', `${timelineWidthPx}px`);
  useCssVarRef(todayRef, '--gantt-today-x', `${todayX}px`);

  // Orthogonal SVG arrows across visible / nearby rows
  const renderedArrows = useMemo(() => {
    if (!ganttShowLinks || edges.length === 0) return [];
    const arrows: Array<{
      key: string;
      path: string;
      kind: 'dependency' | 'link';
      violated: boolean;
      dimmed: boolean;
      fromEntityLink: boolean;
      mx: number;
      my: number;
    }> = [];

    for (const e of edges) {
      const srcIdx = rowIndexByTaskId.get(e.source_task_id);
      const dstIdx = rowIndexByTaskId.get(e.target_task_id);
      if (srcIdx === undefined || dstIdx === undefined) continue;
      const srcTask = effectiveTasksById.get(e.source_task_id);
      const dstTask = effectiveTasksById.get(e.target_task_id);
      if (!srcTask?.ideal_start_date || !dstTask?.ideal_start_date) continue;

      const srcFinish = srcTask.ideal_finish_date ?? srcTask.ideal_start_date;
      const x1 = (diffDays(startIso, srcFinish) + 1) * dayPx;
      const y1 = srcIdx * ROW_HEIGHT_PX + ROW_HEIGHT_PX / 2;
      const x2 = diffDays(startIso, dstTask.ideal_start_date) * dayPx;
      const y2 = dstIdx * ROW_HEIGHT_PX + ROW_HEIGHT_PX / 2;

      const midX = x2 >= x1 + 12 ? (x1 + x2) / 2 : x1 + 10;
      const d =
        x2 >= x1 + 12
          ? `M ${x1} ${y1} L ${midX} ${y1} L ${midX} ${y2} L ${x2} ${y2}`
          : `M ${x1} ${y1} L ${x1 + 10} ${y1} L ${x1 + 10} ${(y1 + y2) / 2} L ${x2 - 10} ${(y1 + y2) / 2} L ${x2 - 10} ${y2} L ${x2} ${y2}`;

      const k = edgeKey(e.source_task_id, e.target_task_id, e.kind);
      const violated = violatedEdgeKeys.has(k);
      const dimmed = Boolean(selectedChain && !selectedChain.edgeKeys.has(k));
      arrows.push({
        key: k,
        path: d,
        kind: e.kind,
        violated,
        dimmed,
        fromEntityLink: e.from_entity_link,
        mx: (x1 + x2) / 2,
        my: (y1 + y2) / 2,
      });
    }
    return arrows;
  }, [
    ganttShowLinks,
    edges,
    rowIndexByTaskId,
    effectiveTasksById,
    startIso,
    dayPx,
    violatedEdgeKeys,
    selectedChain,
  ]);

  return (
    <div className="org-gantt" data-ui="gantt-view">
      <div className="org-gantt__toolbar">
        <div className="org-gantt__toolbar-group">
          <Text size="sm" variant="muted">
            Group
          </Text>
          <Select
            ariaLabel="Gantt group by"
            value={ganttGroupBy}
            onChange={(v) => setGanttGroupBy(v as GanttGroupBy)}
            options={[
              { value: 'entity_path', label: 'Entity path' },
              { value: 'department', label: 'Department' },
              { value: 'user', label: 'User' },
              { value: 'company', label: 'Company' },
              { value: 'status', label: 'Status' },
              { value: 'priority', label: 'Priority' },
              { value: 'none', label: 'None' },
            ]}
          />
          <div className="org-gantt__seg" role="group" aria-label="Gantt zoom">
            {(['day', 'week', 'month'] as GanttZoom[]).map((z) => (
              <Button
                key={z}
                size="sm"
                variant={ganttZoom === z ? 'primary' : 'ghost'}
                onClick={() => setGanttZoom(z)}
              >
                {z === 'day' ? 'Day' : z === 'week' ? 'Week' : 'Month'}
              </Button>
            ))}
          </div>
          <Button
            size="sm"
            variant={ganttShowLinks ? 'primary' : 'default'}
            aria-pressed={ganttShowLinks}
            onClick={() => setGanttShowLinks(!ganttShowLinks)}
          >
            Links
          </Button>
          <Button
            size="sm"
            variant={ganttPushDependents ? 'primary' : 'default'}
            aria-pressed={ganttPushDependents}
            onClick={() => setGanttPushDependents(!ganttPushDependents)}
            title="Cascade downstream dependencies when moving/resizing bars"
          >
            Push dependents
          </Button>
        </div>

        <div className="org-gantt__toolbar-group">
          {violatedTaskIds.size > 0 && (
            <Badge tone="danger">{violatedTaskIds.size} violated</Badge>
          )}
          <Button
            size="sm"
            variant="ghost"
            disabled={ganttUndoStack.length === 0 || busyMutation}
            onClick={() => void handleUndo()}
            title="Undo Gantt change (Ctrl+Z)"
          >
            Undo ({ganttUndoStack.length})
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={ganttRedoStack.length === 0 || busyMutation}
            onClick={() => void handleRedo()}
            title="Redo Gantt change (Ctrl+Shift+Z)"
          >
            Redo ({ganttRedoStack.length})
          </Button>
          <Button size="sm" variant="default" onClick={scrollToToday}>
            Today
          </Button>
        </div>
      </div>

      <div className="org-gantt__split">
        {/* Left Tree Pane */}
        <div className="org-gantt__tree-pane">
          <div className="org-gantt__tree-hdr">
            <Text size="sm">Tasks ({tasks.length})</Text>
          </div>
          <div
            ref={treeScrollRef}
            className="org-gantt__tree-scroll"
            onScroll={() => syncVerticalScroll('tree')}
          >
            <div className="org-gantt__vlist" data-rows={rows.length}>
              <GanttVirtualSpacer heightPx={totalHeightPx}>
                {virtualItems.map((vi) => {
                  const row = rows[vi.index]!;
                  const isGroup = row.kind === 'group';
                  const dimmed =
                    !isGroup &&
                    Boolean(selectedChain && !selectedChain.nodeIds.has(row.task.id));
                  const violated =
                    !isGroup && violatedTaskIds.has(row.task.id);
                  const dropHi =
                    isGroup && dragPreview?.hoverGroupKey === row.groupKey;
                  return (
                    <TreeVirtualRow
                      key={row.rowKey}
                      row={row}
                      topPx={vi.start}
                      selectedTaskId={selectedTaskId}
                      chainDimmed={dimmed}
                      violated={violated}
                      dropHighlight={dropHi}
                      onToggleGroup={toggleGanttGroupCollapsed}
                      onSelectTask={onSelectTask}
                    />
                  );
                })}
              </GanttVirtualSpacer>
            </div>
          </div>
        </div>

        {/* Right Timeline Pane */}
        <div
          ref={timelineScrollRef}
          className="org-gantt__timeline-scroll"
          onScroll={() => syncVerticalScroll('timeline')}
        >
          <div ref={tlHeaderRef} className="org-gantt__tl-header">
            <div className="org-gantt__tl-bands">
              {headerBands.map((b) => (
                <GanttSpanCell
                  key={b.key}
                  leftPx={b.startIdx * dayPx}
                  widthPx={b.spanDays * dayPx}
                  label={b.label}
                />
              ))}
            </div>
            <div className="org-gantt__tl-days">
              {dayColumns.map((d) => {
                const showLabel =
                  ganttZoom === 'day' ||
                  (ganttZoom === 'week' && d.isWeekStart) ||
                  (ganttZoom === 'month' && d.label === '01');
                return (
                  <GanttDayTick
                    key={d.iso}
                    leftPx={d.dayIdx * dayPx}
                    widthPx={dayPx}
                    label={showLabel ? d.label : ''}
                    nonWorking={d.isNonWorking}
                    today={d.iso === todayIso}
                  />
                );
              })}
            </div>
          </div>

          <div ref={tlCanvasRef} className="org-gantt__tl-canvas">
            {/* Weekend / non-working column shading */}
            {dayColumns.map((d) =>
              d.isNonWorking ? (
                <GanttShadeCol key={`shade-${d.iso}`} leftPx={d.dayIdx * dayPx} widthPx={dayPx} />
              ) : null,
            )}
            <div ref={todayRef} className="org-gantt__today-line" title={`Today (${todayIso})`} />

            {virtualItems.map((vi) => {
              const row = rows[vi.index]!;
              if (row.kind === 'group') {
                return (
                  <TimelineGroupBar
                    key={row.rowKey}
                    row={row}
                    topPx={vi.start}
                    startIso={startIso}
                    dayPx={dayPx}
                    dropHighlight={dragPreview?.hoverGroupKey === row.groupKey}
                  />
                );
              }
              const dimmed = Boolean(selectedChain && !selectedChain.nodeIds.has(row.task.id));
              return (
                <TimelineTaskRow
                  key={row.rowKey}
                  row={row}
                  topPx={vi.start}
                  startIso={startIso}
                  dayPx={dayPx}
                  selected={selectedTaskId === row.task.id}
                  chainDimmed={dimmed}
                  violated={violatedTaskIds.has(row.task.id)}
                  canEditDates={canPerformOnTask(auth, 'task.edit_schedule', row.task.my_capacities)}
                  canAssign={canPerformOnTask(auth, 'task.assign', row.task.my_capacities)}
                  dragPreview={dragPreview}
                  onSelectTask={onSelectTask}
                  onBeginDrag={beginDrag}
                />
              );
            })}

            {ganttShowLinks && renderedArrows.length > 0 && (
              <svg
                className="org-gantt__arrows"
                width={timelineWidthPx}
                height={Math.max(ROW_HEIGHT_PX, totalHeightPx)}
                aria-hidden="true"
              >
                <defs>
                  <marker
                    id="gantt-arrow-ok"
                    viewBox="0 0 8 8"
                    refX="7"
                    refY="4"
                    markerWidth="6"
                    markerHeight="6"
                    orient="auto"
                  >
                    <path d="M 0 1 L 7 4 L 0 7 z" className="org-gantt__marker-ok" />
                  </marker>
                  <marker
                    id="gantt-arrow-viol"
                    viewBox="0 0 8 8"
                    refX="7"
                    refY="4"
                    markerWidth="6"
                    markerHeight="6"
                    orient="auto"
                  >
                    <path d="M 0 1 L 7 4 L 0 7 z" className="org-gantt__marker-viol" />
                  </marker>
                </defs>
                {renderedArrows.map((a) => (
                  <g
                    key={a.key}
                    className={`org-gantt__arrow-grp ${a.violated ? 'is-violated' : ''} ${
                      a.kind === 'link' ? 'is-link' : ''
                    } ${a.dimmed ? 'is-dimmed' : ''}`}
                  >
                    <path
                      d={a.path}
                      markerEnd={
                        a.violated ? 'url(#gantt-arrow-viol)' : 'url(#gantt-arrow-ok)'
                      }
                    />
                    {a.fromEntityLink && (
                      <circle cx={a.mx} cy={a.my} r={4} className="org-gantt__entity-dot" />
                    )}
                  </g>
                ))}
              </svg>
            )}
          </div>
        </div>
      </div>

      <Dialog
        open={Boolean(pendingReassign)}
        onOpenChange={(open) => !open && setPendingReassign(null)}
        title="Confirm task reassignment"
        footer={
          <div className="org-gantt__dialog-actions">
            <Button size="sm" onClick={() => setPendingReassign(null)}>
              Cancel
            </Button>
            <Button
              size="sm"
              variant="primary"
              disabled={busyMutation}
              onClick={() => void confirmReassign()}
            >
              Confirm reassign
            </Button>
          </div>
        }
      >
        {pendingReassign && (
          <Text size="sm">
            Reassign <strong>{pendingReassign.task.task_code}</strong> to{' '}
            <strong>{pendingReassign.targetLabel}</strong>?
          </Text>
        )}
      </Dialog>
    </div>
  );
}

function GanttVirtualSpacer({
  heightPx,
  children,
}: {
  heightPx: number;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useCssVarRef(ref, '--gantt-tl-h', `${heightPx}px`);
  return (
    <div ref={ref} className="org-gantt__vspacer">
      {children}
    </div>
  );
}

function GanttSpanCell({
  leftPx,
  widthPx,
  label,
}: {
  leftPx: number;
  widthPx: number;
  label: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useCssVarRef(ref, '--gantt-bar-x', `${leftPx}px`);
  useCssVarRef(ref, '--gantt-bar-w', `${widthPx}px`);
  return (
    <div ref={ref} className="org-gantt__tl-band">
      {label}
    </div>
  );
}

function GanttDayTick({
  leftPx,
  widthPx,
  label,
  nonWorking,
  today,
}: {
  leftPx: number;
  widthPx: number;
  label: string;
  nonWorking: boolean;
  today: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useCssVarRef(ref, '--gantt-bar-x', `${leftPx}px`);
  useCssVarRef(ref, '--gantt-bar-w', `${widthPx}px`);
  return (
    <div
      ref={ref}
      className={`org-gantt__tl-day ${nonWorking ? 'is-off' : ''} ${today ? 'is-today' : ''}`}
    >
      {label}
    </div>
  );
}

function GanttShadeCol({ leftPx, widthPx }: { leftPx: number; widthPx: number }) {
  const ref = useRef<HTMLDivElement>(null);
  useCssVarRef(ref, '--gantt-bar-x', `${leftPx}px`);
  useCssVarRef(ref, '--gantt-bar-w', `${widthPx}px`);
  return <div ref={ref} className="org-gantt__shade-col" />;
}
