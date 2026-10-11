import * as THREE from 'three';
import type { Landmark } from '../core/MapData';

const ICON: Record<string, string> = {
  university: '🎓', college: '🎓', secondary_school: '🏫', hospital: '🏥', market: '🛒', mall: '🛍️',
  supermarket: '🛒', transport_hub: '🚌', rail_station: '🚆', road: '🛣️', tech_hub: '💡', lounge: '🍸',
  night_club: '🎶', restaurant: '🍲', hotel: '🏨', bar: '🍺', bar_grill: '🍖', buka_bar: '🍲',
  sports_bar: '⚽', cafe: '☕', cafe_lounge: '☕', themed_bar: '🍹', cool_spot: '🍻', grill: '🍖',
  lounge_club: '🍸', park: '🌳', gate: '🚧', research: '🔬', government: '🏛️', community: '🏘️',
  landmark: '📍',
};

export function iconFor(type: string) {
  return ICON[type] ?? '📍';
}

/** Floating name tags over landmarks; only nearby ones are shown. */
export class Labels {
  readonly group = new THREE.Group();
  private items: { sprite: THREE.Sprite; x: number; z: number }[] = [];

  constructor(landmarks: Landmark[]) {
    for (const l of landmarks) {
      const sprite = this.makeSprite(`${iconFor(l.type)} ${shortName(l.name)}`);
      sprite.position.set(l.x, 14, l.z);
      sprite.visible = false;
      this.group.add(sprite);
      this.items.push({ sprite, x: l.x, z: l.z });
    }
  }

  private makeSprite(text: string) {
    const c = document.createElement('canvas');
    const g = c.getContext('2d')!;
    const font = '600 30px system-ui, -apple-system, Segoe UI, Roboto, sans-serif';
    g.font = font;
    const w = Math.ceil(g.measureText(text).width) + 36;
    c.width = w;
    c.height = 52;
    g.font = font;
    g.fillStyle = 'rgba(14, 20, 18, 0.78)';
    g.beginPath();
    g.roundRect(0, 0, w, 52, 26);
    g.fill();
    g.fillStyle = '#ffffff';
    g.textBaseline = 'middle';
    g.fillText(text, 18, 27);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const mat = new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true, fog: false });
    const s = new THREE.Sprite(mat);
    s.renderOrder = 10;
    s.userData.aspect = w / 52;
    return s;
  }

  update(camera: THREE.PerspectiveCamera, player: THREE.Vector3) {
    for (const it of this.items) {
      const d = Math.hypot(it.x - player.x, it.z - player.z);
      const vis = d < 450;
      it.sprite.visible = vis;
      if (!vis) continue;
      // constant on-screen size, slightly smaller with distance
      const camD = camera.position.distanceTo(it.sprite.position);
      const h = camD * 0.035 * THREE.MathUtils.lerp(1, 0.7, d / 450);
      it.sprite.scale.set(h * it.sprite.userData.aspect, h, 1);
      (it.sprite.material as THREE.SpriteMaterial).opacity = THREE.MathUtils.clamp((450 - d) / 80, 0, 1);
    }
  }
}

export function shortName(n: string) {
  return n.replace(/\s*\(.*?\)\s*/g, ' ').trim();
}
