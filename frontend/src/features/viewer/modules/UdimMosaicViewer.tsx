import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent,
  type WheelEvent,
} from 'react';
import { Spinner, Text } from '../../../components/ui';
import {
  apiClient,
  type FileSummaryOut,
  type InspectionDocument,
  type UdimTileDescriptor,
} from '../../../lib/api/client';
import { useProjectStore } from '../../project/projectStore';
import { AnnotationLayer2D } from '../AnnotationLayer2D';
import {
  useViewerStore,
  type AnnotationTool,
  type ImageHistogramData,
  type PerFileViewerState,
} from '../viewerStore';
import {
  WebGL2ImageRenderer,
  mapChannelIndex,
  mapDisplayViewIndex,
  mapInputSpaceIndex,
} from '../webgl2Renderer';
import './UdimMosaicViewer.css';

interface LoadedTileBuffer {
  udim: number;
  u: number;
  v: number;
  width: number;
  height: number;
  isFloat: boolean;
  floatData: Float32Array | null;
  uint8Data: Uint8Array | null;
  texture: WebGLTexture | null;
}

const BASE_UV_CELL_PX = 256;

function parseOrgfTile(buf: ArrayBuffer): { width: number; height: number; floatData: Float32Array } {
  const dv = new DataView(buf);
  const width = dv.getUint32(4, true);
  const height = dv.getUint32(8, true);
  return { width, height, floatData: new Float32Array(buf, 16, width * height * 4) };
}

function computeMosaicHistogram(tiles: Map<number, LoadedTileBuffer>): ImageHistogramData | null {
  if (tiles.size === 0) return null;
  const bins = 64;
  const r = new Array<number>(bins).fill(0);
  const g = new Array<number>(bins).fill(0);
  const b = new Array<number>(bins).fill(0);
  const luma = new Array<number>(bins).fill(0);
  for (const tile of tiles.values()) {
    const data = tile.isFloat ? tile.floatData : tile.uint8Data;
    if (!data) continue;
    const total = tile.width * tile.height;
    const stride = Math.max(1, Math.floor(total / 16384));
    const scale = tile.isFloat ? 1.0 : 1.0 / 255.0;
    for (let p = 0; p < total; p += stride) {
      const i = p * 4;
      const rv = Math.max(0, Math.min(1, (data[i] ?? 0) * scale));
      const gv = Math.max(0, Math.min(1, (data[i + 1] ?? 0) * scale));
      const bv = Math.max(0, Math.min(1, (data[i + 2] ?? 0) * scale));
      const yv = Math.max(0, Math.min(1, 0.2126 * rv + 0.7152 * gv + 0.0722 * bv));
      r[Math.min(bins - 1, Math.floor(rv * (bins - 1)))]!++;
      g[Math.min(bins - 1, Math.floor(gv * (bins - 1)))]!++;
      b[Math.min(bins - 1, Math.floor(bv * (bins - 1)))]!++;
      luma[Math.min(bins - 1, Math.floor(yv * (bins - 1)))]!++;
    }
  }
  return { r, g, b, luma };
}

export interface UdimMosaicViewerProps {
  file: FileSummaryOut;
  inspection: InspectionDocument;
  viewerState: PerFileViewerState;
  onUpdateState: (patch: Partial<PerFileViewerState>) => void;
  activeTool: AnnotationTool;
  noteDraft: string;
  onNoteDraftChange: (note: string) => void;
}

export function UdimMosaicViewer({
  file,
  inspection,
  viewerState,
  onUpdateState,
  activeTool,
  noteDraft,
  onNoteDraftChange,
}: UdimMosaicViewerProps) {
  const activeProjectUuid = useProjectStore((s) => s.activeProjectUuid);
  const viewportBg = useViewerStore((s) => s.viewportBg);
  const setPixelReadout = useViewerStore((s) => s.setPixelReadout);
  const setImageHistogram = useViewerStore((s) => s.setImageHistogram);

  const containerRef = useRef<HTMLDivElement>(null);
  const glCanvasRef = useRef<HTMLCanvasElement>(null);
  const hudCanvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<WebGL2ImageRenderer | null>(null);
  const tileMapRef = useRef<Map<number, LoadedTileBuffer>>(new Map());
  const panDragRef = useRef<{ x: number; y: number; startPanX: number; startPanY: number } | null>(
    null,
  );

  const [viewportSize, setViewportSize] = useState({ width: 800, height: 500 });
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [renderTick, setRenderTick] = useState(0);
  const [spaceHeld, setSpaceHeld] = useState(false);

  const allTiles = useMemo(
    () =>
      ((inspection.summary?.udim_tiles as UdimTileDescriptor[] | undefined) ?? []).filter(
        (t) => typeof t.udim === 'number',
      ),
    [inspection.summary],
  );

  const visibleTiles = useMemo(() => {
    if (viewerState.selectedUdimTiles.length === 0) return allTiles;
    const sel = new Set(viewerState.selectedUdimTiles);
    const sub = allTiles.filter((t) => sel.has(t.udim));
    return sub.length > 0 ? sub : allTiles;
  }, [allTiles, viewerState.selectedUdimTiles]);

  const gridCols = useMemo(() => Math.max(1, ...allTiles.map((t) => t.u + 1)), [allTiles]);
  const gridRows = useMemo(() => Math.max(1, ...allTiles.map((t) => t.v + 1)), [allTiles]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (rect) {
        setViewportSize({
          width: Math.max(1, Math.floor(rect.width)),
          height: Math.max(1, Math.floor(rect.height)),
        });
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.code === 'Space' && document.activeElement?.tagName !== 'INPUT' && document.activeElement?.tagName !== 'TEXTAREA') {
        setSpaceHeld(true);
      }
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === 'Space') setSpaceHeld(false);
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, []);

  useEffect(() => {
    const canvas = glCanvasRef.current;
    if (!canvas) return;
    const tiles = tileMapRef.current;
    try {
      rendererRef.current = new WebGL2ImageRenderer(canvas);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'WebGL2 initialization failed');
    }
    return () => {
      for (const t of tiles.values()) {
        if (t.texture) rendererRef.current?.deleteExternalTexture(t.texture);
      }
      tiles.clear();
      rendererRef.current?.dispose();
      rendererRef.current = null;
    };
  }, []);

  // Load each UDIM tile independently
  useEffect(() => {
    if (!activeProjectUuid || allTiles.length === 0) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setLoadError(null);

    for (const prev of tileMapRef.current.values()) {
      if (prev.texture) rendererRef.current?.deleteExternalTexture(prev.texture);
    }
    tileMapRef.current.clear();

    const fmt = file.detected_format.toLowerCase();
    const isFloatFormat = ['exr', 'hdr', 'pic', 'dpx', 'tx', 'tex', 'tif', 'tiff'].includes(fmt);

    void (async () => {
      try {
        await Promise.all(
          allTiles.map(async (tile) => {
            let loaded: LoadedTileBuffer;
            if (isFloatFormat) {
              const params: Record<string, unknown> = { udim: tile.udim };
              if (fmt === 'exr') {
                params.aov = viewerState.activeAov ?? 'RGBA';
              }
              const art = await apiClient.createArtifact(
                file.id,
                'float_rgba',
                params,
                activeProjectUuid,
              );
              const resp = await fetch(art.content_url);
              if (!resp.ok) throw new Error(`UDIM ${tile.udim} float fetch failed`);
              const parsed = parseOrgfTile(await resp.arrayBuffer());
              loaded = {
                udim: tile.udim,
                u: tile.u,
                v: tile.v,
                width: parsed.width,
                height: parsed.height,
                isFloat: true,
                floatData: parsed.floatData,
                uint8Data: null,
                texture: null,
              };
            } else {
              const resp = await fetch(
                apiClient.udimTileContentUrl(file.id, tile.udim, activeProjectUuid),
              );
              if (!resp.ok) throw new Error(`UDIM ${tile.udim} fetch failed (${resp.status})`);
              const bmp = await createImageBitmap(await resp.blob());
              const off = document.createElement('canvas');
              off.width = bmp.width;
              off.height = bmp.height;
              const octx = off.getContext('2d');
              if (!octx) throw new Error('2D decode context unavailable');
              octx.drawImage(bmp, 0, 0);
              const imgData = octx.getImageData(0, 0, bmp.width, bmp.height);
              bmp.close();
              loaded = {
                udim: tile.udim,
                u: tile.u,
                v: tile.v,
                width: imgData.width,
                height: imgData.height,
                isFloat: false,
                floatData: null,
                uint8Data: new Uint8Array(imgData.data.buffer),
                texture: null,
              };
            }
            if (cancelled) return;
            if (rendererRef.current) {
              loaded.texture = loaded.isFloat && loaded.floatData
                ? rendererRef.current.createFloatTexture(loaded.width, loaded.height, loaded.floatData)
                : loaded.uint8Data
                  ? rendererRef.current.createUint8Texture(loaded.width, loaded.height, loaded.uint8Data)
                  : null;
            }
            tileMapRef.current.set(tile.udim, loaded);
            if (!cancelled) setRenderTick((t) => t + 1);
          }),
        );
        if (!cancelled) {
          setImageHistogram(computeMosaicHistogram(tileMapRef.current));
          setLoading(false);
        }
      } catch (err) {
        if (!cancelled) {
          setLoadError(err instanceof Error ? err.message : 'UDIM tile load failed');
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [file.id, file.detected_format, allTiles, activeProjectUuid, viewerState.activeAov, setImageHistogram]);

  const computeEffectiveZoom = useCallback((): number => {
    if (viewerState.zoom > 0) return viewerState.zoom;
    const pad = 40;
    const zx = Math.max(0.05, (viewportSize.width - pad) / (gridCols * BASE_UV_CELL_PX));
    const zy = Math.max(0.05, (viewportSize.height - pad) / (gridRows * BASE_UV_CELL_PX));
    return Math.min(zx, zy, 1.5);
  }, [viewerState.zoom, viewportSize, gridCols, gridRows]);

  const effectiveZoom = computeEffectiveZoom();
  const cellPx = effectiveZoom * BASE_UV_CELL_PX;
  const gridLeft = viewportSize.width / 2 + viewerState.panX - (gridCols * cellPx) / 2;
  const gridBottom = viewportSize.height / 2 + viewerState.panY + (gridRows * cellPx) / 2;

  useEffect(() => {
    const glCanvas = glCanvasRef.current;
    const hud = hudCanvasRef.current;
    if (!glCanvas || !hud) return;
    glCanvas.width = viewportSize.width;
    glCanvas.height = viewportSize.height;
    hud.width = viewportSize.width;
    hud.height = viewportSize.height;

    const renderer = rendererRef.current;
    if (renderer) {
      renderer.clearViewport(viewportSize.width, viewportSize.height);
      const uniforms = {
        inputSpace: mapInputSpaceIndex(viewerState.colorspace),
        displayView: mapDisplayViewIndex(viewerState.displayView),
        exposure: viewerState.exposure,
        gamma: viewerState.gamma,
        saturation: viewerState.saturation,
        hue: viewerState.hue,
        channel: mapChannelIndex(viewerState.channel),
        pixelGrid: viewerState.pixelGrid,
        clipping: viewerState.clipping,
        falseColor: viewerState.falseColor,
        bypass: viewerState.bypass,
        zoom: effectiveZoom,
        panX: viewerState.panX,
        panY: viewerState.panY,
      };
      for (const desc of visibleTiles) {
        const loaded = tileMapRef.current.get(desc.udim);
        if (!loaded || !loaded.texture) continue;
        const tileX = gridLeft + desc.u * cellPx;
        const tileY = gridBottom - (desc.v + 1) * cellPx;
        renderer.renderTileRect(
          viewportSize.width,
          viewportSize.height,
          loaded.texture,
          loaded.width,
          loaded.height,
          loaded.isFloat,
          tileX,
          tileY,
          cellPx,
          cellPx,
          uniforms,
        );
      }
    }

    // Draw UV tile grid overlay and tile numbers
    const ctx = hud.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, hud.width, hud.height);
    const tileSet = new Map(visibleTiles.map((t) => [t.udim, t]));

    ctx.font = '10px Consolas, monospace';
    for (let v = 0; v < gridRows; v++) {
      for (let u = 0; u < gridCols; u++) {
        const udim = 1001 + u + 10 * v;
        const rx = gridLeft + u * cellPx;
        const ry = gridBottom - (v + 1) * cellPx;
        const present = tileSet.has(udim);
        ctx.strokeStyle = present ? 'rgba(139, 92, 246, 0.72)' : 'rgba(100, 116, 139, 0.45)';
        ctx.lineWidth = 1;
        ctx.strokeRect(Math.round(rx) + 0.5, Math.round(ry) + 0.5, cellPx, cellPx);
        ctx.fillStyle = present ? '#E2E8F0' : '#94A3B8';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        ctx.fillText(present ? `${udim}` : `${udim} (empty)`, rx + 4, ry + 4);
      }
    }
  }, [
    viewportSize,
    viewerState,
    effectiveZoom,
    cellPx,
    gridLeft,
    gridBottom,
    gridCols,
    gridRows,
    visibleTiles,
    renderTick,
  ]);

  const samplePixel = (clientX: number, clientY: number) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const sx = clientX - rect.left;
    const sy = clientY - rect.top;
    const u = (sx - gridLeft) / cellPx;
    const v = (gridBottom - sy) / cellPx;
    const cu = Math.floor(u);
    const cv = Math.floor(v);
    if (cu < 0 || cv < 0 || cu >= 10) {
      setPixelReadout(null);
      return;
    }
    const udim = 1001 + cu + 10 * cv;
    const tile = tileMapRef.current.get(udim);
    if (!tile) {
      setPixelReadout({
        x: 0,
        y: 0,
        src: [0, 0, 0, 0],
        disp: [0, 0, 0, 0],
        hex: '#000000',
        udim,
        uv: [u, v],
      });
      return;
    }
    const ix = Math.max(0, Math.min(tile.width - 1, Math.floor((u - cu) * tile.width)));
    const iy = Math.max(0, Math.min(tile.height - 1, Math.floor((1 - (v - cv)) * tile.height)));
    const idx = (iy * tile.width + ix) * 4;
    const r = tile.floatData ? tile.floatData[idx]! : (tile.uint8Data?.[idx] ?? 0) / 255;
    const g = tile.floatData ? tile.floatData[idx + 1]! : (tile.uint8Data?.[idx + 1] ?? 0) / 255;
    const b = tile.floatData ? tile.floatData[idx + 2]! : (tile.uint8Data?.[idx + 2] ?? 0) / 255;
    const a = tile.floatData ? tile.floatData[idx + 3]! : (tile.uint8Data?.[idx + 3] ?? 255) / 255;
    const gain = viewerState.bypass ? 1 : 2 ** viewerState.exposure;
    const dr = Math.max(0, Math.min(255, Math.round(Math.min(1, r * gain) * 255)));
    const dg = Math.max(0, Math.min(255, Math.round(Math.min(1, g * gain) * 255)));
    const db = Math.max(0, Math.min(255, Math.round(Math.min(1, b * gain) * 255)));
    const hex = '#' + [dr, dg, db].map((c) => c.toString(16).padStart(2, '0').toUpperCase()).join('');
    setPixelReadout({
      x: ix,
      y: iy,
      src: [r, g, b, a],
      disp: [dr, dg, db, Math.round(a * 255)],
      hex,
      udim,
      uv: [u, v],
    });
  };

  const handleWheel = (e: WheelEvent<HTMLDivElement>) => {
    e.preventDefault();
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
    const nextZoom = Math.max(0.05, Math.min(64.0, effectiveZoom * factor));
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    const curCell = effectiveZoom * BASE_UV_CELL_PX;
    const nextCell = nextZoom * BASE_UV_CELL_PX;
    const u = (sx - gridLeft) / curCell;
    const v = (gridBottom - sy) / curCell;
    const nextGridLeft = sx - u * nextCell;
    const nextGridBottom = sy + v * nextCell;
    const nextPanX = nextGridLeft - viewportSize.width / 2 + (gridCols * nextCell) / 2;
    const nextPanY = nextGridBottom - viewportSize.height / 2 - (gridRows * nextCell) / 2;
    onUpdateState({ zoom: nextZoom, panX: nextPanX, panY: nextPanY });
  };

  const isPanMode = activeTool === 'pan' || spaceHeld;

  const handlePointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button === 1 || (e.button === 0 && isPanMode)) {
      panDragRef.current = {
        x: e.clientX,
        y: e.clientY,
        startPanX: viewerState.panX,
        startPanY: viewerState.panY,
      };
      e.currentTarget.setPointerCapture(e.pointerId);
    }
  };

  const handlePointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (panDragRef.current) {
      onUpdateState({
        panX: panDragRef.current.startPanX + (e.clientX - panDragRef.current.x),
        panY: panDragRef.current.startPanY + (e.clientY - panDragRef.current.y),
      });
      return;
    }
    samplePixel(e.clientX, e.clientY);
  };

  const handlePointerUp = (e: PointerEvent<HTMLDivElement>) => {
    panDragRef.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
  };

  return (
    <div
      ref={containerRef}
      data-ui="udim-mosaic-viewer"
      data-tool={isPanMode ? 'pan' : activeTool}
      data-bg={viewportBg}
      className="org-udimview"
      onWheel={handleWheel}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerLeave={() => setPixelReadout(null)}
    >
      <canvas ref={glCanvasRef} className="org-udimview__canvas" />
      <canvas ref={hudCanvasRef} className="org-udimview__hud" />

      <AnnotationLayer2D
        fileId={file.id}
        imgOriginX={gridLeft}
        imgOriginY={gridBottom}
        zoom={cellPx}
        viewportWidth={viewportSize.width}
        viewportHeight={viewportSize.height}
        interactive={!isPanMode}
        noteDraft={noteDraft}
        onNoteDraftChange={onNoteDraftChange}
        coordSpace="uv"
        yFlip
      />

      {loading && (
        <div className="org-udimview__overlay">
          <Spinner label="Loading UDIM mosaic" />
          <Text>Streaming {allTiles.length} UDIM tile(s)...</Text>
        </div>
      )}

      {loadError && (
        <div className="org-udimview__overlay">
          <Text variant="danger">{loadError}</Text>
        </div>
      )}
    </div>
  );
}
