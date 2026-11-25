import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import type { ThemeMode } from '../../app/App';
import {
  Badge,
  Button,
  Icon,
  Spinner,
  ViewSwitcher,
  type ViewSwitcherItem,
} from '../../components/ui';
import { useCssVarRef } from '../../components/ui/_internal/useCssVar';
import {
  apiClient,
  type ClientTaskListItemOut,
  type CompanyOut,
  type DepartmentOut,
  type EntityOut,
  type TaskListItemOut,
  type UserOut,
} from '../../lib/api/client';
import { AuthenticatedShell } from '../auth/AuthenticatedShell';
import { hasPerm, useAuthStore } from '../auth/authStore';
import { useProjectStore } from '../project/projectStore';
import { CreateTaskDialog } from './CreateTaskDialog';
import { DepartmentMatrixView } from './DepartmentMatrixView';
import { GanttView } from './GanttView';
import { GraphView } from './GraphView';
import { KanbanView } from './KanbanView';
import { ReviewQueueView } from './ReviewQueueView';
import { isFullTaskItem } from './taskHelpers';
import { TaskDetail } from './TaskDetail';
import { TaskFilterBar } from './TaskFilterBar';
import { TaskGridView } from './TaskGridView';
import { useTasksStore, type TasksWorkspaceView } from './tasksStore';
import { WorkloadView } from './WorkloadView';
import './TasksPage.css';

const EMPTY_DEPTS: DepartmentOut[] = [];
const EMPTY_USERS: UserOut[] = [];
const EMPTY_COMPANIES: CompanyOut[] = [];
const EMPTY_ENTITIES: EntityOut[] = [];

type AnyListItem = TaskListItemOut | ClientTaskListItemOut;

export function TasksPage({
  theme,
  onToggleTheme,
}: {
  theme: ThemeMode;
  onToggleTheme: () => void;
}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const auth = useAuthStore((s) => s.auth);
  const activeProjectUuid = useProjectStore((s) => s.activeProjectUuid);
  const isClient = auth?.user.role_name === 'client';

  const activeView = useTasksStore((s) => s.activeView);
  const setActiveView = useTasksStore((s) => s.setActiveView);
  const selectedTaskId = useTasksStore((s) => s.selectedTaskId);
  const setSelectedTaskId = useTasksStore((s) => s.setSelectedTaskId);
  const dockWidth = useTasksStore((s) => s.dockWidth);
  const setDockWidth = useTasksStore((s) => s.setDockWidth);
  const filters = useTasksStore((s) => s.filters);

  const [createOpen, setCreateOpen] = useState(false);
  const [extraItems, setExtraItems] = useState<AnyListItem[]>([]);
  const [extraCursor, setExtraCursor] = useState<string | null | undefined>(undefined);
  const [loadingMore, setLoadingMore] = useState(false);

  const dockRef = useRef<HTMLDivElement>(null);
  useCssVarRef(dockRef, '--tdock-w', `${dockWidth}px`);

  const canGantt = !isClient && hasPerm(auth?.permissions, 'views.gantt');
  const canWorkload = !isClient && hasPerm(auth?.permissions, 'views.workload');
  const canKanban = !isClient && hasPerm(auth?.permissions, 'views.kanban');
  const canGraph = !isClient && hasPerm(auth?.permissions, 'views.graph');
  const canReviewQueue =
    isClient ||
    hasPerm(auth?.permissions, 'task.approve.lead') ||
    hasPerm(auth?.permissions, 'task.approve.sup') ||
    hasPerm(auth?.permissions, 'task.approve.client') ||
    hasPerm(auth?.permissions, 'views.kanban');
  const canCreate = !isClient && hasPerm(auth?.permissions, 'task.create');

  const viewItems: ViewSwitcherItem[] = useMemo(() => {
    const list: ViewSwitcherItem[] = [{ id: 'grid', label: 'Grid' }];
    if (!isClient) list.push({ id: 'matrix', label: 'Matrix' });
    if (canGantt) list.push({ id: 'gantt', label: 'Gantt' });
    if (canWorkload) list.push({ id: 'workload', label: 'Workload' });
    if (canKanban) list.push({ id: 'kanban', label: 'Kanban' });
    if (canGraph) list.push({ id: 'graph', label: 'Graph' });
    if (canReviewQueue) list.push({ id: 'review', label: 'Review Queue' });
    return list;
  }, [isClient, canGantt, canWorkload, canKanban, canGraph, canReviewQueue]);

  useEffect(() => {
    if (!viewItems.some((v) => v.id === activeView)) {
      setActiveView('grid');
    }
  }, [viewItems, activeView, setActiveView]);

  const filterKey = useMemo(() => JSON.stringify(filters), [filters]);
  useEffect(() => {
    setExtraItems([]);
    setExtraCursor(undefined);
  }, [filterKey, activeProjectUuid]);

  const { data: tasksResp, isLoading: tasksLoading } = useQuery({
    queryKey: ['tasks', activeProjectUuid, filterKey],
    queryFn: () => apiClient.listTasks({ ...filters, limit: 200 }, activeProjectUuid),
    enabled: Boolean(activeProjectUuid),
  });

  const { data: deptsData } = useQuery({
    queryKey: ['departments', activeProjectUuid],
    queryFn: () => apiClient.listDepartments(activeProjectUuid),
    enabled: Boolean(activeProjectUuid),
  });
  const departments = deptsData ?? EMPTY_DEPTS;

  const { data: entitiesTree } = useQuery({
    queryKey: ['entities', activeProjectUuid],
    queryFn: () => apiClient.listEntities(activeProjectUuid),
    enabled: Boolean(activeProjectUuid),
  });
  const entities = entitiesTree?.entities ?? EMPTY_ENTITIES;

  const canViewUsers = !isClient && hasPerm(auth?.permissions, 'user.view');
  const { data: usersData } = useQuery({
    queryKey: ['users', activeProjectUuid],
    queryFn: () => apiClient.listUsers(activeProjectUuid),
    enabled: Boolean(activeProjectUuid && canViewUsers),
  });
  const users = usersData ?? EMPTY_USERS;

  const canViewCompanies =
    !isClient &&
    (hasPerm(auth?.permissions, 'user.view') || hasPerm(auth?.permissions, 'task.share_client'));
  const { data: companiesData } = useQuery({
    queryKey: ['companies', activeProjectUuid],
    queryFn: () => apiClient.listCompanies(activeProjectUuid),
    enabled: Boolean(activeProjectUuid && canViewCompanies),
  });
  const companies = companiesData ?? EMPTY_COMPANIES;

  const items: AnyListItem[] = useMemo(() => {
    const base = (tasksResp?.items ?? []) as AnyListItem[];
    return extraItems.length > 0 ? [...base, ...extraItems] : base;
  }, [tasksResp?.items, extraItems]);

  const fullItems = useMemo(
    () => items.filter((it): it is TaskListItemOut => isFullTaskItem(it)),
    [items],
  );

  const nextCursor = extraCursor !== undefined ? extraCursor : (tasksResp?.next_cursor ?? null);

  const handleLoadMore = async () => {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const more = await apiClient.listTasks(
        { ...filters, cursor: nextCursor, limit: 200 },
        activeProjectUuid,
      );
      setExtraItems((prev) => [...prev, ...(more.items as AnyListItem[])]);
      setExtraCursor(more.next_cursor ?? null);
    } finally {
      setLoadingMore(false);
    }
  };

  const startDockResize = (e: MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = dockWidth;
    const onMove = (ev: globalThis.MouseEvent) => {
      setDockWidth(startW + (startX - ev.clientX));
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  return (
    <AuthenticatedShell
      theme={theme}
      onToggleTheme={onToggleTheme}
      statusText={`Tasks (${tasksResp?.total ?? items.length})`}
    >
      <div className="org-tpage" data-ui="tasks-page">
        <div className="org-tpage__topbar">
          <ViewSwitcher
            items={viewItems}
            activeId={activeView}
            onChange={(id) => setActiveView(id as TasksWorkspaceView)}
          />
          <div className="org-tpage__top-actions">
            {isClient && <Badge tone="info">Shared Client View</Badge>}
            {canCreate && (
              <Button size="sm" variant="primary" onClick={() => setCreateOpen(true)}>
                <Icon name="plus" size="sm" /> New Task
              </Button>
            )}
          </div>
        </div>

        <TaskFilterBar
          departments={departments}
          users={users}
          companies={companies}
          isClient={isClient}
          activeView={activeView}
        />

        <div className="org-tpage__body">
          <div className="org-tpage__main">
            {tasksLoading ? (
              <div className="org-tpage__loading">
                <Spinner label="Loading tasks" />
              </div>
            ) : activeView === 'grid' ? (
              <TaskGridView
                tasks={items}
                total={tasksResp?.total ?? items.length}
                hasMore={Boolean(nextCursor)}
                loadingMore={loadingMore}
                onLoadMore={() => void handleLoadMore()}
                selectedTaskId={selectedTaskId}
                onSelectTask={(id) => setSelectedTaskId(id, true)}
                isClient={isClient}
              />
            ) : activeView === 'matrix' && !isClient ? (
              <DepartmentMatrixView
                tasks={fullItems}
                entities={entities}
                departments={departments}
                users={users}
                selectedTaskId={selectedTaskId}
                onSelectTask={(id) => setSelectedTaskId(id, true)}
              />
            ) : activeView === 'gantt' && canGantt ? (
              <GanttView
                tasks={fullItems}
                users={users}
                companies={companies}
                selectedTaskId={selectedTaskId}
                onSelectTask={(id) => setSelectedTaskId(id, true)}
              />
            ) : activeView === 'workload' && canWorkload ? (
              <WorkloadView
                tasks={fullItems}
                users={users}
                companies={companies}
                departments={departments}
                selectedTaskId={selectedTaskId}
                onSelectTask={(id) => setSelectedTaskId(id, true)}
              />
            ) : activeView === 'kanban' && canKanban ? (
              <KanbanView
                tasks={fullItems}
                selectedTaskId={selectedTaskId}
                onSelectTask={(id) => setSelectedTaskId(id, true)}
              />
            ) : activeView === 'graph' && canGraph ? (
              <GraphView
                entities={entities}
                departments={departments}
                selectedTaskId={selectedTaskId}
                onSelectTask={(id) => setSelectedTaskId(id, true)}
              />
            ) : (
              <ReviewQueueView
                searchQuery={filters.q ?? ''}
                selectedTaskId={selectedTaskId}
                onSelectTask={(id) => setSelectedTaskId(id, true)}
                onOpenInViewer={({ taskId, fileId }) => {
                  const qs = new URLSearchParams({ task: taskId });
                  if (fileId) qs.set('file', fileId);
                  navigate(`/viewer?${qs.toString()}`);
                }}
              />
            )}
          </div>

          {/* The task panel always docks on the right for any selected task, in every view. */}
          {selectedTaskId && (
            <div ref={dockRef} className="org-tpage__dock" data-ui="task-detail-dock">
              <div
                role="separator"
                aria-orientation="vertical"
                aria-label="Resize task detail dock"
                className="org-tpage__dock-resizer"
                onMouseDown={startDockResize}
              />
              <div className="org-tpage__dock-inner">
                <TaskDetail
                  taskId={selectedTaskId}
                  onClose={() => setSelectedTaskId(null)}
                  onSelectTask={(id) => setSelectedTaskId(id, true)}
                  onOpenInViewer={({ taskId, fileId, frame }) => {
                    const qs = new URLSearchParams({ task: taskId });
                    if (fileId) qs.set('file', fileId);
                    if (frame !== null && frame !== undefined) qs.set('frame', String(frame));
                    navigate(`/viewer?${qs.toString()}`);
                  }}
                />
              </div>
            </div>
          )}
        </div>

        <CreateTaskDialog
          open={createOpen}
          onOpenChange={setCreateOpen}
          entities={entities}
          departments={departments}
          onCreated={(tid) => {
            setSelectedTaskId(tid, true);
            void queryClient.invalidateQueries({ queryKey: ['tasks', activeProjectUuid] });
          }}
        />
      </div>
    </AuthenticatedShell>
  );
}
