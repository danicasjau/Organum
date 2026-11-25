import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState, type MouseEvent, type PointerEvent } from 'react';
import { Button, Icon, Inline, SearchField, SegmentedControl, Spinner, Text } from '../../components/ui';
import { useCssVarRef } from '../../components/ui/_internal/useCssVar';
import {
  apiClient,
  isScenefilePreviewId,
  type FileSummaryOut,
  type InspectionDocument,
  type LayerThumbItem,
  type LayerThumbManifest,
} from '../../lib/api/client';
import { useProjectStore } from '../project/projectStore';
import type { PerFileViewerState } from './viewerStore';
import './LayerStrip.css';

type ThumbSize = 'sm' | 'md' | 'lg';

function AtlasTileCanvas({
  atlasImg,
  item,
  sizePx,
}: {
  atlasImg: HTMLImageElement | null;
  item: LayerThumbItem;
  sizePx: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = sizePx;
    canvas.height = sizePx;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, sizePx, sizePx);

    // Subtle checker background for alpha tiles
    const cell = 8;
    for (let y = 0; y < sizePx; y += cell) {
      for (let x = 0; x < sizePx; x += cell) {
        ctx.fillStyle = ((x / cell + y / cell) | 0) % 2 === 0 ? '#182234' : '#223047';
        ctx.fillRect(x, y, cell, cell);
      }
    }

    if (atlasImg && atlasImg.complete && atlasImg.naturalWidth > 0) {
      ctx.drawImage(
        atlasImg,
        item.x,
        item.y,
        item.width,
        item.height,
        0,
        0,
        sizePx,
        sizePx,
      );
    }
  }, [atlasImg, item.x, item.y, item.width, item.height, sizePx]);

  return <canvas ref={canvasRef} className="org-layerstrip__canvas" aria-hidden="true" />;
}

function formatItemTooltip(item: LayerThumbItem): string {
  const parts: string[] = [item.label];
  if (item.kind === 'aov') {
    if (item.channels !== undefined) parts.push(`${item.channels}ch`);
    if (item.dtype) parts.push(item.dtype);
  } else if (item.kind === 'layer' || item.kind === 'group') {
    if (item.blend_mode) parts.push(`blend: ${item.blend_mode}`);
    if (item.opacity !== undefined) parts.push(`opacity: ${Math.round(item.opacity * 100)}%`);
  } else if (item.kind === 'tiff_page' || item.kind === 'udim') {
    if (item.width_px && item.height_px) parts.push(`${item.width_px}×${item.height_px}`);
  }
  if (item.auto_normalized) {
    parts.push('auto-normalized');
  }
  return parts.join(' • ');
}

function SingleStripRow({
  fileId,
  kind,
  params,
  title,
  showSubHeader,
  thumbSize,
  filterText,
  viewerState,
  onUpdateState,
  isUdimMode,
  isPsdMode,
  isTiffMode,
  isExrMode,
  registerSteppable,
}: {
  fileId: string;
  kind: 'layer_thumbs' | 'udim_tiles';
  params: Record<string, unknown>;
  title: string;
  showSubHeader?: boolean;
  thumbSize: ThumbSize;
  filterText: string;
  viewerState: PerFileViewerState;
  onUpdateState: (patch: Partial<PerFileViewerState>) => void;
  isUdimMode?: boolean;
  isPsdMode?: boolean;
  isTiffMode?: boolean;
  isExrMode?: boolean;
  registerSteppable?: (items: LayerThumbItem[]) => void;
}) {
  const activeProjectUuid = useProjectStore((s) => s.activeProjectUuid);
  const [page, setPage] = useState(0);
  const [psdGroupId, setPsdGroupId] = useState<string | null>(null);
  const [atlasImg, setAtlasImg] = useState<HTMLImageElement | null>(null);

  useEffect(() => {
    setPage(0);
    setPsdGroupId(null);
  }, [fileId, kind]);

  const queryParams = useMemo(() => ({ ...params, page, page_size: 64 }), [params, page]);
  const isPreview = isScenefilePreviewId(fileId);

  const { data: bundle, isLoading } = useQuery<{
    manifest: LayerThumbManifest;
    atlasUrl: string;
  } | null>({
    queryKey: ['layer-thumbs', activeProjectUuid, fileId, kind, queryParams],
    enabled: Boolean(activeProjectUuid && fileId && !isPreview),
    staleTime: 60_000,
    queryFn: async () => {
      const art = await apiClient.createArtifact(fileId, kind, queryParams, activeProjectUuid);
      const res = await fetch(art.content_url);
      if (!res.ok) throw new Error(`Failed to fetch layer_thumbs manifest (${res.status})`);
      const manifest = (await res.json()) as LayerThumbManifest;
      return {
        manifest,
        atlasUrl: apiClient.artifactAtlasUrl(art.id, activeProjectUuid),
      };
    },
  });

  useEffect(() => {
    if (!bundle?.atlasUrl) {
      setAtlasImg(null);
      return;
    }
    let active = true;
    const img = new Image();
    img.onload = () => {
      if (active) setAtlasImg(img);
    };
    img.src = bundle.atlasUrl;
    return () => {
      active = false;
    };
  }, [bundle?.atlasUrl]);

  const manifest = bundle?.manifest;
  const allItems = useMemo(() => manifest?.items ?? [], [manifest?.items]);

  const breadcrumbs = useMemo(() => {
    if (!isPsdMode || !psdGroupId) return [];
    const map = new Map(allItems.map((it) => [it.id, it]));
    const trail: LayerThumbItem[] = [];
    let cur: LayerThumbItem | undefined = map.get(psdGroupId);
    while (cur) {
      trail.unshift(cur);
      cur = cur.parent_id ? map.get(cur.parent_id) : undefined;
    }
    return trail;
  }, [isPsdMode, psdGroupId, allItems]);

  const filteredItems = useMemo(() => {
    const q = filterText.trim().toLowerCase();
    let list = allItems;
    if (isPsdMode && !q) {
      list = allItems.filter((it) => (it.parent_id ?? null) === psdGroupId);
    }
    if (q) {
      list = list.filter((it) => it.label.toLowerCase().includes(q));
    }
    return list;
  }, [allItems, filterText, isPsdMode, psdGroupId]);

  useEffect(() => {
    registerSteppable?.(filteredItems);
  }, [filteredItems, registerSteppable]);

  const canvasPx = thumbSize === 'sm' ? 44 : thumbSize === 'lg' ? 72 : 56;
  const hiddenSet = useMemo(() => new Set(viewerState.hiddenLayerIds), [viewerState.hiddenLayerIds]);
  const totalPages = manifest ? Math.max(1, Math.ceil(manifest.total / manifest.page_size)) : 1;

  const isSelected = (item: LayerThumbItem, idx: number): boolean => {
    if (isExrMode) {
      const currentAov = viewerState.activeAov ?? allItems[0]?.id ?? null;
      return currentAov === item.id;
    }
    if (isTiffMode) {
      return viewerState.activePage === (item.page ?? idx);
    }
    if (isPsdMode) {
      return viewerState.isolatedLayerId === item.id;
    }
    if (isUdimMode) {
      if (item.kind === 'mosaic') {
        return viewerState.selectedUdimTiles.length === 0;
      }
      return item.udim != null && viewerState.selectedUdimTiles.includes(item.udim);
    }
    return false;
  };

  const handleTileClick = (item: LayerThumbItem, idx: number, e: MouseEvent<HTMLButtonElement>) => {
    if (isExrMode) {
      onUpdateState({ activeAov: item.id });
      return;
    }
    if (isTiffMode) {
      onUpdateState({ activePage: item.page ?? idx });
      return;
    }
    if (isPsdMode) {
      if (item.is_group) {
        setPsdGroupId(item.id);
      } else {
        onUpdateState({
          isolatedLayerId: viewerState.isolatedLayerId === item.id ? null : item.id,
        });
      }
      return;
    }
    if (isUdimMode) {
      if (item.kind === 'mosaic' || item.udim == null) {
        onUpdateState({ selectedUdimTiles: [] });
        return;
      }
      const tileNum = item.udim;
      if (e.ctrlKey || e.metaKey) {
        const exists = viewerState.selectedUdimTiles.includes(tileNum);
        const next = exists
          ? viewerState.selectedUdimTiles.filter((x) => x !== tileNum)
          : [...viewerState.selectedUdimTiles, tileNum];
        onUpdateState({ selectedUdimTiles: next });
      } else {
        onUpdateState({
          selectedUdimTiles:
            viewerState.selectedUdimTiles.length === 1 && viewerState.selectedUdimTiles[0] === tileNum
              ? []
              : [tileNum],
        });
      }
    }
  };

  const needsSubMeta = Boolean(showSubHeader) || (isPsdMode && breadcrumbs.length > 0) || totalPages > 1;

  return (
    <div className="org-layerstrip__subrow" data-thumb-size={thumbSize}>
      {needsSubMeta && (
        <div className="org-layerstrip__submeta">
          <Text size="sm" variant="accent">
            {title} ({manifest?.total ?? 0})
          </Text>
          {isPsdMode && breadcrumbs.length > 0 && (
            <Inline gap="1">
              <button
                type="button"
                className="org-layerstrip__crumb"
                onClick={() => setPsdGroupId(null)}
              >
                Root
              </button>
              {breadcrumbs.map((b) => (
                <button
                  key={b.id}
                  type="button"
                  className="org-layerstrip__crumb"
                  onClick={() => setPsdGroupId(b.id)}
                >
                  / {b.label}
                </button>
              ))}
            </Inline>
          )}
          {totalPages > 1 && (
            <Inline gap="1">
              <Button
                size="sm"
                disabled={page <= 0}
                onClick={() => setPage((p) => Math.max(0, p - 1))}
              >
                Prev
              </Button>
              <Text size="sm" variant="mono">
                {page + 1}/{totalPages}
              </Text>
              <Button
                size="sm"
                disabled={page + 1 >= totalPages}
                onClick={() => setPage((p) => p + 1)}
              >
                Next
              </Button>
            </Inline>
          )}
        </div>
      )}

      <div className="org-layerstrip__track" role="region" aria-label={title}>
        {isLoading && <Spinner label={`Loading ${title}`} />}
        {!isLoading &&
          filteredItems.map((item, idx) => {
            const selected = isSelected(item, idx);
            const hidden = isPsdMode ? hiddenSet.has(item.id) : false;
            return (
              <div
                key={item.id}
                className="org-layerstrip__tilewrap"
                data-selected={selected ? 'true' : undefined}
                data-hidden={hidden ? 'true' : undefined}
              >
                <button
                  type="button"
                  aria-pressed={selected}
                  className="org-layerstrip__tile"
                  title={formatItemTooltip(item)}
                  onClick={(e) => handleTileClick(item, idx, e)}
                >
                  <div className="org-layerstrip__thumb">
                    <AtlasTileCanvas atlasImg={atlasImg} item={item} sizePx={canvasPx} />
                    {item.is_group && (
                      <span className="org-layerstrip__badge" aria-hidden="true">
                        DIR
                      </span>
                    )}
                    {item.auto_normalized && (
                      <span
                        className="org-layerstrip__badge"
                        title="Percentile auto-normalized"
                        aria-hidden="true"
                      >
                        NORM
                      </span>
                    )}
                  </div>
                  <span className="org-layerstrip__caption">{item.label}</span>
                </button>
                {isPsdMode && !item.is_group && (
                  <button
                    type="button"
                    className="org-layerstrip__eye"
                    aria-label={`Toggle visibility for ${item.label}`}
                    title={hidden ? 'Show layer' : 'Hide layer'}
                    onClick={(e) => {
                      e.stopPropagation();
                      const next = hiddenSet.has(item.id)
                        ? viewerState.hiddenLayerIds.filter((x) => x !== item.id)
                        : [...viewerState.hiddenLayerIds, item.id];
                      onUpdateState({ hiddenLayerIds: next });
                    }}
                  >
                    <Icon name={hidden ? 'eye-off' : 'eye'} size="sm" />
                  </button>
                )}
              </div>
            );
          })}
      </div>
    </div>
  );
}

export interface LayerStripProps {
  file: FileSummaryOut;
  inspection: InspectionDocument;
  viewerState: PerFileViewerState;
  onUpdateState: (patch: Partial<PerFileViewerState>) => void;
}

export function hasLayerStripContent(
  file: FileSummaryOut | null,
  inspection: InspectionDocument | null,
): boolean {
  if (!file || !inspection || isScenefilePreviewId(file.id)) return false;
  const fmt = file.detected_format.toLowerCase();
  const isUdim = Boolean(inspection.capabilities?.udim);
  const aovs = inspection.aovs ?? [];
  const layers = inspection.layers ?? [];
  return (
    isUdim ||
    (fmt === 'exr' && aovs.length > 0) ||
    ((fmt === 'psd' || fmt === 'psb') && layers.length > 0) ||
    ((fmt === 'tif' || fmt === 'tiff') && layers.length > 0)
  );
}

export function LayerStrip({ file, inspection, viewerState, onUpdateState }: LayerStripProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [stripHeight, setStripHeight] = useState<number | null>(null);
  const [thumbSize, setThumbSize] = useState<ThumbSize>('md');
  const [filterText, setFilterText] = useState('');
  const steppableRef = useRef<LayerThumbItem[]>([]);
  const dragRef = useRef<{ startY: number; startH: number } | null>(null);

  const isUdim = Boolean(inspection.capabilities?.udim);
  const fmt = file.detected_format.toLowerCase();
  const aovs = inspection.aovs ?? [];
  const layers = inspection.layers ?? [];
  const isExr = fmt === 'exr' && aovs.length > 0;
  const isPsd = (fmt === 'psd' || fmt === 'psb') && layers.length > 0;
  const isTiff = (fmt === 'tif' || fmt === 'tiff') && layers.length > 0;

  useCssVarRef(rootRef, '--layerstrip-custom-h', stripHeight ? `${stripHeight}px` : undefined);

  useEffect(() => {
    const onFocusStrip = () => {
      setCollapsed(false);
      rootRef.current?.scrollIntoView({ block: 'nearest' });
    };
    window.addEventListener('organum:focus-layer-strip', onFocusStrip);
    return () => window.removeEventListener('organum:focus-layer-strip', onFocusStrip);
  }, []);

  // `[` / `]` keyboard stepping across visible items
  useEffect(() => {
    const onStep = (ev: Event) => {
      const delta = Number((ev as CustomEvent<number>).detail ?? 1);
      const items = steppableRef.current.filter((it) => !it.is_group);
      if (items.length === 0) return;

      if (isExr && !isUdim) {
        const cur = viewerState.activeAov ?? items[0]?.id;
        const idx = Math.max(0, items.findIndex((i) => i.id === cur));
        const nextIdx = (idx + delta + items.length) % items.length;
        const target = items[nextIdx];
        if (target) onUpdateState({ activeAov: target.id });
      } else if (isTiff) {
        const idx = Math.max(0, items.findIndex((i) => (i.page ?? 0) === viewerState.activePage));
        const nextIdx = (idx + delta + items.length) % items.length;
        const target = items[nextIdx];
        if (target) onUpdateState({ activePage: target.page ?? nextIdx });
      } else if (isPsd) {
        const idx = viewerState.isolatedLayerId
          ? items.findIndex((i) => i.id === viewerState.isolatedLayerId)
          : -1;
        const nextIdx = (idx + delta + items.length) % items.length;
        const target = items[nextIdx];
        if (target) onUpdateState({ isolatedLayerId: target.id });
      } else if (isUdim) {
        const curId =
          viewerState.selectedUdimTiles.length === 1 ? String(viewerState.selectedUdimTiles[0]) : 'mosaic';
        const idx = Math.max(0, items.findIndex((i) => i.id === curId));
        const nextIdx = (idx + delta + items.length) % items.length;
        const target = items[nextIdx];
        if (target) {
          onUpdateState({
            selectedUdimTiles: target.kind === 'mosaic' || target.udim == null ? [] : [target.udim],
          });
        }
      }
    };
    window.addEventListener('organum:step-layer', onStep);
    return () => window.removeEventListener('organum:step-layer', onStep);
  }, [isExr, isTiff, isPsd, isUdim, viewerState, onUpdateState]);

  const handleResizeDown = (e: PointerEvent<HTMLDivElement>) => {
    const el = rootRef.current;
    if (!el || e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = { startY: e.clientY, startH: el.getBoundingClientRect().height };
  };

  const handleResizeMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current || !e.currentTarget.hasPointerCapture(e.pointerId)) return;
    const dy = dragRef.current.startY - e.clientY;
    setStripHeight(Math.max(76, Math.min(240, Math.round(dragRef.current.startH + dy))));
  };

  const handleResizeUp = (e: PointerEvent<HTMLDivElement>) => {
    dragRef.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
  };

  const headerTitle = isUdim
    ? `UDIM Tiles (${(inspection.summary?.udim_tile_count as number | undefined) ?? 0})`
    : isExr
      ? `AOVs (${aovs.length})`
      : isPsd
        ? `PSD Layers (${layers.length})`
        : `TIFF Pages (${layers.length})`;

  const activeUdimParam =
    isUdim && viewerState.selectedUdimTiles.length === 1
      ? viewerState.selectedUdimTiles[0]
      : undefined;

  return (
    <div
      ref={rootRef}
      data-ui="layer-strip"
      data-collapsed={collapsed ? 'true' : undefined}
      data-stacked={isUdim && isExr ? 'true' : undefined}
      className="org-layerstrip"
    >
      {!collapsed && (
        <div
          className="org-layerstrip__resizer"
          role="separator"
          aria-orientation="horizontal"
          aria-label="Resize layer strip"
          onPointerDown={handleResizeDown}
          onPointerMove={handleResizeMove}
          onPointerUp={handleResizeUp}
        />
      )}

      <div className="org-layerstrip__header">
        <Inline gap="2">
          <Text size="sm" variant="accent">
            {headerTitle}
          </Text>
          <Text size="sm" variant="muted">
            ([ / ] prev/next)
          </Text>
        </Inline>
        <Inline gap="1">
          {!collapsed && (
            <>
              <div className="org-layerstrip__filter">
                <SearchField
                  value={filterText}
                  onChange={setFilterText}
                  placeholder="Filter..."
                  ariaLabel="Filter layers or tiles"
                />
              </div>
              <SegmentedControl<ThumbSize>
                size="sm"
                ariaLabel="Layer thumbnail size"
                value={thumbSize}
                onChange={setThumbSize}
                options={[
                  { value: 'sm', label: 'S' },
                  { value: 'md', label: 'M' },
                  { value: 'lg', label: 'L' },
                ]}
              />
            </>
          )}
          <Button
            size="sm"
            variant="icon"
            aria-label={collapsed ? 'Expand layer strip' : 'Collapse layer strip'}
            title={collapsed ? 'Expand layer strip' : 'Collapse layer strip'}
            onClick={() => setCollapsed((c) => !c)}
          >
            <Icon name={collapsed ? 'chevron-up' : 'chevron-down'} size="sm" />
          </Button>
        </Inline>
      </div>

      {!collapsed && (
        <div className="org-layerstrip__body">
          {isUdim && (
            <SingleStripRow
              fileId={file.id}
              kind="udim_tiles"
              params={{ mode: 'udim' }}
              title="UDIM Tiles"
              showSubHeader={isUdim && isExr}
              thumbSize={thumbSize}
              filterText={filterText}
              viewerState={viewerState}
              onUpdateState={onUpdateState}
              isUdimMode
              registerSteppable={(items) => {
                steppableRef.current = items;
              }}
            />
          )}

          {isExr && (
            <SingleStripRow
              fileId={file.id}
              kind="layer_thumbs"
              params={activeUdimParam !== undefined ? { udim: activeUdimParam } : {}}
              title={activeUdimParam !== undefined ? `AOVs (UDIM ${activeUdimParam})` : 'EXR AOVs'}
              showSubHeader={isUdim && isExr}
              thumbSize={thumbSize}
              filterText={filterText}
              viewerState={viewerState}
              onUpdateState={onUpdateState}
              isExrMode
              registerSteppable={
                !isUdim
                  ? (items) => {
                      steppableRef.current = items;
                    }
                  : undefined
              }
            />
          )}

          {isPsd && (
            <SingleStripRow
              fileId={file.id}
              kind="layer_thumbs"
              params={{}}
              title="PSD Layers"
              thumbSize={thumbSize}
              filterText={filterText}
              viewerState={viewerState}
              onUpdateState={onUpdateState}
              isPsdMode
              registerSteppable={(items) => {
                steppableRef.current = items;
              }}
            />
          )}

          {isTiff && !isUdim && (
            <SingleStripRow
              fileId={file.id}
              kind="layer_thumbs"
              params={{}}
              title="TIFF Pages"
              thumbSize={thumbSize}
              filterText={filterText}
              viewerState={viewerState}
              onUpdateState={onUpdateState}
              isTiffMode
              registerSteppable={(items) => {
                steppableRef.current = items;
              }}
            />
          )}
        </div>
      )}
    </div>
  );
}
