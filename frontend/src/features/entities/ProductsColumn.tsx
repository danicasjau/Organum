import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState, type DragEvent } from 'react';
import {
  Badge,
  Button,
  ContextMenu,
  Icon,
  Stack,
  Text,
  useToast,
  type IconName,
} from '../../components/ui';
import {
  apiClient,
  type EntityOut,
  type FileSummaryOut,
  type LauncherOut,
  type ProductVersionOut,
  type TaskOut,
} from '../../lib/api/client';
import { useProjectStore } from '../project/projectStore';
import { ConfirmTrashDialog, OpenWithDialog, PublishDialog } from './EntityDialogs';
import './ProductsColumn.css';

function iconForMedia(kind: string): IconName {
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

export interface PendingPublish {
  source: 'scenefiles' | 'upload';
  scenefileRelPaths?: string[];
  uploadFiles?: File[];
  labels: string[];
}

const EMPTY_LAUNCHERS: LauncherOut[] = [];

export function ProductsColumn({
  entity,
  task,
  selectedFileId,
  onSelectFile,
  pendingExternalPublish,
  onClearExternalPublish,
}: {
  entity: EntityOut | null;
  task: TaskOut | null;
  selectedFileId: string | null;
  onSelectFile: (file: FileSummaryOut) => void;
  pendingExternalPublish: PendingPublish | null;
  onClearExternalPublish: () => void;
}) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const activeProjectUuid = useProjectStore((s) => s.activeProjectUuid);

  const [expandedVersions, setExpandedVersions] = useState<Record<string, boolean>>({});
  const [dropActive, setDropActive] = useState(false);
  const [localPublish, setLocalPublish] = useState<PendingPublish | null>(null);
  const [deletingVersion, setDeletingVersion] = useState<ProductVersionOut | null>(null);
  const [openWithFile, setOpenWithFile] = useState<FileSummaryOut | null>(null);

  const { data: launchersData } = useQuery({
    queryKey: ['launchers'],
    queryFn: () => apiClient.listLaunchers(),
    enabled: Boolean(openWithFile),
  });
  const launchers = launchersData ?? EMPTY_LAUNCHERS;

  const product = task?.product ?? null;
  const versionsAsc = useMemo(
    () =>
      [...(product?.versions ?? [])].sort((a, b) => a.version_number - b.version_number),
    [product?.versions],
  );
  const masterVersion = useMemo(
    () => versionsAsc.find((v) => v.id === product?.master_version_id) ?? null,
    [versionsAsc, product?.master_version_id],
  );

  const refreshTree = async () => {
    await queryClient.invalidateQueries({ queryKey: ['entities', activeProjectUuid] });
  };

  const handleSetMaster = async (versionId: string) => {
    if (!product) return;
    await apiClient.setProductMaster(product.id, versionId, activeProjectUuid);
    await refreshTree();
    toast.push('success', 'Updated MASTER version and master.json');
  };

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDropActive(false);
    if (!task) return;

    const rawScene = e.dataTransfer.getData('application/x-organum-scenefiles');
    if (rawScene) {
      try {
        const parsed = JSON.parse(rawScene) as { taskId: string; relPaths: string[] };
        if (parsed.taskId === task.id && parsed.relPaths.length > 0) {
          setLocalPublish({
            source: 'scenefiles',
            scenefileRelPaths: parsed.relPaths,
            labels: parsed.relPaths,
          });
          return;
        }
      } catch {
        // ignore invalid payload
      }
    }

    const osFiles = Array.from(e.dataTransfer.files ?? []);
    if (osFiles.length > 0) {
      setLocalPublish({
        source: 'upload',
        uploadFiles: osFiles,
        labels: osFiles.map((f) => f.name),
      });
    }
  };

  const activePublish = localPublish ?? pendingExternalPublish;

  const renderFileRow = (f: FileSummaryOut, keyPrefix: string) => {
    const selected = f.id === selectedFileId;
    const canThumb = f.media_kind === 'image2d' || f.media_kind === 'video';
    return (
      <ContextMenu
        key={`${keyPrefix}:${f.id}`}
        items={[
          { id: 'open', label: 'Open in Viewer', onSelect: () => onSelectFile(f) },
          ...(canThumb && entity
            ? [
                {
                  id: 'set-thumb',
                  label: 'Set as Entity Thumbnail',
                  onSelect: async () => {
                    await apiClient.putEntityThumbnail(
                      entity.id,
                      { source: 'manual', file_id: f.id },
                      activeProjectUuid,
                    );
                    await refreshTree();
                    toast.push('success', `Set '${f.filename}' as entity thumbnail`);
                  },
                },
              ]
            : []),
          ...(f.is_sequence
            ? [
                {
                  id: 'seq-udim',
                  label: 'Treat Sequence as UDIM Tiles',
                  onSelect: async () => {
                    await apiClient.patchFile(
                      f.id,
                      { sequence_kind: 'udim', sequence_kind_user_override: true },
                      activeProjectUuid,
                    );
                    await refreshTree();
                    toast.push('info', `${f.filename}: UDIM override saved`);
                  },
                },
                {
                  id: 'seq-frames',
                  label: 'Treat Sequence as Frames',
                  onSelect: async () => {
                    await apiClient.patchFile(
                      f.id,
                      { sequence_kind: 'frames', sequence_kind_user_override: true },
                      activeProjectUuid,
                    );
                    await refreshTree();
                    toast.push('info', `${f.filename}: Frame sequence override saved`);
                  },
                },
              ]
            : []),
          {
            id: 'open-with',
            label: 'Open With...',
            onSelect: () => setOpenWithFile(f),
          },
          {
            id: 'reveal',
            label: 'Reveal in File Manager',
            onSelect: async () => {
              await apiClient.revealPath(f.relative_path, activeProjectUuid);
            },
          },
        ]}
      >
        <button
          type="button"
          role="treeitem"
          aria-selected={selected}
          data-file-id={f.id}
          data-selected={selected ? 'true' : undefined}
          className="org-prodcol__filerow"
          title={f.relative_path}
          onClick={() => onSelectFile(f)}
        >
          <Icon name={iconForMedia(f.media_kind)} size="sm" />
          <span className="org-prodcol__filename">{f.filename}</span>
          {f.sequence_kind_user_override && (
            <Badge tone="accent">{f.sequence_kind.toUpperCase()}</Badge>
          )}
          <Badge tone={f.media_kind === 'unsupported' ? 'neutral' : 'accent'}>
            {f.detected_format}
          </Badge>
        </button>
      </ContextMenu>
    );
  };

  const renderVersion = (ver: ProductVersionOut, isMasterSlot: boolean) => {
    const isMaster = ver.id === product?.master_version_id;
    const expanded = expandedVersions[isMasterSlot ? `m:${ver.id}` : ver.id] ?? isMasterSlot;
    const toggleKey = isMasterSlot ? `m:${ver.id}` : ver.id;
    const dateStr = ver.created_at ? ver.created_at.slice(0, 10) : '';

    return (
      <div
        key={toggleKey}
        className="org-prodcol__verblock"
        data-master={isMasterSlot ? 'true' : undefined}
      >
        <ContextMenu
          items={[
            ...(!isMaster
              ? [
                  {
                    id: 'master',
                    label: 'Set as MASTER',
                    onSelect: () => void handleSetMaster(ver.id),
                  },
                ]
              : []),
            {
              id: 'reveal',
              label: 'Reveal in File Manager',
              onSelect: async () => {
                await apiClient.revealPath(ver.rel_path, activeProjectUuid);
              },
            },
            { id: 'sep', label: '', separator: true },
            {
              id: 'del',
              label: 'Delete Version...',
              onSelect: () => setDeletingVersion(ver),
            },
          ]}
        >
          <div
            className="org-prodcol__verrow"
            onClick={() =>
              setExpandedVersions((prev) => ({ ...prev, [toggleKey]: !expanded }))
            }
          >
            <Icon name={expanded ? 'chevron-down' : 'chevron-right'} size="sm" />
            <Button
              variant="icon"
              size="sm"
              aria-label={isMaster ? `${ver.label} is MASTER` : `Star ${ver.label} as MASTER`}
              title={isMaster ? 'Current MASTER version' : 'Star as MASTER version'}
              onClick={(e) => {
                e.stopPropagation();
                void handleSetMaster(ver.id);
              }}
            >
              <Icon name={isMaster ? 'star-filled' : 'star'} size="sm" />
            </Button>
            {isMasterSlot && <Badge tone="accent">MASTER</Badge>}
            <span className="org-prodcol__verlabel">{ver.label}</span>
            <span className="org-prodcol__comment" title={ver.comment}>
              {ver.comment || 'No comment'}
            </span>
            <Text size="sm" variant="muted">
              {ver.author_name ?? 'artist'} · {dateStr} · {ver.files?.length ?? 0}f
            </Text>
          </div>
        </ContextMenu>
        {expanded && (
          <div className="org-prodcol__files">
            {(ver.files ?? []).map((f) => renderFileRow(f, toggleKey))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div
      className="org-prodcol"
      data-drop-active={dropActive ? 'true' : undefined}
      onDragOver={(e) => {
        if (task) {
          e.preventDefault();
          setDropActive(true);
        }
      }}
      onDragLeave={() => setDropActive(false)}
      onDrop={handleDrop}
    >
      <div className="org-prodcol__header">
        <Text size="sm">
          Products{task ? ` — ${task.name}` : ''}
        </Text>
        <Text size="sm" variant="muted">
          Drop files/scenefiles to publish
        </Text>
      </div>

      <div className="org-prodcol__list" role="tree" aria-label="Task product versions">
        {!task ? (
          <Stack padding="2">
            <Text size="sm" variant="muted">
              Select a task in Column 2.
            </Text>
          </Stack>
        ) : versionsAsc.length === 0 ? (
          <Stack padding="2">
            <Text size="sm" variant="muted">
              No published versions yet. Drag files here or publish from Scenefiles below.
            </Text>
          </Stack>
        ) : (
          <>
            {masterVersion && renderVersion(masterVersion, true)}
            {versionsAsc.map((v) => renderVersion(v, false))}
          </>
        )}
      </div>

      <PublishDialog
        open={Boolean(activePublish)}
        onOpenChange={(open) => {
          if (!open) {
            setLocalPublish(null);
            onClearExternalPublish();
          }
        }}
        fileLabels={activePublish?.labels ?? []}
        isFirstVersion={versionsAsc.length === 0}
        onPublish={async (comment, setMaster) => {
          if (!task || !activePublish) return;
          if (activePublish.source === 'scenefiles' && activePublish.scenefileRelPaths) {
            const ver = await apiClient.publishScenefiles(
              task.id,
              {
                scenefile_rel_paths: activePublish.scenefileRelPaths,
                comment,
                set_master: setMaster,
              },
              activeProjectUuid,
            );
            toast.push('success', `Published ${ver.label}`);
          } else if (activePublish.source === 'upload' && activePublish.uploadFiles) {
            const ver = await apiClient.publishUploads(
              task.id,
              activePublish.uploadFiles,
              comment,
              setMaster,
              activeProjectUuid,
            );
            toast.push('success', `Published ${ver.label}`);
          }
          await refreshTree();
        }}
      />

      <ConfirmTrashDialog
        open={Boolean(deletingVersion)}
        onOpenChange={(open) => {
          if (!open) setDeletingVersion(null);
        }}
        title="Delete Product Version"
        message={
          deletingVersion
            ? `Move ${deletingVersion.label} to 00_Pipeline/trash/?`
            : ''
        }
        onConfirm={async () => {
          if (!deletingVersion) return;
          await apiClient.deleteVersion(deletingVersion.id, activeProjectUuid);
          await refreshTree();
          toast.push('info', `Moved ${deletingVersion.label} to trash`);
        }}
      />

      <OpenWithDialog
        open={Boolean(openWithFile)}
        onOpenChange={(open) => {
          if (!open) setOpenWithFile(null);
        }}
        targetLabel={openWithFile?.filename ?? ''}
        launchers={launchers}
        onLaunch={async (launcherId) => {
          if (!openWithFile) return;
          const res = await apiClient.launchFile(
            openWithFile.relative_path,
            launcherId,
            activeProjectUuid,
          );
          toast.push('success', `Launched via ${res.method}`);
        }}
      />
    </div>
  );
}

