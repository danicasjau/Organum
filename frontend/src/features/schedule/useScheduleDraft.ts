import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo } from 'react';
import { useToast } from '../../components/ui';
import { apiClient, type DraftChangeIn, type DraftOut } from '../../lib/api/client';
import { hasPerm, useAuthStore } from '../auth/authStore';
import { useProjectStore } from '../project/projectStore';

const EMPTY: DraftOut = { changes: [], count: 0 };

/** Shared per-user schedule draft (server-side) used by the Gantt and the Calendar. */
export function useScheduleDraft() {
  const projectUuid = useProjectStore((s) => s.activeProjectUuid);
  const auth = useAuthStore((s) => s.auth);
  const queryClient = useQueryClient();
  const toast = useToast();
  const isClient = auth?.user.role_name === 'client';
  const queryKey = useMemo(() => ['schedule-draft', projectUuid], [projectUuid]);

  const q = useQuery({
    queryKey,
    queryFn: () => apiClient.getScheduleDraft(projectUuid),
    enabled: Boolean(projectUuid) && !isClient,
  });
  const draft = q.data ?? EMPTY;

  const refreshAll = useCallback(async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey }),
      queryClient.invalidateQueries({ queryKey: ['schedule-preview', projectUuid] }),
    ]);
  }, [queryClient, queryKey, projectUuid]);

  const addChanges = useCallback(
    async (changes: DraftChangeIn[], okMessage?: string): Promise<boolean> => {
      if (changes.length === 0) return false;
      try {
        const next = await apiClient.addScheduleDraftChanges(changes, projectUuid);
        queryClient.setQueryData(queryKey, next);
        await queryClient.invalidateQueries({ queryKey: ['schedule-preview', projectUuid] });
        if (okMessage) toast.push('info', okMessage);
        return true;
      } catch (err) {
        toast.push('danger', err instanceof Error ? err.message : 'Could not change the draft');
        return false;
      }
    },
    [projectUuid, queryClient, queryKey, toast],
  );

  const revert = useCallback(
    async (changeId: string) => {
      const next = await apiClient.revertScheduleDraftChange(changeId, projectUuid);
      queryClient.setQueryData(queryKey, next);
      await refreshAll();
    },
    [projectUuid, queryClient, queryKey, refreshAll],
  );

  const discard = useCallback(async () => {
    await apiClient.discardScheduleDraft(projectUuid);
    queryClient.setQueryData(queryKey, EMPTY);
    await refreshAll();
  }, [projectUuid, queryClient, queryKey, refreshAll]);

  /** After a save: refresh live data everywhere the schedule shows up. */
  const afterSave = useCallback(async () => {
    queryClient.setQueryData(queryKey, EMPTY);
    await Promise.all(
      [
        ['tasks', projectUuid],
        ['task', projectUuid],
        ['milestones', projectUuid],
        ['schedule-versions', projectUuid],
        ['schedule-preview', projectUuid],
        ['workload', projectUuid],
        ['task-graph', projectUuid],
        ['activation-periods', projectUuid],
        ['schedule-warnings', projectUuid],
        ['calendar', projectUuid],
      ].map((k) => queryClient.invalidateQueries({ queryKey: k })),
    );
  }, [projectUuid, queryClient, queryKey]);

  return {
    projectUuid,
    draft,
    changes: draft.changes ?? [],
    count: draft.count ?? 0,
    loading: q.isLoading,
    addChanges,
    revert,
    discard,
    afterSave,
    canVersion: hasPerm(auth?.permissions, 'schedule.version') || auth?.user.role_name === 'admin',
    canEditMilestones:
      hasPerm(auth?.permissions, 'milestone.edit') || auth?.user.role_name === 'admin',
  };
}
