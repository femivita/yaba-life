import type { Landmark, LoadedMap } from '../core/MapData';
import { iconFor, shortName } from '../world/Labels';
import { MapView } from './MapView';

/** On-screen UI: location, clock, minimap, full map with fast travel. */
export class Hud {
  private mapView: MapView;
  private mini: HTMLCanvasElement;
  private miniCtx: CanvasRenderingContext2D;
  private place: HTMLDivElement;
  private sub: HTMLDivElement;
  private clock: HTMLDivElement;
  private big: HTMLDivElement;
  private bigCanvas: HTMLCanvasElement;
  private fps: HTMLDivElement;
  private lastStreetCheck = 0;
  onTravel?: (x: number, z: number) => void;

  constructor(private map: LoadedMap) {
    this.mapView = new MapView(map);
    const root = document.getElementById('hud')!;
    root.innerHTML = `
      <div class="card loc"><div class="place">Yaba</div><div class="sub"></div></div>
      <div class="card clock"></div>
      <canvas class="mini" width="220" height="220"></canvas>
      <button class="card mapbtn" title="Map (M)">🗺️ Map</button>
      <div class="card help">WASD / arrows move · Shift run · drag to look · wheel zoom · M map</div>
      <div class="fps"></div>
      <div class="bigmap hidden">
        <div class="bigwrap"><canvas></canvas></div>
        <div class="list"><h3>Yaba landmarks</h3><p class="hint">Tap a place to go there.</p><ul></ul>
        <p class="attr"></p></div>
        <button class="close">✕</button>
      </div>`;
    this.place = root.querySelector('.place')!;
    this.sub = root.querySelector('.sub')!;
    this.clock = root.querySelector('.clock')!;
    this.mini = root.querySelector('.mini')!;
    this.miniCtx = this.mini.getContext('2d')!;
    this.big = root.querySelector('.bigmap')!;
    this.bigCanvas = this.big.querySelector('canvas')!;
    this.fps = root.querySelector('.fps')!;
    (root.querySelector('.attr') as HTMLElement).textContent = map.meta.attribution;
    root.querySelector('.mapbtn')!.addEventListener('click', () => this.toggleMap());
    this.big.querySelector('.close')!.addEventListener('click', () => this.toggleMap(false));
    window.addEventListener('keydown', (e) => {
      if (e.code === 'KeyM') this.toggleMap();
      if (e.code === 'Escape') this.toggleMap(false);
    });
    const ul = this.big.querySelector('ul')!;
    const sorted = [...map.meta.landmarks].sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
    for (const l of sorted) {
      const li = document.createElement('li');
      li.innerHTML = `<span>${iconFor(l.type)}</span> ${shortName(l.name)}${l.snapped ? '' : ' <em title="approximate location">≈</em>'}`;
      li.addEventListener('click', () => {
        this.onTravel?.(l.x, l.z);
        this.toggleMap(false);
      });
      ul.appendChild(li);
    }
    this.bigCanvas.addEventListener('click', (e) => {
      const r = this.bigCanvas.getBoundingClientRect();
      const sx = this.mapView.canvas.width / r.width;
      const x = (e.clientX - r.left) * sx * 3 + this.mapView.x0;
      const z = (e.clientY - r.top) * sx * 3 + this.mapView.z0;
      this.onTravel?.(x, z);
      this.toggleMap(false);
    });
  }

  private toggleMap(show?: boolean) {
    const s = show ?? this.big.classList.contains('hidden');
    this.big.classList.toggle('hidden', !s);
    if (s) this.drawBig();
  }

  private playerPos = { x: 0, z: 0 };

  private drawBig() {
    const mv = this.mapView;
    const c = this.bigCanvas;
    c.width = mv.canvas.width;
    c.height = mv.canvas.height;
    const g = c.getContext('2d')!;
    g.drawImage(mv.canvas, 0, 0);
    g.font = '600 15px system-ui, sans-serif';
    g.textAlign = 'center';
    for (const l of this.map.meta.landmarks) {
      const x = mv.px(l.x);
      const y = mv.pz(l.z);
      g.font = '22px system-ui';
      g.fillText(iconFor(l.type), x, y + 8);
    }
    for (const l of this.map.meta.landmarks.filter((l) => rank(l) === 0)) {
      g.font = '700 16px system-ui, sans-serif';
      g.lineWidth = 4;
      g.strokeStyle = 'rgba(255,255,255,0.9)';
      g.strokeText(shortName(l.name), mv.px(l.x), mv.pz(l.z) - 16);
      g.fillStyle = '#1d2a24';
      g.fillText(shortName(l.name), mv.px(l.x), mv.pz(l.z) - 16);
    }
    g.fillStyle = '#e8442e';
    g.beginPath();
    g.arc(mv.px(this.playerPos.x), mv.pz(this.playerPos.z), 9, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = '#fff';
    g.lineWidth = 3;
    g.stroke();
  }

  update(x: number, z: number, heading: number, camYaw: number, clock: string, now: number, fps: number) {
    this.playerPos = { x, z };
    this.clock.textContent = `🕒 ${clock}`;
    this.fps.textContent = `${fps.toFixed(0)} fps`;
    if (now - this.lastStreetCheck > 400) {
      this.lastStreetCheck = now;
      const street = this.mapView.streetAt(x, z);
      const lm = nearestLandmark(this.map.meta.landmarks, x, z);
      this.place.textContent = street ?? (lm && lm.d < 250 ? shortName(lm.l.name) : 'Yaba');
      this.sub.textContent = lm ? `${lm.d < 60 ? 'At' : 'Near'} ${shortName(lm.l.name)} · ${Math.round(lm.d)} m` : '';
    }
    // minimap: north-up rotated to camera, 1 px = 1.5 m
    const g = this.miniCtx;
    const S = 220;
    const mv = this.mapView;
    g.save();
    g.clearRect(0, 0, S, S);
    g.beginPath();
    g.arc(S / 2, S / 2, S / 2 - 2, 0, Math.PI * 2);
    g.clip();
    g.fillStyle = '#b8ab95';
    g.fillRect(0, 0, S, S);
    g.translate(S / 2, S / 2);
    g.rotate(camYaw - Math.PI);
    g.scale(2, 2);
    g.drawImage(mv.canvas, -mv.px(x), -mv.pz(z));
    g.restore();
    // player arrow
    g.save();
    g.translate(S / 2, S / 2);
    g.rotate(-(heading - camYaw + Math.PI));
    g.fillStyle = '#e8442e';
    g.strokeStyle = '#fff';
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(0, -10);
    g.lineTo(7, 8);
    g.lineTo(0, 4);
    g.lineTo(-7, 8);
    g.closePath();
    g.fill();
    g.stroke();
    g.restore();
    // north marker
    g.save();
    g.translate(S / 2, S / 2);
    g.rotate(camYaw - Math.PI);
    g.fillStyle = '#fff';
    g.font = '700 14px system-ui';
    g.textAlign = 'center';
    g.fillText('N', 0, -S / 2 + 18);
    g.restore();
  }
}

function rank(l: Landmark) {
  const major = ['university', 'college', 'hospital', 'market', 'mall', 'rail_station', 'transport_hub', 'secondary_school', 'tech_hub', 'park', 'road'];
  return major.includes(l.type) ? 0 : 1;
}

function nearestLandmark(ls: Landmark[], x: number, z: number) {
  let best: { l: Landmark; d: number } | null = null;
  for (const l of ls) {
    const d = Math.hypot(l.x - x, l.z - z);
    if (!best || d < best.d) best = { l, d };
  }
  return best;
}
