import { describe, expect, it } from 'vitest';
import type { AuthMeOut, TaskListItemOut } from '../../lib/api/client';
import {
  canPerformOnTask,
  categorizeMyTasks,
  computeRollupStatus,
  parseMatrixTsvPaste,
  splitMentionSegments,
} from './taskHelpers';

function makeTask(partial: Partial<TaskListItemOut>): TaskListItemOut {
  return {
    id: partial.id ?? 't-1',
    task_code: partial.task_code ?? 'hero_MOD_main',
    task_name: partial.task_name ?? 'Modeling - main',
    name: partial.name ?? 'main',
    folder_name: 'main',
    entity_id: partial.entity_id ?? 'e-1',
    entity_name: partial.entity_name ?? 'hero',
    entity_rel_path: 'chars/hero',
    department_id: partial.department_id ?? 'd-1',
    department_name: partial.department_name ?? 'Modeling',
    department_short_code: partial.department_short_code ?? 'MOD',
    department_color: partial.department_color ?? '--series-1',
    description: partial.description ?? '',
    status: partial.status ?? 'RDY',
    priority: partial.priority ?? 'normal',
    needs_lead_review: partial.needs_lead_review ?? true,
    needs_sup_review: partial.needs_sup_review ?? false,
    needs_client_review: partial.needs_client_review ?? false,
    logged_hours: partial.logged_hours ?? 0,
    retake_count: partial.retake_count ?? 0,
    version_count: partial.version_count ?? 0,
    upstream_count: partial.upstream_count ?? 0,
    blocked_upstream: partial.blocked_upstream ?? false,
    ideal_finish_date: partial.ideal_finish_date ?? null,
    updated_at: '2026-11-25T00:00:00Z',
    ...partial,
  };
}

describe('taskHelpers', () => {
  it('matches backend computeRollupStatus precedence', () => {
    expect(computeRollupStatus([])).toBe('WTG');
    expect(computeRollupStatus(['APP', 'RTK', 'IP'])).toBe('RTK');
    expect(computeRollupStatus(['APP', 'P_LEAD', 'IP'])).toBe('P_LEAD');
    expect(computeRollupStatus(['APP', 'IP', 'RDY', 'WTG'])).toBe('IP');
    expect(computeRollupStatus(['APP', 'RDY', 'WTG'])).toBe('RDY');
    expect(computeRollupStatus(['APP', 'HLD'])).toBe('HLD');
    expect(computeRollupStatus(['APP', 'APP'])).toBe('APP');
  });

  it('resolves role and capacity union permissions and archived lock', () => {
    const directorAuth: AuthMeOut = {
      project_uuid: 'p1',
      project_status: 'active',
      user: {
        id: 'u-dir',
        username: 'dir_alex',
        full_name: 'Alex Vance',
        role_id: 'r-dir',
        role_name: 'director',
        role_label: 'Director',
        daily_capacity_hours: 8,
        timezone: 'UTC',
        is_active: true,
        must_change_password: false,
        projects_working_on: [],
      },
      permissions: {
        'task.view': 'all',
        'task.approve.lead': 'all',
        'task.edit_schedule': 'none',
      },
      capacity_permissions: {
        supervisor: ['task.edit_schedule', 'task.status.hold'],
      },
    };

    expect(canPerformOnTask(directorAuth, 'task.edit_schedule', [])).toBe(false);
    expect(canPerformOnTask(directorAuth, 'task.edit_schedule', ['supervisor'])).toBe(true);
    expect(canPerformOnTask(directorAuth, 'task.approve.lead', [])).toBe(true);

    const archived = { ...directorAuth, project_status: 'archived' };
    expect(canPerformOnTask(archived, 'task.approve.lead', [])).toBe(false);
    expect(canPerformOnTask(archived, 'task.view', [])).toBe(true);
  });

  it('categorizes My Tasks into focus sections', () => {
    const out = categorizeMyTasks(
      [
        makeTask({ id: 'rtk', status: 'RTK' }),
        makeTask({ id: 'stop', status: 'IP', priority: 'stopper' }),
        makeTask({ id: 'ov', status: 'IP', ideal_finish_date: '2026-11-20' }),
        makeTask({ id: 'wk', status: 'RDY', ideal_finish_date: '2026-11-28' }),
        makeTask({ id: 'up', status: 'RDY', ideal_finish_date: '2026-12-20' }),
        makeTask({ id: 'wtg', status: 'WTG' }),
        makeTask({ id: 'rev', status: 'P_LEAD' }),
        makeTask({ id: 'done', status: 'APP' }),
      ],
      '2026-11-25',
    );
    expect(out.needsAttention.map((t) => t.id)).toEqual(['rtk', 'stop', 'ov']);
    expect(out.thisWeek.map((t) => t.id)).toEqual(['wk']);
    expect(out.upcoming.map((t) => t.id)).toEqual(['up']);
    expect(out.waiting.map((t) => t.id)).toEqual(['wtg']);
    expect(out.inReview.map((t) => t.id)).toEqual(['rev']);
    expect(out.doneRecently.map((t) => t.id)).toEqual(['done']);
  });

  it('splits plain @mentions and parses TSV matrix paste with undo rows', () => {
    const segs = splitMentionSegments('Check @art_sam and @lead_marco pass');
    expect(segs.filter((s) => s.isMention).map((s) => s.text)).toEqual([
      '@art_sam',
      '@lead_marco',
    ]);

    const t1 = makeTask({ id: 't1', entity_id: 'e1', department_id: 'd1', status: 'RDY' });
    const t2 = makeTask({
      id: 't2',
      entity_id: 'e1',
      department_id: 'd2',
      priority: 'normal',
    });
    const parsed = parseMatrixTsvPaste(
      'IP\thigh\nunknown',
      0,
      0,
      ['e1'],
      [{ departmentId: 'd1' }, { departmentId: 'd2' }],
      (eId, dId) => [t1, t2].find((t) => t.entity_id === eId && t.department_id === dId),
      new Map([['art_sam', 'u1']]),
    );
    expect(parsed.rows).toEqual([
      { task_id: 't1', status: 'IP', assignee_role: 'artist' },
      { task_id: 't2', priority: 'high', assignee_role: 'artist' },
    ]);
    expect(parsed.undoRows).toEqual([
      { task_id: 't1', status: 'RDY', assignee_role: 'artist' },
      { task_id: 't2', priority: 'normal', assignee_role: 'artist' },
    ]);
    expect(parsed.ignoredCells).toBe(1);
  });
});
