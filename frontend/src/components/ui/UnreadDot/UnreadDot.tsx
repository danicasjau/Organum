import { cn } from '../_internal/cn';
import './UnreadDot.css';

/** Small red marker flagging unseen activity (e.g. a review the user has not opened). */
export function UnreadDot({
  label = 'Unread review',
  className,
}: {
  label?: string;
  className?: string;
}) {
  return (
    <span
      data-ui="unread-dot"
      role="status"
      aria-label={label}
      title={label}
      className={cn('org-unread-dot', className)}
    />
  );
}
