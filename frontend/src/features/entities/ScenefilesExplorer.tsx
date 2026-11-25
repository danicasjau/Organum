import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
} from 'react';
import {
  Button,
  ContextMenu,
  Icon,
  Inline,
  SceneFileIcon,
  SearchField,
  Select,
  Stack,
  Text,
  useToast,
} from '../../components/ui';
import { useCssVarRef } from '../../components/ui/_internal/useCssVar';
import {
  apiClient,
  type LauncherOut,
  type SceneEntryOut,
  type SceneListResponse,
  type TaskOut,
} from '../../lib/api/client';
import { useProjectStore } from '../project/projectStore';
import { useEntitiesStore } from './entitiesStore';
import { ConfirmTrashDialog, OpenWithDialog, PromptNameDialog } from './EntityDialogs';
import './ScenefilesExplorer.css';

const SORT_OPTIONS = [
  { value: 'name', label: 'Name' },
  { value: 'ext', label: 'Type' },
  { value: 'mtime', label: 'Modified' },
];

const EMPTY_ENTRIES: SceneEntryOut[] = [];
const EMPTY_LAUNCHERS: LauncherOut[] = [];
const EMPTY_CUSTOM_ICONS: string[] = [];

function MarqueeBox({
  rect,
}: {
  rect: { left: number; top: number; width: number; height: number } | null;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useCssVarRef(ref, '--mq-x', `${rect?.left ?? 0}px`);
  useCssVarRef(ref, '--mq-y', `${rect?.top ?? 0}px`);
  useCssVarRef(ref, '--mq-w', `${rect?.width ?? 0}px`);
  useCssVarRef(ref, '--mq-h', `${rect?.height ?? 0}px`);
  if (!rect) return null;
  return <div ref={ref} className="org-scenefiles__marquee" aria-hidden="true" />;
}

export function ScenefilesExplorer({
  task,
  onRequestPublish,
  onOpenMediaScenefile,
}: {
  task: TaskOut | null;
  onRequestPublish: (relPaths: string[]) => void;
  onOpenMediaScenefile: (taskId: string, entry: SceneEntryOut) => void;
}) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const activeProjectUuid = useProjectStore((s) => s.activeProjectUuid);
  const viewMode = useEntitiesStore((s) => s.scenefilesViewMode);
  const setViewMode = useEntitiesStore((s) => s.setScenefilesViewMode);

  const [subPath, setSubPath] = useState('');
  const [backStack, setBackStack] = useState<string[]>([]);
  const [fwdStack, setFwdStack] = useState<string[]>([]);
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState<'name' | 'ext' | 'mtime'>('name');
  const [selectedRels, setSelectedRels] = useState<string[]>([]);
  const [anchorIdx, setAnchorIdx] = useState<number>(0);

  const [mkdirOpen, setMkdirOpen] = useState(false);
  const [renamingEntry, setRenamingEntry] = useState<SceneEntryOut | null>(null);
  const [trashConfirmOpen, setTrashConfirmOpen] = useState(false);
  const [openWithEntry, setOpenWithEntry] = useState<SceneEntryOut | null>(null);
  const [dropFolderTarget, setDropFolderTarget] = useState<string | null>(null);
  const [marqueeRect, setMarqueeRect] = useState<{
    left: number;
    top: number;
    width: number;
    height: number;
  } | null>(null);

  const surfaceRef = useRef<HTMLDivElement>(null);
  const uploadInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setSubPath('');
    setBackStack([]);
    setFwdStack([]);
    setSelectedRels([]);
  }, [task?.id]);

  const { data: sceneData } = useQuery<SceneListResponse>({
    queryKey: ['scenefiles', activeProjectUuid, task?.id, subPath],
    queryFn: () => apiClient.listScenefiles(task!.id, subPath, activeProjectUuid),
    enabled: Boolean(activeProjectUuid && task?.id),
  });

  // Live watchfiles SSE stream for currently open scenefiles directory
  useEffect(() => {
    if (!activeProjectUuid || !task?.id || typeof EventSource === 'undefined') return;
    const url = apiClient.scenefileWatchUrl(task.id, subPath, activeProjectUuid);
    const es = new EventSource(url);
    es.addEventListener('changed', () => {
      void queryClient.invalidateQueries({
        queryKey: ['scenefiles', activeProjectUuid, task.id, subPath],
      });
    });
    return () => {
      es.close();
    };
  }, [activeProjectUuid, task?.id, subPath, queryClient]);

  const { data: customIconsData } = useQuery({
    queryKey: ['custom-icons'],
    queryFn: () => apiClient.listCustomIcons(),
    staleTime: 60_000,
  });
  const customIconSet = useMemo(
    () => new Set(customIconsData ?? EMPTY_CUSTOM_ICONS),
    [customIconsData],
  );

  const { data: launchersData } = useQuery({
    queryKey: ['launchers'],
    queryFn: () => apiClient.listLaunchers(),
    enabled: Boolean(openWithEntry),
  });
  const launchers = launchersData ?? EMPTY_LAUNCHERS;

  const entries = useMemo(() => {
    const raw = sceneData?.entries ?? EMPTY_ENTRIES;
    const q = search.trim().toLowerCase();
    const filtered = q ? raw.filter((e) => e.name.toLowerCase().includes(q)) : raw;
    return [...filtered].sort((a, b) => {
      if (a.is_dir !== b.is_dir) return a.is_dir ? -1 : 1;
      if (sortBy === 'ext') return a.extension.localeCompare(b.extension) || a.name.localeCompare(b.name);
      if (sortBy === 'mtime') return b.mtime - a.mtime;
      return a.name.localeCompare(b.name);
    });
  }, [sceneData?.entries, search, sortBy]);

  const refreshScene = async () => {
    if (!task) return;
    await queryClient.invalidateQueries({
      queryKey: ['scenefiles', activeProjectUuid, task.id, subPath],
    });
  };

  const navigateTo = (nextPath: string) => {
    if (nextPath === subPath) return;
    setBackStack((prev) => [...prev, subPath]);
    setFwdStack([]);
    setSubPath(nextPath);
    setSelectedRels([]);
  };

  const handleGoBack = () => {
    if (backStack.length === 0) return;
    const prev = backStack[backStack.length - 1]!;
    setBackStack((b) => b.slice(0, -1));
    setFwdStack((f) => [subPath, ...f]);
    setSubPath(prev);
    setSelectedRels([]);
  };

  const handleGoForward = () => {
    if (fwdStack.length === 0) return;
    const next = fwdStack[0]!;
    setFwdStack((f) => f.slice(1));
    setBackStack((b) => [...b, subPath]);
    setSubPath(next);
    setSelectedRels([]);
  };

  const handleOpenEntry = async (entry: SceneEntryOut) => {
    if (!task) return;
    if (entry.is_dir) {
      navigateTo(entry.rel_path);
      return;
    }
    if (entry.is_media) {
      onOpenMediaScenefile(task.id, entry);
      return;
    }
    try {
      const res = await apiClient.launchFile(entry.project_rel_path, null, activeProjectUuid);
      toast.push('success', `Launched ${entry.name} (${res.method})`);
    } catch (err) {
      toast.push('danger', err instanceof Error ? err.message : 'Launch failed');
    }
  };

  const handleTileClick = (entry: SceneEntryOut, idx: number, e: MouseEvent) => {
    if (e.shiftKey && entries.length > 0) {
      const lo = Math.min(anchorIdx, idx);
      const hi = Math.max(anchorIdx, idx);
      setSelectedRels(entries.slice(lo, hi + 1).map((x) => x.rel_path));
    } else if (e.ctrlKey || e.metaKey) {
      setSelectedRels((prev) =>
        prev.includes(entry.rel_path)
          ? prev.filter((x) => x !== entry.rel_path)
          : [...prev, entry.rel_path],
      );
      setAnchorIdx(idx);
    } else {
      setSelectedRels([entry.rel_path]);
      setAnchorIdx(idx);
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'F2' && selectedRels.length === 1) {
      e.preventDefault();
      const hit = entries.find((x) => x.rel_path === selectedRels[0]);
      if (hit) setRenamingEntry(hit);
    } else if (e.key === 'Delete' && selectedRels.length > 0) {
      e.preventDefault();
      setTrashConfirmOpen(true);
    } else if (
      e.key === 'Backspace' &&
      subPath &&
      document.activeElement?.tagName !== 'INPUT'
    ) {
      e.preventDefault();
      const up = subPath.includes('/') ? subPath.slice(0, subPath.lastIndexOf('/')) : '';
      navigateTo(up);
    }
  };

  const handleMarqueePointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || (e.target as HTMLElement).closest('[data-scene-item]')) return;
    const container = surfaceRef.current;
    if (!container) return;
    const box = container.getBoundingClientRect();
    const startX = e.clientX - box.left + container.scrollLeft;
    const startY = e.clientY - box.top + container.scrollTop;
    setSelectedRels([]);

    const onMove = (mv: globalThis.PointerEvent) => {
      const curX = mv.clientX - box.left + container.scrollLeft;
      const curY = mv.clientY - box.top + container.scrollTop;
      const left = Math.min(startX, curX);
      const top = Math.min(startY, curY);
      const width = Math.abs(curX - startX);
      const height = Math.abs(curY - startY);
      setMarqueeRect({ left, top, width, height });

      const hits: string[] = [];
      container.querySelectorAll<HTMLElement>('[data-scene-item]').forEach((el) => {
        const r = el.getBoundingClientRect();
        const elL = r.left - box.left + container.scrollLeft;
        const elT = r.top - box.top + container.scrollTop;
        const overlaps =
          elL < left + width &&
          elL + r.width > left &&
          elT < top + height &&
          elT + r.height > top;
        if (overlaps && el.dataset.relPath) hits.push(el.dataset.relPath);
      });
      setSelectedRels(hits);
    };

    const onUp = () => {
      setMarqueeRect(null);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  const handleOsDrop = async (e: DragEvent<HTMLDivElement>) => {
    if (!task) return;
    const osFiles = Array.from(e.dataTransfer.files ?? []);
    if (osFiles.length === 0) return;
    e.preventDefault();
    await apiClient.uploadScenefiles(task.id, subPath, osFiles, activeProjectUuid);
    await refreshScene();
    toast.push('success', `Uploaded ${osFiles.length} file(s) to scenefiles`);
  };

  const renderEntry = (entry: SceneEntryOut, idx: number) => {
    const selected = selectedRels.includes(entry.rel_path);
    const activeDragRels = selected && selectedRels.length > 0 ? selectedRels : [entry.rel_path];
    const tooltip = entry.is_dir
      ? `${entry.name} (Double-click to enter)`
      : entry.is_media
        ? `${entry.name} (Double-click to inspect in Viewer)`
        : `${entry.name} — Double-click launches via local loopback backend (browsers block file://)`;

    return (
      <ContextMenu
        key={entry.rel_path}
        items={[
          {
            id: 'open',
            label: entry.is_dir ? 'Open Folder' : entry.is_media ? 'Open in Viewer' : 'Open (Backend Launch)',
            onSelect: () => void handleOpenEntry(entry),
          },
          ...(!entry.is_dir
            ? [
                {
                  id: 'open-with',
                  label: 'Open With...',
                  onSelect: () => setOpenWithEntry(entry),
                },
                {
                  id: 'publish',
                  label: 'Publish to Product...',
                  onSelect: () => onRequestPublish(activeDragRels),
                },
              ]
            : []),
          {
            id: 'reveal',
            label: 'Reveal in File Manager',
            onSelect: async () => {
              await apiClient.revealPath(entry.project_rel_path, activeProjectUuid);
            },
          },
          { id: 'sep', label: '', separator: true },
          {
            id: 'rename',
            label: 'Rename',
            shortcut: 'F2',
            onSelect: () => setRenamingEntry(entry),
          },
          {
            id: 'delete',
            label: 'Delete to Trash...',
            shortcut: 'Del',
            onSelect: () => {
              if (!selected) setSelectedRels([entry.rel_path]);
              setTrashConfirmOpen(true);
            },
          },
        ]}
      >
        <div
          data-scene-item="true"
          data-rel-path={entry.rel_path}
          data-selected={selected ? 'true' : undefined}
          data-drop-target={dropFolderTarget === entry.rel_path ? 'true' : undefined}
          data-mode={viewMode}
          className="org-scenefiles__item"
          title={tooltip}
          draggable
          onDragStart={(e) => {
            if (!task) return;
            e.dataTransfer.setData(
              'application/x-organum-scenefiles',
              JSON.stringify({ taskId: task.id, relPaths: activeDragRels }),
            );
          }}
          onDragOver={(e) => {
            if (entry.is_dir && e.dataTransfer.types.includes('application/x-organum-scenefiles')) {
              e.preventDefault();
              setDropFolderTarget(entry.rel_path);
            }
          }}
          onDragLeave={() => {
            if (dropFolderTarget === entry.rel_path) setDropFolderTarget(null);
          }}
          onDrop={async (e) => {
            if (!entry.is_dir || !task) return;
            const raw = e.dataTransfer.getData('application/x-organum-scenefiles');
            if (!raw) return;
            e.preventDefault();
            e.stopPropagation();
            setDropFolderTarget(null);
            const parsed = JSON.parse(raw) as { taskId: string; relPaths: string[] };
            if (parsed.taskId === task.id) {
              await apiClient.moveScenefiles(
                task.id,
                parsed.relPaths,
                entry.rel_path,
                activeProjectUuid,
              );
              await refreshScene();
              toast.push('success', `Moved to ${entry.name}/`);
            }
          }}
          onClick={(e) => handleTileClick(entry, idx, e)}
          onDoubleClick={() => void handleOpenEntry(entry)}
        >
          <div className="org-scenefiles__iconwrap">
            {entry.is_image && entry.thumb_url ? (
              <img src={entry.thumb_url} alt={entry.name} className="org-scenefiles__thumb" />
            ) : (
              <SceneFileIcon
                extension={entry.extension}
                isDir={entry.is_dir}
                size={viewMode === 'list' ? 'sm' : 'md'}
                customIconUrl={
                  entry.extension &&
                  customIconSet.has(entry.extension.replace(/^\./, '').toLowerCase())
                    ? apiClient.customIconUrl(entry.extension)
                    : undefined
                }
              />
            )}
          </div>
          <span className="org-scenefiles__name">{entry.name}</span>
          {viewMode === 'list' && (
            <Text size="sm" variant="mono">
              {entry.is_dir ? 'DIR' : `${Math.max(1, Math.round(entry.size / 1024))} KB`}
            </Text>
          )}
        </div>
      </ContextMenu>
    );
  };

  const crumbs = subPath ? subPath.split('/') : [];

  return (
    <div
      className="org-scenefiles"
      tabIndex={0}
      aria-label="Scenefiles explorer"
      onKeyDown={handleKeyDown}
    >
      <div className="org-scenefiles__header">
        <Text size="sm">
          Scenefiles
        </Text>
        <Inline gap="1">
          <Button
            size="sm"
            disabled={!task || selectedRels.length === 0}
            variant="primary"
            onClick={() => onRequestPublish(selectedRels)}
          >
            Publish ({selectedRels.length})
          </Button>
          <Button size="sm" disabled={!task} onClick={() => setMkdirOpen(true)}>
            <Icon name="folder-plus" size="sm" />
          </Button>
          <Button
            size="sm"
            disabled={!task}
            onClick={() => uploadInputRef.current?.click()}
            title="Upload files into scenefiles/"
          >
            Upload
          </Button>
          <input
            ref={uploadInputRef}
            type="file"
            multiple
            hidden
            onChange={async (e) => {
              const files = Array.from(e.target.files ?? []);
              if (files.length > 0 && task) {
                await apiClient.uploadScenefiles(task.id, subPath, files, activeProjectUuid);
                await refreshScene();
              }
              e.target.value = '';
            }}
          />
          <Button
            size="sm"
            variant="toggle"
            pressed={viewMode === 'grid'}
            aria-label="Toggle grid or list view"
            onClick={() => setViewMode(viewMode === 'grid' ? 'list' : 'grid')}
          >
            <Icon name={viewMode === 'grid' ? 'grid' : 'table'} size="sm" />
          </Button>
        </Inline>
      </div>

      <div className="org-scenefiles__nav">
        <Button
          size="sm"
          variant="icon"
          disabled={backStack.length === 0}
          aria-label="Back"
          onClick={handleGoBack}
        >
          <Icon name="chevron-left" size="sm" />
        </Button>
        <Button
          size="sm"
          variant="icon"
          disabled={fwdStack.length === 0}
          aria-label="Forward"
          onClick={handleGoForward}
        >
          <Icon name="chevron-right" size="sm" />
        </Button>
        <Button
          size="sm"
          variant="icon"
          disabled={!subPath}
          aria-label="Up directory"
          onClick={() => {
            const up = subPath.includes('/') ? subPath.slice(0, subPath.lastIndexOf('/')) : '';
            navigateTo(up);
          }}
        >
          <Icon name="arrow-up" size="sm" />
        </Button>

        <div className="org-scenefiles__crumbs">
          <button
            type="button"
            className="org-scenefiles__crumb"
            onClick={() => navigateTo('')}
          >
            scenefiles
          </button>
          {crumbs.map((c, i) => {
            const p = crumbs.slice(0, i + 1).join('/');
            return (
              <span key={p} className="org-scenefiles__crumb-sep">
                /{' '}
                <button
                  type="button"
                  className="org-scenefiles__crumb"
                  onClick={() => navigateTo(p)}
                >
                  {c}
                </button>
              </span>
            );
          })}
        </div>

        <SearchField
          aria-label="Search scenefiles"
          placeholder="Filter..."
          value={search}
          onChange={setSearch}
          className="org-scenefiles__search"
        />
        <Select
          ariaLabel="Sort scenefiles"
          value={sortBy}
          onChange={(v) => setSortBy(v as 'name' | 'ext' | 'mtime')}
          options={SORT_OPTIONS}
          filterable={false}
          className="org-scenefiles__sort"
        />
      </div>

      <div
        ref={surfaceRef}
        className="org-scenefiles__surface"
        data-mode={viewMode}
        onPointerDown={handleMarqueePointerDown}
        onDragOver={(e) => {
          if (task && e.dataTransfer.types.includes('Files')) e.preventDefault();
        }}
        onDrop={(e) => void handleOsDrop(e)}
      >
        {!task ? (
          <Stack padding="2">
            <Text size="sm" variant="muted">
              Select a task to browse its live scenefiles/ directory.
            </Text>
          </Stack>
        ) : entries.length === 0 ? (
          <Stack padding="2">
            <Text size="sm" variant="muted">
              Empty directory — drop files here or click Upload.
            </Text>
          </Stack>
        ) : (
          entries.map((entry, idx) => renderEntry(entry, idx))
        )}
        <MarqueeBox rect={marqueeRect} />
      </div>

      <PromptNameDialog
        open={mkdirOpen}
        onOpenChange={setMkdirOpen}
        title="New Scenefiles Subfolder"
        label="Folder name"
        confirmLabel="Create Folder"
        onConfirm={async (name) => {
          if (!task) return;
          await apiClient.mkdirScenefile(task.id, subPath, name, activeProjectUuid);
          await refreshScene();
          toast.push('success', `Created folder '${name}'`);
        }}
      />

      <PromptNameDialog
        open={Boolean(renamingEntry)}
        onOpenChange={(open) => {
          if (!open) setRenamingEntry(null);
        }}
        title="Rename Item"
        label="New name"
        initialValue={renamingEntry?.name ?? ''}
        confirmLabel="Rename"
        onConfirm={async (newName) => {
          if (!task || !renamingEntry) return;
          await apiClient.renameScenefile(task.id, renamingEntry.rel_path, newName, activeProjectUuid);
          await refreshScene();
        }}
      />

      <ConfirmTrashDialog
        open={trashConfirmOpen}
        onOpenChange={setTrashConfirmOpen}
        title="Delete Scenefiles"
        message={`Move ${selectedRels.length} selected item(s) to 00_Pipeline/trash/?`}
        onConfirm={async () => {
          if (!task) return;
          await apiClient.deleteScenefiles(task.id, selectedRels, activeProjectUuid);
          setSelectedRels([]);
          await refreshScene();
          toast.push('info', 'Moved selection to trash');
        }}
      />

      <OpenWithDialog
        open={Boolean(openWithEntry)}
        onOpenChange={(open) => {
          if (!open) setOpenWithEntry(null);
        }}
        targetLabel={openWithEntry?.name ?? ''}
        launchers={launchers}
        onLaunch={async (launcherId) => {
          if (!openWithEntry) return;
          const res = await apiClient.launchFile(
            openWithEntry.project_rel_path,
            launcherId,
            activeProjectUuid,
          );
          toast.push('success', `Launched via ${res.method}`);
        }}
      />
    </div>
  );
}

