import type { Life } from '../sim/Life';
import { naira } from '../sim/State';
import { CROWD_GIST, CROWD_GREETINGS, type PersonDef } from './People';

/** Someone Tunde can talk to: a named person or a passer-by. */
export interface Talker {
  id: string; // relationship key ('' for passers-by: not remembered)
  name: string;
  title: string;
  female: boolean;
  def?: PersonDef;
  team?: PersonDef['team'];
  playful: number;
  /** passer-by friendship lives only for the encounter */
  tempRel?: number;
}

export interface SocialAct {
  id: string;
  label: string;
  icon: string;
  minRel?: number;
}

export const ACTS: SocialAct[] = [
  { id: 'greet', label: 'Greet ("How far?")', icon: '👋' },
  { id: 'gist', label: 'Gist about Yaba life', icon: '💬' },
  { id: 'joke', label: 'Crack a joke', icon: '😂' },
  { id: 'football', label: 'Talk football', icon: '⚽' },
  { id: 'hail', label: 'Hail them (compliment)', icon: '🙌', minRel: -20 },
  { id: 'advice', label: 'Ask for advice', icon: '🧠', minRel: 10 },
  { id: 'help', label: 'Ask for small help (₦2,000)', icon: '🙏', minRel: 55 },
  { id: 'shade', label: 'Throw shade', icon: '😤' },
];

export function relLabel(v: number) {
  if (v <= -40) return 'Enemy';
  if (v <= -10) return 'Not cool';
  if (v < 15) return 'Stranger';
  if (v < 40) return 'Acquaintance';
  if (v < 65) return 'Friend';
  if (v < 85) return 'Good friend';
  return 'Best friend';
}

const pick = <T>(a: T[]) => a[Math.floor(Math.random() * a.length)];

const TUNDE: Record<string, string[]> = {
  greet: ['How far?', 'Good afternoon o!', 'Wetin dey happen?'],
  gist: ['You hear say fuel price go up again?', 'This Yaba sef, e no dey sleep.', 'I just waka from Tejuosho. Crowd plenty!'],
  joke: ['Why did the Lagos driver cross the road? Na agbero push am!', 'My phone battery get more energy than NEPA.', 'I don dey hustle so tey, my shadow dey ask for salary.'],
  hail: ['You dey look fresh today!', 'Omo, your style make sense!', 'Na you be the realest person for this area.'],
  advice: ['Abeg, how person go take make am for this Lagos?', 'Wetin you go do if you be me?'],
  help: ['Abeg, I dey hold small. Help me with ₦2,000?'],
  shade: ['Na so you dey always talk rubbish?', 'Your matter tire me.'],
};

const OK: Record<string, string[]> = {
  greet: ['I dey o! You nko?', 'Fine! How your side?', 'We thank God.'],
  joke: ['Hahaha! You no well!', 'Omo! This one sweet me!', 'Ah, you too funny. 😂'],
  hail: ['Ah, thank you jare!', 'You sef dey try!', 'See this one. Thank you o!'],
  advice: ['Save small small. Join ajo. And learn one skill well.', 'Make friends. For Lagos, connection na everything.', 'Never stop hustling, but rest too. Body no be firewood.'],
  help: ['Ok, take. But no forget me o.', 'No wahala, I get you.'],
};

const BAD: Record<string, string[]> = {
  greet: ['Hmm.', 'Ok.'],
  gist: ['Abeg I dey busy.', 'Hmm, ok o.'],
  joke: ['That one no funny at all.', '...Ok.', 'Na wa for you.'],
  hail: ['Wetin you want?', 'Hmm, ok.'],
  advice: ['I no sabi o. Go ask another person.'],
  help: ['Ah, I no get money myself. Sapa dey hold me too.', 'Abeg, things hard.'],
  shade: ['Who you dey talk to like that?!', 'Na your type dey cause wahala!', 'Comot for my front!'],
};

/** Carry out one social interaction. Returns the reply line and outcome. */
export function interact(life: Life, t: Talker, actId: string) {
  const s = life.s;
  const rel = t.id ? s.relationships[t.id] ?? 0 : t.tempRel ?? 0;
  const charisma = s.skills.charisma.level;
  let p = 0.55 + charisma * 0.04 + rel / 300 + (life.mood() - 50) / 250;
  const tLine = pick(TUNDE[actId] ?? TUNDE.gist);
  let reply = '';
  let dRel = 0;
  let social = 8;
  let fun = 0;
  if (actId === 'joke') p += (t.playful - 0.5) * 0.5;
  if (actId === 'shade') p = 0;
  let ok = Math.random() < p;
  let tunde = tLine;

  if (actId === 'greet') {
    const first = t.id && !s.metNpcs.includes(t.id);
    reply = first ? `${pick(t.def?.greeting ?? CROWD_GREETINGS)} I'm ${t.name}. ${t.title}.` : pick(ok ? (t.def?.greeting ?? OK.greet) : BAD.greet);
    dRel = ok ? 3 : 0;
    ok = true;
  } else if (actId === 'gist') {
    reply = ok ? pick(t.def?.gist ?? CROWD_GIST) : pick(BAD.gist);
    dRel = ok ? 5 : -2;
    fun = ok ? 3 : 0;
  } else if (actId === 'football') {
    const team = pick(['Arsenal', 'Chelsea', 'Man United', 'Liverpool'] as const);
    tunde = `${team} go carry the league this year!`;
    if (!t.team) {
      reply = 'Ah, me I no dey follow football. Na una wahala.';
      ok = Math.random() < 0.5;
      dRel = ok ? 2 : -1;
    } else if (t.team === team) {
      reply = `${team} till I die! You be correct person!`;
      ok = true;
      dRel = 10;
      fun = 8;
    } else {
      reply = `${team}?! Mtchew. ${t.team} go finish una!`;
      ok = Math.random() < 0.35;
      dRel = ok ? 4 : -6;
      fun = 6;
    }
  } else if (actId === 'joke') {
    reply = ok ? pick(OK.joke) : pick(BAD.joke);
    dRel = ok ? 6 : -4;
    fun = ok ? 10 : 0;
  } else if (actId === 'hail') {
    reply = ok ? pick(OK.hail) : pick(BAD.hail);
    dRel = ok ? 6 : -2;
  } else if (actId === 'advice') {
    reply = ok ? pick(OK.advice) : pick(BAD.advice);
    dRel = ok ? 4 : 0;
    if (ok) life.addXp('charisma', 6);
  } else if (actId === 'help') {
    const key = `help:${t.id}:${life.day}`;
    if (s.stats[key]) {
      reply = 'Ah, I just help you today now!';
      ok = false;
      dRel = -3;
    } else {
      ok = Math.random() < p + 0.1;
      reply = ok ? pick(OK.help) : pick(BAD.help);
      if (ok) {
        s.stats[key] = 1;
        life.earn(2000, `Help from ${t.name}`);
      }
      dRel = ok ? -6 : -2;
    }
  } else if (actId === 'shade') {
    reply = pick(BAD.shade);
    dRel = -15;
    social = 2;
    fun = 4;
  }
  life.s.needs.social = Math.min(100, s.needs.social + social);
  life.s.needs.fun = Math.min(100, s.needs.fun + fun);
  life.addXp('charisma', ok ? 5 : 2);
  life.s.minutes += 6;
  let newRel: number;
  if (t.id) newRel = life.relate(t.id, dRel);
  else newRel = t.tempRel = Math.max(-100, Math.min(100, (t.tempRel ?? 0) + dRel));
  return { tunde, reply, ok, dRel, rel: newRel, label: relLabel(newRel), money: naira(s.money) };
}
