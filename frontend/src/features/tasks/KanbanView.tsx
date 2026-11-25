import { useQueryClient } from '@tanstack/react-query';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useMemo, useRef, useState } from 'react';
import {
  Avatar,
  Badge,
  CapacityBadgeList,
  PriorityMarker,
  Select,
  StatusChip,
  Text,
  useToast,
} from '../../components/ui';
import { useCssVarRef } from '../../components/ui/_internal/useCssVar';
import {
  apiClient,
  type ClientProductOut,
  type ProductVersionOut,
  type TaskListItemOut,
} from '../../lib/api/client';
import { useProjectStore } from '../project/projectStore';
import { ALL_WORKFLOW_STATUSES, isOverdueDate } from './taskHelpers';
import { useTasksStore, type KanbanSwimlane } from './tasksStore';
import { TaskTransitionDialog } from './TaskTransitionDialog';
import './KanbanView.css';
import { DepartmentTag } from '../departments/DepartmentTag';
import { TaskUnreadDot } from '../reviews/TaskUnreadDot';

function KanbanProgressFill({ logged, bid }: { logged: number; bid: number | null | undefined }) {
  const ref = useRef<HTMLDivElement>(null);
  const pct = bid && bid > 0 ? Math.min(100, Math.round((logged / bid) * 100)) : 0;
  useCssVarRef(ref, '--kv-fill-pct', `${pct}%`);
  return (
    <div className="org-kanban__progress" title={`${logged}h / ${bid ?? 0}h`}>
      <div ref={ref} className="org-kanban__progress-fill" />
    </div>
  );
}

function KanbanCard({
  task,
  selected,
  onSelect,
  onDragStartTask,
}: {
  task: TaskListItemOut;
  selected: boolean;
  onSelect: () => void;
  onDragStartTask: (task: TaskListItemOut) => void;
}) {
  const overdue = isOverdueDate(task.ideal_finish_date, task.status);
  return (
    <div
      draggable
      tabIndex={0}
      role="button"
      data-task-id={task.id}
      data-selected={selected ? 'true' : undefined}
      className="org-kanban__card"
      onClick={onSelect}
      onDragStart={(e) => {
        e.dataTransfer.setData('text/plain', task.id);
        e.dataTransfer.effectAllowed = 'move';
        onDragStartTask(task);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelect();
        }
      }}
    >
      <div className="org-kanban__card-top">
        <span className="org-kanban__code">{task.task_code}</span>
        <TaskUnreadDot
          taskId={task.id}
          feedbackAt={task.last_feedback_at}
          by={task.last_feedback_by}
        />
        <PriorityMarker priority={task.priority ?? 'normal'} />
      </div>
      <div className="org-kanban__card-entity">
        <Text size="sm">{task.entity_name}</Text>
        <DepartmentTag
          id={task.department_id}
          name={task.department_name}
          color={task.department_color}
          label={task.department_short_code || task.department_name}
        />
      </div>
      <div className="org-kanban__card-meta">
        <CapacityBadgeList capacities={task.my_capacities ?? []} />
        {task.blocked_upstream && <Badge tone="danger">Blocked</Badge>}
      </div>
      <div className="org-kanban__card-foot">
        <div className="org-kanban__avatars">
          {(task.assignments ?? []).slice(0, 3).map((a) => (
            <Avatar
              key={`${a.user_id}-${a.assignment_role}`}
              username={a.username}
              fullName={`${a.full_name} (${a.assignment_role})`}
              size="sm"
            />
          ))}
        </div>
        <Text size="sm" variant={overdue ? 'danger' : 'muted'}>
          {task.ideal_finish_date ?? '—'}
        </Text>
      </div>
      <KanbanProgressFill logged={task.logged_hours ?? 0} bid={task.bid_hours} />
    </div>
  );
}

function VirtualKanbanColumn({
  status,
  tasks,
  selectedTaskId,
  dragOver,
  onSelectTask,
  onDragStartTask,
  onDragOverCol,
  onDropCol,
}: {
  status: string;
  tasks: ReadonlyArray<TaskListItemOut>;
  selectedTaskId: string | null;
  dragOver: boolean;
  onSelectTask: (id: string) => void;
  onDragStartTask: (task: TaskListItemOut) => void;
  onDragOverCol: (status: string | null) => void;
  onDropCol: (status: string, taskId: string) => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const vizer = useVirtualizer({
    count: tasks.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 86,
    overscan: 6,
  });

  return (
    <div
      className="org-kanban__col"
      data-status={status}
      data-drop-active={dragOver ? 'true' : undefined}
      onDragOver={(e) => {
        e.preventDefault();
        onDragOverCol(status);
      }}
      onDragLeave={() => onDragOverCol(null)}
      onDrop={(e) => {
        e.preventDefault();
        onDragOverCol(null);
        const taskId = e.dataTransfer.getData('text/plain');
        if (taskId) onDropCol(status, taskId);
      }}
    >
      <div className="org-kanban__col-hdr">
        <StatusChip status={status} compact />
        <Badge tone="neutral">{tasks.length}</Badge>
      </div>
      <div ref={scrollRef} className="org-kanban__col-body">
        <VirtualInnerContainer totalSize={vizer.getTotalSize()}>
          {vizer.getVirtualItems().map((vRow) => {
            const task = tasks[vRow.index]!;
            return (
              <VirtualCardSlot key={task.id} start={vRow.start}>
                <KanbanCard
                  task={task}
                  selected={task.id === selectedTaskId}
                  onSelect={() => onSelectTask(task.id)}
                  onDragStartTask={onDragStartTask}
                />
              </VirtualCardSlot>
            );
          })}
        </VirtualInnerContainer>
      </div>
    </div>
  );
}

function VirtualInnerContainer({
  totalSize,
  children,
}: {
  totalSize: number;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useCssVarRef(ref, '--kv-total-h', `${totalSize}px`);
  return (
    <div ref={ref} className="org-kanban__vlist">
      {children}
    </div>
  );
}

function VirtualCardSlot({ start, children }: { start: number; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useCssVarRef(ref, '--kv-offset', `${start}px`);
  return (
    <div ref={ref} className="org-kanban__vrow">
      {children}
    </div>
  );
}

export function KanbanView({
  tasks,
  selectedTaskId,
  onSelectTask,
}: {
  tasks: ReadonlyArray<TaskListItemOut>;
  selectedTaskId: string | null;
  onSelectTask: (taskId: string) => void;
}) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const activeProjectUuid = useProjectStore((s) => s.activeProjectUuid);
  const swimlane = useTasksStore((s) => s.kanbanSwimlane);
  const setSwimlane = useTasksStore((s) => s.setKanbanSwimlane);

  const [dragOverStatus, setDragOverStatus] = useState<string | null>(null);
  const [draggingTask, setDraggingTask] = useState<TaskListItemOut | null>(null);
  const [promptState, setPromptState] = useState<{
    task: TaskListItemOut;
    targetStatus: string;
    requiresComment: boolean;
    requiresVersion: boolean;
    versions: Array<ProductVersionOut | NonNullable<ClientProductOut['versions']>[number]>;
    actedAs: string;
  } | null>(null);

  const taskMap = useMemo(() => {
    const m = new Map<string, TaskListItemOut>();
    for (const t of tasks) m.set(t.id, t);
    return m;
  }, [tasks]);

  const byStatus = useMemo(() => {
    const buckets: Record<string, TaskListItemOut[]> = {};
    for (const st of ALL_WORKFLOW_STATUSES) buckets[st] = [];
    for (const t of tasks) {
      if (!buckets[t.status]) buckets[t.status] = [];
      buckets[t.status]!.push(t);
    }
    return buckets;
  }, [tasks]);

  const swimlaneGroups = useMemo(() => {
    if (swimlane === 'none') {
      return [{ key: 'all', label: 'All Tasks', items: tasks }];
    }
    const groups = new Map<string, { key: string; label: string; items: TaskListItemOut[] }>();
    for (const t of tasks) {
      if (swimlane === 'department') {
        const key = t.department_id;
        if (!groups.has(key)) groups.set(key, { key, label: t.department_name, items: [] });
        groups.get(key)!.items.push(t);
      } else {
        const first = t.assignments?.[0];
        const key = first ? first.user_id : 'unassigned';
        const label = first ? first.full_name : 'Unassigned';
        if (!groups.has(key)) groups.set(key, { key, label, items: [] });
        groups.get(key)!.items.push(t);
      }
    }
    return Array.from(groups.values()).sort((a, b) => a.label.localeCompare(b.label));
  }, [tasks, swimlane]);

  const invalidateTasks = async (taskId: string) => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['tasks', activeProjectUuid] }),
      queryClient.invalidateQueries({ queryKey: ['task', activeProjectUuid, taskId] }),
      queryClient.invalidateQueries({ queryKey: ['review-queue', activeProjectUuid] }),
      queryClient.invalidateQueries({ queryKey: ['my-tasks', activeProjectUuid] }),
    ]);
  };

  const handleDropToStatus = async (targetStatus: string, taskId: string) => {
    const task = taskMap.get(taskId) ?? draggingTask;
    setDraggingTask(null);
    if (!task || task.status === targetStatus) return;

    try {
      const det = await apiClient.getTask(task.id, activeProjectUuid);
      const match = (det.allowed_transitions ?? []).find((opt) => opt.to === targetStatus);
      if (!match) {
        toast.push(
          'danger',
          `Cannot move ${task.task_code} directly from ${task.status} to ${targetStatus}`,
        );
        return;
      }
      if (match.requires_comment || match.requires_version) {
        setPromptState({
          task,
          targetStatus,
          requiresComment: match.requires_comment,
          requiresVersion: match.requires_version,
          versions: det.product?.versions ?? [],
          actedAs: match.acted_as,
        });
        return;
      }
      await apiClient.transitionTask(task.id, { to: targetStatus }, activeProjectUuid);
      await invalidateTasks(task.id);
      toast.push('success', `${task.task_code} -> ${targetStatus}`);
    } catch (err) {
      toast.push('danger', err instanceof Error ? err.message : 'Transition refused');
    }
  };

  return (
    <div className="org-kanban" data-ui="kanban-view">
      <div className="org-kanban__toolbar">
        <Text size="sm" variant="accent">
          Kanban ({tasks.length} tasks)
        </Text>
        <div className="org-kanban__lane-ctrl">
          <Text size="sm" variant="muted">
            Swimlanes:
          </Text>
          <Select
            ariaLabel="Kanban swimlanes"
            value={swimlane}
            onChange={(v) => setSwimlane(v as KanbanSwimlane)}
            options={[
              { value: 'none', label: 'None' },
              { value: 'department', label: 'By Department' },
              { value: 'assignee', label: 'By Assignee' },
            ]}
          />
        </div>
      </div>

      {swimlane === 'none' ? (
        <div className="org-kanban__board">
          {ALL_WORKFLOW_STATUSES.map((st) => (
            <VirtualKanbanColumn
              key={st}
              status={st}
              tasks={byStatus[st] ?? []}
              selectedTaskId={selectedTaskId}
              dragOver={dragOverStatus === st}
              onSelectTask={onSelectTask}
              onDragStartTask={setDraggingTask}
              onDragOverCol={setDragOverStatus}
              onDropCol={(target, id) => void handleDropToStatus(target, id)}
            />
          ))}
        </div>
      ) : (
        <div className="org-kanban__swim-scroll">
          {swimlaneGroups.map((lane) => (
            <div key={lane.key} className="org-kanban__swimlane">
              <div className="org-kanban__swim-hdr">
                <Text size="sm" variant="accent">
                  {lane.label}
                </Text>
                <Badge tone="neutral">{lane.items.length}</Badge>
              </div>
              <div className="org-kanban__board org-kanban__board--lane">
                {ALL_WORKFLOW_STATUSES.map((st) => {
                  const laneTasks = lane.items.filter((t) => t.status === st);
                  return (
                    <div
                      key={`${lane.key}-${st}`}
                      className="org-kanban__col"
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={(e) => {
                        e.preventDefault();
                        const taskId = e.dataTransfer.getData('text/plain');
                        if (taskId) void handleDropToStatus(st, taskId);
                      }}
                    >
                      <div className="org-kanban__col-hdr">
                        <StatusChip status={st} compact />
                        <Badge tone="neutral">{laneTasks.length}</Badge>
                      </div>
                      <div className="org-kanban__lane-cards">
                        {laneTasks.map((t) => (
                          <KanbanCard
                            key={t.id}
                            task={t}
                            selected={t.id === selectedTaskId}
                            onSelect={() => onSelectTask(t.id)}
                            onDragStartTask={setDraggingTask}
                          />
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      <TaskTransitionDialog
        open={Boolean(promptState)}
        onOpenChange={(o) => {
          if (!o) setPromptState(null);
        }}
        taskCode={promptState?.task.task_code ?? ''}
        taskName={promptState?.task.task_name ?? ''}
        targetStatus={promptState?.targetStatus ?? ''}
        actionLabel={`Move to ${promptState?.targetStatus ?? ''}`}
        actedAsLabel={promptState?.actedAs ?? ''}
        requiresComment={Boolean(promptState?.requiresComment)}
        requiresVersion={Boolean(promptState?.requiresVersion)}
        versions={promptState?.versions ?? []}
        defaultVersionId={promptState?.task.latest_version_id}
        onSubmit={async ({ version_id, comment }) => {
          if (!promptState) return;
          await apiClient.transitionTask(
            promptState.task.id,
            {
              to: promptState.targetStatus,
              version_id: version_id ?? null,
              comment: comment ?? null,
            },
            activeProjectUuid,
          );
          await invalidateTasks(promptState.task.id);
          toast.push('success', `${promptState.task.task_code} -> ${promptState.targetStatus}`);
        }}
      />
    </div>
  );
}
