/** CR04 §5/§7/§9: pure schedule helpers shared by the Gantt and the Calendar (unit-tested). */
import { addDays, isWorkingDay } from '../tasks/planningHelpers';

export type DraftKind = 'task' | 'milestone' | 'activation';
export type DraftOp = 'create' | 'update' | 'delete' | 'assign';

export interface DraftChangeLike {
  id?: string;
  kind: string;
  op: string;
  target_id: string;
  payload?: Record<string, unknown>;
  label?: string;
}

export interface DatedTask {
  id: string;
  ideal_start_date?: string | null;
  ideal_finish_date?: string | null;
  assignments?: ReadonlyArray<{ user_id: string; assignment_role: string }>;
}

/** Tasks with draft dates/assignments applied; `draftIds` = tasks touched by the draft. */
export function overlayTasks<T extends DatedTask>(
  tasks: ReadonlyArray<T>,
  changes: ReadonlyArray<DraftChangeLike>,
): { tasks: T[]; draftIds: Set<string> } {
  const byTask = new Map<string, DraftChangeLike[]>();
  for (const c of changes) {
    if (c.kind !== 'task') continue;
    byTask.set(c.target_id, [...(byTask.get(c.target_id) ?? []), c]);
  }
  const draftIds = new Set<string>();
  const out = tasks.map((t) => {
    const list = byTask.get(t.id);
    if (!list) return t;
    draftIds.add(t.id);
    let next: T = { ...t };
    for (const c of list) {
      const p = c.payload ?? {};
      if (c.op === 'assign') {
        const pairs = (p.assignments as [string, string][] | undefined) ?? [];
        next = {
          ...next,
          assignments: pairs.map(([user_id, assignment_role]) => ({ user_id, assignment_role })),
        };
      } else {
        if ('start' in p) next = { ...next, ideal_start_date: (p.start as string | null) ?? null };
        if ('finish' in p)
          next = { ...next, ideal_finish_date: (p.finish as string | null) ?? null };
      }
    }
    return next;
  });
  return { tasks: out, draftIds };
}

export interface MilestoneLike {
  id: string;
  name: string;
  date: string;
  kind: 'deliver' | 'milestone';
  target_kind: string;
  target_id?: string | null;
  note?: string;
  status?: 'open' | 'done';
  client_visible?: boolean;
}

/** Milestones with draft create/update/delete applied; draft ones carry `draft: true`. */
export function overlayMilestones<M extends MilestoneLike>(
  milestones: ReadonlyArray<M>,
  changes: ReadonlyArray<DraftChangeLike>,
): Array<M & { draft?: boolean }> {
  const out = new Map<string, M & { draft?: boolean }>(milestones.map((m) => [m.id, { ...m }]));
  for (const c of changes) {
    if (c.kind !== 'milestone') continue;
    const p = (c.payload ?? {}) as Partial<M>;
    if (c.op === 'delete') out.delete(c.target_id);
    else if (c.op === 'create') out.set(c.target_id, { ...(p as M), id: c.target_id, draft: true });
    else {
      const cur = out.get(c.target_id);
      if (cur) out.set(c.target_id, { ...cur, ...p, draft: true });
    }
  }
  return [...out.values()].sort((a, b) => a.date.localeCompare(b.date));
}

// ---------------------------------------------------------------- working-day maths

export function nextWorkingDay(iso: string, workingDays: ReadonlyArray<number>): string {
  let d = iso;
  for (let i = 0; i < 14 && !isWorkingDay(d, workingDays); i++) d = addDays(d, 1);
  return d;
}

/** Working days in [start, finish] (at least 1 so zero-length tasks keep a day). */
export function workingSpan(
  start: string,
  finish: string,
  workingDays: ReadonlyArray<number>,
): number {
  let n = 0;
  for (let d = start, i = 0; d <= finish && i < 3660; d = addDays(d, 1), i++) {
    if (isWorkingDay(d, workingDays)) n++;
  }
  return Math.max(1, n);
}

/** Date of the `count`-th working day starting at `start` (count >= 1, start included). */
export function addWorkingDays(
  start: string,
  count: number,
  workingDays: ReadonlyArray<number>,
): string {
  let d = nextWorkingDay(start, workingDays);
  let left = Math.max(1, count) - 1;
  while (left > 0) {
    d = addDays(d, 1);
    if (isWorkingDay(d, workingDays)) left--;
  }
  return d;
}

// ---------------------------------------------------------------- collision push

export interface DepEdge {
  source_task_id: string;
  target_task_id: string;
  kind: string;
}

export interface PushPatch {
  taskId: string;
  start: string;
  finish: string;
}

/**
 * Moving `rootId` to [start, finish]: downstream tasks that would now start before their
 * upstream finishes are pushed later, keeping their length in working days and starting on a
 * working day. Returns an error (and no patches) when the move cannot be resolved.
 */
export function computeCollisionPush(params: {
  rootId: string;
  start: string;
  finish: string;
  edges: ReadonlyArray<DepEdge>;
  tasksById: ReadonlyMap<string, DatedTask & { task_code?: string }>;
  workingDays: ReadonlyArray<number>;
  canEdit: (taskId: string) => boolean;
  codeOf?: (taskId: string) => string;
}): { patches: PushPatch[]; error?: string } {
  const { rootId, start, finish, edges, tasksById, workingDays, canEdit } = params;
  const code = params.codeOf ?? ((id: string) => tasksById.get(id)?.task_code ?? id.slice(0, 8));
  const deps = edges.filter((e) => e.kind === 'dependency');

  // An upstream cannot be moved by pushing downstream: refuse.
  for (const e of deps) {
    if (e.target_task_id !== rootId) continue;
    const up = tasksById.get(e.source_task_id);
    const upFinish = up?.ideal_finish_date ?? up?.ideal_start_date;
    if (upFinish && start < upFinish) {
      return {
        patches: [],
        error: `${code(rootId)} cannot start before upstream ${code(e.source_task_id)} finishes (${upFinish})`,
      };
    }
  }

  const children = new Map<string, string[]>();
  for (const e of deps) {
    children.set(e.source_task_id, [...(children.get(e.source_task_id) ?? []), e.target_task_id]);
  }
  const current = new Map<string, { start: string; finish: string }>([
    [rootId, { start, finish }],
  ]);
  const patches = new Map<string, PushPatch>();
  const queue = [rootId];
  let steps = 0;
  while (queue.length > 0) {
    if (++steps > 5000) return { patches: [], error: 'Dependency loop: cannot push tasks' };
    const cur = queue.shift()!;
    const curFinish = current.get(cur)?.finish;
    if (!curFinish) continue;
    for (const childId of children.get(cur) ?? []) {
      if (childId === rootId) return { patches: [], error: 'Dependency loop: cannot push tasks' };
      const child = tasksById.get(childId);
      const cs = current.get(childId)?.start ?? child?.ideal_start_date;
      const cf = current.get(childId)?.finish ?? child?.ideal_finish_date ?? cs;
      if (!cs || !cf || cs >= curFinish) continue;
      if (!canEdit(childId)) {
        return {
          patches: [],
          error: `Pushing would move ${code(childId)}, which you cannot edit`,
        };
      }
      const span = workingSpan(cs, cf, workingDays);
      const ns = nextWorkingDay(curFinish, workingDays);
      const nf = addWorkingDays(ns, span, workingDays);
      current.set(childId, { start: ns, finish: nf });
      patches.set(childId, { taskId: childId, start: ns, finish: nf });
      queue.push(childId);
    }
  }
  return { patches: [...patches.values()] };
}

// ---------------------------------------------------------------- milestones

export interface TaskForMilestone extends DatedTask {
  department_id?: string;
  entity_id?: string;
}

/** Tasks of the milestone's target finishing after its date (mirrors the server rule). */
export function lateTaskIds(
  m: Pick<MilestoneLike, 'date' | 'target_kind' | 'target_id'>,
  tasks: ReadonlyArray<TaskForMilestone>,
  companyOfUser: ReadonlyMap<string, string | null | undefined> = new Map(),
): string[] {
  return tasks
    .filter((t) => {
      const finish = t.ideal_finish_date;
      if (!finish || finish <= m.date) return false;
      const assignees = (t.assignments ?? []).map((a) => a.user_id);
      switch (m.target_kind) {
        case 'none':
          return true;
        case 'task':
          return t.id === m.target_id;
        case 'department':
          return t.department_id === m.target_id;
        case 'entity':
          return t.entity_id === m.target_id;
        case 'user':
          return assignees.includes(m.target_id ?? '');
        case 'company':
          return assignees.some((u) => companyOfUser.get(u) === m.target_id);
        default:
          return false;
      }
    })
    .map((t) => t.id)
    .sort();
}
