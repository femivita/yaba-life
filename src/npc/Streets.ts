import * as THREE from 'three';
import type { LoadedMap } from '../core/MapData';

const WALKABLE: Record<string, number> = {
  primary: 13, secondary: 10, tertiary: 8, residential: 6, unclassified: 6, living_street: 5, pedestrian: 4, footway: 2, service: 4,
};
const CELL = 100;

/** Pavement routes along the real streets for passers-by to walk. */
export class Streets {
  private lines: { pts: THREE.Vector2[]; w: number }[] = [];
  private grid = new Map<number, number[]>();

  constructor(map: LoadedMap) {
    const a = map.arrays;
    const classes = map.meta.roads.classes;
    let o = 0;
    for (let i = 0; i < a.rCounts.length; i++) {
      const n = a.rCounts[i];
      const w = WALKABLE[classes[a.rClass[i] & 0x7f]];
      if (w && n >= 2) {
        const pts: THREE.Vector2[] = [];
        for (let k = 0; k < n; k++) pts.push(new THREE.Vector2(a.rCoords[(o + k) * 2] / 10, a.rCoords[(o + k) * 2 + 1] / 10));
        const idx = this.lines.length;
        this.lines.push({ pts, w });
        const seen = new Set<number>();
        for (const p of pts) {
          const key = Math.floor(p.x / CELL) * 1000 + Math.floor(p.y / CELL);
          if (seen.has(key)) continue;
          seen.add(key);
          let l = this.grid.get(key);
          if (!l) this.grid.set(key, (l = []));
          l.push(idx);
        }
      }
      o += n;
    }
  }

  /**
   * A walking route that starts between minD and maxD from (x, z), offset to
   * the pavement on one side, heading in a random direction along the street.
   */
  route(x: number, z: number, minD: number, maxD: number): THREE.Vector2[] | null {
    const cands: number[] = [];
    for (let gx = Math.floor((x - maxD) / CELL); gx <= Math.floor((x + maxD) / CELL); gx++)
      for (let gz = Math.floor((z - maxD) / CELL); gz <= Math.floor((z + maxD) / CELL); gz++) cands.push(...(this.grid.get(gx * 1000 + gz) ?? []));
    for (let tries = 0; tries < 12 && cands.length; tries++) {
      const line = this.lines[cands[Math.floor(Math.random() * cands.length)]];
      const pts = line.pts;
      // find a vertex in the ring between minD and maxD
      const ks = pts.map((_, k) => k).filter((k) => {
        const d = Math.hypot(pts[k].x - x, pts[k].y - z);
        return d > minD && d < maxD;
      });
      if (!ks.length) continue;
      const k0 = ks[Math.floor(Math.random() * ks.length)];
      const fwd = Math.random() < 0.5;
      const seq = fwd ? pts.slice(k0) : pts.slice(0, k0 + 1).reverse();
      if (seq.length < 2) continue;
      const side = (line.w / 2 + 0.9) * (Math.random() < 0.5 ? 1 : -1);
      const out: THREE.Vector2[] = [];
      for (let k = 0; k < seq.length; k++) {
        const a = seq[Math.max(0, k - 1)];
        const b = seq[Math.min(seq.length - 1, k + 1)];
        const dx = b.x - a.x;
        const dz = b.y - a.y;
        const l = Math.hypot(dx, dz) || 1;
        out.push(new THREE.Vector2(seq[k].x - (dz / l) * side, seq[k].y + (dx / l) * side));
      }
      // subdivide long segments so turns stay smooth
      const fine: THREE.Vector2[] = [out[0]];
      for (let k = 1; k < out.length; k++) {
        const d = out[k].distanceTo(out[k - 1]);
        const n = Math.ceil(d / 12);
        for (let s = 1; s <= n; s++) fine.push(out[k - 1].clone().lerp(out[k], s / n));
      }
      return fine;
    }
    return null;
  }
}
