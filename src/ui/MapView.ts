import type { LoadedMap } from '../core/MapData';

const MPP = 3; // metres per pixel of the pre-rendered map

const AREA_FILL: Record<string, string> = {
  water: '#5d8f9a', park: '#7fa05c', grass: '#93a96a', pitch: '#76a860', campus: '#c9c0a2', school: '#cfc3a2',
  hospital: '#d4c9bb', market: '#c8ae90', residential: '#bdb09a', industrial: '#b1aca4', cemetery: '#8ea06a',
  military: '#aeae8c', railway: '#a89a8a', sand: '#dccaa2', wetland: '#7f9a72', stadium: '#b9b6ae',
};

const ROAD_W: Record<string, number> = {
  motorway: 7, trunk: 6, primary: 5, secondary: 4, tertiary: 3.2, residential: 2.2, unclassified: 2.2,
  service: 1.4, standard_gauge: 1.6, rail: 1.6,
};

/** Pre-rendered top-down map, used by the minimap and the full map screen. */
export class MapView {
  readonly canvas = document.createElement('canvas');
  readonly x0: number;
  readonly z0: number;
  private roadGrid = new Map<number, number[]>();
  private roadStarts: Uint32Array;

  constructor(private map: LoadedMap) {
    const [x0, z0, x1, z1] = map.meta.bounds;
    this.x0 = x0;
    this.z0 = z0;
    this.canvas.width = Math.ceil((x1 - x0) / MPP);
    this.canvas.height = Math.ceil((z1 - z0) / MPP);
    const a = map.arrays;
    this.roadStarts = new Uint32Array(a.rCounts.length + 1);
    for (let i = 0; i < a.rCounts.length; i++) this.roadStarts[i + 1] = this.roadStarts[i] + a.rCounts[i];
    this.draw();
    this.indexRoads();
  }

  px(x: number) {
    return (x - this.x0) / MPP;
  }
  pz(z: number) {
    return (z - this.z0) / MPP;
  }

  private draw() {
    const g = this.canvas.getContext('2d')!;
    const a = this.map.arrays;
    const meta = this.map.meta;
    g.fillStyle = '#b8ab95';
    g.fillRect(0, 0, this.canvas.width, this.canvas.height);
    // areas
    let o = 0;
    let ci = 0;
    for (let i = 0; i < a.aKind.length; i++) {
      const kind = meta.areas.kinds[a.aKind[i]];
      g.beginPath();
      for (let r = 0; r <= a.aHoles[i]; r++) {
        const cnt = a.aCounts[ci++];
        for (let k = 0; k < cnt; k++) {
          const x = this.px(a.aCoords[(o + k) * 2] / 10);
          const z = this.pz(a.aCoords[(o + k) * 2 + 1] / 10);
          if (k === 0) g.moveTo(x, z);
          else g.lineTo(x, z);
        }
        g.closePath();
        o += cnt;
      }
      g.fillStyle = AREA_FILL[kind] ?? '#bdb09a';
      g.fill('evenodd');
    }
    // buildings
    g.fillStyle = '#8d8274';
    o = 0;
    g.beginPath();
    for (let i = 0; i < a.bCounts.length; i++) {
      const cnt = a.bCounts[i];
      for (let k = 0; k < cnt; k++) {
        const x = this.px(a.bCoords[(o + k) * 2] / 10);
        const z = this.pz(a.bCoords[(o + k) * 2 + 1] / 10);
        if (k === 0) g.moveTo(x, z);
        else g.lineTo(x, z);
      }
      g.closePath();
      o += cnt;
    }
    g.fill();
    // roads, minor first
    const classes = meta.roads.classes;
    const order = ['service', 'unclassified', 'residential', 'tertiary', 'secondary', 'primary', 'trunk', 'motorway', 'standard_gauge'];
    g.lineCap = 'round';
    g.lineJoin = 'round';
    for (const cls of order) {
      const ci2 = classes.indexOf(cls);
      g.beginPath();
      for (let i = 0; i < a.rCounts.length; i++) {
        if ((a.rClass[i] & 0x7f) !== ci2) continue;
        const s = this.roadStarts[i];
        for (let k = 0; k < a.rCounts[i]; k++) {
          const x = this.px(a.rCoords[(s + k) * 2] / 10);
          const z = this.pz(a.rCoords[(s + k) * 2 + 1] / 10);
          if (k === 0) g.moveTo(x, z);
          else g.lineTo(x, z);
        }
      }
      const rail = cls === 'standard_gauge';
      g.strokeStyle = rail ? '#5b4d44' : ['primary', 'trunk', 'motorway'].includes(cls) ? '#f2d27a' : '#f4efe4';
      g.lineWidth = ROAD_W[cls] ?? 1.2;
      if (rail) g.setLineDash([4, 3]);
      g.stroke();
      g.setLineDash([]);
    }
  }

  private indexRoads() {
    const a = this.map.arrays;
    for (let i = 0; i < a.rCounts.length; i++) {
      if (a.rName[i] === 65535) continue;
      const s = this.roadStarts[i];
      for (let k = 0; k < a.rCounts[i]; k++) {
        const key = Math.floor(a.rCoords[(s + k) * 2] / 10 / 60) * 100003 + Math.floor(a.rCoords[(s + k) * 2 + 1] / 10 / 60);
        let l = this.roadGrid.get(key);
        if (!l) this.roadGrid.set(key, (l = []));
        if (l[l.length - 1] !== i) l.push(i);
      }
    }
  }

  /** Name of the nearest named street within ~60 m. */
  streetAt(x: number, z: number): string | null {
    const a = this.map.arrays;
    let best = 60;
    let name: string | null = null;
    const gx = Math.floor(x / 60);
    const gz = Math.floor(z / 60);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        for (const i of this.roadGrid.get((gx + dx) * 100003 + gz + dz) ?? []) {
          const s = this.roadStarts[i];
          for (let k = 0; k < a.rCounts[i] - 1; k++) {
            const ax = a.rCoords[(s + k) * 2] / 10;
            const az = a.rCoords[(s + k) * 2 + 1] / 10;
            const ex = a.rCoords[(s + k + 1) * 2] / 10 - ax;
            const ez = a.rCoords[(s + k + 1) * 2 + 1] / 10 - az;
            const l2 = ex * ex + ez * ez || 1;
            const t = Math.max(0, Math.min(1, ((x - ax) * ex + (z - az) * ez) / l2));
            const d = Math.hypot(x - ax - ex * t, z - az - ez * t);
            if (d < best) {
              best = d;
              name = this.map.meta.roads.names[a.rName[i]];
            }
          }
        }
      }
    }
    return name;
  }
}
