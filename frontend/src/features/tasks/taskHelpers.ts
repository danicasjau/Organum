import type {
  AuthMeOut,
  ClientTaskDetailOut,
  ClientTaskListItemOut,
  TaskBulkRowIn,
  TaskDetailOut,
  TaskListItemOut,
} from '../../lib/api/client';

export const ALL_WORKFLOW_STATUSES = [
  'WTG',
  'RDY',
  'IP',
  'RTK',
  'P_LEAD',
  'P_SUP',
  'P_CLIENT',
  'APP',
  'HLD',
] as const;

export const PRIORITY_OPTIONS = [
  { value: 'normal', label: 'Normal' },
  { value: 'high', label: 'High' },
  { value: 'stopper', label: 'Stopper' },
] as const;

export function isFullTaskItem(
  item: TaskListItemOut | ClientTaskListItemOut,
): item is TaskListItemOut {
  return 'bid_hours' in item || 'assignments' in item || 'priority' in item;
}

export function isFullTaskDetail(
  detail: TaskDetailOut | ClientTaskDetailOut,
): detail is TaskDetailOut {
  return 'dependencies' in detail || 'events' in detail || 'time_logs' in detail;
}

export function canPerformOnTask(
  auth: AuthMeOut | null,
  perm: string,
  myCapacities: ReadonlyArray<string> = [],
): boolean {
  if (!auth) return false;
  if (auth.user.role_name === 'admin') return true;
  if (auth.project_status === 'archived') {
    const readOnlyPerms = new Set(['task.view', 'media.view', 'product.view', 'user.view']);
    if (!readOnlyPerms.has(perm)) return false;
  }
  const roleScope = auth.permissions[perm] ?? 'none';
  if (roleScope !== 'none') {
    return true;
  }
  const capPerms = auth.capacity_permissions ?? {};
  for (const cap of myCapacities) {
    if ((capPerms[cap] ?? []).includes(perm)) {
      return true;
    }
  }
  return false;
}

/**
 * Matches backend workflow.compute_rollup_status precedence:
 * RTK > P_* > IP > RDY > WTG > HLD (when all non-APP tasks are HLD) > APP
 */
export function computeRollupStatus(statuses: ReadonlyArray<string>): string {
  if (statuses.length === 0) return 'WTG';
  if (statuses.includes('RTK')) return 'RTK';
  for (const pending of ['P_LEAD', 'P_SUP', 'P_CLIENT'] as const) {
    if (statuses.includes(pending)) return pending;
  }
  const nonApp = statuses.filter((s) => s !== 'APP');
  if (nonApp.length === 0) return 'APP';
  if (nonApp.includes('IP')) return 'IP';
  if (nonApp.includes('RDY')) return 'RDY';
  if (nonApp.includes('WTG')) return 'WTG';
  if (nonApp.every((s) => s === 'HLD')) return 'HLD';
  return nonApp[0] ?? 'WTG';
}

export function formatWaitHours(hours: number): string {
  if (hours < 1) return `${Math.max(1, Math.round(hours * 60))}m`;
  if (hours < 48) return `${hours.toFixed(1)}h`;
  return `${Math.round(hours / 24)}d`;
}

export function isOverdueDate(
  idealFinishDate: string | null | undefined,
  status: string,
  todayIso: string = new Date().toISOString().slice(0, 10),
): boolean {
  if (!idealFinishDate || status === 'APP') return false;
  return idealFinishDate < todayIso;
}

export function formatActedAsLabel(
  actedAs?: string | null,
  onBehalfOf?: boolean | string | null,
): string {
  if (actedAs === 'on_behalf' || Boolean(onBehalfOf)) {
    const target = typeof onBehalfOf === 'string' && onBehalfOf ? onBehalfOf : 'client';
    return `on behalf of ${target}`;
  }
  if (!actedAs) return '';
  if (actedAs === 'capacity:artist') return 'as DO';
  if (actedAs === 'capacity:lead') return 'as LEAD';
  if (actedAs === 'capacity:supervisor') return 'as SUP';
  if (actedAs.startsWith('role:')) return `as ${actedAs.slice(5)}`;
  return actedAs;
}

export interface TextMentionSegment {
  text: string;
  isMention: boolean;
}

export function splitMentionSegments(body: string): TextMentionSegment[] {
  const parts = body.split(/(@[A-Za-z0-9_.-]+)/g);
  return parts
    .filter((p) => p.length > 0)
    .map((p) => ({
      text: p,
      isMention: /^@[A-Za-z0-9_.-]+$/.test(p),
    }));
}

export interface MyTasksBuckets {
  needsAttention: TaskListItemOut[];
  thisWeek: TaskListItemOut[];
  upcoming: TaskListItemOut[];
  waiting: TaskListItemOut[];
  inReview: TaskListItemOut[];
  doneRecently: TaskListItemOut[];
}

export function categorizeMyTasks(
  tasks: ReadonlyArray<TaskListItemOut>,
  todayIso: string = new Date().toISOString().slice(0, 10),
): MyTasksBuckets {
  const todayDate = new Date(`${todayIso}T00:00:00Z`);
  const weekEnd = new Date(todayDate);
  weekEnd.setUTCDate(weekEnd.getUTCDate() + 7);
  const weekEndIso = weekEnd.toISOString().slice(0, 10);

  const buckets: MyTasksBuckets = {
    needsAttention: [],
    thisWeek: [],
    upcoming: [],
    waiting: [],
    inReview: [],
    doneRecently: [],
  };

  for (const t of tasks) {
    if (t.status === 'APP') {
      buckets.doneRecently.push(t);
    } else if (t.status === 'P_LEAD' || t.status === 'P_SUP' || t.status === 'P_CLIENT') {
      buckets.inReview.push(t);
    } else if (
      t.status === 'RTK' ||
      t.priority === 'stopper' ||
      isOverdueDate(t.ideal_finish_date, t.status, todayIso)
    ) {
      buckets.needsAttention.push(t);
    } else if (t.status === 'WTG') {
      buckets.waiting.push(t);
    } else if (t.ideal_finish_date && t.ideal_finish_date <= weekEndIso) {
      buckets.thisWeek.push(t);
    } else {
      buckets.upcoming.push(t);
    }
  }
  return buckets;
}

const VALID_STATUS_SET = new Set<string>(ALL_WORKFLOW_STATUSES);

export function parseMatrixTsvPaste(
  tsv: string,
  startRowIdx: number,
  startColIdx: number,
  rowEntityIds: ReadonlyArray<string>,
  colTargets: ReadonlyArray<{ departmentId: string; taskName?: string }>,
  taskLookup: (entityId: string, departmentId: string, taskName?: string) => TaskListItemOut | undefined,
  usernameToUserId: Map<string, string>,
): { rows: TaskBulkRowIn[]; undoRows: TaskBulkRowIn[]; ignoredCells: number } {
  const lines = tsv
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n')
    .filter((line, idx, arr) => !(idx === arr.length - 1 && line === ''));

  const rows: TaskBulkRowIn[] = [];
  const undoRows: TaskBulkRowIn[] = [];
  let ignoredCells = 0;

  for (let rOff = 0; rOff < lines.length; rOff++) {
    const rIdx = startRowIdx + rOff;
    const entityId = rowEntityIds[rIdx];
    if (!entityId) {
      ignoredCells += (lines[rOff] ?? '').split('\t').length;
      continue;
    }
    const cells = (lines[rOff] ?? '').split('\t');
    for (let cOff = 0; cOff < cells.length; cOff++) {
      const cIdx = startColIdx + cOff;
      const target = colTargets[cIdx];
      const raw = (cells[cOff] ?? '').trim();
      if (!target || !raw) {
        if (raw) ignoredCells += 1;
        continue;
      }
      const task = taskLookup(entityId, target.departmentId, target.taskName);
      if (!task) {
        ignoredCells += 1;
        continue;
      }
      const upper = raw.toUpperCase();
      const lower = raw.toLowerCase();
      if (VALID_STATUS_SET.has(upper)) {
        rows.push({ task_id: task.id, status: upper, assignee_role: 'artist' });
        undoRows.push({ task_id: task.id, status: task.status, assignee_role: 'artist' });
      } else if (lower === 'normal' || lower === 'high' || lower === 'stopper') {
        rows.push({ task_id: task.id, priority: lower, assignee_role: 'artist' });
        undoRows.push({
          task_id: task.id,
          priority: task.priority ?? 'normal',
          assignee_role: 'artist',
        });
      } else if (raw.startsWith('@')) {
        const uid = usernameToUserId.get(raw.slice(1).toLowerCase());
        if (uid) {
          const prevArtists = (task.assignments ?? [])
            .filter((a) => a.assignment_role === 'artist')
            .map((a) => a.user_id);
          rows.push({ task_id: task.id, assignee_user_ids: [uid], assignee_role: 'artist' });
          undoRows.push({
            task_id: task.id,
            assignee_user_ids: prevArtists,
            assignee_role: 'artist',
          });
        } else {
          ignoredCells += 1;
        }
      } else {
        ignoredCells += 1;
      }
    }
  }
  return { rows, undoRows, ignoredCells };
}
