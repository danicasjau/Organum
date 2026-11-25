import { useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';
import { apiClient, type TaskListItemOut } from '../../lib/api/client';
import { useAuthStore } from '../auth/authStore';
import { useProjectStore } from '../project/projectStore';
import { useReviewSeenStore } from './reviewSeenStore';

/**
 * Root-level background sync: keeps the "latest review per task" map fresh so the
 * unread red dot can be rendered on tasks anywhere in the application.
 */
export function ReviewFeedbackSync() {
  const auth = useAuthStore((s) => s.auth);
  const activeProjectUuid = useProjectStore((s) => s.activeProjectUuid);
  const init = useReviewSeenStore((s) => s.init);
  const setFeedback = useReviewSeenStore((s) => s.setFeedback);
  const isClient = auth?.user.role_name === 'client';
  const userId = auth?.user.id ?? null;
  const enabled = Boolean(
    auth && activeProjectUuid && auth.project_uuid === activeProjectUuid && !isClient,
  );

  useEffect(() => {
    void init(enabled ? activeProjectUuid : null, enabled ? userId : null);
  }, [enabled, activeProjectUuid, userId, init]);

  const { data } = useQuery({
    queryKey: ['tasks', activeProjectUuid, 'feedback-sync'],
    queryFn: () => apiClient.listTasks({ limit: 500, sort: 'updated' }, activeProjectUuid),
    enabled,
    refetchInterval: 60_000,
    staleTime: 15_000,
  });

  useEffect(() => {
    if (!data) return;
    const items = data.items as ReadonlyArray<Partial<TaskListItemOut> & { id: string }>;
    setFeedback(items.map((t) => ({ id: t.id, at: t.last_feedback_at ?? null })));
  }, [data, setFeedback]);

  return null;
}
