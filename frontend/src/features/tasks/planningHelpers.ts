import type {
  CompanyOut,
  EntityGraphEdgeOut,
  EntityGraphNodeOut,
  TaskGraphEdgeOut,
  TaskListItemOut,
  UserOut,
  WorkloadCellSchema,
  WorkloadRowSchema,
} from '../../lib/api/client';
import { ALL_WORKFLOW_STATUSES, computeRollupStatus } from './taskHelpers';
import type { GanttGroupBy } from './tasksStore';

const MS_PER_DAY = 86_400_000;

/** Parses an ISO YYYY-MM-DD date string into a UTC midnight Date, or null if invalid. */
export function parseIsoDate(iso: string | null | undefined): Date | null {
  if (!iso || typeof iso !== 'string') return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso.trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]) - 1;
  const day = Number(match[3]);
  const dt = new Date(Date.UTC(year, month, day));
  if (
    Number.isNaN(dt.getTime()) ||
    dt.getUTCFullYear() !== year ||
    dt.getUTCMonth() !== month ||
    dt.getUTCDate() !== day
  ) {
    return null;
  }
  return dt;
}

/** Formats a UTC Date as YYYY-MM-DD. */
export function formatIsoDate(dt: Date): string {
  const y = dt.getUTCFullYear();
  const m = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const d = String(dt.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Today's date string in UTC (YYYY-MM-DD). */
export function todayIsoUtc(): string {
  return formatIsoDate(new Date());
}

/** Returns whole calendar days (b - a) in UTC. */
export function diffDays(aIso: string, bIso: string): number {
  const a = parseIsoDate(aIso);
  const b = parseIsoDate(bIso);
  if (!a || !b) return 0;
  return Math.round((b.getTime() - a.getTime()) / MS_PER_DAY);
}

/** Adds `days` calendar days to an ISO YYYY-MM-DD date string in UTC. */
export function addDays(iso: string, days: number): string {
  const dt = parseIsoDate(iso);
  if (!dt) return iso;
  return formatIsoDate(new Date(dt.getTime() + days * MS_PER_DAY));
}

/** Returns 0 for Monday .. 6 for Sunday (matching Python `date.weekday()`). */
export function isoWeekdayZeroMon(iso: string): number {
  const dt = parseIsoDate(iso);
  if (!dt) return 0;
  return (dt.getUTCDay() + 6) % 7;
}

/** Checks if `iso` falls inside `workingDays` (0=Mon..6=Sun). */
export function isWorkingDay(
  iso: string,
  workingDays: ReadonlyArray<number> = [0, 1, 2, 3, 4],
): boolean {
  const allowed = workingDays.length > 0 ? workingDays : [0, 1, 2, 3, 4];
  return allowed.includes(isoWeekdayZeroMon(iso));
}

/** Computes a timeline [startIso, endIso] covering all task dates with comfortable padding. */
export function computeTimelineBounds(
  tasks: ReadonlyArray<TaskListItemOut>,
  todayIso: string = todayIsoUtc(),
): { startIso: string; endIso: string; totalDays: number } {
  let minIso = addDays(todayIso, -7);
  let maxIso = addDays(todayIso, 28);

  for (const t of tasks) {
    for (const d of [
      t.ideal_start_date,
      t.ideal_finish_date,
      t.actual_start_date,
      t.actual_finish_date,
    ]) {
      if (!d) continue;
      if (d < minIso) minIso = d;
      if (d > maxIso) maxIso = d;
    }
  }

  const startIso = addDays(minIso, -4);
  const endIso = addDays(maxIso, 7);
  const totalDays = Math.max(14, diffDays(startIso, endIso) + 1);
  return { startIso, endIso, totalDays };
}

export interface GanttGroupRow {
  kind: 'group';
  rowKey: string;
  groupKey: string;
  label: string;
  sublabel?: string;
  groupType: GanttGroupBy;
  groupTargetId?: string | null;
  taskCount: number;
  rollupStatus: string;
  minStart: string | null;
  maxFinish: string | null;
  collapsed: boolean;
}

export interface GanttTaskRow {
  kind: 'task';
  rowKey: string;
  groupKey: string;
  task: TaskListItemOut;
}

export type GanttRow = GanttGroupRow | GanttTaskRow;

function compareTaskDefaults(a: TaskListItemOut, b: TaskListItemOut): number {
  const as = a.ideal_start_date ?? '9999-12-31';
  const bs = b.ideal_start_date ?? '9999-12-31';
  if (as !== bs) return as < bs ? -1 : 1;
  if (a.entity_rel_path !== b.entity_rel_path) {
    return a.entity_rel_path.localeCompare(b.entity_rel_path);
  }
  return a.task_code.localeCompare(b.task_code);
}

/**
 * Builds virtualizable Gantt rows for all 7 grouping modes in a single linear pass.
 * When grouped, computes min start, max finish, and rollup status for every header row.
 */
export function buildGanttRows(params: {
  tasks: ReadonlyArray<TaskListItemOut>;
  groupBy: GanttGroupBy;
  collapsedGroups: ReadonlySet<string>;
  users?: ReadonlyArray<UserOut>;
  companies?: ReadonlyArray<CompanyOut>;
}): { rows: GanttRow[]; firstRowKeyByTaskId: Map<string, string> } {
  const { tasks, groupBy, collapsedGroups, users = [], companies = [] } = params;
  const firstRowKeyByTaskId = new Map<string, string>();

  if (groupBy === 'none') {
    const sorted = [...tasks].sort(compareTaskDefaults);
    const rows: GanttRow[] = sorted.map((task) => {
      const rowKey = `none::${task.id}`;
      firstRowKeyByTaskId.set(task.id, rowKey);
      return { kind: 'task', rowKey, groupKey: 'none', task };
    });
    return { rows, firstRowKeyByTaskId };
  }

  const usersById = new Map(users.map((u) => [u.id, u]));
  const companiesById = new Map(companies.map((c) => [c.id, c]));

  interface Bucket {
    groupKey: string;
    label: string;
    sublabel?: string;
    targetId?: string | null;
    orderHint: number;
    tasks: TaskListItemOut[];
  }

  const buckets = new Map<string, Bucket>();
  const ensureBucket = (
    groupKey: string,
    label: string,
    sublabel?: string,
    targetId?: string | null,
    orderHint = 0,
  ): Bucket => {
    let b = buckets.get(groupKey);
    if (!b) {
      b = { groupKey, label, sublabel, targetId, orderHint, tasks: [] };
      buckets.set(groupKey, b);
    }
    return b;
  };

  if (groupBy === 'user') {
    for (const u of users) {
      if (!u.is_active) continue;
      ensureBucket(`user:${u.id}`, u.full_name || u.username, `@${u.username}`, u.id, 0);
    }
  } else if (groupBy === 'company') {
    for (const c of companies) {
      ensureBucket(`company:${c.id}`, c.name, c.kind === 'external' ? 'external' : c.kind, c.id, 0);
    }
  }

  const statusOrder = new Map<string, number>(ALL_WORKFLOW_STATUSES.map((s, idx) => [s, idx]));
  const priorityOrder: Record<string, number> = { stopper: 0, high: 1, normal: 2 };

  for (const task of tasks) {
    const assignments = task.assignments ?? [];
    if (groupBy === 'entity_path') {
      const key = `entity:${task.entity_id}`;
      const label = task.entity_rel_path || task.entity_name;
      ensureBucket(key, label, task.parent_entity_type ?? undefined, task.entity_id).tasks.push(
        task,
      );
    } else if (groupBy === 'department') {
      const key = `dept:${task.department_id}`;
      ensureBucket(
        key,
        task.department_name,
        task.department_short_code || undefined,
        task.department_id,
      ).tasks.push(task);
    } else if (groupBy === 'user') {
      const artists = assignments.filter((a) => a.assignment_role === 'artist');
      const relevant = artists.length > 0 ? artists : assignments;
      if (relevant.length === 0) {
        ensureBucket('user:__unassigned__', 'Unassigned', 'No assignee', null, 1).tasks.push(task);
      } else {
        const seen = new Set<string>();
        for (const a of relevant) {
          if (seen.has(a.user_id)) continue;
          seen.add(a.user_id);
          ensureBucket(
            `user:${a.user_id}`,
            a.full_name || a.username,
            `@${a.username}`,
            a.user_id,
            0,
          ).tasks.push(task);
        }
      }
    } else if (groupBy === 'company') {
      const companyIds = new Set<string>();
      for (const a of assignments) {
        const u = usersById.get(a.user_id);
        if (u?.company_id) companyIds.add(u.company_id);
      }
      for (const cid of task.shared_company_ids ?? []) {
        companyIds.add(cid);
      }
      if (companyIds.size === 0) {
        ensureBucket('company:__internal__', 'In-house / Unscoped', undefined, null, 1).tasks.push(
          task,
        );
      } else {
        for (const cid of companyIds) {
          const c = companiesById.get(cid);
          ensureBucket(
            `company:${cid}`,
            c?.name ?? cid.slice(0, 8),
            c?.kind === 'external' ? 'external' : undefined,
            cid,
            0,
          ).tasks.push(task);
        }
      }
    } else if (groupBy === 'status') {
      ensureBucket(
        `status:${task.status}`,
        task.status,
        undefined,
        task.status,
        statusOrder.get(task.status) ?? 99,
      ).tasks.push(task);
    } else if (groupBy === 'priority') {
      ensureBucket(
        `priority:${task.priority}`,
        task.priority.toUpperCase(),
        undefined,
        task.priority,
        priorityOrder[task.priority] ?? 9,
      ).tasks.push(task);
    }
  }

  const orderedBuckets = Array.from(buckets.values()).filter(
    (b) => b.tasks.length > 0 || groupBy === 'user' || groupBy === 'company',
  );
  orderedBuckets.sort((a, b) => {
    if (a.orderHint !== b.orderHint) return a.orderHint - b.orderHint;
    return a.label.localeCompare(b.label);
  });

  const rows: GanttRow[] = [];
  for (const b of orderedBuckets) {
    const sortedTasks = [...b.tasks].sort(compareTaskDefaults);
    let minStart: string | null = null;
    let maxFinish: string | null = null;
    const statuses: string[] = [];
    for (const t of sortedTasks) {
      statuses.push(t.status);
      if (t.ideal_start_date && (!minStart || t.ideal_start_date < minStart)) {
        minStart = t.ideal_start_date;
      }
      const finish = t.ideal_finish_date ?? t.ideal_start_date;
      if (finish && (!maxFinish || finish > maxFinish)) {
        maxFinish = finish;
      }
    }

    const collapsed = collapsedGroups.has(b.groupKey);
    rows.push({
      kind: 'group',
      rowKey: `grp::${b.groupKey}`,
      groupKey: b.groupKey,
      label: b.label,
      sublabel: b.sublabel,
      groupType: groupBy,
      groupTargetId: b.targetId,
      taskCount: sortedTasks.length,
      rollupStatus: computeRollupStatus(statuses),
      minStart,
      maxFinish,
      collapsed,
    });

    if (!collapsed) {
      for (const task of sortedTasks) {
        const rowKey = `${b.groupKey}::${task.id}`;
        if (!firstRowKeyByTaskId.has(task.id)) {
          firstRowKeyByTaskId.set(task.id, rowKey);
        }
        rows.push({ kind: 'task', rowKey, groupKey: b.groupKey, task });
      }
    }
  }

  return { rows, firstRowKeyByTaskId };
}

export function edgeKey(sourceId: string, targetId: string, kind = 'dependency'): string {
  return `${kind}:${sourceId}->${targetId}`;
}

/**
 * Returns violated dependency edge keys (`target.ideal_start_date < source.ideal_finish_date`)
 * and the set of downstream task IDs experiencing a schedule violation.
 */
export function computeDependencyViolations(
  edges: ReadonlyArray<TaskGraphEdgeOut>,
  tasksById: ReadonlyMap<string, Pick<TaskListItemOut, 'id' | 'ideal_start_date' | 'ideal_finish_date'>>,
): { violatedEdgeKeys: Set<string>; violatedTaskIds: Set<string> } {
  const violatedEdgeKeys = new Set<string>();
  const violatedTaskIds = new Set<string>();
  for (const e of edges) {
    if (e.kind !== 'dependency') continue;
    const src = tasksById.get(e.source_task_id);
    const dst = tasksById.get(e.target_task_id);
    if (!src?.ideal_finish_date || !dst?.ideal_start_date) continue;
    if (dst.ideal_start_date < src.ideal_finish_date) {
      violatedEdgeKeys.add(edgeKey(e.source_task_id, e.target_task_id, e.kind));
      violatedTaskIds.add(e.target_task_id);
    }
  }
  return { violatedEdgeKeys, violatedTaskIds };
}

/**
 * Collects all connected upstream + downstream nodes and edges from `seedTaskId`.
 */
export function collectDependencyChain(
  seedTaskId: string,
  edges: ReadonlyArray<TaskGraphEdgeOut>,
): { nodeIds: Set<string>; edgeKeys: Set<string> } {
  const upstream = new Map<string, TaskGraphEdgeOut[]>();
  const downstream = new Map<string, TaskGraphEdgeOut[]>();
  for (const e of edges) {
    if (!downstream.has(e.source_task_id)) downstream.set(e.source_task_id, []);
    downstream.get(e.source_task_id)!.push(e);
    if (!upstream.has(e.target_task_id)) upstream.set(e.target_task_id, []);
    upstream.get(e.target_task_id)!.push(e);
  }

  const nodeIds = new Set<string>([seedTaskId]);
  const edgeKeys = new Set<string>();

  const walk = (start: string, adj: Map<string, TaskGraphEdgeOut[]>, forward: boolean) => {
    const queue = [start];
    const visited = new Set<string>([start]);
    while (queue.length > 0) {
      const cur = queue.shift()!;
      for (const e of adj.get(cur) ?? []) {
        edgeKeys.add(edgeKey(e.source_task_id, e.target_task_id, e.kind));
        const nxt = forward ? e.target_task_id : e.source_task_id;
        nodeIds.add(nxt);
        if (!visited.has(nxt)) {
          visited.add(nxt);
          queue.push(nxt);
        }
      }
    }
  };

  walk(seedTaskId, upstream, false);
  walk(seedTaskId, downstream, true);
  return { nodeIds, edgeKeys };
}

export interface DownstreamShiftPatch {
  taskId: string;
  prevStart: string | null;
  prevFinish: string | null;
  nextStart: string;
  nextFinish: string;
  updatedAt?: string;
}

/**
 * Computes downstream cascading schedule shifts when `rootTaskId` finishes on `newRootFinish`.
 * Only shifts downstream tasks whose ideal_start_date precedes their required upstream finish,
 * preserving each downstream task's planned duration.
 */
export function computePushDependents(params: {
  rootTaskId: string;
  newRootFinish: string;
  edges: ReadonlyArray<TaskGraphEdgeOut>;
  tasksById: ReadonlyMap<
    string,
    Pick<TaskListItemOut, 'id' | 'ideal_start_date' | 'ideal_finish_date' | 'updated_at'>
  >;
}): DownstreamShiftPatch[] {
  const { rootTaskId, newRootFinish, edges, tasksById } = params;
  const downstreamMap = new Map<string, string[]>();
  for (const e of edges) {
    if (e.kind !== 'dependency') continue;
    if (!downstreamMap.has(e.source_task_id)) downstreamMap.set(e.source_task_id, []);
    downstreamMap.get(e.source_task_id)!.push(e.target_task_id);
  }

  const finishOverride = new Map<string, string>([[rootTaskId, newRootFinish]]);
  const patchesById = new Map<string, DownstreamShiftPatch>();
  const queue: string[] = [rootTaskId];
  const guard = new Set<string>();

  while (queue.length > 0) {
    const curId = queue.shift()!;
    const curFinish = finishOverride.get(curId) ?? tasksById.get(curId)?.ideal_finish_date;
    if (!curFinish) continue;

    for (const childId of downstreamMap.get(curId) ?? []) {
      const child = tasksById.get(childId);
      if (!child || !child.ideal_start_date) continue;
      const existingPatch = patchesById.get(childId);
      const childStart = existingPatch?.nextStart ?? child.ideal_start_date;
      const childFinish = existingPatch?.nextFinish ?? child.ideal_finish_date ?? child.ideal_start_date;

      if (childStart < curFinish) {
        const duration = Math.max(0, diffDays(childStart, childFinish));
        const nextStart = curFinish;
        const nextFinish = addDays(nextStart, duration);
        patchesById.set(childId, {
          taskId: childId,
          prevStart: child.ideal_start_date ?? null,
          prevFinish: child.ideal_finish_date ?? null,
          nextStart,
          nextFinish,
          updatedAt: child.updated_at,
        });
        finishOverride.set(childId, nextFinish);
        const visitKey = `${childId}:${nextFinish}`;
        if (!guard.has(visitKey) && guard.size < 500) {
          guard.add(visitKey);
          queue.push(childId);
        }
      }
    }
  }

  return Array.from(patchesById.values());
}

/** Maps utilization % to `--heat-0`..`--heat-4` tier index. */
export function utilizationTier(pct: number): 0 | 1 | 2 | 3 | 4 {
  if (pct <= 0) return 0;
  if (pct <= 75) return 1;
  if (pct <= 100) return 2;
  if (pct <= 125) return 3;
  return 4;
}

export interface WeeklyWorkloadColumn {
  weekStart: string;
  label: string;
  dayCount: number;
}

/**
 * Aggregates daily workload cells into ISO Monday-anchored weeks while preserving exact hours,
 * capacities, and contributing task IDs.
 */
export function aggregateWorkloadWeeks(
  days: ReadonlyArray<string>,
  rows: ReadonlyArray<WorkloadRowSchema>,
): { columns: WeeklyWorkloadColumn[]; rows: WorkloadRowSchema[] } {
  const columns: WeeklyWorkloadColumn[] = [];
  const colIndexByWeek = new Map<string, number>();
  const weekOfDay = new Map<string, string>();

  for (const day of days) {
    const weekday = isoWeekdayZeroMon(day);
    const weekStart = addDays(day, -weekday);
    weekOfDay.set(day, weekStart);
    if (!colIndexByWeek.has(weekStart)) {
      colIndexByWeek.set(weekStart, columns.length);
      columns.push({
        weekStart,
        label: `W ${weekStart.slice(5)}`,
        dayCount: 0,
      });
    }
    const idx = colIndexByWeek.get(weekStart);
    if (idx !== undefined && columns[idx]) {
      columns[idx].dayCount += 1;
    }
  }

  const aggregatedRows: WorkloadRowSchema[] = rows.map((row) => {
    const accum = columns.map((c) => ({
      day: c.weekStart,
      hours: 0,
      capacity_hours: 0,
      taskIds: new Set<string>(),
    }));
    for (const cell of row.cells ?? []) {
      const weekStart = weekOfDay.get(cell.day);
      if (!weekStart) continue;
      const idx = colIndexByWeek.get(weekStart);
      if (idx === undefined) continue;
      const bucket = accum[idx];
      if (!bucket) continue;
      bucket.hours += cell.hours;
      bucket.capacity_hours += cell.capacity_hours;
      for (const tid of cell.contributing_task_ids ?? []) {
        bucket.taskIds.add(tid);
      }
    }
    const cells: WorkloadCellSchema[] = accum.map((a) => ({
      day: a.day,
      hours: Math.round(a.hours * 100) / 100,
      capacity_hours: Math.round(a.capacity_hours * 100) / 100,
      utilization_pct:
        a.capacity_hours > 0 ? Math.round((a.hours / a.capacity_hours) * 1000) / 10 : 0,
      contributing_task_ids: Array.from(a.taskIds),
    }));
    return { ...row, cells };
  });

  return { columns, rows: aggregatedRows };
}

export interface GraphLayoutPosition {
  x: number;
  y: number;
  layer: number;
  order: number;
}

export interface DagLayoutResult {
  positions: Map<string, GraphLayoutPosition>;
  width: number;
  height: number;
}

/**
 * Pure topological layered DAG layout with two-pass barycenter crossing reduction.
 * Uses only node IDs and directed `(source -> target)` edges so it works for both Task and Entity graphs.
 */
export function computeLayeredDagLayout(
  nodeIds: ReadonlyArray<string>,
  edges: ReadonlyArray<{ source: string; target: string }>,
  opts?: {
    nodeWidth?: number;
    nodeHeight?: number;
    colGap?: number;
    rowGap?: number;
    padding?: number;
  },
): DagLayoutResult {
  const nodeW = opts?.nodeWidth ?? 168;
  const nodeH = opts?.nodeHeight ?? 52;
  const colGap = opts?.colGap ?? 72;
  const rowGap = opts?.rowGap ?? 22;
  const pad = opts?.padding ?? 32;

  const nodeSet = new Set(nodeIds);
  const indeg = new Map<string, number>();
  const outgoing = new Map<string, string[]>();
  const incoming = new Map<string, string[]>();

  for (const id of nodeIds) {
    indeg.set(id, 0);
    outgoing.set(id, []);
    incoming.set(id, []);
  }
  for (const e of edges) {
    if (e.source === e.target || !nodeSet.has(e.source) || !nodeSet.has(e.target)) continue;
    outgoing.get(e.source)!.push(e.target);
    incoming.get(e.target)!.push(e.source);
    indeg.set(e.target, (indeg.get(e.target) ?? 0) + 1);
  }

  const layerById = new Map<string, number>();
  const queue: string[] = [];
  for (const id of nodeIds) {
    if ((indeg.get(id) ?? 0) === 0) {
      queue.push(id);
      layerById.set(id, 0);
    }
  }

  const processed = new Set<string>();
  while (queue.length > 0) {
    const u = queue.shift()!;
    processed.add(u);
    const uLayer = layerById.get(u) ?? 0;
    for (const v of outgoing.get(u) ?? []) {
      layerById.set(v, Math.max(layerById.get(v) ?? 0, uLayer + 1));
      const rem = (indeg.get(v) ?? 1) - 1;
      indeg.set(v, rem);
      if (rem === 0) queue.push(v);
    }
  }

  // Fallback for any nodes inside cycles so layout never stalls
  for (const id of nodeIds) {
    if (!processed.has(id)) {
      let maxInLayer = -1;
      for (const p of incoming.get(id) ?? []) {
        if (layerById.has(p)) maxInLayer = Math.max(maxInLayer, layerById.get(p)!);
      }
      layerById.set(id, maxInLayer + 1);
    }
  }

  const layers: string[][] = [];
  for (const id of nodeIds) {
    const l = layerById.get(id) ?? 0;
    while (layers.length <= l) layers.push([]);
    layers[l]?.push(id);
  }

  // Two-pass barycenter ordering reduction
  const orderMap = new Map<string, number>();
  const refreshOrder = () => {
    for (const layer of layers) {
      layer.forEach((id, idx) => orderMap.set(id, idx));
    }
  };
  refreshOrder();

  for (let pass = 0; pass < 2; pass++) {
    for (let l = 1; l < layers.length; l++) {
      const curLayer = layers[l];
      if (!curLayer) continue;
      curLayer.sort((a, b) => {
        const pa = incoming.get(a) ?? [];
        const pb = incoming.get(b) ?? [];
        const avgA =
          pa.length > 0
            ? pa.reduce((s, p) => s + (orderMap.get(p) ?? 0), 0) / pa.length
            : orderMap.get(a) ?? 0;
        const avgB =
          pb.length > 0
            ? pb.reduce((s, p) => s + (orderMap.get(p) ?? 0), 0) / pb.length
            : orderMap.get(b) ?? 0;
        return avgA - avgB;
      });
      refreshOrder();
    }
    for (let l = layers.length - 2; l >= 0; l--) {
      const curLayer = layers[l];
      if (!curLayer) continue;
      curLayer.sort((a, b) => {
        const ca = outgoing.get(a) ?? [];
        const cb = outgoing.get(b) ?? [];
        const avgA =
          ca.length > 0
            ? ca.reduce((s, c) => s + (orderMap.get(c) ?? 0), 0) / ca.length
            : orderMap.get(a) ?? 0;
        const avgB =
          cb.length > 0
            ? cb.reduce((s, c) => s + (orderMap.get(c) ?? 0), 0) / cb.length
            : orderMap.get(b) ?? 0;
        return avgA - avgB;
      });
      refreshOrder();
    }
  }

  const positions = new Map<string, GraphLayoutPosition>();
  let maxRows = 1;
  layers.forEach((layer, l) => {
    maxRows = Math.max(maxRows, layer.length);
    layer.forEach((id, idx) => {
      positions.set(id, {
        x: pad + l * (nodeW + colGap),
        y: pad + idx * (nodeH + rowGap),
        layer: l,
        order: idx,
      });
    });
  });

  const width = Math.max(480, pad * 2 + layers.length * nodeW + Math.max(0, layers.length - 1) * colGap);
  const height = Math.max(320, pad * 2 + maxRows * nodeH + Math.max(0, maxRows - 1) * rowGap);
  return { positions, width, height };
}

export interface IndirectEntityEdge {
  sourceId: string;
  targetId: string;
  viaNames: string[];
}

/**
 * Discovers transitive 2-hop entity links (A -> B -> C) that do not already exist as direct edges,
 * so Entity Graph mode can draw them as subtle dashed arcs.
 */
export function computeIndirectEntityEdges(
  nodes: ReadonlyArray<EntityGraphNodeOut>,
  edges: ReadonlyArray<EntityGraphEdgeOut>,
): IndirectEntityEdge[] {
  const nameById = new Map(nodes.map((n) => [n.id, n.name]));
  const adj = new Map<string, string[]>();
  const directPairs = new Set<string>();

  for (const e of edges) {
    directPairs.add(`${e.source_entity_id}->${e.target_entity_id}`);
    if (!adj.has(e.source_entity_id)) adj.set(e.source_entity_id, []);
    adj.get(e.source_entity_id)!.push(e.target_entity_id);
  }

  const result: IndirectEntityEdge[] = [];
  const seenIndirect = new Set<string>();

  for (const a of nodes) {
    for (const b of adj.get(a.id) ?? []) {
      for (const c of adj.get(b) ?? []) {
        if (a.id === c) continue;
        const pair = `${a.id}->${c}`;
        if (directPairs.has(pair) || seenIndirect.has(pair)) continue;
        seenIndirect.add(pair);
        result.push({
          sourceId: a.id,
          targetId: c,
          viaNames: [nameById.get(b) ?? b.slice(0, 8)],
        });
      }
    }
  }

  return result;
}
