import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Badge,
  Button,
  CapacityBadgeList,
  Dialog,
  NumberField,
  PriorityMarker,
  SearchField,
  Select,
  Spinner,
  Stack,
  StatusChip,
  Text,
  TextField,
  useToast,
} from '../../components/ui';
import { useCssVarRef } from '../../components/ui/_internal/useCssVar';
import {
  apiClient,
  type ClientProductOut,
  type ProductVersionOut,
  type TaskListItemOut,
} from '../../lib/api/client';
import { useAuthStore } from '../auth/authStore';
import { useProjectStore } from '../project/projectStore';
import { ReviewQueueView } from '../tasks/ReviewQueueView';
import { categorizeMyTasks, isOverdueDate, PRIORITY_OPTIONS } from '../tasks/taskHelpers';
import { TaskTransitionDialog } from '../tasks/TaskTransitionDialog';
import './MyTasksInbox.css';
import { DepartmentTag } from '../departments/DepartmentTag';
import { TaskUnreadDot } from '../reviews/TaskUnreadDot';

type CapacityFilter = 'all' | 'artist' | 'lead' | 'supervisor';

const CAPACITY_TITLES: Record<
  Exclude<CapacityFilter, 'all'>,
  { code: 'artist' | 'lead' | 'supervisor'; title: string }
> = {
  artist: { code: 'artist', title: 'I DO (Artist Execution)' },
  lead: { code: 'lead', title: 'I LEAD (Lead Coordination & First Review)' },
  supervisor: { code: 'supervisor', title: 'I SUPERVISE (Department Supervision & Approvals)' },
};

function InboxProgressFill({ logged, bid }: { logged: number; bid: number | null | undefined }) {
  const ref = useRef<HTMLDivElement>(null);
  const pct = bid && bid > 0 ? Math.min(100, Math.round((logged / bid) * 100)) : 0;
  useCssVarRef(ref, '--inbox-pct', `${pct}%`);
  return (
    <div className="org-inbox__bar">
      <div ref={ref} className="org-inbox__bar-fill" />
    </div>
  );
}

export interface MyTasksInboxProps {
  /** When set, cards are selectable and the review queue is left to the caller. */
  selectedTaskId?: string | null;
  onSelectTask?: (taskId: string) => void;
  /** Hide the embedded review queue (the /me page shows it in its preview column). */
  hideReviewQueue?: boolean;
}

export function MyTasksInbox({
  selectedTaskId = null,
  onSelectTask,
  hideReviewQueue = false,
}: MyTasksInboxProps = {}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const toast = useToast();
  const auth = useAuthStore((s) => s.auth);
  const activeProjectUuid = useProjectStore((s) => s.activeProjectUuid);
  const isClient = auth?.user.role_name === 'client';

  const [capFilter, setCapFilter] = useState<CapacityFilter>('all');
  const [search, setSearch] = useState('');
  const [priorityFilter, setPriorityFilter] = useState('');
  const [logTarget, setLogTarget] = useState<TaskListItemOut | null>(null);
  const [logHours, setLogHours] = useState(2);
  const [logNote, setLogNote] = useState('');
  const [submitTarget, setSubmitTarget] = useState<{
    task: TaskListItemOut;
    toStatus: string;
    actionLabel: string;
    actedAs: string;
    requiresComment: boolean;
    requiresVersion: boolean;
    versions: Array<ProductVersionOut | NonNullable<ClientProductOut['versions']>[number]>;
  } | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['my-tasks', activeProjectUuid],
    queryFn: () => apiClient.getMyTasks(activeProjectUuid),
    enabled: Boolean(activeProjectUuid),
  });

  const filteredTasks = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (data?.tasks ?? []).filter((t) => {
      if (capFilter !== 'all' && !(t.my_capacities ?? []).includes(capFilter)) return false;
      if (priorityFilter && t.priority !== priorityFilter) return false;
      if (
        q &&
        !t.task_code.toLowerCase().includes(q) &&
        !t.task_name.toLowerCase().includes(q) &&
        !t.entity_name.toLowerCase().includes(q)
      ) {
        return false;
      }
      return true;
    });
  }, [data?.tasks, capFilter, priorityFilter, search]);

  const invalidateAll = async (taskId?: string) => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['my-tasks', activeProjectUuid] }),
      queryClient.invalidateQueries({ queryKey: ['tasks', activeProjectUuid] }),
      queryClient.invalidateQueries({ queryKey: ['review-queue', activeProjectUuid] }),
      ...(taskId
        ? [queryClient.invalidateQueries({ queryKey: ['task', activeProjectUuid, taskId] })]
        : []),
    ]);
  };

  const handleStart = async (task: TaskListItemOut) => {
    try {
      await apiClient.transitionTask(task.id, { to: 'IP' }, activeProjectUuid);
      await invalidateAll(task.id);
      toast.push('success', `Started ${task.task_code}`);
    } catch (err) {
      toast.push('danger', err instanceof Error ? err.message : 'Unable to start task');
    }
  };

  const handleOpenSubmit = async (
    task: TaskListItemOut,
    desiredAction: 'submit' | 'approve' | 'retake',
  ) => {
    try {
      const det = await apiClient.getTask(task.id, activeProjectUuid);
      const match = (det.allowed_transitions ?? []).find((o) => o.action === desiredAction);
      if (!match) {
        toast.push(
          'warning',
          `Action '${desiredAction}' is not available in status ${task.status}`,
        );
        return;
      }
      if (!match.requires_comment && !match.requires_version) {
        await apiClient.transitionTask(task.id, { to: match.to }, activeProjectUuid);
        await invalidateAll(task.id);
        toast.push('success', `${task.task_code} -> ${match.to}`);
        return;
      }
      setSubmitTarget({
        task,
        toStatus: match.to,
        actionLabel: desiredAction === 'submit' ? `Submit to ${match.to}` : match.action,
        actedAs: match.acted_as,
        requiresComment: match.requires_comment,
        requiresVersion: match.requires_version,
        versions: det.product?.versions ?? [],
      });
    } catch (err) {
      toast.push('danger', err instanceof Error ? err.message : 'Unable to load transitions');
    }
  };

  const renderTaskCard = (task: TaskListItemOut, capFocus?: 'artist' | 'lead' | 'supervisor') => {
    const overdue = isOverdueDate(task.ideal_finish_date, task.status);
    const caps = task.my_capacities ?? [];
    const canDo = caps.includes('artist') || caps.includes('lead');
    const canReview = caps.includes('lead') || caps.includes('supervisor');
    const inReview =
      task.status === 'P_LEAD' || task.status === 'P_SUP' || task.status === 'P_CLIENT';

    return (
      <div
        key={`${capFocus ?? 'any'}-${task.id}`}
        className="org-inbox__card"
        data-ui="my-task-card"
        data-task-id={task.id}
        data-selected={selectedTaskId === task.id ? 'true' : undefined}
        aria-current={selectedTaskId === task.id ? 'true' : undefined}
        onClick={(ev) => {
          // Buttons inside the card keep their own actions.
          if (!onSelectTask || (ev.target as HTMLElement).closest('button, a, input')) return;
          onSelectTask(task.id);
        }}
      >
        <div className="org-inbox__card-top">
          <span className="org-inbox__code">{task.task_code}</span>
          <TaskUnreadDot
            taskId={task.id}
            feedbackAt={task.last_feedback_at}
            by={task.last_feedback_by}
          />
          <StatusChip status={task.status} compact />
          <PriorityMarker priority={task.priority ?? 'normal'} />
          <CapacityBadgeList capacities={caps} />
        </div>
        <div className="org-inbox__card-sub">
          <span className="org-inbox__line">
            <DepartmentTag
              id={task.department_id}
              name={task.department_name}
              color={task.department_color}
            />
            <Text size="sm">
              {task.entity_name} — {task.name}
            </Text>
          </span>
          <Text size="sm" variant={overdue ? 'danger' : 'muted'}>
            Due: {task.ideal_finish_date ?? '—'} · Bid {task.bid_hours ?? 0}h / Logged{' '}
            {task.logged_hours ?? 0}h
          </Text>
        </div>
        {task.description && (
          <Text size="sm" variant="muted">
            {task.description}
          </Text>
        )}
        <InboxProgressFill logged={task.logged_hours ?? 0} bid={task.bid_hours} />
        <div className="org-inbox__card-btns">
          {(task.status === 'RDY' || task.status === 'RTK') && canDo && (
            <Button size="sm" variant="primary" onClick={() => void handleStart(task)}>
              Start
            </Button>
          )}
          <Button
            size="sm"
            onClick={() => {
              setLogTarget(task);
              setLogHours(2);
              setLogNote('');
            }}
          >
            Log hours
          </Button>
          {(task.status === 'IP' || task.status === 'RTK') && canDo && (
            <Button
              size="sm"
              variant="primary"
              onClick={() => void handleOpenSubmit(task, 'submit')}
            >
              Submit for review
            </Button>
          )}
          {inReview && canReview && (
            <>
              <Button
                size="sm"
                variant="success"
                onClick={() => void handleOpenSubmit(task, 'approve')}
              >
                Approve
              </Button>
              <Button
                size="sm"
                variant="danger"
                onClick={() => void handleOpenSubmit(task, 'retake')}
              >
                Retake
              </Button>
            </>
          )}
          <Button size="sm" onClick={() => navigate(`/viewer?task=${task.id}`)}>
            Open in viewer
          </Button>
          <Button
            size="sm"
            onClick={() => {
              void apiClient
                .revealPath(`${task.entity_rel_path}/${task.department_name}`, activeProjectUuid)
                .catch((err) =>
                  toast.push('warning', err instanceof Error ? err.message : 'Reveal unavailable'),
                );
            }}
          >
            Open task folder
          </Button>
        </div>
      </div>
    );
  };

  if (isLoading) {
    return (
      <div className="org-inbox org-inbox--center">
        <Spinner label="Loading My Tasks" />
      </div>
    );
  }

  const groupsToRender: Array<'artist' | 'lead' | 'supervisor'> =
    capFilter === 'all' ? ['artist', 'lead', 'supervisor'] : [capFilter];

  return (
    <div className="org-inbox" data-ui="my-tasks-inbox">
      <div className="org-inbox__toolbar">
        <div className="org-inbox__capswitch" role="group" aria-label="Filter by capacity">
          {(
            [
              { id: 'all', label: 'All' },
              { id: 'artist', label: 'I DO' },
              { id: 'lead', label: 'I LEAD' },
              { id: 'supervisor', label: 'I SUPERVISE' },
            ] as const
          ).map((btn) => (
            <Button
              key={btn.id}
              size="sm"
              variant="toggle"
              pressed={capFilter === btn.id}
              onClick={() => setCapFilter(btn.id)}
            >
              {btn.label}
            </Button>
          ))}
        </div>
        <div className="org-inbox__filters">
          <div className="org-inbox__search">
            <SearchField
              ariaLabel="Search my tasks"
              placeholder="Search my tasks..."
              value={search}
              onChange={setSearch}
            />
          </div>
          {!isClient && (
            <Select
              ariaLabel="Filter my task priority"
              value={priorityFilter}
              onChange={setPriorityFilter}
              options={[
                { value: '', label: 'All Priority' },
                ...PRIORITY_OPTIONS.map((p) => ({ value: p.value, label: p.label })),
              ]}
            />
          )}
        </div>
      </div>

      <div className="org-inbox__scroll">
        {!hideReviewQueue && (data?.to_review?.length ?? 0) > 0 && (
          <div className="org-inbox__revwrap">
            <ReviewQueueView
              searchQuery={search}
              onOpenInViewer={({ taskId, fileId }) => {
                const qs = new URLSearchParams({ task: taskId });
                if (fileId) qs.set('file', fileId);
                navigate(`/viewer?${qs.toString()}`);
              }}
            />
          </div>
        )}

        {groupsToRender.map((capKey) => {
          const capTasks = filteredTasks.filter((t) => (t.my_capacities ?? []).includes(capKey));
          if (capTasks.length === 0) return null;
          const buckets = categorizeMyTasks(capTasks);
          const meta = CAPACITY_TITLES[capKey];
          const sections: Array<{ title: string; list: TaskListItemOut[] }> = [
            { title: 'Needs Attention', list: buckets.needsAttention },
            { title: 'This Week', list: buckets.thisWeek },
            { title: 'Upcoming', list: buckets.upcoming },
            { title: 'Waiting (WTG)', list: buckets.waiting },
            { title: 'In Review', list: buckets.inReview },
            { title: 'Done Recently', list: buckets.doneRecently },
          ];
          return (
            <section key={capKey} className="org-inbox__capgroup" data-capacity={meta.code}>
              <div className="org-inbox__capgroup-hdr">
                <CapacityBadgeList capacities={[meta.code]} />
                <Text size="lg" variant="accent">
                  {meta.title}
                </Text>
                <Badge tone="neutral">{capTasks.length}</Badge>
              </div>
              {sections.map(
                (sec) =>
                  sec.list.length > 0 && (
                    <div key={sec.title} className="org-inbox__section">
                      <div className="org-inbox__sec-title">
                        <Text size="sm" variant="muted">
                          {sec.title} ({sec.list.length})
                        </Text>
                      </div>
                      <div className="org-inbox__cards">
                        {sec.list.map((t) => renderTaskCard(t, capKey))}
                      </div>
                    </div>
                  ),
              )}
            </section>
          );
        })}

        {filteredTasks.length === 0 && (data?.to_review?.length ?? 0) === 0 && (
          <div className="org-inbox--center">
            <Text size="sm" variant="muted">
              No assigned tasks or reviews match your current filters.
            </Text>
          </div>
        )}
      </div>

      <Dialog
        open={Boolean(logTarget)}
        onOpenChange={(o) => {
          if (!o) setLogTarget(null);
        }}
        title={`Log Hours — ${logTarget?.task_code ?? ''}`}
        footer={
          <>
            <Button onClick={() => setLogTarget(null)}>Cancel</Button>
            <Button
              variant="primary"
              onClick={async () => {
                if (!logTarget) return;
                await apiClient.createTimeLog(
                  logTarget.id,
                  { hours: logHours, note: logNote.trim() },
                  activeProjectUuid,
                );
                await invalidateAll(logTarget.id);
                toast.push('success', `Logged ${logHours}h on ${logTarget.task_code}`);
                setLogTarget(null);
              }}
            >
              Save Time Log
            </Button>
          </>
        }
      >
        <Stack gap="2">
          <NumberField
            label="Hours"
            ariaLabel="Hours worked"
            value={logHours}
            min={0.25}
            max={24}
            step={0.5}
            precision={2}
            onChange={setLogHours}
          />
          <TextField
            aria-label="Time note"
            placeholder="What did you work on?"
            value={logNote}
            onChange={(e) => setLogNote(e.target.value)}
          />
        </Stack>
      </Dialog>

      <TaskTransitionDialog
        open={Boolean(submitTarget)}
        onOpenChange={(o) => {
          if (!o) setSubmitTarget(null);
        }}
        taskCode={submitTarget?.task.task_code ?? ''}
        taskName={submitTarget?.task.task_name ?? ''}
        targetStatus={submitTarget?.toStatus ?? ''}
        actionLabel={submitTarget?.actionLabel ?? ''}
        actedAsLabel={submitTarget?.actedAs ?? ''}
        requiresComment={Boolean(submitTarget?.requiresComment)}
        requiresVersion={Boolean(submitTarget?.requiresVersion)}
        versions={submitTarget?.versions ?? []}
        defaultVersionId={submitTarget?.task.latest_version_id}
        onSubmit={async ({ version_id, comment }) => {
          if (!submitTarget) return;
          await apiClient.transitionTask(
            submitTarget.task.id,
            {
              to: submitTarget.toStatus,
              version_id: version_id ?? null,
              comment: comment ?? null,
            },
            activeProjectUuid,
          );
          await invalidateAll(submitTarget.task.id);
          toast.push('success', `${submitTarget.task.task_code} -> ${submitTarget.toStatus}`);
        }}
      />
    </div>
  );
}
