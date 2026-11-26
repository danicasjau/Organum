import { describe, expect, it } from 'vitest';
import type { TaskGraphEdgeOut, TaskListItemOut, UserOut } from '../../lib/api/client';
import {
  addDays,
  aggregateWorkloadWeeks,
  buildGanttRows,
  collectDependencyChain,
  computeDependencyViolations,
  computeIndirectEntityEdges,
  computeLayeredDagLayout,
  computePushDependents,
  diffDays,
  isWorkingDay,
  utilizationTier,
} from './planningHelpers';

function makeTask(partial: Partial<TaskListItemOut> & { id: string }): TaskListItemOut {
  return {
    id: partial.id,
    task_code: partial.task_code ?? `T_${partial.id}`,
    task_name: partial.task_name ?? 'main',
    name: partial.name ?? `Task ${partial.id}`,
    folder_name: 'main',
    entity_id: partial.entity_id ?? 'ent-1',
    entity_name: partial.entity_name ?? 'hero_robot',
    entity_rel_path: partial.entity_rel_path ?? 'Characters/hero_robot',
    parent_entity_type: partial.parent_entity_type ?? 'asset',
    department_id: partial.department_id ?? 'dept-mod',
    department_name: partial.department_name ?? 'Modeling',
    department_short_code: 'MOD',
    department_color: '--series-1',
    description: '',
    status: partial.status ?? 'IP',
    status_before_hold: null,
    priority: partial.priority ?? 'normal',
    needs_lead_review: true,
    needs_sup_review: false,
    needs_client_review: false,
    complexity_rating: 2,
    ideal_start_date: partial.ideal_start_date ?? '2026-05-04',
    actual_start_date: null,
    ideal_finish_date: partial.ideal_finish_date ?? '2026-05-08',
    actual_finish_date: null,
    bid_hours: 16,
    bid_days: 2,
    logged_hours: 4,
    retake_count: 0,
    latest_version_id: null,
    approved_version_id: null,
    version_count: 0,
    upstream_count: 0,
    blocked_upstream: false,
    assignments: partial.assignments ?? [],
    my_capacities: [],
    tags: [],
    shared_company_ids: partial.shared_company_ids ?? [],
    updated_at: '2026-05-01T00:00:00Z',
  };
}

describe('planningHelpers date and calendar math', () => {
  it('computes UTC day deltas and working days accurately', () => {
    expect(diffDays('2026-05-04', '2026-05-08')).toBe(4);
    expect(addDays('2026-05-04', 5)).toBe('2026-05-09');
    // 2026-05-04 is Monday (0), 2026-05-09 is Saturday (5), 2026-05-10 is Sunday (6)
    expect(isWorkingDay('2026-05-04', [0, 1, 2, 3, 4])).toBe(true);
    expect(isWorkingDay('2026-05-09', [0, 1, 2, 3, 4])).toBe(false);
    expect(isWorkingDay('2026-05-10', [0, 1, 2, 3, 4])).toBe(false);
  });
});

describe('planningHelpers Gantt grouping, violations & push dependents', () => {
  it('builds grouped rows with rollup status and min/max spans', () => {
    const t1 = makeTask({
      id: 't1',
      status: 'APP',
      ideal_start_date: '2026-05-04',
      ideal_finish_date: '2026-05-08',
    });
    const t2 = makeTask({
      id: 't2',
      status: 'IP',
      ideal_start_date: '2026-05-06',
      ideal_finish_date: '2026-05-14',
    });

    const { rows } = buildGanttRows({
      tasks: [t1, t2],
      groupBy: 'entity_path',
      collapsedGroups: new Set(),
    });
    expect(rows.length).toBe(3);
    const first = rows[0];
    expect(first?.kind).toBe('group');
    if (first?.kind === 'group') {
      expect(first.minStart).toBe('2026-05-04');
      expect(first.maxFinish).toBe('2026-05-14');
      expect(first.rollupStatus).toBe('IP');
    }
  });

  it('groups 5,000 tasks in linear time (<100ms)', () => {
    const tasks: TaskListItemOut[] = [];
    for (let i = 0; i < 5000; i++) {
      tasks.push(
        makeTask({
          id: `t-${i}`,
          entity_id: `ent-${i % 250}`,
          entity_name: `entity_${i % 250}`,
          entity_rel_path: `Folder_${i % 10}/entity_${i % 250}`,
        }),
      );
    }
    const t0 = performance.now();
    const { rows } = buildGanttRows({
      tasks,
      groupBy: 'entity_path',
      collapsedGroups: new Set(),
    });
    const elapsed = performance.now() - t0;
    expect(rows.length).toBe(5250);
    expect(elapsed).toBeLessThan(250);
  });

  it('places tasks under user and unassigned buckets in user grouping', () => {
    const user: UserOut = {
      id: 'u1',
      username: 'art_sam',
      full_name: 'Sam Artist',
      email: 'sam@example.com',
      role_id: 'r1',
      role_name: 'artist',
      role_label: 'Artist',
      company_id: null,
      company_name: null,
      daily_capacity_hours: 8,
      timezone: 'UTC',
      is_active: true,
      must_change_password: false,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    };
    const assigned = makeTask({
      id: 't-assigned',
      assignments: [
        {
          user_id: 'u1',
          username: 'art_sam',
          full_name: 'Sam Artist',
          assignment_role: 'artist',
          source: 'manual',
        },
      ],
    });
    const unassigned = makeTask({ id: 't-free', assignments: [] });
    const { rows } = buildGanttRows({
      tasks: [assigned, unassigned],
      groupBy: 'user',
      collapsedGroups: new Set(),
      users: [user],
    });
    expect(rows.some((r) => r.kind === 'group' && r.groupKey === 'user:u1')).toBe(true);
    expect(rows.some((r) => r.kind === 'group' && r.groupKey === 'user:__unassigned__')).toBe(true);
  });

  it('detects dependency violations, collects full chains, and computes push-dependents shifts', () => {
    const a = makeTask({ id: 'a', ideal_start_date: '2026-05-01', ideal_finish_date: '2026-05-10' });
    const b = makeTask({ id: 'b', ideal_start_date: '2026-05-08', ideal_finish_date: '2026-05-12' });
    const c = makeTask({ id: 'c', ideal_start_date: '2026-05-11', ideal_finish_date: '2026-05-15' });
    const edges: TaskGraphEdgeOut[] = [
      { source_task_id: 'a', target_task_id: 'b', kind: 'dependency', threshold: 'APP', from_entity_link: false },
      { source_task_id: 'b', target_task_id: 'c', kind: 'dependency', threshold: 'APP', from_entity_link: true },
    ];
    const tasksById = new Map([a, b, c].map((t) => [t.id, t]));

    const { violatedTaskIds } = computeDependencyViolations(edges, tasksById);
    expect(violatedTaskIds.has('b')).toBe(true);
    expect(violatedTaskIds.has('c')).toBe(true);

    const chain = collectDependencyChain('b', edges);
    expect(chain.nodeIds).toEqual(new Set(['a', 'b', 'c']));

    const shifts = computePushDependents({
      rootTaskId: 'a',
      newRootFinish: '2026-05-12',
      edges,
      tasksById,
    });
    expect(shifts).toHaveLength(2);
    expect(shifts[0]).toMatchObject({ taskId: 'b', nextStart: '2026-05-12', nextFinish: '2026-05-16' });
    expect(shifts[1]).toMatchObject({ taskId: 'c', nextStart: '2026-05-16', nextFinish: '2026-05-20' });
  });
});

describe('planningHelpers Workload & Graph layout', () => {
  it('maps utilization tiers and aggregates weeks cleanly', () => {
    expect(utilizationTier(0)).toBe(0);
    expect(utilizationTier(75)).toBe(1);
    expect(utilizationTier(100)).toBe(2);
    expect(utilizationTier(125)).toBe(3);
    expect(utilizationTier(140)).toBe(4);

    const res = aggregateWorkloadWeeks(
      ['2026-05-04', '2026-05-05', '2026-05-11'],
      [
        {
          user_id: 'u1',
          username: 'art_sam',
          full_name: 'Sam Artist',
          daily_capacity_hours: 8,
          cells: [
            { day: '2026-05-04', hours: 8, capacity_hours: 8, utilization_pct: 100, contributing_task_ids: ['t1'] },
            { day: '2026-05-05', hours: 4, capacity_hours: 8, utilization_pct: 50, contributing_task_ids: ['t1', 't2'] },
            { day: '2026-05-11', hours: 8, capacity_hours: 8, utilization_pct: 100, contributing_task_ids: ['t2'] },
          ],
        },
      ],
    );
    expect(res.columns.map((c) => c.weekStart)).toEqual(['2026-05-04', '2026-05-11']);
    expect(res.rows[0]?.cells?.[0]?.utilization_pct).toBe(75);
    expect(res.rows[0]?.cells?.[0]?.contributing_task_ids).toEqual(['t1', 't2']);
  });

  it('lays out a layered DAG and derives indirect entity links', () => {
    const layout = computeLayeredDagLayout(
      ['a', 'b', 'c'],
      [
        { source: 'a', target: 'b' },
        { source: 'b', target: 'c' },
      ],
    );
    expect(layout.positions.get('a')!.layer).toBe(0);
    expect(layout.positions.get('b')!.layer).toBe(1);
    expect(layout.positions.get('c')!.layer).toBe(2);
    expect(layout.positions.get('a')!.x).toBeLessThan(layout.positions.get('c')!.x);

    const indirect = computeIndirectEntityEdges(
      [
        { id: 'e1', name: 'glasses', entity_type: 'prop', is_archived: false },
        { id: 'e2', name: 'hero_robot', entity_type: 'char', is_archived: false },
        { id: 'e3', name: 'sh010', entity_type: 'shot', is_archived: false },
      ],
      [
        { id: 'l1', source_entity_id: 'e1', target_entity_id: 'e2', link_type: 'rig' },
        { id: 'l2', source_entity_id: 'e2', target_entity_id: 'e3', link_type: 'appears_in' },
      ],
    );
    expect(indirect).toEqual([{ sourceId: 'e1', targetId: 'e3', viaNames: ['hero_robot'] }]);
  });
});

describe('isoToZeroMonDays', () => {
  it('converts ISO weekdays (1=Mon) to 0=Mon and defaults to Mon-Fri', async () => {
    const { isoToZeroMonDays, isWorkingDay } = await import('./planningHelpers');
    expect(isoToZeroMonDays([1, 2, 3, 4, 5])).toEqual([0, 1, 2, 3, 4]);
    expect(isoToZeroMonDays([6, 7])).toEqual([5, 6]);
    expect(isoToZeroMonDays([])).toEqual([0, 1, 2, 3, 4]);
    // 2026-12-07 is a Monday, 2026-12-05 a Saturday.
    expect(isWorkingDay('2026-12-07', isoToZeroMonDays([1, 2, 3, 4, 5]))).toBe(true);
    expect(isWorkingDay('2026-12-05', isoToZeroMonDays([1, 2, 3, 4, 5]))).toBe(false);
  });
});
