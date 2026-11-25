import type { ChannelMode } from './viewerStore';

export interface RenderUniforms {
  inputSpace: number;
  displayView: number;
  exposure: number;
  gamma: number;
  saturation: number;
  hue: number;
  channel: number;
  pixelGrid: boolean;
  clipping: boolean;
  falseColor?: boolean;
  bypass: boolean;
  zoom: number;
  panX: number;
  panY: number;
}

const VERT_SRC = `#version 300 es
precision highp float;
in vec2 a_pos;
out vec2 v_ndc;
void main() {
  v_ndc = a_pos;
  gl_Position = vec4(a_pos, 0.0, 1.0);
}
`;

const FRAG_SRC = `#version 300 es
precision highp float;

uniform sampler2D u_tex;
uniform vec2 u_viewport;
uniform vec2 u_imgSize;
uniform float u_zoom;
uniform vec2 u_pan;
uniform int u_inputSpace;
uniform int u_displayView;
uniform float u_exposure;
uniform float u_gamma;
uniform float u_saturation;
uniform float u_hue;
uniform int u_channel;
uniform int u_pixelGrid;
uniform int u_clipping;
uniform int u_falseColor;
uniform int u_bypass;
uniform int u_useCustomRect;
uniform vec4 u_customRect;

in vec2 v_ndc;
out vec4 outColor;

vec3 srgbToLinear(vec3 c) {
  bvec3 cut = lessThanEqual(c, vec3(0.04045));
  return mix(pow((max(c, 0.0) + 0.055) / 1.055, vec3(2.4)), c / 12.92, cut);
}

vec3 linearToSrgb(vec3 c) {
  vec3 s = max(c, 0.0);
  bvec3 cut = lessThanEqual(s, vec3(0.0031308));
  return mix(1.055 * pow(s, vec3(1.0 / 2.4)) - 0.055, s * 12.92, cut);
}

vec3 rotateHue(vec3 col, float deg) {
  float rad = radians(deg);
  float c = cos(rad);
  float s = sin(rad);
  vec3 k = normalize(vec3(1.0));
  return col * c + cross(k, col) * s + k * dot(k, col) * (1.0 - c);
}

vec3 inputToWorking(vec3 c, int space) {
  if (space == 1 || space == 6) return c; // Linear sRGB or Raw
  if (space == 0) return srgbToLinear(c); // sRGB
  if (space == 2) return srgbToLinear(c); // Rec.709 approx
  if (space == 3) {
    // ACEScg (AP1) -> Linear Rec.709/sRGB
    mat3 m = mat3(
      1.70505, -0.13026, -0.02400,
     -0.62179,  1.14080, -0.12897,
     -0.08326, -0.01055,  1.15297
    );
    return m * c;
  }
  if (space == 4) {
    // ACES2065-1 (AP0) -> Linear Rec.709/sRGB
    mat3 m = mat3(
      2.52169, -0.27648, -0.01538,
     -1.13413,  1.37272, -0.15298,
     -0.38756, -0.09624,  1.16835
    );
    return m * c;
  }
  // Display P3 -> Linear sRGB
  vec3 lin = srgbToLinear(c);
  mat3 p3To709 = mat3(
    1.22494, -0.04206, -0.01964,
   -0.22494,  1.04206, -0.07864,
    0.00000,  0.00000,  1.09828
  );
  return p3To709 * lin;
}

vec3 workingToDisplay(vec3 c, int view) {
  if (view == 4 || view == 5) return c; // Linear / Raw
  if (view == 2) {
    mat3 m709to2020 = mat3(
      0.62740, 0.06910, 0.01639,
      0.32928, 0.91954, 0.08801,
      0.04331, 0.01136, 0.89560
    );
    return linearToSrgb(m709to2020 * c);
  }
  if (view == 3) {
    mat3 m709toP3 = mat3(
      0.82246, 0.03319, 0.01708,
      0.17754, 0.96681, 0.07240,
      0.00000, 0.00000, 0.91052
    );
    return linearToSrgb(m709toP3 * c);
  }
  return linearToSrgb(c);
}

vec3 falseColorRamp(float v) {
  float x = clamp(v, 0.0, 1.0);
  if (x < 0.05) return vec3(0.08, 0.08, 0.28);
  if (x < 0.20) return mix(vec3(0.08, 0.16, 0.55), vec3(0.10, 0.55, 0.85), (x - 0.05) / 0.15);
  if (x < 0.42) return mix(vec3(0.10, 0.55, 0.85), vec3(0.18, 0.72, 0.38), (x - 0.20) / 0.22);
  if (x < 0.58) return mix(vec3(0.45, 0.45, 0.45), vec3(0.65, 0.65, 0.65), (x - 0.42) / 0.16);
  if (x < 0.78) return mix(vec3(0.75, 0.72, 0.16), vec3(0.95, 0.58, 0.10), (x - 0.58) / 0.20);
  return mix(vec3(0.95, 0.58, 0.10), vec3(0.95, 0.15, 0.15), (x - 0.78) / 0.22);
}

void main() {
  vec2 screenPx = vec2((v_ndc.x * 0.5 + 0.5) * u_viewport.x, (0.5 - v_ndc.y * 0.5) * u_viewport.y);
  vec2 uv;
  vec2 imgPx;
  float effZoomX = u_zoom;
  if (u_useCustomRect == 1) {
    vec2 rectSize = max(u_customRect.zw, vec2(1.0));
    uv = (screenPx - u_customRect.xy) / rectSize;
    imgPx = uv * u_imgSize;
    effZoomX = rectSize.x / max(u_imgSize.x, 1.0);
  } else {
    vec2 imgOrigin = u_viewport * 0.5 + u_pan - (u_imgSize * u_zoom) * 0.5;
    imgPx = (screenPx - imgOrigin) / u_zoom;
    uv = imgPx / u_imgSize;
  }

  if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) {
    if (u_useCustomRect == 1) discard;
    outColor = vec4(0.0, 0.0, 0.0, 0.0);
    return;
  }

  vec4 sampled = texture(u_tex, uv);
  vec3 rgb = sampled.rgb;
  float alpha = sampled.a;

  if (u_bypass == 0) {
    rgb = inputToWorking(rgb, u_inputSpace);
    rgb *= pow(2.0, u_exposure);
    float luma = dot(rgb, vec3(0.2126, 0.7152, 0.0722));
    rgb = mix(vec3(luma), rgb, u_saturation);
    if (abs(u_hue) > 0.01) {
      rgb = rotateHue(rgb, u_hue);
    }
    rgb = pow(max(rgb, vec3(0.0)), vec3(1.0 / max(u_gamma, 0.01)));
    rgb = workingToDisplay(rgb, u_displayView);
  }

  if (u_falseColor == 1) {
    float fcLuma = dot(rgb, vec3(0.2126, 0.7152, 0.0722));
    rgb = falseColorRamp(fcLuma);
  }

  if (u_clipping == 1) {
    if (any(greaterThan(sampled.rgb, vec3(1.0)))) {
      rgb = vec3(0.95, 0.25, 0.25);
    } else if (any(lessThan(sampled.rgb, vec3(0.0)))) {
      rgb = vec3(0.20, 0.65, 0.95);
    }
  }

  if (u_channel == 1) rgb = vec3(rgb.r);
  else if (u_channel == 2) rgb = vec3(rgb.g);
  else if (u_channel == 3) rgb = vec3(rgb.b);
  else if (u_channel == 4) rgb = vec3(alpha);
  else if (u_channel == 5) rgb = vec3(dot(rgb, vec3(0.2126, 0.7152, 0.0722)));

  if (u_channel != 4) {
    vec2 checkerCoord = floor(screenPx / 10.0);
    float chk = mod(checkerCoord.x + checkerCoord.y, 2.0);
    vec3 bg = mix(vec3(0.14), vec3(0.22), chk);
    rgb = mix(bg, rgb, clamp(alpha, 0.0, 1.0));
  }

  if (u_pixelGrid == 1 && effZoomX >= 8.0) {
    vec2 f = fract(imgPx);
    float pxStep = 1.0 / effZoomX;
    if (f.x < pxStep || f.y < pxStep) {
      rgb = mix(rgb, vec3(0.55, 0.55, 0.65), 0.45);
    }
  }

  outColor = vec4(rgb, 1.0);
}
`;

export function mapInputSpaceIndex(id: string): number {
  switch (id) {
    case 'srgb':
      return 0;
    case 'linear_srgb':
      return 1;
    case 'rec709':
      return 2;
    case 'acescg':
      return 3;
    case 'aces2065_1':
      return 4;
    case 'display_p3':
      return 5;
    case 'raw':
      return 6;
    default:
      return 0;
  }
}

export function mapDisplayViewIndex(id: string): number {
  switch (id) {
    case 'srgb':
      return 0;
    case 'rec709':
      return 1;
    case 'rec2020':
      return 2;
    case 'display_p3':
      return 3;
    case 'linear':
      return 4;
    case 'raw':
      return 5;
    default:
      return 0;
  }
}

export function mapChannelIndex(ch: ChannelMode): number {
  switch (ch) {
    case 'RGB':
      return 0;
    case 'R':
      return 1;
    case 'G':
      return 2;
    case 'B':
      return 3;
    case 'A':
      return 4;
    case 'Y':
      return 5;
  }
}

export class WebGL2ImageRenderer {
  private gl: WebGL2RenderingContext;
  private program: WebGLProgram;
  private vao: WebGLVertexArrayObject;
  private vbo: WebGLBuffer;
  private texture: WebGLTexture;
  private floatLinearSupported: boolean;
  private imgWidth = 1;
  private imgHeight = 1;
  private isFloatTex = false;

  constructor(canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl2', {
      alpha: true,
      antialias: false,
      premultipliedAlpha: false,
      preserveDrawingBuffer: true,
    });
    if (!gl) throw new Error('WebGL2 unavailable');
    this.gl = gl;
    this.floatLinearSupported = Boolean(gl.getExtension('OES_texture_float_linear'));

    const vs = this.compile(gl.VERTEX_SHADER, VERT_SRC);
    const fs = this.compile(gl.FRAGMENT_SHADER, FRAG_SRC);
    const prog = gl.createProgram()!;
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      throw new Error(gl.getProgramInfoLog(prog) ?? 'Program link failed');
    }
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    this.program = prog;

    this.vao = gl.createVertexArray()!;
    this.vbo = gl.createBuffer()!;
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
      gl.STATIC_DRAW,
    );
    const loc = gl.getAttribLocation(prog, 'a_pos');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

    this.texture = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  }

  private compile(type: number, src: string): WebGLShader {
    const gl = this.gl;
    const shader = gl.createShader(type)!;
    gl.shaderSource(shader, src);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      throw new Error(gl.getShaderInfoLog(shader) ?? 'Shader compile failed');
    }
    return shader;
  }

  setFloatRGBA(width: number, height: number, data: Float32Array): void {
    const gl = this.gl;
    this.imgWidth = width;
    this.imgHeight = height;
    this.isFloatTex = true;
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, width, height, 0, gl.RGBA, gl.FLOAT, data);
  }

  setUint8RGBA(width: number, height: number, data: Uint8Array): void {
    const gl = this.gl;
    this.imgWidth = width;
    this.imgHeight = height;
    this.isFloatTex = false;
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
  }

  setDrawableSource(source: TexImageSource, width: number, height: number): void {
    const gl = this.gl;
    this.imgWidth = Math.max(1, width);
    this.imgHeight = Math.max(1, height);
    this.isFloatTex = false;
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
  }

  render(vw: number, vh: number, u: RenderUniforms): void {
    const gl = this.gl;
    gl.viewport(0, 0, vw, vh);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(this.program);
    gl.bindVertexArray(this.vao);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.texture);

    const useNearest = u.zoom > 2.0 || (this.isFloatTex && !this.floatLinearSupported);
    const filter = useNearest ? gl.NEAREST : gl.LINEAR;
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);

    gl.uniform1i(gl.getUniformLocation(this.program, 'u_tex'), 0);
    gl.uniform2f(gl.getUniformLocation(this.program, 'u_viewport'), vw, vh);
    gl.uniform2f(gl.getUniformLocation(this.program, 'u_imgSize'), this.imgWidth, this.imgHeight);
    gl.uniform1f(gl.getUniformLocation(this.program, 'u_zoom'), u.zoom);
    gl.uniform2f(gl.getUniformLocation(this.program, 'u_pan'), u.panX, u.panY);
    gl.uniform1i(gl.getUniformLocation(this.program, 'u_inputSpace'), u.inputSpace);
    gl.uniform1i(gl.getUniformLocation(this.program, 'u_displayView'), u.displayView);
    gl.uniform1f(gl.getUniformLocation(this.program, 'u_exposure'), u.exposure);
    gl.uniform1f(gl.getUniformLocation(this.program, 'u_gamma'), u.gamma);
    gl.uniform1f(gl.getUniformLocation(this.program, 'u_saturation'), u.saturation);
    gl.uniform1f(gl.getUniformLocation(this.program, 'u_hue'), u.hue);
    gl.uniform1i(gl.getUniformLocation(this.program, 'u_channel'), u.channel);
    gl.uniform1i(gl.getUniformLocation(this.program, 'u_pixelGrid'), u.pixelGrid ? 1 : 0);
    gl.uniform1i(gl.getUniformLocation(this.program, 'u_clipping'), u.clipping ? 1 : 0);
    gl.uniform1i(gl.getUniformLocation(this.program, 'u_falseColor'), u.falseColor ? 1 : 0);
    gl.uniform1i(gl.getUniformLocation(this.program, 'u_bypass'), u.bypass ? 1 : 0);
    gl.uniform1i(gl.getUniformLocation(this.program, 'u_useCustomRect'), 0);
    gl.uniform4f(gl.getUniformLocation(this.program, 'u_customRect'), 0, 0, 1, 1);

    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  clearViewport(vw: number, vh: number): void {
    const gl = this.gl;
    gl.viewport(0, 0, vw, vh);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
  }

  createFloatTexture(width: number, height: number, data: Float32Array): WebGLTexture {
    const gl = this.gl;
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, width, height, 0, gl.RGBA, gl.FLOAT, data);
    return tex;
  }

  createUint8Texture(width: number, height: number, data: Uint8Array): WebGLTexture {
    const gl = this.gl;
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
    return tex;
  }

  deleteExternalTexture(tex: WebGLTexture): void {
    this.gl.deleteTexture(tex);
  }

  renderTileRect(
    vw: number,
    vh: number,
    tex: WebGLTexture,
    tileW: number,
    tileH: number,
    isFloat: boolean,
    originX: number,
    originY: number,
    drawW: number,
    drawH: number,
    u: RenderUniforms,
  ): void {
    const gl = this.gl;
    gl.viewport(0, 0, vw, vh);
    gl.useProgram(this.program);
    gl.bindVertexArray(this.vao);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, tex);

    const effZoom = drawW / Math.max(1, tileW);
    const useNearest = effZoom > 2.0 || (isFloat && !this.floatLinearSupported);
    const filter = useNearest ? gl.NEAREST : gl.LINEAR;
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);

    gl.uniform1i(gl.getUniformLocation(this.program, 'u_tex'), 0);
    gl.uniform2f(gl.getUniformLocation(this.program, 'u_viewport'), vw, vh);
    gl.uniform2f(gl.getUniformLocation(this.program, 'u_imgSize'), tileW, tileH);
    gl.uniform1f(gl.getUniformLocation(this.program, 'u_zoom'), effZoom);
    gl.uniform2f(gl.getUniformLocation(this.program, 'u_pan'), 0, 0);
    gl.uniform1i(gl.getUniformLocation(this.program, 'u_inputSpace'), u.inputSpace);
    gl.uniform1i(gl.getUniformLocation(this.program, 'u_displayView'), u.displayView);
    gl.uniform1f(gl.getUniformLocation(this.program, 'u_exposure'), u.exposure);
    gl.uniform1f(gl.getUniformLocation(this.program, 'u_gamma'), u.gamma);
    gl.uniform1f(gl.getUniformLocation(this.program, 'u_saturation'), u.saturation);
    gl.uniform1f(gl.getUniformLocation(this.program, 'u_hue'), u.hue);
    gl.uniform1i(gl.getUniformLocation(this.program, 'u_channel'), u.channel);
    gl.uniform1i(gl.getUniformLocation(this.program, 'u_pixelGrid'), u.pixelGrid ? 1 : 0);
    gl.uniform1i(gl.getUniformLocation(this.program, 'u_clipping'), u.clipping ? 1 : 0);
    gl.uniform1i(gl.getUniformLocation(this.program, 'u_falseColor'), u.falseColor ? 1 : 0);
    gl.uniform1i(gl.getUniformLocation(this.program, 'u_bypass'), u.bypass ? 1 : 0);
    gl.uniform1i(gl.getUniformLocation(this.program, 'u_useCustomRect'), 1);
    gl.uniform4f(gl.getUniformLocation(this.program, 'u_customRect'), originX, originY, drawW, drawH);

    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  dispose(): void {
    const gl = this.gl;
    gl.deleteTexture(this.texture);
    gl.deleteBuffer(this.vbo);
    gl.deleteVertexArray(this.vao);
    gl.deleteProgram(this.program);
  }
}

