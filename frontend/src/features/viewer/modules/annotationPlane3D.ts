import * as THREE from 'three';
import type { AnnotationPlaneData, CameraPose, WidthMode } from '../viewerStore';

export interface Stroke3D {
  id: string;
  tool: 'free' | 'closed' | 'rect' | 'ellipse';
  color: string;
  sizePx: number;
  worldWidth: number;
  closedFill?: boolean;
  /** Plane-local 2D coordinates [u, v] */
  points: Array<[number, number]>;
}

export function extractCameraPose(
  camera: THREE.PerspectiveCamera | THREE.OrthographicCamera,
  target: THREE.Vector3,
): CameraPose {
  const isOrtho = camera instanceof THREE.OrthographicCamera;
  return {
    position: [camera.position.x, camera.position.y, camera.position.z],
    target: [target.x, target.y, target.z],
    up: [camera.up.x, camera.up.y, camera.up.z],
    fov: camera instanceof THREE.PerspectiveCamera ? camera.fov : 45,
    orthographic: isOrtho,
    zoom: camera.zoom,
  };
}

export function computeDefaultPlaneDistance(
  camera: THREE.Camera,
  meshes: ReadonlyArray<THREE.Object3D>,
  bbox: THREE.Box3,
): number {
  const raycaster = new THREE.Raycaster();
  raycaster.setFromCamera(new THREE.Vector2(0, 0), camera);
  const hits = raycaster.intersectObjects(meshes as THREE.Object3D[], true);
  const firstHit = hits.find((h) => h.distance > 1e-4);
  if (firstHit) {
    return Math.max(0.05, Number((firstHit.distance * 0.5).toFixed(4)));
  }
  const center = new THREE.Vector3();
  bbox.getCenter(center);
  const dist = camera.position.distanceTo(center);
  return Math.max(0.05, Number((dist * 0.5).toFixed(4)));
}

export function createAnnotationPlane(
  camera: THREE.Camera,
  distance: number,
  widthMode: WidthMode,
  depthTest: boolean,
): AnnotationPlaneData {
  camera.updateMatrixWorld();
  const normal = new THREE.Vector3();
  camera.getWorldDirection(normal).normalize();

  const camUp = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion).normalize();
  const right = new THREE.Vector3().crossVectors(normal, camUp).normalize();
  const orthoUp = new THREE.Vector3().crossVectors(right, normal).normalize();

  const origin = camera.position.clone().addScaledVector(normal, distance);
  const fov = camera instanceof THREE.PerspectiveCamera ? camera.fov : 45;

  return {
    origin: [origin.x, origin.y, origin.z],
    normal: [normal.x, normal.y, normal.z],
    up: [orthoUp.x, orthoUp.y, orthoUp.z],
    right: [right.x, right.y, right.z],
    distance,
    fov,
    widthMode,
    depthTest,
  };
}

export function pixelSizeToPlaneWidth(
  pxSize: number,
  distance: number,
  fovDeg: number,
  viewportHeight: number,
): number {
  const vh = Math.max(1, viewportHeight);
  const fovRad = THREE.MathUtils.degToRad(fovDeg);
  const worldSpanH = 2 * Math.max(0.01, distance) * Math.tan(fovRad / 2);
  return pxSize * (worldSpanH / vh);
}

export function raycastToPlaneLocal(
  ndcX: number,
  ndcY: number,
  camera: THREE.Camera,
  plane: AnnotationPlaneData,
): [number, number] | null {
  const normal = new THREE.Vector3(...plane.normal).normalize();
  const origin = new THREE.Vector3(...plane.origin);
  const right = new THREE.Vector3(...plane.right).normalize();
  const up = new THREE.Vector3(...plane.up).normalize();

  const threePlane = new THREE.Plane().setFromNormalAndCoplanarPoint(normal, origin);
  const raycaster = new THREE.Raycaster();
  raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), camera);

  const hit = new THREE.Vector3();
  if (!raycaster.ray.intersectPlane(threePlane, hit)) {
    return null;
  }
  const delta = hit.sub(origin);
  return [delta.dot(right), delta.dot(up)];
}

export function planeLocalToWorld(
  u: number,
  v: number,
  plane: AnnotationPlaneData,
): THREE.Vector3 {
  return new THREE.Vector3(...plane.origin)
    .addScaledVector(new THREE.Vector3(...plane.right), u)
    .addScaledVector(new THREE.Vector3(...plane.up), v);
}

function expandToolPoints(stroke: Stroke3D): Array<[number, number]> {
  const pts = stroke.points;
  if (pts.length < 2) return pts;
  if (stroke.tool === 'rect') {
    const [x0, y0] = pts[0]!;
    const [x1, y1] = pts[pts.length - 1]!;
    return [
      [x0, y0],
      [x1, y0],
      [x1, y1],
      [x0, y1],
      [x0, y0],
    ];
  }
  if (stroke.tool === 'ellipse') {
    const [x0, y0] = pts[0]!;
    const [x1, y1] = pts[pts.length - 1]!;
    const cx = (x0 + x1) * 0.5;
    const cy = (y0 + y1) * 0.5;
    const rx = Math.abs(x1 - x0) * 0.5;
    const ry = Math.abs(y1 - y0) * 0.5;
    const out: Array<[number, number]> = [];
    const steps = 32;
    for (let i = 0; i <= steps; i++) {
      const a = (i / steps) * Math.PI * 2;
      out.push([cx + Math.cos(a) * rx, cy + Math.sin(a) * ry]);
    }
    return out;
  }
  if (stroke.tool === 'closed' && pts.length >= 3) {
    return [...pts, pts[0]!];
  }
  return pts;
}

/**
 * Build real 3D triangle-strip ribbon BufferGeometry lying strictly in the annotation plane.
 */
export function buildStrokeRibbonGeometry(
  stroke: Stroke3D,
  plane: AnnotationPlaneData,
  overrideWidth?: number,
): THREE.BufferGeometry {
  const pts = expandToolPoints(stroke);
  const geom = new THREE.BufferGeometry();
  if (pts.length < 2) {
    geom.setAttribute('position', new THREE.Float32BufferAttribute([], 3));
    return geom;
  }

  const origin = new THREE.Vector3(...plane.origin);
  const right = new THREE.Vector3(...plane.right).normalize();
  const up = new THREE.Vector3(...plane.up).normalize();
  const halfW = (overrideWidth ?? stroke.worldWidth) * 0.5;

  const positions: number[] = [];
  const indices: number[] = [];

  for (let i = 0; i < pts.length; i++) {
    const [u, v] = pts[i]!;
    const prev = pts[Math.max(0, i - 1)]!;
    const next = pts[Math.min(pts.length - 1, i + 1)]!;
    let du = next[0] - prev[0];
    let dv = next[1] - prev[1];
    const len = Math.hypot(du, dv);
    if (len < 1e-8) {
      du = 1;
      dv = 0;
    } else {
      du /= len;
      dv /= len;
    }
    // Perpendicular in plane-local (u, v)
    const pu = -dv * halfW;
    const pv = du * halfW;

    const leftW = origin
      .clone()
      .addScaledVector(right, u + pu)
      .addScaledVector(up, v + pv);
    const rightW = origin
      .clone()
      .addScaledVector(right, u - pu)
      .addScaledVector(up, v - pv);

    positions.push(leftW.x, leftW.y, leftW.z, rightW.x, rightW.y, rightW.z);
    if (i > 0) {
      const b = (i - 1) * 2;
      indices.push(b, b + 1, b + 2, b + 1, b + 3, b + 2);
    }
  }

  geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geom.setIndex(indices);
  geom.computeVertexNormals();
  return geom;
}

export function buildClosedFillGeometry(
  stroke: Stroke3D,
  plane: AnnotationPlaneData,
): THREE.BufferGeometry | null {
  if (stroke.tool !== 'closed' || !stroke.closedFill || stroke.points.length < 3) {
    return null;
  }
  const shape = new THREE.Shape(stroke.points.map(([u, v]) => new THREE.Vector2(u, v)));
  const shapeGeom = new THREE.ShapeGeometry(shape);
  const posAttr = shapeGeom.getAttribute('position');
  const origin = new THREE.Vector3(...plane.origin);
  const right = new THREE.Vector3(...plane.right).normalize();
  const up = new THREE.Vector3(...plane.up).normalize();

  for (let i = 0; i < posAttr.count; i++) {
    const u = posAttr.getX(i);
    const v = posAttr.getY(i);
    const wp = origin.clone().addScaledVector(right, u).addScaledVector(up, v);
    posAttr.setXYZ(i, wp.x, wp.y, wp.z);
  }
  posAttr.needsUpdate = true;
  shapeGeom.computeVertexNormals();
  return shapeGeom;
}

export function buildPlanePreviewOutline(
  plane: AnnotationPlaneData,
  aspect: number,
): THREE.BufferGeometry {
  const halfH = Math.max(0.05, plane.distance * Math.tan(THREE.MathUtils.degToRad(plane.fov / 2)) * 0.88);
  const halfW = halfH * Math.max(0.2, aspect);
  const corners: Array<[number, number]> = [
    [-halfW, -halfH],
    [halfW, -halfH],
    [halfW, halfH],
    [-halfW, halfH],
  ];
  const pts = corners.map(([u, v]) => planeLocalToWorld(u, v, plane));
  return new THREE.BufferGeometry().setFromPoints(pts);
}

/**
 * Move a plane to newDistance along its normal from cameraPos and scale plane-local
 * coordinates by d_new / d_old so the creation-camera projection stays identical.
 */
export function rescalePlaneDistance(
  plane: AnnotationPlaneData,
  strokes: ReadonlyArray<Stroke3D>,
  cameraPos: [number, number, number],
  newDistance: number,
): { plane: AnnotationPlaneData; strokes: Stroke3D[] } {
  const safeOld = Math.max(1e-5, plane.distance);
  const safeNew = Math.max(0.01, newDistance);
  const scale = safeNew / safeOld;

  const cam = new THREE.Vector3(...cameraPos);
  const normal = new THREE.Vector3(...plane.normal).normalize();
  const nextOrigin = cam.addScaledVector(normal, safeNew);

  return {
    plane: {
      ...plane,
      origin: [nextOrigin.x, nextOrigin.y, nextOrigin.z],
      distance: safeNew,
    },
    strokes: strokes.map((s) => ({
      ...s,
      worldWidth: s.worldWidth * scale,
      points: s.points.map(([u, v]) => [u * scale, v * scale]),
    })),
  };
}

