import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import {
  Badge,
  Banner,
  Button,
  Checkbox,
  ConfirmDialog,
  Dialog,
  Icon,
  Popover,
  Text,
  TextArea,
  useToast,
} from '../../components/ui';
import { ApiHttpError, apiClient, type ScheduleCompareOut } from '../../lib/api/client';
import { useScheduleDraft } from './useScheduleDraft';
import './schedule.css';

type DiffItem = ScheduleCompareOut['diff'] extends (infer T)[] | undefined ? T : never;

function fmt(v: unknown): string {
  if (v === null || v === undefined || v === '') return '—';
  if (Array.isArray(v)) return v.map((x) => (Array.isArray(x) ? x.join(':') : String(x))).join(', ');
  return String(v);
}

/** Before → after table of schedule differences (used by save, compare and conflicts). */
export function DiffTable({ items, empty = 'No differences.' }: { items: DiffItem[]; empty?: string }) {
  if (items.length === 0) {
    return (
      <Text size="sm" variant="muted">
        {empty}
      </Text>
    );
  }
  return (
    <table className="org-sched-diff" aria-label="Schedule differences">
      <thead>
        <tr>
          <th>Item</th>
          <th>Change</th>
          <th>Before → After</th>
        </tr>
      </thead>
      <tbody>
        {items.map((it) => (
          <tr key={`${it.kind}:${it.target_id}`} data-op={it.op}>
            <td>
              <Badge tone="neutral">{it.kind}</Badge> {it.label}
            </td>
            <td>{it.op}</td>
            <td>
              {Object.entries(it.fields ?? {}).map(([f, pair]) => (
                <div key={f}>
                  <code>{f}</code>: {fmt((pair as unknown[])[0])} → <strong>{fmt((pair as unknown[])[1])}</strong>
                </div>
              ))}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/**
 * CR04 §5: "DRAFT: N changes" bar. Lists pending changes (each revertible), discards, or
 * saves them as a new schedule version after confirming the differences and any conflicts.
 */
export function DraftBar({ context }: { context: 'gantt' | 'calendar' }) {
  const toast = useToast();
  const { projectUuid, changes, count, revert, discard, afterSave, canVersion } =
    useScheduleDraft();
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [saveOpen, setSaveOpen] = useState(false);
  const [comment, setComment] = useState('');
  const [overwrite, setOverwrite] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const preview = useQuery({
    queryKey: ['schedule-preview', projectUuid],
    queryFn: () => apiClient.previewScheduleDraft(projectUuid),
    enabled: saveOpen && Boolean(projectUuid),
  });
  const conflicts = preview.data?.conflicts ?? [];

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const v = await apiClient.saveScheduleDraft(
        { comment: comment.trim(), overwrite_conflicts: overwrite },
        projectUuid,
      );
      toast.push('success', `Saved schedule version ${v.label}`);
      setSaveOpen(false);
      setComment('');
      setOverwrite(false);
      await afterSave();
    } catch (err) {
      if (err instanceof ApiHttpError && err.code === 'draft_conflicts') {
        await preview.refetch();
      }
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="org-draftbar"
      data-ui={`draft-bar-${context}`}
      data-has-changes={count > 0 ? 'true' : undefined}
      role="status"
      aria-live="polite"
    >
      {count > 0 ? (
        <>
          <span className="org-draftbar__label">
            <Icon name="pencil" size="sm" /> DRAFT: {count} change{count === 1 ? '' : 's'}
          </span>
          <Popover trigger={<Button size="sm">Review changes</Button>}>
            <ul className="org-draftbar__list" aria-label="Draft changes">
              {changes.map((c) => (
                <li key={c.id}>
                  <Badge tone="neutral">{c.kind}</Badge>
                  <span className="org-draftbar__item">{c.label || `${c.op} ${c.target_id.slice(0, 8)}`}</span>
                  <Button
                    size="sm"
                    variant="icon"
                    aria-label={`Revert ${c.label || c.op}`}
                    title="Revert this change"
                    onClick={() => void revert(c.id)}
                  >
                    <Icon name="reset" size="sm" />
                  </Button>
                </li>
              ))}
            </ul>
          </Popover>
          <Button size="sm" variant="danger" onClick={() => setConfirmDiscard(true)}>
            Discard
          </Button>
        </>
      ) : (
        <Text size="sm" variant="muted">
          No draft changes — edits here go to your draft first.
        </Text>
      )}
      {canVersion && (
        <Button size="sm" variant="primary" onClick={() => setSaveOpen(true)}>
          {count > 0 ? 'Save as new version…' : 'Snapshot as version…'}
        </Button>
      )}
      {!canVersion && count > 0 && (
        <Text size="sm" variant="muted">
          Ask a producer or supervisor to save a version.
        </Text>
      )}

      <ConfirmDialog
        open={confirmDiscard}
        onOpenChange={setConfirmDiscard}
        title={`Discard ${count} draft change${count === 1 ? '' : 's'}?`}
        confirmLabel="Discard draft"
        onConfirm={async () => {
          await discard();
          toast.push('info', 'Draft discarded');
        }}
      >
        <Text>Live data is not affected.</Text>
      </ConfirmDialog>

      <Dialog open={saveOpen} onOpenChange={setSaveOpen} title="Save schedule as a new version" wide>
        <div className="org-sched-save" data-ui="schedule-save-dialog">
          {error && <Banner severity="danger">{error}</Banner>}
          <Text size="sm">
            These differences will be applied to live data and stored as an immutable version.
          </Text>
          <DiffTable items={(preview.data?.diff ?? []) as DiffItem[]} empty="No changes: the current schedule will be snapshotted as-is." />
          {conflicts.length > 0 && (
            <Banner severity="warning" title={`${conflicts.length} conflict(s)`}>
              <ul className="org-sched-conflicts" aria-label="Conflicts">
                {conflicts.map((c, i) => (
                  <li key={i}>
                    <strong>{String(c.label)}</strong>: {String(c.message)}
                  </li>
                ))}
              </ul>
              <Checkbox
                label="Overwrite those live changes with my draft"
                checked={overwrite}
                onChange={setOverwrite}
              />
            </Banner>
          )}
          <label className="org-sched-field">
            <Text size="sm" variant="muted">
              Comment (required)
            </Text>
            <TextArea
              aria-label="Version comment"
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="What changed and why"
            />
          </label>
          <div className="org-sched-actions">
            <Button onClick={() => setSaveOpen(false)}>Cancel</Button>
            <Button
              variant="primary"
              disabled={busy || !comment.trim() || (conflicts.length > 0 && !overwrite)}
              onClick={() => void save()}
            >
              Apply & save version
            </Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}
