import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import {
  Badge,
  Button,
  Icon,
  readCssToken,
  Spinner,
  Text,
  Timebar,
  TransportControls,
} from '../../../components/ui';
import {
  apiClient,
  isScenefilePreviewId,
  type FileSummaryOut,
  type InspectionDocument,
} from '../../../lib/api/client';
import { useProjectStore } from '../../project/projectStore';
import {
  useViewerStore,
  type AnnotationPlaneData,
  type AnnotationTool,
  type CameraPose,
  type LoopMode,
  type PerFileViewerState,
  type ShadingMode,
} from '../viewerStore';
import { ImageViewer2D, type DirectImageBuffer } from './ImageViewer2D';
import {
  buildClosedFillGeometry,
  buildPlanePreviewOutline,
  buildStrokeRibbonGeometry,
  computeDefaultPlaneDistance,
  createAnnotationPlane,
  extractCameraPose,
  pixelSizeToPlaneWidth,
  raycastToPlaneLocal,
  rescalePlaneDistance,
  type Stroke3D,
} from './annotationPlane3D';
import { createInfiniteGrid } from './infiniteGrid';
import './Viewport3D.css';

interface Viewport3DProps {
  file: FileSummaryOut;
  inspection: InspectionDocument;
  viewerState: PerFileViewerState;
  onUpdateState: (patch: Partial<PerFileViewerState>) => void;
  activeTool: AnnotationTool;
  noteDraft: string;
  onNoteDraftChange: (note: string) => void;
}

interface Laser3D {
  stroke: Stroke3D;
  plane: AnnotationPlaneData;
  createdAt: number;
}

const LASER_MS = 1500;

export function Viewport3D({
  file,
  inspection,
  viewerState,
  onUpdateState,
  activeTool,
  noteDraft,
  onNoteDraftChange,
}: Viewport3DProps) {
  const queryClient = useQueryClient();
  const activeProjectUuid = useProjectStore((s) => s.activeProjectUuid);
  const mountRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const modelRootRef = useRef<THREE.Group | null>(null);
  const annoGroupRef = useRef<THREE.Group | null>(null);
  const laserGroupRef = useRef<THREE.Group | null>(null);
  const previewGroupRef = useRef<THREE.Group | null>(null);
  const perspCamRef = useRef<THREE.PerspectiveCamera | null>(null);
  const orthoCamRef = useRef<THREE.OrthographicCamera | null>(null);
  const targetRef = useRef(new THREE.Vector3(0, 0, 0));
  const bboxRef = useRef(new THREE.Box3(new THREE.Vector3(-1, -1, -1), new THREE.Vector3(1, 1, 1)));
  const origMaterialsRef = useRef<Map<THREE.Mesh, THREE.Material | THREE.Material[]>>(new Map());
  const selectedMeshRef = useRef<THREE.Mesh | null>(null);
  const activePlaneRef = useRef<AnnotationPlaneData | null>(null);
  const cameraMovedSinceStrokeRef = useRef(false);
  const lastFreezeKeyRef = useRef<string | null>(null);
  const cachedFreezeBufRef = useRef<DirectImageBuffer | null>(null);
  const cachedFreezeCamRef = useRef<Record<string, unknown> | null>(null);
  const laserListRef = useRef<Laser3D[]>([]);
  const mixerRef = useRef<THREE.AnimationMixer | null>(null);

  const [hasAnim, setHasAnim] = useState(false);
  const [animEndFrame, setAnimEndFrame] = useState(48);
  const [animPlayState, setAnimPlayState] = useState<'paused' | 'forward' | 'reverse'>('paused');

  const strokeColor = useViewerStore((s) => s.strokeColor);
  const strokeSize = useViewerStore((s) => s.strokeSize);
  const closedFill = useViewerStore((s) => s.closedFill);
  const showAnnotations = useViewerStore((s) => s.showAnnotations);
  const setSaveStatus = useViewerStore((s) => s.setSaveStatus);
  const setActivePlaneDistance = useViewerStore((s) => s.setActivePlaneDistance);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState({ tris: 0, verts: 0, fps: 60 });
  const [gizmoAxes, setGizmoAxes] = useState<Array<{ label: string; x: number; y: number; color: string }>>([
    { label: 'X', x: 34, y: 20, color: readCssToken('--axis-x', '#c77a7a') },
    { label: 'Y', x: 20, y: 6, color: readCssToken('--axis-y', '#8fb86a') },
    { label: 'Z', x: 12, y: 28, color: readCssToken('--axis-z', '#7a9cc6') },
  ]);

  const [frozenBuffer, setFrozenBuffer] = useState<DirectImageBuffer | null>(null);
  const [frozenCameraJson, setFrozenCameraJson] = useState<Record<string, unknown> | null>(null);

  const [activeAnnId, setActiveAnnId] = useState<string | null>(null);
  const [strokes3D, setStrokes3D] = useState<Stroke3D[]>([]);
  const [draftStroke3D, setDraftStroke3D] = useState<Stroke3D | null>(null);
  const [undoStack, setUndoStack] = useState<Stroke3D[][]>([]);
  const [redoStack, setRedoStack] = useState<Stroke3D[][]>([]);

  const activeAnnIdRef = useRef<string | null>(null);
  activeAnnIdRef.current = activeAnnId;
  const hydratedFileRef = useRef<string | null>(null);
  const savingRef = useRef(false);
  const autosaveTimerRef = useRef<number | null>(null);

  const { data: savedAnnotations = [], isFetching: annFetching } = useQuery({
    queryKey: ['annotations', activeProjectUuid, file.id],
    queryFn: () => apiClient.listAnnotations(file.id, activeProjectUuid),
    enabled: Boolean(activeProjectUuid && file.id && !isScenefilePreviewId(file.id)),
  });

  // Sync saved 3D annotations
  useEffect(() => {
    hydratedFileRef.current = null;
    activeAnnIdRef.current = null;
    setActiveAnnId(null);
    setStrokes3D([]);
    onNoteDraftChange('');
    setUndoStack([]);
    setRedoStack([]);
    activePlaneRef.current = null;
    lastFreezeKeyRef.current = null;
    cachedFreezeBufRef.current = null;
    setFrozenBuffer(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file.id]);

  useEffect(() => {
    if (annFetching || savingRef.current || !activeAnnId) return;
    if (!savedAnnotations.some((a) => a.id === activeAnnId)) {
      activeAnnIdRef.current = null;
      setActiveAnnId(null);
      setStrokes3D([]);
      onNoteDraftChange('');
      hydratedFileRef.current = file.id;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedAnnotations, annFetching, activeAnnId, file.id]);

  const getActiveCamera = useCallback((): THREE.PerspectiveCamera | THREE.OrthographicCamera => {
    return viewerState.cameraMode === 'ortho' ? orthoCamRef.current! : perspCamRef.current!;
  }, [viewerState.cameraMode]);

  const syncOrthoFrustum = useCallback(() => {
    const mount = mountRef.current;
    const persp = perspCamRef.current;
    const ortho = orthoCamRef.current;
    if (!mount || !persp || !ortho) return;
    const aspect = Math.max(0.1, mount.clientWidth / Math.max(1, mount.clientHeight));
    const dist = Math.max(0.01, persp.position.distanceTo(targetRef.current));
    const halfH = dist * Math.tan(THREE.MathUtils.degToRad(persp.fov / 2));
    ortho.left = -halfH * aspect;
    ortho.right = halfH * aspect;
    ortho.top = halfH;
    ortho.bottom = -halfH;
    ortho.position.copy(persp.position);
    ortho.quaternion.copy(persp.quaternion);
    ortho.up.copy(persp.up);
    ortho.near = Math.max(1e-5, dist * 1e-4);
    ortho.far = Math.max(1000, dist * 200);
    ortho.updateProjectionMatrix();
  }, []);

  const frameBox = useCallback(
    (box: THREE.Box3) => {
      const persp = perspCamRef.current;
      if (!persp || box.isEmpty()) return;
      const center = new THREE.Vector3();
      const size = new THREE.Vector3();
      box.getCenter(center);
      box.getSize(size);
      const radius = Math.max(0.05, size.length() * 0.5);
      const fovRad = THREE.MathUtils.degToRad(persp.fov);
      const dist = (radius * 1.2) / Math.sin(fovRad / 2);

      const dir = new THREE.Vector3(0.65, 0.45, 0.75).normalize();
      targetRef.current.copy(center);
      persp.position.copy(center).addScaledVector(dir, dist);
      persp.up.set(0, 1, 0);
      persp.lookAt(center);
      persp.near = Math.max(1e-5, dist * 1e-4);
      persp.far = Math.max(1000, dist * 200);
      persp.updateProjectionMatrix();
      syncOrthoFrustum();

      const meshes = modelRootRef.current ? [modelRootRef.current] : [];
      const d = computeDefaultPlaneDistance(persp, meshes, bboxRef.current);
      setActivePlaneDistance(d);
    },
    [setActivePlaneDistance, syncOrthoFrustum],
  );

  // Apply shading mode
  const applyShading = useCallback((mode: ShadingMode) => {
    const root = modelRootRef.current;
    if (!root) return;
    root.traverse((obj) => {
      if (!(obj instanceof THREE.Mesh)) return;
      const orig = origMaterialsRef.current.get(obj);
      if (!orig) return;
      if (obj.userData.__wireOverlay) {
        obj.visible = mode === 'shaded_wire';
        return;
      }
      if (mode === 'shaded') {
        obj.material = orig;
      } else if (mode === 'flat') {
        const cloned = Array.isArray(orig)
          ? orig.map((m) => {
              const c = m.clone();
              if ('flatShading' in c) (c as THREE.MeshStandardMaterial).flatShading = true;
              c.needsUpdate = true;
              return c;
            })
          : (() => {
              const c = orig.clone();
              if ('flatShading' in c) (c as THREE.MeshStandardMaterial).flatShading = true;
              c.needsUpdate = true;
              return c;
            })();
        obj.material = cloned;
      } else if (mode === 'wireframe') {
        obj.material = new THREE.MeshBasicMaterial({
          color: readCssToken('--vp-wire', '#74a6d4'),
          wireframe: true,
        });
      } else if (mode === 'shaded_wire') {
        obj.material = orig;
      } else if (mode === 'normals') {
        obj.material = new THREE.MeshNormalMaterial();
      } else if (mode === 'depth') {
        obj.material = new THREE.MeshDepthMaterial();
      } else if (mode === 'unlit') {
        const src = Array.isArray(orig) ? orig[0] : orig;
        const map = src && 'map' in src ? (src as THREE.MeshStandardMaterial).map : null;
        const col = src && 'color' in src ? (src as THREE.MeshStandardMaterial).color : new THREE.Color('#CBD5E1');
        obj.material = new THREE.MeshBasicMaterial({ map, color: col });
      }
    });
  }, []);

  // Initialize Three.js WebGL2 scene & render loop
  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    const width = Math.max(1, container.clientWidth);
    const height = Math.max(1, container.clientHeight);
    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      logarithmicDepthBuffer: true,
      preserveDrawingBuffer: true,
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(width, height);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    const scene = new THREE.Scene();
    sceneRef.current = scene;

    // 3-light rig
    const hemi = new THREE.HemisphereLight('#E2E8F0', '#1E293B', 0.85);
    const key = new THREE.DirectionalLight('#FFFFFF', 1.4);
    key.position.set(6, 10, 8);
    const fill = new THREE.DirectionalLight('#93C5FD', 0.55);
    fill.position.set(-8, 4, -4);
    const rim = new THREE.DirectionalLight('#C4B5FD', 0.45);
    rim.position.set(0, -4, -10);
    scene.add(hemi, key, fill, rim);

    const grid = createInfiniteGrid();
    scene.add(grid.mesh);

    const modelRoot = new THREE.Group();
    const annoGroup = new THREE.Group();
    const laserGroup = new THREE.Group();
    const previewGroup = new THREE.Group();
    scene.add(modelRoot, annoGroup, laserGroup, previewGroup);
    modelRootRef.current = modelRoot;
    annoGroupRef.current = annoGroup;
    laserGroupRef.current = laserGroup;
    previewGroupRef.current = previewGroup;

    const persp = new THREE.PerspectiveCamera(45, width / height, 1e-4, 1e6);
    persp.position.set(3, 2, 4);
    persp.lookAt(0, 0, 0);
    perspCamRef.current = persp;

    const ortho = new THREE.OrthographicCamera(-2, 2, 2, -2, 1e-4, 1e6);
    orthoCamRef.current = ortho;

    const ro = new ResizeObserver((entries) => {
      const r = entries[0]?.contentRect;
      if (!r || r.width < 1 || r.height < 1) return;
      renderer.setSize(Math.floor(r.width), Math.floor(r.height));
      persp.aspect = r.width / r.height;
      persp.updateProjectionMatrix();
      syncOrthoFrustum();
    });
    ro.observe(container);

    let vpThemeSeen: string | null | undefined;
    let vpBgDefault = '#1a1a1a';
    let vpBgGray = '#4b4b4b';
    let axisX = readCssToken('--axis-x', '#c77a7a');
    let axisY = readCssToken('--axis-y', '#8fb86a');
    let axisZ = readCssToken('--axis-z', '#7a9cc6');
    let gradTexDark: THREE.CanvasTexture | null = null;
    let gradTexLight: THREE.CanvasTexture | null = null;
    const getGradTex = (dark: boolean): THREE.CanvasTexture => {
      if (dark && gradTexDark) return gradTexDark;
      if (!dark && gradTexLight) return gradTexLight;
      const cv = document.createElement('canvas');
      cv.width = 2;
      cv.height = 256;
      const ctx = cv.getContext('2d')!;
      const g = ctx.createLinearGradient(0, 0, 0, 256);
      if (dark) {
        g.addColorStop(0, readCssToken('--vp-grad-top', '#2e2e2e'));
        g.addColorStop(1, readCssToken('--vp-grad-bottom', '#121212'));
      } else {
        g.addColorStop(0, readCssToken('--vp-grad-top', '#ece8e1'));
        g.addColorStop(1, readCssToken('--vp-grad-bottom', '#c9c4b9'));
      }
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, 2, 256);
      const tex = new THREE.CanvasTexture(cv);
      tex.colorSpace = THREE.SRGBColorSpace;
      if (dark) gradTexDark = tex;
      else gradTexLight = tex;
      return tex;
    };

    let rafId = 0;
    let frameCount = 0;
    let lastFpsAt = performance.now();

    const animate = () => {
      rafId = requestAnimationFrame(animate);
      const themeAttr = document.documentElement.getAttribute('data-theme');
      const isDark = themeAttr !== 'light' && themeAttr !== 'paper';
      if (themeAttr !== vpThemeSeen) {
        vpThemeSeen = themeAttr;
        vpBgDefault = readCssToken('--vp-bg-default', isDark ? '#1a1a1a' : '#dedad2');
        vpBgGray = readCssToken('--vp-bg-gray', '#4b4b4b');
        axisX = readCssToken('--axis-x', axisX);
        axisY = readCssToken('--axis-y', axisY);
        axisZ = readCssToken('--axis-z', axisZ);
        gradTexDark = null;
        gradTexLight = null;
      }
      const bgMode = useViewerStore.getState().viewportBg;
      if (bgMode === 'black') scene.background = new THREE.Color('#000000');
      else if (bgMode === 'white') scene.background = new THREE.Color('#FFFFFF');
      else if (bgMode === 'gray') scene.background = new THREE.Color(vpBgGray);
      else if (bgMode === 'gradient') scene.background = getGradTex(isDark);
      else scene.background = new THREE.Color(vpBgDefault);
      const cam =
        useViewerStore.getState().byFile[file.id]?.cameraMode === 'ortho' ? ortho : persp;
      grid.update(cam, isDark && bgMode !== 'white');

      // Update ephemeral 3D laser ribbons
      const now = performance.now();
      laserListRef.current = laserListRef.current.filter((l) => now - l.createdAt < LASER_MS);
      while (laserGroup.children.length > 0) {
        const ch = laserGroup.children.pop()!;
        if (ch instanceof THREE.Mesh) {
          ch.geometry.dispose();
          (ch.material as THREE.Material).dispose();
        }
      }
      for (const l of laserListRef.current) {
        const alpha = Math.max(0, 1 - (now - l.createdAt) / LASER_MS);
        const g = buildStrokeRibbonGeometry(l.stroke, l.plane);
        const m = new THREE.MeshBasicMaterial({
          color: '#EF4444',
          transparent: true,
          opacity: alpha,
          side: THREE.DoubleSide,
          depthTest: false,
        });
        laserGroup.add(new THREE.Mesh(g, m));
      }

      renderer.render(scene, cam);

      frameCount++;
      if (now - lastFpsAt >= 500) {
        const fps = Math.round((frameCount * 1000) / (now - lastFpsAt));
        setStats((prev) => ({ ...prev, fps }));
        frameCount = 0;
        lastFpsAt = now;

        // Project world axes into 40x40 gizmo
        const invQ = cam.quaternion.clone().invert();
        const axes = [
          { label: 'X', vec: new THREE.Vector3(1, 0, 0), color: axisX },
          { label: 'Y', vec: new THREE.Vector3(0, 1, 0), color: axisY },
          { label: 'Z', vec: new THREE.Vector3(0, 0, 1), color: axisZ },
        ].map((a) => {
          const v = a.vec.applyQuaternion(invQ);
          return { label: a.label, x: 20 + v.x * 14, y: 20 - v.y * 14, color: a.color };
        });
        setGizmoAxes(axes);
      }
    };
    rafId = requestAnimationFrame(animate);

    return () => {
      cancelAnimationFrame(rafId);
      ro.disconnect();
      grid.dispose();
      gradTexDark?.dispose();
      gradTexLight?.dispose();
      renderer.dispose();
      renderer.domElement.remove();
      rendererRef.current = null;
    };
  }, [file.id, syncOrthoFrustum]);

  // Load canonical GLB for file
  useEffect(() => {
    let cancelled = false;
    async function loadScene() {
      setLoading(true);
      setError(null);
      const modelRoot = modelRootRef.current;
      if (!modelRoot) return;
      while (modelRoot.children.length > 0) {
        modelRoot.remove(modelRoot.children[0]!);
      }
      origMaterialsRef.current.clear();
      selectedMeshRef.current = null;

      try {
        const art = await apiClient.createArtifact(file.id, 'scene_glb', {});
        const loader = new GLTFLoader();
        const gltf = await loader.loadAsync(art.content_url);
        if (cancelled) return;

        let tris = 0;
        let verts = 0;
        const origMeshes: THREE.Mesh[] = [];
        gltf.scene.traverse((obj) => {
          if (obj instanceof THREE.Mesh) origMeshes.push(obj);
        });
        for (const obj of origMeshes) {
          origMaterialsRef.current.set(obj, obj.material);
          const g = obj.geometry;
          const pos = g.getAttribute('position');
          if (pos) verts += pos.count;
          tris += g.index ? g.index.count / 3 : pos ? pos.count / 3 : 0;

          const wireOverlay = new THREE.Mesh(
            g,
            new THREE.MeshBasicMaterial({
              color: readCssToken('--vp-wire', '#74a6d4'),
              wireframe: true,
              transparent: true,
              opacity: 0.45,
            }),
          );
          wireOverlay.userData.__wireOverlay = true;
          wireOverlay.visible = false;
          obj.add(wireOverlay);
        }

        modelRoot.add(gltf.scene);
        if (gltf.animations && gltf.animations.length > 0) {
          const mixer = new THREE.AnimationMixer(gltf.scene);
          const clip = gltf.animations[0]!;
          mixer.clipAction(clip).play();
          mixer.setTime(0);
          mixerRef.current = mixer;
          setHasAnim(true);
          setAnimEndFrame(Math.max(1, Math.round((clip.duration || 2.0) * 24)));
        } else {
          mixerRef.current = null;
          setHasAnim(false);
        }
        const box = new THREE.Box3().setFromObject(modelRoot);
        bboxRef.current.copy(box);
        setStats((s) => ({ ...s, tris: Math.round(tris), verts }));
        frameBox(box);
        applyShading(viewerState.shadingMode);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load 3D scene');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void loadScene();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file.id]);

  // Scrub animated 3D mixer & playback loop
  useEffect(() => {
    if (hasAnim && mixerRef.current) {
      mixerRef.current.setTime(viewerState.currentFrame / 24);
    }
  }, [hasAnim, viewerState.currentFrame]);

  useEffect(() => {
    if (!hasAnim || animPlayState === 'paused') return;
    const dir = animPlayState === 'forward' ? 1 : -1;
    const ms = Math.max(16, Math.round(1000 / (24 * viewerState.playbackSpeed)));
    const id = window.setInterval(() => {
      const next = viewerState.currentFrame + dir;
      if (next < 0 || next > animEndFrame) {
        if (viewerState.loopMode === 'loop') {
          onUpdateState({ currentFrame: dir > 0 ? 0 : animEndFrame });
        } else {
          setAnimPlayState('paused');
        }
      } else {
        onUpdateState({ currentFrame: next });
      }
    }, ms);
    return () => window.clearInterval(id);
  }, [hasAnim, animPlayState, animEndFrame, viewerState.currentFrame, viewerState.playbackSpeed, viewerState.loopMode, onUpdateState]);

  // React to shading mode changes
  useEffect(() => {
    applyShading(viewerState.shadingMode);
  }, [viewerState.shadingMode, applyShading]);

  // Rebuild 3D annotation ribbon meshes whenever saved annotations, active strokes, or visibility change
  useEffect(() => {
    const group = annoGroupRef.current;
    if (!group) return;
    while (group.children.length > 0) {
      const c = group.children.pop()!;
      if (c instanceof THREE.Mesh) {
        c.geometry.dispose();
        (c.material as THREE.Material).dispose();
      }
    }
    if (!showAnnotations) return;

    const renderAnnotationSet = (
      strokes: ReadonlyArray<Stroke3D>,
      plane: AnnotationPlaneData,
    ) => {
      for (const s of strokes) {
        const g = buildStrokeRibbonGeometry(s, plane);
        const m = new THREE.MeshBasicMaterial({
          color: s.color,
          side: THREE.DoubleSide,
          depthTest: plane.depthTest,
          depthWrite: false,
        });
        group.add(new THREE.Mesh(g, m));
        const fillG = buildClosedFillGeometry(s, plane);
        if (fillG) {
          const fm = new THREE.MeshBasicMaterial({
            color: s.color,
            transparent: true,
            opacity: 0.2,
            side: THREE.DoubleSide,
            depthTest: plane.depthTest,
            depthWrite: false,
          });
          group.add(new THREE.Mesh(fillG, fm));
        }
      }
    };

    // Other saved 3D annotations
    for (const ann of savedAnnotations) {
      if (ann.kind !== '3d' || ann.id === activeAnnId || !ann.plane_json) continue;
      renderAnnotationSet(
        (ann.vector_json as unknown as Stroke3D[]) ?? [],
        ann.plane_json as unknown as AnnotationPlaneData,
      );
    }

    // Current session strokes + live draft
    const activePlane = activePlaneRef.current;
    if (activePlane) {
      renderAnnotationSet(strokes3D, activePlane);
      if (draftStroke3D) renderAnnotationSet([draftStroke3D], activePlane);
    }
  }, [savedAnnotations, activeAnnId, strokes3D, draftStroke3D, showAnnotations]);

  // Update preview plane outline
  const refreshPreviewOutline = useCallback((plane: AnnotationPlaneData | null) => {
    const pg = previewGroupRef.current;
    if (!pg) return;
    while (pg.children.length > 0) {
      const c = pg.children.pop()!;
      if (c instanceof THREE.LineLoop) {
        c.geometry.dispose();
        (c.material as THREE.Material).dispose();
      }
    }
    if (!plane || !mountRef.current) return;
    const aspect = mountRef.current.clientWidth / Math.max(1, mountRef.current.clientHeight);
    const geom = buildPlanePreviewOutline(plane, aspect);
    const mat = new THREE.LineBasicMaterial({
      color: readCssToken('--vp-gizmo', '#5b93c7'),
      depthTest: false,
    });
    pg.add(new THREE.LineLoop(geom, mat));
  }, []);

  // Handle Freeze Frame capture <-> instant toggle
  useEffect(() => {
    if (!viewerState.frozen) return;
    const renderer = rendererRef.current;
    const scene = sceneRef.current;
    if (!renderer || !scene) return;
    const cam = getActiveCamera();
    const pose = extractCameraPose(cam, targetRef.current);
    const key = JSON.stringify({ pose, shading: viewerState.shadingMode });

    if (lastFreezeKeyRef.current === key && cachedFreezeBufRef.current) {
      setFrozenBuffer(cachedFreezeBufRef.current);
      setFrozenCameraJson(cachedFreezeCamRef.current);
      return;
    }

    const size = new THREE.Vector2();
    renderer.getSize(size);
    const w = Math.max(1, Math.floor(size.x));
    const h = Math.max(1, Math.floor(size.y));

    const rt = new THREE.WebGLRenderTarget(w, h, {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      format: THREE.RGBAFormat,
      type: THREE.UnsignedByteType,
    });
    const prevTarget = renderer.getRenderTarget();
    renderer.setRenderTarget(rt);
    renderer.render(scene, cam);
    const raw = new Uint8Array(w * h * 4);
    renderer.readRenderTargetPixels(rt, 0, 0, w, h, raw);
    renderer.setRenderTarget(prevTarget);
    rt.dispose();

    // Flip Y for top-left 2D image coordinates
    const flipped = new Uint8Array(w * h * 4);
    const rowBytes = w * 4;
    for (let y = 0; y < h; y++) {
      flipped.set(raw.subarray((h - 1 - y) * rowBytes, (h - y) * rowBytes), y * rowBytes);
    }

    const buf: DirectImageBuffer = {
      width: w,
      height: h,
      isFloat: false,
      floatData: null,
      uint8Data: flipped,
    };
    const camJson = pose as unknown as Record<string, unknown>;
    lastFreezeKeyRef.current = key;
    cachedFreezeBufRef.current = buf;
    cachedFreezeCamRef.current = camJson;
    setFrozenBuffer(buf);
    setFrozenCameraJson(camJson);
  }, [viewerState.frozen, viewerState.shadingMode, getActiveCamera]);

  // Persist 3D annotations
  const persist3D = useCallback(
    async (
      nextStrokes: Stroke3D[],
      nextPlane: AnnotationPlaneData | null,
      nextNote: string,
      annId: string | null,
      detachedFlush = false,
    ) => {
      if (!nextPlane && !annId) return;
      if (nextStrokes.length === 0 && !nextNote.trim() && !annId) return;
      savingRef.current = true;
      setSaveStatus('saving');
      try {
        const camPose = extractCameraPose(getActiveCamera(), targetRef.current);
        if (annId) {
          await apiClient.updateAnnotation(file.id, annId, {
            note_text: nextNote,
            vector_json: nextStrokes as unknown as Array<Record<string, unknown>>,
            plane_json: (nextPlane ?? undefined) as unknown as Record<string, unknown> | undefined,
            camera_json: camPose as unknown as Record<string, unknown>,
          });
        } else {
          const created = await apiClient.createAnnotation(file.id, {
            kind: '3d',
            note_text: nextNote,
            vector_json: nextStrokes as unknown as Array<Record<string, unknown>>,
            plane_json: nextPlane as unknown as Record<string, unknown>,
            camera_json: camPose as unknown as Record<string, unknown>,
          });
          if (!detachedFlush) {
            hydratedFileRef.current = file.id;
            activeAnnIdRef.current = created.id;
            setActiveAnnId(created.id);
          }
        }
        await queryClient.refetchQueries({
          queryKey: ['annotations', activeProjectUuid, file.id],
        });
        setSaveStatus('saved');
      } catch (err) {
        setSaveStatus('error', err instanceof Error ? err.message : '3D annotation save failed');
      } finally {
        savingRef.current = false;
      }
    },
    [activeProjectUuid, file.id, getActiveCamera, queryClient, setSaveStatus],
  );

  const scheduleAutosave3D = useCallback(
    (nextStrokes: Stroke3D[], plane: AnnotationPlaneData | null, nextNote: string) => {
      if (autosaveTimerRef.current) window.clearTimeout(autosaveTimerRef.current);
      setSaveStatus('saving');
      autosaveTimerRef.current = window.setTimeout(() => {
        void persist3D(nextStrokes, plane, nextNote, activeAnnIdRef.current);
      }, 450);
    },
    [persist3D, setSaveStatus],
  );

  // Mark perspective changed when cameraMode toggles
  useEffect(() => {
    cameraMovedSinceStrokeRef.current = true;
  }, [viewerState.cameraMode]);

  // Explicit submit (Enter or Submit button) saves current 3D annotation & starts a fresh session
  useEffect(() => {
    const onSubmitAnn = async (e: Event) => {
      const ce = e as CustomEvent<{ handled?: boolean }>;
      if (ce.detail) ce.detail.handled = true;
      if (autosaveTimerRef.current) {
        window.clearTimeout(autosaveTimerRef.current);
        autosaveTimerRef.current = null;
      }
      if (strokes3D.length === 0 && !noteDraft.trim() && !activeAnnIdRef.current) return;
      const cam = getActiveCamera();
      const meshes = modelRootRef.current ? [modelRootRef.current] : [];
      const plane =
        activePlaneRef.current ??
        createAnnotationPlane(
          cam,
          viewerState.planeDistance ?? computeDefaultPlaneDistance(cam, meshes, bboxRef.current),
          viewerState.widthMode,
          viewerState.planeDepthTest,
        );
      await persist3D(strokes3D, plane, noteDraft, activeAnnIdRef.current, true);
      activeAnnIdRef.current = null;
      setActiveAnnId(null);
      setStrokes3D([]);
      setUndoStack([]);
      setRedoStack([]);
      activePlaneRef.current = null;
      onNoteDraftChange('');
      hydratedFileRef.current = file.id;
    };
    window.addEventListener('organum:submit-annotation', onSubmitAnn);
    return () => window.removeEventListener('organum:submit-annotation', onSubmitAnn);
  }, [
    file.id,
    strokes3D,
    noteDraft,
    persist3D,
    getActiveCamera,
    viewerState.planeDistance,
    viewerState.widthMode,
    viewerState.planeDepthTest,
    onNoteDraftChange,
  ]);

  // Listen for 3D commands (frame all, jump camera, new plane, update plane distance, undo/redo)
  useEffect(() => {
    const onFrameAll = () => {
      cameraMovedSinceStrokeRef.current = true;
      frameBox(bboxRef.current);
    };
    const onNewPlane = () => {
      const cam = getActiveCamera();
      const meshes = modelRootRef.current ? [modelRootRef.current] : [];
      const d = viewerState.planeDistance ?? computeDefaultPlaneDistance(cam, meshes, bboxRef.current);
      const plane = createAnnotationPlane(cam, d, viewerState.widthMode, viewerState.planeDepthTest);
      activePlaneRef.current = plane;
      cameraMovedSinceStrokeRef.current = false;
      setActivePlaneDistance(d);
      refreshPreviewOutline(plane);
    };
    const onSetDist = (ev: Event) => {
      const newD = (ev as CustomEvent<number>).detail;
      onUpdateState({ planeDistance: newD });
      setActivePlaneDistance(newD);
      const cam = getActiveCamera();
      if (activePlaneRef.current) {
        const rescaled = rescalePlaneDistance(
          activePlaneRef.current,
          strokes3D,
          [cam.position.x, cam.position.y, cam.position.z],
          newD,
        );
        activePlaneRef.current = rescaled.plane;
        setStrokes3D(rescaled.strokes);
        refreshPreviewOutline(rescaled.plane);
        if (rescaled.strokes.length > 0) {
          scheduleAutosave3D(rescaled.strokes, rescaled.plane, noteDraft);
        }
      } else {
        const p = createAnnotationPlane(cam, newD, viewerState.widthMode, viewerState.planeDepthTest);
        activePlaneRef.current = p;
        refreshPreviewOutline(p);
      }
    };
    const onJumpCam = (ev: Event) => {
      const pose = (ev as CustomEvent<CameraPose>).detail;
      if (!pose) return;
      const persp = perspCamRef.current;
      if (!persp) return;
      cameraMovedSinceStrokeRef.current = true;
      persp.position.set(...pose.position);
      persp.up.set(...pose.up);
      targetRef.current.set(...pose.target);
      persp.lookAt(targetRef.current);
      persp.fov = pose.fov || 45;
      persp.updateProjectionMatrix();
      syncOrthoFrustum();
    };
    const onSetPreset = (ev: Event) => {
      const preset = (ev as CustomEvent<'front' | 'right' | 'top'>).detail;
      const persp = perspCamRef.current;
      if (!persp) return;
      cameraMovedSinceStrokeRef.current = true;
      const center = new THREE.Vector3();
      bboxRef.current.getCenter(center);
      const dist = Math.max(0.5, persp.position.distanceTo(targetRef.current));
      targetRef.current.copy(center);
      if (preset === 'front') persp.position.set(center.x, center.y, center.z + dist);
      if (preset === 'right') persp.position.set(center.x + dist, center.y, center.z);
      if (preset === 'top') persp.position.set(center.x, center.y + dist, center.z + 0.001);
      persp.up.set(0, 1, 0);
      persp.lookAt(center);
      persp.updateProjectionMatrix();
      syncOrthoFrustum();
    };
    const onUndo = () => {
      if (undoStack.length === 0) return;
      const prev = undoStack[undoStack.length - 1]!;
      setRedoStack((r) => [...r, strokes3D]);
      setUndoStack((u) => u.slice(0, -1));
      setStrokes3D(prev);
      scheduleAutosave3D(prev, activePlaneRef.current, noteDraft);
    };
    const onRedo = () => {
      if (redoStack.length === 0) return;
      const next = redoStack[redoStack.length - 1]!;
      setUndoStack((u) => [...u, strokes3D]);
      setRedoStack((r) => r.slice(0, -1));
      setStrokes3D(next);
      scheduleAutosave3D(next, activePlaneRef.current, noteDraft);
    };
    const onClear = () => {
      setUndoStack((u) => [...u, strokes3D]);
      setRedoStack([]);
      setStrokes3D([]);
      scheduleAutosave3D([], activePlaneRef.current, noteDraft);
    };

    window.addEventListener('organum:frame-all', onFrameAll);
    window.addEventListener('organum:new-plane', onNewPlane);
    window.addEventListener('organum:update-plane-distance', onSetDist);
    window.addEventListener('organum:jump-camera', onJumpCam);
    window.addEventListener('organum:set-view-preset', onSetPreset);
    window.addEventListener('organum:undo', onUndo);
    window.addEventListener('organum:redo', onRedo);
    window.addEventListener('organum:clear-strokes', onClear);
    return () => {
      window.removeEventListener('organum:frame-all', onFrameAll);
      window.removeEventListener('organum:new-plane', onNewPlane);
      window.removeEventListener('organum:update-plane-distance', onSetDist);
      window.removeEventListener('organum:jump-camera', onJumpCam);
      window.removeEventListener('organum:set-view-preset', onSetPreset);
      window.removeEventListener('organum:undo', onUndo);
      window.removeEventListener('organum:redo', onRedo);
      window.removeEventListener('organum:clear-strokes', onClear);
    };
  }, [
    frameBox,
    getActiveCamera,
    noteDraft,
    onUpdateState,
    redoStack,
    refreshPreviewOutline,
    scheduleAutosave3D,
    setActivePlaneDistance,
    strokes3D,
    syncOrthoFrustum,
    undoStack,
    viewerState.planeDepthTest,
    viewerState.planeDistance,
    viewerState.widthMode,
  ]);

  // Clear preview outline when returning to Pan tool
  useEffect(() => {
    if (activeTool === 'pan') refreshPreviewOutline(null);
  }, [activeTool, refreshPreviewOutline]);

  // Pointer orbit / pan / dolly / 3D annotation drawing
  const dragModeRef = useRef<'none' | 'orbit' | 'pan' | 'dolly' | 'draw' | 'laser'>('none');
  const lastPtrRef = useRef({ x: 0, y: 0, moved: false });

  const ensureActivePlane = (): AnnotationPlaneData => {
    const cam = getActiveCamera();
    if (!activePlaneRef.current || (cameraMovedSinceStrokeRef.current && !viewerState.lockPlane)) {
      const meshes = modelRootRef.current ? [modelRootRef.current] : [];
      const d = viewerState.planeDistance ?? computeDefaultPlaneDistance(cam, meshes, bboxRef.current);
      const plane = createAnnotationPlane(cam, d, viewerState.widthMode, viewerState.planeDepthTest);
      activePlaneRef.current = plane;
      cameraMovedSinceStrokeRef.current = false;
      setActivePlaneDistance(d);
      refreshPreviewOutline(plane);
    }
    return activePlaneRef.current;
  };

  const toNdc = (clientX: number, clientY: number): [number, number] => {
    const rect = mountRef.current!.getBoundingClientRect();
    return [
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -(((clientY - rect.top) / rect.height) * 2 - 1),
    ];
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!mountRef.current) return;
    lastPtrRef.current = { x: e.clientX, y: e.clientY, moved: false };
    e.currentTarget.setPointerCapture(e.pointerId);

    const isOrbit = (e.button === 0 && activeTool === 'pan' && !e.shiftKey) || (e.button === 0 && e.altKey);
    const isPan = e.button === 1 || (e.button === 0 && e.shiftKey);
    const isDolly = e.button === 2 && e.altKey;

    if (isOrbit) {
      dragModeRef.current = 'orbit';
      return;
    }
    if (isPan) {
      dragModeRef.current = 'pan';
      return;
    }
    if (isDolly) {
      dragModeRef.current = 'dolly';
      return;
    }

    if (e.button === 0 && activeTool !== 'pan') {
      const isPersistentDraw =
        activeTool === 'free' ||
        activeTool === 'closed' ||
        activeTool === 'rect' ||
        activeTool === 'ellipse';
      if (
        isPersistentDraw &&
        cameraMovedSinceStrokeRef.current &&
        !viewerState.lockPlane &&
        (strokes3D.length > 0 || activeAnnIdRef.current !== null || noteDraft.trim().length > 0)
      ) {
        if (autosaveTimerRef.current) {
          window.clearTimeout(autosaveTimerRef.current);
          autosaveTimerRef.current = null;
        }
        void persist3D(strokes3D, activePlaneRef.current, noteDraft, activeAnnIdRef.current, true);
        activeAnnIdRef.current = null;
        setActiveAnnId(null);
        setStrokes3D([]);
        setUndoStack([]);
        setRedoStack([]);
        onNoteDraftChange('');
        hydratedFileRef.current = file.id;
      }

      const plane = ensureActivePlane();
      const [nx, ny] = toNdc(e.clientX, e.clientY);
      const uv = raycastToPlaneLocal(nx, ny, getActiveCamera(), plane);
      if (!uv) return;

      const worldW = pixelSizeToPlaneWidth(
        strokeSize,
        plane.distance,
        plane.fov,
        mountRef.current.clientHeight,
      );

      if (activeTool === 'laser') {
        dragModeRef.current = 'laser';
        laserListRef.current.push({
          plane,
          createdAt: performance.now(),
          stroke: {
            id: `l_${Date.now()}`,
            tool: 'free',
            color: '#EF4444',
            sizePx: strokeSize,
            worldWidth: worldW,
            points: [uv],
          },
        });
        return;
      }

      if (isPersistentDraw) {
        dragModeRef.current = 'draw';
        setDraftStroke3D({
          id: `s3d_${Date.now()}`,
          tool: activeTool,
          color: strokeColor,
          sizePx: strokeSize,
          worldWidth: worldW,
          closedFill: activeTool === 'closed' ? closedFill : false,
          points: [uv],
        });
      }
    }
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const mode = dragModeRef.current;
    if (mode === 'none') return;
    const dx = e.clientX - lastPtrRef.current.x;
    const dy = e.clientY - lastPtrRef.current.y;
    if (Math.hypot(dx, dy) > 2) lastPtrRef.current.moved = true;
    lastPtrRef.current.x = e.clientX;
    lastPtrRef.current.y = e.clientY;

    const persp = perspCamRef.current;
    if (!persp) return;

    if (mode === 'orbit') {
      cameraMovedSinceStrokeRef.current = true;
      const offset = persp.position.clone().sub(targetRef.current);
      const spherical = new THREE.Spherical().setFromVector3(offset);
      spherical.theta -= dx * 0.008;
      spherical.phi = Math.max(0.02, Math.min(Math.PI - 0.02, spherical.phi - dy * 0.008));
      offset.setFromSpherical(spherical);
      persp.position.copy(targetRef.current).add(offset);
      persp.lookAt(targetRef.current);
      syncOrthoFrustum();
    } else if (mode === 'pan') {
      cameraMovedSinceStrokeRef.current = true;
      const dist = persp.position.distanceTo(targetRef.current);
      const scale = dist * 0.0018;
      const right = new THREE.Vector3().setFromMatrixColumn(persp.matrixWorld, 0);
      const up = new THREE.Vector3().setFromMatrixColumn(persp.matrixWorld, 1);
      const delta = right.multiplyScalar(-dx * scale).addScaledVector(up, dy * scale);
      persp.position.add(delta);
      targetRef.current.add(delta);
      syncOrthoFrustum();
    } else if (mode === 'dolly') {
      cameraMovedSinceStrokeRef.current = true;
      const offset = persp.position.clone().sub(targetRef.current);
      const factor = Math.exp(dy * 0.01);
      offset.multiplyScalar(Math.max(1e-5, factor));
      persp.position.copy(targetRef.current).add(offset);
      persp.near = Math.max(1e-5, offset.length() * 1e-4);
      persp.far = Math.max(1000, offset.length() * 200);
      persp.updateProjectionMatrix();
      syncOrthoFrustum();
    } else if (mode === 'draw' && draftStroke3D && activePlaneRef.current) {
      const [nx, ny] = toNdc(e.clientX, e.clientY);
      const uv = raycastToPlaneLocal(nx, ny, getActiveCamera(), activePlaneRef.current);
      if (!uv) return;
      if (draftStroke3D.tool === 'rect' || draftStroke3D.tool === 'ellipse') {
        setDraftStroke3D({ ...draftStroke3D, points: [draftStroke3D.points[0]!, uv] });
      } else {
        setDraftStroke3D({ ...draftStroke3D, points: [...draftStroke3D.points, uv] });
      }
    } else if (mode === 'laser' && activePlaneRef.current && laserListRef.current.length > 0) {
      const [nx, ny] = toNdc(e.clientX, e.clientY);
      const uv = raycastToPlaneLocal(nx, ny, getActiveCamera(), activePlaneRef.current);
      if (uv) {
        const last = laserListRef.current[laserListRef.current.length - 1]!;
        last.stroke.points.push(uv);
        last.createdAt = performance.now();
      }
    }
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const mode = dragModeRef.current;
    dragModeRef.current = 'none';
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }

    // Picking highlight on click in Pan mode
    if (mode === 'orbit' && !lastPtrRef.current.moved && modelRootRef.current) {
      const [nx, ny] = toNdc(e.clientX, e.clientY);
      const raycaster = new THREE.Raycaster();
      raycaster.setFromCamera(new THREE.Vector2(nx, ny), getActiveCamera());
      const hits = raycaster.intersectObjects([modelRootRef.current], true);
      const hitMesh = hits.find(
        (h) => h.object instanceof THREE.Mesh && !h.object.userData.__wireOverlay,
      )?.object as THREE.Mesh | undefined;

      if (selectedMeshRef.current && selectedMeshRef.current !== hitMesh) {
        const prevOrig = origMaterialsRef.current.get(selectedMeshRef.current);
        if (prevOrig) selectedMeshRef.current.material = prevOrig;
      }
      if (hitMesh) {
        selectedMeshRef.current = hitMesh;
        const base = origMaterialsRef.current.get(hitMesh);
        if (base && !Array.isArray(base) && 'emissive' in base) {
          const hl = (base as THREE.MeshStandardMaterial).clone();
          hl.emissive = new THREE.Color(readCssToken('--zone-focus', '#e8a33d'));
          hl.emissiveIntensity = 0.35;
          hitMesh.material = hl;
        }
        onUpdateState({ selectedPrimPath: hitMesh.name || 'Mesh' });
      } else {
        selectedMeshRef.current = null;
        onUpdateState({ selectedPrimPath: null });
      }
      return;
    }

    if (mode === 'draw' && draftStroke3D) {
      if (draftStroke3D.points.length >= 2) {
        const next = [...strokes3D, draftStroke3D];
        setUndoStack((u) => [...u, strokes3D]);
        setRedoStack([]);
        setStrokes3D(next);
        scheduleAutosave3D(next, activePlaneRef.current, noteDraft);
      }
      setDraftStroke3D(null);
    }
  };

  const handleWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    e.preventDefault();
    const persp = perspCamRef.current;
    if (!persp) return;
    cameraMovedSinceStrokeRef.current = true;
    const offset = persp.position.clone().sub(targetRef.current);
    const dist = Math.max(1e-5, offset.length());
    // Logarithmic zoom law across 1e-6 .. 1e8 units
    const scale = Math.exp(e.deltaY * 0.0012);
    const nextDist = Math.max(1e-5, Math.min(1e7, dist * scale));
    offset.setLength(nextDist);
    persp.position.copy(targetRef.current).add(offset);
    persp.near = Math.max(1e-6, nextDist * 1e-4);
    persp.far = Math.max(1000, nextDist * 200);
    persp.updateProjectionMatrix();
    syncOrthoFrustum();
  };

  // Texture Viewer Mode (§5.5)
  if (viewerState.activeTextureIndex !== null) {
    return (
      <div data-ui="viewport-3d-texture" className="org-vp3d__submode">
        <div className="org-vp3d__subbar">
          <Button
            size="sm"
            variant="primary"
            iconLeft={<Icon name="chevron-left" size="sm" />}
            onClick={() => onUpdateState({ activeTextureIndex: null })}
          >
            Back to 3D Scene
          </Button>
          <Badge tone="accent">Texture #{viewerState.activeTextureIndex}</Badge>
          <Text size="sm" variant="muted">
            Full 2D color pipeline & pixel zoom active
          </Text>
        </div>
        <ImageViewer2D
          file={file}
          inspection={inspection}
          viewerState={viewerState}
          onUpdateState={onUpdateState}
          activeTool={activeTool}
          noteDraft={noteDraft}
          onNoteDraftChange={onNoteDraftChange}
          overrideArtifact={{
            kind: 'texture_png',
            params: { texture_index: viewerState.activeTextureIndex },
          }}
        />
      </div>
    );
  }

  return (
    <div data-ui="viewport-3d" className="org-vp3d">
      {/* Live 3D container stays mounted (hidden via data-hidden during Freeze for instant toggle!) */}
      <div
        ref={mountRef}
        data-hidden={viewerState.frozen ? 'true' : undefined}
        className="org-vp3d__canvas-wrap"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onWheel={handleWheel}
        onContextMenu={(e) => e.preventDefault()}
      >
        <div className="org-vp3d__hud">
          <span>Tris: {stats.tris.toLocaleString()}</span>
          <span>Verts: {stats.verts.toLocaleString()}</span>
          <span>{stats.fps} FPS</span>
          <span>{viewerState.cameraMode === 'ortho' ? 'Ortho' : 'Persp'}</span>
          <span>{viewerState.shadingMode}</span>
          {viewerState.selectedPrimPath && (
            <Badge tone="accent">{viewerState.selectedPrimPath}</Badge>
          )}
        </div>

        <svg viewBox="0 0 40 40" className="org-vp3d__gizmo" aria-label="Camera orientation gizmo">
          {gizmoAxes.map((a) => (
            <g key={a.label}>
              <line x1="20" y1="20" x2={a.x} y2={a.y} stroke={a.color} strokeWidth="1.5" />
              <text x={a.x} y={a.y} fill={a.color} className="org-vp3d__gizmo-lbl">
                {a.label}
              </text>
            </g>
          ))}
        </svg>

        {loading && (
          <div className="org-vp3d__status">
            <Spinner label="Loading 3D scene" />
            <Text>Converting / Loading {file.filename}...</Text>
          </div>
        )}
        {error && (
          <div className="org-vp3d__status">
            <Text variant="danger">{error}</Text>
          </div>
        )}
      </div>

      {/* Animated 3D Timeline & Transport (§5.8) */}
      {hasAnim && !viewerState.frozen && (
        <>
          <Timebar
            startFrame={0}
            endFrame={animEndFrame}
            currentFrame={Math.max(0, Math.min(animEndFrame, viewerState.currentFrame))}
            fps={24}
            onSeek={(f) => {
              setAnimPlayState('paused');
              onUpdateState({ currentFrame: f });
            }}
          />
          <TransportControls
            playState={animPlayState}
            currentFrame={Math.max(0, Math.min(animEndFrame, viewerState.currentFrame))}
            startFrame={0}
            endFrame={animEndFrame}
            fps={24}
            loopMode={viewerState.loopMode}
            speed={viewerState.playbackSpeed}
            onGoStart={() => onUpdateState({ currentFrame: 0 })}
            onStepBack={() => onUpdateState({ currentFrame: Math.max(0, viewerState.currentFrame - 1) })}
            onPlayReverse={() => setAnimPlayState('reverse')}
            onPause={() => setAnimPlayState('paused')}
            onPlayForward={() => setAnimPlayState('forward')}
            onStepForward={() =>
              onUpdateState({ currentFrame: Math.min(animEndFrame, viewerState.currentFrame + 1) })
            }
            onGoEnd={() => onUpdateState({ currentFrame: animEndFrame })}
            onSeek={(f) => onUpdateState({ currentFrame: f })}
            onCycleLoop={() => {
              const order: LoopMode[] = ['loop', 'once', 'pingpong'];
              onUpdateState({
                loopMode: order[(order.indexOf(viewerState.loopMode) + 1) % order.length]!,
              });
            }}
            onChangeSpeed={(playbackSpeed) => onUpdateState({ playbackSpeed })}
          />
        </>
      )}

      {/* Frozen 2D Capture Mode (§5.5) */}
      {viewerState.frozen && frozenBuffer && (
        <div className="org-vp3d__submode">
          <div className="org-vp3d__subbar">
            <Badge tone="accent">FROZEN 2D</Badge>
            <Text size="sm" variant="muted">
              Instant 2D pixel inspection active — press Tab or Freeze to return to Live 3D
            </Text>
          </div>
          <ImageViewer2D
            file={file}
            inspection={inspection}
            viewerState={viewerState}
            onUpdateState={onUpdateState}
            activeTool={activeTool}
            noteDraft={noteDraft}
            onNoteDraftChange={onNoteDraftChange}
            directBuffer={frozenBuffer}
            annotationCameraJson={frozenCameraJson}
          />
        </div>
      )}
    </div>
  );
}
