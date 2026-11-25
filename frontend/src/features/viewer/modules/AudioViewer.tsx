import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent, type WheelEvent } from 'react';
import {
  Badge,
  Button,
  Spinner,
  Text,
  Timebar,
  TransportControls,
  type TimebarAnnotationMarker,
} from '../../../components/ui';
import { useCssVarRef } from '../../../components/ui/_internal/useCssVar';
import {
  apiClient,
  isScenefilePreviewId,
  type FileSummaryOut,
  type InspectionDocument,
} from '../../../lib/api/client';
import { useProjectStore } from '../../project/projectStore';
import { useViewerStore, type AnnotationTool, type LoopMode, type PerFileViewerState } from '../viewerStore';
import './AudioViewer.css';

interface WaveformPayload {
  sampleRate: number;
  channels: number;
  totalSamples: number;
  duration: number;
  buckets: number;
  channelPeaks: Array<Array<[number, number]>>;
  peaks: Array<[number, number]>;
  spectrogram: number[][];
}

interface AudioViewerProps {
  file: FileSummaryOut;
  inspection: InspectionDocument;
  viewerState: PerFileViewerState;
  onUpdateState: (patch: Partial<PerFileViewerState>) => void;
  activeTool: AnnotationTool;
  noteDraft: string;
  onNoteDraftChange: (note: string) => void;
}

export function AudioViewer({
  file,
  inspection,
  viewerState,
  onUpdateState,
  noteDraft,
  onNoteDraftChange,
}: AudioViewerProps) {
  const queryClient = useQueryClient();
  const activeProjectUuid = useProjectStore((s) => s.activeProjectUuid);
  const tl = (inspection.timeline ?? {}) as Record<string, unknown>;
  const fps = Number(tl.fps ?? 24);
  const startFrame = Number(tl.start ?? 0);
  const endFrame = Math.max(startFrame + 1, Number(tl.end ?? 24));
  const activeFrame = Math.max(startFrame, Math.min(endFrame, viewerState.currentFrame || startFrame));

  const stageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const meterLRef = useRef<HTMLDivElement>(null);
  const meterRRef = useRef<HTMLDivElement>(null);

  const [waveData, setWaveData] = useState<WaveformPayload | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showSpec, setShowSpec] = useState(false);
  const [playState, setPlayState] = useState<'paused' | 'forward' | 'reverse'>('paused');
  const [viewNorm, setViewNorm] = useState<[number, number]>([0, 1]);
  const [dragRegion, setDragRegion] = useState<[number, number] | null>(null);
  const [meterLevel, setMeterLevel] = useState<[number, number]>([0.12, 0.12]);

  const viewportBg = useViewerStore((s) => s.viewportBg);
  const setSaveStatus = useViewerStore((s) => s.setSaveStatus);
  const setAnnotationFrameRange = useViewerStore((s) => s.setAnnotationFrameRange);

  useCssVarRef(meterLRef, '--meter-pct', `${Math.round(meterLevel[0] * 100)}%`);
  useCssVarRef(meterRRef, '--meter-pct', `${Math.round(meterLevel[1] * 100)}%`);

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

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setPlayState('paused');
    setViewNorm([0, 1]);

    async function loadAudio() {
      try {
        const [peaksArt, proxyArt] = await Promise.all([
          apiClient.createArtifact(file.id, 'waveform_peaks', { buckets: 800 }),
          apiClient.createArtifact(file.id, 'audio_proxy', {}),
        ]);
        const pResp = await fetch(peaksArt.content_url);
        if (!pResp.ok) throw new Error('Waveform decode failed');
        const payload = (await pResp.json()) as WaveformPayload;
        if (!cancelled) {
          setWaveData(payload);
          setAudioUrl(proxyArt.content_url);
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Audio load failed');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void loadAudio();
    return () => {
      cancelled = true;
    };
  }, [file.id]);

  // Submit audio annotation
  useEffect(() => {
    const onSubmit = async (ev: Event) => {
      const ce = ev as CustomEvent<{ handled?: boolean }>;
      if (ce.detail) ce.detail.handled = true;
      if (!noteDraft.trim() && !dragRegion) return;
      const fIn = dragRegion ? Math.min(dragRegion[0], dragRegion[1]) : activeFrame;
      const fOut = dragRegion ? Math.max(dragRegion[0], dragRegion[1]) : activeFrame;
      setSaveStatus('saving');
      try {
        await apiClient.createAnnotation(file.id, {
          kind: 'audio',
          frame_in: fIn,
          frame_out: fOut,
          time_base: fps,
          note_text: noteDraft.trim() || `Audio range F${fIn}–F${fOut}`,
          vector_json: [{ type: 'audio_range', frameIn: fIn, frameOut: fOut }],
        });
        await queryClient.refetchQueries({
          queryKey: ['annotations', activeProjectUuid, file.id],
        });
        setSaveStatus('saved');
        onNoteDraftChange('');
        setDragRegion(null);
      } catch (err) {
        setSaveStatus('error', err instanceof Error ? err.message : 'Audio annotation save failed');
      }
    };
    window.addEventListener('organum:submit-annotation', onSubmit);
    return () => window.removeEventListener('organum:submit-annotation', onSubmit);
  }, [
    activeProjectUuid,
    file.id,
    noteDraft,
    dragRegion,
    activeFrame,
    fps,
    queryClient,
    setSaveStatus,
    onNoteDraftChange,
  ]);

  const seekToFrame = useCallback(
    (frame: number) => {
      const clamped = Math.max(startFrame, Math.min(endFrame, Math.round(frame)));
      onUpdateState({ currentFrame: clamped });
      if (audioRef.current) {
        const t = (clamped - startFrame) / fps;
        if (Math.abs(audioRef.current.currentTime - t) > 0.02) {
          audioRef.current.currentTime = t;
        }
      }
      if (waveData && waveData.channelPeaks.length > 0) {
        const norm = (clamped - startFrame) / Math.max(1, endFrame - startFrame);
        const lCh = waveData.channelPeaks[0] ?? [];
        const rCh = waveData.channelPeaks[1] ?? lCh;
        const idx = Math.min(lCh.length - 1, Math.max(0, Math.floor(norm * lCh.length)));
        const lAmp = Math.max(Math.abs(lCh[idx]?.[0] ?? 0), Math.abs(lCh[idx]?.[1] ?? 0));
        const rAmp = Math.max(Math.abs(rCh[idx]?.[0] ?? 0), Math.abs(rCh[idx]?.[1] ?? 0));
        setMeterLevel([Math.min(1, lAmp), Math.min(1, rAmp)]);
      }
    },
    [startFrame, endFrame, fps, onUpdateState, waveData],
  );

  // Playback sync
  useEffect(() => {
    const el = audioRef.current;
    if (playState !== 'forward') {
      if (el && !el.paused) el.pause();
      return;
    }
    if (!el || !audioUrl) return;
    el.playbackRate = viewerState.playbackSpeed;
    void el.play().catch(() => undefined);

    let raf = 0;
    const tick = () => {
      const f = Math.round(el.currentTime * fps) + startFrame;
      if (f >= endFrame || el.ended) {
        if (viewerState.loopMode === 'loop') {
          el.currentTime = 0;
          void el.play().catch(() => undefined);
        } else {
          setPlayState('paused');
          seekToFrame(endFrame);
          return;
        }
      } else {
        seekToFrame(f);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      el.pause();
    };
  }, [playState, audioUrl, viewerState.playbackSpeed, viewerState.loopMode, fps, startFrame, endFrame, seekToFrame]);

  // Reverse step timer when playState === 'reverse'
  useEffect(() => {
    if (playState !== 'reverse') return;
    const interval = Math.max(16, Math.round(1000 / (fps * viewerState.playbackSpeed)));
    const id = window.setInterval(() => {
      if (activeFrame <= startFrame) {
        if (viewerState.loopMode === 'loop') seekToFrame(endFrame);
        else setPlayState('paused');
      } else {
        seekToFrame(activeFrame - 1);
      }
    }, interval);
    return () => window.clearInterval(id);
  }, [playState, activeFrame, startFrame, endFrame, fps, viewerState.playbackSpeed, viewerState.loopMode, seekToFrame]);

  useEffect(() => {
    const onSeekEvt = (ev: Event) => {
      const target = (ev as CustomEvent<number>).detail;
      if (typeof target === 'number') {
        setPlayState('paused');
        seekToFrame(target);
      }
    };
    window.addEventListener('organum:seek-frame', onSeekEvt);
    return () => window.removeEventListener('organum:seek-frame', onSeekEvt);
  }, [seekToFrame]);

  // Draw waveform / spectrogram canvas
  useEffect(() => {
    const cv = canvasRef.current;
    const stage = stageRef.current;
    if (!cv || !stage) return;
    const w = Math.max(200, stage.clientWidth);
    const h = Math.max(120, stage.clientHeight);
    cv.width = w;
    cv.height = h;
    const ctx = cv.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, w, h);

    const [v0, v1] = viewNorm;
    const vSpan = Math.max(0.002, v1 - v0);
    const totalSpan = Math.max(1, endFrame - startFrame);

    // Draw saved audio annotation bands
    for (const ann of savedAnnotations) {
      if (ann.frame_in === null || ann.frame_in === undefined) continue;
      const n0 = (ann.frame_in - startFrame) / totalSpan;
      const n1 = ((ann.frame_out ?? ann.frame_in + 1) - startFrame) / totalSpan;
      const x0 = ((n0 - v0) / vSpan) * w;
      const x1 = Math.max(x0 + 4, ((n1 - v0) / vSpan) * w);
      ctx.fillStyle = 'rgba(245, 158, 11, 0.22)';
      ctx.fillRect(x0, 0, x1 - x0, h);
      ctx.strokeStyle = '#F59E0B';
      ctx.strokeRect(x0, 0, x1 - x0, h);
    }

    if (dragRegion) {
      const n0 = (Math.min(dragRegion[0], dragRegion[1]) - startFrame) / totalSpan;
      const n1 = (Math.max(dragRegion[0], dragRegion[1]) - startFrame) / totalSpan;
      const x0 = ((n0 - v0) / vSpan) * w;
      const x1 = Math.max(x0 + 3, ((n1 - v0) / vSpan) * w);
      ctx.fillStyle = 'rgba(139, 92, 246, 0.25)';
      ctx.fillRect(x0, 0, x1 - x0, h);
      ctx.strokeStyle = '#8B5CF6';
      ctx.strokeRect(x0, 0, x1 - x0, h);
    }

    if (waveData) {
      if (showSpec && waveData.spectrogram.length > 0) {
        const spec = waveData.spectrogram;
        const cols = spec.length;
        const rows = spec[0]?.length ?? 32;
        const colW = w / Math.max(1, cols);
        const rowH = h / Math.max(1, rows);
        for (let c = 0; c < cols; c++) {
          const normPos = c / cols;
          if (normPos < v0 || normPos > v1) continue;
          const x = ((normPos - v0) / vSpan) * w;
          const bins = spec[c]!;
          for (let r = 0; r < rows; r++) {
            const mag = bins[rows - 1 - r] ?? 0;
            ctx.fillStyle = `rgba(139, 92, 246, ${(mag * 0.9).toFixed(2)})`;
            ctx.fillRect(x, r * rowH, colW + 1, rowH + 1);
          }
        }
      } else {
        const channels = waveData.channelPeaks.length > 0 ? waveData.channelPeaks : [waveData.peaks];
        const laneH = h / Math.max(1, channels.length);
        channels.forEach((chPeaks, chIdx) => {
          const mid = chIdx * laneH + laneH / 2;
          ctx.strokeStyle = 'rgba(148, 163, 184, 0.35)';
          ctx.beginPath();
          ctx.moveTo(0, mid);
          ctx.lineTo(w, mid);
          ctx.stroke();

          ctx.fillStyle = chIdx === 0 ? '#10B981' : '#38BDF8';
          const len = chPeaks.length;
          for (let x = 0; x < w; x++) {
            const norm = v0 + (x / w) * vSpan;
            const bIdx = Math.min(len - 1, Math.max(0, Math.floor(norm * len)));
            const [lo, hi] = chPeaks[bIdx] ?? [0, 0];
            const top = mid - Math.max(0.02, Math.abs(hi)) * (laneH * 0.44);
            const bot = mid + Math.max(0.02, Math.abs(lo)) * (laneH * 0.44);
            ctx.fillRect(x, top, 1, Math.max(1, bot - top));
          }
        });
      }
    }

    // Playhead
    const phNorm = (activeFrame - startFrame) / totalSpan;
    const phX = ((phNorm - v0) / vSpan) * w;
    ctx.strokeStyle = '#8B5CF6';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(phX, 0);
    ctx.lineTo(phX, h);
    ctx.stroke();
  }, [waveData, showSpec, viewNorm, activeFrame, startFrame, endFrame, savedAnnotations, dragRegion]);

  const frameFromX = (clientX: number): number => {
    const rect = stageRef.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0) return activeFrame;
    const t = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    const norm = viewNorm[0] + t * (viewNorm[1] - viewNorm[0]);
    return Math.round(startFrame + norm * (endFrame - startFrame));
  };

  const handlePointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const f = frameFromX(e.clientX);
    e.currentTarget.setPointerCapture(e.pointerId);
    setDragRegion([f, f]);
    seekToFrame(f);
  };

  const handlePointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!dragRegion || !e.currentTarget.hasPointerCapture(e.pointerId)) return;
    const f = frameFromX(e.clientX);
    setDragRegion([dragRegion[0], f]);
  };

  const handlePointerUp = async (e: PointerEvent<HTMLDivElement>) => {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    if (!dragRegion) return;
    const fIn = Math.min(dragRegion[0], dragRegion[1]);
    const fOut = Math.max(dragRegion[0], dragRegion[1]);
    if (fOut > fIn + 1) {
      setAnnotationFrameRange(fIn, fOut);
      setSaveStatus('saving');
      try {
        await apiClient.createAnnotation(file.id, {
          kind: 'audio',
          frame_in: fIn,
          frame_out: fOut,
          time_base: fps,
          note_text: noteDraft.trim() || `Audio cue F${fIn}–F${fOut}`,
          vector_json: [{ type: 'audio_range', frameIn: fIn, frameOut: fOut }],
        });
        await queryClient.refetchQueries({
          queryKey: ['annotations', activeProjectUuid, file.id],
        });
        setSaveStatus('saved');
      } catch (err) {
        setSaveStatus('error', err instanceof Error ? err.message : 'Save failed');
      }
      setDragRegion(null);
    } else {
      setDragRegion(null);
    }
  };

  const handleWheel = (e: WheelEvent<HTMLDivElement>) => {
    e.preventDefault();
    const span = viewNorm[1] - viewNorm[0];
    const nextSpan = Math.max(0.01, Math.min(1, span * (e.deltaY < 0 ? 0.8 : 1.25)));
    const mid = (viewNorm[0] + viewNorm[1]) / 2;
    const lo = Math.max(0, mid - nextSpan / 2);
    const hi = Math.min(1, lo + nextSpan);
    setViewNorm([Math.max(0, hi - nextSpan), hi]);
  };

  const cycleLoop = () => {
    const order: LoopMode[] = ['loop', 'once', 'pingpong'];
    onUpdateState({ loopMode: order[(order.indexOf(viewerState.loopMode) + 1) % order.length]! });
  };

  return (
    <div data-ui="audio-viewer" className="org-audioview">
      <div className="org-audioview__bar">
        <Badge tone="accent">{file.detected_format.toUpperCase()}</Badge>
        <Text size="sm" variant="mono">
          {waveData ? `${waveData.sampleRate} Hz · ${waveData.channels}ch · ${waveData.duration.toFixed(2)}s` : 'Loading audio...'}
        </Text>
        <Button
          size="sm"
          variant="toggle"
          pressed={showSpec}
          onClick={() => setShowSpec((s) => !s)}
        >
          Spectrogram
        </Button>
        {viewNorm[1] - viewNorm[0] < 0.99 && (
          <Button size="sm" onClick={() => setViewNorm([0, 1])}>
            Reset Zoom
          </Button>
        )}
      </div>

      <div data-bg={viewportBg} className="org-audioview__body">
        <div
          ref={stageRef}
          className="org-audioview__stage"
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onWheel={handleWheel}
        >
          <canvas ref={canvasRef} className="org-audioview__canvas" />
          {loading && <Spinner label="Decoding audio waveform" />}
          {error && <Text variant="danger">{error}</Text>}
        </div>
        <div className="org-audioview__meters" aria-label="Channel meters">
          <div className="org-audioview__meter-col">
            <div className="org-audioview__meter-well">
              <div ref={meterLRef} className="org-audioview__meter-fill" />
            </div>
            <Text size="sm" variant="mono">
              L
            </Text>
          </div>
          <div className="org-audioview__meter-col">
            <div className="org-audioview__meter-well">
              <div ref={meterRRef} className="org-audioview__meter-fill" />
            </div>
            <Text size="sm" variant="mono">
              R
            </Text>
          </div>
        </div>
      </div>

      {audioUrl && <audio ref={audioRef} src={audioUrl} className="org-audioview__media" />}

      <Timebar
        startFrame={startFrame}
        endFrame={endFrame}
        currentFrame={activeFrame}
        fps={fps}
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
        onGoStart={() => seekToFrame(startFrame)}
        onStepBack={() => seekToFrame(activeFrame - 1)}
        onPlayReverse={() => setPlayState('reverse')}
        onPause={() => setPlayState('paused')}
        onPlayForward={() => setPlayState('forward')}
        onStepForward={() => seekToFrame(activeFrame + 1)}
        onGoEnd={() => seekToFrame(endFrame)}
        onSeek={(f) => seekToFrame(f)}
        onCycleLoop={cycleLoop}
        onChangeSpeed={(playbackSpeed) => onUpdateState({ playbackSpeed })}
      />
    </div>
  );
}

