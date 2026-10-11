import * as THREE from 'three';

/**
 * Low-poly furniture kit for Lagos interiors: plastic chairs, buka pots,
 * coolers, ceiling fans, okrika racks, beds with ankara sheets... Everything
 * is boxes and cylinders with flat colours or tiny canvas textures, so a
 * whole room costs a few thousand triangles.
 */

const matCache = new Map<number, THREE.MeshLambertMaterial>();
export function mat(color: number) {
  let m = matCache.get(color);
  if (!m) matCache.set(color, (m = new THREE.MeshLambertMaterial({ color })));
  return m;
}

export function box(w: number, h: number, d: number, color: number | THREE.Material, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), typeof color === 'number' ? mat(color) : color);
  m.position.set(x, y + h / 2, z);
  return m;
}

export function cyl(rt: number, rb: number, h: number, color: number | THREE.Material, x = 0, y = 0, z = 0, seg = 12) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), typeof color === 'number' ? mat(color) : color);
  m.position.set(x, y + h / 2, z);
  return m;
}

export function group(...items: THREE.Object3D[]) {
  const g = new THREE.Group();
  g.add(...items);
  return g;
}

export function place(o: THREE.Object3D, x: number, z: number, rot = 0, y = 0) {
  o.position.set(x, y, z);
  o.rotation.y = rot;
  return o;
}

// ---------------------------------------------------------------------------
// canvas textures

function canvasTex(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d')!);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

const hex = (n: number) => `#${n.toString(16).padStart(6, '0')}`;

/** African wax-print style pattern for sheets, curtains and tablecloths. */
export function ankaraTex(colors: number[], seed = 1) {
  return canvasTex(128, 128, (g) => {
    g.fillStyle = hex(colors[0]);
    g.fillRect(0, 0, 128, 128);
    let s = seed;
    const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    for (let y = 0; y < 4; y++)
      for (let x = 0; x < 4; x++) {
        const cx = x * 32 + (y % 2 ? 16 : 0);
        const cy = y * 32 + 16;
        [13, 9, 5].forEach((r, k) => {
          g.fillStyle = hex(colors[1 + ((k + Math.floor(rnd() * 2)) % (colors.length - 1))]);
          g.beginPath();
          g.arc(cx, cy, r, 0, Math.PI * 2);
          g.fill();
        });
      }
  });
}

export function textBoard(lines: string[], opts: { bg?: string; fg?: string; title?: string; w?: number; h?: number; font?: number } = {}) {
  const W = opts.w ?? 512;
  const H = opts.h ?? 384;
  return canvasTex(W, H, (g) => {
    g.fillStyle = opts.bg ?? '#1d2b22';
    g.fillRect(0, 0, W, H);
    g.strokeStyle = '#c9a66b';
    g.lineWidth = 10;
    g.strokeRect(5, 5, W - 10, H - 10);
    g.fillStyle = opts.fg ?? '#fdf6e3';
    let y = 22;
    if (opts.title) {
      g.font = `800 ${Math.round((opts.font ?? 34) * 1.25)}px system-ui, sans-serif`;
      g.textAlign = 'center';
      g.textBaseline = 'top';
      g.fillText(opts.title, W / 2, y);
      y += (opts.font ?? 34) * 1.7;
    }
    g.textAlign = 'left';
    g.font = `600 ${opts.font ?? 34}px system-ui, sans-serif`;
    for (const l of lines) {
      const [a, b] = l.split('|');
      g.fillText(a, 26, y);
      if (b) {
        g.textAlign = 'right';
        g.fillText(b, W - 26, y);
        g.textAlign = 'left';
      }
      y += (opts.font ?? 34) * 1.3;
    }
  });
}

export function plane(w: number, h: number, tex: THREE.Texture, x = 0, y = 0, z = 0, rot = 0, emissive = false) {
  const m = new THREE.Mesh(
    new THREE.PlaneGeometry(w, h),
    emissive ? new THREE.MeshBasicMaterial({ map: tex }) : new THREE.MeshLambertMaterial({ map: tex }),
  );
  m.position.set(x, y, z);
  m.rotation.y = rot;
  return m;
}

/** A TV that shows a live football match, drawn on a tiny canvas. */
export class FootballScreen {
  readonly texture: THREE.CanvasTexture;
  private g: CanvasRenderingContext2D;
  private players: { x: number; y: number; vx: number; vy: number; team: number }[] = [];
  private ball = { x: 128, y: 72, vx: 30, vy: 10 };
  private acc = 0;
  score = [0, 0];

  constructor() {
    const c = document.createElement('canvas');
    c.width = 256;
    c.height = 144;
    this.g = c.getContext('2d')!;
    this.texture = new THREE.CanvasTexture(c);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    for (let i = 0; i < 14; i++) this.players.push({ x: 30 + Math.random() * 196, y: 20 + Math.random() * 104, vx: 0, vy: 0, team: i % 2 });
    this.draw();
  }

  update(dt: number) {
    this.acc += dt;
    if (this.acc < 0.08) return;
    const step = this.acc;
    this.acc = 0;
    const b = this.ball;
    b.x += b.vx * step;
    b.y += b.vy * step;
    if (b.y < 14 || b.y > 130) b.vy *= -1;
    if (b.x < 12 || b.x > 244) {
      if (b.y > 56 && b.y < 88) {
        this.score[b.x < 12 ? 1 : 0]++;
        b.x = 128;
        b.y = 72;
      }
      b.vx *= -1;
    }
    for (const p of this.players) {
      const dx = b.x - p.x;
      const dy = b.y - p.y;
      const d = Math.hypot(dx, dy) || 1;
      p.vx += ((dx / d) * 40 - p.vx) * step * 1.5 + (Math.random() - 0.5) * 20 * step;
      p.vy += ((dy / d) * 40 - p.vy) * step * 1.5 + (Math.random() - 0.5) * 20 * step;
      p.x += p.vx * step * 0.6;
      p.y += p.vy * step * 0.6;
      if (d < 5) {
        b.vx = (p.team ? -1 : 1) * (40 + Math.random() * 50);
        b.vy = (Math.random() - 0.5) * 80;
      }
    }
    this.draw();
  }

  private draw() {
    const g = this.g;
    for (let i = 0; i < 8; i++) {
      g.fillStyle = i % 2 ? '#2f8f3a' : '#2a8234';
      g.fillRect(i * 32, 0, 32, 144);
    }
    g.strokeStyle = 'rgba(255,255,255,.8)';
    g.lineWidth = 1.5;
    g.strokeRect(10, 12, 236, 120);
    g.beginPath();
    g.moveTo(128, 12);
    g.lineTo(128, 132);
    g.stroke();
    g.beginPath();
    g.arc(128, 72, 16, 0, Math.PI * 2);
    g.stroke();
    g.strokeRect(10, 50, 22, 44);
    g.strokeRect(224, 50, 22, 44);
    for (const p of this.players) {
      g.fillStyle = p.team ? '#e8e8f0' : '#d4142a';
      g.fillRect(p.x - 2.5, p.y - 4, 5, 8);
    }
    g.fillStyle = '#fff';
    g.beginPath();
    g.arc(this.ball.x, this.ball.y, 2.2, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = 'rgba(0,0,0,.6)';
    g.fillRect(6, 3, 98, 15);
    g.fillStyle = '#fff';
    g.font = '700 11px system-ui';
    g.fillText(`ARS ${this.score[0]} - ${this.score[1]} CHE`, 11, 14);
    this.texture.needsUpdate = true;
  }
}

// ---------------------------------------------------------------------------
// furniture

/** The ubiquitous moulded plastic chair. Seat at 0.45 m, faces +z. */
export function plasticChair(color = 0xc0392b) {
  const m = mat(color);
  const g = group(
    box(0.46, 0.05, 0.44, m, 0, 0.42, 0),
    box(0.46, 0.5, 0.05, m, 0, 0.45, -0.22),
  );
  for (const [x, z] of [[-0.2, -0.19], [0.2, -0.19], [-0.2, 0.19], [0.2, 0.19]]) g.add(box(0.04, 0.43, 0.04, m, x, 0, z));
  return g;
}

export function plasticTable(color = 0xecf0f1, top: THREE.Material | null = null) {
  const m = mat(color);
  const g = group(cyl(0.45, 0.45, 0.04, top ?? m, 0, 0.72, 0, 16));
  for (const [x, z] of [[-0.3, -0.3], [0.3, -0.3], [-0.3, 0.3], [0.3, 0.3]]) g.add(box(0.04, 0.72, 0.04, m, x, 0, z));
  return g;
}

export function woodTable(w = 1.4, d = 0.8, color = 0x8b5a2b) {
  const g = group(box(w, 0.06, d, color, 0, 0.72, 0));
  for (const [x, z] of [[-w / 2 + 0.06, -d / 2 + 0.06], [w / 2 - 0.06, -d / 2 + 0.06], [-w / 2 + 0.06, d / 2 - 0.06], [w / 2 - 0.06, d / 2 - 0.06]]) g.add(box(0.06, 0.72, 0.06, color, x, 0, z));
  return g;
}

export function bench(len = 1.8, color = 0x7a4e2a) {
  return group(box(len, 0.05, 0.32, color, 0, 0.42, 0), box(0.06, 0.42, 0.28, color, -len / 2 + 0.15, 0, 0), box(0.06, 0.42, 0.28, color, len / 2 - 0.15, 0, 0));
}

export function counter(w = 3, color = 0x6e4b2a, top = 0xd9d2c5) {
  return group(box(w, 1.0, 0.6, color, 0, 0, 0), box(w + 0.1, 0.05, 0.7, top, 0, 1.0, 0));
}

export function bigPot(color = 0x9ea3a8, r = 0.3) {
  return group(cyl(r, r * 0.9, r * 1.4, color, 0, 0, 0, 14), cyl(r * 1.02, r * 1.02, 0.03, 0x6c7176, 0, r * 1.4, 0, 14));
}

/** Igloo-style food cooler in Lagos blue with a white lid. */
export function cooler(color = 0x2471a3) {
  return group(box(0.6, 0.42, 0.42, color), box(0.62, 0.06, 0.44, 0xf4f6f6, 0, 0.42, 0));
}

export function gasCooker() {
  const g = group(box(0.6, 0.85, 0.55, 0xdfe3e6), box(0.6, 0.02, 0.55, 0x2d3436, 0, 0.85, 0), cyl(0.06, 0.06, 0.65, 0x2e86c1, 0.45, 0, 0.1));
  g.add(bigPot(0x8d9399, 0.16).translateX(-0.12).translateY(0.87));
  return g;
}

export function fridge() {
  return group(box(0.6, 1.5, 0.6, 0xf2f3f4), box(0.03, 0.4, 0.04, 0x95a5a6, 0.22, 0.95, 0.31));
}

export function tv(screen: THREE.Material, w = 1.3) {
  const h = w * 0.58;
  const g = group(box(w + 0.06, h + 0.06, 0.06, 0x111111, 0, 0, 0));
  const s = new THREE.Mesh(new THREE.PlaneGeometry(w, h), screen);
  s.position.set(0, (h + 0.06) / 2, 0.035);
  g.add(s);
  return g;
}

export class CeilingFan {
  readonly group: THREE.Group;
  private blades: THREE.Group;
  constructor(height: number) {
    this.blades = new THREE.Group();
    for (let i = 0; i < 3; i++) {
      const b = box(0.7, 0.02, 0.12, 0x6d6d6d, 0.38, 0, 0);
      const arm = new THREE.Group();
      arm.add(b);
      arm.rotation.y = (i * Math.PI * 2) / 3;
      this.blades.add(arm);
    }
    this.blades.position.y = height - 0.5;
    this.group = group(cyl(0.02, 0.02, 0.45, 0x555555, 0, height - 0.45, 0, 6), cyl(0.1, 0.1, 0.08, 0x777777, 0, height - 0.54, 0), this.blades);
  }
  update(dt: number, on: boolean) {
    if (on) this.blades.rotation.y += dt * 9;
  }
}

export function bed(sheet: THREE.Texture, w = 1.35, d = 2.0) {
  const sm = new THREE.MeshLambertMaterial({ map: sheet });
  return group(
    box(w, 0.3, d, 0x6b4a2e, 0, 0, 0),
    box(w - 0.06, 0.18, d - 0.06, sm, 0, 0.3, 0),
    box(w * 0.7, 0.1, 0.35, 0xf4f1ea, 0, 0.48, -d / 2 + 0.25),
    box(w, 0.8, 0.06, 0x5a3d25, 0, 0, -d / 2),
  );
}

export function bucket(color = 0x1f8ef1) {
  return group(cyl(0.17, 0.13, 0.32, color, 0, 0, 0, 12), cyl(0.06, 0.06, 0.1, 0xf1c40f, 0.25, 0, 0, 8));
}

export function toiletBowl() {
  return group(box(0.4, 0.42, 0.55, 0xf4f6f6), box(0.42, 0.5, 0.18, 0xf4f6f6, 0, 0.3, -0.28));
}

export function wardrobe(color = 0x8e6b4a) {
  return group(box(1.0, 1.9, 0.55, color), box(0.02, 1.7, 0.01, 0x3a2a1a, 0, 0.1, 0.28));
}

export function standingFan() {
  return group(cyl(0.18, 0.2, 0.04, 0x333333), cyl(0.02, 0.02, 1.1, 0xdddddd), cyl(0.25, 0.25, 0.08, 0x2c3e50, 0, 1.1, 0, 16).rotateX(Math.PI / 2));
}

export function laptopDesk(color = 0x8b5a2b) {
  const g = woodTable(1.2, 0.6, color);
  g.add(box(0.36, 0.02, 0.25, 0x2d3436, 0, 0.78, 0.05));
  const scr = box(0.36, 0.24, 0.015, 0x2d3436, 0, 0.79, -0.08);
  scr.rotation.x = -0.25;
  const glow = new THREE.Mesh(new THREE.PlaneGeometry(0.32, 0.2), new THREE.MeshBasicMaterial({ color: 0x74b9ff }));
  glow.position.set(0, 0.92, -0.065);
  glow.rotation.x = -0.25;
  g.add(scr, glow);
  return g;
}

/** Clothes rail with hanging shirts in random colours (okrika). */
export function clothesRack(seed = 1, len = 2.2) {
  let s = seed * 7919;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const g = group(box(len, 0.03, 0.03, 0x999999, 0, 1.75, 0), box(0.04, 1.78, 0.04, 0x999999, -len / 2, 0, 0), box(0.04, 1.78, 0.04, 0x999999, len / 2, 0, 0));
  const cols = [0xc0392b, 0x2980b9, 0x27ae60, 0xf39c12, 0x8e44ad, 0xecf0f1, 0x2c3e50, 0xd35400, 0x16a085, 0xe84393];
  for (let x = -len / 2 + 0.12; x < len / 2 - 0.08; x += 0.11) g.add(box(0.05, 0.75, 0.45, cols[Math.floor(rnd() * cols.length)], x, 0.95, 0));
  return g;
}

/** "Bend down select" pile of second-hand clothes on a tarp. */
export function clothesPile(seed = 1) {
  let s = seed * 104729;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const g = group(box(1.8, 0.02, 1.4, 0x2c3e50, 0, 0, 0));
  const cols = [0xc0392b, 0x2980b9, 0x27ae60, 0xf39c12, 0x8e44ad, 0xecf0f1, 0x34495e, 0xd35400, 0xf1c40f, 0x7f8c8d];
  for (let i = 0; i < 40; i++) {
    const r = 0.65 * Math.sqrt(rnd());
    const a = rnd() * Math.PI * 2;
    const h = (0.65 - r) * 0.7 + 0.04;
    const b = box(0.38, 0.06, 0.32, cols[Math.floor(rnd() * cols.length)], Math.cos(a) * r, h * rnd(), Math.sin(a) * r * 0.8);
    b.rotation.y = rnd() * 3;
    g.add(b);
  }
  return g;
}

export function shelf(seed = 1, w = 2, colors = [0xe74c3c, 0xf1c40f, 0x2ecc71, 0x3498db, 0xecf0f1, 0xe67e22]) {
  let s = seed * 31337;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const g = group(box(w, 1.9, 0.05, 0xbdc3c7, 0, 0, -0.2));
  for (let k = 0; k < 4; k++) {
    g.add(box(w, 0.03, 0.42, 0xbdc3c7, 0, 0.25 + k * 0.45, 0));
    for (let x = -w / 2 + 0.1; x < w / 2 - 0.05; x += 0.16) g.add(box(0.13, 0.18 + rnd() * 0.12, 0.25, colors[Math.floor(rnd() * colors.length)], x, 0.28 + k * 0.45, 0));
  }
  return g;
}

export function bookshelf(seed = 1, w = 2) {
  return shelf(seed, w, [0x7b241c, 0x1a5276, 0x145a32, 0x7d6608, 0x4a235a, 0x873600]);
}

export function sofa(color = 0x4a235a, w = 2) {
  return group(box(w, 0.42, 0.85, color, 0, 0, 0), box(w, 0.5, 0.2, color, 0, 0.42, -0.33), box(0.18, 0.25, 0.85, color, -w / 2 + 0.09, 0.42, 0), box(0.18, 0.25, 0.85, color, w / 2 - 0.09, 0.42, 0));
}

export function shisha() {
  return group(cyl(0.12, 0.16, 0.25, 0x48c9b0), cyl(0.02, 0.02, 0.4, 0xbdc3c7, 0, 0.25, 0), cyl(0.07, 0.05, 0.08, 0x784212, 0, 0.65, 0));
}

export function speaker() {
  return group(box(0.5, 1.1, 0.45, 0x111111), cyl(0.15, 0.15, 0.02, 0x333333, 0, 0.7, 0.23).rotateX(Math.PI / 2), cyl(0.09, 0.09, 0.02, 0x333333, 0, 0.3, 0.23).rotateX(Math.PI / 2));
}

export function bottles(n = 4, x = 0, y = 0.76, z = 0) {
  const g = new THREE.Group();
  for (let i = 0; i < n; i++) g.add(cyl(0.035, 0.035, 0.24, i % 3 ? 0x6e3b0a : 0x1e8449, x + (i - n / 2) * 0.09, y, z + (i % 2) * 0.08, 8));
  return g;
}

export function plate(x = 0, y = 0.76, z = 0, food = 0xd35400) {
  return group(cyl(0.14, 0.12, 0.02, 0xf4f6f6, x, y, z, 14), cyl(0.09, 0.1, 0.05, food, x, y + 0.02, z, 10));
}

export function hospitalBed() {
  return group(box(0.95, 0.55, 2.0, 0xdfe6e9), box(0.9, 0.12, 1.95, 0xffffff, 0, 0.55, 0), box(0.95, 0.9, 0.05, 0x95a5a6, 0, 0, -1.0), box(0.6, 0.1, 0.3, 0xffffff, 0, 0.67, -0.75));
}

export function plant() {
  return group(cyl(0.18, 0.14, 0.35, 0xa04000), new THREE.Mesh(new THREE.IcosahedronGeometry(0.4, 0), mat(0x27ae60)).translateY(0.75));
}

export function wallPoster(text: string, sub: string, bg: string, w = 0.9, h = 1.2) {
  const t = canvasTex(256, 340, (g) => {
    g.fillStyle = bg;
    g.fillRect(0, 0, 256, 340);
    g.fillStyle = 'rgba(255,255,255,.12)';
    for (let i = 0; i < 6; i++) g.fillRect(0, i * 60, 256, 28);
    g.fillStyle = '#fff';
    g.textAlign = 'center';
    g.font = '900 44px system-ui';
    const words = text.split(' ');
    words.forEach((wd, i) => g.fillText(wd, 128, 120 + i * 50 - words.length * 20));
    g.font = '600 20px system-ui';
    g.fillText(sub, 128, 310);
  });
  return plane(w, h, t);
}
