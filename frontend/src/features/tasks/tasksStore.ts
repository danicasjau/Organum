import { create } from 'zustand';
import type { TaskBulkRowIn, TaskListQuery } from '../../lib/api/client';

export type TasksWorkspaceView = 'grid' | 'matrix' | 'kanban' | 'review';
export type MatrixGroupBy = 'path' | 'type';
export type KanbanSwimlane = 'none' | 'department' | 'assignee';

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
}));

