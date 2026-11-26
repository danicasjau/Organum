import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import {
  Badge,
  Button,
  ContextMenu,
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
import { useAuthStore, hasPerm } from '../auth/authStore';
import { DepartmentTag } from '../departments/DepartmentTag';
import { useProjectStore } from '../project/projectStore';
import { EntityLinkPickerDialog, SuggestDependenciesDialog } from './EntityLinkDialogs';
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
  const auth = useAuthStore((s) => s.auth);
  const isClientRole = auth?.user.role_name === 'client';
  const canViewLinks =
    !isClientRole &&
    (hasPerm(auth?.permissions, 'task.view') ||
      hasPerm(auth?.permissions, 'media.view') ||
      hasPerm(auth?.permissions, 'entity.link'));
  const canLinkEntities = !isClientRole && hasPerm(auth?.permissions, 'entity.link');
  const canSuggestDeps = !isClientRole && hasPerm(auth?.permissions, 'task.dependencies');
  const [linkDialogDir, setLinkDialogDir] = useState<'uses' | 'used_in' | null>(null);
  const [suggestOpen, setSuggestOpen] = useState(false);

  const { data: treeData } = useQuery({
    queryKey: ['entities', activeProjectUuid],
    queryFn: () => apiClient.listEntities(activeProjectUuid),
    enabled: Boolean(activeProjectUuid && !isClientRole),
  });

  const { data: linksData } = useQuery({
    queryKey: ['entity-links', activeProjectUuid, entity.id],
    queryFn: () => apiClient.getEntityLinks(entity.id, 3, activeProjectUuid),
    enabled: Boolean(activeProjectUuid && entity.id && canViewLinks),
  });
  const [thumbBroken, setThumbBroken] = useState(false);
  const [tagDraft, setTagDraft] = useState('');
  const [draftRows, setDraftRows] = useState<EntityDataItem[]>([]);
  const [newKey, setNewKey] = useState('');
  const [newType, setNewType] = useState<EntityDataItem['value_type']>('str');
  const [newVal, setNewVal] = useState('');

  const { data: rowsData } = useQuery({
    queryKey: ['entity-data', activeProjectUuid, entity.id],
    queryFn: () => apiClient.getEntityData(entity.id, activeProjectUuid),
    enabled: Boolean(activeProjectUuid && entity.id && !isClientRole),
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
      ? (entity.tags ?? [])
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

  const removeLink = async (linkId: string) => {
    await apiClient.deleteEntityLink(linkId, activeProjectUuid);
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['entity-links', activeProjectUuid] }),
      queryClient.invalidateQueries({ queryKey: ['entity-links-graph', activeProjectUuid] }),
    ]);
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
          <ContextMenu
            items={[
              {
                id: 'delete',
                label: `Delete '${row.key}'`,
                onSelect: () => {
                  const next = draftRows.filter((p) => p.key !== row.key);
                  setDraftRows(next);
                  void handleSaveData(next);
                },
              },
            ]}
          >
            <div className="org-enttab__kvrow" title="Right-click for options">
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
            </div>
          </ContextMenu>
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
                  await queryClient.invalidateQueries({
                    queryKey: ['entities', activeProjectUuid],
                  });
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
            <ContextMenu
              key={t}
              items={[
                {
                  id: 'remove',
                  label: `Remove tag '${t}'`,
                  onSelect: () => void handleRemoveTag(t),
                },
              ]}
            >
              <span className="org-enttab__tag" title="Right-click to remove">
                <Badge tone="neutral">{t}</Badge>
              </span>
            </ContextMenu>
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
            <DepartmentTag
              key={d.id}
              id={d.department_id}
              name={d.name}
              label={`${d.name} (${d.tasks?.length ?? 0})`}
            />
          ))}
        </Inline>
      </Stack>

      {!isClientRole && (
        <>
          <Separator />
          <Stack gap="2" className="org-enttab__links" data-ui="entity-links-section">
            <div className="org-enttab__links-hdr">
              <Text size="sm" variant="accent">
                Links ({(linksData?.uses?.length ?? 0) + (linksData?.used_in?.length ?? 0)})
              </Text>
              <Inline gap="1" wrap>
                {canLinkEntities && (
                  <>
                    <Button size="sm" onClick={() => setLinkDialogDir('uses')}>
                      + Uses…
                    </Button>
                    <Button size="sm" onClick={() => setLinkDialogDir('used_in')}>
                      + Used in…
                    </Button>
                  </>
                )}
                {canSuggestDeps && (
                  <Button size="sm" variant="primary" onClick={() => setSuggestOpen(true)}>
                    Suggest Deps…
                  </Button>
                )}
              </Inline>
            </div>

            <Stack gap="1">
              <Text size="sm" variant="muted">
                Uses ({linksData?.uses?.length ?? 0})
              </Text>
              {(linksData?.uses ?? []).length === 0 ? (
                <Text size="sm" variant="muted">
                  No direct upstream entities.
                </Text>
              ) : (
                (linksData?.uses ?? []).map((lk) => (
                  <ContextMenu
                    key={lk.id}
                    items={
                      canLinkEntities
                        ? [
                            {
                              id: 'remove-link',
                              label: `Remove link from ${lk.source_name}`,
                              onSelect: () => void removeLink(lk.id),
                            },
                          ]
                        : []
                    }
                  >
                    <div
                      className={`org-enttab__link-row${lk.source_archived ? ' org-enttab__link-row--arch' : ''}`}
                    >
                      <span className="org-enttab__link-name">
                        <Icon name="box3d" size="sm" />
                        <span>{lk.source_name}</span>
                        {lk.source_type && <Badge tone="accent">{lk.source_type}</Badge>}
                        {lk.link_type && <Badge tone="neutral">{lk.link_type}</Badge>}
                      </span>
                    </div>
                  </ContextMenu>
                ))
              )}
              {(linksData?.uses_indirect ?? []).map((ind) => (
                <div key={`uind-${ind.entity_id}`} className="org-enttab__link-indirect">
                  <span>{ind.entity_name}</span>
                  <Text size="sm" variant="muted">
                    indirect, via {(ind.via_entity_names ?? []).join(' → ')}
                  </Text>
                </div>
              ))}
            </Stack>

            <Stack gap="1">
              <Text size="sm" variant="muted">
                Used in ({linksData?.used_in?.length ?? 0})
              </Text>
              {(linksData?.used_in ?? []).length === 0 ? (
                <Text size="sm" variant="muted">
                  Not linked into downstream entities.
                </Text>
              ) : (
                (linksData?.used_in ?? []).map((lk) => (
                  <ContextMenu
                    key={lk.id}
                    items={
                      canLinkEntities
                        ? [
                            {
                              id: 'remove-link',
                              label: `Remove link to ${lk.target_name}`,
                              onSelect: () => void removeLink(lk.id),
                            },
                          ]
                        : []
                    }
                  >
                    <div
                      className={`org-enttab__link-row${lk.target_archived ? ' org-enttab__link-row--arch' : ''}`}
                    >
                      <span className="org-enttab__link-name">
                        <Icon name="box3d" size="sm" />
                        <span>{lk.target_name}</span>
                        {lk.target_type && <Badge tone="accent">{lk.target_type}</Badge>}
                        {lk.link_type && <Badge tone="neutral">{lk.link_type}</Badge>}
                      </span>
                    </div>
                  </ContextMenu>
                ))
              )}
              {(linksData?.used_in_indirect ?? []).map((ind) => (
                <div key={`dind-${ind.entity_id}`} className="org-enttab__link-indirect">
                  <span>{ind.entity_name}</span>
                  <Text size="sm" variant="muted">
                    indirect, via {(ind.via_entity_names ?? []).join(' → ')}
                  </Text>
                </div>
              ))}
            </Stack>
          </Stack>
        </>
      )}

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
        <Button variant="primary" size="sm" onClick={() => void handleSaveData(draftRows)}>
          Save Entity Data
        </Button>
      </Inline>

      <EntityLinkPickerDialog
        open={linkDialogDir !== null}
        onOpenChange={(o) => {
          if (!o) setLinkDialogDir(null);
        }}
        anchorEntities={[entity]}
        allEntities={treeData?.entities ?? []}
        direction={linkDialogDir ?? 'used_in'}
        linkTypeSuggestions={linksData?.link_types ?? []}
      />

      <SuggestDependenciesDialog
        open={suggestOpen}
        onOpenChange={setSuggestOpen}
        entityId={entity.id}
        entityName={entity.name}
      />
    </Stack>
  );
}
