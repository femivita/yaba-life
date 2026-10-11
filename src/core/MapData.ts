/** Loader for the compact city files produced by tools/build_map.py. */

export interface BinRef {
  offset: number;
  length: number;
  type: 'int16' | 'uint16' | 'uint8';
}

export interface Landmark {
  id: string;
  name: string;
  type: string;
  district?: string;
  hooks: string[];
  hours?: string;
  x: number;
  z: number;
  snapped: string | null;
}

export interface Poi {
  name: string;
  cat: string;
  x: number;
  z: number;
}

export interface AreaName {
  name: string;
  kind: string;
  x: number;
  z: number;
  area: number;
}

export interface MapMeta {
  name: string;
  origin: { lat: number; lon: number };
  bounds: [number, number, number, number];
  attribution: string;
  buildings: { count: number; counts: BinRef; coords: BinRef; heights: BinRef; kinds: BinRef };
  roads: { classes: string[]; names: string[]; count: number; counts: BinRef; coords: BinRef; class: BinRef; name: BinRef };
  areas: { kinds: string[]; count: number; kind: BinRef; holes: BinRef; counts: BinRef; coords: BinRef };
  pois: Poi[];
  landmarks: Landmark[];
  areaNames: AreaName[];
  districts: { id: string; name: string; feel?: string }[];
  spawn: { x: number; z: number };
}

/** Typed views over yaba.bin. Coordinates are int16 decimetres. */
export interface MapArrays {
  bCounts: Uint16Array;
  bCoords: Int16Array;
  bHeights: Uint16Array;
  bKinds: Uint8Array;
  rCounts: Uint16Array;
  rCoords: Int16Array;
  rClass: Uint8Array;
  rName: Uint16Array;
  aKind: Uint8Array;
  aHoles: Uint8Array;
  aCounts: Uint16Array;
  aCoords: Int16Array;
}

export function viewArrays(meta: MapMeta, buf: ArrayBuffer): MapArrays {
  const v = (r: BinRef) => {
    const C = r.type === 'int16' ? Int16Array : r.type === 'uint16' ? Uint16Array : Uint8Array;
    return new C(buf, r.offset, r.length);
  };
  return {
    bCounts: v(meta.buildings.counts) as Uint16Array,
    bCoords: v(meta.buildings.coords) as Int16Array,
    bHeights: v(meta.buildings.heights) as Uint16Array,
    bKinds: v(meta.buildings.kinds) as Uint8Array,
    rCounts: v(meta.roads.counts) as Uint16Array,
    rCoords: v(meta.roads.coords) as Int16Array,
    rClass: v(meta.roads.class) as Uint8Array,
    rName: v(meta.roads.name) as Uint16Array,
    aKind: v(meta.areas.kind) as Uint8Array,
    aHoles: v(meta.areas.holes) as Uint8Array,
    aCounts: v(meta.areas.counts) as Uint16Array,
    aCoords: v(meta.areas.coords) as Int16Array,
  };
}

export async function loadMap(base: string, onProgress?: (f: number) => void) {
  const metaRes = await fetch(`${base}.json`);
  const meta = (await metaRes.json()) as MapMeta;
  const res = await fetch(`${base}.bin`);
  const total = Number(res.headers.get('content-length')) || (meta as unknown as { binBytes: number }).binBytes;
  let buf: ArrayBuffer;
  if (res.body && total && onProgress) {
    const reader = res.body.getReader();
    const out = new Uint8Array(total);
    let got = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (got + value.length > out.length) {
        // content-length was the compressed size; fall back to growing
        const bigger = new Uint8Array(Math.max(out.length * 2, got + value.length));
        bigger.set(out.subarray(0, got));
        return finish(meta, await grow(reader, bigger, got, value));
      }
      out.set(value, got);
      got += value.length;
      onProgress(got / total);
    }
    buf = out.buffer.slice(0, got) as ArrayBuffer;
  } else {
    buf = await res.arrayBuffer();
  }
  return finish(meta, buf);
}

async function grow(reader: ReadableStreamDefaultReader<Uint8Array>, out: Uint8Array, got: number, first: Uint8Array) {
  out.set(first, got);
  got += first.length;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (got + value.length > out.length) {
      const bigger = new Uint8Array(out.length * 2);
      bigger.set(out.subarray(0, got));
      out = bigger;
    }
    out.set(value, got);
    got += value.length;
  }
  return out.buffer.slice(0, got) as ArrayBuffer;
}

function finish(meta: MapMeta, buf: ArrayBuffer) {
  return { meta, buf, arrays: viewArrays(meta, buf) };
}

export type LoadedMap = Awaited<ReturnType<typeof loadMap>>;
