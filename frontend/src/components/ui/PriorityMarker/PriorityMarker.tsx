import { cn } from '../_internal/cn';
import { PriorityFlag } from '../PriorityFlag/PriorityFlag';
import './PriorityMarker.css';

export type TaskPriorityLevel = 'normal' | 'high' | 'stopper';

export interface PriorityMarkerProps {
  priority: TaskPriorityLevel | string;
  className?: string;
}

/**
 * Compact priority marker for task rows. Renders nothing for normal priority
 * (unchanged behaviour); high and stopper render the v1 flag + label.
 */
export function PriorityMarker({ priority, className }: PriorityMarkerProps) {
  if (priority !== 'high' && priority !== 'stopper') return null;
  const label = priority === 'high' ? 'High priority' : 'Stopper priority';
  return (
    <span
      data-ui="priority-marker"
      data-priority={priority}
      className={cn('org-priority', className)}
      title={label}
      aria-label={label}
    >
      <PriorityFlag priority={priority} />
    </span>
  );
}
