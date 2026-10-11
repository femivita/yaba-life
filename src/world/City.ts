import * as THREE from 'three';
import type { LoadedMap } from '../core/MapData';
import type { ChunkGeometry, GeomArrays } from './cityWorker';
import CityWorker from './cityWorker?worker';
import { BuildingIndex } from './BuildingIndex';
import { Trees } from './Trees';

/** Shared uniforms the sky drives (night lights, etc.). */
export const cityUniforms = {
  uNight: { value: 0 },
  uTime: { value: 0 },
};

function wallMaterial() {
  const m = new THREE.MeshLambertMaterial({ vertexColors: true });
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uNight = cityUniforms.uNight;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec2 uv2w;\nvarying vec2 vWall;\nvarying vec3 vWorld;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWall = uv2w;\nvWorld = (modelMatrix * vec4(position,1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
uniform float uNight;
varying vec2 vWall;
varying vec3 vWorld;
float hash12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
// procedural windows: 3.2 m floors, ~2.8 m bays
float floorH = 3.2;
vec2 cell = vec2(vWall.x / 2.8, vWall.y / floorH);
vec2 f = fract(cell);
vec2 id = floor(cell) + floor(vWorld.xz * 0.05);
float win = step(0.28, f.x) * step(f.x, 0.72) * step(0.3, f.y) * step(f.y, 0.78);
win *= step(1.0, vWall.y); // no windows hugging the ground line
// burglar-proof grille look: thin bars across the glass
float bars = step(0.85, fract(f.x * 6.0));
vec3 glass = mix(vec3(0.16, 0.2, 0.24), vec3(0.32, 0.38, 0.42), hash12(id));
glass = mix(glass, vec3(0.12), bars * 0.6);
// ground floor shop band: darker, plus a coloured fascia
float ground = 1.0 - step(floorH, vWall.y);
float shop = step(0.55, hash12(floor(vec2(vWall.x / 5.0, 7.0)) + floor(vWorld.xz * 0.05)));
diffuseColor.rgb = mix(diffuseColor.rgb, glass, win * (1.0 - ground));
diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.18, 0.16, 0.14), ground * shop * step(0.3, f.y) * step(f.y, 0.82) * step(0.08, fract(vWall.x / 5.0)) * step(fract(vWall.x / 5.0), 0.92));
// grime near the ground from red laterite dust and rain splash
diffuseColor.rgb *= mix(0.78, 1.0, smoothstep(0.0, 1.4, vWall.y));
float lit = win * (1.0 - ground) * step(0.55, hash12(id + 3.7)) * uNight;
float shopLit = ground * shop * uNight * step(0.4, hash12(id + 9.1));
`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
totalEmissiveRadiance += vec3(1.0, 0.72, 0.38) * lit * 0.75 + vec3(0.9, 0.6, 0.32) * shopLit * 0.22;`,
      );
  };
  return m;
}

function geometryFrom(g: GeomArrays, opts: { wallUv?: boolean } = {}) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(g.position, 3));
  if (g.normal) geo.setAttribute('normal', new THREE.BufferAttribute(g.normal, 3, true));
  else {
    // flat ground pieces: every normal points up
    const n = new Int8Array(g.position.length);
    for (let i = 1; i < n.length; i += 3) n[i] = 127;
    geo.setAttribute('normal', new THREE.BufferAttribute(n, 3, true));
  }
  if (g.uv) geo.setAttribute(opts.wallUv ? 'uv2w' : 'uv', new THREE.BufferAttribute(g.uv, 2));
  if (g.color) geo.setAttribute('color', new THREE.BufferAttribute(g.color, 3, true));
  geo.setIndex(new THREE.BufferAttribute(g.index, 1));
  geo.computeBoundingSphere();
  geo.computeBoundingBox();
  return geo;
}

function makeRoadTexture() {
  // fine asphalt grain with a few darker patches; tiny so it costs nothing
  const S = 128;
  const c = document.createElement('canvas');
  c.width = S;
  c.height = S;
  const g = c.getContext('2d')!;
  const img = g.createImageData(S, S);
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < S * S; i++) {
    const v = 228 + rnd() * 27;
    img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v;
    img.data[i * 4 + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  g.globalAlpha = 0.045;
  for (let k = 0; k < 14; k++) {
    g.fillStyle = k % 2 ? '#000' : '#5a3a20';
    g.beginPath();
    g.ellipse(rnd() * S, rnd() * S, 6 + rnd() * 18, 4 + rnd() * 10, rnd() * 3, 0, Math.PI * 2);
    g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

export class City {
  readonly group = new THREE.Group();
  readonly buildings: BuildingIndex;
  private materials: Record<string, THREE.Material>;
  private chunkMeshes: THREE.Object3D[] = [];
  private trees = new Trees();

  constructor(readonly map: LoadedMap) {
    this.buildings = new BuildingIndex(map.arrays);
    const water = new THREE.MeshPhongMaterial({ color: 0x3f6f78, specular: 0x88aabb, shininess: 60 });
    this.materials = {
      walls: wallMaterial(),
      roofs: new THREE.MeshLambertMaterial({ vertexColors: true }),
      roads: new THREE.MeshLambertMaterial({ vertexColors: true, map: makeRoadTexture(), polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
      marks: new THREE.MeshLambertMaterial({ vertexColors: true, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }),
      areas: new THREE.MeshLambertMaterial({ vertexColors: true, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }),
      water,
    };
    // ground: dusty laterite-grey
    const [x0, z0, x1, z1] = map.meta.bounds;
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(x1 - x0 + 4000, z1 - z0 + 4000),
      new THREE.MeshLambertMaterial({ color: 0x8e8574 }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.set((x0 + x1) / 2, -0.02, (z0 + z1) / 2);
    ground.receiveShadow = true;
    this.group.add(ground, this.trees.group);
  }

  /** Builds geometry in a worker; resolves when every chunk is in the scene. */
  build(onProgress?: (f: number) => void): Promise<void> {
    return new Promise((resolve, reject) => {
      const worker = new CityWorker();
      let n = 0;
      worker.onmessage = (e: MessageEvent) => {
        if (e.data.type === 'chunk') {
          this.addChunk(e.data.chunk as ChunkGeometry);
          onProgress?.(Math.min(0.99, ++n / 220));
        } else if (e.data.type === 'done') {
          worker.terminate();
          onProgress?.(1);
          resolve();
        }
      };
      worker.onerror = (e) => reject(e);
      const copy = this.map.buf.slice(0);
      worker.postMessage({ meta: this.map.meta, buf: copy }, [copy]);
    });
  }

  private addChunk(c: ChunkGeometry) {
    const add = (g: GeomArrays | undefined, mat: string, order: number, shadows: { cast: boolean; receive: boolean }) => {
      if (!g) return;
      const mesh = new THREE.Mesh(geometryFrom(g, { wallUv: mat === 'walls' }), this.materials[mat]);
      mesh.matrixAutoUpdate = false;
      mesh.renderOrder = order;
      mesh.castShadow = shadows.cast;
      mesh.receiveShadow = shadows.receive;
      mesh.userData.kind = mat;
      this.group.add(mesh);
      this.chunkMeshes.push(mesh);
    };
    add(c.water, 'water', 0, { cast: false, receive: false });
    add(c.areas, 'areas', 1, { cast: false, receive: true });
    add(c.roads, 'roads', 2, { cast: false, receive: true });
    add(c.marks, 'marks', 3, { cast: false, receive: false });
    add(c.walls, 'walls', 4, { cast: true, receive: true });
    add(c.roofs, 'roofs', 4, { cast: true, receive: true });
    if (c.trees) {
      const before = this.trees.meshes.length;
      this.trees.addChunk(c.trees);
      this.chunkMeshes.push(...this.trees.meshes.slice(before));
    }
  }

  /** Sodium street-light glow on the tarmac after dark (no real lights needed). */
  setNight(night: number) {
    (this.materials.roads as THREE.MeshLambertMaterial).emissive.setRGB(0.022, 0.016, 0.009).multiplyScalar(night);
    (this.materials.areas as THREE.MeshLambertMaterial).emissive.setRGB(0.01, 0.009, 0.008).multiplyScalar(night);
  }

  /** Hide far chunks entirely (cheaper than relying on fog + frustum alone). */
  updateVisibility(center: THREE.Vector3, radius: number) {
    const r2 = radius * radius;
    for (const m of this.chunkMeshes) {
      const s = (m as THREE.InstancedMesh).boundingSphere ?? (m as THREE.Mesh).geometry.boundingSphere!;
      const dx = s.center.x - center.x;
      const dz = s.center.z - center.z;
      const d = Math.max(0, Math.sqrt(dx * dx + dz * dz) - s.radius);
      const kind = m.userData.kind;
      // small details fade out sooner
      const lim = kind === 'marks' ? r2 * 0.25 : kind === 'trees' ? r2 * 0.45 : r2;
      m.visible = d * d < lim;
    }
  }
}
