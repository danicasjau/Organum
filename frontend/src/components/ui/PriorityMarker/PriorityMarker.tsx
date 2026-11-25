import { cn } from '../_internal/cn';
import './PriorityMarker.css';

export type TaskPriorityLevel = 'normal' | 'high' | 'stopper';

export interface PriorityMarkerProps {
  priority: TaskPriorityLevel | string;
  className?: string;
}

export function PriorityMarker({ priority, className }: PriorityMarkerProps) {
  if (priority === 'high') {
    return (
      <span
        data-ui="priority-marker"
        data-priority="high"
        className={cn('org-priority', className)}
        title="High priority"
        aria-label="High priority"
      >
        <span aria-hidden="true">▲</span>
      </span>
    );
  }
  if (priority === 'stopper') {
    return (
      <span
        data-ui="priority-marker"
        data-priority="stopper"
        className={cn('org-priority', className)}
        title="Stopper priority"
        aria-label="Stopper priority"
      >
        <span aria-hidden="true">■</span>
        <span>STOP</span>
      </span>
    );
  }
  return null;
}

