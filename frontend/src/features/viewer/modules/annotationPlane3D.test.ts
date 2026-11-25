import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  buildStrokeRibbonGeometry,
  computeDefaultPlaneDistance,
  createAnnotationPlane,
  pixelSizeToPlaneWidth,
  raycastToPlaneLocal,
  rescalePlaneDistance,
  type Stroke3D,
} from './annotationPlane3D';

describe('annotationPlane3D (§5.6)', () => {
  it('computes default plane distance as half the distance to first center geometry hit', () => {
    const cam = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
    cam.position.set(0, 0, 10);
    cam.lookAt(0, 0, 0);
    cam.updateMatrixWorld();

    // Box of size 2 centered at origin -> front face is at z = +1 -> distance = 9 -> midpoint = 4.5
    const boxMesh = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2));
    boxMesh.updateMatrixWorld();
    const bbox = new THREE.Box3().setFromObject(boxMesh);

    const d = computeDefaultPlaneDistance(cam, [boxMesh], bbox);
    expect(d).toBeCloseTo(4.5, 3);
  });

  it('builds real 3D ribbon geometry in the plane that stays fixed in world space when orbiting 90 degrees', () => {
    const cam = new THREE.PerspectiveCamera(45, 1.5, 0.1, 100);
    cam.position.set(0, 0, 10);
    cam.lookAt(0, 0, 0);
    cam.updateMatrixWorld();

    const plane = createAnnotationPlane(cam, 5, 'world', true);
    const p0 = raycastToPlaneLocal(-0.4, 0.2, cam, plane);
    const p1 = raycastToPlaneLocal(0.4, 0.2, cam, plane);
    expect(p0).not.toBeNull();
    expect(p1).not.toBeNull();

    const width = pixelSizeToPlaneWidth(4, plane.distance, plane.fov, 600);
    const stroke: Stroke3D = {
      id: 's1',
      tool: 'free',
      color: '#8B5CF6',
      sizePx: 4,
      worldWidth: width,
      points: [p0!, p1!],
    };

    const geom = buildStrokeRibbonGeometry(stroke, plane);
    const pos = geom.getAttribute('position');
    expect(pos.count).toBe(4);

    // Every vertex must lie strictly on the annotation plane
    const origin = new THREE.Vector3(...plane.origin);
    const normal = new THREE.Vector3(...plane.normal);
    const worldVertsBefore: THREE.Vector3[] = [];
    for (let i = 0; i < pos.count; i++) {
      const v = new THREE.Vector3(pos.getX(i), pos.getY(i), pos.getZ(i));
      worldVertsBefore.push(v);
      expect(Math.abs(v.clone().sub(origin).dot(normal))).toBeLessThan(1e-5);
    }

    // Constant ribbon width check across endpoints
    const w0 = worldVertsBefore[0]!.distanceTo(worldVertsBefore[1]!);
    const w1 = worldVertsBefore[2]!.distanceTo(worldVertsBefore[3]!);
    expect(w0).toBeCloseTo(width, 5);
    expect(w1).toBeCloseTo(width, 5);

    const ndcBefore = worldVertsBefore.map((v) => v.clone().project(cam));

    // Orbit camera 90 degrees around the scene center (0, 0, 0)
    cam.position.set(10, 0, 0);
    cam.lookAt(0, 0, 0);
    cam.updateMatrixWorld();

    // World positions remain unchanged while screen-space projection foreshortens/changes
    const ndcAfter = worldVertsBefore.map((v) => v.clone().project(cam));
    for (let i = 0; i < worldVertsBefore.length; i++) {
      expect(pos.getX(i)).toBeCloseTo(worldVertsBefore[i]!.x, 5);
      expect(pos.getY(i)).toBeCloseTo(worldVertsBefore[i]!.y, 5);
      expect(pos.getZ(i)).toBeCloseTo(worldVertsBefore[i]!.z, 5);
      expect(Math.abs(ndcAfter[i]!.x - ndcBefore[i]!.x)).toBeGreaterThan(0.1);
    }
  });

  it('rescales plane distance along normal while preserving creation-camera projection', () => {
    const cam = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
    cam.position.set(0, 2, 8);
    cam.lookAt(0, 0, 0);
    cam.updateMatrixWorld();

    const plane = createAnnotationPlane(cam, 4, 'world', true);
    const stroke: Stroke3D = {
      id: 's2',
      tool: 'free',
      color: '#10B981',
      sizePx: 3,
      worldWidth: 0.05,
      points: [
        [-0.8, 0.3],
        [0.9, -0.4],
      ],
    };

    const g1 = buildStrokeRibbonGeometry(stroke, plane);
    const pos1 = g1.getAttribute('position');
    const proj1 = new THREE.Vector3(pos1.getX(0), pos1.getY(0), pos1.getZ(0)).project(cam);

    const rescaled = rescalePlaneDistance(
      plane,
      [stroke],
      [cam.position.x, cam.position.y, cam.position.z],
      7.5,
    );
    expect(rescaled.plane.distance).toBeCloseTo(7.5, 5);
    const g2 = buildStrokeRibbonGeometry(rescaled.strokes[0]!, rescaled.plane);
    const pos2 = g2.getAttribute('position');
    const proj2 = new THREE.Vector3(pos2.getX(0), pos2.getY(0), pos2.getZ(0)).project(cam);

    expect(proj2.x).toBeCloseTo(proj1.x, 4);
    expect(proj2.y).toBeCloseTo(proj1.y, 4);
  });
});

