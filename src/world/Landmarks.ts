import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { LoadedMap } from '../core/MapData';
import type { BuildingIndex } from './BuildingIndex';
import type { Door } from './Doors';
import { ROAD_WIDTH, Roads, type RoadLine } from './Roads';

/**
 * Signature structures that make Yaba recognisable: elevated Third Mainland
 * Bridge and the Ojuelegba flyover (from OSM bridge flags), the UNILAG and
 * YABATECH gates, the tent-roofed Yaba bus terminal with danfos, the Red Line
 * station, the Senate House tower, and real-world facades and signage for
 * Tejuosho Market, E-Centre/Ozone, CcHUB, White House and the bars.
 */

const vc = new THREE.MeshLambertMaterial({ vertexColors: true });

function colorize(g: THREE.BufferGeometry, hex: number) {
  const geo = g.index ? g.toNonIndexed() : g;
  const c = new THREE.Color(hex).convertSRGBToLinear();
  const n = geo.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) arr.set([c.r, c.g, c.b], i * 3);
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  geo.deleteAttribute('uv');
  return geo;
}

/** collects coloured primitives and merges them into one draw call */
class Batch {
  parts: THREE.BufferGeometry[] = [];
  box(w: number, h: number, d: number, color: number, x: number, y: number, z: number, ry = 0) {
    const g = new THREE.BoxGeometry(w, h, d);
    g.rotateY(ry);
    g.translate(x, y + h / 2, z);
    this.parts.push(colorize(g, color));
  }
  cyl(r: number, h: number, color: number, x: number, y: number, z: number, seg = 10) {
    const g = new THREE.CylinderGeometry(r, r, h, seg);
    g.translate(x, y + h / 2, z);
    this.parts.push(colorize(g, color));
  }
  add(g: THREE.BufferGeometry, color: number) {
    this.parts.push(colorize(g, color));
  }
  mesh() {
    if (!this.parts.length) return null;
    const m = new THREE.Mesh(mergeGeometries(this.parts)!, vc);
    m.castShadow = true;
    m.receiveShadow = true;
    return m;
  }
}

function canvasTex(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void, repeat = false) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d')!);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

/** A lettered sign board, lit so it reads at night too. */
function signMesh(text: string, opts: { bg?: string; fg?: string; w: number; h?: number; font?: string; sub?: string; double?: boolean }) {
  const H = 128;
  const ratio = opts.w / (opts.h ?? opts.w / 6);
  const W = Math.min(2048, Math.round(H * ratio));
  const tex = canvasTex(W, H, (g) => {
    g.fillStyle = opts.bg ?? '#ffffff';
    g.fillRect(0, 0, W, H);
    g.fillStyle = opts.fg ?? '#0b3d91';
    let size = opts.sub ? 64 : 84;
    const font = opts.font ?? '800';
    g.font = `${font} ${size}px system-ui, sans-serif`;
    while (g.measureText(text).width > W - 30 && size > 20) g.font = `${font} ${(size -= 2)}px system-ui, sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(text, W / 2, opts.sub ? H * 0.4 : H / 2 + 4);
    if (opts.sub) {
      g.font = `600 30px system-ui, sans-serif`;
      g.fillText(opts.sub, W / 2, H * 0.8);
    }
  });
  const m = new THREE.Mesh(new THREE.PlaneGeometry(opts.w, opts.h ?? opts.w / ratio), new THREE.MeshBasicMaterial({ map: tex, side: opts.double ? THREE.DoubleSide : THREE.FrontSide, toneMapped: false }));
  return m;
}

// ---------------------------------------------------------------------------
// facades for restyled landmark buildings

type FacadeKind = 'mall' | 'glass' | 'white' | 'office' | 'paint';

function facadeTex(kind: FacadeKind, base: string, trim: string) {
  // one floor (3.6 m) by one bay (4 m) per tile
  return canvasTex(128, 128, (g) => {
    g.fillStyle = base;
    g.fillRect(0, 0, 128, 128);
    if (kind === 'glass') {
      const grd = g.createLinearGradient(0, 0, 128, 128);
      grd.addColorStop(0, '#2f4b63');
      grd.addColorStop(1, '#1b2b3a');
      g.fillStyle = grd;
      g.fillRect(0, 0, 128, 128);
      g.fillStyle = trim;
      g.fillRect(0, 0, 128, 6);
      g.fillRect(0, 0, 4, 128);
      g.fillStyle = 'rgba(255,255,255,.12)';
      g.fillRect(10, 12, 40, 100);
    } else if (kind === 'mall') {
      // cream spandrel + continuous blue ribbon window
      g.fillStyle = trim;
      g.fillRect(0, 40, 128, 60);
      g.fillStyle = 'rgba(255,255,255,.18)';
      g.fillRect(0, 44, 128, 8);
      g.fillStyle = 'rgba(0,0,0,.25)';
      g.fillRect(0, 98, 128, 4);
    } else if (kind === 'office') {
      g.fillStyle = trim;
      g.fillRect(14, 22, 100, 78);
      g.fillStyle = 'rgba(255,255,255,.2)';
      g.fillRect(14, 22, 30, 78);
      g.fillStyle = 'rgba(0,0,0,.25)';
      g.fillRect(62, 22, 3, 78);
    } else {
      // painted plaster with louvred windows and burglar-proof bars
      g.fillStyle = trim;
      g.fillRect(28, 30, 72, 64);
      g.fillStyle = '#26323a';
      g.fillRect(34, 36, 60, 52);
      g.fillStyle = trim;
      for (let x = 38; x < 94; x += 9) g.fillRect(x, 36, 2, 52);
    }
    g.fillStyle = 'rgba(0,0,0,.08)';
    g.fillRect(0, 122, 128, 6);
  }, true);
}

interface Restyle {
  kind: FacadeKind;
  base: string;
  trim: string;
  height?: number;
  roof?: number;
  sign?: { text: string; bg: string; fg: string; sub?: string };
  sign2?: { text: string; bg: string; fg: string };
}

/** Looks drawn from photos and descriptions of the real places (colours approximate). */
const RESTYLE: Record<string, Restyle> = {
  // four floors plus food court and cinema on top (Guardian NG); cream with blue glazing
  tejuosho_market: { kind: 'mall', base: '#efe6cf', trim: '#2c6fb6', height: 19, roof: 0x9aa3ab, sign: { text: 'TEJUOSHO ULTRA MODERN SHOPPING CENTRE', bg: '#0d4f9c', fg: '#ffffff' }, sign2: { text: 'SPAR', bg: '#d7262e', fg: '#ffffff' } },
  ecentre: { kind: 'glass', base: '#24313d', trim: '#b8c2cc', height: 16, roof: 0x7a8288, sign: { text: 'E-CENTRE', bg: '#111111', fg: '#ffffff' }, sign2: { text: 'OZONE CINEMAS', bg: '#b71c1c', fg: '#ffffff' } },
  cchub: { kind: 'office', base: '#f3f3f1', trim: '#2c8c63', height: 15, roof: 0x8d9499, sign: { text: 'CcHUB', bg: '#ffffff', fg: '#00a86b', sub: 'Co-Creation Hub · 294 Herbert Macaulay Way' } },
  white_house: { kind: 'paint', base: '#f7f7f2', trim: '#2a6ea8', height: 7, sign: { text: 'WHITE HOUSE', bg: '#ffffff', fg: '#1f4e8c', sub: 'Buka · Bar · 24 Hours' } },
  banilux_bar: { kind: 'paint', base: '#2f7a4c', trim: '#f1c40f', height: 7, sign: { text: 'BANILUX BAR & INN', bg: '#f1c40f', fg: '#14532d' } },
  mallmart: { kind: 'mall', base: '#f4f4f0', trim: '#0057a8', height: 9, sign: { text: 'MALLMART', bg: '#0057a8', fg: '#ffffff', sub: 'Hypermarket' } },
  city_grill: { kind: 'paint', base: '#f1e4cc', trim: '#d35400', height: 7, sign: { text: 'CITY GRILL', bg: '#d35400', fg: '#ffffff' } },
  domino: { kind: 'paint', base: '#f5efe0', trim: '#2c3e50', height: 7, sign: { text: 'DOMINO', bg: '#2c3e50', fg: '#f5efe0', sub: 'Since the 1970s' } },
  silver_cafe: { kind: 'glass', base: '#2b2b33', trim: '#c0c0c8', height: 8, sign: { text: 'SILVER CAFE', bg: '#c0c0c8', fg: '#1b1b22' } },
  gondola_club: { kind: 'paint', base: '#1d1b2a', trim: '#ff3b8d', height: 8, sign: { text: 'THE GONDOLA', bg: '#111', fg: '#ff3b8d' } },
  ibikunle_clubs: { kind: 'paint', base: '#221f2e', trim: '#2dd4ff', height: 8, sign: { text: 'CLUB GOSSIP · HAZE · ROADRUNNERS', bg: '#111', fg: '#2dd4ff' } },
  efex_hotel: { kind: 'paint', base: '#e8dcc8', trim: '#8e2b2b', height: 13, sign: { text: 'EFEX HOTEL', bg: '#8e2b2b', fg: '#ffffff' } },
};

function extrude(ring: [number, number][], h: number, tex: THREE.Texture, roofColor: number) {
  const pos: number[] = [];
  const uv: number[] = [];
  const nrm: number[] = [];
  let u = 0;
  for (let k = 0; k < ring.length; k++) {
    const [ax, az] = ring[k];
    const [bx, bz] = ring[(k + 1) % ring.length];
    const len = Math.hypot(bx - ax, bz - az);
    if (len < 0.05) continue;
    const nx = (bz - az) / len;
    const nz = -(bx - ax) / len;
    const u1 = u + len / 4;
    const v1 = h / 3.6;
    pos.push(ax, 0, az, bx, 0, bz, bx, h, bz, ax, 0, az, bx, h, bz, ax, h, az);
    uv.push(u, 0, u1, 0, u1, v1, u, 0, u1, v1, u, v1);
    for (let i = 0; i < 6; i++) nrm.push(nx, 0, nz);
    u = u1;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  const walls = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ map: tex, side: THREE.DoubleSide }));
  const shape = new THREE.Shape(ring.map(([x, z]) => new THREE.Vector2(x, -z)));
  const roofG = new THREE.ShapeGeometry(shape);
  roofG.rotateX(-Math.PI / 2);
  roofG.translate(0, h, 0);
  const roof = new THREE.Mesh(roofG, new THREE.MeshLambertMaterial({ color: roofColor, side: THREE.DoubleSide }));
  walls.castShadow = roof.castShadow = true;
  walls.receiveShadow = roof.receiveShadow = true;
  return [walls, roof];
}

// ---------------------------------------------------------------------------

export interface LandmarkBuild {
  group: THREE.Group;
  /** building indices the city worker should not draw (restyled here) */
  skip: Set<number>;
  update: (t: number, night: number) => void;
}

export function buildLandmarks(map: LoadedMap, buildings: BuildingIndex, doors: Door[]): LandmarkBuild {
  const group = new THREE.Group();
  const skip = new Set<number>();
  const roads = new Roads(map);
  const batch = new Batch();
  const lms = new Map(map.meta.landmarks.map((l) => [l.id, l]));
  const lit: THREE.MeshBasicMaterial[] = [];

  // --- restyled buildings at their real footprints
  for (const d of doors) {
    const st = RESTYLE[d.place.id];
    if (!st) continue;
    skip.add(d.building);
    const ring = buildings.ring(d.building);
    const h = Math.max(st.height ?? buildings.height(d.building), 6);
    const [w, r] = extrude(ring, h, facadeTex(st.kind, st.base, st.trim), st.roof ?? 0x8a8a86);
    group.add(w, r);
    if (st.sign) {
      // big sign up on the facade above the door
      const len = Math.min(26, Math.max(6, st.sign.text.length * 0.7));
      const s = signMesh(st.sign.text, { bg: st.sign.bg, fg: st.sign.fg, w: len, h: st.sign.sub ? len / 4.5 : len / 7, sub: st.sign.sub });
      const wx = d.x - d.nx * 0.85;
      const wz = d.z - d.nz * 0.85;
      s.position.set(wx, Math.min(h - 1.2, Math.max(4.6, h * 0.62)), wz);
      s.rotation.y = Math.atan2(d.nx, d.nz);
      group.add(s);
      lit.push(s.material as THREE.MeshBasicMaterial);
    }
    if (st.sign2) {
      const s2 = signMesh(st.sign2.text, { bg: st.sign2.bg, fg: st.sign2.fg, w: Math.max(4, st.sign2.text.length * 0.65), h: 1.6 });
      const tx = -d.nz;
      const tz = d.nx;
      s2.position.set(d.x - d.nx * 0.85 + tx * 6, 3.3, d.z - d.nz * 0.85 + tz * 6);
      s2.rotation.y = Math.atan2(d.nx, d.nz);
      group.add(s2);
    }
  }

  // --- elevated roads: Third Mainland Bridge, the Ojuelegba flyover, Yaba flyover
  buildBridges(roads, map, batch);

  // --- UNILAG main gate: where University Road enters the campus (OSM campus boundary)
  {
    const p = roads.nearest(569, -872, (l) => l.name === 'University Road');
    if (p.d < 40) {
      const ang = Math.atan2(p.dx, p.dz);
      const span = 22;
      const ex = Math.cos(ang);
      const ez = -Math.sin(ang);
      // two concrete pylons, gatehouse booths and a beam across the road
      for (const s of [-1, 1]) {
        batch.box(2.2, 9, 2.2, 0xe9e4d8, p.x + ex * s * (span / 2), 0, p.z + ez * s * (span / 2), ang);
        batch.box(3.5, 3, 3, 0xd9d2c3, p.x + ex * s * (span / 2 + 3.5), 0, p.z + ez * s * (span / 2 + 3.5), ang);
        batch.box(3.9, 0.3, 3.4, 0x1a4f8b, p.x + ex * s * (span / 2 + 3.5), 3, p.z + ez * s * (span / 2 + 3.5), ang);
      }
      batch.box(span + 2.2, 1.8, 1.4, 0xf4f1ea, p.x, 7.2, p.z, ang);
      batch.box(span + 2.6, 0.25, 1.8, 0x1a4f8b, p.x, 9.0, p.z, ang);
      batch.box(0.4, 1.0, span * 0.42, 0xd62828, p.x + ex * (span / 4), 0.6, p.z + ez * (span / 4), ang + Math.PI / 2);
      for (const side of [1, -1]) {
        const s = signMesh('UNIVERSITY OF LAGOS', { bg: '#f4f1ea', fg: '#1a4f8b', w: span - 1, h: 1.5 });
        s.position.set(p.x + p.dx * 0.72 * side, 8.1, p.z + p.dz * 0.72 * side);
        s.rotation.y = ang + (side > 0 ? 0 : Math.PI);
        group.add(s);
      }
    }
  }

  // --- UNILAG Senate House: mosaic-clad tower with deep brise-soleil fins (James Cubitt, 1984),
  // placed at the largest footprint by the Main Auditorium in the campus core (approximate)
  {
    const core = { x: 2089, z: -1032 };
    let best = -1;
    let bestA = 0;
    for (const i of buildings.around(core.x, core.z, 140)) {
      const a = buildings.area(i);
      const [cx, cz] = buildings.centroid(i);
      if (a > bestA && a < 6000 && Math.hypot(cx - core.x, cz - core.z) < 140 && buildings.distanceTo(i, core.x, core.z) > 0) {
        best = i;
        bestA = a;
      }
    }
    if (best >= 0) {
      skip.add(best);
      const [cx, cz] = buildings.centroid(best);
      const ring = buildings.ring(best);
      const [w, r] = extrude(ring, 8, facadeTex('paint', '#dcd6c8', '#b9b1a0'), 0x8f8a80);
      group.add(w, r);
      // tower on the podium
      const tw = 16;
      const td = 22;
      const H = 52;
      batch.box(tw, H, td, 0x47525c, cx, 8, cz);
      for (let k = -td / 2; k <= td / 2 + 0.01; k += 2) {
        batch.box(1.1, H, 0.35, 0xf2efe6, cx + tw / 2 + 0.5, 8, cz + k);
        batch.box(1.1, H, 0.35, 0xf2efe6, cx - tw / 2 - 0.5, 8, cz + k);
      }
      for (let k = -tw / 2; k <= tw / 2 + 0.01; k += 2) {
        batch.box(0.35, H, 1.1, 0xf2efe6, cx + k, 8, cz + td / 2 + 0.5);
        batch.box(0.35, H, 1.1, 0xf2efe6, cx + k, 8, cz - td / 2 - 0.5);
      }
      for (let y = 8; y < 8 + H; y += 3.6) batch.box(tw + 2.6, 0.3, td + 2.6, 0xe8e2d4, cx, y, cz);
      batch.box(tw + 3, 2.5, td + 3, 0xe8e2d4, cx, 8 + H, cz);
    }
  }

  // --- YABATECH gate on Herbert Macaulay Way, facing the campus
  gateOff(roads, batch, group, lms.get('yabatech'), 'Herbert Macaulay Way', 'YABA COLLEGE OF TECHNOLOGY', 'Est. 1947', '#0b6b3a');
  gateOff(roads, batch, group, lms.get('queens_college'), null, "QUEEN'S COLLEGE, YABA", 'Pro Patria · 1927', '#1f4e8c');
  gateOff(roads, batch, group, lms.get('neuro_psych'), null, 'FEDERAL NEURO-PSYCHIATRIC HOSPITAL', 'Yaba · since 1907', '#117a65');

  // --- Yaba bus terminal: white tensile tents over the loading bays, danfos waiting
  const terminal = lms.get('yaba_bus_terminal');
  const danfoSpots: [number, number, number][] = [];
  if (terminal) {
    const road = roads.nearest(terminal.x, terminal.z, (l) => ['primary', 'secondary', 'tertiary', 'trunk', 'residential'].includes(l.cls) && !l.bridge);
    const ang = Math.atan2(road.dx, road.dz);
    const ex = Math.cos(ang);
    const ez = -Math.sin(ang);
    // set the terminal back from the road on the landmark's side
    const side = Math.sign((terminal.x - road.x) * ex + (terminal.z - road.z) * ez) || 1;
    const cx = road.x + ex * side * 16;
    const cz = road.z + ez * side * 16;
    batch.box(46, 0.2, 22, 0x9a9890, cx, 0, cz, ang);
    for (let i = -2; i <= 2; i++) {
      const tx = cx + road.dx * i * 9;
      const tz = cz + road.dz * i * 9;
      // poles
      for (const [a, b] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) batch.cyl(0.12, 5.2, 0xb0b4b8, tx + road.dx * a * 4 + ex * b * 8, 0, tz + road.dz * a * 4 + ez * b * 8, 6);
      // tent: a stretched pyramid membrane
      const tent = new THREE.ConeGeometry(6.4, 2.6, 4, 1, true);
      tent.rotateY(Math.PI / 4);
      tent.scale(0.68, 1, 1.32);
      tent.rotateY(ang);
      tent.translate(tx, 6.3, tz);
      batch.add(tent, 0xf7f7f5);
      danfoSpots.push([tx + ex * 3, tz + ez * 3, ang], [tx - ex * 3, tz - ez * 3, ang]);
    }
    // terminal office block with signage
    const ox = cx + ex * side * 15;
    const oz = cz + ez * side * 15;
    batch.box(18, 7, 8, 0xe9ecef, ox, 0, oz, ang);
    batch.box(18.4, 0.5, 8.4, 0x1565c0, ox, 7, oz, ang);
    const s = signMesh('YABA BUS TERMINAL', { bg: '#1565c0', fg: '#ffffff', w: 14, h: 1.6, sub: undefined });
    s.position.set(ox - ex * side * 4.05, 5.3, oz - ez * side * 4.05);
    s.rotation.y = Math.atan2(-ex * side, -ez * side);
    group.add(s);
  }

  // --- Yaba Red Line station: platform and canopy along the railway
  const rail = lms.get('yaba_rail');
  if (rail) {
    const r = roads.nearest(rail.x, rail.z, (l) => l.cls === 'standard_gauge' || l.cls === 'rail');
    if (r.d < 120) {
      const ang = Math.atan2(r.dx, r.dz);
      const ex = Math.cos(ang);
      const ez = -Math.sin(ang);
      const side = Math.sign((rail.x - r.x) * ex + (rail.z - r.z) * ez) || 1;
      const px = r.x + ex * side * 5.5;
      const pz = r.z + ez * side * 5.5;
      batch.box(7, 1.0, 120, 0xb8b2a6, px, 0, pz, ang);
      batch.box(0.3, 0.05, 120, 0xf1c40f, px - ex * side * 3.2, 1.0, pz - ez * side * 3.2, ang);
      for (let i = -5; i <= 5; i++) batch.box(0.3, 4.5, 0.3, 0x8d1b1b, px + r.dx * i * 11, 1, pz + r.dz * i * 11, ang);
      // curved red canopy
      const canopy = new THREE.CylinderGeometry(5.2, 5.2, 120, 16, 1, true, -0.7, 1.4);
      canopy.rotateZ(Math.PI / 2);
      canopy.rotateY(ang + Math.PI / 2);
      canopy.translate(px, 0.6, pz);
      batch.add(canopy, 0xc62828);
      const sx = px + ex * side * 9;
      const sz = pz + ez * side * 9;
      batch.box(24, 8, 10, 0xeceff1, sx, 0, sz, ang);
      batch.box(24.4, 0.6, 10.4, 0xc62828, sx, 8, sz, ang);
      const s = signMesh('YABA', { bg: '#c62828', fg: '#ffffff', w: 8, h: 2, sub: 'LAGOS RED LINE' });
      s.position.set(sx + ex * side * 5.06, 5.6, sz + ez * side * 5.06);
      s.rotation.y = Math.atan2(ex * side, ez * side);
      group.add(s);
    }
  }

  // --- Sabo roundabout: island with the SABO sign
  const sabo = lms.get('sabo_roundabout');
  if (sabo) {
    batch.cyl(7, 0.35, 0x6d8b4e, sabo.x, 0, sabo.z, 24);
    batch.cyl(7.2, 0.4, 0xdcdcdc, sabo.x, 0, sabo.z, 24);
    batch.box(1.0, 5.5, 1.0, 0xf1c40f, sabo.x, 0.4, sabo.z);
    for (const a of [0, Math.PI / 2]) {
      const s = signMesh('SABO · YABA', { bg: '#0f8a4f', fg: '#ffffff', w: 5, h: 1.1, double: true });
      s.position.set(sabo.x, 4.6, sabo.z);
      s.rotation.y = a;
      group.add(s);
    }
  }

  // --- danfos: yellow minibuses at the terminal, under Ojuelegba bridge and by the markets
  const ojo = lms.get('ojuelegba');
  if (ojo) {
    for (let i = 0; i < 6; i++) {
      const r = roads.nearest(ojo.x + (i - 3) * 14, ojo.z + 8, (l) => !l.bridge && ['primary', 'secondary', 'motorway', 'trunk'].includes(l.cls));
      danfoSpots.push([r.x - r.dz * 4, r.z + r.dx * 4, Math.atan2(r.dx, r.dz)]);
    }
  }
  for (const id of ['yaba_market', 'tejuosho_market', 'sabo_market', 'unilag_gate']) {
    const l = lms.get(id);
    if (!l) continue;
    for (let i = 0; i < 3; i++) {
      const r = roads.nearest(l.x + i * 9, l.z - i * 5, (ln) => !ln.bridge && ['primary', 'secondary', 'tertiary', 'trunk'].includes(ln.cls));
      if (r.d < 150) danfoSpots.push([r.x - r.dz * 3.5 + r.dx * i * 8, r.z + r.dx * 3.5 + r.dz * i * 8, Math.atan2(r.dx, r.dz)]);
    }
  }
  group.add(danfos(danfoSpots));

  const m = batch.mesh();
  if (m) group.add(m);
  return {
    group,
    skip,
    update: (_t, night) => {
      for (const l of lit) l.color.setScalar(0.75 + night * 0.25);
    },
  };
}

function gateOff(roads: Roads, batch: Batch, group: THREE.Group, lm: { x: number; z: number } | undefined, roadName: string | null, text: string, sub: string, color: string) {
  if (!lm) return;
  const filter = (l: RoadLine) => !l.bridge && (roadName ? l.name === roadName : ['primary', 'secondary', 'tertiary', 'trunk', 'residential', 'unclassified'].includes(l.cls));
  const r = roads.nearest(lm.x, lm.z, filter);
  if (r.d > 400) return;
  const w = ROAD_WIDTH[r.line?.cls ?? 'residential'] ?? 8;
  // gate stands at the campus edge beside the road, facing the road
  const nx = -r.dz;
  const nz = r.dx;
  const side = Math.sign((lm.x - r.x) * nx + (lm.z - r.z) * nz) || 1;
  const gx = r.x + nx * side * (w / 2 + 4);
  const gz = r.z + nz * side * (w / 2 + 4);
  const ang = Math.atan2(r.dx, r.dz) + Math.PI / 2;
  const span = 12;
  for (const s of [-1, 1]) batch.box(1.4, 6, 1.4, 0xf0ece2, gx + r.dx * s * span / 2, 0, gz + r.dz * s * span / 2, ang);
  batch.box(1.0, 1.4, span + 1.4, 0xf0ece2, gx, 5.2, gz, ang);
  batch.box(0.2, 1.8, span * 0.48, 0x5d6d7e, gx + r.dx * span / 4, 0, gz + r.dz * span / 4, ang);
  batch.box(0.2, 1.8, span * 0.48, 0x5d6d7e, gx - r.dx * span / 4, 0, gz - r.dz * span / 4, ang);
  const s = signMesh(text, { bg: '#f0ece2', fg: color, w: span - 0.4, h: 1.2, sub, double: false });
  s.position.set(gx - nx * side * 0.52, 5.9, gz - nz * side * 0.52);
  s.rotation.y = Math.atan2(-nx * side, -nz * side);
  group.add(s);
}

/** Elevated decks with parapets and pillars for every OSM bridge polyline. */
/** classes whose OSM bridges are flyovers; minor ones are low canal crossings drawn flat */
export const ELEVATED = ['motorway', 'trunk', 'primary', 'secondary'];

function buildBridges(roads: Roads, map: LoadedMap, batch: Batch) {
  const [bx0, bz0, bx1, bz1] = map.meta.bounds;
  const bridges = roads.lines.filter((l) => l.bridge && ELEVATED.includes(l.cls));
  const ends: [number, number][] = [];
  for (const b of bridges) ends.push(b.pts[0], b.pts[b.pts.length - 1]);
  const joined = (p: [number, number]) => ends.filter((e) => Math.hypot(e[0] - p[0], e[1] - p[1]) < 4).length > 1;
  const atEdge = (p: [number, number]) => p[0] < bx0 + 30 || p[0] > bx1 - 30 || p[1] < bz0 + 30 || p[1] > bz1 - 30;
  const pos: number[] = [];
  const col: number[] = [];
  const asphalt = new THREE.Color(0x5e5e60).convertSRGBToLinear();
  const concrete = new THREE.Color(0xb9b5ac).convertSRGBToLinear();
  const under = new THREE.Color(0x77736c).convertSRGBToLinear();
  const quad = (a: number[], b: number[], c: number[], d: number[], cc: THREE.Color) => {
    pos.push(...a, ...b, ...c, ...a, ...c, ...d);
    for (let i = 0; i < 6; i++) col.push(cc.r, cc.g, cc.b);
  };
  for (const b of bridges) {
    const H = b.name.includes('Third Mainland') ? 9 : b.cls === 'motorway' ? 7 : 6.2;
    const w = (ROAD_WIDTH[b.cls] ?? 10) * (b.cls === 'motorway' ? 0.62 : 1);
    const pts = b.pts;
    const cum = [0];
    for (let k = 1; k < pts.length; k++) cum.push(cum[k - 1] + Math.hypot(pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1]));
    const L = cum[cum.length - 1];
    const ramp = H / 0.06;
    const rampA = !(joined(pts[0]) || atEdge(pts[0]));
    const rampB = !(joined(pts[pts.length - 1]) || atEdge(pts[pts.length - 1]));
    const height = (s: number) => H * Math.min(1, rampA ? s / ramp : 1, rampB ? (L - s) / ramp : 1);
    // resample every ~8 m so ramps are smooth
    const samples: { x: number; z: number; s: number }[] = [];
    for (let k = 0; k < pts.length - 1; k++) {
      const seg = cum[k + 1] - cum[k];
      const n = Math.max(1, Math.ceil(seg / 8));
      for (let i = 0; i < n; i++) {
        const t = i / n;
        samples.push({ x: pts[k][0] + (pts[k + 1][0] - pts[k][0]) * t, z: pts[k][1] + (pts[k + 1][1] - pts[k][1]) * t, s: cum[k] + seg * t });
      }
    }
    samples.push({ x: pts[pts.length - 1][0], z: pts[pts.length - 1][1], s: L });
    let nextPillar = 20;
    for (let k = 0; k < samples.length - 1; k++) {
      const a = samples[k];
      const c = samples[k + 1];
      const dx = c.x - a.x;
      const dz = c.z - a.z;
      const len = Math.hypot(dx, dz) || 1;
      const nx = (-dz / len) * (w / 2);
      const nz = (dx / len) * (w / 2);
      const ha = height(a.s);
      const hc = height(c.s);
      const t = 1.1;
      // deck top, sides and underside
      quad([a.x + nx, ha, a.z + nz], [a.x - nx, ha, a.z - nz], [c.x - nx, hc, c.z - nz], [c.x + nx, hc, c.z + nz], asphalt);
      quad([a.x + nx, ha - t, a.z + nz], [a.x + nx, ha, a.z + nz], [c.x + nx, hc, c.z + nz], [c.x + nx, hc - t, c.z + nz], concrete);
      quad([a.x - nx, ha, a.z - nz], [a.x - nx, ha - t, a.z - nz], [c.x - nx, hc - t, c.z - nz], [c.x - nx, hc, c.z - nz], concrete);
      quad([a.x - nx, ha - t, a.z - nz], [a.x + nx, ha - t, a.z + nz], [c.x + nx, hc - t, c.z + nz], [c.x - nx, hc - t, c.z - nz], under);
      // parapets
      for (const sgn of [1, -1]) {
        const px = nx * sgn;
        const pz = nz * sgn;
        quad([a.x + px, ha, a.z + pz], [a.x + px, ha + 0.9, a.z + pz], [c.x + px, hc + 0.9, c.z + pz], [c.x + px, hc, c.z + pz], concrete);
        quad([a.x + px * 0.96, ha + 0.9, a.z + pz * 0.96], [a.x + px * 0.96, ha, a.z + pz * 0.96], [c.x + px * 0.96, hc, c.z + pz * 0.96], [c.x + px * 0.96, hc + 0.9, c.z + pz * 0.96], concrete);
      }
      // pillars where the deck is high enough
      if (a.s >= nextPillar && ha > 2.2) {
        nextPillar = a.s + (H > 8 ? 30 : 24);
        batch.box(1.6, ha - t, w * 0.55, 0xa9a59b, a.x, 0, a.z, Math.atan2(dx, dz));
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  batch.parts.push(g);
}

/** Yellow danfo minibuses with the black stripes, one instanced draw call. */
function danfos(spots: [number, number, number][]) {
  const parts: THREE.BufferGeometry[] = [];
  const b = (w: number, h: number, d: number, c: number, x: number, y: number, z: number) => {
    const g = new THREE.BoxGeometry(w, h, d);
    g.translate(x, y + h / 2, z);
    parts.push(colorize(g, c));
  };
  b(2.0, 1.75, 4.9, 0xf2b705, 0, 0.35, 0);
  b(2.02, 0.12, 4.92, 0x111111, 0, 1.0, 0);
  b(2.02, 0.12, 4.92, 0x111111, 0, 1.25, 0);
  b(2.04, 0.55, 3.9, 0x2a3540, 0, 1.4, -0.3); // side windows
  b(1.8, 0.6, 0.05, 0x2a3540, 0, 1.3, 2.46); // windscreen
  b(1.9, 0.08, 4.4, 0x6b6b6b, 0, 2.1, 0); // roof rack
  for (const [x, z] of [[-0.95, 1.6], [0.95, 1.6], [-0.95, -1.6], [0.95, -1.6]]) {
    const w = new THREE.CylinderGeometry(0.36, 0.36, 0.25, 10);
    w.rotateZ(Math.PI / 2);
    w.translate(x, 0.36, z);
    parts.push(colorize(w, 0x1a1a1a));
  }
  const geo = mergeGeometries(parts)!;
  const mesh = new THREE.InstancedMesh(geo, vc, Math.max(1, spots.length));
  const m = new THREE.Matrix4();
  spots.forEach(([x, z, rot], i) => {
    m.makeRotationY(rot + (i % 2 ? 0.05 : -0.04));
    m.setPosition(x, 0, z);
    mesh.setMatrixAt(i, m);
  });
  mesh.count = spots.length;
  mesh.castShadow = true;
  mesh.computeBoundingSphere();
  return mesh;
}
