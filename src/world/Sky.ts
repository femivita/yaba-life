import * as THREE from 'three';
import { cityUniforms } from './City';

/**
 * Tropical day/night cycle for Lagos (~6.5°N: sunrise ~6:50, sunset ~19:00,
 * sun passes nearly overhead). Cheap gradient dome, one shadowed sun that
 * follows the player, hemisphere fill, and fog matched to the horizon.
 */
export class Sky {
  readonly sun = new THREE.DirectionalLight(0xffffff, 2.5);
  readonly hemi = new THREE.HemisphereLight(0xcfe3ff, 0x6e604c, 1.0);
  readonly fog = new THREE.Fog(0xcfd8dc, 250, 900);
  private dome: THREE.Mesh;
  private uniforms = {
    top: { value: new THREE.Color() },
    horizon: { value: new THREE.Color() },
    sunDir: { value: new THREE.Vector3() },
    sunColor: { value: new THREE.Color() },
  };
  /** hours, 0..24 */
  time = 17.4;
  /** game minutes per real second */
  speed = 1;

  constructor(scene: THREE.Scene, shadowSize: number) {
    this.sun.castShadow = shadowSize > 0;
    if (shadowSize > 0) {
      this.sun.shadow.mapSize.set(shadowSize, shadowSize);
      const s = this.sun.shadow.camera;
      s.left = -45;
      s.right = 45;
      s.top = 45;
      s.bottom = -45;
      s.near = 1;
      s.far = 260;
      this.sun.shadow.bias = -0.0008;
      this.sun.shadow.normalBias = 0.04;
    }
    scene.add(this.sun, this.sun.target, this.hemi);
    scene.fog = this.fog;
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); vec4 p = projectionMatrix * modelViewMatrix * vec4(position,1.0); gl_Position = p.xyww; }`,
      fragmentShader: `
        uniform vec3 top; uniform vec3 horizon; uniform vec3 sunDir; uniform vec3 sunColor; varying vec3 vDir;
        void main(){
          float h = clamp(vDir.y, -0.2, 1.0);
          vec3 col = mix(horizon, top, pow(max(h, 0.0), 0.55));
          float s = max(dot(normalize(vDir), sunDir), 0.0);
          col += sunColor * (pow(s, 900.0) * 6.0 + pow(s, 12.0) * 0.35);
          // harmattan/humidity haze near the horizon
          col = mix(col, horizon, smoothstep(0.12, -0.05, vDir.y));
          gl_FragColor = vec4(col, 1.0);
          #include <colorspace_fragment>
        }`,
    });
    this.dome = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 12), mat);
    this.dome.scale.setScalar(1500);
    this.dome.frustumCulled = false;
    this.dome.renderOrder = -1;
    scene.add(this.dome);
  }

  get clock() {
    const h = Math.floor(this.time);
    const m = Math.floor((this.time - h) * 60);
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }

  update(dt: number, focus: THREE.Vector3, renderer: THREE.WebGLRenderer) {
    this.time = (this.time + (dt * this.speed) / 60) % 24;
    // sun angle: 0 at 06:55 sunrise, PI at 18:55 sunset
    const a = ((this.time - 6.9) / 12) * Math.PI;
    const elev = Math.sin(a);
    // Lagos: sun rises roughly east, transits a little north of zenith in this season
    const dir = new THREE.Vector3(Math.cos(a), Math.max(elev, -0.3), -0.25).normalize();
    this.uniforms.sunDir.value.copy(dir);

    const day = THREE.MathUtils.smoothstep(elev, -0.08, 0.25);
    const golden = THREE.MathUtils.smoothstep(elev, -0.05, 0.08) * (1 - THREE.MathUtils.smoothstep(elev, 0.15, 0.45));
    const night = 1 - THREE.MathUtils.smoothstep(elev, -0.15, 0.02);
    cityUniforms.uNight.value = night;

    const topDay = new THREE.Color(0x4f86c6);
    const topNight = new THREE.Color(0x070b18);
    const horDay = new THREE.Color(0xd9e2e4);
    const horGold = new THREE.Color(0xf2b27a);
    const horNight = new THREE.Color(0x1a1d2a);
    const top = topNight.clone().lerp(topDay, day);
    const hor = horNight.clone().lerp(horDay, day).lerp(horGold, golden * 0.85);
    this.uniforms.top.value.copy(top);
    this.uniforms.horizon.value.copy(hor);
    this.uniforms.sunColor.value.set(0xfff0d0).lerp(new THREE.Color(0xff9a50), golden);
    this.fog.color.copy(hor);
    renderer.setClearColor(hor);

    this.sun.color.set(0xfff4e2).lerp(new THREE.Color(0xffa860), golden);
    this.sun.intensity = 2.8 * day;
    this.hemi.intensity = 0.75 + 0.45 * day;
    this.hemi.color.set(0x5a6890).lerp(new THREE.Color(0xcfe3ff), day);
    this.hemi.groundColor.set(0x3a2e22).lerp(new THREE.Color(0x6e604c), day);

    // shadow camera hugs the player; snap to texel grid to stop shimmering
    const lightDir = elev > 0.02 ? dir : new THREE.Vector3(0.3, 1, 0.2).normalize();
    const texel = 90 / (this.sun.shadow.mapSize.x || 1024);
    const fx = Math.round(focus.x / texel) * texel;
    const fz = Math.round(focus.z / texel) * texel;
    this.sun.target.position.set(fx, 0, fz);
    this.sun.position.set(fx + lightDir.x * 120, lightDir.y * 120, fz + lightDir.z * 120);
    this.sun.target.updateMatrixWorld();
    this.dome.position.copy(focus);
  }
}
