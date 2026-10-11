import type { Clip } from '../player/Character';
import type { Offer } from '../sim/Places';

export interface ScheduleEntry {
  days?: number[]; // 0 = Monday; all days if missing
  from: number;
  to: number; // may pass midnight
  place: string; // place id, or an outdoor spot id
  role: 'staff' | 'patron' | 'outside';
  clip?: Clip;
}

export interface PersonDef {
  id: string;
  name: string;
  model: string;
  title: string;
  female: boolean;
  /** favourite club: football talk goes well or very badly */
  team: 'Arsenal' | 'Chelsea' | 'Man United' | 'Liverpool' | null;
  /** 0..1, how much they enjoy jokes and gist */
  playful: number;
  greeting: string[];
  gist: string[];
  schedule: ScheduleEntry[];
  /** job this person can hire you for */
  hires?: string;
  sells?: Offer[];
}

const WEEKDAYS = [0, 1, 2, 3, 4];
const MON_SAT = [0, 1, 2, 3, 4, 5];

/** Fictional Yaba residents. The places they work and hang out are real. */
export const PEOPLE: PersonDef[] = [
  {
    id: 'baba_landlord',
    name: 'Pa Adebayo',
    model: 'baba_landlord',
    title: 'Your landlord ("Baba")',
    female: false,
    team: 'Man United',
    playful: 0.35,
    greeting: ['Tunde, omo mi! How body?', 'Ehen, Tunde. You don come back.', 'Good day o. Hope you dey find work?'],
    gist: [
      'In my time, Yaba was quiet. Now see danfo everywhere!',
      'NEPA will bring light tonight, I can feel it in my bones.',
      'This country... but we thank God.',
      'Don\'t forget, rent is every Saturday. I no dey owe anybody, so nobody should owe me.',
      'My son is in London now. Japa. He sends pounds sometimes.',
    ],
    schedule: [{ from: 7, to: 21, place: 'home', role: 'outside', clip: 'sit' }],
  },
  {
    id: 'iya_bisi',
    name: 'Iya Bisi',
    model: 'iya_bisi',
    title: 'Okrika trader, Yaba Market',
    female: true,
    team: null,
    playful: 0.6,
    greeting: ['Customer! Come and buy, I go give you good price!', 'Ah, my pikin! Welcome o.', 'Bend down select! Fine boy, wetin you want?'],
    gist: [
      'Wednesday and Friday morning na the best time. First grade go finish before 9.',
      'These JJCs, they pay anything. Me, I no dey cheat o... too much.',
      'I been dey this market since 1998. The fire of 2013 nearly finish us.',
      'Our ajo contribution is this Friday. Everybody must pay.',
      'If you want to sell, you must learn to talk. Mouth na capital!',
    ],
    schedule: [{ days: MON_SAT, from: 6, to: 19.5, place: 'yaba_market', role: 'staff', clip: 'talk' }],
    hires: 'market',
  },
  {
    id: 'emeka',
    name: 'Emeka',
    model: 'emeka',
    title: 'Danfo conductor, Yaba terminal',
    female: false,
    team: 'Chelsea',
    playful: 0.8,
    greeting: ['Obalende! CMS! Enter with your change!', 'My guy! How far?', 'Oya oya, bus don full!'],
    gist: [
      'Third Mainland go-slow this morning was another level.',
      'Agbero for Ojuelegba don collect my money three times today.',
      'Owner of this bus wan see returns of ₦25k every day. E no easy.',
      'Rain fall small, fare go up. Na Lagos.',
      'One day I go buy my own bus. You go see.',
    ],
    schedule: [{ days: MON_SAT, from: 6, to: 20, place: 'yaba_bus_terminal', role: 'outside', clip: 'talk' }],
    hires: 'conductor',
  },
  {
    id: 'chidi',
    name: 'Chidi',
    model: 'chidi',
    title: 'Barman, Banilux Bar',
    female: false,
    team: 'Arsenal',
    playful: 0.75,
    greeting: ['My man! Cold one?', 'Welcome to Banilux. Match dey start soon.', 'Bros, how body?'],
    gist: [
      'Arsenal go carry the league this year. Mark my words.',
      'Last night one Chelsea fan cry for here. Grown man!',
      'Pepper soup today na catfish. Fresh.',
      'We get inn upstairs too, if you drink too much.',
      'Customer wey dey tip na my best friend.',
    ],
    schedule: [{ from: 16, to: 2, place: 'banilux_bar', role: 'staff', clip: 'work' }],
    hires: 'bar',
  },
  {
    id: 'kemi',
    name: 'Kemi',
    model: 'kemi',
    title: 'Product lead, Jollof Labs (CcHUB)',
    female: true,
    team: null,
    playful: 0.45,
    greeting: ['Hey! Welcome to the hub.', 'Hi Tunde. Building anything cool?', 'Hello! Grab a seat.'],
    gist: [
      'We are building payments for market traders. Iya Bisi types are our users!',
      'Half my team just japa-ed to Canada. We are hiring.',
      'Mark Zuckerberg visited this hub in 2016. Everybody still talks about it.',
      'The generator here never fails. That is why everybody comes.',
      'If you can show me a side project, I can talk to the CTO.',
    ],
    schedule: [
      { days: WEEKDAYS, from: 9, to: 18, place: 'cchub', role: 'patron', clip: 'sit_work' },
      { days: [4, 5], from: 19, to: 23.5, place: 'silver_cafe', role: 'patron', clip: 'sit' },
    ],
    hires: 'tech',
  },
  {
    id: 'amaka',
    name: 'Amaka',
    model: 'amaka',
    title: 'UNILAG student (Mass Comm)',
    female: true,
    team: 'Liverpool',
    playful: 0.85,
    greeting: ['Heyyy! How far?', 'Omo, see who it is!', 'Hi! I dey run go lecture o.'],
    gist: [
      'Exams next week and I have not opened my book. TDB tonight!',
      'Lagoon front at sunset is the best place in Lagos. No argument.',
      'Hostel bathroom queue this morning was 20 people.',
      'Are you coming to the party at Gondola on Saturday?',
      'Aluta continua! Student union elections are wild this year.',
    ],
    schedule: [
      { days: WEEKDAYS, from: 9, to: 16, place: 'unilag', role: 'patron', clip: 'sit_work' },
      { days: [4, 5], from: 22, to: 3, place: 'gondola_club', role: 'patron', clip: 'dance' },
      { days: [6], from: 14, to: 19, place: 'ecentre', role: 'patron', clip: 'sit' },
    ],
  },
  {
    id: 'sani',
    name: 'Mallam Sani',
    model: 'sani',
    title: 'Suya seller, Sabo',
    female: false,
    team: 'Chelsea',
    playful: 0.5,
    greeting: ['Sannu! Suya dey hot!', 'My friend, you want suya?', 'Welcome, welcome. Fresh meat today.'],
    gist: [
      'My father sold suya on this same street. Sabo is home.',
      'Yaji is the secret. I no go tell you the recipe.',
      'Night time is when business sweet. Students, workers, everybody.',
      'Mai shai beside me sells tea and bread if you want.',
    ],
    schedule: [{ from: 17, to: 24, place: 'white_house', role: 'outside', clip: 'work' }],
    sells: [
      { id: 'suya', label: 'Buy suya with onions and yaji', icon: '🍢', price: 2000, minutes: 20, clip: 'idle', effects: { hunger: 32, fun: 10 }, buff: { label: 'Mallam Sani\'s suya', mood: 5, hours: 4 } },
      { id: 'shayi', label: 'Shayi (tea) and bread', icon: '🍞', price: 800, minutes: 15, clip: 'idle', effects: { hunger: 18, energy: 6 } },
    ],
  },
];

export const personById = (id: string) => PEOPLE.find((p) => p.id === id);

// ---------------------------------------------------------------------------
// crowd: generic Yaba people who fill streets, bars and markets

export const CROWD_MODELS = ['amaka', 'chidi', 'kemi', 'emeka', 'iya_bisi', 'sani'];
export const FEMALE_MODELS = new Set(['amaka', 'kemi', 'iya_bisi']);

const MALE = ['Segun', 'Chinedu', 'Ibrahim', 'Femi', 'Tobi', 'Obinna', 'Musa', 'Kunle', 'Uche', 'Dayo', 'Yusuf', 'Ifeanyi', 'Bayo', 'Ahmed', 'Gbenga'];
const FEMALE = ['Ngozi', 'Funmi', 'Aisha', 'Tolu', 'Chioma', 'Zainab', 'Bukola', 'Adaeze', 'Halima', 'Yetunde', 'Nkechi', 'Folake', 'Hauwa', 'Simi', 'Ireti'];
const JOBS = ['Student', 'Trader', 'Banker', 'Tech bro', 'Civil servant', 'Nurse', 'Okada rider (retired)', 'Tailor', 'Hairdresser', 'Keke rider', 'Teacher', 'Content creator'];

export function randomName(female: boolean, seed: number) {
  const list = female ? FEMALE : MALE;
  return list[Math.abs(seed) % list.length];
}
export function randomJob(seed: number) {
  return JOBS[Math.abs(seed * 7) % JOBS.length];
}

export const CROWD_GREETINGS = ['How far?', 'I dey o. You nko?', 'Wetin dey happen?', 'Good afternoon o.', 'Bros/Sisi, how body?'];
export const CROWD_GIST = [
  'This go-slow at Ojuelegba no go kill me.',
  'NEPA never bring light since yesterday.',
  'Price of rice don go up again o.',
  'Na Yaba Left go suit this our government.',
  'You don hear the new Burna Boy song?',
  'Last last, we go dey alright.',
  'Wahala be like bicycle.',
  'I wan japa but money no dey.',
  'Abeg shine your eye for this area.',
];
