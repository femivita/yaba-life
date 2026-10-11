/**
 * Builds city geometry off the main thread so the game never hitches while
 * loading. Output is one set of typed arrays per spatial chunk; the main
 * thread just wraps them in BufferGeometry.
 */
import { ShapeUtils, Vector2 } from 'three';
import type { MapArrays, MapMeta } from '../core/MapData';
import { viewArrays } from '../core/MapData';

export const CHUNK = 320; // metres

export interface ChunkGeometry {
  key: string;
  cx: number;
  cz: number;
  walls?: GeomArrays;
  roofs?: GeomArrays;
  roads?: GeomArrays;
  marks?: GeomArrays;
  areas?: GeomArrays;
  water?: GeomArrays;
  /** x, z, scale, rotation, type (0 broadleaf, 1 palm) per tree */
  trees?: Float32Array;
}

export interface GeomArrays {
  position: Float32Array;
  normal?: Int8Array;
  uv?: Float32Array;
  color?: Uint8Array;
  index: Uint32Array;
}

// palette values are authored in sRGB; vertex colours are read as linear
const LIN = new Uint8Array(256).map((_, i) => Math.round(Math.pow(i / 255, 2.2) * 255));

class Builder {
  pos: number[] = [];
  nrm: number[] = [];
  uv: number[] = [];
  col: number[] = [];
  idx: number[] = [];
  vcount = 0;
  constructor(readonly withNormals = true, readonly withUv = true, readonly withColor = true) {}

  vert(x: number, y: number, z: number, nx: number, ny: number, nz: number, u: number, v: number, c: number[]) {
    this.pos.push(x, y, z);
    if (this.withNormals) this.nrm.push(Math.round(nx * 127), Math.round(ny * 127), Math.round(nz * 127));
    if (this.withUv) this.uv.push(u, v);
    if (this.withColor) this.col.push(LIN[c[0]], LIN[c[1]], LIN[c[2]]);
    return this.vcount++;
  }

  out(): GeomArrays | undefined {
    if (!this.idx.length) return undefined;
    return {
      position: new Float32Array(this.pos),
      normal: this.withNormals ? new Int8Array(this.nrm) : undefined,
      uv: this.withUv ? new Float32Array(this.uv) : undefined,
      color: this.withColor ? new Uint8Array(this.col) : undefined,
      index: new Uint32Array(this.idx),
    };
  }
}

interface ChunkBuilders {
  walls: Builder;
  roofs: Builder;
  roads: Builder;
  marks: Builder;
  areas: Builder;
  water: Builder;
}

const chunks = new Map<string, { cx: number; cz: number; b: ChunkBuilders; trees: number[] }>();

function chunkFor(x: number, z: number) {
  const cx = Math.floor(x / CHUNK);
  const cz = Math.floor(z / CHUNK);
  const key = `${cx},${cz}`;
  let c = chunks.get(key);
  if (!c) {
    c = {
      cx,
      cz,
      b: {
        walls: new Builder(),
        roofs: new Builder(true, false, true),
        roads: new Builder(false, true, true),
        marks: new Builder(false, false, true),
        areas: new Builder(false, false, true),
        water: new Builder(false, true, false),
      },
      trees: [],
    };
    chunks.set(key, c);
  }
  return c;
}

// deterministic hash for per-building variation
function hash(n: number) {
  n = (n ^ 61) ^ (n >>> 16);
  n = n + (n << 3);
  n = n ^ (n >>> 4);
  n = Math.imul(n, 0x27d4eb2d);
  n = n ^ (n >>> 15);
  return (n >>> 0) / 4294967296;
}

// Lagos facades: cream, sand, peach, butter, pale green, sky blue, white, ochre, grey concrete
const FACADES = [
  [232, 222, 196], [222, 205, 170], [236, 196, 160], [240, 222, 150], [196, 214, 180],
  [176, 204, 220], [238, 236, 230], [214, 168, 104], [170, 168, 160], [226, 186, 190],
];
// corrugated roofing: rusty brown, aluminium, faded red, green, plus concrete decks
const ROOFS = [[120, 72, 52], [150, 150, 150], [146, 70, 56], [80, 104, 84], [126, 120, 112], [96, 60, 46]];

function buildBuildings(a: MapArrays, skip: Set<number>) {
  let o = 0;
  const n = a.bCounts.length;
  for (let i = 0; i < n; i++) {
    const cnt = a.bCounts[i];
    if (skip.has(i)) {
      o += cnt;
      continue;
    }
    const h = a.bHeights[i] / 10;
    const kind = a.bKinds[i];
    const r = hash(i + 1);
    let fx = 0;
    let fz = 0;
    for (let k = 0; k < cnt; k++) {
      fx += a.bCoords[(o + k) * 2] / 10;
      fz += a.bCoords[(o + k) * 2 + 1] / 10;
    }
    fx /= cnt;
    fz /= cnt;
    const { b } = chunkFor(fx, fz);
    let facade = FACADES[Math.floor(r * FACADES.length)];
    if (kind === 2) facade = [226, 214, 186];
    if (kind === 4) facade = [236, 236, 228];
    if (kind === 5) facade = [168, 164, 156];
    // a little per-building brightness noise so blocks don't look cloned
    const shade = 0.88 + hash(i * 7 + 3) * 0.16;
    const wc = facade.map((c) => Math.min(255, Math.round(c * shade)));
    // store building kind + window seed in the blue channel's low bits isn't needed; colour only
    const roof = h > 9 && hash(i * 13) > 0.4 ? ROOFS[4] : ROOFS[Math.floor(hash(i * 5 + 1) * 5) % ROOFS.length];

    const ring: Vector2[] = [];
    for (let k = 0; k < cnt; k++) ring.push(new Vector2(a.bCoords[(o + k) * 2] / 10, a.bCoords[(o + k) * 2 + 1] / 10));
    o += cnt;

    // walls
    let u = 0;
    const W = b.walls;
    for (let k = 0; k < cnt; k++) {
      const p = ring[k];
      const q = ring[(k + 1) % cnt];
      const dx = q.x - p.x;
      const dz = q.y - p.y;
      const len = Math.hypot(dx, dz);
      if (len < 0.05) continue;
      // ring is CCW in (x, z) with z pointing south, so outward normal is (dz, -dx)
      const nx = dz / len;
      const nz = -dx / len;
      const v0 = W.vert(p.x, 0, p.y, nx, 0, nz, u, 0, wc);
      const v1 = W.vert(q.x, 0, q.y, nx, 0, nz, u + len, 0, wc);
      const v2 = W.vert(q.x, h, q.y, nx, 0, nz, u + len, h, wc);
      const v3 = W.vert(p.x, h, p.y, nx, 0, nz, u, h, wc);
      W.idx.push(v0, v2, v1, v0, v3, v2);
      u += len;
    }
    // flat roof with a low parapet look via darker colour at the edge is overkill; keep it flat
    const tris = ShapeUtils.triangulateShape(ring, []);
    const R = b.roofs;
    const base = R.vcount;
    for (const p of ring) R.vert(p.x, h, p.y, 0, 1, 0, 0, 0, roof);
    for (const t of tris) R.idx.push(base + t[0], base + t[2], base + t[1]);
  }
}

// road widths (m) and colours by class index (see tools/build_map.py road_classes)
const ROAD_STYLE: Record<string, { w: number; c: number[]; y: number; mark?: number[] }> = {
  motorway: { w: 22, c: [98, 98, 100], y: 0.06, mark: [235, 235, 225] },
  trunk: { w: 18, c: [102, 102, 104], y: 0.06, mark: [235, 235, 225] },
  primary: { w: 13, c: [106, 106, 108], y: 0.055, mark: [230, 200, 60] },
  secondary: { w: 10, c: [112, 111, 110], y: 0.05, mark: [235, 235, 225] },
  tertiary: { w: 8, c: [118, 116, 113], y: 0.045 },
  residential: { w: 6, c: [124, 120, 114], y: 0.04 },
  unclassified: { w: 6, c: [124, 120, 114], y: 0.04 },
  living_street: { w: 5, c: [104, 100, 94], y: 0.04 },
  service: { w: 4, c: [110, 104, 96], y: 0.035 },
  track: { w: 3.5, c: [150, 104, 70], y: 0.03 },
  unknown: { w: 4, c: [120, 110, 98], y: 0.03 },
  footway: { w: 2, c: [170, 160, 140], y: 0.03 },
  path: { w: 1.8, c: [160, 120, 84], y: 0.03 },
  pedestrian: { w: 4, c: [176, 168, 150], y: 0.035 },
  steps: { w: 2, c: [170, 166, 156], y: 0.03 },
  cycleway: { w: 2, c: [150, 90, 80], y: 0.03 },
  standard_gauge: { w: 3.2, c: [92, 80, 70], y: 0.07 },
  rail: { w: 3.2, c: [92, 80, 70], y: 0.07 },
};

function ribbon(B: Builder, pts: Vector2[], w: number, y: number, c: number[], vScale = 1) {
  const n = pts.length;
  const left: Vector2[] = [];
  for (let k = 0; k < n; k++) {
    const prev = pts[Math.max(0, k - 1)];
    const next = pts[Math.min(n - 1, k + 1)];
    let dx = next.x - prev.x;
    let dz = next.y - prev.y;
    const l = Math.hypot(dx, dz) || 1;
    dx /= l;
    dz /= l;
    // miter: scale offset at bends (clamped)
    let m = 1;
    if (k > 0 && k < n - 1) {
      const ax = pts[k].x - prev.x;
      const az = pts[k].y - prev.y;
      const al = Math.hypot(ax, az) || 1;
      const cos = (ax / al) * dx + (az / al) * dz;
      m = Math.min(2.5, 1 / Math.max(0.4, Math.sqrt((1 + cos) / 2)));
    }
    left.push(new Vector2(-dz * m, dx * m));
  }
  const base = B.vcount;
  for (let k = 0; k < n; k++) {
    const p = pts[k];
    const L = left[k];
    // world-space uv so overlapping carriageways share the same texture
    const ax = p.x + (L.x * w) / 2;
    const az = p.y + (L.y * w) / 2;
    const bx = p.x - (L.x * w) / 2;
    const bz = p.y - (L.y * w) / 2;
    B.vert(ax, y, az, 0, 1, 0, ax * vScale, az * vScale, c);
    B.vert(bx, y, bz, 0, 1, 0, bx * vScale, bz * vScale, c);
  }
  for (let k = 0; k < n - 1; k++) {
    const a0 = base + k * 2;
    B.idx.push(a0, a0 + 2, a0 + 1, a0 + 1, a0 + 2, a0 + 3);
  }
}

const ELEVATED = ['motorway', 'trunk', 'primary', 'secondary'];

function buildRoads(meta: MapMeta, a: MapArrays) {
  let o = 0;
  const classes = meta.roads.classes;
  // draw minor roads first so major ones sit on top at junctions (also via y)
  for (let i = 0; i < a.rCounts.length; i++) {
    const cnt = a.rCounts[i];
    const cls = classes[a.rClass[i] & 0x7f];
    const style = ROAD_STYLE[cls] ?? ROAD_STYLE.unknown;
    const pts: Vector2[] = [];
    for (let k = 0; k < cnt; k++) pts.push(new Vector2(a.rCoords[(o + k) * 2] / 10, a.rCoords[(o + k) * 2 + 1] / 10));
    o += cnt;
    // bridges are built as elevated decks on the main thread (Landmarks)
    if (a.rClass[i] & 0x80 && ELEVATED.includes(cls)) continue;
    // split long polylines into the chunk of their midpoint per piece of ~CHUNK/2
    let start = 0;
    let acc = 0;
    for (let k = 1; k < pts.length; k++) {
      acc += pts[k].distanceTo(pts[k - 1]);
      if (acc > CHUNK / 2 || k === pts.length - 1) {
        const piece = pts.slice(start, k + 1);
        const mid = piece[Math.floor(piece.length / 2)];
        const { b } = chunkFor(mid.x, mid.y);
        const isRail = cls === 'standard_gauge' || cls === 'rail';
        if (isRail) {
          ribbon(b.roads, piece, style.w, style.y, style.c, 0.25);
          ribbon(b.marks, piece.map((p) => p), 1.5, style.y + 0.02, [60, 50, 45]);
        } else {
          ribbon(b.roads, piece, style.w, style.y, style.c, 0.25);
          if (style.mark) {
            // centre line, drawn as a thin ribbon
            ribbon(b.marks, piece, 0.18, style.y + 0.012, style.mark);
          }
        }
        start = k;
        acc = 0;
      }
    }
  }
}

const AREA_STYLE: Record<string, { c: number[]; y: number }> = {
  water: { c: [0, 0, 0], y: 0.0 },
  park: { c: [92, 128, 66], y: 0.02 },
  grass: { c: [118, 140, 78], y: 0.018 },
  pitch: { c: [86, 140, 70], y: 0.025 },
  campus: { c: [138, 146, 102], y: 0.008 },
  school: { c: [156, 146, 120], y: 0.01 },
  hospital: { c: [160, 152, 136], y: 0.01 },
  market: { c: [150, 132, 110], y: 0.012 },
  residential: { c: [142, 128, 108], y: 0.005 },
  industrial: { c: [130, 126, 120], y: 0.006 },
  cemetery: { c: [110, 124, 84], y: 0.015 },
  military: { c: [128, 130, 100], y: 0.007 },
  railway: { c: [120, 106, 92], y: 0.009 },
  sand: { c: [196, 176, 140], y: 0.014 },
  wetland: { c: [90, 112, 80], y: 0.016 },
  stadium: { c: [130, 128, 122], y: 0.02 },
};

function buildAreas(meta: MapMeta, a: MapArrays) {
  let o = 0;
  let ci = 0;
  for (let i = 0; i < a.aKind.length; i++) {
    const kind = meta.areas.kinds[a.aKind[i]];
    const read = () => {
      const cnt = a.aCounts[ci++];
      const pts: Vector2[] = [];
      for (let k = 0; k < cnt; k++) pts.push(new Vector2(a.aCoords[(o + k) * 2] / 10, a.aCoords[(o + k) * 2 + 1] / 10));
      o += cnt;
      return pts;
    };
    const outer = read();
    const holes: Vector2[][] = [];
    for (let h = 0; h < a.aHoles[i]; h++) holes.push(read());
    if (ShapeUtils.isClockWise(outer)) outer.reverse();
    for (const h of holes) if (!ShapeUtils.isClockWise(h)) h.reverse();
    const tris = ShapeUtils.triangulateShape(outer, holes);
    const all = outer.concat(...holes);
    // put big areas in the chunk of their centroid; they are few and large
    let mx = 0;
    let mz = 0;
    for (const p of outer) {
      mx += p.x;
      mz += p.y;
    }
    const { b } = chunkFor(mx / outer.length, mz / outer.length);
    const style = AREA_STYLE[kind] ?? AREA_STYLE.residential;
    const B = kind === 'water' ? b.water : b.areas;
    const base = B.vcount;
    for (const p of all) B.vert(p.x, kind === 'water' ? -0.15 : style.y, p.y, 0, 1, 0, p.x / 40, p.y / 40, style.c);
    for (const t of tris) B.idx.push(base + t[0], base + t[2], base + t[1]);
    const density = TREE_DENSITY[kind];
    if (density) scatterTrees(all, tris, density, kind === 'residential' || kind === 'campus' ? 0.4 : 0.25, i);
  }
}

// trees per m² by land use: Yaba has shady campuses and almond/mango/palm-filled compounds
const TREE_DENSITY: Record<string, number> = {
  park: 1 / 110, grass: 1 / 260, campus: 1 / 330, cemetery: 1 / 220, wetland: 1 / 160, school: 1 / 500,
  hospital: 1 / 500, military: 1 / 420, residential: 1 / 1400, pitch: 0,
};

let blocked: (x: number, z: number) => boolean = () => false;

function scatterTrees(pts: Vector2[], tris: number[][], density: number, palmShare: number, seed: number) {
  let s = seed * 9973 + 17;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (const t of tris) {
    const a = pts[t[0]];
    const b = pts[t[1]];
    const c = pts[t[2]];
    const area = Math.abs((b.x - a.x) * (c.y - a.y) - (c.x - a.x) * (b.y - a.y)) / 2;
    let n = area * density;
    while (n > 0) {
      if (n < 1 && rnd() > n) break;
      n -= 1;
      let u = rnd();
      let v = rnd();
      if (u + v > 1) {
        u = 1 - u;
        v = 1 - v;
      }
      const x = a.x + (b.x - a.x) * u + (c.x - a.x) * v;
      const z = a.y + (b.y - a.y) * u + (c.y - a.y) * v;
      if (blocked(x, z)) continue;
      chunkFor(x, z).trees.push(x, z, 0.75 + rnd() * 0.6, rnd() * Math.PI * 2, rnd() < palmShare ? 1 : 0);
    }
  }
}

/** Grid of building rings and road segments so trees avoid both. */
function buildBlockers(meta: MapMeta, a: MapArrays) {
  const G = 16;
  const grid = new Map<number, number[]>();
  const key = (gx: number, gz: number) => gx * 100003 + gz;
  const push = (gx: number, gz: number, v: number) => {
    let l = grid.get(key(gx, gz));
    if (!l) grid.set(key(gx, gz), (l = []));
    l.push(v);
  };
  // buildings: store index (>= 0)
  const bStart = new Uint32Array(a.bCounts.length + 1);
  for (let i = 0; i < a.bCounts.length; i++) bStart[i + 1] = bStart[i] + a.bCounts[i];
  for (let i = 0; i < a.bCounts.length; i++) {
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
    for (let k = bStart[i]; k < bStart[i + 1]; k++) {
      const x = a.bCoords[k * 2] / 10;
      const z = a.bCoords[k * 2 + 1] / 10;
      x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z);
    }
    for (let gx = Math.floor((x0 - 3) / G); gx <= Math.floor((x1 + 3) / G); gx++)
      for (let gz = Math.floor((z0 - 3) / G); gz <= Math.floor((z1 + 3) / G); gz++) push(gx, gz, i);
  }
  // road segments: store -(segmentStartVertex + 1)
  const rStart = new Uint32Array(a.rCounts.length + 1);
  for (let i = 0; i < a.rCounts.length; i++) rStart[i + 1] = rStart[i] + a.rCounts[i];
  const segWidth = new Float32Array(a.rCoords.length / 2);
  for (let i = 0; i < a.rCounts.length; i++) {
    const w = (ROAD_STYLE[meta.roads.classes[a.rClass[i] & 0x7f]] ?? ROAD_STYLE.unknown).w;
    for (let k = rStart[i]; k < rStart[i + 1] - 1; k++) {
      segWidth[k] = w;
      const x = (a.rCoords[k * 2] + a.rCoords[k * 2 + 2]) / 20;
      const z = (a.rCoords[k * 2 + 1] + a.rCoords[k * 2 + 3]) / 20;
      const len = Math.hypot(a.rCoords[k * 2 + 2] - a.rCoords[k * 2], a.rCoords[k * 2 + 3] - a.rCoords[k * 2 + 1]) / 20 + w;
      for (let gx = Math.floor((x - len) / G); gx <= Math.floor((x + len) / G); gx++)
        for (let gz = Math.floor((z - len) / G); gz <= Math.floor((z + len) / G); gz++) push(gx, gz, -(k + 1));
    }
  }
  blocked = (x, z) => {
    for (const v of grid.get(key(Math.floor(x / G), Math.floor(z / G))) ?? []) {
      if (v >= 0) {
        // inside or within 2.5 m of a building
        let inside = false;
        let near = false;
        for (let k = bStart[v], j = bStart[v + 1] - 1; k < bStart[v + 1]; j = k++) {
          const xi = a.bCoords[k * 2] / 10, zi = a.bCoords[k * 2 + 1] / 10;
          const xj = a.bCoords[j * 2] / 10, zj = a.bCoords[j * 2 + 1] / 10;
          if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
          if (!near && segDist(x, z, xi, zi, xj, zj) < 2.5) near = true;
        }
        if (inside || near) return true;
      } else {
        const k = -v - 1;
        const d = segDist(x, z, a.rCoords[k * 2] / 10, a.rCoords[k * 2 + 1] / 10, a.rCoords[k * 2 + 2] / 10, a.rCoords[k * 2 + 3] / 10);
        if (d < segWidth[k] / 2 + 1.5) return true;
      }
    }
    return false;
  };
}

function segDist(x: number, z: number, ax: number, az: number, bx: number, bz: number) {
  const ex = bx - ax;
  const ez = bz - az;
  const l2 = ex * ex + ez * ez || 1;
  const t = Math.max(0, Math.min(1, ((x - ax) * ex + (z - az) * ez) / l2));
  return Math.hypot(x - ax - ex * t, z - az - ez * t);
}

self.onmessage = (e: MessageEvent<{ meta: MapMeta; buf: ArrayBuffer; skip?: number[] }>) => {
  const { meta, buf } = e.data;
  const skip = new Set(e.data.skip ?? []);
  const a = viewArrays(meta, buf);
  buildBlockers(meta, a);
  buildAreas(meta, a);
  buildRoads(meta, a);
  buildBuildings(a, skip);
  // send nearest-first is decided by the main thread; just stream everything
  for (const [key, c] of chunks) {
    const g: ChunkGeometry = {
      key,
      cx: c.cx,
      cz: c.cz,
      walls: c.b.walls.out(),
      roofs: c.b.roofs.out(),
      roads: c.b.roads.out(),
      marks: c.b.marks.out(),
      areas: c.b.areas.out(),
      water: c.b.water.out(),
      trees: c.trees.length ? new Float32Array(c.trees) : undefined,
    };
    const transfer: Transferable[] = [];
    if (g.trees) transfer.push(g.trees.buffer);
    for (const k of ['walls', 'roofs', 'roads', 'marks', 'areas', 'water'] as const) {
      const ga = g[k];
      if (!ga) continue;
      for (const arr of [ga.position, ga.normal, ga.uv, ga.color, ga.index]) if (arr) transfer.push(arr.buffer);
    }
    (self as unknown as Worker).postMessage({ type: 'chunk', chunk: g }, transfer);
  }
  (self as unknown as Worker).postMessage({ type: 'done' });
};
