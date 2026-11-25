import { useEffect, useState } from 'react';
import {
  Banner,
  Button,
  Checkbox,
  Dialog,
  Stack,
  Text,
  TextArea,
  useToast,
} from '../../components/ui';
import {
  apiClient,
  type CompanyOut,
  type ProductVersionOut,
} from '../../lib/api/client';
import { useProjectStore } from '../project/projectStore';
import './ShareWithClientDialog.css';

export interface ShareWithClientDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  taskId: string;
  taskCode: string;
  companies: ReadonlyArray<CompanyOut>;
  versions: ReadonlyArray<ProductVersionOut>;
  initialCompanyIds: ReadonlyArray<string>;
  onShared?: () => void;
}

export function ShareWithClientDialog({
  open,
  onOpenChange,
  taskId,
  taskCode,
  companies,
  versions,
  initialCompanyIds,
  onShared,
}: ShareWithClientDialogProps) {
  const toast = useToast();
  const activeProjectUuid = useProjectStore((s) => s.activeProjectUuid);
  const clientCompanies = companies.filter((c) => c.kind === 'external');

  const [selectedCompanies, setSelectedCompanies] = useState<string[]>([]);
  const [selectedVersions, setSelectedVersions] = useState<string[]>([]);
  const [comment, setComment] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setSelectedCompanies(
        initialCompanyIds.length > 0
          ? [...initialCompanyIds]
          : clientCompanies[0]
            ? [clientCompanies[0].id]
            : [],
      );
      setSelectedVersions(versions[0] ? [versions[0].id] : []);
      setComment('');
      setErr(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, taskId]);

  const toggleCompany = (id: string) => {
    setSelectedCompanies((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  };

  const toggleVersion = (id: string) => {
    setSelectedVersions((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  };

  const handleSave = async () => {
    setErr(null);
    setBusy(true);
    try {
      await apiClient.putTaskShares(
        taskId,
        {
          company_ids: selectedCompanies,
          version_ids: selectedVersions,
          comment: comment.trim() || null,
        },
        activeProjectUuid,
      );
      toast.push('success', `Updated client shares for ${taskCode}`);
      onShared?.();
      onOpenChange(false);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Unable to update client shares');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={`Share with Client — ${taskCode}`}
      footer={
        <>
          <Button onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => void handleSave()} disabled={busy}>
            {busy ? 'Sharing...' : 'Save Shares'}
          </Button>
        </>
      }
    >
      <Stack gap="2" className="org-sharedlg">
        {err && <Banner severity="danger">{err}</Banner>}
        <Stack gap="1">
          <Text size="sm" variant="accent">
            External / Client Companies
          </Text>
          {clientCompanies.length === 0 ? (
            <Text size="sm" variant="muted">
              No external companies configured in Users &gt; Companies.
            </Text>
          ) : (
            <div className="org-sharedlg__list">
              {clientCompanies.map((c) => (
                <Checkbox
                  key={c.id}
                  label={`${c.name} (${c.short_code})`}
                  checked={selectedCompanies.includes(c.id)}
                  onChange={() => toggleCompany(c.id)}
                />
              ))}
            </div>
          )}
        </Stack>

        <Stack gap="1">
          <Text size="sm" variant="accent">
            Shared Versions ({selectedVersions.length}/{versions.length})
          </Text>
          {versions.length === 0 ? (
            <Text size="sm" variant="muted">
              No product versions published on this task yet.
            </Text>
          ) : (
            <div className="org-sharedlg__list">
              {versions.map((v) => (
                <Checkbox
                  key={v.id}
                  label={`${v.label} — ${v.files?.length ?? 0} files`}
                  checked={selectedVersions.includes(v.id)}
                  onChange={() => toggleVersion(v.id)}
                />
              ))}
            </div>
          )}
        </Stack>

        <Stack gap="1">
          <Text size="sm" variant="muted">
            Optional Client-Visible Comment
          </Text>
          <TextArea
            aria-label="Client share comment"
            rows={2}
            placeholder="Note visible to client reviewers..."
            value={comment}
            onChange={(e) => setComment(e.target.value)}
          />
        </Stack>
      </Stack>
    </Dialog>
  );
}
