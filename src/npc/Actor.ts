import * as THREE from 'three';
import { Character, type Clip } from '../player/Character';
import type { Talker } from './Social';

const BASE = import.meta.env.BASE_URL;

/** clothes colours for crowd variety (multiplied over the garment texture) */
const SHIRT_TINTS = [0xffffff, 0xffd0d0, 0xd0e0ff, 0xd8ffd0, 0xfff0b0, 0xe0d0ff, 0xffe0c0, 0xc8f0f0];

/**
 * A person in the world: a skinned character plus where they stand or walk.
 * Far actors skip animation updates entirely to keep CPU low.
 */
export class Actor {
  readonly root: THREE.Group;
  heading = 0;
  speed = 0;
  path: THREE.Vector2[] = [];
  pathIdx = 0;
  /** seconds left with the talk pose while chatting */
  talking = 0;
  lying = false;
  seatY = 0;
  baseClip: Clip = 'idle';
  private animAcc = 0;

  private constructor(readonly ch: Character, public talker: Talker) {
    this.root = ch.root;
    this.root.userData.actor = this;
  }

  static async create(model: string, talker: Talker, seed = 0, shadows = false) {
    const ch = await Character.load(`${BASE}models/${model}.glb`, { shadows });
    if (seed) {
      // vary garments so crowds don't look cloned
      for (const m of ch.materials) {
        if (m.name !== 'body' && !/eye|brow|lash|low-poly|hair|beard|wig|braid|bob|short/i.test(m.name)) {
          m.color.setHex(SHIRT_TINTS[Math.abs(seed) % SHIRT_TINTS.length]);
        }
      }
    }
    return new Actor(ch, talker);
  }

  get position() {
    return this.root.position;
  }

  place(x: number, z: number, rot: number, clip: Clip = 'idle', y = 0) {
    this.root.position.set(x, y, z);
    this.heading = rot;
    this.baseClip = clip;
    this.seatY = y;
    this.path = [];
    this.speed = 0;
    this.setLying(clip === 'lie');
  }

  setLying(v: boolean) {
    this.lying = v;
    this.root.rotation.order = 'YXZ';
    this.root.rotation.x = v ? -Math.PI / 2 : 0;
  }

  walk(path: THREE.Vector2[]) {
    this.path = path;
    this.pathIdx = 0;
    this.baseClip = 'idle';
  }

  faceTowards(x: number, z: number) {
    this.heading = Math.atan2(x - this.root.position.x, z - this.root.position.z);
  }

  update(dt: number, distToPlayer: number) {
    const p = this.root.position;
    if (this.path.length && this.pathIdx < this.path.length && this.talking <= 0) {
      const t = this.path[this.pathIdx];
      const dx = t.x - p.x;
      const dz = t.y - p.z;
      const d = Math.hypot(dx, dz);
      if (d < 0.4) this.pathIdx++;
      else {
        const want = Math.atan2(dx, dz);
        let dd = want - this.heading;
        dd = Math.atan2(Math.sin(dd), Math.cos(dd));
        this.heading += dd * Math.min(1, dt * 5);
        this.speed = 1.3;
        p.x += Math.sin(this.heading) * this.speed * dt;
        p.z += Math.cos(this.heading) * this.speed * dt;
      }
    } else {
      this.speed = 0;
    }
    this.root.rotation.y = this.heading;
    if (this.talking > 0) {
      this.talking -= dt;
      this.ch.pose = 'talk';
    } else {
      this.ch.pose = this.speed > 0.1 ? null : this.baseClip === 'idle' ? null : this.baseClip;
    }
    // animation LOD: full rate near, a few fps further, none far away
    const visible = distToPlayer < 90;
    this.root.visible = visible;
    if (!visible) return;
    const step = distToPlayer < 20 ? 0 : distToPlayer < 45 ? 1 / 15 : 1 / 6;
    this.animAcc += dt;
    if (this.animAcc >= step) {
      this.ch.update(this.animAcc, this.speed);
      this.animAcc = 0;
    }
  }
}
