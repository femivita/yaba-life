import * as THREE from 'three';
import type { Collider } from '../player/Player';
import type { PlaceDef } from '../sim/Places';
import { buildRoom, type Room, type Seat } from './Rooms';

/** Walls and furniture as a collider; the camera is never blocked (walls cut away). */
export class RoomCollider implements Collider {
  constructor(private room: Room) {}

  resolve(x: number, z: number, r: number): [number, number] {
    const { W, D } = this.room;
    for (const b of this.room.colliders) {
      // push a circle out of an axis-aligned box
      const cx = Math.max(b.x0, Math.min(b.x1, x));
      const cz = Math.max(b.z0, Math.min(b.z1, z));
      const dx = x - cx;
      const dz = z - cz;
      const d = Math.hypot(dx, dz);
      if (d < r) {
        if (d > 1e-4) {
          x = cx + (dx / d) * r;
          z = cz + (dz / d) * r;
        } else {
          // centre inside the box: leave by the nearest side
          const opts = [[b.x0 - r - x, 0], [b.x1 + r - x, 0], [0, b.z0 - r - z], [0, b.z1 + r - z]];
          opts.sort((p, q) => Math.abs(p[0] + p[1]) - Math.abs(q[0] + q[1]));
          x += opts[0][0];
          z += opts[0][1];
        }
      }
    }
    const m = 0.1 + r;
    x = Math.max(-W / 2 + m, Math.min(W / 2 - m, x));
    // the door gap lets you step out through the front wall
    const inDoor = Math.abs(x) < 0.7;
    z = Math.max(-D / 2 + m, Math.min(D / 2 + (inDoor ? 0.6 : -m), z));
    return [x, z];
  }

  inside() {
    return -1;
  }

  height() {
    return 0;
  }
}

/** One loaded interior: its own scene, lights and room. */
export class InteriorScene {
  readonly scene = new THREE.Scene();
  readonly room: Room;
  readonly collider: RoomCollider;
  private time = 0;

  constructor(readonly place: PlaceDef) {
    this.room = buildRoom(place);
    this.scene.add(this.room.group);
    const dark = ['lounge', 'club', 'cinema'].includes(place.kind);
    this.scene.background = new THREE.Color(dark ? 0x07070b : 0x1c1a18);
    this.scene.fog = new THREE.Fog(this.scene.background as THREE.Color, 18, 40);
    this.collider = new RoomCollider(this.room);
    this.room.group.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) {
        o.updateMatrix();
      }
    });
  }

  get bounds(): [number, number, number, number] {
    const { W, D } = this.room;
    return [-W / 2, -D / 2, W / 2, D / 2 + 0.7];
  }

  /** hide the walls between the camera and the room (The Sims' "walls cutaway") */
  update(dt: number, camera: THREE.Camera, light: boolean) {
    this.time += dt;
    for (const w of this.room.walls) {
      const p = w.mesh.position;
      const toCam = (camera.position.x - p.x) * w.nx + (camera.position.z - p.z) * w.nz;
      w.mesh.visible = toCam < 0.2;
    }
    this.room.update(dt, this.time, light);
  }

  /** free seat closest to (x, z), preferring a group */
  freeSeat(x: number, z: number, group?: string, kind?: Seat['kind']) {
    let best: Seat | null = null;
    let bd = Infinity;
    const seats = this.room.seats.filter((s) => !s.taken && (!kind || s.kind === kind));
    const pool = group && seats.some((s) => s.group === group) ? seats.filter((s) => s.group === group) : seats.filter((s) => s.kind !== 'bed');
    for (const s of kind === 'bed' ? seats : pool) {
      const d = Math.hypot(s.x - x, s.z - z);
      if (d < bd) {
        bd = d;
        best = s;
      }
    }
    return best;
  }

  dispose() {
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh && !(m as THREE.SkinnedMesh).isSkinnedMesh) m.geometry.dispose();
    });
  }
}
