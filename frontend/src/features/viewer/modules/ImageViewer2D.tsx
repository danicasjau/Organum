import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent,
  type WheelEvent,
} from 'react';
import {
  Banner,
  Spinner,
  Text,
  readCssToken,
} from '../../../components/ui';
import { apiClient, type FileSummaryOut, type InspectionDocument } from '../../../lib/api/client';
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
import './ImageViewer2D.css';

interface LoadedImageBuffer {
  width: number;
  height: number;
  isFloat: boolean;
  floatData: Float32Array | null;
  uint8Data: Uint8Array | null;
}

function computeImageHistogram(loaded: LoadedImageBuffer): ImageHistogramData {
  const bins = 64;
  const r = new Array<number>(bins).fill(0);
  const g = new Array<number>(bins).fill(0);
  const b = new Array<number>(bins).fill(0);
  const luma = new Array<number>(bins).fill(0);
  const totalPx = loaded.width * loaded.height;
  const stride = Math.max(1, Math.floor(totalPx / 65536));
  const data = loaded.isFloat ? loaded.floatData : loaded.uint8Data;
  if (!data) return { r, g, b, luma };
  const scale = loaded.isFloat ? 1.0 : 1.0 / 255.0;

  for (let p = 0; p < totalPx; p += stride) {
    const idx = p * 4;
    const rv = Math.max(0, Math.min(1, (data[idx] ?? 0) * scale));
    const gv = Math.max(0, Math.min(1, (data[idx + 1] ?? 0) * scale));
    const bv = Math.max(0, Math.min(1, (data[idx + 2] ?? 0) * scale));
    const yv = Math.max(0, Math.min(1, 0.2126 * rv + 0.7152 * gv + 0.0722 * bv));
    const ri = Math.min(bins - 1, Math.floor(rv * (bins - 1)));
    const gi = Math.min(bins - 1, Math.floor(gv * (bins - 1)));
    const bi = Math.min(bins - 1, Math.floor(bv * (bins - 1)));
    const yi = Math.min(bins - 1, Math.floor(yv * (bins - 1)));
    r[ri] = (r[ri] ?? 0) + 1;
    g[gi] = (g[gi] ?? 0) + 1;
    b[bi] = (b[bi] ?? 0) + 1;
    luma[yi] = (luma[yi] ?? 0) + 1;
  }
  return { r, g, b, luma };
}

function parseOrgfBuffer(buf: ArrayBuffer): LoadedImageBuffer {
  const dv = new DataView(buf);
  const magic = String.fromCharCode(
    dv.getUint8(0),
    dv.getUint8(1),
    dv.getUint8(2),
    dv.getUint8(3),
  );
  if (magic !== 'ORGF') throw new Error('Invalid ORGF float buffer');
  const width = dv.getUint32(4, true);
  const height = dv.getUint32(8, true);
  const floatData = new Float32Array(buf, 16, width * height * 4);
  return { width, height, isFloat: true, floatData, uint8Data: null };
}

async function decodeImageUrlToUint8(url: string): Promise<LoadedImageBuffer> {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Image fetch failed (${resp.status})`);
  const blob = await resp.blob();
  const bmp = await createImageBitmap(blob);
  const canvas = document.createElement('canvas');
  canvas.width = bmp.width;
  canvas.height = bmp.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D decode context unavailable');
  ctx.drawImage(bmp, 0, 0);
  const imgData = ctx.getImageData(0, 0, bmp.width, bmp.height);
  bmp.close();
  return {
    width: imgData.width,
    height: imgData.height,
    isFloat: false,
    floatData: null,
    uint8Data: new Uint8Array(imgData.data.buffer),
  };
}

export interface DirectImageBuffer {
  width: number;
  height: number;
  isFloat: boolean;
  floatData: Float32Array | null;
  uint8Data: Uint8Array | null;
}

export interface ImageViewer2DProps {
  file: FileSummaryOut;
  inspection: InspectionDocument;
  viewerState: PerFileViewerState;
  onUpdateState: (patch: Partial<PerFileViewerState>) => void;
  activeTool: AnnotationTool;
  noteDraft: string;
  onNoteDraftChange: (note: string) => void;
  directBuffer?: DirectImageBuffer | null;
  overrideArtifact?: { kind: string; params: Record<string, unknown> } | null;
  annotationCameraJson?: Record<string, unknown> | null;
}

export function ImageViewer2D({
  file,
  inspection,
  viewerState,
  onUpdateState,
  activeTool,
  noteDraft,
  onNoteDraftChange,
  directBuffer,
  overrideArtifact,
  annotationCameraJson,
}: ImageViewer2DProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const glCanvasRef = useRef<HTMLCanvasElement>(null);
  const hudCanvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<WebGL2ImageRenderer | null>(null);
  const bufferRef = useRef<LoadedImageBuffer | null>(null);

  const [viewportSize, setViewportSize] = useState({ width: 800, height: 500 });
  const [imgSize, setImgSize] = useState({ width: 1, height: 1 });
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [spaceHeld, setSpaceHeld] = useState(false);

  const panDragRef = useRef<{ x: number; y: number; startPanX: number; startPanY: number } | null>(
    null,
  );
  const roiStartRef = useRef<{ ix: number; iy: number } | null>(null);
  const [roiBox, setRoiBox] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(
    null,
  );

  const viewportBg = useViewerStore((s) => s.viewportBg);
  const setPixelReadout = useViewerStore((s) => s.setPixelReadout);
  const setRoiStats = useViewerStore((s) => s.setRoiStats);
  const setImageHistogram = useViewerStore((s) => s.setImageHistogram);

  // Track container size cleanly
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

  // Spacebar pan modifier
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

  // Initialize WebGL2 renderer once
  useEffect(() => {
    const canvas = glCanvasRef.current;
    if (!canvas) return;
    try {
      rendererRef.current = new WebGL2ImageRenderer(canvas);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'WebGL2 initialization failed');
    }
    const onLost = (e: Event) => {
      e.preventDefault();
      setLoadError('WebGL2 context lost');
    };
    canvas.addEventListener('webglcontextlost', onLost);
    return () => {
      canvas.removeEventListener('webglcontextlost', onLost);
      rendererRef.current?.dispose();
      rendererRef.current = null;
    };
  }, []);

  // Load image / float buffer / PSD layer / TIFF page / OIIO HDR-DPX-TX-TGA
  const partialNotice = inspection.metadata?.partial_support
    ? String(inspection.metadata.notice ?? 'Unsupported variant')
    : null;
  const animFrames = Number(inspection.summary?.frame_count ?? 1);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (partialNotice) {
        setLoading(false);
        setLoadError(null);
        setImageHistogram(null);
        return;
      }
      setLoading(true);
      setLoadError(null);
      try {
        const fmt = file.detected_format.toLowerCase();
        let loaded: LoadedImageBuffer;
        if (directBuffer) {
          loaded = directBuffer;
        } else if (overrideArtifact) {
          const art = await apiClient.createArtifact(
            file.id,
            overrideArtifact.kind,
            overrideArtifact.params,
          );
          loaded = await decodeImageUrlToUint8(art.content_url);
        } else if (fmt === 'exr') {
          const aovName = viewerState.activeAov ?? (inspection.aovs?.[0]?.name as string | undefined) ?? 'RGBA';
          const art = await apiClient.createArtifact(file.id, 'float_rgba', { aov: aovName });
          const resp = await fetch(art.content_url);
          if (!resp.ok) throw new Error(`Artifact fetch failed (${resp.status})`);
          loaded = parseOrgfBuffer(await resp.arrayBuffer());
        } else if (fmt === 'psd' || fmt === 'psb') {
          const params: Record<string, unknown> = {};
          if (viewerState.isolatedLayerId) params.isolate = viewerState.isolatedLayerId;
          else if (viewerState.hiddenLayerIds.length > 0) params.hidden_ids = viewerState.hiddenLayerIds;
          const art = await apiClient.createArtifact(file.id, 'layer_png', params);
          loaded = await decodeImageUrlToUint8(art.content_url);
        } else if (fmt === 'tif' || fmt === 'tiff') {
          const art = await apiClient.createArtifact(file.id, 'float_rgba', {
            page: viewerState.activePage,
          });
          const resp = await fetch(art.content_url);
          if (!resp.ok) throw new Error(`TIFF artifact fetch failed (${resp.status})`);
          loaded = parseOrgfBuffer(await resp.arrayBuffer());
        } else if (['hdr', 'pic', 'dpx', 'tx', 'tex', 'tga'].includes(fmt)) {
          const art = await apiClient.createArtifact(file.id, 'float_rgba', {
            mip: viewerState.activePage,
          });
          const resp = await fetch(art.content_url);
          if (!resp.ok) throw new Error(`OIIO float artifact fetch failed (${resp.status})`);
          loaded = parseOrgfBuffer(await resp.arrayBuffer());
        } else if (animFrames > 1 && viewerState.activePage > 0) {
          const art = await apiClient.createArtifact(file.id, 'float_rgba', {
            page: viewerState.activePage,
          });
          const resp = await fetch(art.content_url);
          if (!resp.ok) throw new Error(`Frame artifact fetch failed (${resp.status})`);
          loaded = parseOrgfBuffer(await resp.arrayBuffer());
        } else {
          loaded = await decodeImageUrlToUint8(apiClient.fileContentUrl(file.id));
        }

        if (cancelled) return;
        bufferRef.current = loaded;
        setImgSize({ width: loaded.width, height: loaded.height });
        setImageHistogram(computeImageHistogram(loaded));
        if (rendererRef.current) {
          if (loaded.isFloat && loaded.floatData) {
            rendererRef.current.setFloatRGBA(loaded.width, loaded.height, loaded.floatData);
          } else if (loaded.uint8Data) {
            rendererRef.current.setUint8RGBA(loaded.width, loaded.height, loaded.uint8Data);
          }
        }
      } catch (err) {
        if (!cancelled) {
          setLoadError(err instanceof Error ? err.message : 'Failed to load image');
          setImageHistogram(null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [
    file.id,
    file.detected_format,
    viewerState.activeAov,
    viewerState.isolatedLayerId,
    viewerState.hiddenLayerIds,
    viewerState.activePage,
    inspection.aovs,
    directBuffer,
    overrideArtifact,
    partialNotice,
    animFrames,
    setImageHistogram,
  ]);

  const computeEffectiveZoom = useCallback((): number => {
    if (viewerState.zoom > 0) return viewerState.zoom;
    const pad = 32;
    const zx = Math.max(0.05, (viewportSize.width - pad) / Math.max(1, imgSize.width));
    const zy = Math.max(0.05, (viewportSize.height - pad) / Math.max(1, imgSize.height));
    return Math.min(zx, zy, 1.0);
  }, [viewerState.zoom, viewportSize, imgSize]);

  const effectiveZoom = computeEffectiveZoom();
  const imgOriginX = viewportSize.width / 2 + viewerState.panX - (imgSize.width * effectiveZoom) / 2;
  const imgOriginY = viewportSize.height / 2 + viewerState.panY - (imgSize.height * effectiveZoom) / 2;

  // Render WebGL2 frame + 2D pixel value HUD (>= 2400%) + ROI marquee
  useEffect(() => {
    const canvas = glCanvasRef.current;
    const hud = hudCanvasRef.current;
    if (!canvas || !hud) return;
    canvas.width = viewportSize.width;
    canvas.height = viewportSize.height;
    hud.width = viewportSize.width;
    hud.height = viewportSize.height;

    if (rendererRef.current && bufferRef.current) {
      rendererRef.current.render(viewportSize.width, viewportSize.height, {
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
      });
    }

    const ctx = hud.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, hud.width, hud.height);

    // Draw per-pixel RGB values inside each pixel at >= 2400% zoom
    const buf = bufferRef.current;
    if (buf && effectiveZoom >= 24.0) {
      const startX = Math.max(0, Math.floor(-imgOriginX / effectiveZoom));
      const endX = Math.min(buf.width - 1, Math.ceil((viewportSize.width - imgOriginX) / effectiveZoom));
      const startY = Math.max(0, Math.floor(-imgOriginY / effectiveZoom));
      const endY = Math.min(buf.height - 1, Math.ceil((viewportSize.height - imgOriginY) / effectiveZoom));
      if ((endX - startX + 1) * (endY - startY + 1) <= 1500) {
        ctx.font = '10px Consolas, monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        for (let py = startY; py <= endY; py++) {
          for (let px = startX; px <= endX; px++) {
            const idx = (py * buf.width + px) * 4;
            const r = buf.floatData ? buf.floatData[idx]! : (buf.uint8Data?.[idx] ?? 0) / 255;
            const g = buf.floatData ? buf.floatData[idx + 1]! : (buf.uint8Data?.[idx + 1] ?? 0) / 255;
            const b = buf.floatData ? buf.floatData[idx + 2]! : (buf.uint8Data?.[idx + 2] ?? 0) / 255;
            const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
            ctx.fillStyle = luma > 0.5 ? '#111111' : '#f0f0f0'; // contrast against pixel content, not theme
            const cx = imgOriginX + (px + 0.5) * effectiveZoom;
            const cy = imgOriginY + (py + 0.5) * effectiveZoom;
            ctx.fillText(`${r.toFixed(2)}`, cx, cy - 10);
            ctx.fillText(`${g.toFixed(2)}`, cx, cy);
            ctx.fillText(`${b.toFixed(2)}`, cx, cy + 10);
          }
        }
      }
    }

    // Draw ROI box
    if (roiBox) {
      const sx = imgOriginX + Math.min(roiBox.x0, roiBox.x1) * effectiveZoom;
      const sy = imgOriginY + Math.min(roiBox.y0, roiBox.y1) * effectiveZoom;
      const sw = Math.abs(roiBox.x1 - roiBox.x0) * effectiveZoom;
      const sh = Math.abs(roiBox.y1 - roiBox.y0) * effectiveZoom;
      ctx.strokeStyle = readCssToken('--zone-focus', '#e8a33d');
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 2]);
      ctx.strokeRect(sx, sy, sw, sh);
      ctx.setLineDash([]);
    }
  }, [viewportSize, imgSize, viewerState, effectiveZoom, imgOriginX, imgOriginY, roiBox, loading]);

  const samplePixel = (clientX: number, clientY: number) => {
    const rect = containerRef.current?.getBoundingClientRect();
    const buf = bufferRef.current;
    if (!rect || !buf) return null;
    const sx = clientX - rect.left;
    const sy = clientY - rect.top;
    const ix = Math.floor((sx - imgOriginX) / effectiveZoom);
    const iy = Math.floor((sy - imgOriginY) / effectiveZoom);
    if (ix < 0 || iy < 0 || ix >= buf.width || iy >= buf.height) {
      setPixelReadout(null);
      return { ix, iy, inBounds: false };
    }
    const idx = (iy * buf.width + ix) * 4;
    const r = buf.floatData ? buf.floatData[idx]! : (buf.uint8Data?.[idx] ?? 0) / 255;
    const g = buf.floatData ? buf.floatData[idx + 1]! : (buf.uint8Data?.[idx + 1] ?? 0) / 255;
    const b = buf.floatData ? buf.floatData[idx + 2]! : (buf.uint8Data?.[idx + 2] ?? 0) / 255;
    const a = buf.floatData ? buf.floatData[idx + 3]! : (buf.uint8Data?.[idx + 3] ?? 255) / 255;

    const gain = viewerState.bypass ? 1 : 2 ** viewerState.exposure;
    const dr = Math.max(0, Math.min(255, Math.round(Math.min(1, r * gain) * 255)));
    const dg = Math.max(0, Math.min(255, Math.round(Math.min(1, g * gain) * 255)));
    const db = Math.max(0, Math.min(255, Math.round(Math.min(1, b * gain) * 255)));
    const hex =
      '#' +
      [dr, dg, db].map((v) => v.toString(16).padStart(2, '0').toUpperCase()).join('');

    setPixelReadout({
      x: ix,
      y: iy,
      src: [r, g, b, a],
      disp: [dr, dg, db, Math.round(a * 255)],
      hex,
    });
    return { ix, iy, inBounds: true };
  };

  const computeRoiStats = (x0: number, y0: number, x1: number, y1: number) => {
    const buf = bufferRef.current;
    if (!buf) return;
    const minX = Math.max(0, Math.min(x0, x1));
    const maxX = Math.min(buf.width - 1, Math.max(x0, x1));
    const minY = Math.max(0, Math.min(y0, y1));
    const maxY = Math.min(buf.height - 1, Math.max(y0, y1));
    if (maxX <= minX || maxY <= minY) return;

    const minV: [number, number, number] = [Infinity, Infinity, Infinity];
    const maxV: [number, number, number] = [-Infinity, -Infinity, -Infinity];
    const sum: [number, number, number] = [0, 0, 0];
    let count = 0;

    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const i = (y * buf.width + x) * 4;
        const r = buf.floatData ? buf.floatData[i]! : (buf.uint8Data?.[i] ?? 0) / 255;
        const g = buf.floatData ? buf.floatData[i + 1]! : (buf.uint8Data?.[i + 1] ?? 0) / 255;
        const b = buf.floatData ? buf.floatData[i + 2]! : (buf.uint8Data?.[i + 2] ?? 0) / 255;
        minV[0] = Math.min(minV[0], r);
        minV[1] = Math.min(minV[1], g);
        minV[2] = Math.min(minV[2], b);
        maxV[0] = Math.max(maxV[0], r);
        maxV[1] = Math.max(maxV[1], g);
        maxV[2] = Math.max(maxV[2], b);
        sum[0] += r;
        sum[1] += g;
        sum[2] += b;
        count++;
      }
    }
    if (count > 0) {
      setRoiStats({
        x: minX,
        y: minY,
        w: maxX - minX + 1,
        h: maxY - minY + 1,
        min: minV,
        max: maxV,
        mean: [sum[0] / count, sum[1] / count, sum[2] / count],
      });
    }
  };

  const handleWheel = (e: WheelEvent<HTMLDivElement>) => {
    e.preventDefault();
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
    const nextZoom = Math.max(0.05, Math.min(64.0, effectiveZoom * factor));

    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    const imgX = (sx - imgOriginX) / effectiveZoom;
    const imgY = (sy - imgOriginY) / effectiveZoom;

    const nextPanX = sx - viewportSize.width / 2 - (imgX - imgSize.width / 2) * nextZoom;
    const nextPanY = sy - viewportSize.height / 2 - (imgY - imgSize.height / 2) * nextZoom;
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
    } else if (e.button === 0 && e.altKey) {
      const hit = samplePixel(e.clientX, e.clientY);
      if (hit) {
        roiStartRef.current = { ix: hit.ix, iy: hit.iy };
        setRoiBox({ x0: hit.ix, y0: hit.iy, x1: hit.ix, y1: hit.iy });
        e.currentTarget.setPointerCapture(e.pointerId);
      }
    }
  };

  const handlePointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (panDragRef.current) {
      const dx = e.clientX - panDragRef.current.x;
      const dy = e.clientY - panDragRef.current.y;
      onUpdateState({
        panX: panDragRef.current.startPanX + dx,
        panY: panDragRef.current.startPanY + dy,
      });
      return;
    }
    const hit = samplePixel(e.clientX, e.clientY);
    if (roiStartRef.current && hit) {
      const next = { x0: roiStartRef.current.ix, y0: roiStartRef.current.iy, x1: hit.ix, y1: hit.iy };
      setRoiBox(next);
      computeRoiStats(next.x0, next.y0, next.x1, next.y1);
    }
  };

  const handlePointerUp = (e: PointerEvent<HTMLDivElement>) => {
    panDragRef.current = null;
    roiStartRef.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
  };

  return (
    <div
      ref={containerRef}
      data-ui="image-viewer-2d"
      data-tool={isPanMode ? 'pan' : activeTool}
      data-bg={viewportBg}
      className="org-viewer2d"
      onWheel={handleWheel}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerLeave={() => setPixelReadout(null)}
    >
      <canvas ref={glCanvasRef} className="org-viewer2d__canvas" />
      <canvas ref={hudCanvasRef} className="org-viewer2d__hud" />

      <AnnotationLayer2D
        fileId={file.id}
        imgOriginX={imgOriginX}
        imgOriginY={imgOriginY}
        zoom={effectiveZoom}
        viewportWidth={viewportSize.width}
        viewportHeight={viewportSize.height}
        interactive={!isPanMode}
        noteDraft={noteDraft}
        onNoteDraftChange={onNoteDraftChange}
        cameraJson={annotationCameraJson}
      />

      {partialNotice && (
        <div className="org-viewer2d__overlay">
          <Banner severity="warning" title="Partial / Unsupported Variant">
            {partialNotice}
          </Banner>
        </div>
      )}

      {loading && (
        <div className="org-viewer2d__overlay">
          <Spinner label="Decoding image" />
          <Text>Loading {file.filename}...</Text>
        </div>
      )}

      {loadError && (
        <div className="org-viewer2d__overlay">
          <Text variant="danger">{loadError}</Text>
        </div>
      )}
    </div>
  );
}
