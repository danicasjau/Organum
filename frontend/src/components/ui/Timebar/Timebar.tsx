import { readCssToken } from '../Theme/readCssToken';
import { useEffect, useMemo, useRef, useState, type PointerEvent, type WheelEvent } from 'react';
import { useCssVarRef } from '../_internal/useCssVar';
import { Badge } from '../Badge/Badge';
import { Button } from '../Button/Button';
import { Icon } from '../Icon/Icon';
import { NumberField } from '../NumberField/NumberField';
import { Select, type SelectOption } from '../Select/Select';
import { Separator } from '../Typography/Typography';
import { Tooltip } from '../Overlays/Overlays';
import './Timebar.css';

export interface TimebarAnnotationMarker {
  id: string;
  frameIn: number;
  frameOut?: number | null;
  label?: string;
}

export interface TimebarProps {
  startFrame: number;
  endFrame: number;
  currentFrame: number;
  fps?: number;
  inPoint?: number | null;
  outPoint?: number | null;
  cacheProgress?: number; // 0..1
  markers?: ReadonlyArray<TimebarAnnotationMarker>;
  onSeek: (frame: number) => void;
  ariaLabel?: string;
}

export function formatTimecode(frame: number, fps = 24): string {
  const safeFps = Math.max(1, Math.round(fps));
  const f = Math.max(0, Math.round(frame));
  const ff = f % safeFps;
  const totalSec = Math.floor(f / safeFps);
  const ss = totalSec % 60;
  const totalMin = Math.floor(totalSec / 60);
  const mm = totalMin % 60;
  const hh = Math.floor(totalMin / 60);
  return [hh, mm, ss, ff].map((v) => String(v).padStart(2, '0')).join(':');
}

export function computeTickStep(visibleFrames: number): { minor: number; major: number } {
  if (visibleFrames <= 40) return { minor: 1, major: 5 };
  if (visibleFrames <= 100) return { minor: 2, major: 10 };
  if (visibleFrames <= 250) return { minor: 5, major: 25 };
  if (visibleFrames <= 700) return { minor: 10, major: 50 };
  return { minor: 25, major: 100 };
}

function TimebarMarkerButton({
  marker,
  viewStart,
  viewSpan,
  onSeek,
}: {
  marker: TimebarAnnotationMarker;
  viewStart: number;
  viewSpan: number;
  onSeek: (frame: number) => void;
}) {
  const btnRef = useRef<HTMLButtonElement>(null);
  const leftPct = ((marker.frameIn - viewStart) / viewSpan) * 100;
  const endF = marker.frameOut ?? marker.frameIn;
  const spanFrames = Math.max(1, endF - marker.frameIn + 1);
  const widthPct = endF > marker.frameIn ? (spanFrames / viewSpan) * 100 : 0;

  useCssVarRef(btnRef, '--marker-left', `${leftPct.toFixed(3)}%`);
  useCssVarRef(btnRef, '--marker-width', widthPct > 0 ? `${widthPct.toFixed(3)}%` : undefined);

  if (leftPct < -5 || leftPct > 105) return null;

  return (
    <button
      ref={btnRef}
      type="button"
      className="org-timebar__marker"
      title={
        marker.label ??
        (endF > marker.frameIn
          ? `Annotation F${marker.frameIn}–F${endF}`
          : `Annotation F${marker.frameIn}`)
      }
      aria-label={`Jump to annotation frame ${marker.frameIn}`}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation();
        onSeek(marker.frameIn);
      }}
    />
  );
}

export function Timebar({
  startFrame,
  endFrame,
  currentFrame,
  inPoint = null,
  outPoint = null,
  cacheProgress = 1,
  markers = [],
  onSeek,
  ariaLabel = 'Timeline scrubber',
}: TimebarProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const playheadRef = useRef<HTMLDivElement>(null);
  const inoutRef = useRef<HTMLDivElement>(null);
  const cacheRef = useRef<HTMLDivElement>(null);

  const safeEnd = Math.max(startFrame, endFrame);
  const fullSpan = Math.max(1, safeEnd - startFrame);

  const [viewRange, setViewRange] = useState<[number, number]>([startFrame, safeEnd]);
  const dragModeRef = useRef<'none' | 'scrub' | 'pan'>('none');
  const panAnchorRef = useRef<{ x: number; start0: number; start1: number }>({
    x: 0,
    start0: startFrame,
    start1: safeEnd,
  });

  useEffect(() => {
    setViewRange([startFrame, safeEnd]);
  }, [startFrame, safeEnd]);

  const [viewStart, viewEnd] = viewRange;
  const viewSpan = Math.max(1, viewEnd - viewStart);

  const playheadPct = Math.max(0, Math.min(100, ((currentFrame - viewStart) / viewSpan) * 100));
  useCssVarRef(playheadRef, '--playhead-pct', `${playheadPct.toFixed(3)}%`);

  const loIn = inPoint ?? startFrame;
  const hiOut = outPoint ?? safeEnd;
  const bandLeft = Math.max(0, ((loIn - viewStart) / viewSpan) * 100);
  const bandRight = Math.min(100, ((hiOut - viewStart) / viewSpan) * 100);
  useCssVarRef(inoutRef, '--band-left', `${bandLeft.toFixed(3)}%`);
  useCssVarRef(inoutRef, '--band-width', `${Math.max(0, bandRight - bandLeft).toFixed(3)}%`);
  useCssVarRef(cacheRef, '--cache-pct', `${Math.max(0, Math.min(100, cacheProgress * 100)).toFixed(1)}%`);

  const ticks = useMemo(() => {
    const { minor, major } = computeTickStep(viewSpan);
    const out: Array<{ frame: number; xPct: number; major: boolean }> = [];
    const first = Math.ceil(viewStart / minor) * minor;
    for (let f = first; f <= viewEnd; f += minor) {
      out.push({
        frame: f,
        xPct: ((f - viewStart) / viewSpan) * 100,
        major: f % major === 0 || f === startFrame || f === safeEnd,
      });
    }
    return out;
  }, [viewStart, viewEnd, viewSpan, startFrame, safeEnd]);

  const frameFromClientX = (clientX: number): number => {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0) return currentFrame;
    const t = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    return Math.max(startFrame, Math.min(safeEnd, Math.round(viewStart + t * viewSpan)));
  };

  const handlePointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button === 1 || (e.button === 0 && e.altKey)) {
      dragModeRef.current = 'pan';
      panAnchorRef.current = { x: e.clientX, start0: viewStart, start1: viewEnd };
      e.currentTarget.setPointerCapture(e.pointerId);
      return;
    }
    if (e.button === 0) {
      dragModeRef.current = 'scrub';
      e.currentTarget.setPointerCapture(e.pointerId);
      onSeek(frameFromClientX(e.clientX));
    }
  };

  const handlePointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (dragModeRef.current === 'scrub') {
      onSeek(frameFromClientX(e.clientX));
    } else if (dragModeRef.current === 'pan' && trackRef.current) {
      const rect = trackRef.current.getBoundingClientRect();
      if (rect.width <= 0) return;
      const dx = e.clientX - panAnchorRef.current.x;
      const dFrames = Math.round((-dx / rect.width) * (panAnchorRef.current.start1 - panAnchorRef.current.start0));
      const span = panAnchorRef.current.start1 - panAnchorRef.current.start0;
      const clamped0 = Math.max(startFrame, Math.min(safeEnd - span, panAnchorRef.current.start0 + dFrames));
      setViewRange([clamped0, clamped0 + span]);
    }
  };

  const handlePointerUp = (e: PointerEvent<HTMLDivElement>) => {
    dragModeRef.current = 'none';
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
  };

  const handleWheel = (e: WheelEvent<HTMLDivElement>) => {
    if (fullSpan <= 8) return;
    e.preventDefault();
    const factor = e.deltaY < 0 ? 0.8 : 1.25;
    const nextSpan = Math.max(8, Math.min(fullSpan, viewSpan * factor));
    const rect = trackRef.current?.getBoundingClientRect();
    const t = rect && rect.width > 0 ? Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)) : 0.5;
    const pivot = viewStart + t * viewSpan;
    const s0 = Math.max(startFrame, pivot - t * nextSpan);
    const s1 = Math.min(safeEnd, s0 + nextSpan);
    setViewRange([Math.max(startFrame, s1 - nextSpan), s1]);
  };

  return (
    <div
      ref={trackRef}
      data-ui="timebar"
      role="slider"
      tabIndex={0}
      aria-label={ariaLabel}
      aria-valuemin={startFrame}
      aria-valuemax={safeEnd}
      aria-valuenow={currentFrame}
      className="org-timebar"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onWheel={handleWheel}
      onDoubleClick={() => setViewRange([startFrame, safeEnd])}
    >
      {(inPoint !== null || outPoint !== null) && (
        <div ref={inoutRef} className="org-timebar__inout" aria-hidden="true" />
      )}
      <svg className="org-timebar__ruler" aria-hidden="true">
        {ticks.map((t) => (
          <g key={t.frame}>
            <line
              x1={`${t.xPct}%`}
              x2={`${t.xPct}%`}
              y1={t.major ? '28%' : '58%'}
              y2="100%"
              className={t.major ? 'org-timebar__tick-major' : 'org-timebar__tick-minor'}
            />
            {t.major && (
              <text x={`${t.xPct}%`} y="10" className="org-timebar__label">
                {t.frame}
              </text>
            )}
          </g>
        ))}
      </svg>
      <div ref={cacheRef} className="org-timebar__cache" aria-hidden="true" />
      {markers.map((m) => (
        <TimebarMarkerButton
          key={m.id}
          marker={m}
          viewStart={viewStart}
          viewSpan={viewSpan}
          onSeek={onSeek}
        />
      ))}
      <div ref={playheadRef} className="org-timebar__playhead" aria-hidden="true" />
    </div>
  );
}

export interface AudioWaveformStripProps {
  peaks: ReadonlyArray<[number, number]>;
  startFrame: number;
  endFrame: number;
  currentFrame: number;
  onSeek: (frame: number) => void;
}

export function AudioWaveformStrip({
  peaks,
  startFrame,
  endFrame,
  currentFrame,
  onSeek,
}: AudioWaveformStripProps) {
  const stripRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const playheadRef = useRef<HTMLDivElement>(null);

  const span = Math.max(1, endFrame - startFrame);
  const pct = Math.max(0, Math.min(100, ((currentFrame - startFrame) / span) * 100));
  useCssVarRef(playheadRef, '--playhead-pct', `${pct.toFixed(3)}%`);

  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv) return;
    const rect = cv.getBoundingClientRect();
    const w = Math.max(120, Math.floor(rect.width || 600));
    const h = 32;
    cv.width = w;
    cv.height = h;
    const ctx = cv.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, w, h);
    const mid = h / 2;
    ctx.strokeStyle = readCssToken('--grid-line-strong', 'rgba(128, 128, 128, 0.35)', cv);
    ctx.beginPath();
    ctx.moveTo(0, mid);
    ctx.lineTo(w, mid);
    ctx.stroke();

    if (peaks.length === 0) return;
    ctx.fillStyle = readCssToken('--st-approved', 'rgb(95, 179, 107)', cv);
    for (let x = 0; x < w; x++) {
      const idx = Math.min(peaks.length - 1, Math.floor((x / w) * peaks.length));
      const [lo, hi] = peaks[idx] ?? [0, 0];
      const yTop = mid - Math.max(0.05, Math.abs(hi)) * (mid - 2);
      const yBot = mid + Math.max(0.05, Math.abs(lo)) * (mid - 2);
      ctx.fillRect(x, yTop, 1, Math.max(1, yBot - yTop));
    }
  }, [peaks]);

  const seekAtClientX = (clientX: number) => {
    const rect = stripRef.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0) return;
    const t = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    onSeek(Math.round(startFrame + t * span));
  };

  return (
    <div
      ref={stripRef}
      data-ui="audio-waveform-strip"
      className="org-audiostrip"
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        seekAtClientX(e.clientX);
      }}
      onPointerMove={(e) => {
        if (e.currentTarget.hasPointerCapture(e.pointerId)) seekAtClientX(e.clientX);
      }}
    >
      <canvas ref={canvasRef} className="org-audiostrip__canvas" />
      <div ref={playheadRef} className="org-audiostrip__playhead" aria-hidden="true" />
    </div>
  );
}

const SPEED_OPTIONS: SelectOption[] = [
  { value: '0.25', label: '0.25×' },
  { value: '0.5', label: '0.5×' },
  { value: '1', label: '1.0×' },
  { value: '2', label: '2.0×' },
];

export interface TransportControlsProps {
  playState: 'paused' | 'forward' | 'reverse';
  currentFrame: number;
  startFrame: number;
  endFrame: number;
  fps: number;
  loopMode: 'once' | 'loop' | 'pingpong';
  speed: number;
  inPoint?: number | null;
  outPoint?: number | null;
  muted?: boolean;
  showMute?: boolean;
  onGoStart: () => void;
  onStepBack: () => void;
  onPlayReverse: () => void;
  onPause: () => void;
  onPlayForward: () => void;
  onStepForward: () => void;
  onGoEnd: () => void;
  onSeek: (frame: number) => void;
  onCycleLoop: () => void;
  onChangeSpeed: (speed: number) => void;
  onSetIn?: () => void;
  onSetOut?: () => void;
  onToggleMute?: () => void;
}

export function TransportControls({
  playState,
  currentFrame,
  startFrame,
  endFrame,
  fps,
  loopMode,
  speed,
  muted = false,
  showMute = false,
  onGoStart,
  onStepBack,
  onPlayReverse,
  onPause,
  onPlayForward,
  onStepForward,
  onGoEnd,
  onSeek,
  onCycleLoop,
  onChangeSpeed,
  onSetIn,
  onSetOut,
  onToggleMute,
}: TransportControlsProps) {
  return (
    <div data-ui="transport-controls" role="toolbar" aria-label="Transport controls" className="org-transport">
      <div className="org-transport__group">
        <Tooltip content="Go to Start" shortcut="Home">
          <Button size="sm" aria-label="Go to start" onClick={onGoStart}>
            <Icon name="skip-start" size="sm" />
          </Button>
        </Tooltip>
        <Tooltip content="Step Back 1 Frame" shortcut="Left">
          <Button size="sm" aria-label="Step back" onClick={onStepBack}>
            <Icon name="step-back" size="sm" />
          </Button>
        </Tooltip>
        <Tooltip content="Play Backwards" shortcut="J">
          <Button
            size="sm"
            variant="toggle"
            pressed={playState === 'reverse'}
            aria-label="Play backwards"
            onClick={onPlayReverse}
          >
            <Icon name="play-reverse" size="sm" />
          </Button>
        </Tooltip>
        <Tooltip content="Pause / Stop" shortcut="K / Space">
          <Button
            size="sm"
            variant="toggle"
            pressed={playState === 'paused'}
            aria-label="Pause"
            onClick={onPause}
          >
            <Icon name="pause" size="sm" />
          </Button>
        </Tooltip>
        <Tooltip content="Play Forward" shortcut="L">
          <Button
            size="sm"
            variant="toggle"
            pressed={playState === 'forward'}
            aria-label="Play forward"
            onClick={onPlayForward}
          >
            <Icon name="play" size="sm" />
          </Button>
        </Tooltip>
        <Tooltip content="Step Forward 1 Frame" shortcut="Right">
          <Button size="sm" aria-label="Step forward" onClick={onStepForward}>
            <Icon name="step-forward" size="sm" />
          </Button>
        </Tooltip>
        <Tooltip content="Go to End" shortcut="End">
          <Button size="sm" aria-label="Go to end" onClick={onGoEnd}>
            <Icon name="skip-end" size="sm" />
          </Button>
        </Tooltip>
      </div>

      <Separator orientation="vertical" />

      <div className="org-transport__group">
        <div className="org-transport__frame">
          <NumberField
            label="F"
            ariaLabel="Current frame"
            mode="int"
            min={startFrame}
            max={Math.max(startFrame, endFrame)}
            value={currentFrame}
            onChange={onSeek}
          />
        </div>
        <span className="org-transport__tc" aria-label="Timecode">
          {formatTimecode(currentFrame, fps)}
        </span>
        <Badge tone="neutral">{fps.toFixed(0)} fps</Badge>
      </div>

      <Separator orientation="vertical" />

      <div className="org-transport__group">
        <Tooltip content={`Loop mode: ${loopMode} (click to cycle)`}>
          <Button size="sm" aria-label="Cycle loop mode" onClick={onCycleLoop}>
            {loopMode === 'once' ? 'Once' : loopMode === 'loop' ? 'Loop' : 'Ping'}
          </Button>
        </Tooltip>
        <div className="org-transport__speed">
          <Select
            ariaLabel="Playback speed"
            filterable={false}
            value={String(speed)}
            options={SPEED_OPTIONS}
            onChange={(v) => onChangeSpeed(Number(v))}
          />
        </div>
        {onSetIn && (
          <Tooltip content="Set In point" shortcut="I">
            <Button size="sm" aria-label="Set In point" onClick={onSetIn}>
              I
            </Button>
          </Tooltip>
        )}
        {onSetOut && (
          <Tooltip content="Set Out point" shortcut="O">
            <Button size="sm" aria-label="Set Out point" onClick={onSetOut}>
              O
            </Button>
          </Tooltip>
        )}
        {showMute && onToggleMute && (
          <Tooltip content={muted ? 'Unmute audio' : 'Mute audio'}>
            <Button
              size="sm"
              variant="toggle"
              pressed={muted}
              aria-label="Toggle mute"
              onClick={onToggleMute}
            >
              <Icon name={muted ? 'mute' : 'volume'} size="sm" />
            </Button>
          </Tooltip>
        )}
      </div>
    </div>
  );
}
