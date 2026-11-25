import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Badge, Button, Icon, Spinner, StatusChip, Text, useToast } from '../../components/ui';
import {
  apiClient,
  type ClientProductOut,
  type ClientReviewQueueItemOut,
  type ProductVersionOut,
  type ReviewQueueItemOut,
} from '../../lib/api/client';
import { useProjectStore } from '../project/projectStore';
import { formatActedAsLabel, formatWaitHours } from './taskHelpers';
import { TaskTransitionDialog } from './TaskTransitionDialog';
import './ReviewQueueView.css';
import { DepartmentTag } from '../departments/DepartmentTag';
import { TaskUnreadDot } from '../reviews/TaskUnreadDot';

type QueueEntry = ReviewQueueItemOut | ClientReviewQueueItemOut;

function isFullQueueItem(item: QueueEntry): item is ReviewQueueItemOut {
  return 'submitter_name' in item || 'on_behalf' in item;
}

export function ReviewQueueView({
  searchQuery = '',
  selectedTaskId = null,
  onSelectTask,
  onOpenInViewer,
}: {
  searchQuery?: string;
  selectedTaskId?: string | null;
  onSelectTask?: (taskId: string) => void;
  onOpenInViewer?: (opts: { taskId: string; fileId?: string | null }) => void;
}) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const activeProjectUuid = useProjectStore((s) => s.activeProjectUuid);
  const [retakeTarget, setRetakeTarget] = useState<{
    item: QueueEntry;
    versions: Array<ProductVersionOut | NonNullable<ClientProductOut['versions']>[number]>;
  } | null>(null);
  const [busyTaskId, setBusyTaskId] = useState<string | null>(null);

  const { data: items = [], isLoading } = useQuery({
    queryKey: ['review-queue', activeProjectUuid],
    queryFn: () => apiClient.listReviewQueue(activeProjectUuid),
    enabled: Boolean(activeProjectUuid),
  });

  const q = searchQuery.trim().toLowerCase();
  const filtered = q
    ? items.filter(
        (it) =>
          it.task_code.toLowerCase().includes(q) ||
          it.task_name.toLowerCase().includes(q) ||
          it.entity_name.toLowerCase().includes(q) ||
          it.department_name.toLowerCase().includes(q),
      )
    : items;

  const invalidateAll = async (taskId: string) => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['review-queue', activeProjectUuid] }),
      queryClient.invalidateQueries({ queryKey: ['tasks', activeProjectUuid] }),
      queryClient.invalidateQueries({ queryKey: ['my-tasks', activeProjectUuid] }),
      queryClient.invalidateQueries({ queryKey: ['task', activeProjectUuid, taskId] }),
      queryClient.invalidateQueries({ queryKey: ['entities', activeProjectUuid] }),
    ]);
  };

  const handleApprove = async (item: QueueEntry) => {
    setBusyTaskId(item.task_id);
    try {
      const det = await apiClient.getTask(item.task_id, activeProjectUuid);
      const approveOpt = (det.allowed_transitions ?? []).find((t) => t.action === 'approve');
      if (!approveOpt) {
        toast.push('danger', 'No approve transition available for this task');
        return;
      }
      await apiClient.transitionTask(
        item.task_id,
        { to: approveOpt.to, version_id: item.submitted_version_id ?? null },
        activeProjectUuid,
      );
      await invalidateAll(item.task_id);
      toast.push('success', `Approved ${item.task_code} -> ${approveOpt.to}`);
    } catch (err) {
      toast.push('danger', err instanceof Error ? err.message : 'Approve failed');
    } finally {
      setBusyTaskId(null);
    }
  };

  const handleOpenRetake = async (item: QueueEntry) => {
    try {
      const det = await apiClient.getTask(item.task_id, activeProjectUuid);
      setRetakeTarget({ item, versions: det.product?.versions ?? [] });
    } catch (err) {
      toast.push('danger', err instanceof Error ? err.message : 'Unable to open retake dialog');
    }
  };

  if (isLoading) {
    return (
      <div className="org-rqueue org-rqueue--empty" data-ui="review-queue">
        <Spinner label="Loading review queue" />
      </div>
    );
  }

  return (
    <div className="org-rqueue" data-ui="review-queue">
      <div className="org-rqueue__bar">
        <Text size="sm" variant="accent">
          Review Queue ({filtered.length}) — oldest first
        </Text>
      </div>
      {filtered.length === 0 ? (
        <div className="org-rqueue__empty">
          <Text size="sm" variant="muted">
            No tasks currently awaiting your review.
          </Text>
        </div>
      ) : (
        <div className="org-rqueue__list" role="list" aria-label="Tasks awaiting review">
          {filtered.map((item) => {
            const fullItem = isFullQueueItem(item);
            const selected = item.task_id === selectedTaskId;
            const actedLabel =
              fullItem && item.on_behalf
                ? 'on behalf of client'
                : formatActedAsLabel(item.can_act_as);
            return (
              <div
                key={item.task_id}
                role="listitem"
                data-selected={selected ? 'true' : undefined}
                className="org-rqueue__card"
                onClick={() => onSelectTask?.(item.task_id)}
              >
                <div className="org-rqueue__thumb">
                  {item.thumbnail_file_id ? (
                    <img
                      src={apiClient.fileThumbnailUrl(item.thumbnail_file_id, activeProjectUuid)}
                      alt={item.task_code}
                      className="org-rqueue__thumb-img"
                    />
                  ) : (
                    <Icon name="image" size="lg" />
                  )}
                </div>
                <div className="org-rqueue__info">
                  <div className="org-rqueue__top">
                    <span className="org-rqueue__code">{item.task_code}</span>
                    <TaskUnreadDot taskId={item.task_id} />
                    <StatusChip status={item.status} compact />
                    {item.submitted_version_label && (
                      <Badge tone="neutral">{item.submitted_version_label}</Badge>
                    )}
                    <Badge tone="warning">Wait {formatWaitHours(item.wait_hours)}</Badge>
                    {actedLabel && <Badge tone="accent">{actedLabel}</Badge>}
                  </div>
                  <div className="org-rqueue__sub">
                    <span className="org-rqueue__line">
                      <DepartmentTag name={item.department_name} />
                      <Text size="sm">
                        {item.entity_name} — {item.task_name}
                      </Text>
                    </span>
                    {fullItem && item.submitter_name && (
                      <Text size="sm" variant="muted">
                        Submitted by {item.submitter_name}
                      </Text>
                    )}
                  </div>
                </div>
                <div className="org-rqueue__actions" onClick={(e) => e.stopPropagation()}>
                  <Button
                    size="sm"
                    onClick={() =>
                      onOpenInViewer?.({
                        taskId: item.task_id,
                        fileId: item.thumbnail_file_id ?? null,
                      })
                    }
                  >
                    Open in viewer
                  </Button>
                  <Button
                    size="sm"
                    variant="success"
                    disabled={busyTaskId === item.task_id}
                    onClick={() => void handleApprove(item)}
                  >
                    Approve{actedLabel ? ` (${actedLabel})` : ''}
                  </Button>
                  <Button
                    size="sm"
                    variant="danger"
                    disabled={busyTaskId === item.task_id}
                    onClick={() => void handleOpenRetake(item)}
                  >
                    Retake…
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <TaskTransitionDialog
        open={Boolean(retakeTarget)}
        onOpenChange={(o) => {
          if (!o) setRetakeTarget(null);
        }}
        taskCode={retakeTarget?.item.task_code ?? ''}
        taskName={retakeTarget?.item.task_name ?? ''}
        targetStatus="RTK"
        actionLabel="Retake"
        actedAsLabel={formatActedAsLabel(retakeTarget?.item.can_act_as)}
        requiresComment
        requiresVersion={false}
        versions={retakeTarget?.versions ?? []}
        onSubmit={async ({ comment }) => {
          if (!retakeTarget) return;
          await apiClient.transitionTask(
            retakeTarget.item.task_id,
            { to: 'RTK', comment: comment ?? null },
            activeProjectUuid,
          );
          await invalidateAll(retakeTarget.item.task_id);
          toast.push('info', `Requested retake on ${retakeTarget.item.task_code}`);
        }}
      />
    </div>
  );
}
