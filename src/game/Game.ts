import * as THREE from 'three';
import type { LoadedMap } from '../core/MapData';
import type { Quality } from '../core/Quality';
import { InteriorScene } from '../interior/Interior';
import type { Seat } from '../interior/Rooms';
import { Actor } from '../npc/Actor';
import { CROWD_MODELS, FEMALE_MODELS, PEOPLE, personById, randomJob, randomName, type PersonDef } from '../npc/People';
import { ACTS, interact, relLabel, type Talker } from '../npc/Social';
import { Streets } from '../npc/Streets';
import type { Character, Clip } from '../player/Character';
import type { Input } from '../player/Input';
import { Player } from '../player/Player';
import { JOBS, WORK_STYLES, jobById, type WorkStyle } from '../sim/Jobs';
import { Life, fmtH } from '../sim/Life';
import { PLACES, STREET_HUSTLE, placeById, type Offer, type PlaceDef, type Tag } from '../sim/Places';
import { RENT_WEEKLY, clearSave, clockText, hourOf, loadGame, naira, newGame, openAt, saveGame, weekdayOf, type GameState } from '../sim/State';
import type { Hud } from '../ui/Hud';
import { LifeUI, type MenuOption } from '../ui/LifeUI';
import type { City } from '../world/City';
import { cityUniforms } from '../world/City';
import { DoorVisuals, findDoors, type Door } from '../world/Doors';
import type { Labels } from '../world/Labels';
import type { Sky } from '../world/Sky';

/** Outdoor spots with something to do but no interior (transport hubs). */
const HUBS = [
  { landmark: 'yaba_bus_terminal', name: 'Yaba Bus Terminal' },
  { landmark: 'ojuelegba', name: 'Ojuelegba Junction' },
];

interface Interactable {
  label: string;
  x: number;
  z: number;
  r: number;
  act: () => void;
}

interface CityNpc {
  def: PersonDef;
  actor: Actor | null;
  loading: boolean;
}

export interface GameDeps {
  renderer: THREE.WebGLRenderer;
  camera: THREE.PerspectiveCamera;
  scene: THREE.Scene;
  map: LoadedMap;
  city: City;
  sky: Sky;
  labels: Labels;
  hud: Hud;
  input: Input;
  character: Character;
  quality: Quality;
  lamp: THREE.PointLight;
  params: URLSearchParams;
  doors?: Door[];
}

/**
 * Ties the world, Tunde and the life simulation together: entering and
 * leaving buildings, talking to people, activities, jobs and travel.
 */
export class Game {
  readonly life: Life;
  readonly ui: LifeUI;
  readonly player: Player;
  private doors: Door[];
  private doorVis: DoorVisuals;
  private interior: InteriorScene | null = null;
  private interiorActors: Actor[] = [];
  private cityNpcs: CityNpc[];
  private walkers: Actor[] = [];
  private streets: Streets;
  private plumbob: THREE.Mesh;
  private seat: Seat | null = null;
  private near: Interactable | null = null;
  private talking: { actor: Actor; talker: Talker } | null = null;
  private uiAcc = 0;
  private saveAcc = 0;
  private walkerAcc = 0;
  private time = 0;
  private hubs: { x: number; z: number; name: string; landmark: string }[] = [];
  private paused = false;
  private crowdSeed = 1;

  constructor(private d: GameDeps) {
    const saved = d.params.has('new') ? null : loadGame();
    this.life = new Life(saved ?? newGame());
    if (d.params.has('t')) this.life.s.minutes = Math.floor(this.life.s.minutes / 1440) * 1440 + Number(d.params.get('t')) * 60;
    this.ui = new LifeUI(this.life);
    this.player = new Player(d.character, d.camera, d.input, d.city.buildings, d.map.meta.bounds);
    this.doors = d.doors ?? findDoors(d.map, d.city.buildings);
    this.doorVis = new DoorVisuals(this.doors);
    d.scene.add(this.doorVis.group);
    this.streets = new Streets(d.map);
    const lms = new Map(d.map.meta.landmarks.map((l) => [l.id, l]));
    for (const h of HUBS) {
      const l = lms.get(h.landmark);
      if (l) this.hubs.push({ x: l.x, z: l.z, name: h.name, landmark: h.landmark });
    }
    this.cityNpcs = PEOPLE.filter((p) => p.schedule.some((s) => s.role === 'outside')).map((def) => ({ def, actor: null, loading: false }));
    // the plumbob: The Sims' mood diamond, in Naija green
    this.plumbob = new THREE.Mesh(new THREE.OctahedronGeometry(0.1, 0).scale(0.75, 1.6, 0.75), new THREE.MeshBasicMaterial({ color: 0x2ecc71, transparent: true, opacity: 0.85 }));
    d.scene.add(this.plumbob);

    this.life.onToast = (m, k) => this.ui.toast(m, k);
    this.life.onActivityEnd = () => this.endPose();
    this.life.onFaint = (placeId) => this.enter(placeById(placeId)!, { atSeat: 'reception' });
    this.ui.onSpeed = (i) => {
      if (this.life.running?.forced) return;
      this.life.speedIndex = i;
    };
    this.ui.onCancel = () => this.cancelActivity();
    this.ui.onInteract = () => this.interactNear();
    d.hud.onTravel = (x, z) => this.travelTo(x, z);
    window.addEventListener('keydown', (e) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
      if (e.code === 'KeyE' && !this.ui.menuOpen && !this.ui.modalOpen) this.interactNear();
      if (e.code === 'Space' && !this.ui.modalOpen) {
        this.life.speedIndex = this.life.speedIndex === 0 ? 1 : 0;
        e.preventDefault();
      }
      if (!this.ui.menuOpen && !this.ui.modalOpen && /^Digit[1-3]$/.test(e.code)) this.life.speedIndex = Number(e.code.slice(5));
    });
    addEventListener('beforeunload', () => this.save());

    // where to start
    const s = this.life.s;
    const home = this.doors.find((x) => x.place.id === 'home');
    if (d.params.has('at')) {
      const [x, z] = d.params.get('at')!.split(',').map(Number);
      s.location = 'city';
      this.player.teleport(x, z);
    } else if (s.location !== 'city' && placeById(s.location)) {
      this.player.teleport(home?.x ?? d.map.meta.spawn.x, home?.z ?? d.map.meta.spawn.z);
      this.enter(placeById(s.location)!, { quiet: true });
    } else if (s.x || s.z) {
      this.player.teleport(s.x, s.z);
    } else {
      this.player.teleport(home?.x ?? d.map.meta.spawn.x, home?.z ?? d.map.meta.spawn.z);
    }
    if (d.params.has('place') && placeById(d.params.get('place')!)) this.enter(placeById(d.params.get('place')!)!, { quiet: true });
    if (!saved && !d.params.has('nointro')) this.intro();
    else if (saved) this.ui.toast(`Welcome back! ${naira(s.money)} in your account.`, 'good');
    this.preloadCrowd();
  }

  private intro() {
    this.paused = true;
    this.ui.showModal(
      'Welcome to Yaba',
      `<p><b>Tunde</b> is 24 and just moved into a self-contain off Herbert Macaulay Way, Yaba. Rent is paid till Sunday. He has <b>${naira(this.life.s.money)}</b> and big dreams.</p>
       <p>Keep his needs up (food, sleep, bath, toilet, fun and friends), find a job, earn naira, pay Baba his rent every Saturday, and build a life.</p>
       <p class="dim">Move: WASD / arrows or the left thumb · Interact: <b>E</b> or ✋ · Phone: <b>P</b> · Map & travel: <b>M</b> · Time: Space / 1 2 3</p>`,
      [
        { label: 'Start my life in Yaba', icon: '🇳🇬', onPick: () => (this.paused = false) },
      ],
      false,
    );
  }

  newGame() {
    clearSave();
    location.search = '?new';
  }

  save() {
    const s = this.life.s;
    if (!this.interior) {
      s.x = this.player.position.x;
      s.z = this.player.position.z;
    }
    saveGame(s);
  }

  get state(): GameState {
    return this.life.s;
  }

  // ---------------------------------------------------------------------
  // crowd models

  private preloadCrowd() {
    // load crowd models one at a time after the game is up, so the first frame isn't delayed
    let i = 0;
    const next = () => {
      if (i >= CROWD_MODELS.length) return;
      const m = CROWD_MODELS[i++];
      Actor.create(m, { id: '', name: '', title: '', female: false, playful: 0.5 }).then(() => setTimeout(next, 200), () => setTimeout(next, 200));
    };
    setTimeout(next, 1500);
  }

  private async spawnPerson(def: PersonDef) {
    return Actor.create(def.model, { id: def.id, name: def.name, title: def.title, female: def.female, def, team: def.team, playful: def.playful });
  }

  private async spawnStranger(role?: string) {
    const seed = this.crowdSeed++;
    const model = CROWD_MODELS[(seed * 7 + Math.floor(Math.random() * 3)) % CROWD_MODELS.length];
    const female = FEMALE_MODELS.has(model);
    const name = randomName(female, seed * 13 + Math.floor(Math.random() * 100));
    return Actor.create(model, { id: '', name, title: role ?? randomJob(seed + name.length), female, playful: 0.3 + Math.random() * 0.6, team: (['Arsenal', 'Chelsea', 'Man United', 'Liverpool', null] as const)[seed % 5], tempRel: 0 }, seed);
  }

  // ---------------------------------------------------------------------
  // schedules

  private scheduledAt(def: PersonDef, m = this.life.s.minutes) {
    const h = hourOf(m);
    const wd = weekdayOf(m);
    for (const e of def.schedule) {
      // an entry that passes midnight belongs to the day it started
      const startedYesterday = e.to < e.from && h < e.to;
      const day = startedYesterday ? (wd + 6) % 7 : wd;
      if (e.days && !e.days.includes(day)) continue;
      if (openAt(h, e.from, e.to)) return e;
    }
    return null;
  }

  // ---------------------------------------------------------------------
  // entering and leaving

  private placeOpen(p: PlaceDef) {
    return openAt(this.life.hour, p.hours[0], p.hours[1]);
  }

  enter(place: PlaceDef, opts: { quiet?: boolean; atSeat?: string } = {}) {
    if (this.interior) this.leave(true);
    this.closeTalk();
    const d = this.d;
    const it = new InteriorScene(place);
    this.interior = it;
    this.life.s.location = place.id;
    this.save();
    d.scene.remove(d.character.root, this.plumbob);
    it.scene.add(d.character.root, this.plumbob);
    this.player.collider = it.collider;
    this.player.bounds = it.bounds;
    this.player.teleport(it.room.entry.x, it.room.entry.z, { free: true });
    this.player.heading = Math.PI;
    this.player.yaw = 0.35;
    this.player.pitch = 0.75;
    this.player.distance = 7.5;
    this.player.minDistance = 3;
    this.player.maxDistance = 13;
    d.camera.far = 80;
    d.camera.updateProjectionMatrix();
    if (!opts.quiet) this.ui.toast(`${place.name} · ${place.hours[0] === place.hours[1] ? 'open 24 hours' : `open ${fmtH(place.hours[0])}–${fmtH(place.hours[1])}`}`, 'info');
    this.populate(it);
    if (opts.atSeat) {
      const o = it.room.objects.find((x) => x.tag === opts.atSeat);
      if (o) this.player.teleport(o.x, o.z + 0.6, { free: true });
    }
  }

  private populate(it: InteriorScene) {
    const place = it.place;
    const here = PEOPLE.map((def) => ({ def, e: this.scheduledAt(def) })).filter((x) => x.e && x.e.place === place.id && x.e.role !== 'outside');
    const token = it;
    const add = (a: Actor) => {
      if (this.interior !== token) return;
      it.scene.add(a.root);
      this.interiorActors.push(a);
    };
    // staff spots: named staff first, then generic staff
    const staffNamed = here.filter((x) => x.e!.role === 'staff');
    it.room.staff.forEach((spot, i) => {
      const named = staffNamed[i];
      const p = named ? this.spawnPerson(named.def) : this.spawnStranger(place.kind === 'buka' ? 'Mama put' : place.kind === 'market' ? 'Trader' : 'Staff');
      p.then((a) => {
        a.place(spot.x, spot.z, spot.rot, named?.e?.clip ?? spot.clip);
        add(a);
      });
    });
    // named patrons (Kemi at her desk, Amaka in the library...)
    for (const x of here.filter((x) => x.e!.role === 'patron')) {
      const seat = it.freeSeat(0, 0, x.e!.clip === 'sit_work' ? (place.kind === 'office' ? 'desk' : 'books') : x.e!.clip === 'dance' ? 'dance' : undefined);
      if (!seat) continue;
      seat.taken = true;
      this.spawnPerson(x.def).then((a) => {
        a.place(seat.x, seat.z, seat.rot, x.e!.clip ?? 'sit', seat.y ?? 0);
        add(a);
      });
    }
    // fill with customers; fewer when it's late or closed
    const open = this.placeOpen(place);
    let n = open ? place.patrons ?? 0 : 0;
    const h = this.life.hour;
    if (place.kind === 'bar' || place.kind === 'lounge' || place.kind === 'club') n = Math.round(n * (h >= 19 || h < 3 ? 1.2 : 0.5));
    const seats = it.room.seats.filter((s) => !s.taken && s.kind !== 'bed').sort(() => Math.random() - 0.5);
    for (let i = 0; i < Math.min(n, seats.length - 1); i++) {
      const seat = seats[i];
      seat.taken = true;
      const clip: Clip = seat.group === 'dance' ? 'dance' : seat.kind === 'stand' ? 'work' : seat.group === 'desk' || seat.group === 'books' ? 'sit_work' : ['buka', 'restaurant', 'cafe'].includes(place.kind) ? 'sit_eat' : 'sit';
      this.spawnStranger().then((a) => {
        a.place(seat.x, seat.z, seat.rot, clip, seat.y ?? 0);
        add(a);
      });
    }
  }

  leave(silent = false) {
    const it = this.interior;
    if (!it) return;
    this.closeTalk();
    if (this.life.running && !this.life.running.work) this.life.stop(false);
    const d = this.d;
    for (const a of this.interiorActors) it.scene.remove(a.root);
    this.interiorActors = [];
    it.scene.remove(d.character.root, this.plumbob);
    d.scene.add(d.character.root, this.plumbob);
    it.dispose();
    this.interior = null;
    this.player.collider = d.city.buildings;
    this.player.bounds = d.map.meta.bounds;
    this.player.minDistance = 2.2;
    this.player.maxDistance = 40;
    this.player.distance = 5.5;
    this.player.pitch = 0.32;
    d.camera.far = 1300;
    d.camera.updateProjectionMatrix();
    const door = this.doors.find((x) => x.place.id === it.place.id);
    this.life.s.location = 'city';
    if (door) {
      this.player.teleport(door.x + door.nx * 0.8, door.z + door.nz * 0.8, { free: true });
      this.player.heading = Math.atan2(door.nx, door.nz);
      // look along the street rather than into the wall behind
      this.player.yaw = this.player.heading + Math.PI + 1.1;
    }
    if (!silent) this.save();
  }

  // ---------------------------------------------------------------------
  // activities

  private offersFor(place: PlaceDef, tag: Tag): Offer[] {
    return place.offers[tag] ?? [];
  }

  private startOffer(o: Offer, place: PlaceDef | null, at?: { x: number; z: number; tag?: Tag }) {
    const why = this.life.blocked(o);
    if (why) {
      this.ui.toast(why, 'bad');
      return;
    }
    if (o.special === 'payrent') {
      this.life.payRent();
      return;
    }
    if (o.special === 'sleep' && place?.id === 'home' && this.life.lockedOut()) {
      this.ui.toast('Baba has locked the room. Pay your rent first!', 'bad');
      return;
    }
    this.life.start(o, place?.id ?? 'city');
    this.applyPose(o, at?.tag);
  }

  private applyPose(o: Offer, tag?: Tag) {
    const p = this.player;
    const it = this.interior;
    p.locked = true;
    if (it && (o.at === 'seat' || o.at === 'bed')) {
      const seat = it.freeSeat(p.position.x, p.position.z, tag, o.at === 'bed' ? 'bed' : undefined);
      if (seat) {
        seat.taken = true;
        this.seat = seat;
        p.teleport(seat.x, seat.z, { free: true });
        p.heading = seat.kind === 'bed' ? 0 : seat.rot;
        p.rootY = seat.y ?? 0;
      }
    }
    p.lying = o.clip === 'lie';
    if (p.lying && !this.seat) p.rootY = 0.12;
    const clip = o.clip ?? 'idle';
    this.d.character.pose = clip === 'idle' ? null : clip;
    if (this.seat?.kind === 'stand' && clip.startsWith('sit')) this.d.character.pose = 'idle';
  }

  private endPose() {
    const p = this.player;
    p.locked = false;
    p.lying = false;
    p.rootY = 0;
    this.d.character.pose = null;
    this.d.character.root.visible = true;
    if (this.seat) {
      this.seat.taken = false;
      // stand up beside the chair
      const s = this.seat;
      const fx = s.kind === 'bed' ? 0.9 : Math.sin(s.rot) * 0.55;
      const fz = s.kind === 'bed' ? 0.3 : Math.cos(s.rot) * 0.55;
      const [x, z] = this.player.collider.resolve(s.x + fx, s.z + fz, 0.3);
      p.teleport(x, z, { free: true });
      this.seat = null;
    }
    this.save();
  }

  private cancelActivity() {
    const r = this.life.running;
    if (!r || r.forced) return;
    this.life.stop(false);
  }

  // ---------------------------------------------------------------------
  // work

  private workOption(placeId: string): MenuOption | null {
    const j = this.life.job();
    if (!j || j.place !== placeId) return null;
    const why = this.life.shiftBlocked();
    return {
      label: `Start shift: ${j.levels[this.life.s.job!.level].title}`,
      icon: '💼',
      detail: `${fmtH(j.start)}–${fmtH(j.start + j.hours)} · ${naira(j.levels[this.life.s.job!.level].pay)}`,
      disabled: why,
      onPick: () => this.chooseWorkStyle(),
    };
  }

  private chooseWorkStyle() {
    const j = this.life.job()!;
    this.ui.showModal(
      `Work at ${j.name}`,
      `<p>How should Tunde work today? Mood affects performance (now: <b>${this.life.moodLabel().text}</b>).</p>`,
      (Object.keys(WORK_STYLES) as WorkStyle[]).map((k) => ({
        label: WORK_STYLES[k].label,
        icon: k === 'hard' ? '💪' : k === 'normal' ? '🙂' : '🗣️',
        detail: k === 'hard' ? 'Faster promotion, more tiring' : k === 'gist' ? 'Fills Social, slower promotion' : 'Steady',
        onPick: () => this.goToWork(k),
      })),
    );
  }

  private goToWork(style: WorkStyle) {
    const j = this.life.job()!;
    this.life.startShift(style);
    const it = this.interior;
    const p = this.player;
    p.locked = true;
    if (it) {
      // work at a desk or behind the counter
      const seat = j.id === 'tech' ? it.freeSeat(p.position.x, p.position.z, 'desk') : null;
      if (seat) {
        seat.taken = true;
        this.seat = seat;
        p.teleport(seat.x, seat.z, { free: true });
        p.heading = seat.rot;
        this.d.character.pose = 'sit_work';
      } else {
        const spot = it.room.staff[it.room.staff.length > 1 ? 1 : 0];
        if (spot) {
          p.teleport(spot.x + 0.7, spot.z, { free: true });
          p.heading = spot.rot;
        }
        this.d.character.pose = j.id === 'bar' ? 'work' : 'talk';
      }
    } else {
      // the danfo leaves with Tunde on it: a "rabbit hole" like The Sims
      this.d.character.root.visible = false;
      this.ui.toast('Tunde jumped on the danfo. "Obalende! CMS! Enter with your change!"', 'info');
    }
  }

  // ---------------------------------------------------------------------
  // talking

  private talkTo(actor: Actor) {
    const t = actor.talker;
    this.talking = { actor, talker: t };
    actor.faceTowards(this.player.position.x, this.player.position.z);
    this.player.heading = Math.atan2(actor.position.x - this.player.position.x, actor.position.z - this.player.position.z);
    const rel = t.id ? this.life.s.relationships[t.id] ?? 0 : t.tempRel ?? 0;
    const first = t.id ? !this.life.s.metNpcs.includes(t.id) : (t.tempRel ?? 0) === 0;
    this.showTalk(first ? {} : { them: t.def?.greeting[0] ?? 'How far?' }, rel);
  }

  private showTalk(lines: { tunde?: string; them?: string }, rel: number) {
    const tk = this.talking;
    if (!tk) return;
    const t = tk.talker;
    const def = t.def;
    const acts: MenuOption[] = ACTS.map((a) => ({
      label: a.label,
      icon: a.icon,
      disabled: a.minRel !== undefined && rel < a.minRel ? `Needs friendship ${a.minRel}+` : null,
      onPick: () => this.doSocial(a.id),
    }));
    if (def?.hires) {
      const j = jobById(def.hires);
      const mine = this.life.s.job?.id === j.id;
      acts.unshift({
        label: mine ? `About my job (${j.levels[this.life.s.job!.level].title})` : `Ask for work: ${j.levels[0].title}`,
        icon: '💼',
        disabled: !mine && rel < -10 ? 'They don\'t like you enough' : null,
        onPick: () => {
          if (mine) {
            const perf = this.life.s.job!.performance;
            this.showTalk({ tunde: 'How I dey do for work?', them: perf > 60 ? 'You dey try well well! Promotion dey come.' : perf > 0 ? 'You dey manage. Put more effort.' : 'Ehn, you need to sit up o!' }, rel);
          } else {
            const err = this.life.hire(j.id);
            this.showTalk({ tunde: 'Abeg, una dey hire?', them: err ?? `Okay, you fit start. ${j.blurb}` }, this.life.relate(t.id, err ? 0 : 5));
          }
        },
      });
    }
    for (const o of def?.sells ?? []) {
      acts.unshift({ label: `${o.label} (${naira(o.price ?? 0)})`, icon: o.icon, disabled: this.life.blocked(o), onPick: () => {
        this.closeTalk();
        this.startOffer(o, null);
      } });
    }
    if (def?.id === 'baba_landlord') {
      const over = this.life.rentOverdue();
      acts.unshift({ label: `Pay rent (${naira(RENT_WEEKLY)})${over ? ` · ${over} day(s) late` : ''}`, icon: '🏠', onPick: () => {
        const ok = this.life.payRent();
        this.showTalk({ tunde: 'Baba, here is your rent.', them: ok ? 'Ehen! God bless you, my son.' : 'Where the money? Come back when you get am.' }, this.life.s.relationships.baba_landlord ?? 0);
      } });
    }
    this.ui.dialogue({ name: t.name, title: t.title, rel, label: relLabel(rel) }, lines, acts);
  }

  private doSocial(actId: string) {
    const tk = this.talking;
    if (!tk) return;
    const r = interact(this.life, tk.talker, actId);
    tk.actor.talking = 2.5;
    this.d.character.pose = 'talk';
    this.talkPoseT = 2.5;
    this.showTalk({ tunde: r.tunde, them: r.reply }, r.rel);
    if (actId === 'shade' && r.rel < -30) setTimeout(() => this.closeTalk(), 1500);
  }

  private talkPoseT = 0;

  private closeTalk() {
    this.talking = null;
    this.ui.hideDialogue();
  }

  // ---------------------------------------------------------------------
  // travel

  travelTo(x: number, z: number) {
    if (this.life.running?.work) {
      this.ui.toast('You are at work!', 'bad');
      return;
    }
    const from = this.interior ? this.doors.find((dd) => dd.place.id === this.interior!.place.id) ?? this.player.position : this.player.position;
    const dist = Math.hypot(x - from.x, z - from.z);
    const h = this.life.hour;
    const rush = (h >= 6 && h < 10) || (h >= 16 && h < 21);
    const go = (mins: number, cost: number, what: string, msg: string) => {
      if (cost && !this.life.canAfford(cost)) return;
      if (cost) this.life.pay(cost, what);
      if (this.interior) this.leave(true);
      if (this.life.running) this.life.stop(false);
      this.life.s.minutes += mins;
      this.player.teleport(x, z);
      this.ui.toast(msg, 'info');
      this.save();
    };
    const km = dist / 1000;
    const danfo = Math.max(300, Math.round((200 + km * 150) / 50) * 50);
    const keke = Math.max(400, Math.round((300 + km * 350) / 50) * 50);
    const bolt = Math.round((1500 + km * 1100) / 100) * 100;
    const slow = rush ? 2.2 : 1;
    const dm = Math.round(10 + (km / 18) * 60 * slow);
    const km2 = Math.round((km / 15) * 60 * slow + 4);
    const bm = Math.round(6 + (km / 22) * 60 * (rush ? 1.8 : 1));
    const opts: MenuOption[] = [
      { label: 'Walk there (free)', icon: '🚶', detail: `About ${Math.round((dist / 1.4) / 60)} min of game time, arrive instantly`, onPick: () => go(Math.round(dist / 1.4 / 60), 0, '', 'You trekked there. Legs dey pain small.') },
      { label: `Danfo · ${naira(danfo)}`, icon: '🚌', detail: `${dm} min${rush ? ' (rush-hour go-slow!)' : ''}`, disabled: this.life.canAfford(danfo) ? null : 'Not enough money', onPick: () => go(dm, danfo, 'Danfo fare', rush ? 'Go-slow at Ojuelegba... but you reached. "Owa o!"' : '"Owa o!" Conductor dropped you.') },
      { label: `Keke · ${naira(keke)}`, icon: '🛺', detail: `${km2} min, inner streets`, disabled: this.life.canAfford(keke) ? null : 'Not enough money', onPick: () => go(km2, keke, 'Keke fare', 'Keke rider dropped you. "Na ₦' + keke + ' o, no be ₦' + (keke - 100) + '!"') },
      { label: `Bolt ride · ${naira(bolt)}`, icon: '🚗', detail: `${bm} min, with AC`, disabled: this.life.canAfford(bolt) ? null : 'Not enough money', onPick: () => go(bm, bolt, 'Bolt ride', 'Bolt driver: "Abeg rate me 5 stars."') },
    ];
    if (dist < 150) opts.splice(1);
    this.ui.showModal(`Go ${dist < 1000 ? `${Math.round(dist)} m` : `${(dist / 1000).toFixed(1)} km`}`, `<p>It's ${clockText(this.life.s.minutes)}${rush ? ', rush hour. Lagos traffic is no joke.' : '.'}</p>`, opts);
  }

  // ---------------------------------------------------------------------
  // interactions

  private gather(): Interactable[] {
    const out: Interactable[] = [];
    const p = this.player.position;
    const it = this.interior;
    const actors = it ? this.interiorActors : [...this.walkers, ...this.cityNpcs.map((c) => c.actor).filter((a): a is Actor => !!a && a.root.visible)];
    for (const a of actors) {
      if (a.lying) continue;
      out.push({ label: `Talk to ${a.talker.name}${a.talker.def ? '' : ` (${a.talker.title})`}`, x: a.position.x, z: a.position.z, r: 2.0, act: () => this.talkTo(a) });
    }
    if (it) {
      const place = it.place;
      for (const o of it.room.objects) {
        const offers = this.offersFor(place, o.tag);
        const work = this.workOption(place.id);
        if (!offers.length && !work) continue;
        out.push({ label: o.label, x: o.x, z: o.z, r: o.r, act: () => this.objectMenu(place, o.tag, o.label) });
      }
      const { D } = it.room;
      out.push({ label: 'Leave', x: 0, z: D / 2 - 0.4, r: 1.1, act: () => this.leave() });
    } else {
      for (const dd of this.doors) {
        if (Math.abs(dd.x - p.x) > 4 || Math.abs(dd.z - p.z) > 4) continue;
        const open = this.placeOpen(dd.place);
        out.push({
          label: open ? `Enter ${dd.place.name}` : `${dd.place.name} (closed, opens ${fmtH(dd.place.hours[0])})`,
          x: dd.x, z: dd.z, r: 2.4,
          act: () => {
            if (!open) {
              this.ui.toast(`${dd.place.name} is closed. Opens ${fmtH(dd.place.hours[0])}.`, 'bad');
              return;
            }
            if (dd.place.id === 'home' && this.life.lockedOut()) {
              this.ui.toast('Baba has locked your room! Pay your rent to him outside.', 'bad');
              return;
            }
            this.enter(dd.place);
          },
        });
      }
      for (const h of this.hubs) {
        out.push({ label: h.name, x: h.x, z: h.z, r: 14, act: () => this.hubMenu(h) });
      }
    }
    return out;
  }

  private objectMenu(place: PlaceDef, tag: Tag, label: string) {
    const opts: MenuOption[] = this.offersFor(place, tag).map((o) => ({
      label: o.label,
      icon: o.icon,
      detail: [o.price ? naira(o.price) : '', o.minutes >= 60 ? `${Math.round(o.minutes / 6) / 10} h` : `${o.minutes} min`].filter(Boolean).join(' · '),
      disabled: this.life.blocked(o),
      onPick: () => this.startOffer(o, place, { x: 0, z: 0, tag }),
    }));
    if (tag === 'door_landlord') opts[0].detail = this.life.rentOverdue() ? `${this.life.rentOverdue()} day(s) overdue` : `Paid through Day ${this.life.s.rentPaidThroughDay + 1}`;
    const work = this.workOption(place.id);
    if (work && ['counter', 'desk', 'rack'].includes(tag)) opts.unshift(work);
    this.ui.showMenu(label, place.name, opts);
  }

  private hubMenu(h: { name: string; landmark: string; x: number; z: number }) {
    const opts: MenuOption[] = [];
    const work = this.workOption(h.landmark);
    if (work) opts.push(work);
    opts.push({
      label: STREET_HUSTLE.label, icon: STREET_HUSTLE.icon, detail: '2 h · earn about ₦1,800+',
      disabled: this.life.blocked(STREET_HUSTLE) ?? (this.life.hour < 6 || this.life.hour >= 20 ? 'Only 6am–8pm' : null),
      onPick: () => this.startOffer({ ...STREET_HUSTLE, clip: 'talk' }, null),
    });
    opts.push({ label: 'Take a danfo somewhere (open map)', icon: '🚌', onPick: () => document.querySelector<HTMLButtonElement>('#hud .mapbtn')?.click() });
    this.ui.showMenu(h.name, 'Danfo hub', opts);
  }

  private interactNear() {
    if (this.life.running) return;
    if (this.ui.dialogueOpen) {
      this.closeTalk();
      return;
    }
    if (this.near) this.near.act();
  }

  // ---------------------------------------------------------------------
  // per frame

  update(dt: number) {
    this.time += dt;
    const d = this.d;
    if (!this.paused && !this.ui.modalOpen) this.life.update(dt);
    // moving cancels an activity, like clicking away in The Sims
    if (this.life.running && !this.life.running.forced && this.player.wantsToMove() && !this.life.running.work) this.cancelActivity();
    if (this.talking && (this.player.wantsToMove() || Math.hypot(this.talking.actor.position.x - this.player.position.x, this.talking.actor.position.z - this.player.position.z) > 4)) this.closeTalk();
    if (this.talkPoseT > 0) {
      this.talkPoseT -= dt;
      if (this.talkPoseT <= 0 && !this.life.running) d.character.pose = null;
    }
    if (this.talking) this.talking.actor.talking = Math.max(this.talking.actor.talking, 0.5);
    this.player.update(dt);

    const p = this.player.position;
    d.sky.time = this.life.hour;
    if (this.interior) {
      this.interior.update(dt, d.camera, this.interior.place.id !== 'home' || this.life.lightOn());
      for (const a of this.interiorActors) a.update(dt, Math.hypot(a.position.x - p.x, a.position.z - p.z));
      d.renderer.setClearColor(this.interior.scene.background as THREE.Color);
    } else {
      this.doorVis.update(p.x, p.z, this.time);
      this.updateCityNpcs(dt);
    }

    // plumbob above Tunde's head, coloured by mood
    const pb = this.plumbob;
    pb.visible = d.character.root.visible;
    const top = this.player.lying ? this.player.rootY + 0.5 : this.player.rootY + (d.character.pose?.startsWith('sit') ? 1.7 : 2.15);
    pb.position.set(p.x, top + Math.sin(this.time * 2) * 0.04, p.z);
    pb.rotation.y += dt * 1.5;
    (pb.material as THREE.MeshBasicMaterial).color.set(this.life.moodLabel().color);

    // nearest interactable
    let best: Interactable | null = null;
    let bd = Infinity;
    if (!this.life.running) {
      for (const it of this.gather()) {
        const dd = Math.hypot(it.x - p.x, it.z - p.z);
        if (dd < it.r && dd < bd) {
          bd = dd;
          best = it;
        }
      }
    }
    this.near = best;
    // walking out through the door leaves the building
    if (this.interior && p.z > this.interior.room.D / 2 + 0.25 && !this.life.running) this.leave();

    this.uiAcc += dt;
    if (this.uiAcc > 0.15) {
      this.uiAcc = 0;
      this.ui.update();
      this.ui.prompt(this.talking ? null : best?.label ?? null);
      this.ui.updateWants();
    }
    this.saveAcc += dt;
    if (this.saveAcc > 15) {
      this.saveAcc = 0;
      this.save();
    }
    d.lamp.intensity = this.interior ? 0 : cityUniforms.uNight.value * 9;
  }

  get activeScene() {
    return this.interior?.scene ?? this.d.scene;
  }

  get inside() {
    return !!this.interior;
  }

  get insideName() {
    return this.interior?.place.name ?? null;
  }

  // ---------------------------------------------------------------------
  // city people: named regulars at their spots, plus passers-by

  private updateCityNpcs(dt: number) {
    const p = this.player.position;
    const d = this.d;
    for (const c of this.cityNpcs) {
      const e = this.scheduledAt(c.def);
      const spot = e && e.role === 'outside' ? this.outdoorSpot(c.def, e.place) : null;
      const near = spot && Math.hypot(spot.x - p.x, spot.z - p.z) < 160;
      if (near && !c.actor && !c.loading) {
        c.loading = true;
        this.spawnPerson(c.def).then((a) => {
          c.loading = false;
          if (this.interior) return;
          c.actor = a;
          a.place(spot!.x, spot!.z, spot!.rot, e!.clip ?? 'idle');
          d.scene.add(a.root);
          if (spot!.prop) d.scene.add(spot!.prop);
          a.root.userData.prop = spot!.prop;
        });
      } else if (!near && c.actor) {
        d.scene.remove(c.actor.root);
        if (c.actor.root.userData.prop) d.scene.remove(c.actor.root.userData.prop);
        c.actor = null;
      }
      if (c.actor) c.actor.update(dt, Math.hypot(c.actor.position.x - p.x, c.actor.position.z - p.z));
    }
    // passers-by
    const night = this.life.hour < 6 || this.life.hour > 22;
    const want = Math.round((d.quality.viewDistance > 500 ? 10 : 6) * (night ? 0.4 : 1));
    this.walkerAcc += dt;
    if (this.walkerAcc > 0.7) {
      this.walkerAcc = 0;
      for (const w of [...this.walkers]) {
        const far = Math.hypot(w.position.x - p.x, w.position.z - p.z) > 120;
        if (far || w.pathIdx >= w.path.length) {
          d.scene.remove(w.root);
          this.walkers.splice(this.walkers.indexOf(w), 1);
        }
      }
      if (this.walkers.length < want && !this.spawningWalker) {
        const route = this.streets.route(p.x, p.z, 25, 75);
        if (route) {
          this.spawningWalker = true;
          this.spawnStranger().then((a) => {
            this.spawningWalker = false;
            if (this.interior) return;
            a.place(route[0].x, route[0].y, 0, 'idle');
            a.walk(route);
            d.scene.add(a.root);
            this.walkers.push(a);
          }, () => (this.spawningWalker = false));
        }
      }
    }
    for (const w of this.walkers) w.update(dt, Math.hypot(w.position.x - p.x, w.position.z - p.z));
  }

  private spawningWalker = false;
  private spotCache = new Map<string, { x: number; z: number; rot: number; prop?: THREE.Object3D }>();

  private outdoorSpot(def: PersonDef, placeId: string) {
    const key = `${def.id}:${placeId}`;
    const c = this.spotCache.get(key);
    if (c) return c;
    let spot: { x: number; z: number; rot: number; prop?: THREE.Object3D } | null = null;
    const door = this.doors.find((x) => x.place.id === placeId);
    if (door) {
      // stand beside the door, facing the street
      const tx = -door.nz;
      const tz = door.nx;
      const side = def.id === 'sani' ? 3.2 : 1.8;
      const x = door.x + tx * side + door.nx * 0.6;
      const z = door.z + tz * side + door.nz * 0.6;
      spot = { x, z, rot: Math.atan2(door.nx, door.nz) };
      if (def.id === 'baba_landlord') spot.prop = chairProp(x, z, spot.rot);
      if (def.id === 'sani') spot.prop = suyaStand(x + door.nx * 0.8, z + door.nz * 0.8, spot.rot);
    } else {
      const lm = this.d.map.meta.landmarks.find((l) => l.id === placeId);
      if (lm) {
        const [x, z] = this.d.city.buildings.resolve(lm.x + 4, lm.z + 3, 0.6);
        spot = { x, z, rot: 0 };
      }
    }
    if (spot) this.spotCache.set(key, spot);
    return spot ?? { x: 0, z: 0, rot: 0 };
  }

  /** for the phone and debugging */
  debugPlaces() {
    return { doors: this.doors.map((d) => ({ id: d.place.id, x: Math.round(d.x), z: Math.round(d.z) })), jobs: JOBS.map((j) => j.id), places: PLACES.length };
  }

  get personAt() {
    return personById;
  }
}

function chairProp(x: number, z: number, rot: number) {
  const g = new THREE.Group();
  const m = new THREE.MeshLambertMaterial({ color: 0xc0392b });
  const seat = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.05, 0.44), m);
  seat.position.y = 0.44;
  const back = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.5, 0.05), m);
  back.position.set(0, 0.7, -0.22);
  g.add(seat, back);
  for (const [lx, lz] of [[-0.2, -0.19], [0.2, -0.19], [-0.2, 0.19], [0.2, 0.19]]) {
    const l = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.43, 0.04), m);
    l.position.set(lx, 0.215, lz);
    g.add(l);
  }
  g.position.set(x, 0, z);
  g.rotation.y = rot;
  return g;
}

/** Mallam Sani's roadside grill: a drum barbecue with skewers and a glowing bed of coals. */
function suyaStand(x: number, z: number, rot: number) {
  const g = new THREE.Group();
  const drum = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 0.8, 12, 1, false, 0, Math.PI), new THREE.MeshLambertMaterial({ color: 0x2c2c2c, side: THREE.DoubleSide }));
  drum.rotation.z = Math.PI / 2;
  drum.position.y = 0.8;
  const coals = new THREE.Mesh(new THREE.BoxGeometry(0.75, 0.05, 0.6), new THREE.MeshBasicMaterial({ color: 0xff5a1f }));
  coals.position.y = 0.82;
  const grill = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.02, 0.7), new THREE.MeshLambertMaterial({ color: 0x777777 }));
  grill.position.y = 0.9;
  g.add(drum, coals, grill);
  for (let i = 0; i < 6; i++) {
    const s = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.04, 0.5), new THREE.MeshLambertMaterial({ color: 0x7b3f1d }));
    s.position.set(-0.3 + i * 0.12, 0.93, 0);
    g.add(s);
  }
  for (const lx of [-0.35, 0.35]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.6, 0.05), new THREE.MeshLambertMaterial({ color: 0x333333 }));
    leg.position.set(lx, 0.3, 0);
    g.add(leg);
  }
  // a hurricane lamp glow for night trade
  const glow = new THREE.PointLight(0xffa040, 2.5, 7, 1.6);
  glow.position.set(0, 1.6, 0);
  g.add(glow);
  // umbrella
  const um = new THREE.Mesh(new THREE.ConeGeometry(1.2, 0.45, 8, 1, true), new THREE.MeshLambertMaterial({ color: 0xc0392b, side: THREE.DoubleSide }));
  um.position.y = 2.3;
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 2.3, 6), new THREE.MeshLambertMaterial({ color: 0xcccccc }));
  pole.position.set(0.45, 1.15, -0.2);
  um.position.x = 0.45;
  um.position.z = -0.2;
  g.add(um, pole);
  g.position.set(x, 0, z);
  g.rotation.y = rot;
  return g;
}
