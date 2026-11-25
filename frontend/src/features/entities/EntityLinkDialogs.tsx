import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import {
  Badge,
  Banner,
  Button,
  Checkbox,
  Dialog,
  SearchField,
  Stack,
  Text,
  TextField,
  useToast,
} from '../../components/ui';
import {
  apiClient,
  type EntityOut,
  type SuggestedDependencyOut,
} from '../../lib/api/client';
import { useProjectStore } from '../project/projectStore';
import './EntityLinkDialogs.css';

export function EntityLinkPickerDialog({
  open,
  onOpenChange,
  anchorEntities,
  allEntities,
  direction,
  linkTypeSuggestions = [],
  onLinked,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  anchorEntities: ReadonlyArray<EntityOut>;
  allEntities: ReadonlyArray<EntityOut>;
  direction: 'uses' | 'used_in';
  linkTypeSuggestions?: ReadonlyArray<string>;
  onLinked?: () => void;
}) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const activeProjectUuid = useProjectStore((s) => s.activeProjectUuid);

  const [query, setQuery] = useState('');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [linkType, setLinkType] = useState('');
  const [note, setNote] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const anchorSet = useMemo(() => new Set(anchorEntities.map((e) => e.id)), [anchorEntities]);

  useEffect(() => {
    if (open) {
      setQuery('');
      setSelectedIds([]);
      setLinkType('');
      setNote('');
      setErr(null);
    }
  }, [open]);

  const candidates = useMemo(() => {
    const q = query.trim().toLowerCase();
    return allEntities.filter((e) => {
      if (anchorSet.has(e.id)) return false;
      if (!q) return true;
      return (
        e.name.toLowerCase().includes(q) ||
        (e.entity_type ?? '').toLowerCase().includes(q) ||
        e.rel_path.toLowerCase().includes(q) ||
        (e.tags ?? []).some((t) => t.toLowerCase().includes(q))
      );
    });
  }, [allEntities, anchorSet, query]);

  const toggleId = (id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  };

  const handleSubmit = async () => {
    if (anchorEntities.length === 0 || selectedIds.length === 0) {
      setErr('Select at least one entity to link.');
      return;
    }
    setErr(null);
    setBusy(true);
    try {
      const anchorIds = anchorEntities.map((e) => e.id);
      const source_ids = direction === 'used_in' ? anchorIds : selectedIds;
      const target_ids = direction === 'used_in' ? selectedIds : anchorIds;
      const created = await apiClient.bulkCreateEntityLinks(
        {
          source_ids,
          target_ids,
          link_type: linkType.trim() || null,
          note: note.trim() || null,
        },
        activeProjectUuid,
      );
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['entity-links', activeProjectUuid] }),
        queryClient.invalidateQueries({ queryKey: ['entity-links-graph', activeProjectUuid] }),
      ]);
      toast.push('success', `Created ${created.length} entity link(s)`);
      onLinked?.();
      onOpenChange(false);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Unable to create entity links');
    } finally {
      setBusy(false);
    }
  };

  const anchorSummary =
    anchorEntities.length === 1
      ? anchorEntities[0]!.name
      : `${anchorEntities.length} selected entities`;

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={
        direction === 'used_in'
          ? `Link '${anchorSummary}' Used In…`
          : `Link '${anchorSummary}' Uses…`
      }
      footer={
        <>
          <Button onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={busy || selectedIds.length === 0}
            onClick={() => void handleSubmit()}
          >
            {busy ? 'Linking...' : `Create Links (${selectedIds.length})`}
          </Button>
        </>
      }
    >
      <Stack gap="2" className="org-eldlg">
        {err && <Banner severity="danger">{err}</Banner>}
        <Text size="sm" variant="muted">
          {direction === 'used_in'
            ? `${anchorSummary} feeds into the chosen downstream entities:`
            : `Chosen upstream entities feed into ${anchorSummary}:`}
        </Text>
        <SearchField
          ariaLabel="Search entities to link"
          placeholder="Search name, type, tag, path..."
          value={query}
          onChange={setQuery}
        />
        <div className="org-eldlg__list" role="listbox" aria-multiselectable="true">
          {candidates.length === 0 ? (
            <Text size="sm" variant="muted">
              No matching entities.
            </Text>
          ) : (
            candidates.map((ent) => (
              <div key={ent.id} className="org-eldlg__row">
                <Checkbox
                  label={`${ent.name} (${ent.rel_path})`}
                  checked={selectedIds.includes(ent.id)}
                  onChange={() => toggleId(ent.id)}
                />
                {ent.entity_type && <Badge tone="accent">{ent.entity_type}</Badge>}
              </div>
            ))
          )}
        </div>
        <div className="org-eldlg__inputs">
          <Stack gap="1">
            <Text size="sm" variant="muted">
              Link Type (optional, free text)
            </Text>
            <input
              type="text"
              list="organum-link-type-list"
              className="org-eldlg__text"
              aria-label="Entity link type"
              placeholder="e.g. cast, prop, kitbash..."
              value={linkType}
              onChange={(e) => setLinkType(e.target.value)}
            />
            <datalist id="organum-link-type-list">
              {linkTypeSuggestions.map((lt) => (
                <option key={lt} value={lt} />
              ))}
            </datalist>
          </Stack>
          <Stack gap="1">
            <Text size="sm" variant="muted">
              Note (optional)
            </Text>
            <TextField
              aria-label="Entity link note"
              placeholder="Optional production note..."
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </Stack>
        </div>
      </Stack>
    </Dialog>
  );
}

export function SuggestDependenciesDialog({
  open,
  onOpenChange,
  entityId,
  entityName,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  entityId: string;
  entityName: string;
}) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const activeProjectUuid = useProjectStore((s) => s.activeProjectUuid);

  const [suggestions, setSuggestions] = useState<SuggestedDependencyOut[]>([]);
  const [checkedKeys, setCheckedKeys] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const pairKey = (s: SuggestedDependencyOut) => `${s.upstream_task_id}->${s.downstream_task_id}`;

  useEffect(() => {
    if (!open || !entityId || !activeProjectUuid) return;
    setLoading(true);
    setErr(null);
    void apiClient
      .suggestEntityDependencies(entityId, {}, activeProjectUuid)
      .then((rows) => {
        setSuggestions(rows);
        const init: Record<string, boolean> = {};
        for (const r of rows) {
          if (!r.already_exists && !r.would_cycle) init[pairKey(r)] = true;
        }
        setCheckedKeys(init);
      })
      .catch((e) => setErr(e instanceof Error ? e.message : 'Unable to suggest dependencies'))
      .finally(() => setLoading(false));
  }, [open, entityId, activeProjectUuid]);

  const selectedPairs = suggestions.filter(
    (s) => !s.already_exists && !s.would_cycle && checkedKeys[pairKey(s)],
  );

  const handleApply = async () => {
    if (selectedPairs.length === 0) return;
    setApplying(true);
    setErr(null);
    try {
      const res = await apiClient.applyEntityDependencies(
        entityId,
        {
          pairs: selectedPairs.map((p) => ({
            downstream_task_id: p.downstream_task_id,
            upstream_task_id: p.upstream_task_id,
            threshold: p.threshold as 'APP' | 'PUBLISHED' | 'ANY_STATUS',
          })),
        },
        activeProjectUuid,
      );
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['tasks', activeProjectUuid] }),
        queryClient.invalidateQueries({ queryKey: ['task', activeProjectUuid] }),
        queryClient.invalidateQueries({ queryKey: ['entities', activeProjectUuid] }),
      ]);
      toast.push('success', `Applied ${res.applied} suggested dependencies`);
      onOpenChange(false);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Apply dependencies failed');
    } finally {
      setApplying(false);
    }
  };

  return (
    <Dialog
      wide
      open={open}
      onOpenChange={onOpenChange}
      title={`Suggest Dependencies — ${entityName}`}
      footer={
        <>
          <Button onClick={() => onOpenChange(false)} disabled={applying}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={applying || selectedPairs.length === 0}
            onClick={() => void handleApply()}
          >
            {applying ? 'Applying...' : `Apply (${selectedPairs.length})`}
          </Button>
        </>
      }
    >
      <Stack gap="2" className="org-eldlg">
        {err && <Banner severity="danger">{err}</Banner>}
        {loading ? (
          <Text size="sm" variant="muted">
            Evaluating dependency templates across linked entities...
          </Text>
        ) : suggestions.length === 0 ? (
          <Text size="sm" variant="muted">
            No template-matched task dependencies found for this entity&apos;s links.
          </Text>
        ) : (
          <div className="org-eldlg__table">
            {suggestions.map((s) => {
              const key = pairKey(s);
              const disabled = s.already_exists || s.would_cycle;
              return (
                <div key={key} className="org-eldlg__sug-row">
                  <Checkbox
                    label={`${s.upstream_task_code} → ${s.downstream_task_code}`}
                    checked={disabled ? false : Boolean(checkedKeys[key])}
                    disabled={disabled}
                    onChange={(chk) => setCheckedKeys((p) => ({ ...p, [key]: chk }))}
                  />
                  <div className="org-eldlg__sug-badges">
                    <Badge tone="neutral">{s.threshold}</Badge>
                    {s.already_exists ? (
                      <Badge tone="info">Already exists</Badge>
                    ) : s.would_cycle ? (
                      <Badge tone="danger">Would cycle</Badge>
                    ) : (
                      <Badge tone="success">New</Badge>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Stack>
    </Dialog>
  );
}
