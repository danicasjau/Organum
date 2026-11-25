import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useMemo, useRef, useState, type MouseEvent } from 'react';
import {
  Badge,
  Button,
  ContextMenu,
  Icon,
  Inline,
  Popover,
  SearchField,
  Select,
  Stack,
  Text,
  useToast,
  type MenuEntry,
} from '../../components/ui';
import { useCssVarRef } from '../../components/ui/_internal/useCssVar';
import {
  apiClient,
  type DepartmentOut,
  type EntityOut,
  type EntityTreeOut,
} from '../../lib/api/client';
import { hasPerm, useAuthStore } from '../auth/authStore';
import { useProjectStore } from '../project/projectStore';
import { useEntitiesStore } from './entitiesStore';
import {
  ConfirmTrashDialog,
  CreateEntityDialog,
  CreateFolderDialog,
  EditEntityDialog,
} from './EntityDialogs';
import { EntityLinkPickerDialog } from './EntityLinkDialogs';
import './EntityColumn.css';

type BrowseItem =
  | { kind: 'folder'; id: string; name: string; relPath: string }
  | { kind: 'entity'; id: string; entity: EntityOut };

const EMPTY_DEPARTMENTS: DepartmentOut[] = [];

function VirtualCardRow({ start, children }: { start: number; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useCssVarRef(ref, '--ec-offset', `${start}px`);
  return (
    <div ref={ref} className="org-ecol__vrow">
      {children}
    </div>
  );
}

function EntityCard({
  entity,
  selected,
  multiSelected,
  multiCount,
  linkCount,
  canLink,
  projectUuid,
  onSelect,
  onEdit,
  onAddDept,
  onLinkTo,
  onLinkFrom,
  onResetThumb,
  onReveal,
  onDelete,
  createItems,
}: {
  entity: EntityOut;
  selected: boolean;
  multiSelected: boolean;
  multiCount: number;
  linkCount: number;
  canLink: boolean;
  projectUuid: string | null;
  onSelect: (e: MouseEvent) => void;
  onEdit: () => void;
  onAddDept: () => void;
  onLinkTo: () => void;
  onLinkFrom: () => void;
  onResetThumb: () => void;
  onReveal: () => void;
  onDelete: () => void;
  createItems: ReadonlyArray<MenuEntry>;
}) {
  const [imgErr, setImgErr] = useState(false);
  const showThumb = Boolean(entity.resolved_thumbnail_file_id) && !imgErr;

  return (
    <ContextMenu
      items={[
        { id: 'edit', label: 'Rename / Edit Tags & Type...', onSelect: onEdit },
        { id: 'dept', label: 'Add Department...', onSelect: onAddDept },
        ...(canLink
          ? [
              {
                id: 'link-to',
                label: multiCount > 1 ? `Link ${multiCount} selected to…` : 'Link selected to…',
                onSelect: onLinkTo,
              },
              {
                id: 'link-from',
                label: multiCount > 1 ? `Link ${multiCount} selected from…` : 'Link from…',
                onSelect: onLinkFrom,
              },
            ]
          : []),
        ...(entity.thumbnail_source === 'manual'
          ? [{ id: 'reset-thumb', label: 'Reset Thumbnail to Auto', onSelect: onResetThumb }]
          : []),
        { id: 'reveal', label: 'Reveal in File Manager', onSelect: onReveal },
        ...(createItems.length > 0
          ? [{ id: 'sep-create', label: '', separator: true }, ...createItems]
          : []),
        { id: 'sep', label: '', separator: true },
        { id: 'delete', label: 'Delete Entity...', onSelect: onDelete },
      ]}
    >
      <div
        role="option"
        tabIndex={0}
        aria-selected={selected}
        data-entity-id={entity.id}
        data-selected={selected ? 'true' : undefined}
        data-multi-selected={multiSelected ? 'true' : undefined}
        className="org-ecol__card"
        onClick={onSelect}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onSelect(e as unknown as MouseEvent);
          }
        }}
      >
        <div className="org-ecol__thumb">
          {showThumb ? (
            <img
              src={apiClient.entityThumbnailUrl(entity.id, projectUuid)}
              alt=""
              className="org-ecol__thumb-img"
              onError={() => setImgErr(true)}
            />
          ) : (
            <Icon name="box3d" size="md" />
          )}
        </div>
        <div className="org-ecol__body">
          <div className="org-ecol__title-row">
            <span className="org-ecol__title" title={entity.rel_path}>
              {entity.name}
            </span>
            {entity.entity_type && <Badge tone="accent">{entity.entity_type}</Badge>}
            {linkCount > 0 && (
              <span title={`${linkCount} entity link(s)`}>
                <Badge tone="info">
                  {linkCount} link{linkCount === 1 ? '' : 's'}
                </Badge>
              </span>
            )}
            {entity.is_missing && <Badge tone="danger">missing</Badge>}
          </div>
          <div className="org-ecol__chips">
            {(entity.tags ?? []).slice(0, 4).map((t) => (
              <Badge key={t} tone="neutral">
                {t}
              </Badge>
            ))}
            {(entity.tags?.length ?? 0) === 0 && (
              <Text size="sm" variant="muted">
                {entity.departments?.length ?? 0} dept
                {(entity.departments?.length ?? 0) === 1 ? '' : 's'}
              </Text>
            )}
          </div>
        </div>
      </div>
    </ContextMenu>
  );
}

export function EntityColumn({
  tree,
  departments,
  selectedEntityId,
  onSelectEntity,
  onRequestAddDepartment,
  maximized = false,
  onToggleMaximize,
  onReconcile,
}: {
  tree: EntityTreeOut | undefined;
  departments: ReadonlyArray<DepartmentOut>;
  selectedEntityId: string | null;
  onSelectEntity: (entityId: string) => void;
  onRequestAddDepartment: (entityId: string) => void;
  maximized?: boolean;
  onToggleMaximize?: () => void;
  onReconcile?: () => void;
}) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const activeProjectUuid = useProjectStore((s) => s.activeProjectUuid);
  const auth = useAuthStore((s) => s.auth);
  const isClientRole = auth?.user.role_name === 'client';
  const canLinkEntities = !isClientRole && hasPerm(auth?.permissions, 'entity.link');
  const canViewGraph = !isClientRole && hasPerm(auth?.permissions, 'views.graph');
  const currentFolder = useEntitiesStore((s) => s.currentFolder);
  const setCurrentFolder = useEntitiesStore((s) => s.setCurrentFolder);
  const canManageEntities = !isClientRole && hasPerm(auth?.permissions, 'entity.manage');

  const [search, setSearch] = useState('');
  const [filterType, setFilterType] = useState('');
  const [filterDept, setFilterDept] = useState('');
  const [filterTags, setFilterTags] = useState<string[]>([]);
  const [multiSelectedIds, setMultiSelectedIds] = useState<string[]>([]);
  const [bulkLinkState, setBulkLinkState] = useState<{
    anchors: EntityOut[];
    direction: 'uses' | 'used_in';
  } | null>(null);
  const [createEntityOpen, setCreateEntityOpen] = useState(false);
  const [createFolderOpen, setCreateFolderOpen] = useState(false);
  const [editingEntity, setEditingEntity] = useState<EntityOut | null>(null);
  const [deletingEntity, setDeletingEntity] = useState<EntityOut | null>(null);

  const { data: linksGraph } = useQuery({
    queryKey: ['entity-links-graph', activeProjectUuid],
    queryFn: () => apiClient.getEntityLinksGraph(activeProjectUuid),
    enabled: Boolean(activeProjectUuid && canViewGraph),
  });

  const linkCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const edge of linksGraph?.edges ?? []) {
      m.set(edge.source_entity_id, (m.get(edge.source_entity_id) ?? 0) + 1);
      m.set(edge.target_entity_id, (m.get(edge.target_entity_id) ?? 0) + 1);
    }
    return m;
  }, [linksGraph]);

  const availableTypes = useMemo(() => {
    const set = new Set<string>(tree?.available_types ?? []);
    for (const e of tree?.entities ?? []) {
      if (e.entity_type) set.add(e.entity_type);
    }
    return Array.from(set).sort();
  }, [tree]);

  const availableTags = useMemo(() => {
    const set = new Set<string>(tree?.available_tags ?? []);
    for (const e of tree?.entities ?? []) {
      for (const t of e.tags ?? []) set.add(t);
    }
    return Array.from(set).sort();
  }, [tree]);

  const items: BrowseItem[] = useMemo(() => {
    if (!tree) return [];
    const q = search.trim().toLowerCase();
    const isFiltering =
      Boolean(q) || Boolean(filterType) || Boolean(filterDept) || filterTags.length > 0;

    const matchingEntities = (tree.entities ?? []).filter((e) => {
      if (!isFiltering) {
        const rel = e.rel_path ?? '';
        const parent = rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '';
        if (parent !== currentFolder) return false;
      }
      if (filterType && (e.entity_type ?? '') !== filterType) return false;
      if (filterDept && !e.departments?.some((d) => d.name === filterDept)) return false;
      if (filterTags.length > 0 && !filterTags.every((ft) => (e.tags ?? []).includes(ft))) {
        return false;
      }
      if (q) {
        const hit =
          e.name.toLowerCase().includes(q) ||
          (e.entity_type ?? '').toLowerCase().includes(q) ||
          (e.tags ?? []).some((t) => t.toLowerCase().includes(q));
        if (!hit) return false;
      }
      return true;
    });

    matchingEntities.sort((a, b) => a.name.localeCompare(b.name));

    const folderItems: BrowseItem[] = [];
    if (!isFiltering) {
      for (const rel of tree.plain_folders ?? []) {
        const parent = rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '';
        if (parent !== currentFolder) continue;
        const name = rel.includes('/') ? rel.slice(rel.lastIndexOf('/') + 1) : rel;
        folderItems.push({ kind: 'folder', id: `folder:${rel}`, name, relPath: rel });
      }
    }

    return [
      ...folderItems,
      ...matchingEntities.map((e) => ({ kind: 'entity' as const, id: e.id, entity: e })),
    ];
  }, [tree, search, filterType, filterDept, filterTags, currentFolder]);

  const scrollRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 88,
    overscan: 6,
    initialRect: { width: 260, height: 500 },
  });

  const innerRef = useRef<HTMLDivElement>(null);
  useCssVarRef(innerRef, '--ec-total-h', `${virtualizer.getTotalSize()}px`);

  const breadcrumbs = currentFolder ? currentFolder.split('/') : [];

  const refreshTree = async () => {
    await queryClient.invalidateQueries({ queryKey: ['entities', activeProjectUuid] });
  };

  const activeFilterCount = (filterType ? 1 : 0) + (filterDept ? 1 : 0) + filterTags.length;

  const createItems: MenuEntry[] = canManageEntities
    ? [
        { id: 'new-entity', label: 'New Entity...', onSelect: () => setCreateEntityOpen(true) },
        { id: 'new-folder', label: 'New Folder...', onSelect: () => setCreateFolderOpen(true) },
      ]
    : [];

  const backgroundItems: MenuEntry[] = [
    ...createItems,
    ...(onToggleMaximize
      ? [
          { id: 'sep-view', label: '', separator: true },
          {
            id: 'maximize',
            label: maximized ? 'Restore Entities Browser' : 'Maximize Entities Browser',
            shortcut: 'Ctrl+E',
            onSelect: onToggleMaximize,
          },
        ]
      : []),
    ...(currentFolder
      ? [
          {
            id: 'reveal-folder',
            label: 'Reveal Folder in File Manager',
            onSelect: () => {
              void apiClient.revealPath(currentFolder, activeProjectUuid);
            },
          },
        ]
      : []),
    ...(onReconcile && canManageEntities
      ? [
          { id: 'sep-sync', label: '', separator: true },
          { id: 'reconcile', label: 'Reconcile Project Disk & DB', onSelect: onReconcile },
        ]
      : []),
  ];

  return (
    <div
      className="org-ecol"
      onKeyDown={(e) => {
        if (
          e.key === 'Backspace' &&
          currentFolder &&
          document.activeElement?.tagName !== 'INPUT' &&
          document.activeElement?.tagName !== 'TEXTAREA'
        ) {
          e.preventDefault();
          const up = currentFolder.includes('/')
            ? currentFolder.slice(0, currentFolder.lastIndexOf('/'))
            : '';
          setCurrentFolder(up);
        }
      }}
    >
      <div className="org-ecol__toolbar">
        <div className="org-ecol__searchrow">
          <SearchField
            aria-label="Filter entities"
            placeholder="Search name, tag, type..."
            value={search}
            onChange={setSearch}
            className="org-ecol__search"
          />
          <Popover
            trigger={
              <Button size="sm" variant={activeFilterCount > 0 ? 'primary' : 'default'}>
                Filter{activeFilterCount > 0 ? ` (${activeFilterCount})` : ''}
              </Button>
            }
          >
            <Stack gap="2" className="org-ecol__filter-pop">
              <Text size="sm" variant="accent">
                Filter Entities
              </Text>
              <Select
                ariaLabel="Filter by entity type"
                value={filterType}
                onChange={setFilterType}
                options={[
                  { value: '', label: 'All Types' },
                  ...availableTypes.map((t) => ({ value: t, label: t })),
                ]}
                filterable={false}
              />
              <Select
                ariaLabel="Filter by department"
                value={filterDept}
                onChange={setFilterDept}
                options={[
                  { value: '', label: 'All Departments' },
                  ...(departments ?? EMPTY_DEPARTMENTS).map((d) => ({
                    value: d.name,
                    label: d.name,
                  })),
                ]}
                filterable={false}
              />
              {availableTags.length > 0 && (
                <Stack gap="1">
                  <Text size="sm" variant="muted">
                    Tags
                  </Text>
                  <Inline gap="1" wrap>
                    {availableTags.map((t) => {
                      const active = filterTags.includes(t);
                      return (
                        <Button
                          key={t}
                          size="sm"
                          variant="toggle"
                          pressed={active}
                          onClick={() =>
                            setFilterTags((prev) =>
                              active ? prev.filter((x) => x !== t) : [...prev, t],
                            )
                          }
                        >
                          {t}
                        </Button>
                      );
                    })}
                  </Inline>
                </Stack>
              )}
              {activeFilterCount > 0 && (
                <Button
                  size="sm"
                  onClick={() => {
                    setFilterType('');
                    setFilterDept('');
                    setFilterTags([]);
                  }}
                >
                  Clear Filters
                </Button>
              )}
            </Stack>
          </Popover>
        </div>

        <div className="org-ecol__crumbs" aria-label="Folder breadcrumbs">
          <Button
            size="sm"
            variant="icon"
            disabled={!currentFolder}
            aria-label="Go up folder"
            onClick={() => {
              const up = currentFolder.includes('/')
                ? currentFolder.slice(0, currentFolder.lastIndexOf('/'))
                : '';
              setCurrentFolder(up);
            }}
          >
            <Icon name="arrow-up" size="sm" />
          </Button>
          <button
            type="button"
            className="org-ecol__crumb"
            data-active={!currentFolder ? 'true' : undefined}
            onClick={() => setCurrentFolder('')}
          >
            01_Production
          </button>
          {breadcrumbs.map((seg, i) => {
            const targetPath = breadcrumbs.slice(0, i + 1).join('/');
            return (
              <span key={targetPath} className="org-ecol__crumb-sep">
                <span>/</span>
                <button
                  type="button"
                  className="org-ecol__crumb"
                  data-active={i === breadcrumbs.length - 1 ? 'true' : undefined}
                  onClick={() => setCurrentFolder(targetPath)}
                >
                  {seg}
                </button>
              </span>
            );
          })}
        </div>
      </div>

      <ContextMenu items={backgroundItems}>
        <div
          ref={scrollRef}
          role="listbox"
          aria-label="Entities list"
          tabIndex={0}
          className="org-ecol__list"
        >
          {items.length === 0 ? (
            <div className="org-ecol__empty">
              <Text size="sm" variant="muted">
                No entities match the current folder or filter.
              </Text>
              {canManageEntities && (
                <Text size="sm" variant="muted">
                  Right-click to create an entity or folder.
                </Text>
              )}
            </div>
          ) : (
            <div ref={innerRef} className="org-ecol__vinner">
              {virtualizer.getVirtualItems().map((vRow) => {
                const item = items[vRow.index];
                if (!item) return null;
                return (
                  <VirtualCardRow key={item.id} start={vRow.start}>
                    {item.kind === 'folder' ? (
                      <ContextMenu
                        items={[
                          {
                            id: 'open',
                            label: 'Open Folder',
                            onSelect: () => setCurrentFolder(item.relPath),
                          },
                          {
                            id: 'promote',
                            label: 'Promote to Entity',
                            onSelect: async () => {
                              try {
                                const ent = await apiClient.promoteFolder(
                                  item.relPath,
                                  activeProjectUuid,
                                );
                                await refreshTree();
                                onSelectEntity(ent.id);
                                toast.push('success', `Promoted '${ent.name}' to entity`);
                              } catch (err) {
                                toast.push(
                                  'danger',
                                  err instanceof Error ? err.message : 'Promote failed',
                                );
                              }
                            },
                          },
                          {
                            id: 'reveal',
                            label: 'Reveal in File Manager',
                            onSelect: async () => {
                              await apiClient.revealPath(item.relPath, activeProjectUuid);
                            },
                          },
                          ...(createItems.length > 0
                            ? [{ id: 'sep-create', label: '', separator: true }, ...createItems]
                            : []),
                        ]}
                      >
                        <div
                          role="option"
                          tabIndex={0}
                          aria-selected={false}
                          className="org-ecol__card org-ecol__card--folder"
                          onDoubleClick={() => setCurrentFolder(item.relPath)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') setCurrentFolder(item.relPath);
                          }}
                        >
                          <div className="org-ecol__thumb">
                            <Icon name="folder" size="lg" />
                          </div>
                          <div className="org-ecol__body">
                            <div className="org-ecol__title-row">
                              <span className="org-ecol__title">{item.name}</span>
                              <Badge tone="neutral">Folder</Badge>
                            </div>
                            <Text size="sm" variant="muted">
                              Double-click to open
                            </Text>
                          </div>
                        </div>
                      </ContextMenu>
                    ) : (
                      <EntityCard
                        entity={item.entity}
                        selected={item.entity.id === selectedEntityId}
                        multiSelected={multiSelectedIds.includes(item.entity.id)}
                        multiCount={
                          multiSelectedIds.includes(item.entity.id) ? multiSelectedIds.length : 1
                        }
                        linkCount={linkCounts.get(item.entity.id) ?? 0}
                        canLink={canLinkEntities}
                        projectUuid={activeProjectUuid}
                        onSelect={(e) => {
                          const eid = item.entity.id;
                          if (e.ctrlKey || e.metaKey) {
                            setMultiSelectedIds((prev) =>
                              prev.includes(eid) ? prev.filter((x) => x !== eid) : [...prev, eid],
                            );
                          } else if (e.shiftKey && selectedEntityId) {
                            const entItems = items.filter(
                              (it): it is Extract<BrowseItem, { kind: 'entity' }> =>
                                it.kind === 'entity',
                            );
                            const iA = entItems.findIndex(
                              (it) => it.entity.id === selectedEntityId,
                            );
                            const iB = entItems.findIndex((it) => it.entity.id === eid);
                            if (iA >= 0 && iB >= 0) {
                              const lo = Math.min(iA, iB);
                              const hi = Math.max(iA, iB);
                              setMultiSelectedIds(
                                entItems.slice(lo, hi + 1).map((it) => it.entity.id),
                              );
                            }
                          } else {
                            setMultiSelectedIds([eid]);
                          }
                          onSelectEntity(eid);
                        }}
                        onEdit={() => setEditingEntity(item.entity)}
                        onAddDept={() => onRequestAddDepartment(item.entity.id)}
                        onLinkTo={() => {
                          const ids =
                            multiSelectedIds.includes(item.entity.id) && multiSelectedIds.length > 0
                              ? multiSelectedIds
                              : [item.entity.id];
                          const anchors = (tree?.entities ?? []).filter((e) => ids.includes(e.id));
                          setBulkLinkState({ anchors, direction: 'used_in' });
                        }}
                        onLinkFrom={() => {
                          const ids =
                            multiSelectedIds.includes(item.entity.id) && multiSelectedIds.length > 0
                              ? multiSelectedIds
                              : [item.entity.id];
                          const anchors = (tree?.entities ?? []).filter((e) => ids.includes(e.id));
                          setBulkLinkState({ anchors, direction: 'uses' });
                        }}
                        onResetThumb={async () => {
                          await apiClient.putEntityThumbnail(
                            item.entity.id,
                            { source: 'auto', file_id: null },
                            activeProjectUuid,
                          );
                          await refreshTree();
                        }}
                        onReveal={async () => {
                          await apiClient.revealPath(item.entity.rel_path, activeProjectUuid);
                        }}
                        onDelete={() => setDeletingEntity(item.entity)}
                        createItems={createItems}
                      />
                    )}
                  </VirtualCardRow>
                );
              })}
            </div>
          )}
        </div>
      </ContextMenu>

      <CreateEntityDialog
        open={createEntityOpen}
        onOpenChange={setCreateEntityOpen}
        parentFolder={currentFolder}
        departments={departments}
        availableTypes={availableTypes}
        availableTags={availableTags}
        onCreate={async (payload) => {
          try {
            const created = await apiClient.createEntity(payload, activeProjectUuid);
            await refreshTree();
            onSelectEntity(created.id);
            toast.push('success', `Created entity '${created.name}'`);
          } catch (err) {
            toast.push('danger', err instanceof Error ? err.message : 'Create failed');
            throw err;
          }
        }}
      />

      <CreateFolderDialog
        open={createFolderOpen}
        onOpenChange={setCreateFolderOpen}
        parentFolder={currentFolder}
        onCreate={async (name) => {
          try {
            await apiClient.createFolder(
              { parent_rel_path: currentFolder, name },
              activeProjectUuid,
            );
            await refreshTree();
            toast.push('success', `Created folder '${name}'`);
          } catch (err) {
            toast.push('danger', err instanceof Error ? err.message : 'Create folder failed');
            throw err;
          }
        }}
      />

      <EditEntityDialog
        open={Boolean(editingEntity)}
        onOpenChange={(open) => {
          if (!open) setEditingEntity(null);
        }}
        entity={editingEntity}
        availableTypes={availableTypes}
        availableTags={availableTags}
        onSave={async (patch) => {
          if (!editingEntity) return;
          await apiClient.updateEntity(
            editingEntity.id,
            {
              name: patch.name,
              entity_type: patch.entity_type,
              description: patch.description,
            },
            activeProjectUuid,
          );
          await apiClient.putEntityTags(editingEntity.id, patch.tags, activeProjectUuid);
          await refreshTree();
          toast.push('success', `Updated '${patch.name}'`);
        }}
      />

      <ConfirmTrashDialog
        open={Boolean(deletingEntity)}
        onOpenChange={(open) => {
          if (!open) setDeletingEntity(null);
        }}
        title="Delete Entity"
        message={
          deletingEntity
            ? `Move '${deletingEntity.name}' and all its tasks/products to 00_Pipeline/trash/?`
            : ''
        }
        onConfirm={async () => {
          if (!deletingEntity) return;
          await apiClient.deleteEntity(deletingEntity.id, activeProjectUuid);
          await refreshTree();
          toast.push('info', `Moved '${deletingEntity.name}' to trash`);
        }}
      />

      <EntityLinkPickerDialog
        open={bulkLinkState !== null}
        onOpenChange={(o) => {
          if (!o) setBulkLinkState(null);
        }}
        anchorEntities={bulkLinkState?.anchors ?? []}
        allEntities={tree?.entities ?? []}
        direction={bulkLinkState?.direction ?? 'used_in'}
      />
    </div>
  );
}
