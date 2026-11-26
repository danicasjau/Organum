import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import type { ThemeMode } from '../../app/App';
import { useStandardMenus } from '../../app/useStandardMenus';
import { useWorkspacePanels } from '../../app/useWorkspacePanels';
import {
  AppShell,
  Banner,
  Button,
  Dialog,
  Kbd,
  Panel,
  Spinner,
  SplitGroup,
  SplitHandle,
  SplitPane,
  Stack,
  StatusBar,
  StatusBarSegment,
  Table,
  Text,
  useGroupRef,
  type MenuEntry,
  type TableColumn,
} from '../../components/ui';
import {
  apiClient,
  registerScenefilePreviewUrl,
  type EntityOut,
  type FileSummaryOut,
  type SceneEntryOut,
} from '../../lib/api/client';
import { hasPerm, useAuthStore } from '../auth/authStore';
import { EntitiesWorkspaceDock } from '../entities/EntitiesWorkspaceDock';
import { useEntitiesStore } from '../entities/entitiesStore';
import { useProjectStore } from '../project/projectStore';
import { InspectPopups } from './InspectPopups';
import { InspectorPanel } from './InspectorPanel';
import { LayerStrip, hasLayerStripContent } from './LayerStrip';
import { ViewerToolStrip } from './ViewerToolStrip';
import { ViewerTopbar, type UdimOverrideInfo } from './ViewerTopbar';
import { getViewerModule } from './moduleRegistry';
import { DEFAULT_FILE_VIEWER_STATE, useViewerStore, type ChannelMode } from './viewerStore';
import './ViewerPage.css';

const HOTKEY_COLS: TableColumn[] = [
  { key: 'key', header: 'Shortcut' },
  { key: 'action', header: 'Action' },
];

const HOTKEY_ROWS = [
  { key: <Kbd>F</Kbd>, action: 'Fit 2D image or frame 3D scene' },
  { key: <Kbd>A</Kbd>, action: 'Frame all geometry in 3D' },
  { key: <Kbd>Tab</Kbd>, action: 'Toggle instant Freeze 2D / Live 3D (3D files)' },
  { key: <Kbd>1 / 3 / 7</Kbd>, action: '100% zoom (2D) or Front / Right / Top view (3D)' },
  { key: <Kbd>R G B A Y</Kbd>, action: 'Isolate RGB / R / G / B / Alpha / Luma' },
  { key: <Kbd>S</Kbd>, action: 'Bypass color adjustments' },
  {
    key: <Kbd>V R O B P E L</Kbd>,
    action: 'Select Pan / Rect / Ellipse / Free / Closed / Eraser / Laser',
  },
  { key: <Kbd>H</Kbd>, action: 'Show / Hide annotations' },
  { key: <Kbd>Alt+LMB / MMB</Kbd>, action: '3D Orbit / Pan (or Space+Drag in 2D)' },
  { key: <Kbd>Alt+Drag</Kbd>, action: '2D ROI marquee stats (min/max/mean)' },
  { key: <Kbd>Ctrl+Z / Ctrl+Y</Kbd>, action: 'Undo / Redo annotation stroke' },
  { key: <Kbd>[ / ]</Kbd>, action: 'Previous / Next layer, AOV, or UDIM tile in LayerStrip' },
  {
    key: <Kbd>Space / J / K / L</Kbd>,
    action: 'Play/Pause, Play Backwards, Pause, Play Forward (time-based)',
  },
  {
    key: <Kbd>Left / Right / I / O</Kbd>,
    action: 'Step 1 frame (Shift 10f) and set In/Out points',
  },
  { key: <Kbd>Ctrl+E</Kbd>, action: 'Toggle maximize Entities browser over workspace' },
  { key: <Kbd>F2 / Backspace</Kbd>, action: 'Rename selected scenefile / Navigate up folder' },
  { key: <Kbd>?</Kbd>, action: 'Toggle this shortcuts dialog' },
];

const EMPTY_PROJECTS: Awaited<ReturnType<typeof apiClient.listProjects>> = [];

export function ViewerPage({
  theme,
  onToggleTheme,
}: {
  theme: ThemeMode;
  onToggleTheme: () => void;
}) {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const queryClient = useQueryClient();

  const activeProjectUuid = useProjectStore((s) => s.activeProjectUuid);
  const setActiveProject = useProjectStore((s) => s.setActiveProject);
  const auth = useAuthStore((s) => s.auth);
  const logout = useAuthStore((s) => s.logout);

  const activeFileId = useViewerStore((s) => s.activeFileId);
  const byFile = useViewerStore((s) => s.byFile);
  const selectFile = useViewerStore((s) => s.selectFile);
  const updateFileState = useViewerStore((s) => s.updateFileState);
  const activeTool = useViewerStore((s) => s.activeTool);
  const setActiveTool = useViewerStore((s) => s.setActiveTool);
  const strokeColor = useViewerStore((s) => s.strokeColor);
  const setStrokeColor = useViewerStore((s) => s.setStrokeColor);
  const strokeSize = useViewerStore((s) => s.strokeSize);
  const setStrokeSize = useViewerStore((s) => s.setStrokeSize);
  const closedFill = useViewerStore((s) => s.closedFill);
  const setClosedFill = useViewerStore((s) => s.setClosedFill);
  const showAnnotations = useViewerStore((s) => s.showAnnotations);
  const setShowAnnotations = useViewerStore((s) => s.setShowAnnotations);
  const pixelReadout = useViewerStore((s) => s.pixelReadout);
  const roiStats = useViewerStore((s) => s.roiStats);
  const saveStatus = useViewerStore((s) => s.saveStatus);
  const saveError = useViewerStore((s) => s.saveError);
  const helpOpen = useViewerStore((s) => s.helpOpen);
  const setHelpOpen = useViewerStore((s) => s.setHelpOpen);

  const [selectedFileState, setSelectedFileState] = useState<{
    projectUuid: string;
    file: FileSummaryOut;
    scenefileTaskId?: string;
    scenefileRelPath?: string;
  } | null>(null);
  const selectedFile =
    selectedFileState && selectedFileState.projectUuid === activeProjectUuid
      ? selectedFileState.file
      : null;
  const selectedScenefileTaskId =
    selectedFileState && selectedFileState.projectUuid === activeProjectUuid
      ? selectedFileState.scenefileTaskId
      : undefined;
  const selectedScenefileRelPath =
    selectedFileState && selectedFileState.projectUuid === activeProjectUuid
      ? selectedFileState.scenefileRelPath
      : undefined;
  const [selectedEntityState, setSelectedEntityState] = useState<{
    projectUuid: string;
    entity: EntityOut;
  } | null>(null);
  const selectedEntity =
    selectedEntityState && selectedEntityState.projectUuid === activeProjectUuid
      ? selectedEntityState.entity
      : null;
  // Stable callback + bail-out when nothing changed: an inline arrow here re-ran the dock's
  // effect every render and looped (it blocked route transitions away from /entities).
  const handleSelectedEntityChange = useCallback(
    (ent: EntityOut | null) => {
      setSelectedEntityState((prev) => {
        if (!ent || !activeProjectUuid) return prev === null ? prev : null;
        if (prev && prev.projectUuid === activeProjectUuid && prev.entity === ent) return prev;
        return { projectUuid: activeProjectUuid, entity: ent };
      });
    },
    [activeProjectUuid],
  );
  const outerGroupRef = useGroupRef();
  const entitiesMaximized = useEntitiesStore((s) => s.entitiesMaximized);
  const toggleEntitiesMaximized = useEntitiesStore((s) => s.toggleMaximized);
  const setOuterLayout = useEntitiesStore((s) => s.setOuterLayout);
  const [statusMessage, setStatusMessage] = useState('Ready');
  const [noteDraft, setNoteDraft] = useState('');
  const [leftCollapsed, setLeftCollapsed] = useState(
    () => localStorage.getItem('organum.leftCollapsed') === 'true',
  );
  const [rightCollapsed, setRightCollapsed] = useState(
    () => localStorage.getItem('organum.rightCollapsed') === 'true',
  );

  const { data: projectsData } = useQuery({
    queryKey: ['projects'],
    queryFn: () => apiClient.listProjects(),
  });
  const projects = projectsData ?? EMPTY_PROJECTS;

  useEffect(() => {
    if (projects.length === 0) return;
    if (!activeProjectUuid || !projects.some((p) => p.uuid === activeProjectUuid)) {
      const preferred =
        projects.find((p) => p.exists_on_disk && p.name === 'ORGANUM Demo') ??
        projects.find((p) => p.exists_on_disk) ??
        projects[0]!;
      setActiveProject(preferred.uuid, queryClient);
    }
  }, [projects, activeProjectUuid, setActiveProject, queryClient]);

  useEffect(() => {
    if (selectedFileState && selectedFileState.projectUuid !== activeProjectUuid) {
      setSelectedFileState(null);
      if (searchParams.has('file')) {
        setSearchParams({}, { replace: true });
      }
    }
  }, [activeProjectUuid, selectedFileState, searchParams, setSearchParams]);

  // Auto-select first demo render file if none active yet
  const { data: tree } = useQuery({
    queryKey: ['entities', activeProjectUuid],
    queryFn: () => apiClient.listEntities(activeProjectUuid),
    enabled: Boolean(activeProjectUuid),
  });

  const setSelectedEntity = useEntitiesStore((s) => s.setSelectedEntity);
  const setSelectedDept = useEntitiesStore((s) => s.setSelectedDept);
  const setSelectedTask = useEntitiesStore((s) => s.setSelectedTask);
  const selectedEntityTaskId = useEntitiesStore((s) => s.selectedTaskId);

  useEffect(() => {
    if (selectedFile || !tree || !activeProjectUuid) return;
    const requestedTaskId = searchParams.get('task');
    const requestedFileId = searchParams.get('file');
    const requestedFrame = searchParams.get('frame');

    const allFiles: Array<{
      file: FileSummaryOut;
      entityId: string;
      deptId: string;
      taskId: string;
    }> = [];
    let taskMatchedFile: FileSummaryOut | null = null;
    for (const ent of tree.entities ?? []) {
      for (const dept of ent.departments ?? []) {
        for (const task of dept.tasks ?? []) {
          if (requestedTaskId && task.id === requestedTaskId) {
            setSelectedEntity(ent.id);
            setSelectedDept(dept.id);
            setSelectedTask(task.id);
          }
          for (const ver of task.product?.versions ?? []) {
            for (const f of ver.files ?? []) {
              allFiles.push({ file: f, entityId: ent.id, deptId: dept.id, taskId: task.id });
              if (requestedTaskId && task.id === requestedTaskId && !taskMatchedFile) {
                taskMatchedFile = f;
              }
            }
          }
        }
      }
    }

    const chosen =
      (requestedFileId ? allFiles.find((x) => x.file.id === requestedFileId)?.file : null) ??
      taskMatchedFile ??
      allFiles.find((x) => x.file.detected_format === 'png')?.file ??
      allFiles.find((x) => x.file.media_kind === 'image2d')?.file ??
      allFiles[0]?.file;

    if (chosen) {
      setSelectedFileState({ projectUuid: activeProjectUuid, file: chosen });
      selectFile(chosen.id, chosen.colorspace_override);
      if (requestedFrame) {
        const frameNum = Number(requestedFrame);
        if (Number.isFinite(frameNum)) {
          window.setTimeout(() => {
            window.dispatchEvent(new CustomEvent('organum:seek-frame', { detail: frameNum }));
          }, 120);
        }
      }
    }
  }, [
    tree,
    selectedFile,
    activeProjectUuid,
    selectFile,
    searchParams,
    setSelectedEntity,
    setSelectedDept,
    setSelectedTask,
  ]);

  const { data: inspection, isLoading: inspectionLoading } = useQuery({
    queryKey: [
      'inspect',
      activeProjectUuid,
      selectedFile?.id,
      selectedScenefileTaskId ?? '',
      selectedScenefileRelPath ?? '',
    ],
    queryFn: () =>
      selectedScenefileTaskId && selectedScenefileRelPath
        ? apiClient.inspectScenefile(
            selectedScenefileTaskId,
            selectedScenefileRelPath,
            activeProjectUuid,
          )
        : apiClient.inspectFile(selectedFile!.id, activeProjectUuid),
    enabled: Boolean(activeProjectUuid && selectedFile),
    staleTime: 60_000,
  });

  const currentFileId = activeFileId ?? selectedFile?.id ?? null;
  const viewerState =
    (currentFileId ? byFile[currentFileId] : undefined) ?? DEFAULT_FILE_VIEWER_STATE;

  const handleSelectFile = (f: FileSummaryOut) => {
    if (activeProjectUuid) {
      setSelectedFileState({ projectUuid: activeProjectUuid, file: f });
    }
    selectFile(f.id, f.colorspace_override);
    setSearchParams({ file: f.id }, { replace: true });
    setStatusMessage(`Opened ${f.filename}`);
  };

  const handleOpenMediaScenefile = (taskId: string, entry: SceneEntryOut) => {
    if (!activeProjectUuid) return;
    const previewId = `scenefile:${taskId}:${entry.rel_path}`;
    registerScenefilePreviewUrl(
      previewId,
      apiClient.scenefileContentUrl(taskId, entry.rel_path, activeProjectUuid),
    );
    const ext = entry.extension.replace(/^\./, '').toLowerCase() || 'file';
    const mediaKind = entry.is_image
      ? 'image2d'
      : ['.mp4', '.mov', '.mkv', '.avi'].includes(entry.extension.toLowerCase())
        ? 'video'
        : ['.wav', '.flac', '.ogg', '.mp3'].includes(entry.extension.toLowerCase())
          ? 'audio'
          : ['.gltf', '.glb', '.obj', '.usda', '.usdc', '.usd'].includes(
                entry.extension.toLowerCase(),
              )
            ? 'scene3d'
            : entry.extension.toLowerCase() === '.pdf'
              ? 'document'
              : ['.csv', '.json', '.yaml', '.yml'].includes(entry.extension.toLowerCase())
                ? 'data'
                : entry.extension.toLowerCase() === '.edl'
                  ? 'timeline'
                  : 'unsupported';
    const synth: FileSummaryOut = {
      id: previewId,
      filename: entry.name,
      relative_path: entry.project_rel_path,
      size: entry.size,
      sha256: 'scenefile-live',
      detected_format: ext,
      media_kind: mediaKind,
      is_sequence: false,
      sequence_kind: 'none',
      sequence_kind_user_override: false,
      is_missing: false,
    };
    setSelectedFileState({
      projectUuid: activeProjectUuid,
      file: synth,
      scenefileTaskId: taskId,
      scenefileRelPath: entry.rel_path,
    });
    selectFile(previewId, null);
    setStatusMessage(`Previewing scenefile ${entry.name}`);
  };

  // Global viewer hotkeys
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const tag = document.activeElement?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'e') {
        e.preventDefault();
        toggleEntitiesMaximized();
        return;
      }
      if (e.key === '?') {
        e.preventDefault();
        setHelpOpen(!helpOpen);
        return;
      }
      if (!currentFileId) return;

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent('organum:undo'));
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent('organum:redo'));
        return;
      }

      const k = e.key.toLowerCase();
      const is3DMode =
        selectedFile?.media_kind === 'scene3d' &&
        !viewerState.frozen &&
        viewerState.activeTextureIndex === null;
      const fileTimeBased = Boolean(
        selectedFile &&
        (selectedFile.is_sequence ||
          selectedFile.media_kind === 'video' ||
          selectedFile.media_kind === 'audio' ||
          selectedFile.media_kind === 'timeline' ||
          inspection?.capabilities?.time_based),
      );

      if (e.key === 'Tab' && selectedFile?.media_kind === 'scene3d') {
        e.preventDefault();
        updateFileState(currentFileId, { frozen: !viewerState.frozen });
        return;
      }

      if (k === 'f') {
        if (is3DMode) window.dispatchEvent(new CustomEvent('organum:frame-all'));
        else updateFileState(currentFileId, { zoom: -1, panX: 0, panY: 0 });
      } else if (k === 'a' && is3DMode) {
        window.dispatchEvent(new CustomEvent('organum:frame-all'));
      } else if (k === '1') {
        if (is3DMode)
          window.dispatchEvent(new CustomEvent('organum:set-view-preset', { detail: 'front' }));
        else updateFileState(currentFileId, { zoom: 1, panX: 0, panY: 0 });
      } else if (k === '3' && is3DMode) {
        window.dispatchEvent(new CustomEvent('organum:set-view-preset', { detail: 'right' }));
      } else if (k === '7' && is3DMode) {
        window.dispatchEvent(new CustomEvent('organum:set-view-preset', { detail: 'top' }));
      } else if (k === 's') updateFileState(currentFileId, { bypass: !viewerState.bypass });
      else if (k === 'h') setShowAnnotations(!showAnnotations);
      else if (k === 'v') setActiveTool('pan');
      else if (k === 'b') setActiveTool('free');
      else if (k === 'p') setActiveTool('closed');
      else if (k === 'e') setActiveTool('eraser');
      else if (k === 'l' && !fileTimeBased) setActiveTool('laser');
      else if (k === 'o' && !fileTimeBased) setActiveTool('ellipse');
      else if (k === 'r') {
        const nextCh: ChannelMode = viewerState.channel === 'R' ? 'RGB' : 'R';
        updateFileState(currentFileId, { channel: nextCh });
      } else if (k === 'g') {
        const nextCh: ChannelMode = viewerState.channel === 'G' ? 'RGB' : 'G';
        updateFileState(currentFileId, { channel: nextCh });
      } else if (k === 'a') {
        const nextCh: ChannelMode = viewerState.channel === 'A' ? 'RGB' : 'A';
        updateFileState(currentFileId, { channel: nextCh });
      } else if (k === 'y') {
        const nextCh: ChannelMode = viewerState.channel === 'Y' ? 'RGB' : 'Y';
        updateFileState(currentFileId, { channel: nextCh });
      } else if (e.key === '[') {
        window.dispatchEvent(new CustomEvent('organum:step-layer', { detail: -1 }));
      } else if (e.key === ']') {
        window.dispatchEvent(new CustomEvent('organum:step-layer', { detail: 1 }));
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    currentFileId,
    selectedFile,
    inspection,
    viewerState,
    helpOpen,
    showAnnotations,
    setHelpOpen,
    updateFileState,
    setActiveTool,
    setShowAnnotations,
    toggleEntitiesMaximized,
  ]);

  // Open file by clip/target name (e.g. from TimelineViewer)
  useEffect(() => {
    const onOpenByName = (ev: Event) => {
      const target = String((ev as CustomEvent<string>).detail ?? '').toLowerCase();
      if (!target || !tree) return;
      for (const ent of tree.entities ?? []) {
        for (const dept of ent.departments ?? []) {
          for (const task of dept.tasks ?? []) {
            for (const ver of task.product?.versions ?? []) {
              for (const f of ver.files ?? []) {
                if (
                  f.filename.toLowerCase() === target ||
                  target.includes(f.filename.toLowerCase())
                ) {
                  handleSelectFile(f);
                  return;
                }
              }
            }
          }
        }
      }
    };
    window.addEventListener('organum:open-file-by-name', onOpenByName);
    return () => window.removeEventListener('organum:open-file-by-name', onOpenByName);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tree]);

  const workspaceExtras: MenuEntry[] = useMemo(
    () => [
      {
        id: 'rescan',
        label: 'Reconcile Project Disk & DB',
        shortcut: 'Ctrl+R',
        onSelect: async () => {
          if (!activeProjectUuid) return;
          const res = await apiClient.reconcileProject(activeProjectUuid);
          await queryClient.invalidateQueries({ queryKey: ['entities', activeProjectUuid] });
          setStatusMessage(
            `Reconciled ${res.entities_scanned} entities (${res.files_scanned} files)`,
          );
        },
      },
    ],
    [activeProjectUuid, queryClient],
  );
  const viewExtras: MenuEntry[] = useMemo(
    () => [
      {
        id: 'toggle-left',
        label: `${leftCollapsed ? 'Show' : 'Hide'} Entities Panel`,
        onSelect: () => {
          const next = !leftCollapsed;
          setLeftCollapsed(next);
          localStorage.setItem('organum.leftCollapsed', String(next));
        },
      },
      {
        id: 'toggle-right',
        label: `${rightCollapsed ? 'Show' : 'Hide'} Inspector Panel`,
        onSelect: () => {
          const next = !rightCollapsed;
          setRightCollapsed(next);
          localStorage.setItem('organum.rightCollapsed', String(next));
        },
      },
    ],
    [leftCollapsed, rightCollapsed],
  );
  const showShortcuts = useCallback(() => setHelpOpen(true), [setHelpOpen]);
  const menus = useStandardMenus(theme, onToggleTheme, {
    workspace: workspaceExtras,
    view: viewExtras,
    onShowShortcuts: showShortcuts,
  });

  const isUdimActive = Boolean(
    selectedFile?.is_sequence &&
    (selectedFile.sequence_kind === 'udim' ||
      (selectedFile.sequence_kind !== 'frames' && inspection?.capabilities?.udim)),
  );
  const effectiveMediaKind = selectedFile
    ? selectedFile.is_sequence
      ? isUdimActive
        ? 'udim'
        : 'video'
      : selectedFile.media_kind
    : 'unsupported';
  const ViewerModule = selectedFile ? getViewerModule(effectiveMediaKind) : undefined;
  const udimInfo: UdimOverrideInfo | null =
    selectedFile && selectedFile.is_sequence
      ? {
          sequenceKind: selectedFile.sequence_kind as UdimOverrideInfo['sequenceKind'],
          isUserOverride: Boolean(selectedFile.sequence_kind_user_override),
          canToggleUdim: Boolean(
            inspection?.summary?.can_override_udim ||
            selectedFile.sequence_kind === 'udim' ||
            inspection?.capabilities?.udim,
          ),
          tileCount: Number(inspection?.summary?.udim_tile_count ?? 0),
        }
      : null;
  const detectedCs = inspection?.summary?.colorspace ? String(inspection.summary.colorspace) : null;
  const tlDoc = (inspection?.timeline ?? null) as Record<string, unknown> | null;
  const isTimeBased = Boolean(
    selectedFile &&
    (selectedFile.is_sequence ||
      selectedFile.media_kind === 'video' ||
      selectedFile.media_kind === 'audio' ||
      selectedFile.media_kind === 'timeline' ||
      inspection?.capabilities?.time_based),
  );
  const frameStart = Number(tlDoc?.start ?? selectedFile?.frame_start ?? 0);
  const frameEnd = Math.max(frameStart, Number(tlDoc?.end ?? selectedFile?.frame_end ?? 100));

  const panelItems = useWorkspacePanels();

  const canAdmin =
    hasPerm(auth?.permissions, 'role.manage') || hasPerm(auth?.permissions, 'rules.manage');
  const isClientRole = auth?.user.role_name === 'client';

  const visibleEntityTaskId = useMemo(() => {
    if (!selectedEntityTaskId || !tree) return null;
    for (const ent of tree.entities ?? []) {
      for (const dept of ent.departments ?? []) {
        for (const t of dept.tasks ?? []) {
          if (t.id === selectedEntityTaskId) return selectedEntityTaskId;
        }
      }
    }
    return null;
  }, [selectedEntityTaskId, tree]);

  return (
    <AppShell
      menus={menus}
      panels={panelItems}
      onOpenSettings={isClientRole ? undefined : () => navigate('/settings')}
      theme={theme}
      onToggleTheme={onToggleTheme}
      userName={auth?.user.username ?? 'user'}
      userFullName={auth?.user.full_name}
      userRoleLabel={auth?.user.role_label}
      userAvatarUrl={
        auth?.user.avatar_file && auth?.project_uuid
          ? `${apiClient.userAvatarUrl(auth.user.id, auth.project_uuid)}?v=${encodeURIComponent(auth.user.avatar_file)}`
          : null
      }
      canAdmin={canAdmin}
      onOpenMyUser={() => navigate('/me')}
      onOpenAdmin={
        canAdmin
          ? () =>
              navigate(
                hasPerm(auth?.permissions, 'role.manage')
                  ? '/users?section=roles'
                  : '/users?section=rules',
              )
          : undefined
      }
      onLogout={() => {
        void logout().then(() => navigate('/login', { replace: true }));
      }}
      statusBar={
        <StatusBar>
          <StatusBarSegment grow>{statusMessage}</StatusBarSegment>
          <StatusBarSegment mono>
            {pixelReadout
              ? `${pixelReadout.udim ? `UDIM ${pixelReadout.udim} UV(${pixelReadout.uv?.[0].toFixed(3)}, ${pixelReadout.uv?.[1].toFixed(3)}) ` : ''}(${pixelReadout.x}, ${pixelReadout.y}) src[${pixelReadout.src[0].toFixed(2)}, ${pixelReadout.src[1].toFixed(2)}, ${pixelReadout.src[2].toFixed(2)}] ${pixelReadout.hex}`
              : 'x: - y: -'}
          </StatusBarSegment>
          {roiStats && (
            <StatusBarSegment mono>
              ROI {roiStats.w}×{roiStats.h} mean[{roiStats.mean[0].toFixed(2)},
              {roiStats.mean[1].toFixed(2)},{roiStats.mean[2].toFixed(2)}]
            </StatusBarSegment>
          )}
          <StatusBarSegment mono>
            {saveStatus === 'saving'
              ? 'Saving...'
              : saveStatus === 'saved'
                ? 'Saved'
                : saveStatus === 'error'
                  ? `Error: ${saveError ?? 'save failed'}`
                  : 'Annotations: Ready'}
          </StatusBarSegment>
          <StatusBarSegment mono>
            {viewerState.zoom < 0 ? 'Fit' : `${Math.round(viewerState.zoom * 100)}%`}
          </StatusBarSegment>
        </StatusBar>
      }
    >
      <SplitGroup
        groupRef={outerGroupRef}
        orientation="horizontal"
        className="org-viewer-layout"
        data-maximized={entitiesMaximized ? 'true' : undefined}
        onLayoutChanged={(layout) => setOuterLayout(layout)}
      >
        {!leftCollapsed && (
          <>
            <SplitPane id="entities" defaultSize="46%" minSize="180px">
              <div className="org-viewer-layout__entities-pane">
                <EntitiesWorkspaceDock
                  selectedFileId={selectedFile?.id ?? null}
                  onSelectFile={handleSelectFile}
                  onOpenMediaScenefile={handleOpenMediaScenefile}
                  onSelectedEntityChange={handleSelectedEntityChange}
                  onStatusMessage={setStatusMessage}
                />
              </div>
            </SplitPane>
            <SplitHandle />
          </>
        )}

        <SplitPane id="center" defaultSize="36%" minSize="320px">
          <div className="org-viewer-center">
            <ViewerTopbar
              mediaKind={effectiveMediaKind}
              detectedColorspace={detectedCs}
              hasColorspaceOverride={Boolean(selectedFile?.colorspace_override)}
              udimInfo={udimInfo}
              onToggleSequenceKind={async (nextKind) => {
                if (!selectedFile || !activeProjectUuid) return;
                const updated = await apiClient.patchFile(
                  selectedFile.id,
                  { sequence_kind: nextKind, sequence_kind_user_override: true },
                  activeProjectUuid,
                );
                setSelectedFileState({ projectUuid: activeProjectUuid, file: updated });
                await queryClient.invalidateQueries({
                  queryKey: ['inspect', activeProjectUuid, selectedFile.id],
                });
                await queryClient.invalidateQueries({ queryKey: ['entities', activeProjectUuid] });
                setStatusMessage(`Sequence mode set to ${nextKind.toUpperCase()}`);
              }}
              viewerState={viewerState}
              onUpdate={(patch) => {
                if (currentFileId) updateFileState(currentFileId, patch);
              }}
              onColorspaceChange={async (space) => {
                if (!selectedFile || !currentFileId || !activeProjectUuid) return;
                updateFileState(currentFileId, { colorspace: space });
                const updated = await apiClient.patchFile(selectedFile.id, space);
                setSelectedFileState({ projectUuid: activeProjectUuid, file: updated });
                setStatusMessage(`Colorspace override set to ${space}`);
              }}
            />

            <div className="org-viewer-stage">
              <ViewerToolStrip
                activeTool={activeTool}
                onSelectTool={setActiveTool}
                strokeColor={strokeColor}
                onChangeColor={setStrokeColor}
                strokeSize={strokeSize}
                onChangeSize={setStrokeSize}
                closedFill={closedFill}
                onToggleClosedFill={setClosedFill}
                showAnnotations={showAnnotations}
                onToggleShowAnnotations={() => setShowAnnotations(!showAnnotations)}
                canUndo
                canRedo
                onUndo={() => window.dispatchEvent(new CustomEvent('organum:undo'))}
                onRedo={() => window.dispatchEvent(new CustomEvent('organum:redo'))}
                onClear={() => window.dispatchEvent(new CustomEvent('organum:clear-strokes'))}
                noteDraft={noteDraft}
                onChangeNote={setNoteDraft}
                disabled={!selectedFile || selectedFile.media_kind === 'unsupported'}
                isLive3D={
                  selectedFile?.media_kind === 'scene3d' &&
                  !viewerState.frozen &&
                  viewerState.activeTextureIndex === null
                }
                isTimeBased={isTimeBased && !isUdimActive}
                currentFrame={viewerState.currentFrame}
                frameStart={frameStart}
                frameEnd={frameEnd}
                lockPlane={viewerState.lockPlane}
                onToggleLockPlane={(lockPlane) => {
                  if (currentFileId) updateFileState(currentFileId, { lockPlane });
                }}
                widthMode={viewerState.widthMode}
                onChangeWidthMode={(widthMode) => {
                  if (currentFileId) updateFileState(currentFileId, { widthMode });
                }}
                planeDepthTest={viewerState.planeDepthTest}
                onTogglePlaneDepthTest={(planeDepthTest) => {
                  if (currentFileId) updateFileState(currentFileId, { planeDepthTest });
                }}
                projectionMode={viewerState.projectionMode}
                onChangeProjectionMode={(projectionMode) => {
                  if (currentFileId) updateFileState(currentFileId, { projectionMode });
                }}
                surfaceOffset={viewerState.surfaceOffset}
                onChangeSurfaceOffset={(surfaceOffset) => {
                  if (currentFileId) updateFileState(currentFileId, { surfaceOffset });
                }}
                strokeSmoothing={viewerState.strokeSmoothing}
                onChangeStrokeSmoothing={(strokeSmoothing) => {
                  if (currentFileId) updateFileState(currentFileId, { strokeSmoothing });
                }}
              />

              <div className="org-viewer-viewport">
                <div className="org-viewer-viewport-main">
                  {selectedFile && inspection && ViewerModule ? (
                    <Suspense fallback={<Spinner label="Loading viewer module" />}>
                      <ViewerModule
                        file={selectedFile}
                        inspection={inspection}
                        viewerState={viewerState}
                        onUpdateState={(patch) => {
                          if (currentFileId) updateFileState(currentFileId, patch);
                        }}
                        activeTool={activeTool}
                        noteDraft={noteDraft}
                        onNoteDraftChange={setNoteDraft}
                      />
                    </Suspense>
                  ) : selectedFile && inspectionLoading ? (
                    <Spinner label="Inspecting file" />
                  ) : selectedFile ? (
                    <Stack padding="4" gap="2">
                      <Panel title={selectedFile.filename}>
                        <Banner severity="info" title="Module Scheduled in Upcoming Phase">
                          {selectedFile.media_kind === 'unsupported'
                            ? 'Unsupported file format — inspect basic metadata on the right.'
                            : `Format '${selectedFile.detected_format}' (${selectedFile.media_kind}) is registered and inspected. Its interactive viewport module will be activated in Phases 3–5.`}
                        </Banner>
                      </Panel>
                    </Stack>
                  ) : (
                    <Stack padding="4" gap="2">
                      <Text variant="muted">
                        Select a file from Products or drop files to ingest.
                      </Text>
                    </Stack>
                  )}
                </div>

                {selectedFile && inspection && hasLayerStripContent(selectedFile, inspection) && (
                  <LayerStrip
                    file={selectedFile}
                    inspection={inspection}
                    viewerState={viewerState}
                    onUpdateState={(patch) => {
                      if (currentFileId) updateFileState(currentFileId, patch);
                    }}
                  />
                )}
              </div>
            </div>
          </div>
        </SplitPane>

        {!rightCollapsed && (
          <>
            <SplitHandle />
            <SplitPane id="inspector" defaultSize="18%" minSize="260px">
              <InspectorPanel
                file={selectedFile}
                inspection={inspection ?? null}
                selectedEntity={selectedEntity}
                selectedTaskId={visibleEntityTaskId}
                viewerState={viewerState}
                onUpdateState={(patch) => {
                  if (currentFileId) updateFileState(currentFileId, patch);
                }}
                noteDraft={noteDraft}
                onNoteDraftChange={setNoteDraft}
              />
            </SplitPane>
          </>
        )}
      </SplitGroup>

      <Dialog
        open={helpOpen}
        onOpenChange={setHelpOpen}
        title="Viewer Keyboard Shortcuts"
        footer={<Button onClick={() => setHelpOpen(false)}>Close</Button>}
      >
        <Table columns={HOTKEY_COLS} rows={HOTKEY_ROWS} />
      </Dialog>

      <InspectPopups />
    </AppShell>
  );
}
