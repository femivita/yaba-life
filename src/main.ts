import * as THREE from 'three';
import './ui/styles.css';
import { loadMap } from './core/MapData';
import { City, cityUniforms } from './world/City';
import { Sky } from './world/Sky';
import { findDoors } from './world/Doors';
import { buildLandmarks } from './world/Landmarks';
import { Labels } from './world/Labels';
import { Character } from './player/Character';
import { Input } from './player/Input';
import { Game } from './game/Game';
import { clockText } from './sim/State';
import { Hud } from './ui/Hud';
import { Quality } from './core/Quality';

const BASE = import.meta.env.BASE_URL;
const params = new URLSearchParams(location.search);

const loading = document.getElementById('loading')!;
const bar = loading.querySelector('.bar i') as HTMLElement;
const status = loading.querySelector('.status') as HTMLElement;
function progress(stage: string, f: number) {
  status.textContent = stage;
  bar.style.width = `${Math.round(f * 100)}%`;
}

async function start() {
  const quality = new Quality(params.get('q'));
  const renderer = new THREE.WebGLRenderer({ antialias: quality.antialias, powerPreference: 'high-performance' });
  renderer.setPixelRatio(quality.pixelRatio);
  renderer.setSize(innerWidth, innerHeight);
  renderer.shadowMap.enabled = quality.shadowSize > 0;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  document.getElementById('app')!.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.15, 1300);
  addEventListener('resize', () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
  });

  progress('Downloading Yaba map…', 0.02);
  const [map, character] = await Promise.all([
    loadMap(`${BASE}data/yaba`, (f) => progress('Downloading Yaba map…', f * 0.4)),
    Character.load(`${BASE}models/tunde.glb`),
  ]);
  progress('Building streets and houses…', 0.45);
  const city = new City(map);
  scene.add(city.group);
  const doors = findDoors(map, city.buildings);
  const landmarks = buildLandmarks(map, city.buildings, doors);
  scene.add(landmarks.group);
  await city.build((f) => progress('Building streets and houses…', 0.45 + f * 0.5), landmarks.skip);

  const sky = new Sky(scene, quality.shadowSize);
  if (params.has('t')) sky.time = Number(params.get('t'));
  const labels = new Labels(map.meta.landmarks);
  scene.add(labels.group);
  scene.add(character.root);
  // warm street-lamp spill that follows the player after dark
  const lamp = new THREE.PointLight(0xffc98a, 0, 22, 1.6);
  scene.add(lamp);

  const input = new Input(renderer.domElement);
  const hud = new Hud(map);
  const game = new Game({ renderer, camera, scene, map, city, sky, labels, hud, input, character, quality, lamp, params, doors });
  const player = game.player;
  sky.speed = 0;
  if (params.has('yaw')) player.yaw = Number(params.get('yaw'));
  if (params.has('dist')) player.distance = Number(params.get('dist'));
  if (params.has('pitch')) player.pitch = Number(params.get('pitch'));
  (window as unknown as { game: Game }).game = game;

  loading.classList.add('done');
  setTimeout(() => loading.remove(), 600);

  const clock = new THREE.Clock();
  let fpsAvg = 60;
  let visTimer = 0;
  const autoWalk = params.has('autowalk');
  function frame() {
    const dt = Math.min(clock.getDelta(), 1 / 15);
    fpsAvg += (1 / Math.max(dt, 1e-3) - fpsAvg) * 0.05;
    cityUniforms.uTime.value += dt;
    if (autoWalk) input.keys.add('KeyW');
    game.update(dt);
    if (!game.inside) {
      sky.update(dt, player.position, renderer);
      city.setNight(cityUniforms.uNight.value);
      landmarks.update(cityUniforms.uTime.value, cityUniforms.uNight.value);
      lamp.position.set(player.position.x + 2, 4.5, player.position.z + 1.5);
      visTimer -= dt;
      if (visTimer <= 0) {
        visTimer = 0.25;
        city.updateVisibility(player.position, quality.viewDistance);
      }
      labels.update(camera, player.position);
    }
    hud.update(player.position.x, player.position.z, player.heading, player.yaw, clockText(game.state.minutes), performance.now(), fpsAvg, game.insideName);
    quality.adapt(fpsAvg, renderer, sky);
    renderer.render(game.activeScene, camera);
    requestAnimationFrame(frame);
  }
  frame();
  (window as unknown as { __ready: boolean }).__ready = true;
}

start().catch((e) => {
  console.error(e);
  status.textContent = `Something went wrong: ${e?.message ?? e}`;
});
