import * as THREE from 'three';
import type { Character } from './Character';
import type { Input } from './Input';

const WALK = 1.45;
const RUN = 4.6;

/** What the player collides with: the city's buildings or a room's furniture. */
export interface Collider {
  resolve(x: number, z: number, r: number): [number, number];
  /** building index blocking the camera at (x, z), or -1 */
  inside(x: number, z: number): number;
  height(i: number): number;
}

/** Third-person movement + orbit camera with simple collision. */
export class Player {
  readonly position = new THREE.Vector3();
  heading = 0; // radians, 0 = facing +z
  speed = 0;
  yaw = Math.PI; // camera yaw around the player
  pitch = 0.32;
  distance = 5.5;
  /** while true, movement keys are ignored (sitting, sleeping...) */
  locked = false;
  /** height of the character's root (seats, beds) */
  rootY = 0;
  lying = false;
  minDistance = 2.2;
  maxDistance = 40;
  private camPos = new THREE.Vector3();

  constructor(
    readonly character: Character,
    readonly camera: THREE.PerspectiveCamera,
    readonly input: Input,
    public collider: Collider,
    public bounds: [number, number, number, number],
  ) {}

  teleport(x: number, z: number, opts: { free?: boolean } = {}) {
    let [px, pz] = [x, z];
    if (!opts.free) {
      // nudge out of buildings in case the spot is inside a footprint
      for (let r = 0; r < 60 && this.collider.inside(px, pz) >= 0; r += 3) {
        px = x + r;
        pz = z + r * 0.5;
      }
      [px, pz] = this.collider.resolve(px, pz, 0.4);
    }
    this.position.set(px, 0, pz);
    this.camPos.set(0, 0, 0);
  }

  /** true if the player pressed a movement key this frame (cancels activities) */
  wantsToMove() {
    const m = this.input.move();
    return Math.hypot(m.x, m.y) > 0.3;
  }

  update(dt: number) {
    const look = this.input.takeLook();
    this.yaw -= look.x * 0.005;
    this.pitch = THREE.MathUtils.clamp(this.pitch + look.y * 0.004, -0.15, 1.35);
    const k = this.input.keys;
    // Q and R turn the camera (E is the interact key)
    if (k.has('KeyQ')) this.yaw += dt * 1.8;
    if (k.has('KeyR')) this.yaw -= dt * 1.8;
    this.distance = THREE.MathUtils.clamp(this.distance * (1 + this.input.takeZoom() * 0.12), this.minDistance, this.maxDistance);

    const m = this.locked ? { x: 0, y: 0, run: false } : this.input.move();
    const mag = Math.hypot(m.x, m.y);
    const target = mag > 0.05 ? (m.run ? RUN : WALK) * Math.min(1, mag * 1.2) : 0;
    // ease speed so the gait blend never pops
    this.speed += (target - this.speed) * Math.min(1, dt * (target > this.speed ? 4 : 7));
    if (this.locked) this.speed = 0;
    if (mag > 0.05) {
      // camera-relative direction; camera looks along -(sin yaw, cos yaw)
      const fx = -Math.sin(this.yaw);
      const fz = -Math.cos(this.yaw);
      const rx = -fz;
      const rz = fx;
      const dx = fx * m.y + rx * m.x;
      const dz = fz * m.y + rz * m.x;
      const want = Math.atan2(dx, dz);
      let d = want - this.heading;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      this.heading += d * Math.min(1, dt * 10);
    }
    if (this.speed > 0.01) {
      const nx = this.position.x + Math.sin(this.heading) * this.speed * dt;
      const nz = this.position.z + Math.cos(this.heading) * this.speed * dt;
      let [px, pz] = this.collider.resolve(nx, nz, 0.35);
      const [x0, z0, x1, z1] = this.bounds;
      px = THREE.MathUtils.clamp(px, x0, x1);
      pz = THREE.MathUtils.clamp(pz, z0, z1);
      this.position.set(px, 0, pz);
    }
    const root = this.character.root;
    root.position.set(this.position.x, this.rootY, this.position.z);
    root.rotation.order = 'YXZ';
    root.rotation.y = this.heading;
    root.rotation.x = this.lying ? -Math.PI / 2 : 0;
    this.character.update(dt, this.speed);

    // orbit camera
    const headY = this.lying ? this.rootY + 0.3 : this.rootY + (this.character.pose?.startsWith('sit') ? 1.1 : 1.55);
    const head = new THREE.Vector3(this.position.x, headY, this.position.z);
    if (this.lying) {
      // look at the chest, not the feet
      head.x -= Math.sin(this.heading) * 0.9;
      head.z -= Math.cos(this.heading) * 0.9;
    }
    const cp = Math.cos(this.pitch);
    const want = new THREE.Vector3(
      head.x + Math.sin(this.yaw) * cp * this.distance,
      head.y + Math.sin(this.pitch) * this.distance,
      head.z + Math.cos(this.yaw) * cp * this.distance,
    );
    // keep the camera out of buildings: pull it in along the boom if blocked
    const steps = 10;
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const px = head.x + (want.x - head.x) * t;
      const pz = head.z + (want.z - head.z) * t;
      const py = head.y + (want.y - head.y) * t;
      const b = this.collider.inside(px, pz);
      if (b >= 0 && py < this.collider.height(b) + 0.5) {
        const tt = Math.max(0.12, (i - 1) / steps);
        want.set(head.x + (want.x - head.x) * tt, head.y + (want.y - head.y) * tt, head.z + (want.z - head.z) * tt);
        break;
      }
    }
    if (this.camPos.lengthSq() === 0) this.camPos.copy(want);
    this.camPos.lerp(want, Math.min(1, dt * 10));
    this.camera.position.copy(this.camPos);
    this.camera.lookAt(head.x, head.y - 0.1, head.z);
  }
}
