import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import {
  Badge,
  Button,
  Icon,
  Panel,
  SearchField,
  Stack,
  Text,
  Tree,
  type IconName,
  type TreeNode,
} from '../../components/ui';
import { apiClient, type FileSummaryOut } from '../../lib/api/client';
import { useProjectStore } from '../project/projectStore';
import './ProductsPanel.css';

interface NodeMeta {
  nodeType: 'entity' | 'department' | 'task' | 'version' | 'file';
  file?: FileSummaryOut;
}

function iconForKind(kind: string): IconName {
  switch (kind) {
    case 'image2d':
      return 'image';
    case 'video':
      return 'video';
    case 'scene3d':
      return 'box3d';
    case 'audio':
      return 'audio';
    case 'document':
      return 'doc';
    case 'data':
      return 'table';
    default:
      return 'file';
  }
}

export interface ProductsPanelProps {
  selectedFileId: string | null;
  onSelectFile: (file: FileSummaryOut) => void;
  onStatusMessage: (msg: string) => void;
}

export function ProductsPanel({
  selectedFileId,
  onSelectFile,
  onStatusMessage,
}: ProductsPanelProps) {
  const queryClient = useQueryClient();
  const activeProjectUuid = useProjectStore((s) => s.activeProjectUuid);
  const openSettings = useProjectStore((s) => s.openSettings);
  const [search, setSearch] = useState('');
  const [hoveredThumb, setHoveredThumb] = useState<{ id: string; name: string } | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['entities', activeProjectUuid],
    queryFn: () => apiClient.listEntities(activeProjectUuid),
    enabled: Boolean(activeProjectUuid),
  });

  const treeNodes: TreeNode[] = useMemo(() => {
    if (!data) return [];
    const q = search.trim().toLowerCase();
    return (data.entities ?? [])
      .filter(
        (ent) =>
          !q ||
          ent.name.toLowerCase().includes(q) ||
          (ent.tags ?? []).some((t) => t.toLowerCase().includes(q)) ||
          (ent.entity_type ?? '').toLowerCase().includes(q),
      )
      .map((ent) => ({
        id: `ent:${ent.id}`,
        label: ent.name,
        icon: 'folder' as IconName,
        badge: ent.is_missing ? <Badge tone="danger">missing</Badge> : undefined,
        meta: { nodeType: 'entity' } satisfies NodeMeta,
        children: (ent.departments ?? []).map((dept) => ({
          id: `dept:${dept.id}`,
          label: dept.name,
          icon: 'folder' as IconName,
          meta: { nodeType: 'department' } satisfies NodeMeta,
          children: (dept.tasks ?? []).map((task) => {
            const versions = task.product?.versions ?? [];
            const masterId = task.product?.master_version_id;
            return {
              id: `task:${task.id}`,
              label: task.name,
              icon: 'layers' as IconName,
              meta: { nodeType: 'task' } satisfies NodeMeta,
              children: versions.map((ver) => ({
                id: `ver:${ver.id}`,
                label: ver.label,
                icon: 'folder' as IconName,
                badge:
                  ver.id === masterId ? (
                    <Badge tone="accent">MASTER</Badge>
                  ) : (
                    <Badge tone="neutral">{(ver.files ?? []).length}</Badge>
                  ),
                meta: { nodeType: 'version' } satisfies NodeMeta,
                children: (ver.files ?? []).map((f) => ({
                  id: `file:${f.id}`,
                  label: f.filename,
                  icon: iconForKind(f.media_kind),
                  disabled: f.media_kind === 'unsupported',
                  tooltip: f.is_sequence
                    ? `Sequence (${f.frame_start}-${f.frame_end})`
                    : f.relative_path,
                  badge: f.is_sequence ? (
                    <Badge tone="accent">{f.frame_count}f</Badge>
                  ) : (
                    <Badge tone="neutral">{f.detected_format}</Badge>
                  ),
                  meta: { nodeType: 'file', file: f } satisfies NodeMeta,
                })),
              })),
            };
          }),
        })),
      }));
  }, [data, search]);

  const defaultExpandedIds = useMemo(() => {
    const ids: string[] = [];
    for (const ent of data?.entities ?? []) {
      ids.push(`ent:${ent.id}`);
      for (const d of ent.departments ?? []) {
        ids.push(`dept:${d.id}`);
        for (const t of d.tasks ?? []) {
          ids.push(`task:${t.id}`);
          for (const v of t.product?.versions ?? []) {
            ids.push(`ver:${v.id}`);
          }
        }
      }
    }
    return ids;
  }, [data]);

  return (
    <Panel
      title="Entities"
      className="org-products-panel"
      headerRight={
        <Button
          variant="icon"
          size="sm"
          title="Reconcile project disk & database"
          aria-label="Reconcile project"
          disabled={!activeProjectUuid}
          onClick={async () => {
            if (!activeProjectUuid) return;
            onStatusMessage('Reconciling project...');
            const rep = await apiClient.reconcileProject(activeProjectUuid);
            await queryClient.invalidateQueries({ queryKey: ['entities', activeProjectUuid] });
            onStatusMessage(`Reconciled ${rep.entities_scanned} entities (${rep.files_scanned} files)`);
          }}
        >
          <Icon name="refresh" size="sm" />
        </Button>
      }
    >
      <div className="org-products">
        {!activeProjectUuid ? (
          <Stack padding="3" gap="2">
            <Text variant="muted">No active project.</Text>
            <Button size="sm" variant="primary" onClick={() => openSettings('project')}>
              Create / Open Project
            </Button>
          </Stack>
        ) : (
          <>
            <SearchField
              value={search}
              onChange={setSearch}
              placeholder="Filter entities..."
              ariaLabel="Filter entities"
            />
            {isLoading ? (
              <Text variant="muted">Loading entities...</Text>
            ) : (
              <Tree
                key={`${activeProjectUuid}:${defaultExpandedIds.length}`}
                nodes={treeNodes}
                selectedId={selectedFileId ? `file:${selectedFileId}` : null}
                defaultExpandedIds={defaultExpandedIds}
                ariaLabel="Entities hierarchy"
                onSelect={(node) => {
                  const meta = node.meta as NodeMeta | undefined;
                  if (meta?.nodeType === 'file' && meta.file) {
                    onSelectFile(meta.file);
                  }
                }}
                onHoverNode={(node) => {
                  const meta = node?.meta as NodeMeta | undefined;
                  if (meta?.nodeType === 'file' && meta.file) {
                    queryClient.prefetchQuery({
                      queryKey: ['inspect', activeProjectUuid, meta.file.id],
                      queryFn: () => apiClient.inspectFile(meta.file!.id, activeProjectUuid),
                      staleTime: 60_000,
                    });
                    if (meta.file.media_kind === 'image2d') {
                      setHoveredThumb({ id: meta.file.id, name: meta.file.filename });
                    } else {
                      setHoveredThumb(null);
                    }
                  } else {
                    setHoveredThumb(null);
                  }
                }}
              />
            )}

            {hoveredThumb && (
              <div className="org-products__thumb-box">
                <img
                  src={apiClient.fileThumbnailUrl(hoveredThumb.id, activeProjectUuid)}
                  alt={hoveredThumb.name}
                  className="org-products__thumb-img"
                />
                <Text size="sm" truncate>
                  {hoveredThumb.name}
                </Text>
              </div>
            )}
          </>
        )}
      </div>
    </Panel>
  );
}
