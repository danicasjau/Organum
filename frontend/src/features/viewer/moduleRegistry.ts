import { lazy, type ComponentType } from 'react';
import type { FileSummaryOut, InspectionDocument } from '../../lib/api/client';
import type { AnnotationTool, PerFileViewerState } from './viewerStore';

const ImageViewer2D = lazy(() =>
  import('./modules/ImageViewer2D').then((m) => ({ default: m.ImageViewer2D })),
);
const Viewport3D = lazy(() =>
  import('./modules/Viewport3D').then((m) => ({ default: m.Viewport3D })),
);
const VideoViewer = lazy(() =>
  import('./modules/VideoViewer').then((m) => ({ default: m.VideoViewer })),
);
const AudioViewer = lazy(() =>
  import('./modules/AudioViewer').then((m) => ({ default: m.AudioViewer })),
);
const TimelineViewer = lazy(() =>
  import('./modules/TimelineViewer').then((m) => ({ default: m.TimelineViewer })),
);
const PdfViewer = lazy(() =>
  import('./modules/PdfViewer').then((m) => ({ default: m.PdfViewer })),
);
const DataViewer = lazy(() =>
  import('./modules/DataViewer').then((m) => ({ default: m.DataViewer })),
);
const UdimMosaicViewer = lazy(() =>
  import('./modules/UdimMosaicViewer').then((m) => ({ default: m.UdimMosaicViewer })),
);

export interface ViewerModuleProps {
  file: FileSummaryOut;
  inspection: InspectionDocument;
  viewerState: PerFileViewerState;
  onUpdateState: (patch: Partial<PerFileViewerState>) => void;
  activeTool: AnnotationTool;
  noteDraft: string;
  onNoteDraftChange: (note: string) => void;
}

type ViewerModuleComponent = ComponentType<ViewerModuleProps>;

const registry = new Map<string, ViewerModuleComponent>();

export function registerViewerModule(kind: string, component: ViewerModuleComponent): void {
  registry.set(kind, component);
}

export function getViewerModule(kind: string): ViewerModuleComponent | undefined {
  return registry.get(kind);
}

registerViewerModule('image2d', ImageViewer2D);
registerViewerModule('scene3d', Viewport3D);
registerViewerModule('video', VideoViewer);
registerViewerModule('audio', AudioViewer);
registerViewerModule('timeline', TimelineViewer);
registerViewerModule('document', PdfViewer);
registerViewerModule('data', DataViewer);
registerViewerModule('udim', UdimMosaicViewer);
