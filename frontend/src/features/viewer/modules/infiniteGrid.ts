import * as THREE from 'three';

const GRID_VERT = `
varying vec3 vWorldPos;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorldPos = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const GRID_FRAG = `
precision highp float;
varying vec3 vWorldPos;
uniform vec3 uCameraPos;
uniform float uGridFadeDist;
uniform vec3 uMinorColor;
uniform vec3 uMajorColor;

float gridLine(vec2 coord, float spacing, float widthPx) {
  vec2 scaled = coord / spacing;
  vec2 deriv = fwidth(scaled);
  vec2 grid = abs(fract(scaled - 0.5) - 0.5) / max(deriv, vec2(1e-5));
  float line = min(grid.x, grid.y);
  return 1.0 - min(line / widthPx, 1.0);
}

void main() {
  float camH = max(abs(uCameraPos.y), 0.05);
  float logH = log(camH) / log(10.0);
  float fl = floor(logH);
  float frac = logH - fl;

  float spacing0 = pow(10.0, fl - 1.0);
  float spacing1 = spacing0 * 10.0;
  float spacing2 = spacing1 * 10.0;

  float g0 = gridLine(vWorldPos.xz, spacing0, 1.0) * (1.0 - frac);
  float g1 = gridLine(vWorldPos.xz, spacing1, 1.15);
  float g2 = gridLine(vWorldPos.xz, spacing2, 1.4);

  vec3 col = uMinorColor;
  float alpha = max(g0 * 0.25, g1 * 0.45);
  if (g2 > 0.01) {
    col = mix(uMinorColor, uMajorColor, g2);
    alpha = max(alpha, g2 * 0.7);
  }

  // Desaturated world X (red) and Z (blue) axes on ground plane
  vec2 fw = max(fwidth(vWorldPos.xz), vec2(1e-5));
  float xAxis = 1.0 - min(abs(vWorldPos.z) / fw.y, 1.0);
  float zAxis = 1.0 - min(abs(vWorldPos.x) / fw.x, 1.0);
  if (xAxis > 0.01) {
    col = mix(col, vec3(0.68, 0.30, 0.32), xAxis);
    alpha = max(alpha, xAxis * 0.85);
  }
  if (zAxis > 0.01) {
    col = mix(col, vec3(0.32, 0.48, 0.72), zAxis);
    alpha = max(alpha, zAxis * 0.85);
  }

  float dist = length(vWorldPos.xz - uCameraPos.xz);
  float fade = clamp(1.0 - dist / max(uGridFadeDist, 10.0), 0.0, 1.0);
  alpha *= fade * fade;

  if (alpha < 0.01) discard;
  gl_FragColor = vec4(col, alpha);
}
`;

export function createInfiniteGrid(): {
  mesh: THREE.Mesh;
  update: (camera: THREE.Camera, isDark: boolean) => void;
  dispose: () => void;
} {
  const geom = new THREE.PlaneGeometry(2, 2);
  geom.rotateX(-Math.PI / 2);

  const mat = new THREE.ShaderMaterial({
    vertexShader: GRID_VERT,
    fragmentShader: GRID_FRAG,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    uniforms: {
      uCameraPos: { value: new THREE.Vector3() },
      uGridFadeDist: { value: 250.0 },
      uMinorColor: { value: new THREE.Color('#475569') },
      uMajorColor: { value: new THREE.Color('#94A3B8') },
    },
  });

  const mesh = new THREE.Mesh(geom, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = -10;

  return {
    mesh,
    update(camera: THREE.Camera, isDark: boolean) {
      const span = Math.max(80, camera.position.length() * 12);
      mesh.position.set(camera.position.x, 0, camera.position.z);
      mesh.scale.set(span, 1, span);
      mat.uniforms.uCameraPos!.value.copy(camera.position);
      mat.uniforms.uGridFadeDist!.value = span * 0.45;
      (mat.uniforms.uMinorColor!.value as THREE.Color).set(isDark ? '#334155' : '#94A3B8');
      (mat.uniforms.uMajorColor!.value as THREE.Color).set(isDark ? '#64748B' : '#475569');
    },
    dispose() {
      geom.dispose();
      mat.dispose();
    },
  };
}

