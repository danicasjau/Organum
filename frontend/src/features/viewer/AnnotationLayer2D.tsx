import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent,
} from 'react';
import { apiClient, isScenefilePreviewId, type AnnotationOut } from '../../lib/api/client';
import { useProjectStore } from '../project/projectStore';
import { useViewerStore } from './viewerStore';
import './AnnotationLayer2D.css';

export interface VectorStroke {
  id: string;
  tool: 'free' | 'closed' | 'rect' | 'ellipse';
  color: string;
  size: number;
  closedFill?: boolean;
  points: Array<[number, number]>;
}

interface LaserStroke {
  points: Array<[number, number]>;
  color: string;
  size: number;
  createdAt: number;
}

const LASER_DURATION_MS = 1500;

function distToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(px - ax, py - ay);
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lenSq));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function hitTestStroke(stroke: VectorStroke, x: number, y: number, threshold: number): boolean {
  if (stroke.points.length === 0) return false;
  if (stroke.tool === 'rect' && stroke.points.length >= 2) {
    const [x0, y0] = stroke.points[0]!;
    const [x1, y1] = stroke.points[1]!;
    const minX = Math.min(x0, x1) - threshold;
    const maxX = Math.max(x0, x1) + threshold;
    const minY = Math.min(y0, y1) - threshold;
    const maxY = Math.max(y0, y1) + threshold;
    return x >= minX && x <= maxX && y >= minY && y <= maxY;
  }
  for (let i = 0; i < stroke.points.length; i++) {
    const a = stroke.points[i]!;
    const b = stroke.points[Math.min(i + 1, stroke.points.length - 1)]!;
    if (distToSegment(x, y, a[0], a[1], b[0], b[1]) <= threshold) return true;
  }
  return false;
}

function isAnnVisibleAtFrame(ann: AnnotationOut, currentFrame: number): boolean {
  if (ann.frame_in === null || ann.frame_in === undefined) return true;
  const fOut = ann.frame_out ?? ann.frame_in;
  return currentFrame >= ann.frame_in && currentFrame <= fOut;
}

export interface AnnotationLayer2DProps {
  fileId: string;
  imgOriginX: number;
  imgOriginY: number;
  zoom: number;
  viewportWidth: number;
  viewportHeight: number;
  interactive: boolean;
  noteDraft: string;
  onNoteDraftChange: (note: string) => void;
  cameraJson?: Record<string, unknown> | null;
  isTimeBased?: boolean;
  currentFrame?: number;
  frameRate?: number;
  coordSpace?: 'image' | 'uv';
  yFlip?: boolean;
}

export function AnnotationLayer2D({
  fileId,
  imgOriginX,
  imgOriginY,
  zoom,
  viewportWidth,
  viewportHeight,
  interactive,
  noteDraft,
  onNoteDraftChange,
  cameraJson,
  isTimeBased = false,
  currentFrame = 0,
  frameRate = 24,
  coordSpace = 'image',
  yFlip = false,
}: AnnotationLayer2DProps) {
  const queryClient = useQueryClient();
  const activeProjectUuid = useProjectStore((s) => s.activeProjectUuid);
  const activeTool = useViewerStore((s) => s.activeTool);
  const strokeColor = useViewerStore((s) => s.strokeColor);
  const strokeSize = useViewerStore((s) => s.strokeSize);
  const closedFill = useViewerStore((s) => s.closedFill);
  const showAnnotations = useViewerStore((s) => s.showAnnotations);
  const setSaveStatus = useViewerStore((s) => s.setSaveStatus);
  const ghostNeighbors = useViewerStore((s) => s.ghostNeighbors);

  const { data: savedList = [], isFetching } = useQuery({
    queryKey: ['annotations', activeProjectUuid, fileId],
    queryFn: () => apiClient.listAnnotations(fileId, activeProjectUuid),
    enabled: Boolean(activeProjectUuid && fileId && !isScenefilePreviewId(fileId)),
  });

  const [activeAnnId, setActiveAnnId] = useState<string | null>(null);
  const [strokes, setStrokes] = useState<VectorStroke[]>([]);
  const [undoStack, setUndoStack] = useState<VectorStroke[][]>([]);
  const [redoStack, setRedoStack] = useState<VectorStroke[][]>([]);
  const [draftStroke, setDraftStroke] = useState<VectorStroke | null>(null);

  const laserCanvasRef = useRef<HTMLCanvasElement>(null);
  const laserStrokesRef = useRef<LaserStroke[]>([]);
  const activeLaserRef = useRef<LaserStroke | null>(null);
  const activeAnnIdRef = useRef<string | null>(null);
  activeAnnIdRef.current = activeAnnId;
  const autosaveTimerRef = useRef<number | null>(null);
  const hydratedFileRef = useRef<string | null>(null);
  const savingRef = useRef(false);

  const toScreenX = useCallback((ix: number) => imgOriginX + ix * zoom, [imgOriginX, zoom]);
  const toScreenY = useCallback(
    (iy: number) => (yFlip ? imgOriginY - iy * zoom : imgOriginY + iy * zoom),
    [imgOriginY, zoom, yFlip],
  );

  // Sync loaded server annotations into active stroke session on file switch
  useEffect(() => {
    hydratedFileRef.current = null;
    activeAnnIdRef.current = null;
    setActiveAnnId(null);
    setStrokes([]);
    onNoteDraftChange('');
    setUndoStack([]);
    setRedoStack([]);
    setSaveStatus('idle');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fileId]);

  useEffect(() => {
    if (isFetching || savingRef.current || !activeAnnId) return;
    if (!savedList.some((a) => a.id === activeAnnId)) {
      activeAnnIdRef.current = null;
      setActiveAnnId(null);
      setStrokes([]);
      onNoteDraftChange('');
      hydratedFileRef.current = fileId;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedList, isFetching, activeAnnId, fileId]);

  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      const st = useViewerStore.getState().saveStatus;
      if (st === 'saving' || st === 'error') {
        e.preventDefault();
      }
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, []);

  const persistNow = useCallback(
    async (nextStrokes: VectorStroke[], nextNote: string, currentAnnId: string | null) => {
      if (nextStrokes.length === 0 && !nextNote.trim() && !currentAnnId) return;
      savingRef.current = true;
      setSaveStatus('saving');
      try {
        const st = useViewerStore.getState();
        const frameIn = isTimeBased
          ? st.annotationScope === 'range'
            ? st.annotationFrameIn
            : currentFrame
          : undefined;
        const frameOut = isTimeBased
          ? st.annotationScope === 'range'
            ? st.annotationFrameOut
            : currentFrame
          : undefined;

        let saved: AnnotationOut;
        if (currentAnnId) {
          saved = await apiClient.updateAnnotation(
            fileId,
            currentAnnId,
            {
              note_text: nextNote,
              vector_json: nextStrokes as unknown as Array<Record<string, unknown>>,
              ...(isTimeBased ? { frame_in: frameIn, frame_out: frameOut, time_base: frameRate } : {}),
            },
            activeProjectUuid,
          );
        } else {
          saved = await apiClient.createAnnotation(
            fileId,
            {
              kind: '2d',
              coord_space: coordSpace,
              note_text: nextNote,
              vector_json: nextStrokes as unknown as Array<Record<string, unknown>>,
              camera_json: cameraJson ?? undefined,
              ...(isTimeBased ? { frame_in: frameIn, frame_out: frameOut, time_base: frameRate } : {}),
            },
            activeProjectUuid,
          );
          hydratedFileRef.current = fileId;
          activeAnnIdRef.current = saved.id;
          setActiveAnnId(saved.id);
        }
        await queryClient.refetchQueries({ queryKey: ['annotations', activeProjectUuid, fileId] });
        setSaveStatus('saved');
      } catch (err) {
        setSaveStatus('error', err instanceof Error ? err.message : 'Autosave failed');
      } finally {
        savingRef.current = false;
      }
    },
    [
      activeProjectUuid,
      coordSpace,
      fileId,
      queryClient,
      setSaveStatus,
      cameraJson,
      isTimeBased,
      currentFrame,
      frameRate,
    ],
  );

  const scheduleAutosave = useCallback(
    (nextStrokes: VectorStroke[], nextNote: string) => {
      if (autosaveTimerRef.current) window.clearTimeout(autosaveTimerRef.current);
      setSaveStatus('saving');
      autosaveTimerRef.current = window.setTimeout(() => {
        void persistNow(nextStrokes, nextNote, activeAnnIdRef.current);
      }, 450);
    },
    [persistNow, setSaveStatus],
  );

  useEffect(() => {
    const activeAnn = savedList.find((a) => a.id === activeAnnId);
    const baselineNote = activeAnn?.note_text ?? '';
    if (noteDraft !== baselineNote && (strokes.length > 0 || noteDraft.trim().length > 0 || activeAnnId)) {
      scheduleAutosave(strokes, noteDraft);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [noteDraft]);

  useEffect(() => {
    const onSubmitAnn = async (e: Event) => {
      const ce = e as CustomEvent<{ handled?: boolean }>;
      if (ce.detail) ce.detail.handled = true;
      if (autosaveTimerRef.current) {
        window.clearTimeout(autosaveTimerRef.current);
        autosaveTimerRef.current = null;
      }
      if (strokes.length === 0 && !noteDraft.trim() && !activeAnnIdRef.current) return;
      await persistNow(strokes, noteDraft, activeAnnIdRef.current);
      activeAnnIdRef.current = null;
      setActiveAnnId(null);
      setStrokes([]);
      setUndoStack([]);
      setRedoStack([]);
      onNoteDraftChange('');
      hydratedFileRef.current = fileId;
    };
    window.addEventListener('organum:submit-annotation', onSubmitAnn);
    return () => window.removeEventListener('organum:submit-annotation', onSubmitAnn);
  }, [fileId, strokes, noteDraft, persistNow, onNoteDraftChange]);

  useEffect(() => {
    const onUndo = () => {
      if (undoStack.length === 0) return;
      const prev = undoStack[undoStack.length - 1]!;
      setRedoStack((r) => [...r, strokes]);
      setUndoStack((u) => u.slice(0, -1));
      setStrokes(prev);
      scheduleAutosave(prev, noteDraft);
    };
    const onRedo = () => {
      if (redoStack.length === 0) return;
      const next = redoStack[redoStack.length - 1]!;
      setUndoStack((u) => [...u, strokes]);
      setRedoStack((r) => r.slice(0, -1));
      setStrokes(next);
      scheduleAutosave(next, noteDraft);
    };
    const onClear = () => {
      setUndoStack((u) => [...u, strokes]);
      setRedoStack([]);
      setStrokes([]);
      scheduleAutosave([], noteDraft);
    };
    window.addEventListener('organum:undo', onUndo);
    window.addEventListener('organum:redo', onRedo);
    window.addEventListener('organum:clear-strokes', onClear);
    return () => {
      window.removeEventListener('organum:undo', onUndo);
      window.removeEventListener('organum:redo', onRedo);
      window.removeEventListener('organum:clear-strokes', onClear);
    };
  }, [undoStack, redoStack, strokes, noteDraft, scheduleAutosave]);

  useEffect(() => {
    let rafId = 0;
    const draw = () => {
      const canvas = laserCanvasRef.current;
      if (canvas) {
        canvas.width = viewportWidth;
        canvas.height = viewportHeight;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.clearRect(0, 0, canvas.width, canvas.height);
          const now = performance.now();
          laserStrokesRef.current = laserStrokesRef.current.filter(
            (ls) => now - ls.createdAt < LASER_DURATION_MS,
          );
          const all = activeLaserRef.current
            ? [...laserStrokesRef.current, activeLaserRef.current]
            : laserStrokesRef.current;
          for (const ls of all) {
            if (ls.points.length < 2) continue;
            const age = now - ls.createdAt;
            const alpha = Math.max(0, 1 - age / LASER_DURATION_MS);
            ctx.save();
            ctx.globalAlpha = alpha;
            ctx.strokeStyle = ls.color;
            ctx.lineWidth = ls.size;
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';
            ctx.beginPath();
            ls.points.forEach(([ix, iy], idx) => {
              const sx = toScreenX(ix);
              const sy = toScreenY(iy);
              if (idx === 0) ctx.moveTo(sx, sy);
              else ctx.lineTo(sx, sy);
            });
            ctx.stroke();
            ctx.restore();
          }
        }
      }
      if (laserStrokesRef.current.length > 0 || activeLaserRef.current) {
        rafId = requestAnimationFrame(draw);
      }
    };
    if (laserStrokesRef.current.length > 0 || activeLaserRef.current) {
      rafId = requestAnimationFrame(draw);
    }
    return () => cancelAnimationFrame(rafId);
  });

  const toStoredCoords = (e: PointerEvent<SVGSVGElement>): [number, number] => {
    const rect = e.currentTarget.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    const x = (sx - imgOriginX) / zoom;
    const y = yFlip ? (imgOriginY - sy) / zoom : (sy - imgOriginY) / zoom;
    return [x, y];
  };

  const handlePointerDown = (e: PointerEvent<SVGSVGElement>) => {
    if (!interactive || e.button !== 0 || e.altKey) return;
    e.stopPropagation();
    const pt = toStoredCoords(e);
    e.currentTarget.setPointerCapture(e.pointerId);

    if (activeTool === 'laser') {
      activeLaserRef.current = {
        points: [pt],
        color: '#EF4444',
        size: Math.max(2, strokeSize),
        createdAt: performance.now(),
      };
      setDraftStroke((d) => d);
      return;
    }

    if (activeTool === 'eraser') {
      const hitIdx = strokes.findIndex((s) => hitTestStroke(s, pt[0], pt[1], 10 / zoom));
      if (hitIdx >= 0) {
        const next = strokes.filter((_, i) => i !== hitIdx);
        setUndoStack((u) => [...u, strokes]);
        setRedoStack([]);
        setStrokes(next);
        scheduleAutosave(next, noteDraft);
      }
      return;
    }

    if (
      activeTool === 'free' ||
      activeTool === 'closed' ||
      activeTool === 'rect' ||
      activeTool === 'ellipse'
    ) {
      setDraftStroke({
        id: `s_${Date.now()}`,
        tool: activeTool,
        color: strokeColor,
        size: strokeSize,
        closedFill: activeTool === 'closed' ? closedFill : false,
        points: [pt],
      });
    }
  };

  const handlePointerMove = (e: PointerEvent<SVGSVGElement>) => {
    if (!interactive) return;
    const pt = toStoredCoords(e);

    if (activeTool === 'laser' && activeLaserRef.current) {
      activeLaserRef.current.points.push(pt);
      activeLaserRef.current.createdAt = performance.now();
      return;
    }

    if (!draftStroke) return;
    if (draftStroke.tool === 'rect' || draftStroke.tool === 'ellipse') {
      setDraftStroke({ ...draftStroke, points: [draftStroke.points[0]!, pt] });
    } else {
      setDraftStroke({ ...draftStroke, points: [...draftStroke.points, pt] });
    }
  };

  const handlePointerUp = (e: PointerEvent<SVGSVGElement>) => {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }

    if (activeTool === 'laser' && activeLaserRef.current) {
      laserStrokesRef.current.push({ ...activeLaserRef.current, createdAt: performance.now() });
      activeLaserRef.current = null;
      return;
    }

    if (!draftStroke) return;
    if (draftStroke.points.length >= 2) {
      const next = [...strokes, draftStroke];
      setUndoStack((u) => [...u, strokes]);
      setRedoStack([]);
      setStrokes(next);
      scheduleAutosave(next, noteDraft);
    }
    setDraftStroke(null);
  };

  const renderShape = (s: VectorStroke) => {
    if (s.points.length === 0) return null;
    if (s.tool === 'rect' && s.points.length >= 2) {
      const p0 = s.points[0]!;
      const p1 = s.points[1]!;
      const sx0 = toScreenX(p0[0]);
      const sy0 = toScreenY(p0[1]);
      const sx1 = toScreenX(p1[0]);
      const sy1 = toScreenY(p1[1]);
      return (
        <rect
          key={s.id}
          x={Math.min(sx0, sx1)}
          y={Math.min(sy0, sy1)}
          width={Math.abs(sx1 - sx0)}
          height={Math.abs(sy1 - sy0)}
          stroke={s.color}
          strokeWidth={s.size}
          fill="none"
        />
      );
    }
    if (s.tool === 'ellipse' && s.points.length >= 2) {
      const p0 = s.points[0]!;
      const p1 = s.points[1]!;
      const sx0 = toScreenX(p0[0]);
      const sy0 = toScreenY(p0[1]);
      const sx1 = toScreenX(p1[0]);
      const sy1 = toScreenY(p1[1]);
      return (
        <ellipse
          key={s.id}
          cx={(sx0 + sx1) / 2}
          cy={(sy0 + sy1) / 2}
          rx={Math.abs(sx1 - sx0) * 0.5}
          ry={Math.abs(sy1 - sy0) * 0.5}
          stroke={s.color}
          strokeWidth={s.size}
          fill="none"
        />
      );
    }
    const ptsAttr = s.points
      .map(([ix, iy]) => `${toScreenX(ix).toFixed(1)},${toScreenY(iy).toFixed(1)}`)
      .join(' ');
    if (s.tool === 'closed') {
      return (
        <polygon
          key={s.id}
          points={ptsAttr}
          stroke={s.color}
          strokeWidth={s.size}
          fill={s.closedFill ? s.color : 'none'}
          fillOpacity={s.closedFill ? 0.2 : 0}
          strokeLinejoin="round"
        />
      );
    }
    return (
      <polyline
        key={s.id}
        points={ptsAttr}
        stroke={s.color}
        strokeWidth={s.size}
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    );
  };

  return (
    <>
      <svg
        data-ui="annotation-layer-2d"
        data-coord-space={coordSpace}
        data-interactive={interactive ? 'true' : 'false'}
        className="org-anno2d__svg"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
      >
        {showAnnotations &&
          savedList
            .filter(
              (ann) =>
                ann.kind === '2d' &&
                ann.id !== activeAnnId &&
                isAnnVisibleAtFrame(ann, currentFrame),
            )
            .map((ann) => (
              <g key={ann.id}>
                {((ann.vector_json as unknown as VectorStroke[]) ?? []).map(renderShape)}
              </g>
            ))}
        {showAnnotations &&
          isTimeBased &&
          ghostNeighbors &&
          savedList
            .filter(
              (ann) =>
                ann.kind === '2d' &&
                ann.id !== activeAnnId &&
                !isAnnVisibleAtFrame(ann, currentFrame),
            )
            .map((ann) => (
              <g key={`ghost-${ann.id}`} opacity={0.3}>
                {((ann.vector_json as unknown as VectorStroke[]) ?? []).map(renderShape)}
              </g>
            ))}
        {showAnnotations && strokes.map(renderShape)}
        {draftStroke && renderShape(draftStroke)}
      </svg>
      <canvas ref={laserCanvasRef} className="org-anno2d__laser" />
    </>
  );
}
