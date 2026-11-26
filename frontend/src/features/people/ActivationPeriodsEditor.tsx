import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import {
  Banner,
  Button,
  DatePicker,
  Icon,
  InlineEdit,
  Text,
  TextField,
  formatDisplayDate,
  useToast,
} from '../../components/ui';
import { apiClient } from '../../lib/api/client';
import './people.css';

export type ActivationTargetKind = 'department' | 'company' | 'user';

/**
 * CR04 §6: "active on the project from … to …" periods for a department, studio or user.
 * No periods means always active. Tasks scheduled outside a period get a warning (not a block).
 */
export function ActivationPeriodsEditor({
  targetKind,
  targetId,
  projectUuid,
  editable,
}: {
  targetKind: ActivationTargetKind;
  targetId: string;
  projectUuid: string | null;
  editable: boolean;
}) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const queryKey = ['activation-periods', projectUuid, targetKind, targetId];
  const q = useQuery({
    queryKey,
    queryFn: () =>
      apiClient.listActivationPeriods(
        { target_kind: targetKind, target_id: targetId },
        projectUuid,
      ),
    enabled: Boolean(projectUuid),
  });
  const [start, setStart] = useState<string | null>(null);
  const [end, setEnd] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);

  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey }),
      queryClient.invalidateQueries({ queryKey: ['activation-periods', projectUuid, 'all'] }),
      queryClient.invalidateQueries({ queryKey: ['schedule-warnings', projectUuid] }),
    ]);

  const run = async (fn: () => Promise<unknown>, ok?: string) => {
    setError(null);
    try {
      await fn();
      await refresh();
      if (ok) toast.push('success', ok);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the period');
    }
  };

  const periods = q.data ?? [];

  return (
    <div className="org-act" data-ui={`activation-periods-${targetKind}`}>
      {error && <Banner severity="danger">{error}</Banner>}
      {periods.length === 0 ? (
        <Text size="sm" variant="muted">
          No periods: always active.
        </Text>
      ) : (
        <ul className="org-act__list" aria-label="Activation periods">
          {periods.map((p) => (
            <li key={p.id} className="org-act__row">
              <DatePicker
                ariaLabel="Period start"
                value={p.start_date}
                disabled={!editable}
                max={p.end_date}
                onChange={(v) =>
                  v &&
                  void run(() =>
                    apiClient.updateActivationPeriod(p.id, { start_date: v }, projectUuid),
                  )
                }
              />
              <span aria-hidden="true">→</span>
              <DatePicker
                ariaLabel="Period end"
                value={p.end_date}
                disabled={!editable}
                min={p.start_date}
                onChange={(v) =>
                  v &&
                  void run(() =>
                    apiClient.updateActivationPeriod(p.id, { end_date: v }, projectUuid),
                  )
                }
              />
              {editable ? (
                <InlineEdit
                  ariaLabel="Period note"
                  value={p.note ?? ''}
                  placeholder="add note"
                  validate={() => null}
                  onCommit={(v) =>
                    run(() => apiClient.updateActivationPeriod(p.id, { note: v }, projectUuid))
                  }
                />
              ) : (
                <Text size="sm">{p.note}</Text>
              )}
              {editable && (
                <Button
                  size="sm"
                  variant="icon"
                  aria-label={`Delete period ${formatDisplayDate(p.start_date)} to ${formatDisplayDate(p.end_date)}`}
                  onClick={() =>
                    void run(
                      () => apiClient.deleteActivationPeriod(p.id, projectUuid),
                      'Period removed',
                    )
                  }
                >
                  <Icon name="trash" size="sm" />
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      {editable && (
        <div className="org-act__add">
          <DatePicker ariaLabel="New period start" value={start} onChange={setStart} max={end} />
          <span aria-hidden="true">→</span>
          <DatePicker ariaLabel="New period end" value={end} onChange={setEnd} min={start} />
          <TextField
            aria-label="New period note"
            placeholder="note (optional)"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          <Button
            size="sm"
            disabled={!start || !end}
            onClick={() =>
              void run(async () => {
                await apiClient.createActivationPeriod(
                  {
                    target_kind: targetKind,
                    target_id: targetId,
                    start_date: start!,
                    end_date: end!,
                    note,
                  },
                  projectUuid,
                );
                setStart(null);
                setEnd(null);
                setNote('');
              }, 'Period added')
            }
          >
            Add period
          </Button>
        </div>
      )}
    </div>
  );
}
