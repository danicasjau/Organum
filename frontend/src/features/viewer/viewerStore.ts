import { create } from 'zustand';

export type ChannelMode = 'RGB' | 'R' | 'G' | 'B' | 'A' | 'Y';
export type AnnotationTool = 'pan' | 'rect' | 'ellipse' | 'free' | 'closed' | 'eraser' | 'laser';
export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';
export type ShadingMode =
  | 'shaded'
  | 'flat'
  | 'wireframe'
  | 'shaded_wire'
  | 'normals'
  | 'depth'
  | 'unlit';
export type CameraMode = 'perspective' | 'ortho';
export type WidthMode = 'world' | 'screen';
export type ViewportBgMode = 'default' | 'black' | 'white' | 'gray' | 'gradient';
export type LoopMode = 'once' | 'loop' | 'pingpong';
export type AnnotationScope = 'frame' | 'range';

export interface CameraPose {
  position: [number, number, number];
  target: [number, number, number];
  up: [number, number, number];
  fov: number;
  orthographic: boolean;
  zoom: number;
}

export interface AnnotationPlaneData {
  origin: [number, number, number];
  normal: [number, number, number];
  up: [number, number, number];
  right: [number, number, number];
  distance: number;
  fov: number;
  widthMode: WidthMode;
  depthTest: boolean;
}

export interface PerFileViewerState {
  zoom: number; // 1 = 100%, -1 = fit
  panX: number;
  panY: number;
  colorspace: string;
  displayView: string;
  exposure: number;
  gamma: number;
  saturation: number;
  hue: number;
  channel: ChannelMode;
  pixelGrid: boolean;
  clipping: boolean;
  falseColor: boolean;
  bypass: boolean;
  frozen: boolean;
  activeAov: string | null;
  isolatedLayerId: string | null;
  hiddenLayerIds: string[];
  activePage: number;
  selectedUdimTiles: number[];
  // 3D state
  shadingMode: ShadingMode;
  cameraMode: CameraMode;
  projectionMode: 'surface' | 'float';
  surfaceOffset: number | null;
  planeDistance: number | null;
  lockPlane: boolean;
  widthMode: WidthMode;
  planeDepthTest: boolean;
  strokeSmoothing: number;
  activeTextureIndex: number | null;
  selectedPrimPath: string | null;
  cameraBookmarks: Array<{ name: string; pose: CameraPose }>;
  // Phase 4 time-based playback state
  currentFrame: number;
  inPoint: number | null;
  outPoint: number | null;
  loopMode: LoopMode;
  playbackSpeed: number;
}

export interface PixelReadout {
  x: number;
  y: number;
  src: [number, number, number, number];
  disp: [number, number, number, number];
  hex: string;
  udim?: number;
  uv?: [number, number];
}

export interface RoiStats {
  x: number;
  y: number;
  w: number;
  h: number;
  min: [number, number, number];
  max: [number, number, number];
  mean: [number, number, number];
}

export interface ImageHistogramData {
  r: number[];
  g: number[];
  b: number[];
  luma: number[];
}

export const DEFAULT_FILE_VIEWER_STATE: PerFileViewerState = {
  zoom: -1,
  panX: 0,
  panY: 0,
  colorspace: 'srgb',
  displayView: 'srgb',
  exposure: 0,
  gamma: 1,
  saturation: 1,
  hue: 0,
  channel: 'RGB',
  pixelGrid: true,
  clipping: false,
  falseColor: false,
  bypass: false,
  frozen: false,
  activeAov: null,
  isolatedLayerId: null,
  hiddenLayerIds: [],
  activePage: 0,
  selectedUdimTiles: [],
  shadingMode: 'shaded',
  cameraMode: 'perspective',
  projectionMode: 'surface',
  surfaceOffset: null,
  planeDistance: null,
  lockPlane: false,
  widthMode: 'world',
  planeDepthTest: true,
  strokeSmoothing: 0.35,
  activeTextureIndex: null,
  selectedPrimPath: null,
  cameraBookmarks: [],
  currentFrame: 0,
  inPoint: null,
  outPoint: null,
  loopMode: 'loop',
  playbackSpeed: 1,
};

function readInitialViewportBg(): ViewportBgMode {
  try {
    const raw = localStorage.getItem('organum.viewportBg');
    if (raw === 'default' || raw === 'black' || raw === 'white' || raw === 'gray' || raw === 'gradient') {
      return raw;
    }
  } catch {
    // ignore storage access issues
  }
  return 'default';
}

const MAX_LRU_ENTRIES = 50;

interface ViewerStoreState {
  activeFileId: string | null;
  lruOrder: string[];
  byFile: Record<string, PerFileViewerState>;
  activeTool: AnnotationTool;
  strokeColor: string;
  strokeSize: number;
  closedFill: boolean;
  showAnnotations: boolean;
  selectedAnnotationId: string | null;
  pixelReadout: PixelReadout | null;
  roiStats: RoiStats | null;
  imageHistogram: ImageHistogramData | null;
  saveStatus: SaveStatus;
  saveError: string | null;
  helpOpen: boolean;
  activePlaneDistance: number;
  viewportBg: ViewportBgMode;
  annotationScope: AnnotationScope;
  annotationFrameIn: number;
  annotationFrameOut: number;
  ghostNeighbors: boolean;

  selectFile: (fileId: string, detectedColorspace?: string | null) => void;
  updateFileState: (fileId: string, patch: Partial<PerFileViewerState>) => void;
  setActiveTool: (tool: AnnotationTool) => void;
  setStrokeColor: (color: string) => void;
  setStrokeSize: (size: number) => void;
  setClosedFill: (fill: boolean) => void;
  setShowAnnotations: (show: boolean) => void;
  setSelectedAnnotationId: (id: string | null) => void;
  setPixelReadout: (readout: PixelReadout | null) => void;
  setRoiStats: (stats: RoiStats | null) => void;
  setImageHistogram: (hist: ImageHistogramData | null) => void;
  setSaveStatus: (status: SaveStatus, error?: string | null) => void;
  setHelpOpen: (open: boolean) => void;
  setActivePlaneDistance: (d: number) => void;
  setViewportBg: (bg: ViewportBgMode) => void;
  setAnnotationScope: (scope: AnnotationScope) => void;
  setAnnotationFrameRange: (frameIn: number, frameOut: number) => void;
  setGhostNeighbors: (ghost: boolean) => void;
  resetForProjectSwitch: () => void;
}

export const useViewerStore = create<ViewerStoreState>((set) => ({
  activeFileId: null,
  lruOrder: [],
  byFile: {},
  activeTool: 'pan',
  strokeColor: '#8B5CF6',
  strokeSize: 3,
  closedFill: true,
  showAnnotations: true,
  selectedAnnotationId: null,
  pixelReadout: null,
  roiStats: null,
  imageHistogram: null,
  saveStatus: 'idle',
  saveError: null,
  helpOpen: false,
  activePlaneDistance: 2.0,
  viewportBg: readInitialViewportBg(),
  annotationScope: 'frame',
  annotationFrameIn: 0,
  annotationFrameOut: 0,
  ghostNeighbors: false,

  selectFile: (fileId, detectedColorspace) =>
    set((state) => {
      const nextOrder = [fileId, ...state.lruOrder.filter((id) => id !== fileId)];
      const nextByFile = { ...state.byFile };
      if (!nextByFile[fileId]) {
        nextByFile[fileId] = {
          ...DEFAULT_FILE_VIEWER_STATE,
          colorspace: detectedColorspace || DEFAULT_FILE_VIEWER_STATE.colorspace,
        };
      }
      while (nextOrder.length > MAX_LRU_ENTRIES) {
        const evicted = nextOrder.pop();
        if (evicted) delete nextByFile[evicted];
      }
      return {
        activeFileId: fileId,
        lruOrder: nextOrder,
        byFile: nextByFile,
        pixelReadout: null,
        roiStats: null,
        imageHistogram: null,
        selectedAnnotationId: null,
      };
    }),

  updateFileState: (fileId, patch) =>
    set((state) => {
      const current = state.byFile[fileId] ?? { ...DEFAULT_FILE_VIEWER_STATE };
      const nextOrder = [fileId, ...state.lruOrder.filter((id) => id !== fileId)];
      return {
        lruOrder: nextOrder,
        byFile: {
          ...state.byFile,
          [fileId]: { ...current, ...patch },
        },
      };
    }),

  setActiveTool: (activeTool) => set({ activeTool }),
  setStrokeColor: (strokeColor) => set({ strokeColor }),
  setStrokeSize: (strokeSize) => set({ strokeSize: Math.max(1, Math.min(64, strokeSize)) }),
  setClosedFill: (closedFill) => set({ closedFill }),
  setShowAnnotations: (showAnnotations) => set({ showAnnotations }),
  setSelectedAnnotationId: (selectedAnnotationId) => set({ selectedAnnotationId }),
  setPixelReadout: (pixelReadout) => set({ pixelReadout }),
  setRoiStats: (roiStats) => set({ roiStats }),
  setImageHistogram: (imageHistogram) => set({ imageHistogram }),
  setSaveStatus: (saveStatus, error = null) => set({ saveStatus, saveError: error }),
  setHelpOpen: (helpOpen) => set({ helpOpen }),
  setActivePlaneDistance: (activePlaneDistance) => set({ activePlaneDistance }),
  setViewportBg: (viewportBg) => {
    try {
      localStorage.setItem('organum.viewportBg', viewportBg);
    } catch {
      // ignore storage errors
    }
    set({ viewportBg });
  },
  setAnnotationScope: (annotationScope) => set({ annotationScope }),
  setAnnotationFrameRange: (frameIn, frameOut) =>
    set({ annotationFrameIn: frameIn, annotationFrameOut: Math.max(frameIn, frameOut) }),
  setGhostNeighbors: (ghostNeighbors) => set({ ghostNeighbors }),
  resetForProjectSwitch: () =>
    set({
      activeFileId: null,
      lruOrder: [],
      byFile: {},
      pixelReadout: null,
      roiStats: null,
      imageHistogram: null,
      selectedAnnotationId: null,
      saveStatus: 'idle',
      saveError: null,
    }),
}));
