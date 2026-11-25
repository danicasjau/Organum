import { useEffect, useRef, useState } from 'react';
import { Badge, Button, Text, Timebar, TransportControls } from '../../../components/ui';
import { useCssVarRef } from '../../../components/ui/_internal/useCssVar';
import type { FileSummaryOut, InspectionDocument } from '../../../lib/api/client';
import type { AnnotationTool, LoopMode, PerFileViewerState } from '../viewerStore';
import './TimelineViewer.css';

interface TimelineClipDoc {
  name: string;
  track: string;
  kind: string;
  start_frame: number;
  duration_frames: number;
  end_frame: number;
  media_target?: string;
}

interface TimelineTrackDoc {
  name: string;
  kind: string;
  clips: TimelineClipDoc[];
}

function ClipBlock({
  clip,
  startFrame,
  span,
  onSelect,
}: {
  clip: TimelineClipDoc;
  startFrame: number;
  span: number;
  onSelect: () => void;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  const left = ((clip.start_frame - startFrame) / span) * 100;
  const width = Math.max(1, (clip.duration_frames / span) * 100);
  useCssVarRef(ref, '--clip-left', `${left.toFixed(3)}%`);
  useCssVarRef(ref, '--clip-width', `${width.toFixed(3)}%`);

  return (
    <button
      ref={ref}
      type="button"
      className="org-timelineview__clip"
      title={`${clip.name} (F${clip.start_frame}–F${clip.end_frame})`}
      onClick={onSelect}
    >
      {clip.name}
    </button>
  );
}

interface TimelineViewerProps {
  file: FileSummaryOut;
  inspection: InspectionDocument;
  viewerState: PerFileViewerState;
  onUpdateState: (patch: Partial<PerFileViewerState>) => void;
  activeTool: AnnotationTool;
  noteDraft: string;
  onNoteDraftChange: (note: string) => void;
}

export function TimelineViewer({
  file,
  inspection,
  viewerState,
  onUpdateState,
}: TimelineViewerProps) {
  const tl = (inspection.timeline ?? {}) as Record<string, unknown>;
  const fps = Number(tl.fps ?? 24);
  const startFrame = Number(tl.start ?? 0);
  const endFrame = Math.max(startFrame + 1, Number(tl.end ?? 24));
  const span = Math.max(1, endFrame - startFrame + 1);
  const activeFrame = Math.max(startFrame, Math.min(endFrame, viewerState.currentFrame || startFrame));

  const meta = (inspection.metadata ?? {}) as Record<string, unknown>;
  const tracks = Array.isArray(meta.tracks) ? (meta.tracks as TimelineTrackDoc[]) : [];
  const [selectedClip, setSelectedClip] = useState<TimelineClipDoc | null>(null);
  const [playState, setPlayState] = useState<'paused' | 'forward' | 'reverse'>('paused');
  const playheadRef = useRef<HTMLDivElement>(null);

  const phPct = ((activeFrame - startFrame) / Math.max(1, endFrame - startFrame)) * 100;
  useCssVarRef(playheadRef, '--playhead-pct', `${phPct.toFixed(3)}%`);

  useEffect(() => {
    if (playState === 'paused') return;
    const dir = playState === 'forward' ? 1 : -1;
    const ms = Math.max(16, Math.round(1000 / (fps * viewerState.playbackSpeed)));
    const id = window.setInterval(() => {
      const next = activeFrame + dir;
      if (next < startFrame || next > endFrame) {
        if (viewerState.loopMode === 'loop') {
          onUpdateState({ currentFrame: dir > 0 ? startFrame : endFrame });
        } else {
          setPlayState('paused');
        }
      } else {
        onUpdateState({ currentFrame: next });
      }
    }, ms);
    return () => window.clearInterval(id);
  }, [playState, activeFrame, startFrame, endFrame, fps, viewerState.playbackSpeed, viewerState.loopMode, onUpdateState]);

  useEffect(() => {
    const onSeekEvt = (ev: Event) => {
      const f = (ev as CustomEvent<number>).detail;
      if (typeof f === 'number') {
        setPlayState('paused');
        onUpdateState({ currentFrame: Math.max(startFrame, Math.min(endFrame, f)) });
      }
    };
    window.addEventListener('organum:seek-frame', onSeekEvt);
    return () => window.removeEventListener('organum:seek-frame', onSeekEvt);
  }, [startFrame, endFrame, onUpdateState]);

  const cycleLoop = () => {
    const order: LoopMode[] = ['loop', 'once', 'pingpong'];
    onUpdateState({ loopMode: order[(order.indexOf(viewerState.loopMode) + 1) % order.length]! });
  };

  return (
    <div data-ui="timeline-viewer" className="org-timelineview">
      <div className="org-timelineview__bar">
        <Badge tone="accent">{file.detected_format.toUpperCase()}</Badge>
        <Text size="sm" variant="mono">
          {tracks.length} track(s) · {span} frames @ {fps} fps
        </Text>
        {selectedClip && (
          <>
            <Text size="sm">Selected: {selectedClip.name}</Text>
            <Button
              size="sm"
              variant="primary"
              onClick={() =>
                window.dispatchEvent(
                  new CustomEvent('organum:open-file-by-name', {
                    detail: selectedClip.media_target || selectedClip.name,
                  }),
                )
              }
            >
              Open Clip Media
            </Button>
          </>
        )}
      </div>

      <div className="org-timelineview__tracks">
        {tracks.map((tr, tIdx) => (
          <div key={`${tr.name}-${tIdx}`} className="org-timelineview__row">
            <div className="org-timelineview__tlabel">
              {tr.name} ({tr.kind})
            </div>
            <div className="org-timelineview__lane">
              {tr.clips.map((c, cIdx) => (
                <ClipBlock
                  key={`${c.name}-${cIdx}`}
                  clip={c}
                  startFrame={startFrame}
                  span={span}
                  onSelect={() => {
                    setSelectedClip(c);
                    setPlayState('paused');
                    onUpdateState({ currentFrame: c.start_frame });
                  }}
                />
              ))}
              <div ref={tIdx === 0 ? playheadRef : undefined} className="org-timelineview__playhead" />
            </div>
          </div>
        ))}
      </div>

      <Timebar
        startFrame={startFrame}
        endFrame={endFrame}
        currentFrame={activeFrame}
        fps={fps}
        onSeek={(f) => {
          setPlayState('paused');
          onUpdateState({ currentFrame: f });
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
        onGoStart={() => onUpdateState({ currentFrame: startFrame })}
        onStepBack={() => onUpdateState({ currentFrame: Math.max(startFrame, activeFrame - 1) })}
        onPlayReverse={() => setPlayState('reverse')}
        onPause={() => setPlayState('paused')}
        onPlayForward={() => setPlayState('forward')}
        onStepForward={() => onUpdateState({ currentFrame: Math.min(endFrame, activeFrame + 1) })}
        onGoEnd={() => onUpdateState({ currentFrame: endFrame })}
        onSeek={(f) => onUpdateState({ currentFrame: f })}
        onCycleLoop={cycleLoop}
        onChangeSpeed={(playbackSpeed) => onUpdateState({ playbackSpeed })}
      />
    </div>
  );
}

