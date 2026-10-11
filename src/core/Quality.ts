import type * as THREE from 'three';
import type { Sky } from '../world/Sky';

/**
 * Picks settings from the device up front, then quietly lowers resolution
 * if the frame rate sags, so phones and old laptops stay smooth.
 */
export class Quality {
  pixelRatio: number;
  shadowSize: number;
  viewDistance: number;
  antialias: boolean;
  private lowSince = 0;
  private settled = false;

  constructor(forced: string | null) {
    const mobile = matchMedia('(pointer: coarse)').matches;
    const cores = navigator.hardwareConcurrency || 4;
    const tier = forced ?? (mobile || cores <= 4 ? 'low' : 'high');
    if (tier === 'low') {
      this.pixelRatio = Math.min(devicePixelRatio, 1.25);
      this.shadowSize = mobile ? 0 : 1024;
      this.viewDistance = 450;
      this.antialias = false;
    } else {
      this.pixelRatio = Math.min(devicePixelRatio, 1.75);
      this.shadowSize = 2048;
      this.viewDistance = 750;
      this.antialias = true;
    }
  }

  adapt(fps: number, renderer: THREE.WebGLRenderer, _sky: Sky) {
    if (this.settled) return;
    const now = performance.now();
    if (fps < 40) {
      if (!this.lowSince) this.lowSince = now;
      if (now - this.lowSince > 2500) {
        this.lowSince = 0;
        if (this.pixelRatio > 0.75) {
          this.pixelRatio = Math.max(0.75, this.pixelRatio - 0.25);
          renderer.setPixelRatio(this.pixelRatio);
        } else if (this.viewDistance > 350) {
          this.viewDistance -= 100;
        } else {
          this.settled = true;
        }
      }
    } else {
      this.lowSince = 0;
    }
  }
}
