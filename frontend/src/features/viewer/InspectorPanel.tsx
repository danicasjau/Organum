import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import {
  Badge,
  Banner,
  Button,
  Histogram,
  Icon,
  NumberField,
  Panel,
  ScrollArea,
  SearchField,
  Separator,
  Stack,
  Table,
  Tabs,
  Text,
  TextArea,
  Tree,
  useToast,
  type IconName,
  type TableColumn,
  type TreeNode,
} from '../../components/ui';
import {
  apiClient,
  isScenefilePreviewId,
  type EntityOut,
  type FileSummaryOut,
  type InspectionDocument,
} from '../../lib/api/client';
import { useAuthStore } from '../auth/authStore';
import { EntityInspectorTab } from '../entities/EntityInspectorTab';
import { useProjectStore } from '../project/projectStore';
import { TaskDetail } from '../tasks/TaskDetail';
import { hasLayerStripContent } from './LayerStrip';
import { rescalePlaneDistance, type Stroke3D } from './modules/annotationPlane3D';
import {
  useViewerStore,
  type AnnotationPlaneData,
  type CameraPose,
  type PerFileViewerState,
} from './viewerStore';
import './InspectorPanel.css';

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

function toSceneTreeNodes(raw: Array<Record<string, unknown>>): TreeNode[] {
  return raw.map((r, idx) => {
    const typeLabel = String(r.type ?? 'Node');
    const pathStr = String(r.path ?? r.id ?? idx);
    const kindStr = r.kind ? ` | kind=${String(r.kind)}` : '';
    const visStr = r.visible === false ? ' | hidden' : '';
    const icon: IconName =
      typeLabel === 'Mesh'
        ? 'box3d'
        : typeLabel === 'Material' || typeLabel === 'Shader'
          ? 'sliders'
          : 'folder';
    return {
      id: String(r.id ?? r.path ?? idx),
      label: String(r.name ?? r.path ?? `Item ${idx}`),
      icon,
      tooltip: `${pathStr} (${typeLabel}${kindStr}${visStr})`,
      badge: <Badge tone={typeLabel === 'Mesh' ? 'accent' : 'neutral'}>{typeLabel}</Badge>,
      children: Array.isArray(r.children)
        ? toSceneTreeNodes(r.children as Array<Record<string, unknown>>)
        : undefined,
    };
  });
}

function collectAllNodeIds(nodes: ReadonlyArray<TreeNode>): string[] {
  const ids: string[] = [];
  const walk = (list: ReadonlyArray<TreeNode>) => {
    for (const n of list) {
      if (n.children && n.children.length > 0) {
        ids.push(n.id);
        walk(n.children);
      }
    }
  };
  walk(nodes);
  return ids;
}

const INFO_COLS: TableColumn[] = [
  { key: 'field', header: 'Property' },
  { key: 'value', header: 'Value', mono: true },
];

const META_COLS: TableColumn[] = [
  { key: 'key', header: 'Attribute', mono: true },
  { key: 'value', header: 'Value', mono: true },
];

const STREAM_COLS: TableColumn[] = [
  { key: 'type', header: 'Type' },
  { key: 'codec', header: 'Codec', mono: true },
  { key: 'detail', header: 'Details', mono: true },
];

export interface InspectorPanelProps {
  file: FileSummaryOut | null;
  inspection: InspectionDocument | null;
  selectedEntity?: EntityOut | null;
  selectedTaskId?: string | null;
  viewerState: PerFileViewerState;
  onUpdateState: (patch: Partial<PerFileViewerState>) => void;
  noteDraft: string;
  onNoteDraftChange: (note: string) => void;
}

export function InspectorPanel({
  file,
  inspection,
  selectedEntity = null,
  selectedTaskId = null,
  viewerState,
  onUpdateState,
  noteDraft,
  onNoteDraftChange,
}: InspectorPanelProps) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const auth = useAuthStore((s) => s.auth);
  const isClientRole = auth?.user.role_name === 'client';
  const activeProjectUuid = useProjectStore((s) => s.activeProjectUuid);
  const [activeTab, setActiveTab] = useState('structure');
  const [metaQuery, setMetaQuery] = useState('');
  const [scopesOpen, setScopesOpen] = useState(true);
  const imageHistogram = useViewerStore((s) => s.imageHistogram);

  const isPreview = isScenefilePreviewId(file?.id);
  const { data: annotations = [] } = useQuery({
    queryKey: ['annotations', activeProjectUuid, file?.id],
    queryFn: () => apiClient.listAnnotations(file!.id, activeProjectUuid),
    enabled: Boolean(activeProjectUuid && file && !isPreview),
  });

  const infoRows = useMemo(() => {
    if (!file) return [];
    const summary = inspection?.summary ?? {};
    const rows = [
      { field: 'Filename', value: file.filename },
      { field: 'Path', value: file.relative_path },
      { field: 'Format', value: `${file.detected_format.toUpperCase()} (${file.media_kind})` },
      { field: 'Size', value: formatBytes(file.size) },
      { field: 'SHA-256', value: `${file.sha256.slice(0, 16)}...` },
      { field: 'Handler', value: String(summary.handler_id ?? '-') },
    ];
    if (summary.width && summary.height) {
      rows.push({ field: 'Dimensions', value: `${summary.width} × ${summary.height}` });
    }
    if (summary.fps) {
      rows.push({ field: 'FPS', value: String(summary.fps) });
    }
    if (summary.duration_seconds !== undefined && summary.duration_seconds !== null) {
      rows.push({ field: 'Duration', value: `${Number(summary.duration_seconds).toFixed(2)}s` });
    }
    if (summary.triangles !== undefined) {
      rows.push({ field: 'Triangles', value: String(summary.triangles) });
      rows.push({ field: 'Vertices', value: String(summary.vertices ?? 0) });
    }
    if (summary.upAxis) {
      rows.push({
        field: 'Stage Units',
        value: `Up=${summary.upAxis} (${summary.metersPerUnit ?? 1} m/u)`,
      });
    }
    if (summary.colorspace) {
      rows.push({
        field: 'Colorspace',
        value: file.colorspace_override
          ? `${file.colorspace_override} (override)`
          : String(summary.colorspace),
      });
    }
    return rows;
  }, [file, inspection]);

  const metaRows = useMemo(() => {
    const meta = inspection?.metadata ?? {};
    const q = metaQuery.trim().toLowerCase();
    return Object.entries(meta)
      .filter(([k, v]) => !q || k.toLowerCase().includes(q) || String(v).toLowerCase().includes(q))
      .map(([k, v]) => ({ key: k, value: typeof v === 'object' ? JSON.stringify(v) : String(v) }));
  }, [inspection, metaQuery]);

  const sceneNodes = useMemo(
    () => toSceneTreeNodes((inspection?.tree ?? []) as Array<Record<string, unknown>>),
    [inspection?.tree],
  );
  const expandedSceneIds = useMemo(() => collectAllNodeIds(sceneNodes), [sceneNodes]);

  if (!file || !inspection) {
    if (selectedEntity || selectedTaskId) {
      return (
        <Panel title="Inspector" className="org-inspector-panel">
          <Tabs
            activeId={activeTab === 'task' && selectedTaskId ? 'task' : 'entity'}
            onChange={setActiveTab}
            items={[
              ...(selectedEntity
                ? [
                  {
                    id: 'entity',
                    label: 'Entity',
                    content: (
                      <ScrollArea>
                        <EntityInspectorTab entity={selectedEntity} />
                      </ScrollArea>
                    ),
                  },
                ]
                : []),
              ...(selectedTaskId
                ? [
                  {
                    id: 'task',
                    label: 'Task',
                    content: <TaskDetail taskId={selectedTaskId} compact />,
                  },
                ]
                : []),
            ]}
          />
        </Panel>
      );
    }
    return (
      <Panel title="Inspector" className="org-inspector-panel">
        <Text variant="muted">Select a product or file from the left panel to inspect.</Text>
      </Panel>
    );
  }

  const aovs = inspection.aovs ?? [];
  const layers = inspection.layers ?? [];
  const streams = inspection.streams ?? [];
  const showLayerStripLink = hasLayerStripContent(file, inspection);
  const meta = (inspection.metadata ?? {}) as Record<string, unknown>;
  const textures = Array.isArray(meta.textures)
    ? (meta.textures as Array<{ index: number; name: string; mime?: string }>)
    : [];
  const materials = Array.isArray(meta.materials)
    ? (meta.materials as Array<{ name: string }>)
    : [];
  const variants = Array.isArray(meta.variants)
    ? (meta.variants as Array<{ prim: string; set: string; selected: string; options: string[] }>)
    : [];
  const layerStack = Array.isArray(meta.layerStack) ? (meta.layerStack as string[]) : [];
  const timelineClips = Array.isArray(meta.clips)
    ? (meta.clips as Array<{ name: string; track?: string; start_frame?: number; duration_frames?: number }>)
    : [];
  const txMips = Array.isArray(meta.mips)
    ? (meta.mips as Array<{ level: number; width: number; height: number }>)
    : [];
  const docPages = Array.isArray(meta.pages)
    ? (meta.pages as Array<{ index: number; label: string; width: number; height: number }>)
    : [];
  const dataCols = Array.isArray(meta.columns)
    ? (meta.columns as Array<{ name: string; type: string }>)
    : [];
  const animFrames = Number(inspection.summary?.frame_count ?? 1);

  const streamRows = streams.map((s) => ({
    type: String(s.type ?? '-'),
    codec: String(s.codec ?? '-'),
    detail:
      s.type === 'video'
        ? `${String(s.width ?? '?')}×${String(s.height ?? '?')} @ ${String(s.fps ?? '?')}fps`
        : s.type === 'audio'
          ? `${String(s.sample_rate ?? '?')}Hz ${String(s.channels ?? '?')}ch`
          : String(s.language ?? '-'),
  }));

  const submitAnnotation = async () => {
    const ev = new CustomEvent('organum:submit-annotation', { detail: { handled: false } });
    window.dispatchEvent(ev);
    if (!ev.detail.handled && noteDraft.trim()) {
      await apiClient.createAnnotation(file.id, {
        kind: inspection.kind === 'audio' ? 'audio' : '2d',
        note_text: noteDraft.trim(),
        vector_json: [],
      });
      await queryClient.refetchQueries({
        queryKey: ['annotations', activeProjectUuid, file.id],
      });
      onNoteDraftChange('');
    }
  };

  const exportAnnotationsJson = () => {
    const blob = new Blob([JSON.stringify(annotations, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${file.filename}.annotations.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const hasStructureContent =
    (inspection.kind === 'scene3d' &&
      (sceneNodes.length > 0 ||
        variants.length > 0 ||
        layerStack.length > 0 ||
        materials.length > 0 ||
        textures.length > 0)) ||
    streamRows.length > 0 ||
    timelineClips.length > 0 ||
    txMips.length > 1 ||
    docPages.length > 0 ||
    dataCols.length > 0 ||
    showLayerStripLink ||
    Boolean(imageHistogram);

  return (
    <Panel title="Inspector" className="org-inspector-panel">
      <Tabs
        activeId={activeTab}
        onChange={setActiveTab}
        items={[
          {
            id: 'structure',
            label: 'Structure & Info',
            content: (
              <ScrollArea>
                <Stack gap="3">
                  {inspection.kind === 'unsupported' && (
                    <Banner severity="warning" title="Unsupported format">
                      Basic file identity only — preview is not available for this format.
                    </Banner>
                  )}

                  {inspection.kind === 'scene3d' && (
                    <>
                      {sceneNodes.length > 0 && (
                        <Stack gap="1">
                          <Text size="sm" variant="muted">
                            Scene / Prim Graph
                          </Text>
                          <Tree
                            key={file.id}
                            nodes={sceneNodes}
                            selectedId={viewerState.selectedPrimPath}
                            defaultExpandedIds={expandedSceneIds}
                            ariaLabel="Scene hierarchy"
                            className="org-inspector__scene-tree"
                            onSelect={(node) => onUpdateState({ selectedPrimPath: node.id })}
                          />
                        </Stack>
                      )}

                      {variants.length > 0 && (
                        <Stack gap="1">
                          <Text size="sm" variant="muted">
                            USD Variant Sets
                          </Text>
                          {variants.map((v) => (
                            <div key={`${v.prim}:${v.set}`} className="org-inspector__aov-row">
                              <span>
                                {v.prim} [{v.set}]
                              </span>
                              <Badge tone="accent">{v.selected}</Badge>
                            </div>
                          ))}
                        </Stack>
                      )}

                      {layerStack.length > 0 && (
                        <Stack gap="1">
                          <Text size="sm" variant="muted">
                            USD Layer Stack
                          </Text>
                          {layerStack.map((l) => (
                            <Text key={l} size="sm" variant="mono" truncate>
                              {l}
                            </Text>
                          ))}
                        </Stack>
                      )}

                      {materials.length > 0 && (
                        <Stack gap="1">
                          <Text size="sm" variant="muted">
                            Materials ({materials.length})
                          </Text>
                          <div className="org-inspector__aovs">
                            {materials.map((m, idx) => (
                              <div key={idx} className="org-inspector__aov-row">
                                <span>{m.name}</span>
                                <Badge tone="neutral">PBR</Badge>
                              </div>
                            ))}
                          </div>
                        </Stack>
                      )}

                      {textures.length > 0 && (
                        <Stack gap="1">
                          <Text size="sm" variant="muted">
                            Textures (click to inspect in 2D)
                          </Text>
                          <div className="org-inspector__aovs">
                            {textures.map((t) => (
                              <button
                                key={t.index}
                                type="button"
                                data-selected={viewerState.activeTextureIndex === t.index ? 'true' : undefined}
                                className="org-inspector__aov-row"
                                onClick={() =>
                                  onUpdateState({ activeTextureIndex: t.index, frozen: false })
                                }
                              >
                                <span>{t.name}</span>
                                <Badge tone="accent">2D View</Badge>
                              </button>
                            ))}
                          </div>
                        </Stack>
                      )}
                    </>
                  )}

                  {streamRows.length > 0 && (
                    <Stack gap="1">
                      <Text size="sm" variant="muted">
                        Media Streams ({streamRows.length})
                      </Text>
                      <Table columns={STREAM_COLS} rows={streamRows} />
                    </Stack>
                  )}

                  {timelineClips.length > 0 && (
                    <Stack gap="1">
                      <Text size="sm" variant="muted">
                        Timeline Clips ({timelineClips.length})
                      </Text>
                      <div className="org-inspector__aovs">
                        {timelineClips.map((c, idx) => (
                          <button
                            key={`${c.name}-${idx}`}
                            type="button"
                            className="org-inspector__aov-row"
                            onClick={() =>
                              window.dispatchEvent(
                                new CustomEvent('organum:seek-frame', {
                                  detail: c.start_frame ?? 0,
                                }),
                              )
                            }
                          >
                            <span>{c.name}</span>
                            <Badge tone="neutral">
                              F{c.start_frame ?? 0} ({c.duration_frames ?? 0}f)
                            </Badge>
                          </button>
                        ))}
                      </div>
                    </Stack>
                  )}

                  {showLayerStripLink && (
                    <Stack gap="1">
                      <button
                        type="button"
                        className="org-inspector__aov-row"
                        onClick={() => window.dispatchEvent(new CustomEvent('organum:focus-layer-strip'))}
                      >
                        <span>
                          {inspection.capabilities?.udim
                            ? `UDIM Tiles (${String(inspection.summary?.udim_tile_count ?? 0)})`
                            : aovs.length > 0
                              ? `EXR AOVs (${aovs.length})`
                              : `Layers / Pages (${layers.length})`}
                        </span>
                        <Badge tone="accent">See layer strip</Badge>
                      </button>
                    </Stack>
                  )}

                  {!hasStructureContent && inspection.kind !== 'unsupported' && (
                    <Text size="sm" variant="muted">
                      Single-layer flat media.
                    </Text>
                  )}

                  {txMips.length > 1 && (
                    <Stack gap="1">
                      <Text size="sm" variant="muted">
                        TX Mipmap Levels ({txMips.length})
                      </Text>
                      <div className="org-inspector__aovs">
                        {txMips.map((m) => (
                          <button
                            key={m.level}
                            type="button"
                            data-selected={viewerState.activePage === m.level ? 'true' : undefined}
                            className="org-inspector__aov-row"
                            onClick={() => onUpdateState({ activePage: m.level })}
                          >
                            <span>Mip {m.level}</span>
                            <Badge tone={viewerState.activePage === m.level ? 'accent' : 'neutral'}>
                              {m.width}×{m.height}
                            </Badge>
                          </button>
                        ))}
                      </div>
                    </Stack>
                  )}

                  {inspection.kind === 'image2d' && animFrames > 1 && (
                    <Stack gap="1">
                      <Text size="sm" variant="muted">
                        Animated Image Frames ({animFrames})
                      </Text>
                      <div className="org-inspector__aovs">
                        {Array.from({ length: Math.min(24, animFrames) }, (_, idx) => (
                          <button
                            key={idx}
                            type="button"
                            data-selected={viewerState.activePage === idx ? 'true' : undefined}
                            className="org-inspector__aov-row"
                            onClick={() => onUpdateState({ activePage: idx })}
                          >
                            <span>Frame {idx + 1}</span>
                            <Badge tone={viewerState.activePage === idx ? 'accent' : 'neutral'}>
                              {idx === 0 ? 'Initial' : `#${idx}`}
                            </Badge>
                          </button>
                        ))}
                      </div>
                    </Stack>
                  )}

                  {inspection.kind === 'document' && docPages.length > 0 && (
                    <Stack gap="1">
                      <Text size="sm" variant="muted">
                        PDF Pages ({docPages.length})
                      </Text>
                      <div className="org-inspector__aovs">
                        {docPages.map((p) => (
                          <button
                            key={p.index}
                            type="button"
                            className="org-inspector__aov-row"
                            onClick={() =>
                              window.dispatchEvent(
                                new CustomEvent('organum:pdf-page', { detail: { page: p.index } }),
                              )
                            }
                          >
                            <span>{p.label}</span>
                            <Badge tone="neutral">
                              {Math.round(p.width)}×{Math.round(p.height)}pt
                            </Badge>
                          </button>
                        ))}
                      </div>
                    </Stack>
                  )}

                  {inspection.kind === 'data' && dataCols.length > 0 && (
                    <Stack gap="1">
                      <Text size="sm" variant="muted">
                        CSV Columns ({dataCols.length})
                      </Text>
                      <Table
                        columns={[
                          { key: 'name', header: 'Column', mono: true },
                          { key: 'type', header: 'Type', mono: true },
                        ]}
                        rows={dataCols}
                      />
                    </Stack>
                  )}

                  {inspection.kind === 'data' && sceneNodes.length > 0 && (
                    <Stack gap="1">
                      <Text size="sm" variant="muted">
                        Data Structure
                      </Text>
                      <Tree
                        key={file.id}
                        nodes={sceneNodes}
                        defaultExpandedIds={expandedSceneIds}
                        ariaLabel="Data structure tree"
                        className="org-inspector__scene-tree"
                      />
                    </Stack>
                  )}

                  {imageHistogram && (
                    <Stack gap="1">
                      <button
                        type="button"
                        className="org-inspector__aov-row"
                        onClick={() => setScopesOpen((o) => !o)}
                        aria-expanded={scopesOpen}
                      >
                        <span>Scopes (RGB / Luma Histogram)</span>
                        <Badge tone="neutral">{scopesOpen ? 'Hide' : 'Show'}</Badge>
                      </button>
                      {scopesOpen && (
                        <Histogram
                          compact
                          channels={[
                            { id: 'r', label: 'R', bins: imageHistogram.r, color: 'var(--axis-x)' },
                            { id: 'g', label: 'G', bins: imageHistogram.g, color: 'var(--axis-y)' },
                            { id: 'b', label: 'B', bins: imageHistogram.b, color: 'var(--axis-z)' },
                            { id: 'y', label: 'Y', bins: imageHistogram.luma, color: 'var(--series-8)' },
                          ]}
                        />
                      )}
                    </Stack>
                  )}

                  <Separator orientation="horizontal" />

                  <Stack gap="1">
                    <Text size="sm" variant="muted">
                      File Info
                    </Text>
                    <Table columns={INFO_COLS} rows={infoRows} />
                  </Stack>
                </Stack>
              </ScrollArea>
            ),
          },
          {
            id: 'metadata',
            label: 'Metadata',
            content: (
              <Stack gap="2" fill>
                <SearchField
                  value={metaQuery}
                  onChange={setMetaQuery}
                  placeholder="Search metadata..."
                  ariaLabel="Search metadata"
                />
                <ScrollArea>
                  {metaRows.length > 0 ? (
                    <Table columns={META_COLS} rows={metaRows} />
                  ) : (
                    <Text variant="muted">No matching metadata keys.</Text>
                  )}
                </ScrollArea>
              </Stack>
            ),
          },
          {
            id: 'annotations',
            label: `Annotations (${annotations.length})`,
            content: (
              <Stack gap="2" fill>
                <div className="org-inspector__ann-head">
                  <Text size="sm" variant="muted">
                    Saved Notes & Strokes
                  </Text>
                  <Button
                    size="sm"
                    disabled={annotations.length === 0}
                    onClick={exportAnnotationsJson}
                  >
                    Export JSON
                  </Button>
                </div>
                <TextArea
                  value={noteDraft}
                  placeholder="Add review note (Enter to submit, Shift+Enter newline)..."
                  aria-label="Review annotation note"
                  onChange={(e) => onNoteDraftChange(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      void submitAnnotation();
                    }
                  }}
                />
                <div className="org-inspector__note-actions">
                  <Button
                    variant="primary"
                    size="sm"
                    aria-label="Submit annotation"
                    onClick={() => void submitAnnotation()}
                  >
                    Submit
                  </Button>
                </div>
                <ScrollArea>
                  <Stack gap="2">
                    {annotations.length === 0 ? (
                      <Text variant="muted">No saved annotations on this file yet.</Text>
                    ) : (
                      annotations.map((ann) => {
                        const plane = ann.plane_json as unknown as AnnotationPlaneData | null;
                        const camPose = ann.camera_json as unknown as CameraPose | null;
                        const frameBadge =
                          ann.frame_in !== null && ann.frame_in !== undefined
                            ? ann.frame_out !== null &&
                              ann.frame_out !== undefined &&
                              ann.frame_out !== ann.frame_in
                              ? `F${ann.frame_in}–${ann.frame_out}`
                              : `F${ann.frame_in}`
                            : null;
                        return (
                          <div key={ann.id} className="org-inspector__ann-card">
                            <div className="org-inspector__ann-meta">
                              <Badge tone="accent">{ann.kind.toUpperCase()}</Badge>
                              {frameBadge && <Badge tone="neutral">{frameBadge}</Badge>}
                              <Text size="sm" variant="mono">
                                {(ann.vector_json ?? []).length} stroke(s)
                              </Text>
                              {(camPose || frameBadge) && (
                                <Button
                                  size="sm"
                                  onClick={() => {
                                    if (ann.frame_in !== null && ann.frame_in !== undefined) {
                                      window.dispatchEvent(
                                        new CustomEvent('organum:seek-frame', {
                                          detail: ann.frame_in,
                                        }),
                                      );
                                    }
                                    if (camPose) {
                                      onUpdateState({ frozen: false, activeTextureIndex: null });
                                      window.setTimeout(() => {
                                        window.dispatchEvent(
                                          new CustomEvent('organum:jump-camera', {
                                            detail: camPose,
                                          }),
                                        );
                                      }, 30);
                                    }
                                  }}
                                >
                                  Jump
                                </Button>
                              )}
                              {selectedTaskId && !isPreview && (
                                <Button
                                  size="sm"
                                  onClick={async () => {
                                    try {
                                      await apiClient.createTaskComment(
                                        selectedTaskId,
                                        {
                                          body:
                                            ann.note_text?.trim() ||
                                            `Media annotation (${ann.kind.toUpperCase()})`,
                                          kind: 'media',
                                          visibility: isClientRole ? 'client' : 'internal',
                                          file_id: file.id,
                                          annotation_id: ann.id,
                                          frame: ann.frame_in ?? null,
                                        },
                                        activeProjectUuid,
                                      );
                                      await queryClient.invalidateQueries({
                                        queryKey: ['task', activeProjectUuid, selectedTaskId],
                                      });
                                      toast.push('success', 'Posted annotation to task thread');
                                    } catch (err) {
                                      toast.push(
                                        'danger',
                                        err instanceof Error
                                          ? err.message
                                          : 'Failed to post to task',
                                      );
                                    }
                                  }}
                                >
                                  Post to task
                                </Button>
                              )}
                              <Button
                                variant="icon"
                                size="sm"
                                aria-label="Delete annotation"
                                onClick={async () => {
                                  await apiClient.deleteAnnotation(file.id, ann.id);
                                  await queryClient.invalidateQueries({
                                    queryKey: ['annotations', activeProjectUuid, file.id],
                                  });
                                }}
                              >
                                <Icon name="close" size="sm" />
                              </Button>
                            </div>
                            {ann.kind === '3d' && plane && camPose && (
                              <NumberField
                                label="Plane d"
                                ariaLabel={`Annotation plane distance ${ann.id}`}
                                value={plane.distance}
                                min={0.05}
                                max={200}
                                step={0.1}
                                precision={2}
                                onChange={async (newD) => {
                                  const rescaled = rescalePlaneDistance(
                                    plane,
                                    (ann.vector_json ?? []) as unknown as Stroke3D[],
                                    camPose.position,
                                    newD,
                                  );
                                  await apiClient.updateAnnotation(file.id, ann.id, {
                                    plane_json: rescaled.plane as unknown as Record<string, unknown>,
                                    vector_json:
                                      rescaled.strokes as unknown as Array<Record<string, unknown>>,
                                  });
                                  await queryClient.refetchQueries({
                                    queryKey: ['annotations', activeProjectUuid, file.id],
                                  });
                                }}
                              />
                            )}
                            <Text>{ann.note_text || '(Vector annotation without note)'}</Text>
                          </div>
                        );
                      })
                    )}
                  </Stack>
                </ScrollArea>
              </Stack>
            ),
          },
          ...(selectedEntity
            ? [
              {
                id: 'entity',
                label: 'Entity',
                content: (
                  <ScrollArea>
                    <EntityInspectorTab entity={selectedEntity} />
                  </ScrollArea>
                ),
              },
            ]
            : []),
          ...(selectedTaskId
            ? [
              {
                id: 'task',
                label: 'Task',
                content: <TaskDetail taskId={selectedTaskId} compact />,
              },
            ]
            : []),
        ]}
      />
    </Panel>
  );
}
