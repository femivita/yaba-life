/**
 * Everything about Tunde's life that persists: time, needs, money, skills,
 * job, friendships, belongings. Plain data so it saves straight to JSON.
 *
 * Design follows The Sims: six motives that decay over game time and are
 * refilled by "advertised" activities, a mood made from them, a career you
 * attend on a schedule, and skills that gate promotions.
 */

export const NEEDS = ['hunger', 'energy', 'hygiene', 'bladder', 'fun', 'social'] as const;
export type Need = (typeof NEEDS)[number];

export const NEED_INFO: Record<Need, { label: string; icon: string; low: string }> = {
  hunger: { label: 'Hunger', icon: '🍲', low: 'Belle dey shout: Tunde is hungry' },
  energy: { label: 'Energy', icon: '⚡', low: 'Tunde is tired. Find somewhere to sleep' },
  hygiene: { label: 'Hygiene', icon: '🚿', low: 'Tunde needs a bath' },
  bladder: { label: 'Bladder', icon: '🚽', low: 'Tunde needs the toilet, sharp sharp' },
  fun: { label: 'Fun', icon: '🎉', low: 'Tunde is bored. Time to catch some fun' },
  social: { label: 'Social', icon: '💬', low: 'Tunde is lonely. Go and gist with somebody' },
};

/** points lost per game hour while awake and idle (The Sims-style, tuned for a ~16 h day) */
export const DECAY: Record<Need, number> = {
  hunger: 4.6,
  energy: 4.2,
  hygiene: 2.8,
  bladder: 7.5,
  fun: 3.6,
  social: 2.8,
};

export const SKILLS = ['coding', 'hustle', 'charisma', 'cooking'] as const;
export type Skill = (typeof SKILLS)[number];
export const SKILL_INFO: Record<Skill, { label: string; icon: string }> = {
  coding: { label: 'Coding', icon: '💻' },
  hustle: { label: 'Hustle (sales)', icon: '🛍️' },
  charisma: { label: 'Charisma', icon: '😎' },
  cooking: { label: 'Cooking', icon: '🍳' },
};
/** XP needed to go from level L to L+1 */
export const skillXpFor = (level: number) => 60 + level * 45;

export interface Ledger {
  t: number;
  amount: number;
  what: string;
}

export interface Buff {
  id: string;
  label: string;
  mood: number;
  until: number; // game minute
}

export interface JobState {
  id: string;
  level: number;
  performance: number; // -100..100, promotion at 100
  lastWorkedDay: number;
  lastCheckedDay: number;
  daysWorked: number;
}

export interface GameState {
  version: 1;
  /** game minutes since Monday of week 1, 00:00 */
  minutes: number;
  needs: Record<Need, number>;
  money: number;
  ledger: Ledger[];
  skills: Record<Skill, { level: number; xp: number }>;
  job: JobState | null;
  relationships: Record<string, number>;
  metNpcs: string[];
  inventory: Record<string, number>;
  buffs: Buff[];
  rentPaidThroughDay: number;
  genFuelUntil: number;
  wantsDone: string[];
  stats: Record<string, number>;
  /** where Tunde is: 'city' or an interior place id */
  location: string;
  x: number;
  z: number;
}

export const START_MONEY = 30000;
export const RENT_WEEKLY = 17500; // a ₦900k/year Yaba self-contain, paid weekly in the game

export function newGame(): GameState {
  return {
    version: 1,
    minutes: 7.5 * 60, // Monday 07:30
    needs: { hunger: 62, energy: 88, hygiene: 55, bladder: 40, fun: 60, social: 55 },
    money: START_MONEY,
    ledger: [{ t: 7 * 60, amount: START_MONEY, what: 'Savings from last month' }],
    skills: { coding: { level: 1, xp: 0 }, hustle: { level: 0, xp: 0 }, charisma: { level: 1, xp: 0 }, cooking: { level: 0, xp: 0 } },
    job: null,
    relationships: { baba_landlord: 20 },
    metNpcs: ['baba_landlord'],
    inventory: { foodstuff: 1, laptop: 1 },
    buffs: [],
    rentPaidThroughDay: 6, // paid up to the end of week 1
    genFuelUntil: 0,
    wantsDone: [],
    stats: {},
    location: 'home',
    x: 0,
    z: 0,
  };
}

const KEY = 'yaba-life-save-v1';

export function loadGame(): GameState | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as GameState;
    if (s.version !== 1) return null;
    // fill fields added after the save was written
    return { ...newGame(), ...s };
  } catch {
    return null;
  }
}

export function saveGame(s: GameState) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* private mode or storage full: the game still plays */
  }
}

export function clearSave() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

// ---------------------------------------------------------------------------
// time helpers

export const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
export const dayOf = (m: number) => Math.floor(m / 1440);
export const weekdayOf = (m: number) => dayOf(m) % 7;
export const hourOf = (m: number) => (m % 1440) / 60;
export function clockText(m: number) {
  const h = Math.floor((m % 1440) / 60);
  const mm = Math.floor(m % 60);
  return `${String(h).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}
export function naira(n: number) {
  const s = Math.round(Math.abs(n)).toLocaleString('en-NG');
  return `${n < 0 ? '-' : ''}₦${s}`;
}
/** true if hour h is inside [open, close), where close may pass midnight */
export function openAt(h: number, open: number, close: number) {
  if (open === close) return true;
  return open < close ? h >= open && h < close : h >= open || h < close;
}
