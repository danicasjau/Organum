import { useEffect, useState } from 'react';
import {
  Banner,
  Button,
  Dialog,
  Select,
  Stack,
  StatusChip,
  Text,
  TextArea,
} from '../../components/ui';
import type { ClientProductOut, ProductVersionOut } from '../../lib/api/client';
import './TaskTransitionDialog.css';

type AnyVersionOut = ProductVersionOut | NonNullable<ClientProductOut['versions']>[number];

export interface TaskTransitionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  taskCode: string;
  taskName: string;
  targetStatus: string;
  actionLabel: string;
  actedAsLabel: string;
  requiresComment: boolean;
  requiresVersion: boolean;
  versions?: ReadonlyArray<AnyVersionOut>;
  defaultVersionId?: string | null;
  onSubmit: (payload: { version_id?: string | null; comment?: string | null }) => Promise<void>;
}

export function TaskTransitionDialog({
  open,
  onOpenChange,
  taskCode,
  taskName,
  targetStatus,
  actionLabel,
  actedAsLabel,
  requiresComment,
  requiresVersion,
  versions = [],
  defaultVersionId = null,
  onSubmit,
}: TaskTransitionDialogProps) {
  const [comment, setComment] = useState('');
  const [versionId, setVersionId] = useState(defaultVersionId ?? versions[0]?.id ?? '');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setComment('');
      setVersionId(defaultVersionId ?? versions[0]?.id ?? '');
      setErr(null);
    }
  }, [open, defaultVersionId, versions]);

  const handleConfirm = async () => {
    if (requiresComment && !comment.trim()) {
      setErr('A comment is required for this transition.');
      return;
    }
    if (requiresVersion && versions.length > 0 && !versionId) {
      setErr('Select a published version to submit.');
      return;
    }
    setErr(null);
    setBusy(true);
    try {
      await onSubmit({
        version_id: requiresVersion && versionId ? versionId : undefined,
        comment: comment.trim() || undefined,
      });
      onOpenChange(false);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Transition failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={`${actionLabel} — ${taskCode}`}
      footer={
        <>
          <Button onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => void handleConfirm()} disabled={busy}>
            {busy ? 'Applying...' : `${actionLabel}${actedAsLabel ? ` (${actedAsLabel})` : ''}`}
          </Button>
        </>
      }
    >
      <Stack gap="2" className="org-tdlg">
        {err && <Banner severity="danger">{err}</Banner>}
        <div className="org-tdlg__summary">
          <Text size="sm">{taskName}</Text>
          <StatusChip status={targetStatus} compact />
        </div>
        {requiresVersion && (
          <Stack gap="1">
            <Text size="sm" variant="muted">
              Submitted Version
            </Text>
            {versions.length === 0 ? (
              <Banner severity="warning">
                No published versions exist on this task. Publish a version first if required.
              </Banner>
            ) : (
              <Select
                ariaLabel="Submitted version"
                value={versionId}
                onChange={setVersionId}
                options={versions.map((v) => ({
                  value: v.id,
                  label: `${v.label} (${v.files?.length ?? 0} files)`,
                }))}
              />
            )}
          </Stack>
        )}
        <Stack gap="1">
          <Text size="sm" variant="muted">
            Comment {requiresComment ? '(required)' : '(optional)'}
          </Text>
          <TextArea
            aria-label="Transition comment"
            rows={3}
            value={comment}
            placeholder={
              requiresComment ? 'Explain what needs fixing...' : 'Optional review or handoff note...'
            }
            onChange={(e) => setComment(e.target.value)}
          />
        </Stack>
      </Stack>
    </Dialog>
  );
}
