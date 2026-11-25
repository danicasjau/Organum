import { useQuery } from '@tanstack/react-query';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent,
  type WheelEvent,
} from 'react';
import {
  AudioWaveformStrip,
  Spinner,
  Text,
  Timebar,
  TransportControls,
  type TimebarAnnotationMarker,
} from '../../../components/ui';
import {
  apiClient,
  isScenefilePreviewId,
  type FileSummaryOut,
  type InspectionDocument,
} from '../../../lib/api/client';
import { useProjectStore } from '../../project/projectStore';
import { AnnotationLayer2D } from '../AnnotationLayer2D';
import {
  useViewerStore,
  type AnnotationTool,
  type LoopMode,
  type PerFileViewerState,
} from '../viewerStore';
import {
  WebGL2ImageRenderer,
  mapChannelIndex,
  mapDisplayViewIndex,
  mapInputSpaceIndex,
} from '../webgl2Renderer';
import './VideoViewer.css';

interface VideoViewerProps {
  file: FileSummaryOut;
  inspection: InspectionDocument;
  viewerState: PerFileViewerState;
  onUpdateState: (patch: Partial<PerFileViewerState>) => void;
  activeTool: AnnotationTool;
  noteDraft: string;
  onNoteDraftChange: (note: string) => void;
}

export function VideoViewer({
  file,
  inspection,
  viewerState,
  onUpdateState,
  activeTool,
  noteDraft,
  onNoteDraftChange,
}: VideoViewerProps) {
  const isSequence = Boolean(file.is_sequence);
  const tl = (inspection.timeline ?? {}) as Record<string, unknown>;
  const startFrame = Number(tl.start ?? (isSequence ? (file.frame_start ?? 1) : 0));
  const endFrame = Math.max(
    startFrame,
    Number(tl.end ?? (isSequence ? (file.frame_end ?? startFrame) : 24)),
  );
  const fps = Math.max(1, Number(tl.fps ?? 24));
  const activeFrame = Math.max(startFrame, Math.min(endFrame, viewerState.currentFrame || startFrame));

  const stageRef = useRef<HTMLDivElement>(null);
  const glCanvasRef = useRef<HTMLCanvasElement>(null);
  const hudCanvasRef = useRef<HTMLCanvasElement>(null);
  const readbackCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const rendererRef = useRef<WebGL2ImageRenderer | null>(null);
  const seqCacheRef = useRef<Map<number, ImageBitmap>>(new Map());
  const panDragRef = useRef<{ x: number; y: number; startPanX: number; startPanY: number } | null>(
    null,
  );

  const [viewportSize, setViewportSize] = useState({ width: 800, height: 420 });
  const [mediaSize, setMediaSize] = useState({ width: 320, height: 180 });
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [proxyUrl, setProxyUrl] = useState<string | null>(null);
  const [peaks, setPeaks] = useState<Array<[number, number]>>([]);
  const [playState, setPlayState] = useState<'paused' | 'forward' | 'reverse'>('paused');
  const [pingDir, setPingDir] = useState<1 | -1>(1);
  const [muted, setMuted] = useState(false);
  const [spaceHeld, setSpaceHeld] = useState(false);
  const [cacheProgress, setCacheProgress] = useState(isSequence ? 0 : 1);
  const [frameTick, setFrameTick] = useState(0);

  const activeProjectUuid = useProjectStore((s) => s.activeProjectUuid);
  const viewportBg = useViewerStore((s) => s.viewportBg);
  const setPixelReadout = useViewerStore((s) => s.setPixelReadout);

  const { data: savedAnnotations = [] } = useQuery({
    queryKey: ['annotations', activeProjectUuid, file.id],
    queryFn: () => apiClient.listAnnotations(file.id, activeProjectUuid),
    enabled: Boolean(activeProjectUuid && file.id && !isScenefilePreviewId(file.id)),
  });

  const markers: TimebarAnnotationMarker[] = useMemo(
    () =>
      savedAnnotations
        .filter((a) => a.frame_in !== null && a.frame_in !== undefined)
        .map((a) => ({
          id: a.id,
          frameIn: a.frame_in!,
          frameOut: a.frame_out ?? a.frame_in!,
          label: a.note_text || undefined,
        })),
    [savedAnnotations],
  );

  // Measure stage
  useEffect(() => {
    const el = stageRef.current;
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

  // Init WebGL2 renderer
  useEffect(() => {
    const cv = glCanvasRef.current;
    if (!cv) return;
    try {
      rendererRef.current = new WebGL2ImageRenderer(cv);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'WebGL2 init failed');
    }
    return () => {
      rendererRef.current?.dispose();
      rendererRef.current = null;
    };
  }, []);

  // Load proxy / peaks (video) or reset sequence cache
  useEffect(() => {
    let cancelled = false;
    setPlayState('paused');
    setLoading(true);
    setLoadError(null);
    setPeaks([]);
    setProxyUrl(null);
    seqCacheRef.current.forEach((bmp) => bmp.close());
    seqCacheRef.current.clear();

    async function initMedia() {
      try {
        if (isSequence) {
          setCacheProgress(0);
          onUpdateState({ currentFrame: startFrame });
          const url = apiClient.sequenceFrameUrl(file.id, startFrame);
          const resp = await fetch(url);
          if (!resp.ok) throw new Error(`Sequence frame ${startFrame} failed (${resp.status})`);
          const bmp = await createImageBitmap(await resp.blob());
          if (cancelled) {
            bmp.close();
            return;
          }
          seqCacheRef.current.set(startFrame, bmp);
          setMediaSize({ width: bmp.width, height: bmp.height });
          rendererRef.current?.setDrawableSource(bmp, bmp.width, bmp.height);
          setCacheProgress(1 / Math.max(1, endFrame - startFrame + 1));
          setFrameTick((t) => t + 1);
          setLoading(false);
          return;
        }

        const proxyArt = await apiClient.createArtifact(file.id, 'proxy_video', {});
        if (cancelled) return;
        setProxyUrl(proxyArt.content_url);

        if (inspection.capabilities?.has_audio) {
          try {
            const pArt = await apiClient.createArtifact(file.id, 'waveform_peaks', {
              buckets: 400,
            });
            const pResp = await fetch(pArt.content_url);
            if (pResp.ok && !cancelled) {
              const pData = (await pResp.json()) as { peaks?: Array<[number, number]> };
              setPeaks(pData.peaks ?? []);
            }
          } catch {
            // peaks optional
          }
        }
      } catch (err) {
        if (!cancelled) {
          setLoadError(err instanceof Error ? err.message : 'Failed to prepare video proxy');
          setLoading(false);
        }
      }
    }

    void initMedia();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file.id, isSequence]);

  const computeEffectiveZoom = useCallback((): number => {
    if (viewerState.zoom > 0) return viewerState.zoom;
    const pad = 24;
    const zx = Math.max(0.05, (viewportSize.width - pad) / Math.max(1, mediaSize.width));
    const zy = Math.max(0.05, (viewportSize.height - pad) / Math.max(1, mediaSize.height));
    return Math.min(zx, zy, 2.0);
  }, [viewerState.zoom, viewportSize, mediaSize]);

  const effectiveZoom = computeEffectiveZoom();
  const imgOriginX = viewportSize.width / 2 + viewerState.panX - (mediaSize.width * effectiveZoom) / 2;
  const imgOriginY = viewportSize.height / 2 + viewerState.panY - (mediaSize.height * effectiveZoom) / 2;

  const renderGL = useCallback(() => {
    const canvas = glCanvasRef.current;
    const hud = hudCanvasRef.current;
    if (!canvas || !hud || !rendererRef.current) return;
    canvas.width = viewportSize.width;
    canvas.height = viewportSize.height;
    hud.width = viewportSize.width;
    hud.height = viewportSize.height;

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
  }, [viewportSize, viewerState, effectiveZoom]);

  // Re-render GL on state / zoom / frame ticks
  useEffect(() => {
    renderGL();
  }, [renderGL, frameTick]);

  // Video element events: upload current frame to GL
  const uploadVideoFrame = useCallback(() => {
    const v = videoRef.current;
    if (!v || v.readyState < 2 || !rendererRef.current) return;
    const w = v.videoWidth || 320;
    const h = v.videoHeight || 180;
    setMediaSize((prev) => (prev.width === w && prev.height === h ? prev : { width: w, height: h }));
    rendererRef.current.setDrawableSource(v, w, h);
    setFrameTick((t) => t + 1);
    setLoading(false);
  }, []);

  // Load sequence frame when activeFrame changes
  useEffect(() => {
    if (!isSequence) return;
    let cancelled = false;
    const cached = seqCacheRef.current.get(activeFrame);
    if (cached) {
      rendererRef.current?.setDrawableSource(cached, cached.width, cached.height);
      setMediaSize({ width: cached.width, height: cached.height });
      setFrameTick((t) => t + 1);
      return;
    }
    void (async () => {
      const url = apiClient.sequenceFrameUrl(file.id, activeFrame);
      const resp = await fetch(url);
      if (!resp.ok || cancelled) return;
      const bmp = await createImageBitmap(await resp.blob());
      if (cancelled) {
        bmp.close();
        return;
      }
      seqCacheRef.current.set(activeFrame, bmp);
      setCacheProgress(seqCacheRef.current.size / Math.max(1, endFrame - startFrame + 1));
      rendererRef.current?.setDrawableSource(bmp, bmp.width, bmp.height);
      setMediaSize({ width: bmp.width, height: bmp.height });
      setFrameTick((t) => t + 1);
    })();
    return () => {
      cancelled = true;
    };
  }, [isSequence, activeFrame, file.id, startFrame, endFrame]);

  const seekToFrame = useCallback(
    (frame: number) => {
      const clamped = Math.max(startFrame, Math.min(endFrame, Math.round(frame)));
      onUpdateState({ currentFrame: clamped });
      if (!isSequence && videoRef.current) {
        const targetSec = (clamped - startFrame) / fps;
        if (Math.abs(videoRef.current.currentTime - targetSec) > 0.004) {
          videoRef.current.currentTime = targetSec;
        }
      }
    },
    [startFrame, endFrame, fps, isSequence, onUpdateState],
  );

  // Sync video time updates / frame accuracy loop
  useEffect(() => {
    if (isSequence || playState !== 'forward') {
      if (videoRef.current && !videoRef.current.paused) videoRef.current.pause();
      return;
    }
    const v = videoRef.current;
    if (!v || !proxyUrl) return;
    v.muted = muted;
    v.playbackRate = viewerState.playbackSpeed;
    void v.play().catch(() => {
      v.muted = true;
      setMuted(true);
      void v.play().catch(() => undefined);
    });

    const lo = viewerState.inPoint ?? startFrame;
    const hi = viewerState.outPoint ?? endFrame;

    let handle = 0;
    const vWithRvfc = v as HTMLVideoElement & {
      requestVideoFrameCallback?: (cb: () => void) => number;
      cancelVideoFrameCallback?: (id: number) => void;
    };
    const tick = () => {
      uploadVideoFrame();
      const f = Math.round(v.currentTime * fps) + startFrame;
      if (f >= hi || v.ended) {
        if (viewerState.loopMode === 'once') {
          setPlayState('paused');
          seekToFrame(hi);
          return;
        } else if (viewerState.loopMode === 'pingpong') {
          v.pause();
          setPingDir(-1);
          setPlayState('reverse');
          return;
        } else {
          v.currentTime = (lo - startFrame) / fps;
        }
      } else {
        onUpdateState({ currentFrame: Math.max(startFrame, Math.min(endFrame, f)) });
      }
      if (vWithRvfc.requestVideoFrameCallback) {
        handle = vWithRvfc.requestVideoFrameCallback(tick);
      } else {
        handle = requestAnimationFrame(tick);
      }
    };

    if (vWithRvfc.requestVideoFrameCallback) {
      handle = vWithRvfc.requestVideoFrameCallback(tick);
    } else {
      handle = requestAnimationFrame(tick);
    }
    return () => {
      if (vWithRvfc.cancelVideoFrameCallback) vWithRvfc.cancelVideoFrameCallback(handle);
      else cancelAnimationFrame(handle);
      v.pause();
    };
  }, [
    isSequence,
    playState,
    proxyUrl,
    muted,
    viewerState.playbackSpeed,
    viewerState.loopMode,
    viewerState.inPoint,
    viewerState.outPoint,
    startFrame,
    endFrame,
    fps,
    uploadVideoFrame,
    onUpdateState,
    seekToFrame,
  ]);

  // Sequence forward/reverse & Video reverse timer loop
  useEffect(() => {
    const needsTimer = playState === 'reverse' || (isSequence && playState === 'forward');
    if (!needsTimer) return;
    const dir = playState === 'reverse' ? -1 : pingDir;
    const lo = viewerState.inPoint ?? startFrame;
    const hi = viewerState.outPoint ?? endFrame;
    const intervalMs = Math.max(16, Math.round(1000 / (fps * viewerState.playbackSpeed)));

    const timer = window.setInterval(() => {
      const next = activeFrame + dir;
      if (next < lo || next > hi) {
        if (viewerState.loopMode === 'once') {
          setPlayState('paused');
        } else if (viewerState.loopMode === 'pingpong') {
          if (dir < 0) {
            setPingDir(1);
            setPlayState('forward');
          } else {
            setPingDir(-1);
            setPlayState('reverse');
          }
        } else {
          seekToFrame(dir < 0 ? hi : lo);
        }
      } else {
        seekToFrame(next);
      }
    }, intervalMs);

    return () => window.clearInterval(timer);
  }, [
    isSequence,
    playState,
    pingDir,
    activeFrame,
    fps,
    viewerState.playbackSpeed,
    viewerState.loopMode,
    viewerState.inPoint,
    viewerState.outPoint,
    startFrame,
    endFrame,
    seekToFrame,
  ]);

  // External seek events + keyboard transport + Space pan
  useEffect(() => {
    const onSeekEvt = (ev: Event) => {
      const targetF = (ev as CustomEvent<number>).detail;
      if (typeof targetF === 'number') {
        setPlayState('paused');
        seekToFrame(targetF);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      const tag = document.activeElement?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (e.code === 'Space') {
        e.preventDefault();
        setSpaceHeld(true);
        setPlayState((p) => (p === 'paused' ? 'forward' : 'paused'));
        return;
      }
      const k = e.key.toLowerCase();
      if (k === 'j') {
        setPlayState('reverse');
      } else if (k === 'k') {
        setPlayState('paused');
      } else if (k === 'l') {
        setPlayState('forward');
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        setPlayState('paused');
        seekToFrame(activeFrame - (e.shiftKey ? 10 : 1));
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        setPlayState('paused');
        seekToFrame(activeFrame + (e.shiftKey ? 10 : 1));
      } else if (e.key === 'Home') {
        e.preventDefault();
        setPlayState('paused');
        seekToFrame(startFrame);
      } else if (e.key === 'End') {
        e.preventDefault();
        setPlayState('paused');
        seekToFrame(endFrame);
      } else if (k === 'i') {
        onUpdateState({ inPoint: activeFrame });
      } else if (k === 'o') {
        onUpdateState({ outPoint: activeFrame });
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') setSpaceHeld(false);
    };

    window.addEventListener('organum:seek-frame', onSeekEvt);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('organum:seek-frame', onSeekEvt);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [activeFrame, startFrame, endFrame, seekToFrame, onUpdateState]);

  const handleWheel = (e: WheelEvent<HTMLDivElement>) => {
    e.preventDefault();
    const rect = stageRef.current?.getBoundingClientRect();
    if (!rect) return;
    const factor = e.deltaY < 0 ? 1.2 : 1 / 1.2;
    const nextZoom = Math.max(0.05, Math.min(128, effectiveZoom * factor));
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    const ratio = nextZoom / effectiveZoom;
    const nextPanX = sx - viewportSize.width / 2 - (sx - imgOriginX) * ratio + (mediaSize.width * nextZoom) / 2;
    const nextPanY = sy - viewportSize.height / 2 - (sy - imgOriginY) * ratio + (mediaSize.height * nextZoom) / 2;
    onUpdateState({ zoom: nextZoom, panX: nextPanX, panY: nextPanY });
  };

  const sampleVideoPixel = (clientX: number, clientY: number) => {
    const rect = stageRef.current?.getBoundingClientRect();
    if (!rect) return;
    const ix = Math.floor((clientX - rect.left - imgOriginX) / effectiveZoom);
    const iy = Math.floor((clientY - rect.top - imgOriginY) / effectiveZoom);
    if (ix < 0 || iy < 0 || ix >= mediaSize.width || iy >= mediaSize.height) {
      setPixelReadout(null);
      return;
    }
    const rb = readbackCanvasRef.current ?? document.createElement('canvas');
    readbackCanvasRef.current = rb;
    if (rb.width !== mediaSize.width || rb.height !== mediaSize.height) {
      rb.width = mediaSize.width;
      rb.height = mediaSize.height;
    }
    const rctx = rb.getContext('2d', { willReadFrequently: true });
    if (!rctx) return;
    const src = isSequence ? seqCacheRef.current.get(activeFrame) : videoRef.current;
    if (!src) return;
    rctx.drawImage(src, 0, 0, mediaSize.width, mediaSize.height);
    const px = rctx.getImageData(ix, iy, 1, 1).data;
    const r = (px[0] ?? 0) / 255;
    const g = (px[1] ?? 0) / 255;
    const b = (px[2] ?? 0) / 255;
    const hex = `#${[px[0] ?? 0, px[1] ?? 0, px[2] ?? 0].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
    setPixelReadout({ x: ix, y: iy, src: [r, g, b, 1], disp: [r, g, b, 1], hex });
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
    if (playState === 'paused') sampleVideoPixel(e.clientX, e.clientY);
  };

  const handlePointerUp = (e: PointerEvent<HTMLDivElement>) => {
    panDragRef.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
  };

  const cycleLoop = () => {
    const order: LoopMode[] = ['loop', 'once', 'pingpong'];
    const next = order[(order.indexOf(viewerState.loopMode) + 1) % order.length]!;
    onUpdateState({ loopMode: next });
  };

  return (
    <div data-ui="video-viewer" className="org-videoview">
      <div
        ref={stageRef}
        data-tool={isPanMode ? 'pan' : activeTool}
        data-bg={viewportBg}
        className="org-videoview__stage"
        onWheel={handleWheel}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={() => setPixelReadout(null)}
      >
        {!isSequence && proxyUrl && (
          <video
            ref={videoRef}
            src={proxyUrl}
            playsInline
            muted={muted}
            crossOrigin="anonymous"
            preload="auto"
            className="org-videoview__media"
            onLoadedData={uploadVideoFrame}
            onSeeked={uploadVideoFrame}
            onError={() => setLoadError('Video stream decode failed')}
          />
        )}
        <canvas ref={glCanvasRef} className="org-videoview__canvas" />
        <canvas ref={hudCanvasRef} className="org-videoview__hud" />

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
          isTimeBased
          currentFrame={activeFrame}
          frameRate={fps}
        />

        {loading && (
          <div className="org-videoview__overlay">
            <Spinner label="Decoding video" />
            <Text>Preparing {isSequence ? 'sequence' : 'video proxy'}...</Text>
          </div>
        )}
        {loadError && (
          <div className="org-videoview__overlay">
            <Text variant="danger">{loadError}</Text>
          </div>
        )}
      </div>

      {peaks.length > 0 && (
        <AudioWaveformStrip
          peaks={peaks}
          startFrame={startFrame}
          endFrame={endFrame}
          currentFrame={activeFrame}
          onSeek={(f) => {
            setPlayState('paused');
            seekToFrame(f);
          }}
        />
      )}

      <Timebar
        startFrame={startFrame}
        endFrame={endFrame}
        currentFrame={activeFrame}
        fps={fps}
        inPoint={viewerState.inPoint}
        outPoint={viewerState.outPoint}
        cacheProgress={cacheProgress}
        markers={markers}
        onSeek={(f) => {
          setPlayState('paused');
          seekToFrame(f);
        }}
      />

      <TransportControls
        playState={playState}
        currentFrame={activeFrame}
        startFrame={startFrame}
        endFrame={endFrame}
        fps={fps}
        loopMode={viewerState.loopMode}
        speed={viewerState.playbackSpeed}
        inPoint={viewerState.inPoint}
        outPoint={viewerState.outPoint}
        muted={muted}
        showMute={!isSequence && Boolean(inspection.capabilities?.has_audio)}
        onGoStart={() => {
          setPlayState('paused');
          seekToFrame(startFrame);
        }}
        onStepBack={() => {
          setPlayState('paused');
          seekToFrame(activeFrame - 1);
        }}
        onPlayReverse={() => {
          setMuted(true);
          setPlayState('reverse');
        }}
        onPause={() => setPlayState('paused')}
        onPlayForward={() => setPlayState('forward')}
        onStepForward={() => {
          setPlayState('paused');
          seekToFrame(activeFrame + 1);
        }}
        onGoEnd={() => {
          setPlayState('paused');
          seekToFrame(endFrame);
        }}
        onSeek={(f) => {
          setPlayState('paused');
          seekToFrame(f);
        }}
        onCycleLoop={cycleLoop}
        onChangeSpeed={(playbackSpeed) => onUpdateState({ playbackSpeed })}
        onSetIn={() => onUpdateState({ inPoint: activeFrame })}
        onSetOut={() => onUpdateState({ outPoint: activeFrame })}
        onToggleMute={() => setMuted((m) => !m)}
      />
    </div>
  );
}

