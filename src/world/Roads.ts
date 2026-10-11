import type { LoadedMap } from '../core/MapData';

export interface RoadLine {
  name: string;
  cls: string;
  bridge: boolean;
  pts: [number, number][];
}

/** Road polylines decoded from the map, for placing things along real streets. */
export class Roads {
  readonly lines: RoadLine[] = [];

  constructor(map: LoadedMap) {
    const a = map.arrays;
    const meta = map.meta.roads;
    let o = 0;
    for (let i = 0; i < a.rCounts.length; i++) {
      const n = a.rCounts[i];
      const pts: [number, number][] = [];
      for (let k = 0; k < n; k++) pts.push([a.rCoords[(o + k) * 2] / 10, a.rCoords[(o + k) * 2 + 1] / 10]);
      o += n;
      this.lines.push({ name: meta.names[a.rName[i]] ?? '', cls: meta.classes[a.rClass[i] & 0x7f], bridge: (a.rClass[i] & 0x80) !== 0, pts });
    }
  }

  /** Nearest point on any road matching the filter, with the road direction there. */
  nearest(x: number, z: number, filter: (l: RoadLine) => boolean = () => true) {
    let best = { x, z, d: Infinity, dx: 1, dz: 0, line: null as RoadLine | null };
    for (const l of this.lines) {
      if (!filter(l)) continue;
      for (let k = 0; k < l.pts.length - 1; k++) {
        const [ax, az] = l.pts[k];
        const [bx, bz] = l.pts[k + 1];
        if (Math.abs(ax - x) > 600 && Math.abs(bx - x) > 600) continue;
        const ex = bx - ax;
        const ez = bz - az;
        const l2 = ex * ex + ez * ez || 1;
        const t = Math.max(0, Math.min(1, ((x - ax) * ex + (z - az) * ez) / l2));
        const px = ax + ex * t;
        const pz = az + ez * t;
        const d = Math.hypot(px - x, pz - z);
        if (d < best.d) {
          const len = Math.sqrt(l2);
          best = { x: px, z: pz, d, dx: ex / len, dz: ez / len, line: l };
        }
      }
    }
    return best;
  }
}

export const ROAD_WIDTH: Record<string, number> = {
  motorway: 22, trunk: 18, primary: 13, secondary: 10, tertiary: 8, residential: 6, unclassified: 6, living_street: 5,
  service: 4, track: 3.5, footway: 2, path: 1.8, pedestrian: 4, steps: 2, cycleway: 2, standard_gauge: 3.2, rail: 3.2, unknown: 4,
};
