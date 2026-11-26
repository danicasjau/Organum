import { UnreadDot } from '../../components/ui';
import { useReviewUnread } from './reviewSeenStore';

/** Red dot shown on any task card/row that has a review the current user has not opened. */
export function TaskUnreadDot({
  taskId,
  feedbackAt,
  by,
  className,
}: {
  taskId: string;
  feedbackAt?: string | null;
  by?: string | null;
  className?: string;
}) {
  const unread = useReviewUnread(taskId, feedbackAt);
  if (!unread) return null;
  return <UnreadDot className={className} label={by ? `New review from ${by}` : 'New review'} />;
}
