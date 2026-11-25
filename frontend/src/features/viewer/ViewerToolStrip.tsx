import { useEffect, useRef, useState } from 'react';
import {
  Button,
  Checkbox,
  ColorPicker,
  Icon,
  NumberField,
  Popover,
  SegmentedControl,
  Slider,
  Stack,
  Text,
  TextArea,
  ToolStrip,
  Tooltip,
  type IconName,
} from '../../components/ui';
import { useViewerStore, type AnnotationTool, type WidthMode } from './viewerStore';
import './ViewerToolStrip.css';

const NAV_TOOLS: ReadonlyArray<{ id: AnnotationTool; icon: IconName; label: string; shortcut: string }> = [
  { id: 'pan', icon: 'crosshair', label: 'Pan / Navigate', shortcut: 'V' },
];

const SELECT_TOOLS: ReadonlyArray<{ id: AnnotationTool; icon: IconName; label: string; shortcut: string }> = [
  { id: 'rect', icon: 'rect', label: 'Select / ROI Rectangle', shortcut: 'R' },
  { id: 'ellipse', icon: 'circle', label: 'Ellipse Shape', shortcut: 'O' },
];

const DRAW_TOOLS: ReadonlyArray<{ id: AnnotationTool; icon: IconName; label: string; shortcut: string }> = [
  { id: 'free', icon: 'pencil', label: 'Free Draw', shortcut: 'B' },
  { id: 'closed', icon: 'lasso', label: 'Closed Draw / Polygon', shortcut: 'P' },
  { id: 'eraser', icon: 'eraser', label: 'Eraser', shortcut: 'E' },
  { id: 'laser', icon: 'laser', label: 'Laser Pointer (ephemeral)', shortcut: 'L' },
];

export interface ViewerToolStripProps {
  activeTool: AnnotationTool;
  onSelectTool: (tool: AnnotationTool) => void;
  strokeColor: string;
  onChangeColor: (hex: string) => void;
  strokeSize: number;
  onChangeSize: (size: number) => void;
  closedFill: boolean;
  onToggleClosedFill: (fill: boolean) => void;
  showAnnotations: boolean;
  onToggleShowAnnotations: () => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onClear: () => void;
  noteDraft: string;
  onChangeNote: (note: string) => void;
  disabled?: boolean;
  isLive3D?: boolean;
  isTimeBased?: boolean;
  currentFrame?: number;
  frameStart?: number;
  frameEnd?: number;
  lockPlane?: boolean;
  onToggleLockPlane?: (locked: boolean) => void;
  widthMode?: WidthMode;
  onChangeWidthMode?: (mode: WidthMode) => void;
  planeDepthTest?: boolean;
  onTogglePlaneDepthTest?: (depthTest: boolean) => void;
  projectionMode?: 'surface' | 'float';
  onChangeProjectionMode?: (mode: 'surface' | 'float') => void;
  surfaceOffset?: number | null;
  onChangeSurfaceOffset?: (offset: number | null) => void;
  strokeSmoothing?: number;
  onChangeStrokeSmoothing?: (smoothing: number) => void;
}

export function ViewerToolStrip({
  activeTool,
  onSelectTool,
  strokeColor,
  onChangeColor,
  strokeSize,
  onChangeSize,
  closedFill,
  onToggleClosedFill,
  showAnnotations,
  onToggleShowAnnotations,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  onClear,
  noteDraft,
  onChangeNote,
  disabled = false,
  isLive3D = false,
  isTimeBased = false,
  currentFrame = 0,
  frameStart = 0,
  frameEnd = 100,
  lockPlane = false,
  onToggleLockPlane,
  widthMode = 'world',
  onChangeWidthMode,
  planeDepthTest = true,
  onTogglePlaneDepthTest,
  projectionMode = 'surface',
  onChangeProjectionMode,
  surfaceOffset = null,
  onChangeSurfaceOffset,
  strokeSmoothing = 0.35,
  onChangeStrokeSmoothing,
}: ViewerToolStripProps) {
  const activePlaneDistance = useViewerStore((s) => s.activePlaneDistance);
  const annotationScope = useViewerStore((s) => s.annotationScope);
  const setAnnotationScope = useViewerStore((s) => s.setAnnotationScope);
  const annotationFrameIn = useViewerStore((s) => s.annotationFrameIn);
  const annotationFrameOut = useViewerStore((s) => s.annotationFrameOut);
  const setAnnotationFrameRange = useViewerStore((s) => s.setAnnotationFrameRange);
  const ghostNeighbors = useViewerStore((s) => s.ghostNeighbors);
  const setGhostNeighbors = useViewerStore((s) => s.setGhostNeighbors);

  const scrollRef = useRef<HTMLDivElement>(null);
  const [canScrollUp, setCanScrollUp] = useState(false);
  const [canScrollDown, setCanScrollDown] = useState(false);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const sync = () => {
      setCanScrollUp(el.scrollTop > 1);
      setCanScrollDown(el.scrollTop + el.clientHeight < el.scrollHeight - 1);
    };
    sync();
    const ro = new ResizeObserver(sync);
    ro.observe(el);
    el.addEventListener('scroll', sync, { passive: true });
    return () => {
      ro.disconnect();
      el.removeEventListener('scroll', sync);
    };
  }, []);

  const scrollByDelta = (dy: number) => {
    scrollRef.current?.scrollBy({ top: dy, behavior: 'auto' });
  };

  const submitAnnotation = () => {
    window.dispatchEvent(
      new CustomEvent('organum:submit-annotation', { detail: { handled: false } }),
    );
  };

  return (
    <ToolStrip ariaLabel="Viewer annotation tools" className="org-vtoolstrip">
      {canScrollUp && (
        <button
          type="button"
          className="org-vtoolstrip__chev"
          aria-label="Scroll tools up"
          onClick={() => scrollByDelta(-60)}
        >
          <Icon name="chevron-up" size="sm" />
        </button>
      )}

      <div ref={scrollRef} className="org-vtoolstrip__wells">
        {/* 1. Navigate */}
        <div className="org-toolwell" role="group" aria-label="Navigate tools" title="Navigate">
          {NAV_TOOLS.map((t) => (
            <Tooltip key={t.id} content={t.label} shortcut={t.shortcut}>
              <Button
                variant="toolbar"
                disabled={disabled}
                pressed={activeTool === t.id}
                aria-label={t.label}
                onClick={() => onSelectTool(t.id)}
              >
                <Icon name={t.icon} size="sm" />
              </Button>
            </Tooltip>
          ))}
        </div>

        {/* 2. Select */}
        <div className="org-toolwell" role="group" aria-label="Select tools" title="Select">
          {SELECT_TOOLS.map((t) => (
            <Tooltip key={t.id} content={t.label} shortcut={t.shortcut}>
              <Button
                variant="toolbar"
                disabled={disabled}
                pressed={activeTool === t.id}
                aria-label={t.label}
                onClick={() => onSelectTool(t.id)}
              >
                <Icon name={t.icon} size="sm" />
              </Button>
            </Tooltip>
          ))}
        </div>

        {/* 3. Draw */}
        <div className="org-toolwell" role="group" aria-label="Draw tools" title="Draw">
          {DRAW_TOOLS.map((t) => (
            <Tooltip key={t.id} content={t.label} shortcut={t.shortcut}>
              <Button
                variant="toolbar"
                disabled={disabled}
                pressed={activeTool === t.id}
                aria-label={t.label}
                onClick={() => onSelectTool(t.id)}
              >
                <Icon name={t.icon} size="sm" />
              </Button>
            </Tooltip>
          ))}
        </div>

        {/* 4. Style */}
        <div className="org-toolwell" role="group" aria-label="Style tools" title="Style">
          <Popover
            trigger={
              <Button
                variant="toolbar"
                disabled={disabled}
                aria-label="Stroke color and size"
                title="Style: Stroke color & size"
              >
                <Icon name="sliders" size="sm" />
              </Button>
            }
          >
            <Stack gap="2">
              <Text size="sm" variant="muted">
                Stroke Color & Size
              </Text>
              <ColorPicker value={strokeColor} onChange={onChangeColor} />
              <NumberField
                label="Size"
                mode="int"
                min={1}
                max={64}
                value={strokeSize}
                unit="px"
                onChange={onChangeSize}
              />
              <Checkbox
                checked={closedFill}
                onChange={onToggleClosedFill}
                label="20% fill on closed shapes"
              />
            </Stack>
          </Popover>
        </div>

        {/* 5. History */}
        <div className="org-toolwell" role="group" aria-label="History tools" title="History">
          <Tooltip content="Undo stroke" shortcut="Ctrl+Z">
            <Button
              variant="toolbar"
              disabled={disabled || !canUndo}
              aria-label="Undo"
              onClick={onUndo}
            >
              <Icon name="chevron-left" size="sm" />
            </Button>
          </Tooltip>
          <Tooltip content="Redo stroke" shortcut="Ctrl+Y">
            <Button
              variant="toolbar"
              disabled={disabled || !canRedo}
              aria-label="Redo"
              onClick={onRedo}
            >
              <Icon name="chevron-right" size="sm" />
            </Button>
          </Tooltip>
          <Tooltip content="Clear current strokes">
            <Button
              variant="toolbar"
              disabled={disabled}
              aria-label="Clear annotations"
              onClick={onClear}
            >
              <Icon name="close" size="sm" />
            </Button>
          </Tooltip>
        </div>

        {/* 6. View */}
        <div className="org-toolwell" role="group" aria-label="Annotation view tools" title="View">
          <Tooltip content="Show / Hide annotations" shortcut="H">
            <Button
              variant="toolbar"
              disabled={disabled}
              pressed={showAnnotations}
              aria-label="Toggle annotations visibility"
              onClick={onToggleShowAnnotations}
            >
              <Icon name={showAnnotations ? 'eye' : 'eye-off'} size="sm" />
            </Button>
          </Tooltip>
          <Popover
            trigger={
              <Button
                variant="toolbar"
                disabled={disabled}
                aria-label="Edit annotation note"
                title="View: Edit annotation note"
              >
                <Icon name="note" size="sm" />
              </Button>
            }
          >
            <Stack gap="2">
              <Text size="sm" variant="muted">
                Annotation Note (Enter to submit)
              </Text>
              <TextArea
                value={noteDraft}
                placeholder="Write review note... (Enter to save)"
                aria-label="Annotation note text"
                onChange={(e) => onChangeNote(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    submitAnnotation();
                  }
                }}
              />
              <Button variant="primary" size="sm" onClick={submitAnnotation}>
                Submit Note
              </Button>
            </Stack>
          </Popover>
        </div>

        {/* 7. Scope (disabled when not time-based, never hidden per §9.3) */}
        <div className="org-toolwell" role="group" aria-label="Scope tools" title="Scope">
          <Popover
            trigger={
              <Button
                variant="toolbar"
                disabled={disabled || !isTimeBased}
                aria-label="Annotation frame scope"
                title="Scope: Frame / Range (time-based media)"
              >
                <Icon name="video" size="sm" />
              </Button>
            }
          >
            <Stack gap="2">
              <Text size="sm" variant="muted">
                Annotation Scope
              </Text>
              <SegmentedControl
                size="sm"
                ariaLabel="Annotation scope mode"
                value={annotationScope}
                onChange={(val) => {
                  setAnnotationScope(val);
                  if (val === 'range' && annotationFrameOut <= annotationFrameIn) {
                    setAnnotationFrameRange(currentFrame, Math.min(frameEnd, currentFrame + 10));
                  }
                }}
                options={[
                  { value: 'frame', label: 'Frame' },
                  { value: 'range', label: 'Range' },
                ]}
              />
              {annotationScope === 'range' && (
                <>
                  <NumberField
                    label="In"
                    ariaLabel="Annotation frame in"
                    mode="int"
                    min={frameStart}
                    max={frameEnd}
                    value={annotationFrameIn}
                    onChange={(v) => setAnnotationFrameRange(v, Math.max(v, annotationFrameOut))}
                  />
                  <NumberField
                    label="Out"
                    ariaLabel="Annotation frame out"
                    mode="int"
                    min={annotationFrameIn}
                    max={frameEnd}
                    value={annotationFrameOut}
                    onChange={(v) => setAnnotationFrameRange(annotationFrameIn, v)}
                  />
                </>
              )}
              <Checkbox
                checked={ghostNeighbors}
                onChange={setGhostNeighbors}
                label="Ghost neighbor frames"
              />
            </Stack>
          </Popover>
        </div>

        {/* 8. 3D Tools (disabled when not live 3D, never hidden per §9.3) */}
        <div className="org-toolwell" role="group" aria-label="3D painting tools" title="3D">
          <Popover
            trigger={
              <Button
                variant="toolbar"
                disabled={disabled || !isLive3D}
                aria-label="3D Annotation Plane Settings"
                title="3D: Projection mode, surface offset, plane & smoothing"
              >
                <Icon name="ruler" size="sm" />
              </Button>
            }
          >
            <Stack gap="2">
              <Text size="sm" variant="muted">
                3D Painting & Plane
              </Text>
              <SegmentedControl<'surface' | 'float'>
                size="sm"
                ariaLabel="3D projection mode"
                value={projectionMode}
                onChange={(m) => onChangeProjectionMode?.(m)}
                options={[
                  { value: 'surface', label: 'Surface' },
                  { value: 'float', label: 'Float' },
                ]}
              />
              <Slider
                label="Offset"
                ariaLabel="Surface offset"
                value={surfaceOffset ?? 0.002}
                min={0.0001}
                max={1.0}
                step={0.001}
                precision={4}
                logarithmic
                onChange={(v) => onChangeSurfaceOffset?.(v)}
              />
              <Slider
                label="Smooth"
                ariaLabel="Stroke smoothing"
                value={strokeSmoothing}
                min={0}
                max={1}
                step={0.05}
                precision={2}
                onChange={(v) => onChangeStrokeSmoothing?.(v)}
              />
              <Slider
                label="Plane d"
                ariaLabel="Plane distance"
                value={activePlaneDistance}
                min={0.05}
                max={100}
                step={0.05}
                precision={2}
                logarithmic
                onChange={(d) =>
                  window.dispatchEvent(new CustomEvent('organum:update-plane-distance', { detail: d }))
                }
              />
              <Checkbox
                checked={lockPlane}
                onChange={(v) => onToggleLockPlane?.(v)}
                label="Lock current plane"
              />
              <Checkbox
                checked={planeDepthTest}
                onChange={(v) => onTogglePlaneDepthTest?.(v)}
                label="Depth test vs geometry"
              />
              <SegmentedControl<WidthMode>
                size="sm"
                ariaLabel="Stroke width mode"
                value={widthMode}
                onChange={(m) => onChangeWidthMode?.(m)}
                options={[
                  { value: 'world', label: 'World W' },
                  { value: 'screen', label: 'Screen W' },
                ]}
              />
              <Button
                size="sm"
                variant="primary"
                onClick={() => window.dispatchEvent(new CustomEvent('organum:new-plane'))}
              >
                New Plane
              </Button>
            </Stack>
          </Popover>

          <Tooltip content="Create New 3D Annotation Plane">
            <Button
              variant="toolbar"
              disabled={disabled || !isLive3D}
              aria-label="New 3D plane"
              onClick={() => window.dispatchEvent(new CustomEvent('organum:new-plane'))}
            >
              <Icon name="plus" size="sm" />
            </Button>
          </Tooltip>
        </div>
      </div>

      {canScrollDown && (
        <button
          type="button"
          className="org-vtoolstrip__chev"
          aria-label="Scroll tools down"
          onClick={() => scrollByDelta(60)}
        >
          <Icon name="chevron-down" size="sm" />
        </button>
      )}
    </ToolStrip>
  );
}
