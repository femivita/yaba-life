import * as THREE from 'three';
import type { Clip } from '../player/Character';
import type { PlaceDef, Tag } from '../sim/Places';
import * as K from './Kit';

export interface RoomObject {
  tag: Tag;
  label: string;
  x: number;
  z: number;
  r: number;
}

export interface Seat {
  x: number;
  z: number;
  rot: number;
  kind: 'chair' | 'bed' | 'stand';
  group?: Tag;
  y?: number;
  taken?: boolean;
}

export interface Spot {
  x: number;
  z: number;
  rot: number;
  clip: Clip;
}

export interface Box2 {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
}

export interface Room {
  group: THREE.Group;
  W: number;
  D: number;
  H: number;
  objects: RoomObject[];
  seats: Seat[];
  /** where staff stand (behind counters, at stalls) */
  staff: Spot[];
  colliders: Box2[];
  walls: { mesh: THREE.Object3D; nx: number; nz: number }[];
  /** spawn point just inside the door; the door is on the +z wall */
  entry: { x: number; z: number };
  update: (dt: number, t: number, light: boolean) => void;
}

const H = 3.2;

function tileTex(color: number, lines = 0x000000, size = 8) {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const col = new THREE.Color(color);
  g.fillStyle = `#${col.getHexString()}`;
  g.fillRect(0, 0, 64, 64);
  for (let i = 0; i < 40; i++) {
    g.fillStyle = `rgba(${Math.random() < 0.5 ? '0,0,0' : '255,255,255'},0.04)`;
    g.fillRect(Math.random() * 64, Math.random() * 64, 6, 6);
  }
  g.strokeStyle = `#${new THREE.Color(lines).getHexString()}`;
  g.globalAlpha = 0.25;
  g.lineWidth = 2;
  g.strokeRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(size, size);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Shell: floor, four walls (the camera-side ones cut away), door, lights. */
function shell(place: PlaceDef, W: number, D: number, opts: { dark?: boolean } = {}) {
  const th = place.theme ?? { wall: 0xe0d6c0, floor: 0x8a7a66, accent: 0x0f8a4f };
  const group = new THREE.Group();
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(W, D), new THREE.MeshLambertMaterial({ map: tileTex(th.floor, 0x000000, Math.round(W / 1.2)) }));
  floor.rotation.x = -Math.PI / 2;
  group.add(floor);
  // ground outside the walls so the cutaway never shows the void
  const yard = new THREE.Mesh(new THREE.PlaneGeometry(W + 30, D + 30), new THREE.MeshLambertMaterial({ color: opts.dark ? 0x101014 : 0x6f6658 }));
  yard.rotation.x = -Math.PI / 2;
  yard.position.y = -0.02;
  group.add(yard);
  const wallMat = new THREE.MeshLambertMaterial({ color: th.wall });
  const skirt = new THREE.MeshLambertMaterial({ color: new THREE.Color(th.wall).multiplyScalar(0.6) });
  const walls: Room['walls'] = [];
  const mkWall = (len: number, x: number, z: number, rot: number, nx: number, nz: number, door = false) => {
    const g = new THREE.Group();
    if (door) {
      const side = (len - 1.6) / 2;
      g.add(K.box(side, H, 0.15, wallMat, -len / 2 + side / 2, 0, 0), K.box(side, H, 0.15, wallMat, len / 2 - side / 2, 0, 0), K.box(1.6, H - 2.4, 0.15, wallMat, 0, 2.4, 0));
      // door leaf left open
      const leaf = K.box(0.06, 2.3, 0.85, 0x6e4b2a, -0.78, 0, 0.45);
      g.add(leaf);
    } else {
      g.add(K.box(len, H, 0.15, wallMat));
    }
    g.add(K.box(len, 0.25, 0.17, skirt, 0, 0, 0));
    g.position.set(x, 0, z);
    g.rotation.y = rot;
    group.add(g);
    walls.push({ mesh: g, nx, nz });
  };
  mkWall(W, 0, -D / 2, 0, 0, -1);
  mkWall(W, 0, D / 2, 0, 0, 1, true);
  mkWall(D, -W / 2, 0, Math.PI / 2, -1, 0);
  mkWall(D, W / 2, 0, Math.PI / 2, 1, 0);
  const hemi = new THREE.HemisphereLight(opts.dark ? 0x6c5ce7 : 0xfff6e8, opts.dark ? 0x1a1020 : 0x6b5a45, opts.dark ? 0.5 : 1.25);
  const lamp = new THREE.PointLight(opts.dark ? 0xff77cc : 0xffe2b8, opts.dark ? 6 : 10, Math.max(W, D) * 1.6, 1.3);
  lamp.position.set(0, H - 0.3, 0);
  group.add(hemi, lamp);
  const room: Room = {
    group, W, D, H, objects: [], seats: [], staff: [], colliders: [], walls,
    entry: { x: 0, z: D / 2 - 1.7 },
    update: () => {},
  };
  return { room, th, lamp };
}

/** add an object as a collider (axis-aligned footprint after rotation by multiples of 90°) */
function solid(room: Room, o: THREE.Object3D, w: number, d: number) {
  room.group.add(o);
  const swap = Math.abs(Math.sin(o.rotation.y)) > 0.5;
  const hw = (swap ? d : w) / 2;
  const hd = (swap ? w : d) / 2;
  room.colliders.push({ x0: o.position.x - hw, x1: o.position.x + hw, z0: o.position.z - hd, z1: o.position.z + hd });
}

function chairAt(room: Room, x: number, z: number, rot: number, color: number, group?: Tag) {
  const c = K.place(K.plasticChair(color), x, z, rot);
  room.group.add(c);
  room.seats.push({ x, z, rot, kind: 'chair', group });
}

/** table with chairs around it (all facing the table) */
function tableSet(room: Room, x: number, z: number, chair: number, table: number, n = 4, group?: Tag, food = false) {
  const t = K.place(K.plasticTable(table), x, z);
  solid(room, t, 0.9, 0.9);
  const pos: [number, number, number][] = [[0, -0.75, 0], [0, 0.75, Math.PI], [-0.75, 0, Math.PI / 2], [0.75, 0, -Math.PI / 2]];
  for (let i = 0; i < n; i++) {
    const [dx, dz, r] = pos[i];
    chairAt(room, x + dx, z + dz, r, chair, group);
  }
  if (food) room.group.add(K.plate(x + 0.15, 0.76, z - 0.1), K.bottles(2, x - 0.1, 0.76, z + 0.1));
}

function obj(room: Room, tag: Tag, label: string, x: number, z: number, r = 1.4) {
  room.objects.push({ tag, label, x, z, r });
}

function menuBoard(room: Room, place: PlaceDef, x: number, z: number, rot = 0) {
  const items = Object.values(place.offers).flat().filter((o) => o.price && o.id !== 'toilet').slice(0, 6);
  const lines = items.map((o) => `${o.label.length > 22 ? o.label.slice(0, 21) + '…' : o.label}|₦${o.price!.toLocaleString('en-NG')}`);
  const tex = K.textBoard(lines, { title: place.sign ?? place.name, font: 26 });
  const p = K.plane(2.2, 1.65, tex, x, 2.0, z, rot);
  room.group.add(p);
}

function sign(room: Room, text: string, color: string, x: number, y0: number, z: number, rot = 0, w = 3) {
  const y = Math.min(y0, H - 0.1 - w / 8);
  room.group.add(K.plane(w, w / 4, K.textBoard([], { title: text, bg: color, w: 512, h: 128, font: 48 }), x, y, z, rot, true));
}

function toiletDoor(room: Room, x: number, price: number) {
  const D = room.D;
  room.group.add(K.box(0.9, 2.1, 0.05, 0x5d6d7e, x, 0, -D / 2 + 0.1));
  sign(room, price ? `TOILET ₦${price}` : 'TOILET', '#34495e', x, 2.35, -D / 2 + 0.14, 0, 1.1);
  obj(room, 'toilet', 'Toilet', x, -D / 2 + 0.7, 1.1);
}

// ---------------------------------------------------------------------------

export function buildRoom(place: PlaceDef): Room {
  switch (place.kind) {
    case 'home': return home(place);
    case 'buka': case 'restaurant': case 'cafe': return eatery(place);
    case 'bar': return bar(place);
    case 'lounge': case 'club': return lounge(place);
    case 'cinema': return cinema(place);
    case 'market': return market(place);
    case 'supermarket': return supermarket(place);
    case 'office': return office(place);
    case 'campus': return library(place);
    case 'hospital': return hospital(place);
    case 'hotel': return hotel(place);
  }
}

function home(place: PlaceDef): Room {
  const W = 7;
  const D = 5.6;
  const { room } = shell(place, W, D);
  const g = room.group;
  // bed with ankara sheet, back-left
  const b = K.place(K.bed(K.ankaraTex([0x1f6f5c, 0xf4b41a, 0xc0392b, 0xfdf2e9], 3)), -2.55, -1.6);
  solid(room, b, 1.35, 2.0);
  room.seats.push({ x: -2.55, z: -0.75, rot: Math.PI, kind: 'bed', group: 'bed', y: 0.6 });
  obj(room, 'bed', 'Bed', -1.7, -1.4, 1.4);
  solid(room, K.place(K.wardrobe(), -3.15, 1.0, Math.PI / 2), 1.0, 0.55);
  g.add(K.place(K.standingFan(), -1.6, -2.4));
  // bathroom corner behind a half wall: bucket and toilet
  g.add(K.box(0.12, 2.0, 2.0, 0xbfc9ca, 1.9, 0, -1.7));
  g.add(K.place(K.bucket(), 2.55, -2.3), K.place(K.bucket(0xe74c3c), 2.2, -2.45));
  obj(room, 'shower', 'Bucket bath', 2.5, -2.0, 1.1);
  solid(room, K.place(K.toiletBowl(), 3.15, -1.2, -Math.PI / 2), 0.55, 0.45);
  obj(room, 'toilet', 'Toilet', 2.7, -1.1, 0.9);
  // kitchen corner by the door: gas cooker, fridge, foodstuff carton
  solid(room, K.place(K.gasCooker(), 3.1, 0.6, -Math.PI / 2), 0.6, 0.55);
  obj(room, 'stove', 'Gas cooker', 2.5, 0.6, 1.1);
  solid(room, K.place(K.fridge(), 3.15, 1.5, -Math.PI / 2), 0.6, 0.6);
  obj(room, 'fridge', 'Fridge', 2.6, 1.6, 0.9);
  g.add(K.box(0.4, 0.3, 0.3, 0xc0392b, 2.2, 0, 2.3));
  // desk with laptop
  const desk = K.place(K.laptopDesk(), 0.2, -2.35);
  solid(room, desk, 1.2, 0.6);
  chairAt(room, 0.2, -1.7, Math.PI, 0x2e86c1, 'desk');
  obj(room, 'desk', 'Laptop desk', 0.2, -1.6, 1.0);
  // small TV on a stool facing the bed side
  const screen = new THREE.MeshBasicMaterial({ color: 0x223344 });
  const nolly = nollywoodScreen();
  const t = K.place(K.group(K.box(0.6, 0.55, 0.4, 0x5d4037), K.place(K.tv(screen, 0.8), 0, 0, 0, 0.55)), -0.6, 2.35, Math.PI);
  solid(room, t, 0.6, 0.4);
  chairAt(room, -0.6, 0.9, 0, 0xc0392b, 'tv');
  obj(room, 'tv', 'TV', -0.6, 1.5, 1.2);
  // mirror by the door
  g.add(K.box(0.5, 0.9, 0.04, 0xaed6f1, 1.35, 1.1, -D / 2 + 0.1));
  obj(room, 'mirror', 'Mirror', 1.35, -D / 2 + 0.8, 0.8);
  // rent book and the shared generator switch on the side wall
  g.add(K.box(0.05, 0.5, 0.35, 0xf5cba7, -W / 2 + 0.1, 1.2, -0.05));
  obj(room, 'door_landlord', 'Rent book & generator', -W / 2 + 0.8, -0.05, 0.9);
  g.add(K.wallPoster('BURNA BOY', 'LIVE · EKO HOTEL', '#8e44ad', 0.7, 0.95).translateX(-2.2).translateY(1.8).translateZ(-D / 2 + 0.09));
  const fan = new K.CeilingFan(H);
  g.add(fan.group);
  room.update = (dt, time, light) => {
    fan.update(dt, light);
    screen.map = light ? nolly.tex : null;
    screen.color.set(light ? 0xffffff : 0x111111);
    if (light) nolly.update(time);
  };
  return room;
}

function nollywoodScreen() {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 72;
  const g = c.getContext('2d')!;
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  let last = -1;
  return {
    tex,
    update(t: number) {
      const shot = Math.floor(t / 2.5);
      if (shot === last) return;
      last = shot;
      const hues = [20, 35, 200, 280, 10, 120];
      const h = hues[shot % hues.length];
      const grd = g.createLinearGradient(0, 0, 0, 72);
      grd.addColorStop(0, `hsl(${h},50%,55%)`);
      grd.addColorStop(1, `hsl(${h + 20},40%,25%)`);
      g.fillStyle = grd;
      g.fillRect(0, 0, 128, 72);
      // two figures arguing: classic Nollywood family drama
      for (const [x, col] of [[40, '#3b2416'], [86, '#2a1a10']] as const) {
        g.fillStyle = col;
        g.beginPath();
        g.arc(x, 30, 9, 0, Math.PI * 2);
        g.fill();
        g.fillRect(x - 12, 40, 24, 32);
      }
      g.fillStyle = '#fff';
      g.font = '700 8px system-ui';
      g.fillText(shot % 2 ? '"Who is this woman?!"' : '"Mama, I can explain!"', 8, 68);
      tex.needsUpdate = true;
    },
  };
}

function eatery(place: PlaceDef): Room {
  const W = place.kind === 'cafe' ? 8 : 9;
  const D = 7;
  const { room, th } = shell(place, W, D);
  const g = room.group;
  const isBuka = place.kind === 'buka';
  // serving counter along the back wall with pots (buka) or a glass display
  const c = K.place(K.counter(4.2, isBuka ? 0x5d4037 : 0x7b5b3a, isBuka ? 0xbdc3c7 : 0xf5f5f5), -1.2, -D / 2 + 1.3);
  solid(room, c, 4.3, 0.7);
  if (isBuka) {
    [-2.8, -1.9, -1.0, -0.1].forEach((x, i) => g.add(K.place(K.bigPot([0x95a5a6, 0x7f8c8d, 0xb3b6b7, 0x839192][i], 0.24), x, -D / 2 + 1.3, 0, 1.05)));
    g.add(K.place(K.cooler(), 0.9, -D / 2 + 1.3, 0, 1.05));
    g.add(K.place(K.cooler(0xc0392b), -3.5, -D / 2 + 0.5));
  } else {
    g.add(K.box(2.4, 0.4, 0.5, new THREE.MeshLambertMaterial({ color: 0xd6eaf8, transparent: true, opacity: 0.55 }), -1.2, 1.05, -D / 2 + 1.3));
    for (let i = 0; i < 6; i++) g.add(K.plate(-2.2 + i * 0.4, 1.06, -D / 2 + 1.3, [0xd35400, 0xf4d03f, 0x6e2c00][i % 3]));
  }
  room.staff.push({ x: -1.2, z: -D / 2 + 0.6, rot: 0, clip: 'work' });
  obj(room, 'counter', isBuka ? 'Order food' : 'Order', -1.2, -D / 2 + 2.2, 1.6);
  menuBoard(room, place, 2.2, -D / 2 + 0.09);
  toiletDoor(room, W / 2 - 0.9, isBuka ? 100 : 0);
  // seating: benches + wooden tables for a buka, plastic sets otherwise
  if (isBuka) {
    for (const z of [0.2, 2.2]) {
      for (const x of [-2.4, 1.6]) {
        const t = K.place(K.woodTable(2.0, 0.7), x, z);
        solid(room, t, 2.0, 0.7);
        g.add(K.place(K.bench(2.0), x, z - 0.6), K.place(K.bench(2.0), x, z + 0.6));
        for (const dx of [-0.5, 0.5]) {
          room.seats.push({ x: x + dx, z: z - 0.6, rot: 0, kind: 'chair' });
          room.seats.push({ x: x + dx, z: z + 0.6, rot: Math.PI, kind: 'chair' });
        }
        g.add(K.plate(x - 0.3, 0.78, z), K.bottles(1, x + 0.4, 0.78, z));
      }
    }
  } else {
    const chairCol = place.kind === 'cafe' ? 0x2c3e50 : th.accent;
    for (const [x, z] of [[-2.6, 0.4], [0.2, 0.4], [2.8, 0.4], [-1.2, 2.3], [1.6, 2.3]]) tableSet(room, x, z, chairCol, 0xf8f9f9, 4, undefined, true);
    g.add(K.place(K.plant(), W / 2 - 0.5, D / 2 - 0.6), K.place(K.plant(), -W / 2 + 0.5, D / 2 - 0.6));
  }
  const fans = [new K.CeilingFan(H), new K.CeilingFan(H)];
  fans[0].group.position.x = -2;
  fans[1].group.position.x = 2;
  g.add(fans[0].group, fans[1].group);
  room.update = (dt) => fans.forEach((f) => f.update(dt, true));
  return room;
}

function bar(place: PlaceDef): Room {
  const W = 10;
  const D = 8;
  const { room, th } = shell(place, W, D);
  const g = room.group;
  // bar counter along the left wall with a drinks shelf and fridge
  const c = K.place(K.counter(4.5, 0x4e342e, 0x212121), -W / 2 + 1.2, -0.6, Math.PI / 2);
  solid(room, c, 4.6, 0.7);
  g.add(K.place(K.shelf(2, 3, [0x6e3b0a, 0x1e8449, 0xb7950b, 0x922b21]), -W / 2 + 0.3, -0.6, Math.PI / 2));
  g.add(K.place(K.fridge(), -W / 2 + 0.5, 2.4, Math.PI / 2), K.bottles(5, -W / 2 + 1.2, 1.02, -0.6));
  room.staff.push({ x: -W / 2 + 0.6, z: -0.6, rot: Math.PI / 2, clip: 'work' });
  obj(room, 'counter', 'Bar counter', -W / 2 + 2.1, -0.6, 1.8);
  // big TV on the back wall showing the match
  const match = new K.FootballScreen();
  const screen = new THREE.MeshBasicMaterial({ map: match.texture });
  g.add(K.place(K.tv(screen, 2.4), 1, -D / 2 + 0.15, 0, 1.3));
  obj(room, 'tv', 'Big screen (football)', 1, -0.6, 2.4);
  sign(room, place.sign ?? place.name, `#${th.accent.toString(16).padStart(6, '0')}`, 1, 2.95, -D / 2 + 0.1, 0, 3.4);
  g.add(K.wallPoster('TEN STAR LAGER', 'ICE COLD', '#b03a2e').translateX(4.2).translateY(1.7).translateZ(-D / 2 + 0.09));
  g.add(K.plane(1.4, 1.0, K.textBoard(['ARS vs CHE  8pm', 'MUN vs LIV  Sat', 'Pepper soup ready'], { title: 'TONIGHT', bg: '#1b2631', font: 28 }), W / 2 - 0.09, 1.7, 1.5, -Math.PI / 2));
  // plastic table sets facing the TV
  const chairCols = [0xc0392b, 0xecf0f1];
  for (const [x, z] of [[-1.4, 0.6], [1.4, 0.6], [3.8, 0.6], [0, 2.8], [2.6, 2.8]]) {
    const t = K.place(K.plasticTable(0xecf0f1), x, z);
    solid(room, t, 0.9, 0.9);
    g.add(K.bottles(3, x, 0.76, z));
    // chairs on the sides and front, all angled at the TV
    for (const [dx, dz] of [[-0.7, 0.1], [0.7, 0.1], [0, 0.75]]) {
      const rot = Math.atan2(1 - (x + dx), -D / 2 - (z + dz));
      chairAt(room, x + dx, z + dz, rot, chairCols[(dx > 0 ? 1 : 0)], 'tv');
    }
  }
  toiletDoor(room, W / 2 - 0.9, 0);
  g.add(K.place(K.cooler(), W / 2 - 0.5, 3.2), K.place(K.speaker(), -W / 2 + 0.5, -D / 2 + 0.5));
  const fans = [new K.CeilingFan(H), new K.CeilingFan(H)];
  fans[0].group.position.set(-1, 0, 0.5);
  fans[1].group.position.set(2.8, 0, 0.5);
  g.add(fans[0].group, fans[1].group);
  room.update = (dt) => {
    match.update(dt);
    fans.forEach((f) => f.update(dt, true));
  };
  return room;
}

function lounge(place: PlaceDef): Room {
  const club = place.kind === 'club';
  const W = club ? 12 : 10;
  const D = club ? 10 : 8;
  const { room, th, lamp } = shell(place, W, D, { dark: true });
  const g = room.group;
  const accent = new THREE.Color(th.accent);
  // neon strips along the walls
  const neon = new THREE.MeshBasicMaterial({ color: accent });
  g.add(K.box(W - 0.4, 0.05, 0.05, neon, 0, 2.7, -D / 2 + 0.12), K.box(0.05, 0.05, D - 0.4, neon, -W / 2 + 0.12, 2.7, 0), K.box(0.05, 0.05, D - 0.4, neon, W / 2 - 0.12, 2.7, 0));
  sign(room, place.sign ?? place.name.toUpperCase(), '#111', 0, 2.95, -D / 2 + 0.1, 0, 3.6);
  // bar on the right
  const c = K.place(K.counter(4, 0x111111, 0x222222), W / 2 - 1.2, -0.5, -Math.PI / 2);
  solid(room, c, 4.1, 0.7);
  g.add(K.box(0.05, 0.05, 4, neon, W / 2 - 1.55, 0.95, -0.5));
  g.add(K.place(K.shelf(5, 3, [0x5dade2, 0xf5b041, 0xec7063, 0xaf7ac5]), W / 2 - 0.3, -0.5, -Math.PI / 2));
  room.staff.push({ x: W / 2 - 0.6, z: -0.5, rot: -Math.PI / 2, clip: 'work' });
  obj(room, 'counter', club ? 'Bar & gate' : 'Bar', W / 2 - 2.1, -0.5, 1.8);
  // DJ booth and speakers on the back wall
  solid(room, K.place(K.group(K.box(2.2, 1.0, 0.8, 0x1c1c1c), K.box(2.2, 0.05, 0.8, neon, 0, 1.0, 0)), -1, -D / 2 + 0.8), 2.2, 0.8);
  room.staff.push({ x: -1, z: -D / 2 + 0.2, rot: 0, clip: 'dance' });
  g.add(K.place(K.speaker(), -2.8, -D / 2 + 0.5), K.place(K.speaker(), 0.8, -D / 2 + 0.5));
  // dance floor with lit tiles
  const tiles: THREE.MeshBasicMaterial[] = [];
  const fx = -1;
  const fz = club ? 0 : 0.2;
  const n = club ? 5 : 3;
  for (let i = 0; i < n; i++)
    for (let j = 0; j < n; j++) {
      const m = new THREE.MeshBasicMaterial({ color: 0x222222 });
      tiles.push(m);
      const t = new THREE.Mesh(new THREE.PlaneGeometry(0.95, 0.95), m);
      t.rotation.x = -Math.PI / 2;
      t.position.set(fx + (i - (n - 1) / 2), 0.01, fz + (j - (n - 1) / 2));
      g.add(t);
    }
  obj(room, 'dance', 'Dance floor', fx, fz, n * 0.6);
  for (let i = 0; i < (club ? 8 : 5); i++) {
    const a = (i / (club ? 8 : 5)) * Math.PI * 2;
    room.seats.push({ x: fx + Math.cos(a) * (n * 0.35), z: fz + Math.sin(a) * (n * 0.35), rot: a + Math.PI, kind: 'stand', group: 'dance' });
  }
  // sofas with low tables and shisha along the left wall and front
  const sofaCol = new THREE.Color(th.accent).multiplyScalar(0.35).getHex();
  for (const z of club ? [-2.5, 0.5, 3.0] : [-2, 1.2]) {
    const s = K.place(K.sofa(sofaCol, 2.2), -W / 2 + 0.6, z, Math.PI / 2);
    solid(room, s, 2.2, 0.85);
    room.seats.push({ x: -W / 2 + 0.75, z: z - 0.5, rot: Math.PI / 2, kind: 'chair' }, { x: -W / 2 + 0.75, z: z + 0.5, rot: Math.PI / 2, kind: 'chair' });
    const t = K.place(K.group(K.box(0.8, 0.4, 0.8, 0x222222), K.place(K.shisha(), 0, 0, 0, 0.4)), -W / 2 + 1.8, z);
    solid(room, t, 0.8, 0.8);
  }
  for (const x of [2, 3.8].slice(0, club ? 2 : 1)) {
    const s = K.place(K.sofa(sofaCol, 2.2), x, D / 2 - 1.2, Math.PI);
    solid(room, s, 2.2, 0.85);
    room.seats.push({ x: x - 0.5, z: D / 2 - 1.35, rot: Math.PI, kind: 'chair' }, { x: x + 0.5, z: D / 2 - 1.35, rot: Math.PI, kind: 'chair' });
  }
  toiletDoor(room, W / 2 - 0.9, 0);
  // two coloured moving lights
  const l1 = new THREE.PointLight(0xff3b8d, 8, 9, 1.5);
  const l2 = new THREE.PointLight(0x2dd4ff, 8, 9, 1.5);
  g.add(l1, l2);
  lamp.intensity = 3;
  const palette = [0xff3b8d, 0x2dd4ff, 0xf1c40f, 0x8e44ad, 0x2ecc71, th.accent];
  let acc = 0;
  room.update = (dt, t) => {
    l1.position.set(fx + Math.cos(t * 1.3) * 2.5, 2.6, fz + Math.sin(t * 1.1) * 2);
    l2.position.set(fx + Math.cos(t * 0.9 + 2) * 2.5, 2.6, fz + Math.sin(t * 1.4 + 1) * 2);
    acc += dt;
    if (acc > 0.45) {
      acc = 0;
      tiles.forEach((m) => m.color.setHex(Math.random() < 0.5 ? palette[Math.floor(Math.random() * palette.length)] : 0x1a1a1a));
    }
  };
  return room;
}

function cinema(place: PlaceDef): Room {
  const W = 12;
  const D = 10;
  const { room, lamp } = shell(place, W, D, { dark: true });
  const g = room.group;
  lamp.intensity = 4;
  lamp.color.set(0xffd8a8);
  // the screen: a slow-moving film
  const film = nollywoodScreen();
  const scr = new THREE.Mesh(new THREE.PlaneGeometry(7, 3), new THREE.MeshBasicMaterial({ map: film.tex }));
  scr.position.set(0, 1.75, -D / 2 + 0.12);
  g.add(scr);
  sign(room, 'OZONE CINEMAS', '#b71c1c', 0, 3.0, -D / 2 + 0.1, 0, 3);
  obj(room, 'screen', 'Cinema screen', 0, -0.2, 3.5);
  // rows of red seats facing the screen
  const red = 0xa93226;
  for (const z of [-1.2, 0.3]) {
    for (let i = 0; i < 6; i++) {
      const x = -3 + i * 1.0;
      const s = K.place(K.group(K.box(0.7, 0.45, 0.6, red), K.box(0.7, 0.6, 0.12, red, 0, 0.45, 0.25)), x, z, Math.PI);
      g.add(s);
      room.seats.push({ x, z: z - 0.05, rot: Math.PI, kind: 'chair', group: 'screen' });
    }
    room.colliders.push({ x0: -3.5, x1: 2.5, z0: z - 0.35, z1: z + 0.35 });
  }
  // concession stand near the door with a popcorn machine and posters
  const c = K.place(K.counter(3, 0x7b241c, 0xf2f3f4), -W / 2 + 2, D / 2 - 2.4);
  solid(room, c, 3.1, 0.7);
  g.add(K.place(K.group(K.box(0.5, 0.6, 0.4, 0xf7dc6f), K.box(0.52, 0.06, 0.42, 0xc0392b, 0, 0.6, 0)), -W / 2 + 1.2, D / 2 - 2.4, 0, 1.05));
  room.staff.push({ x: -W / 2 + 2, z: D / 2 - 3.1, rot: 0, clip: 'idle' });
  obj(room, 'counter', 'Snacks counter', -W / 2 + 2, D / 2 - 1.6, 1.5);
  g.add(K.wallPoster('LAGOS LOVE STORY', 'NOW SHOWING', '#6c3483', 1.0, 1.4).translateX(W / 2 - 0.09).translateY(1.6).translateZ(1).rotateY(-Math.PI / 2));
  g.add(K.wallPoster('OWAMBE WAHALA', 'COMING SOON', '#1f618d', 1.0, 1.4).translateX(W / 2 - 0.09).translateY(1.6).translateZ(2.5).rotateY(-Math.PI / 2));
  toiletDoor(room, W / 2 - 0.9, 0);
  room.update = (_dt, t) => film.update(t);
  return room;
}

function market(place: PlaceDef): Room {
  const W = 13;
  const D = 10;
  const { room, th } = shell(place, W, D);
  const g = room.group;
  // stalls: okrika racks, bend-down-select piles, fabric bolts, provisions
  let seed = 1;
  for (const [x, z, rot] of [[-4.5, -2.8, 0], [-1.5, -2.8, 0], [1.5, -2.8, 0]] as const) {
    const r = K.place(K.clothesRack(seed++), x, z, rot);
    solid(room, r, 2.2, 0.5);
    room.staff.push({ x, z: z - 0.7, rot: 0, clip: 'talk' });
  }
  obj(room, 'rack', 'Okrika clothes', -1.5, -1.8, 4);
  for (const [x, z] of [[-3.5, 0.6], [0.5, 0.6]]) g.add(K.place(K.clothesPile(seed++), x, z));
  room.colliders.push({ x0: -4.3, x1: -2.7, z0: 0, z1: 1.2 }, { x0: -0.3, x1: 1.3, z0: 0, z1: 1.2 });
  room.seats.push({ x: -3.5, z: 1.4, rot: Math.PI, kind: 'stand', group: 'rack' }, { x: 0.5, z: 1.4, rot: Math.PI, kind: 'stand', group: 'rack' });
  // fabric (ankara) bolts stacked on a table
  const fab = K.place(K.woodTable(1.8, 0.8, 0x6e4b2a), 4.2, -2.8);
  solid(room, fab, 1.8, 0.8);
  for (let i = 0; i < 6; i++) {
    const tex = K.ankaraTex([[0xc0392b, 0x1f6f5c, 0x2c3e50, 0x8e44ad, 0xd35400, 0x16a085][i], 0xf4d03f, 0xfdfefe, 0x111111], i + 2);
    const bolt = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.7, 10), new THREE.MeshLambertMaterial({ map: tex }));
    bolt.rotation.z = Math.PI / 2;
    bolt.position.set(3.7 + (i % 3) * 0.0, 0.85 + Math.floor(i / 3) * 0.2, -3.1 + (i % 3) * 0.22);
    bolt.position.x = 3.9 + Math.floor(i / 3) * 0.7;
    g.add(bolt);
  }
  room.staff.push({ x: 4.2, z: -3.6, rot: 0, clip: 'idle' });
  // provisions stall: rice bags, Indomie cartons, crates of eggs
  const prov = K.place(K.counter(2.6, 0x8d6e63, 0xd7ccc8), 4, 1.2, -Math.PI / 2);
  solid(room, prov, 2.6, 0.7);
  for (let i = 0; i < 5; i++) g.add(K.box(0.45, 0.3, 0.32, i % 2 ? 0xf1c40f : 0xe74c3c, 4.75, i * 0.31, 0.2 + (i % 2) * 0.1));
  g.add(K.box(0.55, 0.7, 0.4, 0xecf0f1, 4.8, 0, 2.0), K.box(0.55, 0.7, 0.4, 0xecf0f1, 4.8, 0, 2.5));
  room.staff.push({ x: 4.8, z: 1.2, rot: -Math.PI / 2, clip: 'talk' });
  obj(room, 'counter', 'Provisions stall', 3.1, 1.2, 1.6);
  // beach umbrellas give the open-market feel
  for (const [x, z, c] of [[-4.5, -1.5, 0xe74c3c], [1.5, -1.5, 0x3498db]] as const) {
    const u = K.group(K.cyl(0.03, 0.03, 2.4, 0xdddddd), new THREE.Mesh(new THREE.ConeGeometry(1.3, 0.5, 8, 1, true), new THREE.MeshLambertMaterial({ color: c, side: THREE.DoubleSide })).translateY(2.5));
    g.add(K.place(u, x, z));
  }
  sign(room, place.name.toUpperCase(), `#${th.accent.toString(16).padStart(6, '0')}`, 0, 2.9, -D / 2 + 0.1, 0, 4.5);
  g.add(K.plane(1.6, 1.0, K.textBoard(['Okrika shirt|₦2,500', 'Jeans (1st grade)|₦5,000', 'Ankara 6 yards|₦9,000'], { title: 'PRICES', font: 26 }), -W / 2 + 0.09, 1.6, 0, Math.PI / 2));
  if (place.offers.toilet) toiletDoor(room, W / 2 - 0.9, 100);
  return room;
}

function supermarket(place: PlaceDef): Room {
  const W = 12;
  const D = 9;
  const { room, th } = shell(place, W, D);
  for (let i = 0; i < 3; i++) {
    const s = K.place(K.shelf(i + 3, 3.5), -2.5 + i * 2.6, -1.2, Math.PI / 2);
    solid(room, s, 3.5, 0.5);
  }
  obj(room, 'shelf', 'Shelves', 0, -1.2, 3.5);
  const c = K.place(K.counter(2.2, 0xecf0f1, 0x2c3e50), 3.6, 2.3, -Math.PI / 2);
  solid(room, c, 2.2, 0.7);
  room.staff.push({ x: 4.3, z: 2.3, rot: -Math.PI / 2, clip: 'idle' });
  obj(room, 'counter', 'Checkout', 2.8, 2.3, 1.6);
  sign(room, place.name.toUpperCase(), `#${th.accent.toString(16).padStart(6, '0')}`, 0, 2.9, -D / 2 + 0.1, 0, 4.2);
  for (let i = 0; i < 4; i++) room.seats.push({ x: -3.6 + i * 2.6, z: 1.4, rot: Math.PI, kind: 'stand', group: 'shelf' });
  return room;
}

function office(place: PlaceDef): Room {
  const W = 12;
  const D = 9;
  const { room, th } = shell(place, W, D);
  const g = room.group;
  const green = `#${th.accent.toString(16).padStart(6, '0')}`;
  sign(room, 'CcHUB', green, -3, 2.7, -D / 2 + 0.1, 0, 2.4);
  g.add(K.plane(2.6, 0.5, K.textBoard([], { title: 'JOLLOF LABS', bg: '#f39c12', w: 512, h: 100, font: 40 }), 2.5, 2.75, -D / 2 + 0.1, 0, true));
  // open-plan desks with laptops
  for (const [x, z] of [[-3.5, -2.4], [-1.8, -2.4], [1.2, -2.4], [2.9, -2.4], [-3.5, 0.0], [-1.8, 0.0]]) {
    const d = K.place(K.laptopDesk(0xf0f0f0), x, z, Math.PI);
    solid(room, d, 1.2, 0.6);
    chairAt(room, x, z + 0.65, Math.PI, 0x2c3e50, 'desk');
  }
  obj(room, 'desk', 'Desks', -1.2, -1.2, 3.2);
  // meetup corner: projector screen, rows of chairs
  const proj = K.plane(2.4, 1.4, K.textBoard(['• Building for Naija', '• Payments 101', '• Pizza after'], { title: 'YABACON MEETUP', bg: '#0e6251', font: 26 }), W / 2 - 0.09, 1.7, 0.8, -Math.PI / 2, true);
  g.add(proj);
  for (let r = 0; r < 2; r++) for (let i = 0; i < 3; i++) chairAt(room, W / 2 - 2.2 - r * 1.0, -0.4 + i * 1.0, -Math.PI / 2 + Math.PI, 0xe67e22, 'stage');
  obj(room, 'stage', 'Meetup area', W / 2 - 2.5, 0.6, 2.0);
  // beanbags and plants
  for (const [x, z, c] of [[-4.8, 3, 0x27ae60], [-3.8, 3.4, 0xe67e22]] as const) g.add(K.place(new THREE.Mesh(new THREE.SphereGeometry(0.45, 10, 8), K.mat(c)).translateY(0.3), x, z));
  g.add(K.place(K.plant(), W / 2 - 0.5, -D / 2 + 0.5), K.place(K.plant(), -W / 2 + 0.5, -D / 2 + 0.5));
  // whiteboard
  g.add(K.plane(2, 1.1, K.textBoard(['Sprint 14: launch 🚀', 'Fix NIBSS timeout', 'Stand-up 9:30'], { bg: '#fdfefe', fg: '#1b2631', font: 28 }), -W / 2 + 0.09, 1.6, 0, Math.PI / 2));
  toiletDoor(room, W / 2 - 0.9, 0);
  return room;
}

function library(place: PlaceDef): Room {
  const W = 12;
  const D = 9;
  const { room, th } = shell(place, W, D);
  const g = room.group;
  for (let i = 0; i < 4; i++) g.add(K.place(K.bookshelf(i + 1, 2.4), -4.4 + i * 2.6, -D / 2 + 0.4));
  room.colliders.push({ x0: -W / 2, x1: W / 2, z0: -D / 2, z1: -D / 2 + 0.7 });
  for (const [x, z] of [[-3, -1.5], [0, -1.5], [-3, 1.0], [0, 1.0]]) {
    const t = K.place(K.woodTable(2, 0.9, 0x6e4b2a), x, z);
    solid(room, t, 2, 0.9);
    for (const dx of [-0.5, 0.5]) {
      chairAt(room, x + dx, z - 0.7, 0, 0x5d4037, 'books');
      chairAt(room, x + dx, z + 0.7, Math.PI, 0x5d4037, 'books');
    }
    g.add(K.box(0.3, 0.05, 0.22, 0x1a5276, x - 0.4, 0.78, z), K.box(0.3, 0.05, 0.22, 0x7b241c, x + 0.5, 0.78, z + 0.1));
  }
  obj(room, 'books', 'Reading tables', -1.5, -0.2, 3.5);
  // lectern area on the right
  g.add(K.place(K.box(0.6, 1.15, 0.5, 0x5d4037), W / 2 - 1, -1.5));
  for (let i = 0; i < 3; i++) chairAt(room, W / 2 - 2.6, -2.5 + i * 1.0, Math.PI / 2, 0x1a4f8b, 'stage');
  if (place.offers.stage) obj(room, 'stage', 'Public lecture', W / 2 - 2.2, -1.5, 1.8);
  room.staff.push({ x: W / 2 - 1, z: -2.1, rot: -Math.PI / 2 + Math.PI, clip: 'talk' });
  sign(room, place.name.toUpperCase(), `#${th.accent.toString(16).padStart(6, '0')}`, 0, 2.95, -D / 2 + 0.1, 0, 4);
  toiletDoor(room, W / 2 - 0.9, 0);
  return room;
}

function hospital(place: PlaceDef): Room {
  const W = 10;
  const D = 8;
  const { room, th } = shell(place, W, D);
  const g = room.group;
  const desk = K.place(K.counter(3, 0xffffff, th.accent), -2.5, -0.5);
  solid(room, desk, 3.1, 0.7);
  room.staff.push({ x: -2.5, z: -1.2, rot: 0, clip: 'idle' });
  obj(room, 'reception', 'Reception', -2.5, 0.4, 1.6);
  for (let i = 0; i < 4; i++) chairAt(room, -3.5 + i * 0.7, 2.6, Math.PI, 0x2e86c1);
  for (const x of [2, 3.8]) {
    const b = K.place(K.hospitalBed(), x, -1.8);
    solid(room, b, 0.95, 2.0);
    room.seats.push({ x, z: -1.0, rot: Math.PI, kind: 'bed', group: 'bed', y: 0.78 });
  }
  obj(room, 'bed', 'Ward beds', 2.9, -0.4, 1.6);
  g.add(K.wallPoster('SLEEP UNDER NET', 'STOP MALARIA', '#117a65').translateX(-4.5).translateY(1.6).translateZ(-D / 2 + 0.09));
  g.add(K.wallPoster('WASH HANDS', 'KEEP SAFE', '#1f618d').translateX(-3.3).translateY(1.6).translateZ(-D / 2 + 0.09));
  sign(room, place.name.length > 24 ? 'HOSPITAL' : place.name.toUpperCase(), `#${th.accent.toString(16).padStart(6, '0')}`, 0, 2.95, -D / 2 + 0.1, 0, 3.6);
  toiletDoor(room, W / 2 - 0.9, 0);
  return room;
}

function hotel(place: PlaceDef): Room {
  const W = 10;
  const D = 8;
  const { room, th } = shell(place, W, D);
  const g = room.group;
  const desk = K.place(K.counter(2.6, 0x6d4c3d, 0xe5d3b3), -2.8, 1.6);
  solid(room, desk, 2.7, 0.7);
  room.staff.push({ x: -2.8, z: 0.9, rot: 0, clip: 'idle' });
  obj(room, 'reception', 'Reception', -2.8, 2.5, 1.6);
  g.add(K.box(0.12, 2.4, 4.5, 0xcfc2ab, 0, 0, -1.6));
  room.colliders.push({ x0: -0.1, x1: 0.1, z0: -D / 2, z1: 0.65 });
  const b = K.place(K.bed(K.ankaraTex([0x8e2b2b, 0xf5e6c8, 0x3e2723, 0xd4ac0d], 9), 1.6, 2.0), 2.6, -2.6);
  solid(room, b, 1.6, 2.0);
  room.seats.push({ x: 2.6, z: -1.75, rot: Math.PI, kind: 'bed', group: 'bed', y: 0.6 });
  obj(room, 'bed', 'Hotel bed', 2.6, -1.2, 1.5);
  g.add(K.box(0.9, 0.3, 0.25, 0xf4f6f6, 2.6, 2.5, -D / 2 + 0.15));
  g.add(K.box(1.0, 2.1, 1.0, new THREE.MeshLambertMaterial({ color: 0xaed6f1, transparent: true, opacity: 0.5 }), W / 2 - 0.6, 0, 0.6));
  obj(room, 'shower', 'Shower', W / 2 - 1.3, 0.6, 1.0);
  sign(room, place.name.toUpperCase(), `#${th.accent.toString(16).padStart(6, '0')}`, -2.8, 2.8, -D / 2 + 0.1, 0, 3.2);
  g.add(K.place(K.plant(), -W / 2 + 0.5, D / 2 - 0.6));
  toiletDoor(room, -0.9, 0);
  return room;
}
