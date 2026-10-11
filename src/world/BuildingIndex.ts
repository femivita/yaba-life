import type { MapArrays } from '../core/MapData';

const CELL = 24;

/**
 * Uniform grid over building footprints for cheap player collision.
 * Footprints stay as int16 decimetres; we decode on demand.
 */
export class BuildingIndex {
  private starts: Uint32Array;
  private grid = new Map<number, number[]>();

  constructor(private a: MapArrays) {
    const n = a.bCounts.length;
    this.starts = new Uint32Array(n + 1);
    for (let i = 0; i < n; i++) this.starts[i + 1] = this.starts[i] + a.bCounts[i];
    for (let i = 0; i < n; i++) {
      let minx = Infinity;
      let minz = Infinity;
      let maxx = -Infinity;
      let maxz = -Infinity;
      for (let k = this.starts[i]; k < this.starts[i + 1]; k++) {
        const x = a.bCoords[k * 2] / 10;
        const z = a.bCoords[k * 2 + 1] / 10;
        minx = Math.min(minx, x);
        maxx = Math.max(maxx, x);
        minz = Math.min(minz, z);
        maxz = Math.max(maxz, z);
      }
      for (let gx = Math.floor(minx / CELL); gx <= Math.floor(maxx / CELL); gx++) {
        for (let gz = Math.floor(minz / CELL); gz <= Math.floor(maxz / CELL); gz++) {
          const key = gx * 100003 + gz;
          let list = this.grid.get(key);
          if (!list) this.grid.set(key, (list = []));
          list.push(i);
        }
      }
    }
  }

  private near(x: number, z: number) {
    return this.grid.get(Math.floor(x / CELL) * 100003 + Math.floor(z / CELL)) ?? [];
  }

  get count() {
    return this.a.bCounts.length;
  }

  /** Footprint ring of building i in metres. */
  ring(i: number): [number, number][] {
    const out: [number, number][] = [];
    for (let k = this.starts[i]; k < this.starts[i + 1]; k++) out.push([this.a.bCoords[k * 2] / 10, this.a.bCoords[k * 2 + 1] / 10]);
    return out;
  }

  area(i: number) {
    const r = this.ring(i);
    let a = 0;
    for (let k = 0, j = r.length - 1; k < r.length; j = k++) a += (r[j][0] + r[k][0]) * (r[j][1] - r[k][1]);
    return Math.abs(a / 2);
  }

  centroid(i: number): [number, number] {
    const r = this.ring(i);
    let x = 0;
    let z = 0;
    for (const p of r) {
      x += p[0];
      z += p[1];
    }
    return [x / r.length, z / r.length];
  }

  /** Buildings whose grid cells fall within radius of (x, z). */
  around(x: number, z: number, radius: number): number[] {
    const set = new Set<number>();
    for (let gx = Math.floor((x - radius) / CELL); gx <= Math.floor((x + radius) / CELL); gx++)
      for (let gz = Math.floor((z - radius) / CELL); gz <= Math.floor((z + radius) / CELL); gz++)
        for (const i of this.grid.get(gx * 100003 + gz) ?? []) set.add(i);
    return [...set];
  }

  /** Distance from (x, z) to the footprint outline of building i (0 if inside). */
  distanceTo(i: number, x: number, z: number) {
    if (this.contains(i, x, z)) return 0;
    const r = this.ring(i);
    let best = Infinity;
    for (let k = 0, j = r.length - 1; k < r.length; j = k++) best = Math.min(best, segDist(x, z, r[j][0], r[j][1], r[k][0], r[k][1]));
    return best;
  }

  height(i: number) {
    return this.a.bHeights[i] / 10;
  }

  /** Index of the building containing (x, z), or -1. */
  inside(x: number, z: number): number {
    for (const i of this.near(x, z)) if (this.contains(i, x, z)) return i;
    return -1;
  }

  private contains(i: number, x: number, z: number) {
    const c = this.a.bCoords;
    let inside = false;
    const s = this.starts[i];
    const e = this.starts[i + 1];
    for (let k = s, j = e - 1; k < e; j = k++) {
      const xi = c[k * 2] / 10;
      const zi = c[k * 2 + 1] / 10;
      const xj = c[j * 2] / 10;
      const zj = c[j * 2 + 1] / 10;
      if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
    }
    return inside;
  }

  /**
   * Push a circle of radius r at (x, z) out of any footprint it overlaps.
   * Returns the corrected position.
   */
  resolve(x: number, z: number, r: number): [number, number] {
    const c = this.a.bCoords;
    for (let iter = 0; iter < 3; iter++) {
      let moved = false;
      const seen = new Set<number>();
      for (const dx of [-r, r]) {
        for (const dz of [-r, r]) {
          for (const i of this.near(x + dx, z + dz)) {
            if (seen.has(i)) continue;
            seen.add(i);
            const s = this.starts[i];
            const e = this.starts[i + 1];
            const inside = this.contains(i, x, z);
            // nearest edge
            let best = Infinity;
            let bx = 0;
            let bz = 0;
            for (let k = s, j = e - 1; k < e; j = k++) {
              const ax = c[j * 2] / 10;
              const az = c[j * 2 + 1] / 10;
              const ex = c[k * 2] / 10 - ax;
              const ez = c[k * 2 + 1] / 10 - az;
              const l2 = ex * ex + ez * ez || 1;
              const t = Math.max(0, Math.min(1, ((x - ax) * ex + (z - az) * ez) / l2));
              const px = ax + ex * t;
              const pz = az + ez * t;
              const d = Math.hypot(x - px, z - pz);
              if (d < best) {
                best = d;
                bx = px;
                bz = pz;
              }
            }
            if (inside || best < r) {
              let nx = x - bx;
              let nz = z - bz;
              const l = Math.hypot(nx, nz) || 1;
              nx /= l;
              nz /= l;
              if (inside) {
                nx = -nx;
                nz = -nz;
              }
              const push = inside ? best + r : r - best;
              x += nx * push;
              z += nz * push;
              moved = true;
            }
          }
        }
      }
      if (!moved) break;
    }
    return [x, z];
  }
}

export function segDist(x: number, z: number, ax: number, az: number, bx: number, bz: number) {
  const ex = bx - ax;
  const ez = bz - az;
  const l2 = ex * ex + ez * ez || 1;
  const t = Math.max(0, Math.min(1, ((x - ax) * ex + (z - az) * ez) / l2));
  return Math.hypot(x - ax - ex * t, z - az - ez * t);
}
