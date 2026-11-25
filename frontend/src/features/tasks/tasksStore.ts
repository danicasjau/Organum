import { create } from 'zustand';
import type { TaskBulkRowIn, TaskListQuery } from '../../lib/api/client';

export type TasksWorkspaceView =
  | 'gantt'
  | 'matrix'
  | 'grid'
  | 'workload'
  | 'kanban'
  | 'graph'
  | 'review';
export type MatrixGroupBy = 'path' | 'type';
export type KanbanSwimlane = 'none' | 'department' | 'assignee';
export type GanttGroupBy =
  | 'entity_path'
  | 'department'
  | 'user'
  | 'company'
  | 'status'
  | 'priority'
  | 'none';
export type GanttZoom = 'day' | 'week' | 'month';
export type WorkloadZoom = 'days' | 'weeks';
export type WorkloadGroupBy = 'none' | 'department' | 'company';
export type GraphMode = 'task' | 'entity';
export type GraphScope = 'all' | 'entity' | 'department';

export interface GanttPatchItem {
  taskId: string;
  prevStart: string | null;
  prevFinish: string | null;
  nextStart: string | null;
  nextFinish: string | null;
  updatedAt?: string;
}

export interface GanttUndoAction {
  label: string;
  patches: GanttPatchItem[];
}

const DOCK_WIDTH_KEY = 'organum.taskDockWidth';

function readInitialDockWidth(): number {
  if (typeof localStorage === 'undefined') return 380;
  const parsed = Number(localStorage.getItem(DOCK_WIDTH_KEY));
  return Number.isFinite(parsed) && parsed >= 300 && parsed <= 640 ? parsed : 380;
}

export interface TasksStoreState {
  activeView: TasksWorkspaceView;
  selectedTaskId: string | null;
  dockOpen: boolean;
  dockWidth: number;
  filters: TaskListQuery;
  hiddenGridCols: string[];
  hiddenMatrixDeptIds: string[];
  hiddenMatrixEntityIds: string[];
  expandedMatrixDeptIds: string[];
  matrixGroupBy: MatrixGroupBy;
  kanbanSwimlane: KanbanSwimlane;
  matrixUndoStack: TaskBulkRowIn[][];
  ganttGroupBy: GanttGroupBy;
  ganttZoom: GanttZoom;
  ganttShowLinks: boolean;
  ganttPushDependents: boolean;
  ganttCollapsedGroups: string[];
  ganttUndoStack: GanttUndoAction[];
  ganttRedoStack: GanttUndoAction[];
  workloadGroupBy: WorkloadGroupBy;
  workloadZoom: WorkloadZoom;
  graphMode: GraphMode;
  graphHops: number;
  graphScope: GraphScope;
  graphScopeId: string;
  graphFocusTaskId: string | null;
  graphFocusEntityId: string | null;

  setActiveView: (view: TasksWorkspaceView) => void;
  setSelectedTaskId: (taskId: string | null, openDock?: boolean) => void;
  setDockOpen: (open: boolean) => void;
  setDockWidth: (width: number) => void;
  setFilters: (patch: Partial<TaskListQuery>) => void;
  resetFilters: () => void;
  applyViewConfig: (cfg: Record<string, unknown>) => void;
  setHiddenGridCols: (cols: string[]) => void;
  setHiddenMatrixDeptIds: (ids: string[]) => void;
  setHiddenMatrixEntityIds: (ids: string[]) => void;
  toggleExpandedMatrixDept: (deptId: string) => void;
  setMatrixGroupBy: (groupBy: MatrixGroupBy) => void;
  setKanbanSwimlane: (swimlane: KanbanSwimlane) => void;
  pushMatrixUndo: (rows: TaskBulkRowIn[]) => void;
  popMatrixUndo: () => TaskBulkRowIn[] | undefined;
  setGanttGroupBy: (groupBy: GanttGroupBy) => void;
  setGanttZoom: (zoom: GanttZoom) => void;
  setGanttShowLinks: (show: boolean) => void;
  setGanttPushDependents: (push: boolean) => void;
  toggleGanttGroupCollapsed: (key: string) => void;
  pushGanttUndo: (action: GanttUndoAction) => void;
  popGanttUndo: () => GanttUndoAction | undefined;
  pushGanttRedo: (action: GanttUndoAction) => void;
  popGanttRedo: () => GanttUndoAction | undefined;
  setWorkloadGroupBy: (groupBy: WorkloadGroupBy) => void;
  setWorkloadZoom: (zoom: WorkloadZoom) => void;
  setGraphMode: (mode: GraphMode) => void;
  setGraphHops: (hops: number) => void;
  setGraphScope: (scope: GraphScope, scopeId?: string) => void;
  setGraphFocusTaskId: (taskId: string | null) => void;
  setGraphFocusEntityId: (entityId: string | null) => void;
}

const DEFAULT_FILTERS: TaskListQuery = {
  sort: 'updated',
};

export const useTasksStore = create<TasksStoreState>((set, get) => ({
  activeView: 'grid',
  selectedTaskId: null,
  dockOpen: false,
  dockWidth: readInitialDockWidth(),
  filters: { ...DEFAULT_FILTERS },
  hiddenGridCols: ['folder_name', 'parent_entity_type', 'complexity_rating', 'retake_count'],
  hiddenMatrixDeptIds: [],
  hiddenMatrixEntityIds: [],
  expandedMatrixDeptIds: [],
  matrixGroupBy: 'path',
  kanbanSwimlane: 'none',
  matrixUndoStack: [],
  ganttGroupBy: 'entity_path',
  ganttZoom: 'day',
  ganttShowLinks: true,
  ganttPushDependents: false,
  ganttCollapsedGroups: [],
  ganttUndoStack: [],
  ganttRedoStack: [],
  workloadGroupBy: 'none',
  workloadZoom: 'days',
  graphMode: 'task',
  graphHops: 2,
  graphScope: 'all',
  graphScopeId: '',
  graphFocusTaskId: null,
  graphFocusEntityId: null,

  setActiveView: (activeView) => set({ activeView }),
  setSelectedTaskId: (selectedTaskId, openDock = true) =>
    set((s) => ({
      selectedTaskId,
      dockOpen: selectedTaskId ? (openDock ? true : s.dockOpen) : false,
    })),
  setDockOpen: (dockOpen) => set({ dockOpen }),
  setDockWidth: (width) => {
    const clamped = Math.max(300, Math.min(640, Math.round(width)));
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(DOCK_WIDTH_KEY, String(clamped));
    }
    set({ dockWidth: clamped });
  },
  setFilters: (patch) =>
    set((s) => ({
      filters: { ...s.filters, ...patch },
    })),
  resetFilters: () => set({ filters: { ...DEFAULT_FILTERS } }),
  applyViewConfig: (cfg) =>
    set((s) => ({
      filters:
        cfg.filters && typeof cfg.filters === 'object'
          ? { ...DEFAULT_FILTERS, ...(cfg.filters as TaskListQuery) }
          : s.filters,
      hiddenGridCols: Array.isArray(cfg.hiddenGridCols)
        ? (cfg.hiddenGridCols as string[])
        : s.hiddenGridCols,
      hiddenMatrixDeptIds: Array.isArray(cfg.hiddenMatrixDeptIds)
        ? (cfg.hiddenMatrixDeptIds as string[])
        : s.hiddenMatrixDeptIds,
      hiddenMatrixEntityIds: Array.isArray(cfg.hiddenMatrixEntityIds)
        ? (cfg.hiddenMatrixEntityIds as string[])
        : s.hiddenMatrixEntityIds,
      expandedMatrixDeptIds: Array.isArray(cfg.expandedMatrixDeptIds)
        ? (cfg.expandedMatrixDeptIds as string[])
        : s.expandedMatrixDeptIds,
      matrixGroupBy: cfg.matrixGroupBy === 'type' ? 'type' : s.matrixGroupBy,
      kanbanSwimlane:
        cfg.kanbanSwimlane === 'department' || cfg.kanbanSwimlane === 'assignee'
          ? cfg.kanbanSwimlane
          : s.kanbanSwimlane,
    })),
  setHiddenGridCols: (hiddenGridCols) => set({ hiddenGridCols }),
  setHiddenMatrixDeptIds: (hiddenMatrixDeptIds) => set({ hiddenMatrixDeptIds }),
  setHiddenMatrixEntityIds: (hiddenMatrixEntityIds) => set({ hiddenMatrixEntityIds }),
  toggleExpandedMatrixDept: (deptId) =>
    set((s) => ({
      expandedMatrixDeptIds: s.expandedMatrixDeptIds.includes(deptId)
        ? s.expandedMatrixDeptIds.filter((x) => x !== deptId)
        : [...s.expandedMatrixDeptIds, deptId],
    })),
  setMatrixGroupBy: (matrixGroupBy) => set({ matrixGroupBy }),
  setKanbanSwimlane: (kanbanSwimlane) => set({ kanbanSwimlane }),
  pushMatrixUndo: (rows) =>
    set((s) => ({
      matrixUndoStack: [...s.matrixUndoStack.slice(-19), rows],
    })),
  popMatrixUndo: () => {
    const stack = get().matrixUndoStack;
    if (stack.length === 0) return undefined;
    const top = stack[stack.length - 1];
    set({ matrixUndoStack: stack.slice(0, -1) });
    return top;
  },
  setGanttGroupBy: (ganttGroupBy) => set({ ganttGroupBy }),
  setGanttZoom: (ganttZoom) => set({ ganttZoom }),
  setGanttShowLinks: (ganttShowLinks) => set({ ganttShowLinks }),
  setGanttPushDependents: (ganttPushDependents) => set({ ganttPushDependents }),
  toggleGanttGroupCollapsed: (key) =>
    set((s) => ({
      ganttCollapsedGroups: s.ganttCollapsedGroups.includes(key)
        ? s.ganttCollapsedGroups.filter((k) => k !== key)
        : [...s.ganttCollapsedGroups, key],
    })),
  pushGanttUndo: (action) =>
    set((s) => ({
      ganttUndoStack: [...s.ganttUndoStack.slice(-24), action],
      ganttRedoStack: [],
    })),
  popGanttUndo: () => {
    const stack = get().ganttUndoStack;
    if (stack.length === 0) return undefined;
    const top = stack[stack.length - 1];
    set({ ganttUndoStack: stack.slice(0, -1) });
    return top;
  },
  pushGanttRedo: (action) =>
    set((s) => ({
      ganttRedoStack: [...s.ganttRedoStack.slice(-24), action],
    })),
  popGanttRedo: () => {
    const stack = get().ganttRedoStack;
    if (stack.length === 0) return undefined;
    const top = stack[stack.length - 1];
    set({ ganttRedoStack: stack.slice(0, -1) });
    return top;
  },
  setWorkloadGroupBy: (workloadGroupBy) => set({ workloadGroupBy }),
  setWorkloadZoom: (workloadZoom) => set({ workloadZoom }),
  setGraphMode: (graphMode) => set({ graphMode }),
  setGraphHops: (graphHops) => set({ graphHops: Math.max(1, Math.min(3, graphHops)) }),
  setGraphScope: (graphScope, scopeId) =>
    set((s) => ({
      graphScope,
      graphScopeId: scopeId !== undefined ? scopeId : s.graphScopeId,
    })),
  setGraphFocusTaskId: (graphFocusTaskId) => set({ graphFocusTaskId }),
  setGraphFocusEntityId: (graphFocusEntityId) => set({ graphFocusEntityId }),
}));

