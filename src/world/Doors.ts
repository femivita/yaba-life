import * as THREE from 'three';
import type { LoadedMap } from '../core/MapData';
import { PLACES, type PlaceDef } from '../sim/Places';
import type { BuildingIndex } from './BuildingIndex';

export interface Door {
  place: PlaceDef;
  /** point on the pavement just outside the door */
  x: number;
  z: number;
  /** outward normal of the wall */
  nx: number;
  nz: number;
  building: number;
  wallHeight: number;
}

const SKIP_ROADS = new Set(['footway', 'path', 'steps', 'cycleway', 'standard_gauge', 'rail', 'track']);

/**
 * Finds a real building for every enterable place (the OSM footprint at or
 * nearest its landmark) and puts its front door on the wall that faces the
 * closest street, so you walk in from the road like you would in Yaba.
 */
export function findDoors(map: LoadedMap, buildings: BuildingIndex): Door[] {
  const a = map.arrays;
  const classes = map.meta.roads.classes;
  // road segments as flat arrays for brute-force nearest queries
  const segs: number[] = [];
  let o = 0;
  for (let i = 0; i < a.rCounts.length; i++) {
    const n = a.rCounts[i];
    const cls = classes[a.rClass[i] & 0x7f];
    if (!SKIP_ROADS.has(cls)) {
      for (let k = 0; k < n - 1; k++) {
        segs.push(a.rCoords[(o + k) * 2] / 10, a.rCoords[(o + k) * 2 + 1] / 10, a.rCoords[(o + k + 1) * 2] / 10, a.rCoords[(o + k + 1) * 2 + 1] / 10);
      }
    }
    o += n;
  }
  const nearestRoad = (x: number, z: number) => {
    let best = Infinity;
    let bx = x;
    let bz = z;
    for (let s = 0; s < segs.length; s += 4) {
      const ax = segs[s];
      const az = segs[s + 1];
      const ex = segs[s + 2] - ax;
      const ez = segs[s + 3] - az;
      // cheap reject
      if (Math.abs(ax - x) > 200 || Math.abs(az - z) > 200) continue;
      const l2 = ex * ex + ez * ez || 1;
      const t = Math.max(0, Math.min(1, ((x - ax) * ex + (z - az) * ez) / l2));
      const px = ax + ex * t;
      const pz = az + ez * t;
      const d = Math.hypot(px - x, pz - z);
      if (d < best) {
        best = d;
        bx = px;
        bz = pz;
      }
    }
    return { x: bx, z: bz, d: best };
  };

  const used = new Set<number>();
  const doors: Door[] = [];
  const lms = new Map(map.meta.landmarks.map((l) => [l.id, l]));
  for (const place of PLACES) {
    let lx: number;
    let lz: number;
    let pick: (i: number) => number; // score, lower is better
    if (place.id === 'home') {
      // a modest residential block close to where the game starts
      lx = map.meta.spawn.x;
      lz = map.meta.spawn.z;
      pick = (i) => {
        const ar = buildings.area(i);
        if (ar < 90 || ar > 450) return Infinity;
        return buildings.distanceTo(i, lx, lz);
      };
    } else {
      const lm = place.landmark ? lms.get(place.landmark) : undefined;
      if (!lm) continue;
      lx = lm.x;
      lz = lm.z;
      pick = (i) => {
        const ar = buildings.area(i);
        if (ar < 60) return Infinity;
        // prefer the footprint the landmark sits in, then near, mid-size buildings
        return buildings.distanceTo(i, lx, lz) + (ar > 9000 ? 40 : 0);
      };
    }
    let best = -1;
    let bestScore = Infinity;
    for (const i of buildings.around(lx, lz, 90)) {
      if (used.has(i)) continue;
      const sc = pick(i);
      if (sc < bestScore) {
        bestScore = sc;
        best = i;
      }
    }
    if (best < 0) continue;
    used.add(best);
    const ring = buildings.ring(best);
    const [cx, cz] = buildings.centroid(best);
    const road = nearestRoad(cx, cz);
    // wall edge closest to the road point, long enough for a doorway
    let bd = Infinity;
    let door = { x: cx, z: cz, nx: 0, nz: 1 };
    for (let k = 0, j = ring.length - 1; k < ring.length; j = k++) {
      const [ax, az] = ring[j];
      const [bx, bz] = ring[k];
      const ex = bx - ax;
      const ez = bz - az;
      const len = Math.hypot(ex, ez);
      if (len < 2.4) continue;
      // keep the door off the corners
      const m = 1.1 / len;
      const t = Math.max(m, Math.min(1 - m, ((road.x - ax) * ex + (road.z - az) * ez) / (len * len)));
      const px = ax + ex * t;
      const pz = az + ez * t;
      const d = Math.hypot(px - road.x, pz - road.z);
      if (d < bd) {
        bd = d;
        // ring is CCW with z pointing south, so outward normal is (ez, -ex)
        let nx = ez / len;
        let nz = -ex / len;
        // guard against odd winding: normal must point away from the centroid
        if ((px - cx) * nx + (pz - cz) * nz < 0) {
          nx = -nx;
          nz = -nz;
        }
        door = { x: px, z: pz, nx, nz };
      }
    }
    doors.push({ place, x: door.x + door.nx * 0.9, z: door.z + door.nz * 0.9, nx: door.nx, nz: door.nz, building: best, wallHeight: buildings.height(best) });
  }
  return doors;
}

function signTexture(text: string, bg: string, fg: string) {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 128;
  const g = c.getContext('2d')!;
  g.fillStyle = bg;
  g.fillRect(0, 0, 512, 128);
  g.strokeStyle = 'rgba(255,255,255,0.5)';
  g.lineWidth = 6;
  g.strokeRect(6, 6, 500, 116);
  g.fillStyle = fg;
  let size = 64;
  g.font = `800 ${size}px system-ui, sans-serif`;
  while (g.measureText(text).width > 470 && size > 22) {
    size -= 2;
    g.font = `800 ${size}px system-ui, sans-serif`;
  }
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, 256, 68);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** Doorways, awnings and shop signs for every enterable place. */
export class DoorVisuals {
  readonly group = new THREE.Group();
  private rings: { mesh: THREE.Mesh; door: Door }[] = [];

  constructor(doors: Door[]) {
    const frameMat = new THREE.MeshLambertMaterial({ color: 0x3b2f27 });
    const holeMat = new THREE.MeshBasicMaterial({ color: 0x1a1512 });
    const ringGeo = new THREE.RingGeometry(0.55, 0.8, 32).rotateX(-Math.PI / 2);
    const ringMat = new THREE.MeshBasicMaterial({ color: 0x7fe0a8, transparent: true, opacity: 0.75, depthWrite: false });
    for (const d of doors) {
      const g = new THREE.Group();
      const wx = d.x - d.nx * 0.9;
      const wz = d.z - d.nz * 0.9;
      g.position.set(wx, 0, wz);
      g.rotation.y = Math.atan2(d.nx, d.nz);
      // door opening: dark recess + frame
      const hole = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 2.3), holeMat);
      hole.position.set(0, 1.15, 0.03);
      const top = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.14, 0.14), frameMat);
      top.position.set(0, 2.36, 0.06);
      const l = new THREE.Mesh(new THREE.BoxGeometry(0.14, 2.36, 0.14), frameMat);
      l.position.set(-0.83, 1.18, 0.06);
      const r = l.clone();
      r.position.x = 0.83;
      g.add(hole, top, l, r);
      // shop sign above the door (houses get a small number plate)
      const accent = d.place.theme?.accent ?? 0x0f8a4f;
      const bg = `#${accent.toString(16).padStart(6, '0')}`;
      const isHome = d.place.kind === 'home';
      const text = isHome ? 'No. 12 · Tunde' : (d.place.sign ?? d.place.name).toUpperCase();
      const w = isHome ? 1.4 : Math.min(6, Math.max(3, text.length * 0.26));
      const sign = new THREE.Mesh(new THREE.PlaneGeometry(w, w / 4), new THREE.MeshBasicMaterial({ map: signTexture(text, isHome ? '#2c3e50' : bg, '#fff') }));
      sign.position.set(0, Math.min(3.4, d.wallHeight - 0.4), 0.08);
      g.add(sign);
      if (!isHome) {
        // corrugated awning over the entrance
        const aw = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.06, 1.2), new THREE.MeshLambertMaterial({ color: accent }));
        aw.position.set(0, 2.62, 0.6);
        aw.rotation.x = 0.18;
        g.add(aw);
      }
      g.traverse((o) => (o.matrixAutoUpdate = true));
      this.group.add(g);
      const ring = new THREE.Mesh(ringGeo, ringMat);
      ring.position.set(d.x, 0.08, d.z);
      ring.visible = false;
      this.group.add(ring);
      this.rings.push({ mesh: ring, door: d });
    }
  }

  update(px: number, pz: number, t: number) {
    for (const r of this.rings) {
      const dd = Math.hypot(r.door.x - px, r.door.z - pz);
      r.mesh.visible = dd < 25;
      if (r.mesh.visible) r.mesh.scale.setScalar(1 + Math.sin(t * 3) * 0.08);
    }
  }
}
