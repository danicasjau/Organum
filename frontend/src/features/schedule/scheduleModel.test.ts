import { describe, expect, it } from 'vitest';
import {
  addWorkingDays,
  computeCollisionPush,
  lateTaskIds,
  nextWorkingDay,
  overlayMilestones,
  overlayTasks,
  workingSpan,
} from './scheduleModel';

const WD = [0, 1, 2, 3, 4]; // Mon..Fri
// 2030-01-07 is a Monday.

describe('working-day maths', () => {
  it('skips weekends', () => {
    expect(nextWorkingDay('2030-01-12', WD)).toBe('2030-01-14'); // Sat -> Mon
    expect(nextWorkingDay('2030-01-09', WD)).toBe('2030-01-09');
    expect(workingSpan('2030-01-10', '2030-01-15', WD)).toBe(4); // Thu..Tue
    expect(addWorkingDays('2030-01-10', 4, WD)).toBe('2030-01-15');
    expect(addWorkingDays('2030-01-12', 1, WD)).toBe('2030-01-14');
  });
});

describe('collision push', () => {
  const tasks = new Map([
    ['a', { id: 'a', task_code: 'A', ideal_start_date: '2030-01-07', ideal_finish_date: '2030-01-08' }],
    ['b', { id: 'b', task_code: 'B', ideal_start_date: '2030-01-09', ideal_finish_date: '2030-01-10' }],
    ['c', { id: 'c', task_code: 'C', ideal_start_date: '2030-01-11', ideal_finish_date: '2030-01-11' }],
    ['u', { id: 'u', task_code: 'U', ideal_start_date: '2030-01-01', ideal_finish_date: '2030-01-04' }],
  ]);
  const edges = [
    { source_task_id: 'u', target_task_id: 'a', kind: 'dependency' },
    { source_task_id: 'a', target_task_id: 'b', kind: 'dependency' },
    { source_task_id: 'b', target_task_id: 'c', kind: 'dependency' },
    { source_task_id: 'a', target_task_id: 'c', kind: 'link' }, // links never push
  ];

  it('pushes the downstream chain in working days', () => {
    const res = computeCollisionPush({
      rootId: 'a',
      start: '2030-01-09',
      finish: '2030-01-10',
      edges,
      tasksById: tasks,
      workingDays: WD,
      canEdit: () => true,
    });
    expect(res.error).toBeUndefined();
    // B (2 working days) moves to Thu 10th..Fri 11th. C starts Fri 11th, the day B now
    // finishes, which the dependency rule allows (start >= upstream finish): not pushed.
    expect(res.patches).toEqual([{ taskId: 'b', start: '2030-01-10', finish: '2030-01-11' }]);
    const further = computeCollisionPush({
      rootId: 'a',
      start: '2030-01-10',
      finish: '2030-01-11',
      edges,
      tasksById: tasks,
      workingDays: WD,
      canEdit: () => true,
    });
    // B -> Fri 11th..Mon 14th (weekend skipped), then C -> Mon 14th.
    expect(further.patches).toEqual([
      { taskId: 'b', start: '2030-01-11', finish: '2030-01-14' },
      { taskId: 'c', start: '2030-01-14', finish: '2030-01-14' },
    ]);
  });

  it('jumps over weekends', () => {
    const res = computeCollisionPush({
      rootId: 'a',
      start: '2030-01-10',
      finish: '2030-01-12', // Saturday finish
      edges,
      tasksById: tasks,
      workingDays: WD,
      canEdit: () => true,
    });
    expect(res.patches[0]).toEqual({ taskId: 'b', start: '2030-01-14', finish: '2030-01-15' });
  });

  it('does nothing when there is no collision', () => {
    const res = computeCollisionPush({
      rootId: 'a',
      start: '2030-01-07',
      finish: '2030-01-08',
      edges,
      tasksById: tasks,
      workingDays: WD,
      canEdit: () => true,
    });
    expect(res.patches).toEqual([]);
  });

  it('refuses moves it cannot resolve', () => {
    const early = computeCollisionPush({
      rootId: 'a',
      start: '2030-01-02',
      finish: '2030-01-03',
      edges,
      tasksById: tasks,
      workingDays: WD,
      canEdit: () => true,
    });
    expect(early.error).toMatch(/cannot start before upstream U/);
    const locked = computeCollisionPush({
      rootId: 'a',
      start: '2030-01-09',
      finish: '2030-01-10',
      edges,
      tasksById: tasks,
      workingDays: WD,
      canEdit: (id) => id !== 'b',
    });
    expect(locked).toEqual({ patches: [], error: 'Pushing would move B, which you cannot edit' });
    const loop = computeCollisionPush({
      rootId: 'a',
      start: '2030-01-09',
      finish: '2030-01-10',
      edges: [...edges, { source_task_id: 'c', target_task_id: 'a', kind: 'dependency' }],
      tasksById: new Map([...tasks].filter(([k]) => k !== 'u')),
      workingDays: WD,
      canEdit: () => true,
    });
    // A cycle is refused (here caught as C being upstream of A).
    expect(loop.patches).toEqual([]);
    expect(loop.error).toMatch(/loop|upstream C/);
  });
});

describe('draft overlays', () => {
  it('applies task dates and assignments', () => {
    const { tasks, draftIds } = overlayTasks(
      [
        { id: 't1', ideal_start_date: '2030-01-01', ideal_finish_date: '2030-01-02' },
        { id: 't2', ideal_start_date: '2030-01-01', ideal_finish_date: '2030-01-02' },
      ],
      [
        { kind: 'task', op: 'update', target_id: 't1', payload: { finish: '2030-01-05' } },
        { kind: 'task', op: 'assign', target_id: 't1', payload: { assignments: [['u1', 'lead']] } },
      ],
    );
    expect(tasks[0]).toMatchObject({
      ideal_finish_date: '2030-01-05',
      assignments: [{ user_id: 'u1', assignment_role: 'lead' }],
    });
    expect(tasks[1]!.ideal_finish_date).toBe('2030-01-02');
    expect([...draftIds]).toEqual(['t1']);
  });

  it('applies milestone create/update/delete', () => {
    const base = [
      { id: 'm1', name: 'A', date: '2030-02-01', kind: 'milestone' as const, target_kind: 'none' },
      { id: 'm2', name: 'B', date: '2030-03-01', kind: 'deliver' as const, target_kind: 'none' },
    ];
    const out = overlayMilestones(base, [
      { kind: 'milestone', op: 'update', target_id: 'm1', payload: { date: '2030-04-01' } },
      { kind: 'milestone', op: 'delete', target_id: 'm2' },
      {
        kind: 'milestone',
        op: 'create',
        target_id: 'm3',
        payload: { name: 'C', date: '2030-01-15', kind: 'deliver', target_kind: 'none' },
      },
    ]);
    expect(out.map((m) => [m.id, m.date, Boolean(m.draft)])).toEqual([
      ['m3', '2030-01-15', true],
      ['m1', '2030-04-01', true],
    ]);
  });
});

describe('milestone lateness', () => {
  const tasks = [
    {
      id: 't1',
      ideal_finish_date: '2030-01-10',
      department_id: 'd1',
      entity_id: 'e1',
      assignments: [{ user_id: 'u1', assignment_role: 'artist' }],
    },
    { id: 't2', ideal_finish_date: '2030-01-03', department_id: 'd1', entity_id: 'e2' },
  ];
  it('matches each target kind', () => {
    const m = { date: '2030-01-05', target_kind: 'none', target_id: null };
    expect(lateTaskIds(m, tasks)).toEqual(['t1']);
    expect(lateTaskIds({ ...m, target_kind: 'department', target_id: 'd1' }, tasks)).toEqual(['t1']);
    expect(lateTaskIds({ ...m, target_kind: 'entity', target_id: 'e2' }, tasks)).toEqual([]);
    expect(lateTaskIds({ ...m, target_kind: 'user', target_id: 'u1' }, tasks)).toEqual(['t1']);
    expect(
      lateTaskIds({ ...m, target_kind: 'company', target_id: 'c1' }, tasks, new Map([['u1', 'c1']])),
    ).toEqual(['t1']);
    expect(lateTaskIds({ ...m, target_kind: 'task', target_id: 't2' }, tasks)).toEqual([]);
  });
});
