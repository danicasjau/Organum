import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  Badge,
  Button,
  Icon,
  Popover,
  SegmentedControl,
  Select,
  Slider,
  Stack,
  Text,
  Tooltip,
  type SelectOption,
} from '../../components/ui';
import {
  DEFAULT_FILE_VIEWER_STATE,
  useViewerStore,
  type ChannelMode,
  type PerFileViewerState,
  type ShadingMode,
  type ViewportBgMode,
} from './viewerStore';
import './ViewerTopbar.css';

const INPUT_SPACES: SelectOption[] = [
  { value: 'srgb', label: 'sRGB' },
  { value: 'linear_srgb', label: 'Linear sRGB' },
  { value: 'rec709', label: 'Rec.709' },
  { value: 'acescg', label: 'ACEScg' },
  { value: 'aces2065_1', label: 'ACES2065-1' },
  { value: 'display_p3', label: 'Display P3' },
  { value: 'raw', label: 'Raw' },
];

const DISPLAY_VIEWS: SelectOption[] = [
  { value: 'srgb', label: 'sRGB' },
  { value: 'rec709', label: 'Rec.709' },
  { value: 'rec2020', label: 'Rec.2020' },
  { value: 'display_p3', label: 'Display P3' },
  { value: 'linear', label: 'Linear' },
  { value: 'raw', label: 'Raw' },
];

const ZOOM_PRESETS: SelectOption[] = [
  { value: 'fit', label: 'Fit' },
  { value: '0.5', label: '50%' },
  { value: '1', label: '100%' },
  { value: '2', label: '200%' },
  { value: '8', label: '800%' },
  { value: '24', label: '2400%' },
];

const SHADING_MODES: SelectOption[] = [
  { value: 'shaded', label: 'Shaded' },
  { value: 'flat', label: 'Flat' },
  { value: 'wireframe', label: 'Wire' },
  { value: 'shaded_wire', label: 'Shd+Wire' },
  { value: 'normals', label: 'Normals' },
  { value: 'depth', label: 'Depth' },
  { value: 'unlit', label: 'Unlit' },
];

const BG_OPTIONS: SelectOption[] = [
  { value: 'default', label: 'Default' },
  { value: 'black', label: 'Black' },
  { value: 'white', label: 'White' },
  { value: 'gray', label: 'Gray' },
  { value: 'gradient', label: 'Gradient' },
];

interface PriorityItem {
  id: string;
  priority: number; // smaller number = higher priority (stays inline longer)
  widthPx: number;
  element: ReactNode;
}

function partitionByPriority(
  items: ReadonlyArray<PriorityItem>,
  availableWidth: number,
): { visibleIds: Set<string>; overflowItems: PriorityItem[] } {
  if (availableWidth <= 0) {
    return { visibleIds: new Set(items.map((i) => i.id)), overflowItems: [] };
  }
  const byPrio = [...items].sort((a, b) => a.priority - b.priority);
  const totalNeeded = items.reduce((acc, it) => acc + it.widthPx + 4, 0);
  if (totalNeeded <= availableWidth) {
    return { visibleIds: new Set(items.map((i) => i.id)), overflowItems: [] };
  }

  const budget = Math.max(0, availableWidth - 32); // reserve space for "»" button
  let used = 0;
  const visibleIds = new Set<string>();
  for (const item of byPrio) {
    if (used + item.widthPx + 4 <= budget || visibleIds.size === 0) {
      visibleIds.add(item.id);
      used += item.widthPx + 4;
    }
  }
  const overflowItems = items.filter((it) => !visibleIds.has(it.id));
  return { visibleIds, overflowItems };
}

export interface UdimOverrideInfo {
  sequenceKind: 'none' | 'frames' | 'udim' | 'auto';
  isUserOverride: boolean;
  canToggleUdim: boolean;
  tileCount?: number;
}

export interface ViewerTopbarProps {
  mediaKind: string;
  detectedColorspace: string | null;
  hasColorspaceOverride: boolean;
  udimInfo?: UdimOverrideInfo | null;
  onToggleSequenceKind?: (nextKind: 'udim' | 'frames') => void;
  viewerState: PerFileViewerState;
  onUpdate: (patch: Partial<PerFileViewerState>) => void;
  onColorspaceChange: (space: string) => void;
}

export function ViewerTopbar({
  mediaKind,
  detectedColorspace,
  hasColorspaceOverride,
  udimInfo = null,
  onToggleSequenceKind,
  viewerState,
  onUpdate,
  onColorspaceChange,
}: ViewerTopbarProps) {
  const viewportBg = useViewerStore((s) => s.viewportBg);
  const setViewportBg = useViewerStore((s) => s.setViewportBg);
  const rowARef = useRef<HTMLDivElement>(null);
  const rowBRef = useRef<HTMLDivElement>(null);
  const [rowAWidth, setRowAWidth] = useState(0);
  const [rowBWidth, setRowBWidth] = useState(0);

  useEffect(() => {
    const elA = rowARef.current;
    const elB = rowBRef.current;
    if (!elA && !elB) return;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const w = Math.floor(entry.contentRect.width);
        if (entry.target === elA) setRowAWidth(w);
        if (entry.target === elB) setRowBWidth(w);
      }
    });
    if (elA) {
      setRowAWidth(Math.floor(elA.getBoundingClientRect().width));
      ro.observe(elA);
    }
    if (elB) {
      setRowBWidth(Math.floor(elB.getBoundingClientRect().width));
      ro.observe(elB);
    }
    return () => ro.disconnect();
  }, []);

  const is3D = mediaKind === 'scene3d';
  const isLive3D = is3D && !viewerState.frozen && viewerState.activeTextureIndex === null;
  const isVisualColor =
    mediaKind === 'image2d' ||
    mediaKind === 'udim' ||
    mediaKind === 'video' ||
    (is3D && (viewerState.frozen || viewerState.activeTextureIndex !== null));
  const isZoomable2D =
    mediaKind === 'image2d' ||
    mediaKind === 'udim' ||
    mediaKind === 'video' ||
    mediaKind === 'document' ||
    (is3D && (viewerState.frozen || viewerState.activeTextureIndex !== null));

  const zoomLabel =
    viewerState.zoom < 0 ? 'fit' : String(Number(viewerState.zoom.toFixed(2)));
  const zoomOptions: SelectOption[] = ZOOM_PRESETS.some((z) => z.value === zoomLabel)
    ? ZOOM_PRESETS
    : [
        ...ZOOM_PRESETS,
        { value: zoomLabel, label: `${Math.round(viewerState.zoom * 100)}%` },
      ];

  const rowAItems: PriorityItem[] = [
    {
      id: 'colorspace',
      priority: 1,
      widthPx: 94,
      element: (
        <div className="org-vtopbar__select">
          <Select
            ariaLabel="Input colorspace"
            filterable={false}
            disabled={!isVisualColor}
            dirty={hasColorspaceOverride}
            value={viewerState.colorspace}
            options={INPUT_SPACES.map((opt) => ({
              ...opt,
              label:
                detectedColorspace &&
                opt.label.toLowerCase().replace(/[^a-z0-9]/g, '') ===
                  detectedColorspace.toLowerCase().replace(/[^a-z0-9]/g, '')
                  ? `${opt.label} (auto)`
                  : opt.label,
            }))}
            onChange={onColorspaceChange}
          />
        </div>
      ),
    },
    {
      id: 'displayView',
      priority: 4,
      widthPx: 94,
      element: (
        <div className="org-vtopbar__select">
          <Select
            ariaLabel="Display view transform"
            filterable={false}
            disabled={!isVisualColor}
            value={viewerState.displayView}
            options={DISPLAY_VIEWS}
            onChange={(displayView) => onUpdate({ displayView })}
          />
        </div>
      ),
    },
    {
      id: 'channel',
      priority: is3D ? 11 : 3,
      widthPx: 148,
      element: (
        <SegmentedControl<ChannelMode>
          size="sm"
          ariaLabel="Channel selector"
          disabled={!isVisualColor}
          value={viewerState.channel}
          onChange={(channel) => onUpdate({ channel })}
          options={[
            { value: 'RGB', label: 'RGB', title: 'RGB Composite' },
            { value: 'R', label: 'R', title: 'Red (R)' },
            { value: 'G', label: 'G', title: 'Green (G)' },
            { value: 'B', label: 'B', title: 'Blue (B)' },
            { value: 'A', label: 'A', title: 'Alpha (A)' },
            { value: 'Y', label: 'Y', title: 'Luminance (Y)' },
          ]}
        />
      ),
    },
    {
      id: 'zoom',
      priority: 2,
      widthPx: 68,
      element: (
        <div className="org-vtopbar__zoom">
          <Select
            ariaLabel="Zoom level"
            filterable={false}
            disabled={!isZoomable2D}
            value={zoomLabel}
            options={zoomOptions}
            onChange={(val) => {
              if (val === 'fit') onUpdate({ zoom: -1, panX: 0, panY: 0 });
              else onUpdate({ zoom: Number(val) });
            }}
          />
        </div>
      ),
    },
    {
      id: 'grid',
      priority: 5,
      widthPx: 44,
      element: (
        <Tooltip content="Toggle pixel grid (visible >= 800%)">
          <Button
            variant="toggle"
            size="sm"
            disabled={!isVisualColor}
            pressed={viewerState.pixelGrid}
            onClick={() => onUpdate({ pixelGrid: !viewerState.pixelGrid })}
          >
            Grid
          </Button>
        </Tooltip>
      ),
    },
    {
      id: 'freeze',
      priority: is3D ? 2 : 13,
      widthPx: 54,
      element: (
        <Tooltip content="Freeze 3D frame for 2D pixel inspection" shortcut="Tab">
          <Button
            variant="toggle"
            size="sm"
            disabled={!is3D || viewerState.activeTextureIndex !== null}
            pressed={viewerState.frozen}
            onClick={() => onUpdate({ frozen: !viewerState.frozen })}
          >
            Freeze
          </Button>
        </Tooltip>
      ),
    },
    {
      id: 'clip',
      priority: 7,
      widthPx: 42,
      element: (
        <Tooltip content="Clipping overlay (out-of-gamut / >1.0 / <0.0)">
          <Button
            variant="toggle"
            size="sm"
            disabled={!isVisualColor}
            pressed={viewerState.clipping}
            onClick={() => onUpdate({ clipping: !viewerState.clipping })}
          >
            Clip
          </Button>
        </Tooltip>
      ),
    },
    {
      id: 'falseColor',
      priority: 6,
      widthPx: 66,
      element: (
        <Tooltip content="False color exposure / IRE overlay">
          <Button
            variant="toggle"
            size="sm"
            disabled={!isVisualColor}
            pressed={viewerState.falseColor}
            aria-label="False color"
            onClick={() => onUpdate({ falseColor: !viewerState.falseColor })}
          >
            False
          </Button>
        </Tooltip>
      ),
    },
    {
      id: 'bypass',
      priority: 8,
      widthPx: 56,
      element: (
        <Tooltip content="Bypass color adjustments" shortcut="S">
          <Button
            variant="toggle"
            size="sm"
            disabled={!isVisualColor}
            pressed={viewerState.bypass}
            onClick={() => onUpdate({ bypass: !viewerState.bypass })}
          >
            Bypass
          </Button>
        </Tooltip>
      ),
    },
    {
      id: 'viewBg',
      priority: 4,
      widthPx: 46,
      element: (
        <Popover
          trigger={
            <Button
              variant="default"
              size="sm"
              aria-label="View settings"
              title="Viewport background & display options"
            >
              View
            </Button>
          }
        >
          <Stack gap="2" className="org-vtopbar__view-pop">
            <Text size="sm" variant="muted">
              Viewport Background
            </Text>
            <Select
              ariaLabel="Viewport background"
              filterable={false}
              value={viewportBg}
              options={BG_OPTIONS}
              onChange={(val) => setViewportBg(val as ViewportBgMode)}
            />
          </Stack>
        </Popover>
      ),
    },
    {
      id: 'shading',
      priority: is3D ? 3 : 14,
      widthPx: 80,
      element: (
        <div className="org-vtopbar__shade">
          <Select
            ariaLabel="3D shading mode"
            filterable={false}
            disabled={!isLive3D}
            value={viewerState.shadingMode}
            options={SHADING_MODES}
            onChange={(val) => onUpdate({ shadingMode: val as ShadingMode })}
          />
        </div>
      ),
    },
    {
      id: 'cameraMode',
      priority: is3D ? 5 : 15,
      widthPx: 52,
      element: (
        <Tooltip content="Toggle Perspective / Orthographic camera">
          <Button
            variant="toggle"
            size="sm"
            disabled={!isLive3D}
            pressed={viewerState.cameraMode === 'ortho'}
            onClick={() =>
              onUpdate({
                cameraMode: viewerState.cameraMode === 'ortho' ? 'perspective' : 'ortho',
              })
            }
          >
            {viewerState.cameraMode === 'ortho' ? 'Ortho' : 'Persp'}
          </Button>
        </Tooltip>
      ),
    },
    {
      id: 'bookmarks',
      priority: is3D ? 9 : 16,
      widthPx: 48,
      element: (
        <Popover
          trigger={
            <Button
              size="sm"
              disabled={!isLive3D}
              aria-label="3D Camera Bookmarks"
              title="Camera bookmarks"
            >
              Bkm
            </Button>
          }
        >
          <Stack gap="1" className="org-vtopbar__view-pop">
            <Text size="sm" variant="muted">
              Camera Presets & Bookmarks
            </Text>
            <Button
              size="sm"
              onClick={() => window.dispatchEvent(new CustomEvent('organum:frame-all'))}
            >
              Frame All (F)
            </Button>
            <Button
              size="sm"
              onClick={() =>
                window.dispatchEvent(new CustomEvent('organum:set-view-preset', { detail: 'front' }))
              }
            >
              Front (1)
            </Button>
            <Button
              size="sm"
              onClick={() =>
                window.dispatchEvent(new CustomEvent('organum:set-view-preset', { detail: 'right' }))
              }
            >
              Right (3)
            </Button>
            <Button
              size="sm"
              onClick={() =>
                window.dispatchEvent(new CustomEvent('organum:set-view-preset', { detail: 'top' }))
              }
            >
              Top (7)
            </Button>
          </Stack>
        </Popover>
      ),
    },
  ];

  if (udimInfo && udimInfo.canToggleUdim && onToggleSequenceKind) {
    const isUdim = udimInfo.sequenceKind === 'udim';
    rowAItems.push({
      id: 'udimToggle',
      priority: 1,
      widthPx: 170,
      element: (
        <div className="org-vtopbar__group" data-ui="udim-override-control">
          <Badge tone="accent">
            {isUdim ? 'UDIM' : 'Frames'} ({udimInfo.isUserOverride ? 'override' : 'auto'})
          </Badge>
          <Button
            size="sm"
            onClick={() => onToggleSequenceKind(isUdim ? 'frames' : 'udim')}
          >
            {isUdim ? 'Treat as frames' : 'Treat as UDIM'}
          </Button>
        </div>
      ),
    });
  }

  const evDirty = Math.abs(viewerState.exposure - DEFAULT_FILE_VIEWER_STATE.exposure) > 1e-4;
  const gDirty = Math.abs(viewerState.gamma - DEFAULT_FILE_VIEWER_STATE.gamma) > 1e-4;
  const satDirty = Math.abs(viewerState.saturation - DEFAULT_FILE_VIEWER_STATE.saturation) > 1e-4;
  const hueDirty = Math.abs(viewerState.hue - DEFAULT_FILE_VIEWER_STATE.hue) > 1e-4;

  const rowBItems: PriorityItem[] = [
    {
      id: 'ev',
      priority: 1,
      widthPx: 192,
      element: (
        <div className="org-vtopbar__color org-vtopbar__color--ev">
          <span className="org-vtopbar__clabel">Ev</span>
          <Slider
            ariaLabel="Exposure stops slider"
            inputAriaLabel="Exposure stops"
            value={viewerState.exposure}
            baselineValue={DEFAULT_FILE_VIEWER_STATE.exposure}
            min={-12}
            max={12}
            softMin={-4}
            softMax={4}
            step={0.1}
            precision={2}
            disabled={!isVisualColor}
            onChange={(exposure) => onUpdate({ exposure })}
          />
          {evDirty && (
            <Button
              size="sm"
              variant="icon"
              aria-label="Reset Exposure"
              onClick={() => onUpdate({ exposure: DEFAULT_FILE_VIEWER_STATE.exposure })}
            >
              <Icon name="reset" size="sm" />
            </Button>
          )}
        </div>
      ),
    },
    {
      id: 'gamma',
      priority: 2,
      widthPx: 172,
      element: (
        <div className="org-vtopbar__color org-vtopbar__color--g">
          <span className="org-vtopbar__clabel">G</span>
          <Slider
            ariaLabel="Gamma slider"
            inputAriaLabel="Gamma"
            value={viewerState.gamma}
            baselineValue={DEFAULT_FILE_VIEWER_STATE.gamma}
            min={0.1}
            max={5}
            softMin={0.2}
            softMax={3}
            step={0.05}
            precision={2}
            disabled={!isVisualColor}
            onChange={(gamma) => onUpdate({ gamma })}
          />
          {gDirty && (
            <Button
              size="sm"
              variant="icon"
              aria-label="Reset Gamma"
              onClick={() => onUpdate({ gamma: DEFAULT_FILE_VIEWER_STATE.gamma })}
            >
              <Icon name="reset" size="sm" />
            </Button>
          )}
        </div>
      ),
    },
    {
      id: 'sat',
      priority: 3,
      widthPx: 172,
      element: (
        <div className="org-vtopbar__color org-vtopbar__color--sat">
          <span className="org-vtopbar__clabel">Sat</span>
          <Slider
            ariaLabel="Saturation slider"
            inputAriaLabel="Saturation"
            value={viewerState.saturation}
            baselineValue={DEFAULT_FILE_VIEWER_STATE.saturation}
            min={0}
            max={3}
            step={0.05}
            precision={2}
            disabled={!isVisualColor}
            onChange={(saturation) => onUpdate({ saturation })}
          />
          {satDirty && (
            <Button
              size="sm"
              variant="icon"
              aria-label="Reset Saturation"
              onClick={() => onUpdate({ saturation: DEFAULT_FILE_VIEWER_STATE.saturation })}
            >
              <Icon name="reset" size="sm" />
            </Button>
          )}
        </div>
      ),
    },
    {
      id: 'hue',
      priority: 4,
      widthPx: 172,
      element: (
        <div className="org-vtopbar__color org-vtopbar__color--hue">
          <span className="org-vtopbar__clabel">Hue</span>
          <Slider
            ariaLabel="Hue rotation slider"
            inputAriaLabel="Hue rotation"
            value={viewerState.hue}
            baselineValue={DEFAULT_FILE_VIEWER_STATE.hue}
            min={-180}
            max={180}
            step={1}
            precision={0}
            unit="°"
            disabled={!isVisualColor}
            onChange={(hue) => onUpdate({ hue })}
          />
          {hueDirty && (
            <Button
              size="sm"
              variant="icon"
              aria-label="Reset Hue"
              onClick={() => onUpdate({ hue: DEFAULT_FILE_VIEWER_STATE.hue })}
            >
              <Icon name="reset" size="sm" />
            </Button>
          )}
        </div>
      ),
    },
  ];

  const partA = partitionByPriority(rowAItems, rowAWidth);
  const partB = partitionByPriority(rowBItems, rowBWidth);

  return (
    <div data-ui="viewer-topbar" role="toolbar" aria-label="Viewer controls" className="org-vtopbar">
      <div ref={rowARef} className="org-vtopbar__row" data-row="a">
        <div className="org-vtopbar__row-items">
          {rowAItems
            .filter((it) => partA.visibleIds.has(it.id))
            .map((it) => (
              <div key={it.id} className="org-vtopbar__item">
                {it.element}
              </div>
            ))}
        </div>
        {partA.overflowItems.length > 0 && (
          <Popover
            trigger={
              <Button size="sm" aria-label="More viewer controls" title="More viewer controls">
                »
              </Button>
            }
          >
            <Stack gap="2" className="org-vtopbar__overflow-pop">
              {partA.overflowItems.map((it) => (
                <div key={it.id} className="org-vtopbar__overflow-item">
                  {it.element}
                </div>
              ))}
            </Stack>
          </Popover>
        )}
      </div>

      <div ref={rowBRef} className="org-vtopbar__row org-vtopbar__row--color" data-row="b">
        <div className="org-vtopbar__row-items">
          {rowBItems
            .filter((it) => partB.visibleIds.has(it.id))
            .map((it) => (
              <div key={it.id} className="org-vtopbar__item">
                {it.element}
              </div>
            ))}
        </div>
        {partB.overflowItems.length > 0 && (
          <Popover
            trigger={
              <Button size="sm" aria-label="More color controls" title="More color controls">
                »
              </Button>
            }
          >
            <Stack gap="2" className="org-vtopbar__overflow-pop">
              {partB.overflowItems.map((it) => (
                <div key={it.id} className="org-vtopbar__overflow-item">
                  {it.element}
                </div>
              ))}
            </Stack>
          </Popover>
        )}
      </div>
    </div>
  );
}
