import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import {
  Badge,
  Button,
  ConfirmDialog,
  Dialog,
  Icon,
  Text,
  formatDisplayDate,
  useToast,
} from '../../components/ui';
import { apiClient, type ScheduleVersionOut } from '../../lib/api/client';
import { DiffTable } from './DraftBar';
import { useScheduleDraft } from './useScheduleDraft';
import './schedule.css';

/**
 * CR04 §5: schedule versions (S0001…), styled like the product version list: current marker,
 * star (baseline), comment, author, date, diff summary, jump back (as a draft) and compare.
 */
export function VersionsPanel({ context }: { context: 'gantt' | 'calendar' }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const { projectUuid, count, canVersion } = useScheduleDraft();
  const versions = useQuery({
    queryKey: ['schedule-versions', projectUuid],
    queryFn: () => apiClient.listScheduleVersions(projectUuid),
    enabled: Boolean(projectUuid),
  });
  const [jumpTo, setJumpTo] = useState<ScheduleVersionOut | null>(null);
  const [compareOf, setCompareOf] = useState<ScheduleVersionOut | null>(null);
  const compare = useQuery({
    queryKey: ['schedule-compare', projectUuid, compareOf?.id],
    queryFn: () => apiClient.compareScheduleVersions(compareOf!.id, 'live', projectUuid),
    enabled: Boolean(compareOf && projectUuid),
  });

  const list = versions.data ?? [];

  return (
    <aside className="org-sched-versions" data-ui={`versions-panel-${context}`} aria-label="Schedule versions">
      <header className="org-sched-versions__head">
        <strong>Schedule versions</strong>
        <Badge tone="neutral">{list.length}</Badge>
      </header>
      {list.length === 0 && (
        <Text size="sm" variant="muted">
          No versions yet. Save your first draft (or snapshot the current schedule) to create S0001.
        </Text>
      )}
      <ul className="org-sched-versions__list" role="list">
        {list.map((v) => (
          <li
            key={v.id}
            className="org-sched-version"
            data-current={v.is_current ? 'true' : undefined}
            data-starred={v.is_starred ? 'true' : undefined}
          >
            <div className="org-sched-version__top">
              <span className="org-sched-version__label">{v.label}</span>
              {v.is_current && <Badge tone="success">current</Badge>}
              {v.is_starred && <Badge tone="warning">baseline</Badge>}
              <span className="org-sched-version__spacer" />
              <Button
                size="sm"
                variant="icon"
                aria-label={v.is_starred ? `Unstar ${v.label}` : `Star ${v.label} as baseline`}
                aria-pressed={v.is_starred}
                disabled={!canVersion}
                title={v.is_starred ? 'Baseline (master) version' : 'Star as baseline'}
                onClick={async () => {
                  await apiClient.starScheduleVersion(v.id, !v.is_starred, projectUuid);
                  await queryClient.invalidateQueries({ queryKey: ['schedule-versions', projectUuid] });
                }}
              >
                <Icon name={v.is_starred ? 'star-filled' : 'star'} size="sm" />
              </Button>
            </div>
            <Text size="sm">{v.comment}</Text>
            <Text size="sm" variant="muted">
              {v.author_name ?? 'unknown'} · {formatDisplayDate(v.created_at.slice(0, 10))}{' '}
              {v.created_at.slice(11, 16)}
            </Text>
            <div className="org-sched-version__summary" aria-label={`${v.label} summary`}>
              <Badge tone="neutral">{Number(v.diff_summary?.tasks ?? 0)} tasks</Badge>
              <Badge tone="neutral">{Number(v.diff_summary?.milestones ?? 0)} milestones</Badge>
              <Badge tone="neutral">{Number(v.diff_summary?.activations ?? 0)} periods</Badge>
            </div>
            <div className="org-sched-version__actions">
              <Button size="sm" onClick={() => setCompareOf(v)}>
                Compare
              </Button>
              <Button size="sm" disabled={v.is_current} onClick={() => setJumpTo(v)}>
                Jump to this version
              </Button>
            </div>
          </li>
        ))}
      </ul>

      <ConfirmDialog
        open={Boolean(jumpTo)}
        onOpenChange={(o) => !o && setJumpTo(null)}
        title={`Load ${jumpTo?.label ?? ''} as your draft?`}
        confirmLabel="Load as draft"
        danger={false}
        onConfirm={async () => {
          if (!jumpTo) return;
          try {
            const d = await apiClient.jumpToScheduleVersion(jumpTo.id, projectUuid);
            queryClient.setQueryData(['schedule-draft', projectUuid], d);
            await queryClient.invalidateQueries({ queryKey: ['schedule-preview', projectUuid] });
            toast.push('info', `${jumpTo.label} loaded as a draft (${d.count ?? 0} changes). Save to apply it.`);
          } catch (err) {
            toast.push('danger', err instanceof Error ? err.message : 'Could not load the version');
          }
        }}
      >
        <Text>
          Nothing is overwritten: the differences become draft changes you can review, adjust and
          save as a new version.{' '}
          {count > 0 && <strong>Your current draft ({count} changes) will be replaced.</strong>}
        </Text>
      </ConfirmDialog>

      <Dialog
        open={Boolean(compareOf)}
        onOpenChange={(o) => !o && setCompareOf(null)}
        title={`Compare ${compareOf?.label ?? ''} → live`}
        wide
      >
        <DiffTable items={compare.data?.diff ?? []} empty="Identical to live data." />
      </Dialog>
    </aside>
  );
}
