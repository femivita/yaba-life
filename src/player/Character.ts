import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

export type Gait = 'idle' | 'walk' | 'run';

/** Ground speed (m/s) each clip was authored for, used to sync stride to movement. */
const CLIP_SPEED: Record<Gait, number> = { idle: 0, walk: 1.45, run: 4.6 };

/**
 * A skinned MakeHuman-generated character with idle/walk/run clips.
 * Handles cross-fading and keeps feet from sliding by scaling clip speed.
 */
export class Character {
  readonly root = new THREE.Group();
  private mixer!: THREE.AnimationMixer;
  private actions = new Map<Gait, THREE.AnimationAction>();
  private gait: Gait = 'idle';

  static async load(url: string): Promise<Character> {
    const c = new Character();
    const gltf = await new GLTFLoader().loadAsync(url);
    const model = gltf.scene;
    model.traverse((o) => {
      const m = o as THREE.SkinnedMesh;
      if (m.isSkinnedMesh) {
        m.castShadow = true;
        m.receiveShadow = false;
        // the character is small on screen and always near the camera
        m.frustumCulled = false;
        const mats = Array.isArray(m.material) ? m.material : [m.material];
        for (const mat of mats as THREE.MeshStandardMaterial[]) {
          if (mat.name === 'body') {
            // a touch of sheen on dark skin reads much more natural
            mat.roughness = 0.5;
            mat.envMapIntensity = 0.7;
          }
          if (mat.transparent) mat.depthWrite = false;
        }
      }
    });
    c.root.add(model);
    c.mixer = new THREE.AnimationMixer(model);
    for (const clip of gltf.animations) {
      const action = c.mixer.clipAction(clip);
      action.play();
      action.setEffectiveWeight(clip.name === 'idle' ? 1 : 0);
      c.actions.set(clip.name as Gait, action);
    }
    return c;
  }

  /** speed in m/s along the ground */
  update(dt: number, speed: number) {
    const target: Gait = speed < 0.2 ? 'idle' : speed < 2.6 ? 'walk' : 'run';
    if (target !== this.gait) {
      const from = this.actions.get(this.gait)!;
      const to = this.actions.get(target)!;
      to.enabled = true;
      to.setEffectiveWeight(1);
      if (this.gait !== 'idle' && target !== 'idle') {
        // keep the legs in phase between walk and run
        to.time = (from.time / from.getClip().duration) * to.getClip().duration;
      }
      from.crossFadeTo(to, 0.25, false);
      this.gait = target;
    }
    for (const [g, a] of this.actions) {
      if (g !== 'idle') a.timeScale = THREE.MathUtils.clamp(speed / CLIP_SPEED[g], 0.6, 1.6);
    }
    this.mixer.update(dt);
  }
}
