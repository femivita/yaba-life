import { JOBS, WORK_STYLES, jobById, type WorkStyle } from './Jobs';
import type { Offer } from './Places';
import {
  DECAY, NEEDS, NEED_INFO, RENT_WEEKLY, SKILL_INFO, dayOf, hourOf, naira, skillXpFor, weekdayOf,
  type GameState, type Need, type Skill,
} from './State';

export type ToastKind = 'info' | 'good' | 'bad' | 'money' | 'level';

export interface Running {
  offer: Offer;
  placeId: string;
  label: string;
  icon: string;
  total: number;
  elapsed: number;
  /** pays at the end, for work shifts and hustles */
  work?: { jobId: string; style: WorkStyle; late: number; nextEvent: number };
  hawk?: boolean;
  forced?: boolean;
}

export interface Want {
  id: string;
  label: string;
  icon: string;
  reward: number;
  done: (s: GameState, life: Life) => boolean;
}

export const WANTS: Want[] = [
  { id: 'eat_amala', label: 'Eat amala at White House', icon: '🍲', reward: 1000, done: (s) => (s.stats['white_house:amala'] ?? 0) > 0 },
  { id: 'get_job', label: 'Get a job', icon: '💼', reward: 2000, done: (s) => !!s.job },
  { id: 'first_pay', label: 'Collect your first pay', icon: '💵', reward: 1000, done: (s) => (s.stats.shifts ?? 0) > 0 },
  { id: 'watch_match', label: 'Watch a match at a bar', icon: '⚽', reward: 1000, done: (s) => (s.stats.match ?? 0) > 0 },
  { id: 'make_friend', label: 'Make a friend in Yaba', icon: '🤝', reward: 1500, done: (s) => Object.entries(s.relationships).some(([k, v]) => k !== 'baba_landlord' && v >= 40) },
  { id: 'cook', label: 'Cook at home', icon: '🍳', reward: 500, done: (s) => (s.stats.indomie ?? 0) + (s.stats.cookjollof ?? 0) > 0 },
  { id: 'ozone', label: 'Watch a film at Ozone Cinemas', icon: '🎬', reward: 1500, done: (s) => (s.stats.movie ?? 0) > 0 },
  { id: 'pay_rent', label: 'Pay rent to Baba', icon: '🏠', reward: 1000, done: (s) => (s.stats.payrent ?? 0) > 0 },
  { id: 'coding3', label: 'Reach Coding level 3', icon: '💻', reward: 3000, done: (s) => s.skills.coding.level >= 3 },
  { id: 'party', label: 'Party at a club', icon: '🪩', reward: 1500, done: (s) => (s.stats.entry ?? 0) > 0 },
  { id: 'promotion', label: 'Get promoted', icon: '📈', reward: 5000, done: (s) => (s.stats.promotions ?? 0) > 0 },
  { id: 'jollof', label: 'Cook party jollof', icon: '🍛', reward: 2000, done: (s) => (s.stats.cookjollof ?? 0) > 0 },
  { id: 'save100k', label: 'Save ₦100,000', icon: '🏦', reward: 5000, done: (s) => s.money >= 100000 },
  { id: 'best_friend', label: 'Have a best friend', icon: '💚', reward: 5000, done: (s) => Object.values(s.relationships).some((v) => v >= 80) },
  { id: 'save500k', label: 'Soft life: save ₦500,000', icon: '✨', reward: 20000, done: (s) => s.money >= 500000 },
];

/** game minutes per real second for each speed setting */
export const SPEEDS = [0, 1, 4, 12];

/**
 * The simulation: advances time, decays needs, runs the current activity,
 * and handles jobs, rent, NEPA and need failures. UI and world listen via
 * the callbacks.
 */
export class Life {
  running: Running | null = null;
  speedIndex = 1;
  onToast: (msg: string, kind?: ToastKind) => void = () => {};
  /** called when a need failure moves Tunde (hospital) */
  onFaint: (placeId: string) => void = () => {};
  onActivityEnd: (r: Running, completed: boolean) => void = () => {};
  private lastDay: number;
  private lastLight: boolean;
  private warned = new Set<string>();

  constructor(public s: GameState) {
    this.lastDay = dayOf(s.minutes);
    this.lastLight = this.lightOn();
  }

  get day() {
    return dayOf(this.s.minutes);
  }
  get hour() {
    return hourOf(this.s.minutes);
  }
  get weekday() {
    return weekdayOf(this.s.minutes);
  }

  /** game minutes per real second right now */
  get rate() {
    if (this.running) {
      const r = this.running;
      if (r.work) return 36;
      return Math.max(SPEEDS[this.speedIndex] || 0, r.offer.speed ?? 8);
    }
    return SPEEDS[this.speedIndex];
  }

  // ---------------------------------------------------------------------
  // mood

  mood() {
    const n = this.s.needs;
    let m = NEEDS.reduce((a, k) => a + n[k], 0) / NEEDS.length;
    for (const k of NEEDS) if (n[k] < 20) m -= 7;
    for (const b of this.s.buffs) m += b.mood;
    if (this.s.money < 3000) m -= 8; // sapa
    if (this.rentOverdue() > 0) m -= 5;
    return Math.max(0, Math.min(100, m));
  }

  moodLabel() {
    const m = this.mood();
    if (m >= 72) return { text: 'Happy', color: '#2ecc71' };
    if (m >= 50) return { text: 'Fine', color: '#a3d977' };
    if (m >= 30) return { text: 'Uncomfortable', color: '#f1c40f' };
    return { text: 'Miserable', color: '#e74c3c' };
  }

  /** short "moodlet" list like The Sims, for the needs panel */
  moodlets() {
    const out: { label: string; mood: number }[] = [];
    const n = this.s.needs;
    for (const k of NEEDS) if (n[k] < 20) out.push({ label: NEED_INFO[k].low.split(':').pop()!.trim(), mood: -7 });
    if (this.s.money < 3000) out.push({ label: 'Sapa: almost broke', mood: -8 });
    if (this.rentOverdue() > 0) out.push({ label: `Rent is ${this.rentOverdue()} day(s) late`, mood: -5 });
    for (const b of this.s.buffs) out.push({ label: b.label, mood: b.mood });
    return out;
  }

  // ---------------------------------------------------------------------
  // money, skills, relationships

  canAfford(n: number) {
    return this.s.money >= n;
  }

  pay(amount: number, what: string) {
    this.s.money -= amount;
    this.s.ledger.unshift({ t: this.s.minutes, amount: -amount, what });
    this.s.ledger.length = Math.min(this.s.ledger.length, 60);
  }

  earn(amount: number, what: string) {
    this.s.money += amount;
    this.s.ledger.unshift({ t: this.s.minutes, amount, what });
    this.s.ledger.length = Math.min(this.s.ledger.length, 60);
    this.onToast(`+${naira(amount)} · ${what}`, 'money');
  }

  addXp(skill: Skill, xp: number) {
    const sk = this.s.skills[skill];
    if (sk.level >= 10) return;
    sk.xp += xp;
    while (sk.level < 10 && sk.xp >= skillXpFor(sk.level)) {
      sk.xp -= skillXpFor(sk.level);
      sk.level++;
      this.onToast(`${SKILL_INFO[skill].icon} ${SKILL_INFO[skill].label} is now level ${sk.level}!`, 'level');
    }
  }

  relate(npc: string, delta: number) {
    const r = this.s.relationships;
    r[npc] = Math.max(-100, Math.min(100, (r[npc] ?? 0) + delta));
    if (!this.s.metNpcs.includes(npc)) this.s.metNpcs.push(npc);
    return r[npc];
  }

  addBuff(label: string, mood: number, hours: number) {
    this.s.buffs = this.s.buffs.filter((b) => b.label !== label);
    this.s.buffs.push({ id: label, label, mood, until: this.s.minutes + hours * 60 });
  }

  // ---------------------------------------------------------------------
  // home: rent and NEPA

  rentOverdue() {
    return Math.max(0, this.day - this.s.rentPaidThroughDay);
  }

  lockedOut() {
    return this.rentOverdue() > 7;
  }

  payRent() {
    if (!this.canAfford(RENT_WEEKLY)) {
      this.onToast(`Rent is ${naira(RENT_WEEKLY)}. You don't have it yet.`, 'bad');
      return false;
    }
    this.pay(RENT_WEEKLY, 'Weekly rent to Baba');
    this.s.rentPaidThroughDay = Math.max(this.s.rentPaidThroughDay, this.day - 1) + 7;
    this.s.stats.payrent = (this.s.stats.payrent ?? 0) + 1;
    this.relate('baba_landlord', 8);
    this.onToast(`Rent paid through ${['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'][this.s.rentPaidThroughDay % 7]} of next week. Baba is happy.`, 'good');
    return true;
  }

  /** NEPA ("light"): on for roughly 55% of 3-hour blocks, decided per block */
  lightOn(m = this.s.minutes) {
    if (m < this.s.genFuelUntil) return true;
    const block = Math.floor(m / 180);
    let h = (block * 2654435761) >>> 0;
    h ^= h >>> 15;
    h = Math.imul(h, 0x2c1b3c6d) >>> 0;
    return (h % 100) < 55;
  }

  // ---------------------------------------------------------------------
  // activities

  /** Why an offer can't be done right now, or null if it can. */
  blocked(o: Offer, placeHours?: [number, number]): string | null {
    if (o.price && !this.canAfford(o.price)) return `Needs ${naira(o.price)}`;
    for (const [k, v] of Object.entries(o.use ?? {})) if ((this.s.inventory[k] ?? 0) < v) return k === 'foodstuff' ? 'No foodstuff. Buy some at a market' : k === 'snack' ? 'No snacks left' : `Needs ${k}`;
    const hrs = o.hours;
    if (hrs) {
      const h = this.hour;
      const ok = hrs[0] < hrs[1] ? h >= hrs[0] && h < hrs[1] : h >= hrs[0] || h < hrs[1];
      if (!ok) return `Only ${fmtH(hrs[0])}–${fmtH(hrs[1])}`;
    }
    if (o.needsLight && !this.lightOn()) return 'NEPA took light';
    if (o.id === 'cookjollof' && this.s.skills.cooking.level < 3) return 'Needs Cooking level 3';
    void placeHours;
    return null;
  }

  start(o: Offer, placeId: string, opts: { forced?: boolean } = {}) {
    if (this.running) this.stop(false);
    if (o.price) this.pay(o.price, o.label);
    for (const [k, v] of Object.entries(o.use ?? {})) this.s.inventory[k] = (this.s.inventory[k] ?? 0) - v;
    this.running = { offer: o, placeId, label: o.label, icon: o.icon, total: o.minutes, elapsed: 0, forced: opts.forced, hawk: o.id === 'hawk' };
  }

  stop(completed: boolean) {
    const r = this.running;
    if (!r) return;
    this.running = null;
    const o = r.offer;
    if (completed) {
      for (const [k, v] of Object.entries(o.give ?? {})) this.s.inventory[k] = (this.s.inventory[k] ?? 0) + v;
      if (o.buff) this.addBuff(o.buff.label, o.buff.mood, o.buff.hours);
      this.s.stats[o.id] = (this.s.stats[o.id] ?? 0) + 1;
      this.s.stats[`${r.placeId}:${o.id}`] = (this.s.stats[`${r.placeId}:${o.id}`] ?? 0) + 1;
      if (o.special === 'genfuel') {
        this.s.genFuelUntil = this.s.minutes + 6 * 60;
        this.onToast('Generator is on. Light dey!', 'good');
      }
      if (o.special === 'doctor') {
        this.addBuff('Doctor said: rest well', 4, 12);
        this.onToast('The doctor checked you and prescribed rest and better food.', 'info');
      }
      if (r.hawk) {
        const earned = 1800 + this.s.skills.hustle.level * 220;
        this.earn(earned, 'Sold a bag of pure water');
      }
    }
    if (r.work) this.finishShift(r, completed);
    this.onActivityEnd(r, completed);
  }

  // ---------------------------------------------------------------------
  // jobs

  job() {
    return this.s.job ? jobById(this.s.job.id) : null;
  }

  isWorkDay(jobId: string, day = this.day) {
    return jobById(jobId).days.includes(day % 7);
  }

  /** Whether the shift can start now; returns reason if not. */
  shiftBlocked(): string | null {
    const j = this.job();
    if (!j || !this.s.job) return 'No job';
    if (this.s.job.lastWorkedDay === this.day && this.hour >= j.start) return 'You already worked today';
    if (!this.isWorkDay(j.id)) return 'No work today';
    const h = this.hour;
    if (h < j.start - 1) return `Shift starts ${fmtH(j.start)}`;
    if (h > j.start + 2) return 'Too late for today\'s shift';
    return null;
  }

  startShift(style: WorkStyle) {
    const j = this.job()!;
    const late = Math.max(0, this.hour - j.start) * 60;
    const endMin = dayOf(this.s.minutes) * 1440 + (j.start + j.hours) * 60;
    const total = Math.max(60, endMin - this.s.minutes);
    if (this.running) this.stop(false);
    this.running = {
      offer: { id: 'work', label: 'At work', icon: '💼', minutes: total, clip: j.id === 'tech' ? 'sit_work' : j.id === 'bar' ? 'work' : 'talk' },
      placeId: j.place,
      label: `${j.levels[this.s.job!.level].title} · ${WORK_STYLES[style].label}`,
      icon: '💼',
      total,
      elapsed: 0,
      work: { jobId: j.id, style, late, nextEvent: 60 },
    };
    if (late > 15) this.onToast(`You are ${Math.round(late)} min late. The boss noticed.`, 'bad');
  }

  private finishShift(r: Running, completed: boolean) {
    const js = this.s.job;
    if (!js || !r.work) return;
    const j = jobById(js.id);
    const frac = Math.min(1, r.elapsed / Math.max(1, r.total));
    const lvl = j.levels[js.level];
    const pay = Math.round((lvl.pay * frac) / 50) * 50;
    const st = WORK_STYLES[r.work.style];
    const moodF = 0.5 + this.mood() / 100;
    let perf = st.perf * moodF * frac - (r.work.late > 15 ? 6 : 0);
    if (!completed) perf -= 8;
    js.performance = Math.max(-100, Math.min(100, js.performance + perf));
    js.lastWorkedDay = this.day;
    js.daysWorked++;
    this.s.stats.shifts = (this.s.stats.shifts ?? 0) + 1;
    if (pay > 0) this.earn(pay, `${lvl.title} pay`);
    this.addXp(j.skill, 25 * frac);
    if (!completed) this.onToast('You left work early. Performance dropped.', 'bad');
    // promotion
    if (js.performance >= 100 && js.level < j.levels.length - 1) {
      const next = j.levels[js.level + 1];
      if (this.s.skills[j.skill].level >= next.skill) {
        js.level++;
        js.performance = 15;
        this.s.stats.promotions = (this.s.stats.promotions ?? 0) + 1;
        this.addBuff('Got promoted!', 15, 24);
        this.onToast(`🎉 Promoted to ${next.title}! New pay ${naira(next.pay)} per shift.`, 'level');
      } else {
        js.performance = 100;
        const sk = SKILL_INFO[j.skill];
        if (!this.warned.has(`promo${js.level}`)) {
          this.warned.add(`promo${js.level}`);
          this.onToast(`Ready for promotion, but you need ${sk.label} level ${next.skill}.`, 'info');
        }
      }
    }
  }

  hire(jobId: string): string | null {
    const j = jobById(jobId);
    const need = j.levels[0].skill;
    if (this.s.skills[j.skill].level < need) return `They need ${SKILL_INFO[j.skill].label} level ${need}. Practise and come back.`;
    if (this.s.job?.id === jobId) return 'You already work here.';
    const quit = this.s.job ? jobById(this.s.job.id).name : null;
    this.s.job = { id: jobId, level: 0, performance: 0, lastWorkedDay: -1, lastCheckedDay: this.day, daysWorked: 0 };
    this.onToast(`${quit ? `You left ${quit}. ` : ''}Hired: ${j.levels[0].title}! ${j.blurb}`, 'good');
    return null;
  }

  quit() {
    if (!this.s.job) return;
    this.onToast(`You quit ${jobById(this.s.job.id).name}.`, 'info');
    this.s.job = null;
  }

  // ---------------------------------------------------------------------
  // the tick

  /** advance by real dt seconds */
  update(dt: number) {
    const dm = this.rate * dt;
    if (dm <= 0) return;
    this.advance(dm);
  }

  private advance(dm: number) {
    const s = this.s;
    s.minutes += dm;
    const r = this.running;
    const dh = dm / 60;
    const sleeping = r?.offer.special === 'sleep' || r?.offer.clip === 'lie';
    const working = !!r?.work;
    for (const k of NEEDS) {
      let d = -DECAY[k] * dh;
      if (sleeping) d *= k === 'energy' ? 0 : k === 'bladder' ? 0.5 : 0.35;
      if (working) {
        const j = jobById(r!.work!.jobId);
        const st = WORK_STYLES[r!.work!.style];
        const extra = k === 'energy' ? st.energy : k === 'fun' ? st.fun : k === 'social' ? st.social : 0;
        d = -((j.drain[k] ?? DECAY[k]) + extra) * dh;
      }
      s.needs[k] += d;
    }
    if (r) {
      const o = r.offer;
      const f = Math.min(dm, r.total - r.elapsed) / r.total;
      for (const [k, v] of Object.entries(o.effects ?? {})) {
        let v2 = v as number;
        // sleeping without light: no fan, heat, poor sleep
        if (k === 'energy' && o.special === 'sleep' && r.placeId === 'home' && !this.lightOn()) v2 *= 0.85;
        s.needs[k as Need] += v2 * f;
      }
      for (const [k, v] of Object.entries(o.xp ?? {})) this.addXp(k as Skill, (v as number) * f * (this.mood() > 40 ? 1 : 0.6));
      r.elapsed += dm;
      if (r.work) {
        r.work.nextEvent -= dm;
        if (r.work.nextEvent <= 0) {
          r.work.nextEvent = 100 + Math.random() * 90;
          const ev = jobById(r.work.jobId).events;
          this.onToast(ev[Math.floor(Math.random() * ev.length)], 'info');
        }
      }
      if (r.elapsed >= r.total) this.stop(true);
      // stop early once a need is full, like Sims eating until satisfied
      else if (!r.work && !r.hawk && o.effects && o.special !== 'sleep') {
        const main = Object.entries(o.effects).filter(([, v]) => (v as number) > 0).map(([k]) => k as Need);
        if (main.length && main.every((k) => s.needs[k] >= 100) && !o.xp && !o.give) this.stop(true);
      }
      if (sleeping && this.running === r && s.needs.energy >= 100 && this.hour > 5 && this.hour < 11) {
        this.stop(true);
        this.onToast('Good morning! Tunde woke up refreshed.', 'good');
      }
    }
    for (const k of NEEDS) s.needs[k] = Math.max(0, Math.min(100, s.needs[k]));
    s.buffs = s.buffs.filter((b) => b.until > s.minutes);
    this.checkFailures();
    this.checkDay();
    this.checkWarnings();
    const light = this.lightOn();
    if (light !== this.lastLight && s.location === 'home') this.onToast(light ? '💡 Up NEPA! Light don come.' : '🔌 NEPA took light.', 'info');
    this.lastLight = light;
  }

  private checkWarnings() {
    const n = this.s.needs;
    for (const k of NEEDS) {
      const key = `need:${k}`;
      if (n[k] < 18 && !this.warned.has(key)) {
        this.warned.add(key);
        this.onToast(`${NEED_INFO[k].icon} ${NEED_INFO[k].low}`, 'bad');
      } else if (n[k] > 35) this.warned.delete(key);
    }
    const j = this.job();
    if (j && this.s.job && this.isWorkDay(j.id) && this.s.job.lastWorkedDay !== this.day) {
      const key = `shift:${this.day}`;
      if (this.hour >= j.start - 1 && this.hour < j.start && !this.warned.has(key)) {
        this.warned.add(key);
        this.onToast(`⏰ Work at ${fmtH(j.start)}: ${j.name}`, 'info');
      }
    }
  }

  private checkFailures() {
    const n = this.s.needs;
    const r = this.running;
    if (n.bladder <= 0) {
      n.bladder = 100;
      n.hygiene = 0;
      this.addBuff('Embarrassed: had an accident', -15, 6);
      this.onToast('Tunde could not hold it... Embarrassing! Find a toilet earlier next time.', 'bad');
    }
    if (n.energy <= 0 && !(r && r.offer.clip === 'lie')) {
      const outside = this.s.location === 'city';
      this.start({ id: 'passout', label: 'Passed out', icon: '😵', minutes: 300, clip: 'lie', at: 'here', effects: { energy: 70, hygiene: -20 }, speed: 120 }, this.s.location, { forced: true });
      this.onToast('Tunde was so tired he slept off right there!', 'bad');
      if (outside && Math.random() < 0.4 && this.s.money > 0) {
        const lost = Math.min(this.s.money, 2000 + Math.round(Math.random() * 3000));
        this.pay(lost, 'Pickpocket while you slept');
        this.onToast(`Shine your eye! Somebody took ${naira(lost)} from your pocket.`, 'bad');
      }
    }
    if (n.hunger <= 0) {
      if (r) this.stop(false);
      n.hunger = 35;
      n.energy = Math.max(n.energy, 30);
      this.s.minutes += 180;
      this.pay(12000, 'Hospital bill after fainting');
      this.addBuff('Recovering from fainting', -10, 12);
      this.onToast('Tunde fainted from hunger and woke up in hospital. Bill: ₦12,000.', 'bad');
      this.onFaint('army_hospital');
    }
  }

  private checkDay() {
    const d = this.day;
    if (d === this.lastDay) {
      // missed shift check once the shift is over
      this.checkMissedShift();
      return;
    }
    this.lastDay = d;
    this.checkMissedShift();
    const over = this.rentOverdue();
    if (over > 0) {
      this.relate('baba_landlord', -4);
      this.onToast(over > 7 ? 'Baba has locked your room until you pay rent!' : `Baba: "Tunde, where my rent? E don pass ${over} day(s)."`, 'bad');
    } else if (this.s.rentPaidThroughDay - d === 0) {
      this.onToast(`Rent of ${naira(RENT_WEEKLY)} is due by tomorrow. Pay Baba at home.`, 'info');
    }
  }

  private checkMissedShift() {
    const js = this.s.job;
    if (!js) return;
    const j = jobById(js.id);
    // look at the most recent finished shift day
    const endH = j.start + j.hours;
    const d = this.hour >= endH ? this.day : this.day - 1;
    if (d <= js.lastCheckedDay) return;
    js.lastCheckedDay = d;
    if (!j.days.includes(d % 7) || js.lastWorkedDay === d) return;
    if (this.running?.work && d === this.day) return;
    js.performance -= 20;
    if (js.performance <= -60) {
      this.onToast(`You missed too many shifts. ${j.employer === 'iya_bisi' ? 'Iya Bisi' : 'Your boss'} sacked you!`, 'bad');
      this.s.job = null;
    } else {
      this.onToast(`You missed your shift at ${j.name}. Performance dropped.`, 'bad');
    }
  }

  wants(n = 3) {
    for (const w of WANTS) {
      if (!this.s.wantsDone.includes(w.id) && w.done(this.s, this)) {
        this.s.wantsDone.push(w.id);
        this.s.money += w.reward;
        this.addBuff(`Fulfilled: ${w.label}`, 6, 8);
        this.onToast(`⭐ Want fulfilled: ${w.label} (+${naira(w.reward)})`, 'good');
      }
    }
    return WANTS.filter((w) => !this.s.wantsDone.includes(w.id)).slice(0, n);
  }
}

export function fmtH(h: number) {
  const hh = Math.floor(h) % 24;
  const m = Math.round((h - Math.floor(h)) * 60);
  const ampm = hh < 12 ? 'am' : 'pm';
  const h12 = hh % 12 === 0 ? 12 : hh % 12;
  return m ? `${h12}:${String(m).padStart(2, '0')}${ampm}` : `${h12}${ampm}`;
}

export { JOBS };
