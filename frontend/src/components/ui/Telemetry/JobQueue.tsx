import { Badge } from '../Badge/Badge';
import { Button } from '../Button/Button';
import { ProgressBar } from '../Progress/Progress';
import { Text } from '../Typography/Typography';
import './Telemetry.css';

export interface TelemetryJob {
  id: string;
  label: string;
  status: 'queued' | 'running' | 'done' | 'failed';
  progress: number;
}

export function JobQueue({
  jobs,
  onCancel,
}: {
  jobs: ReadonlyArray<TelemetryJob>;
  onCancel?: (id: string) => void;
}) {
  return (
    <div className="org-jobqueue" aria-label="Job Queue">
      {jobs.length === 0 ? (
        <Text variant="muted">No active background jobs.</Text>
      ) : (
        jobs.map((job) => (
          <div key={job.id} className="org-jobqueue__row">
            <div>
              <Text variant="mono">{job.label}</Text>
              <ProgressBar value={job.progress} />
            </div>
            <div className="org-inline">
              <Badge
                tone={
                  job.status === 'done'
                    ? 'success'
                    : job.status === 'failed'
                      ? 'danger'
                      : job.status === 'running'
                        ? 'accent'
                        : 'neutral'
                }
              >
                {job.status}
              </Badge>
              {job.status === 'running' && onCancel && (
                <Button size="sm" onClick={() => onCancel(job.id)}>
                  Cancel
                </Button>
              )}
            </div>
          </div>
        ))
      )}
    </div>
  );
}

