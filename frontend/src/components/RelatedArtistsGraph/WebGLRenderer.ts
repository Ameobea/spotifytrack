/**
 * Minimal purpose-built WebGL2 renderer for the related artists graph, replacing PIXI.
 *
 * Three instanced draw passes: edges (segment-expanded quads), node pills (SDF rounded
 * rects), and labels (quads sampling a 2x text atlas).  Node positions live in one shared
 * dynamic buffer consumed by the pill + label passes; edge endpoint quads are rebuilt from
 * positions on dirty frames.  Rendering is skipped entirely when nothing changed.
 */
import * as conf from './conf';
import { logEvent } from 'src/eventAnalytics';
import type { Link, Node, RelatedArtistsRenderer } from './RelatedArtistsGraph';

const PILL_HALF_H = 12;
const PILL_RADIUS = 4;
// matches the old PIXI `resolution: 2`: always render 2x for crisp text, even on dpr-1 displays
const RESOLUTION = 2;
const INITIAL_ZOOM = 1.2;
const ATLAS_SCALE = 2;
const ATLAS_WIDTH = 2048;
const DOUBLE_CLICK_MS = 400;
const CLICK_MOVE_THRESHOLD_PX = 4;

const EDGE_VS = `#version 300 es
layout(location=0) in vec2 corner; // (t, side)
layout(location=1) in vec4 iSeg;   // ax, ay, bx, by (world)
uniform vec2 uCam;
uniform float uScale;
uniform vec2 uRes;
uniform float uWidth; // >0: world units; <0: fixed screen pixels (hairline mode)
out float vDist;
out float vHalfW;
void main() {
  vec2 a = iSeg.xy * uScale + uCam;
  vec2 b = iSeg.zw * uScale + uCam;
  vec2 dir = b - a;
  float len = max(length(dir), 0.0001);
  vec2 norm = vec2(-dir.y, dir.x) / len;
  float px = uWidth > 0.0 ? max(uWidth * uScale, 0.9) : -uWidth;
  float halfW = px * 0.5 + 0.35;
  vec2 p = mix(a, b, corner.x) + norm * halfW * corner.y;
  vDist = halfW * corner.y;
  vHalfW = halfW;
  gl_Position = vec4(p.x / uRes.x * 2.0 - 1.0, 1.0 - p.y / uRes.y * 2.0, 0.0, 1.0);
}`;

const EDGE_FS = `#version 300 es
precision highp float;
uniform vec4 uColor;
in float vDist;
in float vHalfW;
out vec4 outColor;
void main() {
  float alpha = smoothstep(vHalfW, vHalfW - 0.85, abs(vDist));
  outColor = vec4(uColor.rgb, uColor.a * alpha);
}`;

const PILL_VS = `#version 300 es
layout(location=0) in vec2 corner; // unit quad [-1, 1]
layout(location=1) in vec2 iPos;
layout(location=2) in float iHalfW;
layout(location=3) in vec4 iColor;
layout(location=4) in float iZ;
uniform vec2 uCam;
uniform float uScale;
uniform vec2 uRes;
uniform float uZStep;
out vec2 vLocal;
out float vHalfW;
out vec4 vColor;
void main() {
  vec2 halfSize = vec2(iHalfW, ${PILL_HALF_H.toFixed(1)}) + 1.0;
  vLocal = corner * halfSize;
  vHalfW = iHalfW;
  vColor = iColor;
  vec2 p = (iPos + vLocal) * uScale + uCam;
  // higher z-rank draws on top; depth carries this across the label pass
  float z = 1.0 - (iZ + 1.0) * uZStep;
  gl_Position = vec4(p.x / uRes.x * 2.0 - 1.0, 1.0 - p.y / uRes.y * 2.0, z, 1.0);
}`;

const PILL_FS = `#version 300 es
precision highp float;
in vec2 vLocal;
in float vHalfW;
in vec4 vColor;
uniform float uScale;
out vec4 outColor;
void main() {
  vec2 halfSize = vec2(vHalfW, ${PILL_HALF_H.toFixed(1)});
  vec2 q = abs(vLocal) - (halfSize - ${PILL_RADIUS.toFixed(1)});
  float d = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - ${PILL_RADIUS.toFixed(1)};
  float aa = 1.0 / uScale;
  float fill = smoothstep(0.0, -aa, d + 1.0);
  float shape = smoothstep(0.0, -aa, d);
  if (shape < 0.01) discard;
  vec3 rgb = mix(vec3(0.0), vColor.rgb, fill);
  outColor = vec4(rgb, shape);
}`;

const LABEL_VS = `#version 300 es
layout(location=0) in vec2 corner; // unit quad [0, 1]
layout(location=1) in vec2 iPos;   // node position
layout(location=2) in vec4 iRect;  // label offsetX, offsetY, w, h (world, relative to node)
layout(location=3) in vec4 iUV;    // u0, v0, u1, v1
layout(location=4) in float iZ;
uniform vec2 uCam;
uniform float uScale;
uniform vec2 uRes;
uniform float uZStep;
out vec2 vUV;
void main() {
  vec2 world = iPos + iRect.xy + corner * iRect.zw;
  vec2 p = world * uScale + uCam;
  vUV = mix(iUV.xy, iUV.zw, corner);
  float z = 1.0 - (iZ + 1.0) * uZStep;
  gl_Position = vec4(p.x / uRes.x * 2.0 - 1.0, 1.0 - p.y / uRes.y * 2.0, z, 1.0);
}`;

const LABEL_FS = `#version 300 es
precision highp float;
uniform sampler2D uAtlas;
in vec2 vUV;
out vec4 outColor;
void main() {
  float a = texture(uAtlas, vUV).a;
  outColor = vec4(0.0, 0.0, 0.0, a);
}`;

const hexColor = (hex: number, out: Uint8Array, offset: number) => {
  out[offset] = (hex >> 16) & 0xff;
  out[offset + 1] = (hex >> 8) & 0xff;
  out[offset + 2] = hex & 0xff;
  out[offset + 3] = 255;
};

const dimHex = (hex: number, f: number): number => {
  const r = Math.round(((hex >> 16) & 0xff) * f);
  const g = Math.round(((hex >> 8) & 0xff) * f);
  const b = Math.round((hex & 0xff) * f);
  return (r << 16) | (g << 8) | b;
};

interface AtlasEntry {
  u0: number;
  v0: number;
  u1: number;
  v1: number;
  width: number; // world units
  height: number;
}

/** Shelf-packed canvas of pre-rasterized labels, drawn at 2x for crispness */
class TextAtlas {
  public canvas: HTMLCanvasElement = document.createElement('canvas');
  private ctx: CanvasRenderingContext2D;
  private entries: Map<string, AtlasEntry> = new Map();
  private shelfX = 0;
  private shelfY = 0;
  private shelfHeight = 18 * ATLAS_SCALE;
  public dirty = false;

  constructor() {
    this.canvas.width = ATLAS_WIDTH;
    this.canvas.height = 512;
    this.ctx = this.canvas.getContext('2d')!;
    this.initCtx();
  }

  private initCtx() {
    this.ctx.font = `${12 * ATLAS_SCALE}px "PT Sans"`;
    this.ctx.textBaseline = 'top';
    this.ctx.fillStyle = '#000';
    this.ctx.strokeStyle = '#000';
    this.ctx.lineWidth = 0.35;
  }

  public get(label: string): AtlasEntry {
    const existing = this.entries.get(label);
    if (existing) {
      return existing;
    }

    const pxWidth = Math.ceil(this.ctx.measureText(label).width) + 2;
    const pxHeight = 16 * ATLAS_SCALE;
    if (this.shelfX + pxWidth > ATLAS_WIDTH) {
      this.shelfX = 0;
      this.shelfY += this.shelfHeight;
    }
    if (this.shelfY + this.shelfHeight > this.canvas.height) {
      const old = this.ctx.getImageData(0, 0, this.canvas.width, this.canvas.height);
      this.canvas.height *= 2;
      this.initCtx();
      this.ctx.putImageData(old, 0, 0);
      // uv coords of existing entries are re-derived at buffer build time from px coords,
      // so entries store px and we recompute; simplest is to store px and divide on demand
      for (const entry of this.entries.values()) {
        entry.v0 /= 2;
        entry.v1 /= 2;
      }
    }

    this.ctx.fillText(label, this.shelfX + 1, this.shelfY);
    this.ctx.strokeText(label, this.shelfX + 1, this.shelfY);
    const entry: AtlasEntry = {
      u0: this.shelfX / ATLAS_WIDTH,
      v0: this.shelfY / this.canvas.height,
      u1: (this.shelfX + pxWidth) / ATLAS_WIDTH,
      v1: (this.shelfY + pxHeight) / this.canvas.height,
      width: pxWidth / ATLAS_SCALE,
      height: pxHeight / ATLAS_SCALE,
    };
    this.entries.set(label, entry);
    this.shelfX += pxWidth;
    this.dirty = true;
    return entry;
  }

  public clear() {
    this.entries.clear();
    this.shelfX = 0;
    this.shelfY = 0;
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.initCtx();
    this.dirty = true;
  }
}

interface CanvasNode {
  node: Node;
  pos: { x: number; y: number };
}

export default class RelatedArtistsGraphWebGLRenderer {
  private canvas: HTMLCanvasElement;
  private gl!: WebGL2RenderingContext;
  private layout: any;
  private parent: RelatedArtistsRenderer;
  private nodes: CanvasNode[] = [];
  private links: { source: number; target: number }[] = [];
  private atlas = new TextAtlas();
  private cssWidth: number;
  private cssHeight: number;
  private cam = { tx: 0, ty: 0, scale: 1 };

  private selectedArtistID: string | null = null;
  private selectedNeighborIndices: Set<number> = new Set();
  private selectedLinkIndices: number[] = [];
  /** per-node draw order rank: selecting a node bumps it above everything drawn so far */
  private zRank = new Float32Array(0);
  private nextZRank = 0;

  private positionsDirty = true;
  private colorsDirty = true;
  private staticDirty = true;
  private cameraDirty = true;
  private isTicking = false;
  private contextLost = false;
  private destroyed = false;

  // GL resources (rebuilt on context restore)
  private edgeProg!: WebGLProgram;
  private pillProg!: WebGLProgram;
  private labelProg!: WebGLProgram;
  private edgeVAO!: WebGLVertexArrayObject;
  private pillVAO!: WebGLVertexArrayObject;
  private labelVAO!: WebGLVertexArrayObject;
  private posBuf!: WebGLBuffer;
  private pillHalfWBuf!: WebGLBuffer;
  private pillColorBuf!: WebGLBuffer;
  private zRankBuf!: WebGLBuffer;
  private labelRectBuf!: WebGLBuffer;
  private labelUVBuf!: WebGLBuffer;
  private edgeSegBuf!: WebGLBuffer;
  private selEdgeSegBuf!: WebGLBuffer;
  private atlasTex!: WebGLTexture;
  private uniforms: Record<string, Record<string, WebGLUniformLocation>> = {};

  private posArr = new Float32Array(0);
  private edgeSegArr = new Float32Array(0);

  private tickTimes: number[] = [];

  // interaction state
  private pointers: Map<number, { x: number; y: number }> = new Map();
  private draggingNode: Node | null = null;
  private draggingIx = -1;
  private panning = false;
  private downPos = { x: 0, y: 0 };
  private moved = false;
  private lastClick: { nodeIx: number; time: number } | null = null;

  constructor(
    canvas: HTMLCanvasElement,
    height: number,
    width: number,
    layout: any,
    parent: RelatedArtistsRenderer
  ) {
    this.canvas = canvas;
    this.layout = layout;
    this.parent = parent;
    this.cssWidth = width;
    this.cssHeight = height;
    (window as any).__relatedArtistsRenderer = this;

    // zoom in slightly about the viewport center
    this.cam = {
      tx: ((1 - INITIAL_ZOOM) * width) / 2,
      ty: ((1 - INITIAL_ZOOM) * height) / 2,
      scale: INITIAL_ZOOM,
    };

    // Hack for the embedded standalone graph which is locked to my personal artists
    if (window.location.href.includes('graph.html')) {
      this.cam = { tx: 575, ty: 400, scale: 0.82 };
    }

    canvas.addEventListener('webglcontextlost', (evt) => {
      evt.preventDefault();
      this.contextLost = true;
    });
    canvas.addEventListener('webglcontextrestored', () => {
      this.contextLost = false;
      this.initGL();
    });

    this.initGL();
    this.setSize(width, height);
    this.bindInputHandlers();

    layout.kick = () => {
      this.isTicking = true;
    };

    const frame = () => {
      if (this.destroyed) {
        return;
      }
      this.tickAndRender();
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);

    // re-rasterize labels once the webfont is ready in case we raced it
    (document as any).fonts?.ready?.then(() => {
      this.atlas.clear();
      this.staticDirty = true;
    });
  }

  private initGL() {
    const gl = this.canvas.getContext('webgl2', {
      antialias: true,
      alpha: false,
      premultipliedAlpha: true,
    });
    if (!gl) {
      throw new Error('WebGL2 not supported');
    }
    this.gl = gl;

    const compile = (type: number, src: string) => {
      const shader = gl.createShader(type)!;
      gl.shaderSource(shader, src);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        throw new Error(`shader compile error: ${gl.getShaderInfoLog(shader)}`);
      }
      return shader;
    };
    const link = (vs: string, fs: string) => {
      const prog = gl.createProgram()!;
      gl.attachShader(prog, compile(gl.VERTEX_SHADER, vs));
      gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, fs));
      gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
        throw new Error(`program link error: ${gl.getProgramInfoLog(prog)}`);
      }
      return prog;
    };

    this.edgeProg = link(EDGE_VS, EDGE_FS);
    this.pillProg = link(PILL_VS, PILL_FS);
    this.labelProg = link(LABEL_VS, LABEL_FS);
    for (const [name, prog] of [
      ['edge', this.edgeProg],
      ['pill', this.pillProg],
      ['label', this.labelProg],
    ] as const) {
      const u: Record<string, WebGLUniformLocation> = {};
      for (const uniform of ['uCam', 'uScale', 'uRes', 'uWidth', 'uColor', 'uAtlas', 'uZStep']) {
        const loc = gl.getUniformLocation(prog, uniform);
        if (loc) u[uniform] = loc;
      }
      this.uniforms[name] = u;
    }

    this.posBuf = gl.createBuffer()!;
    this.pillHalfWBuf = gl.createBuffer()!;
    this.pillColorBuf = gl.createBuffer()!;
    this.zRankBuf = gl.createBuffer()!;
    this.labelRectBuf = gl.createBuffer()!;
    this.labelUVBuf = gl.createBuffer()!;
    this.edgeSegBuf = gl.createBuffer()!;
    this.selEdgeSegBuf = gl.createBuffer()!;

    const quadBuf = (data: number[]) => {
      const buf = gl.createBuffer()!;
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(data), gl.STATIC_DRAW);
      return buf;
    };
    // (t, side) for edges; [-1,1] quad for pills; [0,1] quad for labels
    const edgeCorners = quadBuf([0, -1, 1, -1, 0, 1, 1, 1]);
    const pillCorners = quadBuf([-1, -1, 1, -1, -1, 1, 1, 1]);
    const labelCorners = quadBuf([0, 0, 1, 0, 0, 1, 1, 1]);

    const mkVAO = (setup: () => void) => {
      const vao = gl.createVertexArray()!;
      gl.bindVertexArray(vao);
      setup();
      gl.bindVertexArray(null);
      return vao;
    };
    const attr = (buf: WebGLBuffer, loc: number, size: number, divisor: number, type = gl.FLOAT, normalized = false, stride = 0, offset = 0) => {
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, size, type, normalized, stride, offset);
      gl.vertexAttribDivisor(loc, divisor);
    };

    this.edgeVAO = mkVAO(() => {
      attr(edgeCorners, 0, 2, 0);
      attr(this.edgeSegBuf, 1, 4, 1);
    });
    this.pillVAO = mkVAO(() => {
      attr(pillCorners, 0, 2, 0);
      attr(this.posBuf, 1, 2, 1);
      attr(this.pillHalfWBuf, 2, 1, 1);
      attr(this.pillColorBuf, 3, 4, 1, gl.UNSIGNED_BYTE, true);
      attr(this.zRankBuf, 4, 1, 1);
    });
    this.labelVAO = mkVAO(() => {
      attr(labelCorners, 0, 2, 0);
      attr(this.posBuf, 1, 2, 1);
      attr(this.labelRectBuf, 2, 4, 1);
      attr(this.labelUVBuf, 3, 4, 1);
      attr(this.zRankBuf, 4, 1, 1);
    });

    this.atlasTex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, this.atlasTex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    gl.enable(gl.BLEND);
    gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

    this.atlas.dirty = true;
    this.staticDirty = true;
    this.positionsDirty = true;
    this.colorsDirty = true;
    this.cameraDirty = true;
  }

  public setSize(width: number, height: number) {
    this.cssWidth = width;
    this.cssHeight = height;
    this.canvas.width = Math.round(width * RESOLUTION);
    this.canvas.height = Math.round(height * RESOLUTION);
    this.cameraDirty = true;
  }

  public addNodes(newNodes: Node[], links: Link[]) {
    this.nodes.push(...newNodes.map((node) => ({ node, pos: { x: node.x, y: node.y } })));
    this.links.push(...links);
    const grown = new Float32Array(this.nodes.length);
    grown.set(this.zRank);
    for (let i = this.zRank.length; i < this.nodes.length; i++) {
      grown[i] = this.nextZRank++;
    }
    this.zRank = grown;
    this.staticDirty = true;
    this.positionsDirty = true;
    this.colorsDirty = true;
  }

  // ------------------------------------------------------------------ selection

  private setSelectedArtistID(newSelectedArtistID: string | null) {
    this.selectedArtistID = newSelectedArtistID;
    this.selectedNeighborIndices.clear();
    this.selectedLinkIndices = [];
    if (newSelectedArtistID) {
      const ix = this.nodes.findIndex(({ node }) => node.artistID === newSelectedArtistID);
      if (ix >= 0) {
        this.zRank[ix] = this.nextZRank++;
      }
      this.links.forEach(({ source, target }, i) => {
        const srcID = this.nodes[source].node.artistID;
        const tgtID = this.nodes[target].node.artistID;
        if (srcID === newSelectedArtistID) {
          this.selectedNeighborIndices.add(target);
          this.selectedLinkIndices.push(i);
        } else if (tgtID === newSelectedArtistID) {
          this.selectedNeighborIndices.add(source);
          this.selectedLinkIndices.push(i);
        }
      });
    }
    this.colorsDirty = true;

    if (newSelectedArtistID !== null && !(window as any).__relatedArtistsGraphEngaged) {
      (window as any).__relatedArtistsGraphEngaged = true;
      logEvent('graph', 'engaged');
    }
  }

  private getNodeColor(nodeIx: number): number {
    const node = this.nodes[nodeIx].node;
    if (!this.selectedArtistID) {
      const color = node.isPrimary
        ? conf.PRIMARY_NODE_COLOR[R.isNil(node.userIndex) ? 0 : node.userIndex + 1]
        : conf.SECONDARY_NODE_COLOR;
      return dimHex(color, conf.DEFAULT_NODE_DIM);
    }

    if (this.selectedArtistID === node.artistID) {
      return conf.SELECTED_NODE_COLOR;
    }

    if (this.selectedNeighborIndices.has(nodeIx)) {
      return node.isPrimary
        ? conf.PRIMARY_CONNECTED_TO_SELECTED_NODE_COLOR[
            R.isNil(node.userIndex) ? 0 : node.userIndex + 1
          ]
        : conf.SECONDARY_CONNECTED_TO_SELECTED_NODE_COLOR;
    }

    return node.isPrimary
      ? conf.DULL_PRIMARY_NODE_COLOR[R.isNil(node.userIndex) ? 0 : node.userIndex + 1]
      : conf.DULL_SECONDARY_NODE_COLOR;
  }

  // ------------------------------------------------------------------ buffers

  private uploadStatic() {
    const gl = this.gl;
    const n = this.nodes.length;

    // populate the atlas fully first: growing it rescales existing entries' UVs, so
    // coordinates are only stable once every label is in
    for (let i = 0; i < n; i++) {
      this.atlas.get(this.nodes[i].node.name);
    }

    const halfWs = new Float32Array(n);
    const rects = new Float32Array(n * 4);
    const uvs = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) {
      const node = this.nodes[i].node;
      halfWs[i] = node.width / 2;
      const entry = this.atlas.get(node.name);
      rects[i * 4] = -node.width / 2 + 4;
      // the glyph em box occupies the top 12 of the 16-unit cell; +2 centers the em box
      rects[i * 4 + 1] = -entry.height / 2 + 2;
      rects[i * 4 + 2] = entry.width;
      rects[i * 4 + 3] = entry.height;
      uvs[i * 4] = entry.u0;
      uvs[i * 4 + 1] = entry.v0;
      uvs[i * 4 + 2] = entry.u1;
      uvs[i * 4 + 3] = entry.v1;
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, this.pillHalfWBuf);
    gl.bufferData(gl.ARRAY_BUFFER, halfWs, gl.STATIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.labelRectBuf);
    gl.bufferData(gl.ARRAY_BUFFER, rects, gl.STATIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.labelUVBuf);
    gl.bufferData(gl.ARRAY_BUFFER, uvs, gl.STATIC_DRAW);

    if (this.atlas.dirty) {
      gl.bindTexture(gl.TEXTURE_2D, this.atlasTex);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, this.atlas.canvas);
      this.atlas.dirty = false;
    }

    this.edgeSegArr = new Float32Array(this.links.length * 4);
    this.staticDirty = false;
  }

  private uploadColors() {
    const gl = this.gl;
    const n = this.nodes.length;
    const colors = new Uint8Array(n * 4);
    for (let i = 0; i < n; i++) {
      hexColor(this.getNodeColor(i), colors, i * 4);
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, this.pillColorBuf);
    gl.bufferData(gl.ARRAY_BUFFER, colors, gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.zRankBuf);
    gl.bufferData(gl.ARRAY_BUFFER, this.zRank, gl.DYNAMIC_DRAW);
    this.colorsDirty = false;
  }

  private uploadPositions() {
    const gl = this.gl;
    const n = this.nodes.length;
    if (this.posArr.length !== n * 2) {
      this.posArr = new Float32Array(n * 2);
    }
    for (let i = 0; i < n; i++) {
      const pos = this.nodes[i].pos;
      this.posArr[i * 2] = pos.x;
      this.posArr[i * 2 + 1] = pos.y;
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, this.posBuf);
    gl.bufferData(gl.ARRAY_BUFFER, this.posArr, gl.DYNAMIC_DRAW);

    for (let i = 0; i < this.links.length; i++) {
      const { source, target } = this.links[i];
      this.edgeSegArr[i * 4] = this.posArr[source * 2];
      this.edgeSegArr[i * 4 + 1] = this.posArr[source * 2 + 1];
      this.edgeSegArr[i * 4 + 2] = this.posArr[target * 2];
      this.edgeSegArr[i * 4 + 3] = this.posArr[target * 2 + 1];
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, this.edgeSegBuf);
    gl.bufferData(gl.ARRAY_BUFFER, this.edgeSegArr, gl.DYNAMIC_DRAW);

    if (this.selectedLinkIndices.length > 0) {
      const sel = new Float32Array(this.selectedLinkIndices.length * 4);
      this.selectedLinkIndices.forEach((linkIx, i) => {
        sel.set(this.edgeSegArr.subarray(linkIx * 4, linkIx * 4 + 4), i * 4);
      });
      gl.bindBuffer(gl.ARRAY_BUFFER, this.selEdgeSegBuf);
      gl.bufferData(gl.ARRAY_BUFFER, sel, gl.DYNAMIC_DRAW);
    }

    this.positionsDirty = false;
  }

  /**
   * Adaptive integrator: upgrade midpoint -> RK4 when there's ample frame budget,
   * downgrade when there isn't.  Only frames where the layout actually iterated count.
   */
  private recordTickTime(dt: number) {
    if (typeof this.layout.integrator !== 'function') {
      return;
    }
    this.tickTimes.push(dt);
    if (this.tickTimes.length < conf.ADAPT_WINDOW) {
      return;
    }
    const sorted = [...this.tickTimes].sort((a, b) => a - b);
    const p90 = sorted[Math.floor(sorted.length * 0.9)];
    const mode = this.layout.integrator();
    if (mode === 1 && p90 < conf.RK4_UPGRADE_TICK_MS) {
      this.layout.integrator(0);
      this.tickTimes = [];
    } else if (mode === 0 && p90 > conf.RK4_DOWNGRADE_TICK_MS) {
      this.layout.integrator(1);
      this.tickTimes = [];
    } else {
      this.tickTimes.shift();
    }
  }

  // ------------------------------------------------------------------ render

  private tickAndRender() {
    if (this.contextLost) {
      return;
    }

    if (this.isTicking) {
      const t0 = performance.now();
      const converged = this.layout.tick();
      if (!converged) {
        this.recordTickTime(performance.now() - t0);
        const layoutNodes = this.layout.nodes() as { x: number; y: number }[];
        for (let i = 0; i < this.nodes.length && i < layoutNodes.length; i++) {
          this.nodes[i].pos.x = layoutNodes[i].x;
          this.nodes[i].pos.y = layoutNodes[i].y;
        }
        this.positionsDirty = true;
      }
    }

    if (this.nodes.length === 0) {
      return;
    }
    const needsRender =
      this.staticDirty || this.positionsDirty || this.colorsDirty || this.cameraDirty;
    if (!needsRender) {
      return;
    }

    const gl = this.gl;
    if (this.staticDirty) this.uploadStatic();
    if (this.colorsDirty) this.uploadColors();
    if (this.positionsDirty) this.uploadPositions();
    this.cameraDirty = false;

    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    const bg = conf.BACKGROUND_COLOR;
    gl.clearColor(((bg >> 16) & 0xff) / 255, ((bg >> 8) & 0xff) / 255, (bg & 0xff) / 255, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    const setCommonUniforms = (u: Record<string, WebGLUniformLocation>) => {
      gl.uniform2f(u.uCam, this.cam.tx, this.cam.ty);
      gl.uniform1f(u.uScale, this.cam.scale);
      gl.uniform2f(u.uRes, this.cssWidth, this.cssHeight);
    };
    const setColorUniform = (u: Record<string, WebGLUniformLocation>, hex: number, alpha: number) => {
      gl.uniform4f(u.uColor, ((hex >> 16) & 0xff) / 255, ((hex >> 8) & 0xff) / 255, (hex & 0xff) / 255, alpha);
    };

    // edges
    if (this.links.length > 0) {
      gl.useProgram(this.edgeProg);
      const u = this.uniforms.edge;
      setCommonUniforms(u);
      // matches the old PIXI behavior: native 1px hairlines above 4000 links
      gl.uniform1f(u.uWidth, this.links.length > 4000 ? -1 : 1.3);
      setColorUniform(u, this.selectedArtistID ? conf.DULL_EDGE_COLOR : conf.EDGE_COLOR, 1);
      gl.bindVertexArray(this.edgeVAO);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.edgeSegBuf);
      gl.enableVertexAttribArray(1);
      gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 0, 0);
      gl.vertexAttribDivisor(1, 1);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, this.links.length);

      if (this.selectedLinkIndices.length > 0) {
        gl.uniform1f(u.uWidth, 2.4);
        setColorUniform(u, conf.EDGE_COLOR, 1);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.selEdgeSegBuf);
        gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 0, 0);
        gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, this.selectedLinkIndices.length);
      }
    }

    // pills + labels use a per-instance depth so that a covering pill also covers the
    // labels of nodes underneath it
    const zStep = 2 / (this.nextZRank + 2);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);

    // pills
    gl.useProgram(this.pillProg);
    setCommonUniforms(this.uniforms.pill);
    gl.uniform1f(this.uniforms.pill.uZStep, zStep);
    gl.depthMask(true);
    gl.bindVertexArray(this.pillVAO);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, this.nodes.length);

    // labels
    gl.useProgram(this.labelProg);
    setCommonUniforms(this.uniforms.label);
    gl.uniform1f(this.uniforms.label.uZStep, zStep);
    gl.depthMask(false);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.atlasTex);
    gl.uniform1i(this.uniforms.label.uAtlas, 0);
    gl.bindVertexArray(this.labelVAO);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, this.nodes.length);

    gl.depthMask(true);
    gl.disable(gl.DEPTH_TEST);
    gl.bindVertexArray(null);
  }

  // ------------------------------------------------------------------ input

  private screenToWorld(sx: number, sy: number): { x: number; y: number } {
    return {
      x: (sx - this.cam.tx) / this.cam.scale,
      y: (sy - this.cam.ty) / this.cam.scale,
    };
  }

  private hitTest(sx: number, sy: number): number {
    const { x, y } = this.screenToWorld(sx, sy);
    let best = -1;
    for (let i = 0; i < this.nodes.length; i++) {
      const { node, pos } = this.nodes[i];
      if (
        Math.abs(x - pos.x) <= node.width / 2 &&
        Math.abs(y - pos.y) <= PILL_HALF_H &&
        (best < 0 || this.zRank[i] > this.zRank[best])
      ) {
        best = i;
      }
    }
    return best;
  }

  private eventPos(evt: PointerEvent): { x: number; y: number } {
    const rect = this.canvas.getBoundingClientRect();
    return { x: evt.clientX - rect.left, y: evt.clientY - rect.top };
  }

  private bindInputHandlers() {
    const canvas = this.canvas;
    canvas.style.touchAction = 'none';
    canvas.style.cursor = 'grab';

    canvas.addEventListener('pointerdown', (evt) => {
      if (evt.button !== 0 && evt.pointerType === 'mouse') {
        return;
      }
      const pos = this.eventPos(evt);
      this.pointers.set(evt.pointerId, pos);
      canvas.setPointerCapture(evt.pointerId);

      if (this.pointers.size > 1) {
        // second finger: switch to pinch, abort any drag
        if (this.draggingNode) {
          this.layout.constructor.dragEnd(this.draggingNode);
          this.draggingNode = null;
        }
        this.panning = false;
        return;
      }

      this.downPos = pos;
      this.moved = false;

      const hitIx = this.hitTest(pos.x, pos.y);
      if (hitIx >= 0) {
        const now = performance.now();
        if (
          this.lastClick &&
          this.lastClick.nodeIx === hitIx &&
          now - this.lastClick.time <= DOUBLE_CLICK_MS
        ) {
          this.lastClick = null;
          const node = this.nodes[hitIx].node;
          this.parent.loadConnections(node).then(() => this.setSelectedArtistID(node.artistID));
          return;
        }
        this.lastClick = { nodeIx: hitIx, time: now };
        this.setSelectedArtistID(this.nodes[hitIx].node.artistID);

        this.draggingNode = this.nodes[hitIx].node;
        this.draggingIx = hitIx;
        this.layout.constructor.dragStart(this.draggingNode);
        canvas.style.cursor = 'pointer';
      } else {
        this.panning = true;
        canvas.style.cursor = 'grabbing';
      }
    });

    canvas.addEventListener('pointermove', (evt) => {
      const pos = this.eventPos(evt);
      const prev = this.pointers.get(evt.pointerId);

      if (this.pointers.size === 2 && prev) {
        // pinch: zoom around the midpoint, pan by midpoint movement
        const other = [...this.pointers.entries()].find(([id]) => id !== evt.pointerId);
        if (other) {
          const [, otherPos] = other;
          const prevDist = Math.hypot(prev.x - otherPos.x, prev.y - otherPos.y);
          const newDist = Math.hypot(pos.x - otherPos.x, pos.y - otherPos.y);
          const prevMid = { x: (prev.x + otherPos.x) / 2, y: (prev.y + otherPos.y) / 2 };
          const newMid = { x: (pos.x + otherPos.x) / 2, y: (pos.y + otherPos.y) / 2 };
          if (prevDist > 10) {
            this.zoomAround(newMid.x, newMid.y, newDist / prevDist);
          }
          this.cam.tx += newMid.x - prevMid.x;
          this.cam.ty += newMid.y - prevMid.y;
          this.cameraDirty = true;
        }
        this.pointers.set(evt.pointerId, pos);
        return;
      }
      this.pointers.set(evt.pointerId, pos);

      if (
        !this.moved &&
        Math.hypot(pos.x - this.downPos.x, pos.y - this.downPos.y) > CLICK_MOVE_THRESHOLD_PX &&
        (this.draggingNode || this.panning)
      ) {
        this.moved = true;
      }

      if (this.draggingNode) {
        const world = this.screenToWorld(pos.x, pos.y);
        this.layout.constructor.drag(this.draggingNode, world);
        // reflect the cursor position immediately rather than waiting for the next tick
        this.nodes[this.draggingIx].pos.x = world.x;
        this.nodes[this.draggingIx].pos.y = world.y;
        this.positionsDirty = true;
        this.layout.resume();
        return;
      }
      if (this.panning) {
        this.cam.tx += evt.movementX;
        this.cam.ty += evt.movementY;
        this.cameraDirty = true;
        return;
      }

      // idle hover: cursor feedback
      canvas.style.cursor = this.hitTest(pos.x, pos.y) >= 0 ? 'pointer' : 'grab';
    });

    const endPointer = (evt: PointerEvent) => {
      this.pointers.delete(evt.pointerId);
      if (this.draggingNode) {
        this.layout.constructor.dragEnd(this.draggingNode);
        this.draggingNode = null;
      }
      if (this.panning && !this.moved) {
        this.setSelectedArtistID(null);
      }
      this.panning = false;
      canvas.style.cursor = 'grab';
    };
    canvas.addEventListener('pointerup', endPointer);
    canvas.addEventListener('pointercancel', endPointer);

    canvas.addEventListener(
      'wheel',
      (evt) => {
        evt.preventDefault();
        const pos = { x: evt.offsetX, y: evt.offsetY };
        this.zoomAround(pos.x, pos.y, Math.pow(2, -evt.deltaY * 0.002));
      },
      { passive: false }
    );
  }

  private zoomAround(sx: number, sy: number, factor: number) {
    const newScale = Math.min(Math.max(this.cam.scale * factor, 0.02), 10);
    const realFactor = newScale / this.cam.scale;
    this.cam.tx = sx - (sx - this.cam.tx) * realFactor;
    this.cam.ty = sy - (sy - this.cam.ty) * realFactor;
    this.cam.scale = newScale;
    this.cameraDirty = true;
  }

  public destroy() {
    this.destroyed = true;
  }
}

// ramda is only used for isNil in the color logic; avoid importing the whole library
const R = {
  isNil: (x: unknown): x is null | undefined => x === null || x === undefined,
};
