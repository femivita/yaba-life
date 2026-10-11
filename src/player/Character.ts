import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';

export type Gait = 'idle' | 'walk' | 'run';
/** Clips baked by tools/character/build_character.py. */
export type Clip = Gait | 'talk' | 'work' | 'sit' | 'sit_eat' | 'sit_work' | 'dance' | 'lie';

/** Ground speed (m/s) each clip was authored for, used to sync stride to movement. */
const CLIP_SPEED: Record<Gait, number> = { idle: 0, walk: 1.45, run: 4.6 };

const cache = new Map<string, Promise<GLTF>>();
function loadGltf(url: string) {
  let p = cache.get(url);
  if (!p) cache.set(url, (p = new GLTFLoader().loadAsync(url)));
  return p;
}

/**
 * A skinned MakeHuman-generated character. Locomotion blends idle/walk/run
 * from ground speed (scaling clip speed so feet don't slide); `pose` holds
 * an action clip such as sitting or talking until cleared.
 */
export class Character {
  readonly root = new THREE.Group();
  private mixer!: THREE.AnimationMixer;
  private actions = new Map<Clip, THREE.AnimationAction>();
  private current: Clip = 'idle';
  /** action clip that overrides locomotion while set */
  pose: Clip | null = null;
  materials: THREE.MeshStandardMaterial[] = [];

  static async load(url: string, opts: { shadows?: boolean; tint?: Record<string, number> } = {}): Promise<Character> {
    const gltf = await loadGltf(url);
    const c = new Character();
    const model = cloneSkinned(gltf.scene);
    model.traverse((o) => {
      const m = o as THREE.SkinnedMesh;
      if (m.isSkinnedMesh) {
        m.castShadow = opts.shadows ?? true;
        m.receiveShadow = false;
        // skinned bounds are unreliable once animated; culling is done per character instead
        m.frustumCulled = false;
        const src = Array.isArray(m.material) ? m.material : [m.material];
        const mats = (src as THREE.MeshStandardMaterial[]).map((mat) => {
          const mm = mat.clone();
          if (mm.name === 'body') {
            // a touch of sheen on dark skin reads much more natural
            mm.roughness = 0.5;
            mm.envMapIntensity = 0.7;
          }
          if (mm.transparent) mm.depthWrite = false;
          const t = opts.tint?.[mm.name];
          if (t !== undefined) mm.color.setHex(t);
          c.materials.push(mm);
          return mm;
        });
        m.material = Array.isArray(m.material) ? mats : mats[0];
      }
    });
    c.root.add(model);
    c.mixer = new THREE.AnimationMixer(model);
    for (const clip of gltf.animations) {
      const action = c.mixer.clipAction(clip);
      action.play();
      action.setEffectiveWeight(clip.name === 'idle' ? 1 : 0);
      c.actions.set(clip.name as Clip, action);
    }
    return c;
  }

  has(clip: Clip) {
    return this.actions.has(clip);
  }

  private fadeTo(target: Clip, time = 0.25) {
    if (target === this.current || !this.actions.has(target)) return;
    const from = this.actions.get(this.current)!;
    const to = this.actions.get(target)!;
    to.enabled = true;
    to.setEffectiveWeight(1);
    const gaits = ['walk', 'run'];
    if (gaits.includes(this.current) && gaits.includes(target)) {
      // keep the legs in phase between walk and run
      to.time = (from.time / from.getClip().duration) * to.getClip().duration;
    } else {
      to.time = Math.random() * to.getClip().duration;
    }
    from.crossFadeTo(to, time, false);
    this.current = target;
  }

  /** speed in m/s along the ground */
  update(dt: number, speed: number) {
    const target: Clip = this.pose ?? (speed < 0.2 ? 'idle' : speed < 2.6 ? 'walk' : 'run');
    this.fadeTo(target, this.pose ? 0.35 : 0.25);
    for (const g of ['walk', 'run'] as const) {
      this.actions.get(g)!.timeScale = THREE.MathUtils.clamp(speed / CLIP_SPEED[g], 0.6, 1.6);
    }
    this.mixer.update(dt);
  }
}
