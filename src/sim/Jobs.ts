import type { Need, Skill } from './State';

export interface JobLevel {
  title: string;
  pay: number; // naira per shift
  skill: number; // skill level needed to be promoted INTO this level
}

export interface JobDef {
  id: string;
  name: string;
  employer: string; // npc id
  place: string; // place id where shifts happen
  skill: Skill;
  days: number[]; // 0 = Monday
  start: number; // hour
  hours: number;
  levels: JobLevel[];
  /** need drain per hour at work (on top of nothing: work replaces normal decay) */
  drain: Partial<Record<Need, number>>;
  blurb: string;
  events: string[];
}

/**
 * Pay is per shift, grounded in the Yaba research: a junior developer at
 * ₦15k/day is ~₦330k/month (research: ₦200k–400k), market work sits near the
 * ₦70k minimum wage, and drivers/bar staff earn daily cash.
 */
export const JOBS: JobDef[] = [
  {
    id: 'market',
    name: 'Okrika sales at Yaba Market',
    employer: 'iya_bisi',
    place: 'yaba_market',
    skill: 'hustle',
    days: [0, 1, 2, 3, 4, 5],
    start: 7,
    hours: 8,
    levels: [
      { title: 'Sales boy (omo ise)', pay: 4000, skill: 0 },
      { title: 'Stall keeper', pay: 6500, skill: 2 },
      { title: 'Bale dealer', pay: 11000, skill: 4 },
      { title: 'Oga for shop', pay: 20000, skill: 6 },
    ],
    drain: { hunger: 5, energy: 5, hygiene: 4.5, bladder: 6, fun: 2, social: -3 },
    blurb: 'Open bales at dawn, shout "Bend down select!", and haggle with customers. Mon to Sat, 7am to 3pm.',
    events: [
      'Wednesday thrift rush: customers everywhere!',
      'A JJC paid full price without haggling. Iya Bisi is smiling.',
      'You found a "first grade" designer shirt in the bale.',
      'Rain started. Everybody ran under the umbrella with the clothes.',
      'Market association levy collector came round.',
      'A customer haggled you down to nothing. Wahala.',
    ],
  },
  {
    id: 'conductor',
    name: 'Danfo conductor, Yaba to Obalende',
    employer: 'emeka',
    place: 'yaba_bus_terminal',
    skill: 'charisma',
    days: [0, 1, 2, 3, 4, 5],
    start: 6,
    hours: 8,
    levels: [
      { title: 'Conductor', pay: 6000, skill: 0 },
      { title: 'Danfo driver', pay: 10000, skill: 2 },
      { title: 'Line captain', pay: 15000, skill: 4 },
      { title: 'Bus owner (collect returns)', pay: 28000, skill: 6 },
    ],
    drain: { hunger: 5.5, energy: 6, hygiene: 6, bladder: 5, fun: 1, social: -4 },
    blurb: 'Hang on the door shouting "Obalende! CMS! Enter with your change!" Mon to Sat, 6am to 2pm.',
    events: [
      'Go-slow on Third Mainland Bridge. Passengers are vexing.',
      'Agbero collected his money at Ojuelegba.',
      'A passenger had no change for ₦1,000. Wahala be like bicycle.',
      '"Owa o!" Somebody wants to drop at Yaba.',
      'Police checkpoint. Emeka handled it.',
      'Full bus in two minutes. Morning rush!',
    ],
  },
  {
    id: 'bar',
    name: 'Barman at Banilux Bar',
    employer: 'chidi',
    place: 'banilux_bar',
    skill: 'charisma',
    days: [0, 1, 2, 3, 4, 5, 6],
    start: 17,
    hours: 7,
    levels: [
      { title: 'Barman', pay: 5000, skill: 0 },
      { title: 'Head barman', pay: 8000, skill: 2 },
      { title: 'Bar manager', pay: 14000, skill: 4 },
      { title: 'Partner', pay: 25000, skill: 6 },
    ],
    drain: { hunger: 4.5, energy: 5.5, hygiene: 3.5, bladder: 5, fun: -1, social: -6 },
    blurb: 'Serve cold beer and pepper soup while the Premier League plays. Every day, 5pm to midnight.',
    events: [
      'Arsenal scored! The whole bar is shouting.',
      'A customer ordered nkwobi for the table and tipped you.',
      'Chelsea fans and Arsenal fans almost fought. You calmed them.',
      'NEPA took light. Chidi started the generator.',
      'A big man paid for everybody\'s round.',
    ],
  },
  {
    id: 'tech',
    name: 'Developer at Jollof Labs (CcHUB)',
    employer: 'kemi',
    place: 'cchub',
    skill: 'coding',
    days: [0, 1, 2, 3, 4],
    start: 9,
    hours: 8,
    levels: [
      { title: 'Junior developer', pay: 15000, skill: 2 },
      { title: 'Mid-level developer', pay: 30000, skill: 4 },
      { title: 'Senior developer', pay: 55000, skill: 6 },
      { title: 'CTO', pay: 95000, skill: 8 },
    ],
    drain: { hunger: 4, energy: 4.5, hygiene: 2, bladder: 5, fun: 2.5, social: -1 },
    blurb: 'Build a payments app at a Yabacon Valley startup. Mon to Fri, 9am to 5pm. Needs Coding level 2.',
    events: [
      'Standup ran for 45 minutes. Again.',
      'You fixed the bug that was blocking the release.',
      'NEPA took light, but the hub generator came on.',
      'Investors visited the hub. Everybody acted busy.',
      'Your pull request got approved first time.',
      'Somebody brought small chops for the team.',
    ],
  },
];

export const jobById = (id: string) => JOBS.find((j) => j.id === id)!;

export type WorkStyle = 'hard' | 'normal' | 'gist';
export const WORK_STYLES: Record<WorkStyle, { label: string; perf: number; energy: number; fun: number; social: number }> = {
  hard: { label: 'Work hard', perf: 15, energy: 1.6, fun: 1.5, social: 0 },
  normal: { label: 'Normal pace', perf: 10, energy: 0, fun: 0, social: 0 },
  gist: { label: 'Gist with colleagues', perf: 4, energy: -0.5, fun: -1.5, social: -3 },
};
