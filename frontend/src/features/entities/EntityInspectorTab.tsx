import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import {
  Badge,
  Button,
  Icon,
  Inline,
  PropertyEditor,
  Select,
  Separator,
  Stack,
  Text,
  TextField,
  useToast,
  type PropertyGroupDef,
} from '../../components/ui';
import { apiClient, type EntityDataItem, type EntityOut } from '../../lib/api/client';
import { useProjectStore } from '../project/projectStore';
import './EntityInspectorTab.css';

const EMPTY_ENTITY_DATA: EntityDataItem[] = [];

const VALUE_TYPE_OPTIONS = [
  { value: 'str', label: 'str' },
  { value: 'int', label: 'int' },
  { value: 'float', label: 'float' },
  { value: 'bool', label: 'bool' },
  { value: 'json', label: 'json' },
];

export function EntityInspectorTab({
  entity,
  onChanged,
}: {
  entity: EntityOut;
  onChanged?: () => void;
}) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const activeProjectUuid = useProjectStore((s) => s.activeProjectUuid);
  const [thumbBroken, setThumbBroken] = useState(false);
  const [tagDraft, setTagDraft] = useState('');
  const [draftRows, setDraftRows] = useState<EntityDataItem[]>([]);
  const [newKey, setNewKey] = useState('');
  const [newType, setNewType] = useState<EntityDataItem['value_type']>('str');
  const [newVal, setNewVal] = useState('');

  const { data: rowsData } = useQuery({
    queryKey: ['entity-data', activeProjectUuid, entity.id],
    queryFn: () => apiClient.getEntityData(entity.id, activeProjectUuid),
    enabled: Boolean(activeProjectUuid && entity.id),
  });
  const serverRows = rowsData ?? EMPTY_ENTITY_DATA;

  useEffect(() => {
    setDraftRows(serverRows.map((r) => ({ ...r })));
  }, [serverRows]);

  useEffect(() => {
    setThumbBroken(false);
  }, [entity.id, entity.resolved_thumbnail_file_id]);

  const handleSaveData = async (nextRows: EntityDataItem[]) => {
    try {
      await apiClient.putEntityData(entity.id, nextRows, activeProjectUuid);
      await queryClient.invalidateQueries({
        queryKey: ['entity-data', activeProjectUuid, entity.id],
      });
      toast.push('success', 'Saved entity data');
    } catch (err) {
      toast.push('danger', err instanceof Error ? err.message : 'Save failed');
    }
  };

  const handleAddTag = async () => {
    const clean = tagDraft.trim();
    if (!clean) return;
    const next = entity.tags?.some((t) => t.toLowerCase() === clean.toLowerCase())
      ? entity.tags ?? []
      : [...(entity.tags ?? []), clean];
    await apiClient.putEntityTags(entity.id, next, activeProjectUuid);
    setTagDraft('');
    await queryClient.invalidateQueries({ queryKey: ['entities', activeProjectUuid] });
    onChanged?.();
  };

  const handleRemoveTag = async (target: string) => {
    const next = (entity.tags ?? []).filter((t) => t !== target);
    await apiClient.putEntityTags(entity.id, next, activeProjectUuid);
    await queryClient.invalidateQueries({ queryKey: ['entities', activeProjectUuid] });
    onChanged?.();
  };

  const hasThumb = Boolean(entity.resolved_thumbnail_file_id) && !thumbBroken;

  const groups: PropertyGroupDef[] = [
    {
      id: 'entity_data',
      title: `Entity Data (${draftRows.length})`,
      defaultOpen: true,
      items: draftRows.map((row, idx) => ({
        id: row.key,
        label: `${row.key} (${row.value_type})`,
        dirty:
          serverRows[idx]?.value_text !== row.value_text ||
          serverRows[idx]?.value_type !== row.value_type,
        onReset: () => {
          const orig = serverRows.find((s) => s.key === row.key);
          if (!orig) return;
          setDraftRows((prev) => prev.map((p) => (p.key === row.key ? { ...orig } : p)));
        },
        render: () => (
          <Inline gap="1" className="org-enttab__kvrow">
            <TextField
              aria-label={`Value for ${row.key}`}
              value={row.value_text}
              onChange={(e) => {
                const v = e.target.value;
                setDraftRows((prev) =>
                  prev.map((p) => (p.key === row.key ? { ...p, value_text: v } : p)),
                );
              }}
            />
            <Button
              variant="icon"
              size="sm"
              aria-label={`Delete ${row.key}`}
              onClick={async () => {
                const next = draftRows.filter((p) => p.key !== row.key);
                setDraftRows(next);
                await handleSaveData(next);
              }}
            >
              <Icon name="trash" size="sm" />
            </Button>
          </Inline>
        ),
      })),
    },
  ];

  return (
    <Stack gap="2" className="org-enttab">
      <div className="org-enttab__header">
        <div className="org-enttab__thumb">
          {hasThumb ? (
            <img
              src={apiClient.entityThumbnailUrl(entity.id, activeProjectUuid)}
              alt={entity.name}
              className="org-enttab__thumb-img"
              onError={() => setThumbBroken(true)}
            />
          ) : (
            <Icon name="box3d" size="lg" />
          )}
        </div>
        <Stack gap="1" className="org-enttab__meta">
          <Text size="lg" variant="accent">
            {entity.name}
          </Text>
          <Text size="sm" variant="mono">
            {entity.rel_path}
          </Text>
          <Inline gap="1" wrap>
            {entity.entity_type ? (
              <Badge tone="accent">{entity.entity_type}</Badge>
            ) : (
              <Badge tone="neutral">Untyped</Badge>
            )}
            <Badge tone="neutral">Thumb: {entity.thumbnail_source}</Badge>
            {entity.thumbnail_source === 'manual' && (
              <Button
                size="sm"
                onClick={async () => {
                  await apiClient.putEntityThumbnail(
                    entity.id,
                    { source: 'auto', file_id: null },
                    activeProjectUuid,
                  );
                  await queryClient.invalidateQueries({ queryKey: ['entities', activeProjectUuid] });
                }}
              >
                Reset to auto
              </Button>
            )}
          </Inline>
        </Stack>
      </div>

      {entity.description && (
        <Text size="sm" variant="muted">
          {entity.description}
        </Text>
      )}

      <Stack gap="1">
        <Text size="sm" variant="accent">
          Tags
        </Text>
        <Inline gap="1" wrap>
          {(entity.tags ?? []).map((t) => (
            <Badge key={t} tone="neutral">
              {t}{' '}
              <button
                type="button"
                className="org-enttab__tag-x"
                aria-label={`Remove ${t}`}
                onClick={() => handleRemoveTag(t)}
              >
                ×
              </button>
            </Badge>
          ))}
        </Inline>
        <Inline gap="1">
          <TextField
            aria-label="New entity tag"
            placeholder="Add tag..."
            value={tagDraft}
            onChange={(e) => setTagDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void handleAddTag();
            }}
          />
          <Button size="sm" onClick={() => void handleAddTag()}>
            Add
          </Button>
        </Inline>
      </Stack>

      <Stack gap="1">
        <Text size="sm" variant="accent">
          Departments ({entity.departments?.length ?? 0})
        </Text>
        <Inline gap="1" wrap>
          {(entity.departments ?? []).map((d) => (
            <Badge key={d.id} tone="neutral">
              {d.name} ({d.tasks?.length ?? 0})
            </Badge>
          ))}
        </Inline>
      </Stack>

      <Separator />

      <PropertyEditor groups={groups} searchable />

      <div className="org-enttab__addrow">
        <TextField
          aria-label="New data key"
          placeholder="key"
          value={newKey}
          onChange={(e) => setNewKey(e.target.value)}
        />
        <Select
          ariaLabel="New data type"
          options={VALUE_TYPE_OPTIONS}
          value={newType}
          onChange={(v) => setNewType(v as EntityDataItem['value_type'])}
          filterable={false}
        />
        <TextField
          aria-label="New data value"
          placeholder="value"
          value={newVal}
          onChange={(e) => setNewVal(e.target.value)}
        />
        <Button
          size="sm"
          disabled={!newKey.trim()}
          onClick={async () => {
            const k = newKey.trim();
            if (!k) return;
            const next = [
              ...draftRows.filter((r) => r.key !== k),
              { key: k, value_type: newType, value_text: newVal },
            ];
            setDraftRows(next);
            setNewKey('');
            setNewVal('');
            await handleSaveData(next);
          }}
        >
          Add Row
        </Button>
      </div>

      <Inline gap="1">
        <Button
          variant="primary"
          size="sm"
          onClick={() => void handleSaveData(draftRows)}
        >
          Save Entity Data
        </Button>
      </Inline>
    </Stack>
  );
}

