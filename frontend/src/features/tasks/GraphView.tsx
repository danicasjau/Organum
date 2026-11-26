import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type WheelEvent as ReactWheelEvent,
} from 'react';
import {
  Avatar,
  Badge,
  Banner,
  Button,
  Icon,
  SearchField,
  Select,
  Spinner,
  StatusChip,
  Text,
  useToast,
} from '../../components/ui';
import { useCssVarRef } from '../../components/ui/_internal/useCssVar';
import {
  apiClient,
  type DepartmentOut,
  type EntityGraphEdgeOut,
  type EntityGraphNodeOut,
  type EntityOut,
  type TaskGraphEdgeOut,
  type TaskGraphNodeOut,
} from '../../lib/api/client';
import { hasPerm, useAuthStore } from '../auth/authStore';
import { useProjectStore } from '../project/projectStore';
import { computeIndirectEntityEdges, computeLayeredDagLayout } from './planningHelpers';
import { useTasksStore, type GraphMode, type GraphScope } from './tasksStore';
import './GraphView.css';
import { DepartmentTag } from '../departments/DepartmentTag';
import { TaskUnreadDot } from '../reviews/TaskUnreadDot';

const NODE_W = 160;
const NODE_H = 54;
const toDepThreshold = (t: string): 'APP' | 'PUBLISHED' | 'ANY_STATUS' =>
  t === 'PUBLISHED' || t === 'ANY_STATUS' ? t : 'APP';
const EMPTY_TASK_NODES: TaskGraphNodeOut[] = [];
const EMPTY_TASK_EDGES: TaskGraphEdgeOut[] = [];
const EMPTY_ENT_NODES: EntityGraphNodeOut[] = [];
const EMPTY_ENT_EDGES: EntityGraphEdgeOut[] = [];

type SelectedEdgeState =
  | { mode: 'task'; sourceId: string; targetId: string; kind: 'dependency' | 'link' }
  | { mode: 'entity'; edgeId: string; label: string };

interface ConnectDragState {
  sourceId: string;
  startX: number;
  startY: number;
  curX: number;
  curY: number;
}

interface MarqueeState {
  startX: number;
  startY: number;
  curX: number;
  curY: number;
}

export function GraphView({
  entities,
  departments,
  selectedTaskId,
  onSelectTask,
}: {
  entities: ReadonlyArray<EntityOut>;
  departments: ReadonlyArray<DepartmentOut>;
  selectedTaskId: string | null;
  onSelectTask: (taskId: string) => void;
}) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const auth = useAuthStore((s) => s.auth);
  const activeProjectUuid = useProjectStore((s) => s.activeProjectUuid);

  const graphMode = useTasksStore((s) => s.graphMode);
  const setGraphMode = useTasksStore((s) => s.setGraphMode);
  const graphHops = useTasksStore((s) => s.graphHops);
  const setGraphHops = useTasksStore((s) => s.setGraphHops);
  const graphScope = useTasksStore((s) => s.graphScope);
  const graphScopeId = useTasksStore((s) => s.graphScopeId);
  const setGraphScope = useTasksStore((s) => s.setGraphScope);
  const graphFocusTaskId = useTasksStore((s) => s.graphFocusTaskId);
  const setGraphFocusTaskId = useTasksStore((s) => s.setGraphFocusTaskId);
  const graphFocusEntityId = useTasksStore((s) => s.graphFocusEntityId);
  const setGraphFocusEntityId = useTasksStore((s) => s.setGraphFocusEntityId);

  const canEditTaskDeps = hasPerm(auth?.permissions, 'task.dependencies');
  const canEditEntityLinks = hasPerm(auth?.permissions, 'entity.link');

  const [searchQuery, setSearchQuery] = useState('');
  const [panX, setPanX] = useState(24);
  const [panY, setPanY] = useState(24);
  const [zoom, setZoom] = useState(1);
  const [nodeOverrides, setNodeOverrides] = useState<Record<string, { x: number; y: number }>>({});
  const [selectedNodeIds, setSelectedNodeIds] = useState<Set<string>>(() => new Set());
  const [selectedEdge, setSelectedEdge] = useState<SelectedEdgeState | null>(null);
  const [connectDrag, setConnectDrag] = useState<ConnectDragState | null>(null);
  const [marquee, setMarquee] = useState<MarqueeState | null>(null);
  const [bannerError, setBannerError] = useState<string | null>(null);
  const [busyEdge, setBusyEdge] = useState(false);

  const viewportRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const marqueeRectRef = useRef<HTMLDivElement>(null);

  const taskQueryParams = useMemo(() => {
    const q: {
      task_id?: string;
      entity_id?: string;
      department_id?: string;
      hops?: number;
      limit: number;
    } = { limit: 500, hops: graphHops };
    if (graphFocusTaskId) {
      q.task_id = graphFocusTaskId;
    } else if (graphScope === 'entity' && graphScopeId) {
      q.entity_id = graphScopeId;
    } else if (graphScope === 'department' && graphScopeId) {
      q.department_id = graphScopeId;
    }
    return q;
  }, [graphFocusTaskId, graphScope, graphScopeId, graphHops]);

  const { data: taskGraph, isLoading: taskLoading } = useQuery({
    queryKey: ['task-graph', activeProjectUuid, taskQueryParams],
    queryFn: () => apiClient.getTaskGraph(taskQueryParams, activeProjectUuid),
    enabled: Boolean(activeProjectUuid && graphMode === 'task'),
  });

  const { data: entityGraph, isLoading: entityLoading } = useQuery({
    queryKey: ['entity-links-graph', activeProjectUuid, graphFocusEntityId, graphHops],
    queryFn: () =>
      apiClient.getEntityLinksGraph(
        graphFocusEntityId
          ? { entity_id: graphFocusEntityId, hops: graphHops, limit: 500 }
          : { limit: 500 },
        activeProjectUuid,
      ),
    enabled: Boolean(activeProjectUuid && graphMode === 'entity'),
  });

  const taskNodes = taskGraph?.nodes ?? EMPTY_TASK_NODES;
  const taskEdges = taskGraph?.edges ?? EMPTY_TASK_EDGES;
  const entityNodes = entityGraph?.nodes ?? EMPTY_ENT_NODES;
  const entityEdges = entityGraph?.edges ?? EMPTY_ENT_EDGES;

  const indirectEntityEdges = useMemo(
    () => (graphMode === 'entity' ? computeIndirectEntityEdges(entityNodes, entityEdges) : []),
    [graphMode, entityNodes, entityEdges],
  );

  const dagLayout = useMemo(() => {
    if (graphMode === 'task') {
      return computeLayeredDagLayout(
        taskNodes.map((n) => n.id),
        taskEdges.map((e) => ({ source: e.source_task_id, target: e.target_task_id })),
        { nodeWidth: NODE_W, nodeHeight: NODE_H },
      );
    }
    return computeLayeredDagLayout(
      entityNodes.map((n) => n.id),
      entityEdges.map((e) => ({ source: e.source_entity_id, target: e.target_entity_id })),
      { nodeWidth: NODE_W, nodeHeight: NODE_H },
    );
  }, [graphMode, taskNodes, taskEdges, entityNodes, entityEdges]);

  const posOf = useCallback(
    (id: string): { x: number; y: number } => {
      return nodeOverrides[id] ?? dagLayout.positions.get(id) ?? { x: 40, y: 40 };
    },
    [nodeOverrides, dagLayout],
  );

  useEffect(() => {
    setNodeOverrides({});
    setSelectedEdge(null);
    setSelectedNodeIds(new Set());
  }, [graphMode, graphScope, graphScopeId, graphFocusTaskId, graphFocusEntityId]);

  const toCanvasCoords = useCallback(
    (clientX: number, clientY: number) => {
      const rect = viewportRef.current?.getBoundingClientRect();
      if (!rect) return { x: 0, y: 0 };
      return {
        x: (clientX - rect.left - panX) / zoom,
        y: (clientY - rect.top - panY) / zoom,
      };
    },
    [panX, panY, zoom],
  );

  const handleStageMouseDown = (e: ReactMouseEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest('[data-graph-node], [data-graph-edge]')) return;

    if (e.shiftKey) {
      const pt = toCanvasCoords(e.clientX, e.clientY);
      const startState: MarqueeState = {
        startX: pt.x,
        startY: pt.y,
        curX: pt.x,
        curY: pt.y,
      };
      setMarquee(startState);
      let latest = startState;
      const onMove = (ev: globalThis.MouseEvent) => {
        const cur = toCanvasCoords(ev.clientX, ev.clientY);
        latest = { ...startState, curX: cur.x, curY: cur.y };
        setMarquee(latest);
      };
      const onUp = () => {
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
        const minX = Math.min(latest.startX, latest.curX);
        const maxX = Math.max(latest.startX, latest.curX);
        const minY = Math.min(latest.startY, latest.curY);
        const maxY = Math.max(latest.startY, latest.curY);
        const ids = new Set<string>();
        const nodeIds =
          graphMode === 'task' ? taskNodes.map((n) => n.id) : entityNodes.map((n) => n.id);
        for (const id of nodeIds) {
          const p = posOf(id);
          if (p.x + NODE_W >= minX && p.x <= maxX && p.y + NODE_H >= minY && p.y <= maxY) {
            ids.add(id);
          }
        }
        setSelectedNodeIds(ids);
        setMarquee(null);
      };
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
      return;
    }

    setSelectedEdge(null);
    const startClientX = e.clientX;
    const startClientY = e.clientY;
    const origPanX = panX;
    const origPanY = panY;
    const onMove = (ev: globalThis.MouseEvent) => {
      setPanX(origPanX + (ev.clientX - startClientX));
      setPanY(origPanY + (ev.clientY - startClientY));
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  const handleWheel = (e: ReactWheelEvent<HTMLDivElement>) => {
    const factor = e.deltaY < 0 ? 1.1 : 0.9;
    setZoom((z) => Math.max(0.35, Math.min(2, Math.round(z * factor * 100) / 100)));
  };

  const beginNodeDrag = (e: ReactMouseEvent, nodeId: string) => {
    e.stopPropagation();
    if (e.button !== 0) return;
    if (graphMode === 'task') onSelectTask(nodeId);
    setSelectedNodeIds((prev) => {
      if (e.shiftKey) {
        const next = new Set(prev);
        if (next.has(nodeId)) next.delete(nodeId);
        else next.add(nodeId);
        return next;
      }
      return new Set([nodeId]);
    });

    const startClientX = e.clientX;
    const startClientY = e.clientY;
    const origPos = posOf(nodeId);
    const onMove = (ev: globalThis.MouseEvent) => {
      const dx = (ev.clientX - startClientX) / zoom;
      const dy = (ev.clientY - startClientY) / zoom;
      if (Math.abs(dx) < 3 && Math.abs(dy) < 3) return;
      setNodeOverrides((prev) => ({
        ...prev,
        [nodeId]: {
          x: Math.round(origPos.x + dx),
          y: Math.round(origPos.y + dy),
        },
      }));
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  const createEdge = useCallback(
    async (sourceId: string, targetId: string) => {
      if (sourceId === targetId) return;
      setBannerError(null);
      setBusyEdge(true);
      try {
        if (graphMode === 'task') {
          if (!canEditTaskDeps) {
            toast.push('warning', 'Missing task.dependencies permission');
            return;
          }
          const detail = await apiClient.getTask(targetId, activeProjectUuid);
          const existing =
            'dependencies' in detail
              ? (detail.dependencies ?? []).map((d) => ({
                  upstream_task_id: d.upstream_task_id,
                  threshold: toDepThreshold(d.threshold),
                  from_entity_link: d.from_entity_link,
                }))
              : [];
          if (existing.some((d) => d.upstream_task_id === sourceId)) {
            toast.push('info', 'Dependency already exists');
            return;
          }
          await apiClient.putTaskDependencies(
            targetId,
            [
              ...existing,
              { upstream_task_id: sourceId, threshold: 'APP', from_entity_link: false },
            ],
            activeProjectUuid,
          );
          await Promise.all([
            queryClient.invalidateQueries({ queryKey: ['task-graph', activeProjectUuid] }),
            queryClient.invalidateQueries({ queryKey: ['task', activeProjectUuid, targetId] }),
            queryClient.invalidateQueries({ queryKey: ['tasks', activeProjectUuid] }),
          ]);
          toast.push('success', 'Created task dependency');
        } else {
          if (!canEditEntityLinks) {
            toast.push('warning', 'Missing entity.link permission');
            return;
          }
          await apiClient.createEntityLink(
            {
              source_entity_id: sourceId,
              target_entity_id: targetId,
              link_type: 'uses',
            },
            activeProjectUuid,
          );
          await Promise.all([
            queryClient.invalidateQueries({ queryKey: ['entity-links-graph', activeProjectUuid] }),
            queryClient.invalidateQueries({ queryKey: ['entity-links', activeProjectUuid] }),
          ]);
          toast.push('success', 'Created entity link');
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Edge creation rejected';
        setBannerError(msg);
        toast.push('danger', msg);
      } finally {
        setBusyEdge(false);
      }
    },
    [graphMode, canEditTaskDeps, canEditEntityLinks, activeProjectUuid, queryClient, toast],
  );

  const beginPortConnect = (e: ReactMouseEvent, sourceId: string) => {
    e.stopPropagation();
    if (e.button !== 0) return;
    const pos = posOf(sourceId);
    const startPt = { x: pos.x + NODE_W, y: pos.y + NODE_H / 2 };
    const init: ConnectDragState = {
      sourceId,
      startX: startPt.x,
      startY: startPt.y,
      curX: startPt.x,
      curY: startPt.y,
    };
    setConnectDrag(init);

    const onMove = (ev: globalThis.MouseEvent) => {
      const pt = toCanvasCoords(ev.clientX, ev.clientY);
      setConnectDrag({ ...init, curX: pt.x, curY: pt.y });
    };
    const onUp = (ev: globalThis.MouseEvent) => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      setConnectDrag(null);
      const targetEl = document
        .elementFromPoint(ev.clientX, ev.clientY)
        ?.closest<HTMLElement>('[data-graph-node]');
      const targetId = targetEl?.dataset.graphNode;
      if (targetId && targetId !== sourceId) {
        void createEdge(sourceId, targetId);
      }
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  const handleDeleteSelectedEdge = useCallback(async () => {
    if (!selectedEdge || busyEdge) return;
    setBannerError(null);
    setBusyEdge(true);
    try {
      if (selectedEdge.mode === 'task') {
        if (selectedEdge.kind !== 'dependency') {
          toast.push('warning', 'Related links are removed from Task Detail');
          return;
        }
        if (!canEditTaskDeps) {
          toast.push('warning', 'Missing task.dependencies permission');
          return;
        }
        const detail = await apiClient.getTask(selectedEdge.targetId, activeProjectUuid);
        const existing =
          'dependencies' in detail
            ? (detail.dependencies ?? [])
                .filter((d) => d.upstream_task_id !== selectedEdge.sourceId)
                .map((d) => ({
                  upstream_task_id: d.upstream_task_id,
                  threshold: toDepThreshold(d.threshold),
                  from_entity_link: d.from_entity_link,
                }))
            : [];
        await apiClient.putTaskDependencies(selectedEdge.targetId, existing, activeProjectUuid);
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: ['task-graph', activeProjectUuid] }),
          queryClient.invalidateQueries({
            queryKey: ['task', activeProjectUuid, selectedEdge.targetId],
          }),
          queryClient.invalidateQueries({ queryKey: ['tasks', activeProjectUuid] }),
        ]);
        toast.push('success', 'Removed task dependency');
      } else {
        if (!canEditEntityLinks) {
          toast.push('warning', 'Missing entity.link permission');
          return;
        }
        await apiClient.deleteEntityLink(selectedEdge.edgeId, activeProjectUuid);
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: ['entity-links-graph', activeProjectUuid] }),
          queryClient.invalidateQueries({ queryKey: ['entity-links', activeProjectUuid] }),
        ]);
        toast.push('success', 'Removed entity link');
      }
      setSelectedEdge(null);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to remove edge';
      setBannerError(msg);
      toast.push('danger', msg);
    } finally {
      setBusyEdge(false);
    }
  }, [
    selectedEdge,
    busyEdge,
    canEditTaskDeps,
    canEditEntityLinks,
    activeProjectUuid,
    queryClient,
    toast,
  ]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedEdge) {
        const target = e.target as HTMLElement | null;
        if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;
        e.preventDefault();
        void handleDeleteSelectedEdge();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [selectedEdge, handleDeleteSelectedEdge]);

  const jumpToSearch = (q: string) => {
    const norm = q.trim().toLowerCase();
    if (!norm) return;
    let matchId: string | undefined;
    if (graphMode === 'task') {
      matchId = taskNodes.find(
        (n) =>
          n.task_code.toLowerCase().includes(norm) ||
          n.task_name.toLowerCase().includes(norm) ||
          n.entity_name.toLowerCase().includes(norm),
      )?.id;
    } else {
      matchId = entityNodes.find((n) => n.name.toLowerCase().includes(norm))?.id;
    }
    if (!matchId) return;
    const p = posOf(matchId);
    const vp = viewportRef.current;
    if (vp) {
      setPanX(Math.round(vp.clientWidth / 2 - (p.x + NODE_W / 2) * zoom));
      setPanY(Math.round(vp.clientHeight / 2 - (p.y + NODE_H / 2) * zoom));
    }
    setSelectedNodeIds(new Set([matchId]));
    if (graphMode === 'task') onSelectTask(matchId);
  };

  useCssVarRef(stageRef, '--gv-tx', `${panX}px`);
  useCssVarRef(stageRef, '--gv-ty', `${panY}px`);
  useCssVarRef(stageRef, '--gv-scale', String(zoom));
  useCssVarRef(stageRef, '--gv-w', `${dagLayout.width}px`);
  useCssVarRef(stageRef, '--gv-h', `${dagLayout.height}px`);

  const mRect = marquee
    ? {
        x: Math.min(marquee.startX, marquee.curX),
        y: Math.min(marquee.startY, marquee.curY),
        w: Math.abs(marquee.curX - marquee.startX),
        h: Math.abs(marquee.curY - marquee.startY),
      }
    : null;
  useCssVarRef(marqueeRectRef, '--gv-mx', `${mRect?.x ?? 0}px`);
  useCssVarRef(marqueeRectRef, '--gv-my', `${mRect?.y ?? 0}px`);
  useCssVarRef(marqueeRectRef, '--gv-mw', `${mRect?.w ?? 0}px`);
  useCssVarRef(marqueeRectRef, '--gv-mh', `${mRect?.h ?? 0}px`);

  const truncated =
    graphMode === 'task' ? Boolean(taskGraph?.truncated) : Boolean(entityGraph?.truncated);
  const loading = graphMode === 'task' ? taskLoading : entityLoading;
  const activeCount = graphMode === 'task' ? taskNodes.length : entityNodes.length;

  return (
    <div className="org-graph" data-ui="graph-view">
      <div className="org-graph__toolbar">
        <div className="org-graph__controls">
          <div className="org-graph__seg" role="group" aria-label="Graph mode">
            {(['task', 'entity'] as GraphMode[]).map((m) => (
              <Button
                key={m}
                size="sm"
                variant={graphMode === m ? 'primary' : 'ghost'}
                onClick={() => setGraphMode(m)}
              >
                {m === 'task' ? 'Task Mode' : 'Entity Mode'}
              </Button>
            ))}
          </div>

          {graphMode === 'task' && (
            <>
              <Select
                ariaLabel="Task graph scope"
                value={graphScope}
                onChange={(v) => {
                  setGraphFocusTaskId(null);
                  setGraphScope(v as GraphScope, '');
                }}
                options={[
                  { value: 'all', label: 'Scope: All' },
                  { value: 'entity', label: 'Scope: Entity' },
                  { value: 'department', label: 'Scope: Dept' },
                ]}
              />
              {graphScope === 'entity' && (
                <Select
                  ariaLabel="Scope entity"
                  value={graphScopeId}
                  onChange={(v) => setGraphScope('entity', v)}
                  options={[
                    { value: '', label: 'Select entity…' },
                    ...entities.map((e) => ({ value: e.id, label: e.rel_path || e.name })),
                  ]}
                />
              )}
              {graphScope === 'department' && (
                <Select
                  ariaLabel="Scope department"
                  value={graphScopeId}
                  onChange={(v) => setGraphScope('department', v)}
                  options={[
                    { value: '', label: 'Select dept…' },
                    ...departments.map((d) => ({ value: d.id, label: d.name })),
                  ]}
                />
              )}
              {graphFocusTaskId && (
                <Button size="sm" onClick={() => setGraphFocusTaskId(null)}>
                  Clear task focus
                </Button>
              )}
            </>
          )}

          {graphMode === 'entity' && graphFocusEntityId && (
            <Button size="sm" onClick={() => setGraphFocusEntityId(null)}>
              All entities
            </Button>
          )}

          <Select
            ariaLabel="Graph hops"
            value={String(graphHops)}
            onChange={(v) => setGraphHops(Number(v))}
            options={[
              { value: '1', label: '1 hop' },
              { value: '2', label: '2 hops' },
              { value: '3', label: '3 hops' },
            ]}
          />

          <SearchField
            ariaLabel="Jump to graph node"
            placeholder="Find node…"
            value={searchQuery}
            onChange={(val) => {
              setSearchQuery(val);
              jumpToSearch(val);
            }}
          />
        </div>

        <div className="org-graph__controls">
          {selectedEdge && (
            <Button
              size="sm"
              variant="danger"
              disabled={busyEdge}
              onClick={() => void handleDeleteSelectedEdge()}
            >
              Remove edge
            </Button>
          )}
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setZoom((z) => Math.max(0.4, Math.round((z - 0.15) * 100) / 100))}
          >
            -
          </Button>
          <Text size="sm" variant="mono">
            {Math.round(zoom * 100)}%
          </Text>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setZoom((z) => Math.min(2, Math.round((z + 0.15) * 100) / 100))}
          >
            +
          </Button>
          <Button
            size="sm"
            onClick={() => {
              setNodeOverrides({});
              setPanX(24);
              setPanY(24);
              setZoom(1);
            }}
          >
            Reset layout
          </Button>
          <Badge tone="neutral">{activeCount} nodes</Badge>
        </div>
      </div>

      {truncated && (
        <Banner severity="warning">
          Graph truncated at 500 nodes — narrow scope or reduce hops to inspect everything.
        </Banner>
      )}
      {bannerError && (
        <Banner severity="danger" onDismiss={() => setBannerError(null)}>
          {bannerError}
        </Banner>
      )}

      <div
        ref={viewportRef}
        className="org-graph__viewport"
        onMouseDown={handleStageMouseDown}
        onWheel={handleWheel}
      >
        {loading ? (
          <div className="org-graph__loading">
            <Spinner label="Loading dependency graph" />
          </div>
        ) : (
          <div ref={stageRef} className="org-graph__stage">
            <svg className="org-graph__svg" width={dagLayout.width} height={dagLayout.height}>
              <defs>
                <marker
                  id="gv-arrow"
                  viewBox="0 0 8 8"
                  refX="7"
                  refY="4"
                  markerWidth="6"
                  markerHeight="6"
                  orient="auto"
                >
                  <path d="M 0 1 L 7 4 L 0 7 z" className="org-graph__arrow-head" />
                </marker>
                <marker
                  id="gv-arrow-sel"
                  viewBox="0 0 8 8"
                  refX="7"
                  refY="4"
                  markerWidth="6"
                  markerHeight="6"
                  orient="auto"
                >
                  <path d="M 0 1 L 7 4 L 0 7 z" className="org-graph__arrow-head is-selected" />
                </marker>
              </defs>

              {graphMode === 'task' &&
                taskEdges.map((edge) => {
                  const s = posOf(edge.source_task_id);
                  const t = posOf(edge.target_task_id);
                  const x1 = s.x + NODE_W;
                  const y1 = s.y + NODE_H / 2;
                  const x2 = t.x;
                  const y2 = t.y + NODE_H / 2;
                  const cx = Math.max(24, Math.abs(x2 - x1) * 0.45);
                  const d = `M ${x1} ${y1} C ${x1 + cx} ${y1}, ${x2 - cx} ${y2}, ${x2} ${y2}`;
                  const isSel =
                    selectedEdge?.mode === 'task' &&
                    selectedEdge.sourceId === edge.source_task_id &&
                    selectedEdge.targetId === edge.target_task_id &&
                    selectedEdge.kind === edge.kind;
                  const label = edge.from_entity_link
                    ? `${edge.threshold ?? 'APP'} · link`
                    : (edge.threshold ?? edge.kind);
                  return (
                    <g
                      key={`${edge.kind}:${edge.source_task_id}->${edge.target_task_id}`}
                      data-graph-edge="task"
                      className={`org-graph__edge ${edge.kind === 'link' ? 'is-dashed' : ''} ${
                        isSel ? 'is-selected' : ''
                      }`}
                      onClick={(ev) => {
                        ev.stopPropagation();
                        setSelectedEdge({
                          mode: 'task',
                          sourceId: edge.source_task_id,
                          targetId: edge.target_task_id,
                          kind: edge.kind,
                        });
                      }}
                    >
                      <path d={d} className="org-graph__edge-hit" />
                      <path
                        d={d}
                        className="org-graph__edge-line"
                        markerEnd={isSel ? 'url(#gv-arrow-sel)' : 'url(#gv-arrow)'}
                      />
                      <text x={(x1 + x2) / 2} y={(y1 + y2) / 2 - 4} className="org-graph__edge-lbl">
                        {label}
                      </text>
                    </g>
                  );
                })}

              {graphMode === 'entity' &&
                indirectEntityEdges.map((ind) => {
                  const s = posOf(ind.sourceId);
                  const t = posOf(ind.targetId);
                  const x1 = s.x + NODE_W;
                  const y1 = s.y + NODE_H / 2 + 6;
                  const x2 = t.x;
                  const y2 = t.y + NODE_H / 2 + 6;
                  const midX = (x1 + x2) / 2;
                  const arcY = Math.max(y1, y2) + 38;
                  const d = `M ${x1} ${y1} Q ${midX} ${arcY}, ${x2} ${y2}`;
                  return (
                    <g
                      key={`ind:${ind.sourceId}->${ind.targetId}`}
                      className="org-graph__edge is-indirect"
                    >
                      <path d={d} className="org-graph__edge-line" markerEnd="url(#gv-arrow)" />
                      <text x={midX} y={arcY - 4} className="org-graph__edge-lbl">
                        via {ind.viaNames[0]}
                      </text>
                    </g>
                  );
                })}

              {graphMode === 'entity' &&
                entityEdges.map((edge) => {
                  const s = posOf(edge.source_entity_id);
                  const t = posOf(edge.target_entity_id);
                  const x1 = s.x + NODE_W;
                  const y1 = s.y + NODE_H / 2;
                  const x2 = t.x;
                  const y2 = t.y + NODE_H / 2;
                  const cx = Math.max(24, Math.abs(x2 - x1) * 0.45);
                  const d = `M ${x1} ${y1} C ${x1 + cx} ${y1}, ${x2 - cx} ${y2}, ${x2} ${y2}`;
                  const isSel = selectedEdge?.mode === 'entity' && selectedEdge.edgeId === edge.id;
                  return (
                    <g
                      key={edge.id}
                      data-graph-edge="entity"
                      className={`org-graph__edge ${isSel ? 'is-selected' : ''}`}
                      onClick={(ev) => {
                        ev.stopPropagation();
                        setSelectedEdge({
                          mode: 'entity',
                          edgeId: edge.id,
                          label: edge.link_type ?? 'uses',
                        });
                      }}
                    >
                      <path d={d} className="org-graph__edge-hit" />
                      <path
                        d={d}
                        className="org-graph__edge-line"
                        markerEnd={isSel ? 'url(#gv-arrow-sel)' : 'url(#gv-arrow)'}
                      />
                      <text x={(x1 + x2) / 2} y={(y1 + y2) / 2 - 4} className="org-graph__edge-lbl">
                        {edge.link_type ?? 'uses'}
                      </text>
                    </g>
                  );
                })}

              {connectDrag && (
                <line
                  x1={connectDrag.startX}
                  y1={connectDrag.startY}
                  x2={connectDrag.curX}
                  y2={connectDrag.curY}
                  className="org-graph__draft-line"
                />
              )}
            </svg>

            {graphMode === 'task' &&
              taskNodes.map((n) => (
                <TaskGraphCard
                  key={n.id}
                  node={n}
                  pos={posOf(n.id)}
                  selected={selectedTaskId === n.id || selectedNodeIds.has(n.id)}
                  highlighted={
                    Boolean(searchQuery.trim()) &&
                    (n.task_code.toLowerCase().includes(searchQuery.trim().toLowerCase()) ||
                      n.entity_name.toLowerCase().includes(searchQuery.trim().toLowerCase()))
                  }
                  canConnect={canEditTaskDeps}
                  onMouseDown={(e) => beginNodeDrag(e, n.id)}
                  onStartPort={(e) => beginPortConnect(e, n.id)}
                  onFocusNeighborhood={() => setGraphFocusTaskId(n.id)}
                />
              ))}

            {graphMode === 'entity' &&
              entityNodes.map((n) => (
                <EntityGraphCard
                  key={n.id}
                  node={n}
                  pos={posOf(n.id)}
                  selected={selectedNodeIds.has(n.id)}
                  highlighted={
                    Boolean(searchQuery.trim()) &&
                    n.name.toLowerCase().includes(searchQuery.trim().toLowerCase())
                  }
                  canConnect={canEditEntityLinks}
                  onMouseDown={(e) => beginNodeDrag(e, n.id)}
                  onStartPort={(e) => beginPortConnect(e, n.id)}
                  onDoubleClick={() => {
                    setGraphFocusTaskId(null);
                    setGraphScope('entity', n.id);
                    setGraphMode('task');
                  }}
                />
              ))}

            {marquee && <div ref={marqueeRectRef} className="org-graph__marquee" />}
          </div>
        )}

        {/* Minimap */}
        <div
          className="org-graph__minimap"
          aria-label="Graph minimap"
          onClick={(e) => {
            const box = e.currentTarget.getBoundingClientRect();
            const rx = (e.clientX - box.left) / box.width;
            const ry = (e.clientY - box.top) / box.height;
            const vp = viewportRef.current;
            if (!vp) return;
            setPanX(Math.round(vp.clientWidth / 2 - rx * dagLayout.width * zoom));
            setPanY(Math.round(vp.clientHeight / 2 - ry * dagLayout.height * zoom));
          }}
        >
          <svg
            viewBox={`0 0 ${dagLayout.width} ${dagLayout.height}`}
            className="org-graph__minimap-svg"
          >
            {(graphMode === 'task' ? taskNodes.map((n) => n.id) : entityNodes.map((n) => n.id)).map(
              (id) => {
                const p = posOf(id);
                return (
                  <rect
                    key={id}
                    x={p.x}
                    y={p.y}
                    width={NODE_W}
                    height={NODE_H}
                    className={
                      selectedNodeIds.has(id) || selectedTaskId === id
                        ? 'org-graph__mini-node is-selected'
                        : 'org-graph__mini-node'
                    }
                  />
                );
              },
            )}
          </svg>
        </div>
      </div>
    </div>
  );
}

function TaskGraphCard({
  node,
  pos,
  selected,
  highlighted,
  canConnect,
  onMouseDown,
  onStartPort,
  onFocusNeighborhood,
}: {
  node: TaskGraphNodeOut;
  pos: { x: number; y: number };
  selected: boolean;
  highlighted: boolean;
  canConnect: boolean;
  onMouseDown: (e: ReactMouseEvent) => void;
  onStartPort: (e: ReactMouseEvent) => void;
  onFocusNeighborhood: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useCssVarRef(ref, '--gv-nx', `${pos.x}px`);
  useCssVarRef(ref, '--gv-ny', `${pos.y}px`);

  return (
    <div
      ref={ref}
      data-graph-node={node.id}
      className={`org-graph__node ${selected ? 'is-selected' : ''} ${
        highlighted ? 'is-match' : ''
      }`}
      onMouseDown={onMouseDown}
      onDoubleClick={(e) => {
        e.stopPropagation();
        onFocusNeighborhood();
      }}
      title={`${node.task_code} · Double-click to focus neighborhood`}
    >
      <div className="org-graph__port org-graph__port--in" aria-hidden="true" />
      <div className="org-graph__node-hdr">
        <DepartmentTag name={node.department_name} className="org-graph__dept-tag" />
        <TaskUnreadDot taskId={node.id} />
        <StatusChip status={node.status} compact />
      </div>
      <div className="org-graph__node-body">
        <span className="org-graph__node-title">{node.task_code}</span>
        <div className="org-graph__node-avatars">
          {(node.assignees ?? []).slice(0, 2).map((a) => (
            <Avatar
              key={`${a.user_id}-${a.assignment_role}`}
              username={a.username}
              fullName={a.full_name}
              size="sm"
            />
          ))}
        </div>
      </div>
      {canConnect && (
        <button
          type="button"
          className="org-graph__port org-graph__port--out"
          aria-label={`Connect dependency from ${node.task_code}`}
          onMouseDown={onStartPort}
        />
      )}
    </div>
  );
}

function EntityGraphCard({
  node,
  pos,
  selected,
  highlighted,
  canConnect,
  onMouseDown,
  onStartPort,
  onDoubleClick,
}: {
  node: EntityGraphNodeOut;
  pos: { x: number; y: number };
  selected: boolean;
  highlighted: boolean;
  canConnect: boolean;
  onMouseDown: (e: ReactMouseEvent) => void;
  onStartPort: (e: ReactMouseEvent) => void;
  onDoubleClick: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useCssVarRef(ref, '--gv-nx', `${pos.x}px`);
  useCssVarRef(ref, '--gv-ny', `${pos.y}px`);

  return (
    <div
      ref={ref}
      data-graph-node={node.id}
      className={`org-graph__node org-graph__node--entity ${selected ? 'is-selected' : ''} ${
        highlighted ? 'is-match' : ''
      }`}
      onMouseDown={onMouseDown}
      onDoubleClick={(e) => {
        e.stopPropagation();
        onDoubleClick();
      }}
      title={`${node.name} · Double-click to open tasks in Task Mode`}
    >
      <div className="org-graph__port org-graph__port--in" aria-hidden="true" />
      <div className="org-graph__node-hdr">
        <Badge tone="neutral">{node.entity_type ?? 'entity'}</Badge>
        {node.is_archived && <Badge tone="warning">archived</Badge>}
      </div>
      <div className="org-graph__node-body">
        <span className="org-graph__node-title">{node.name}</span>
        <Icon name="chevron-right" size="sm" />
      </div>
      {canConnect && (
        <button
          type="button"
          className="org-graph__port org-graph__port--out"
          aria-label={`Connect entity link from ${node.name}`}
          onMouseDown={onStartPort}
        />
      )}
    </div>
  );
}
