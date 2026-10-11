import type { Clip } from '../player/Character';
import type { Need, Skill } from './State';

export type InteriorKind =
  | 'home' | 'buka' | 'restaurant' | 'cafe' | 'bar' | 'lounge' | 'club' | 'cinema'
  | 'market' | 'supermarket' | 'office' | 'campus' | 'hospital' | 'hotel';

/** Object tags that interior rooms place and offers attach to (The Sims' "smart objects"). */
export type Tag =
  | 'bed' | 'shower' | 'toilet' | 'stove' | 'fridge' | 'tv' | 'desk' | 'mirror' | 'door_landlord'
  | 'counter' | 'seat' | 'dance' | 'rack' | 'screen' | 'shelf' | 'reception' | 'books' | 'stage';

export interface Offer {
  id: string;
  label: string;
  icon: string;
  price?: number;
  /** game minutes the activity lasts */
  minutes: number;
  clip?: Clip;
  /** where the activity is done: on a free seat, in bed, on the spot */
  at?: 'seat' | 'bed' | 'here';
  /** total change to each need over the activity */
  effects?: Partial<Record<Need, number>>;
  xp?: Partial<Record<Skill, number>>;
  buff?: { label: string; mood: number; hours: number };
  give?: Record<string, number>;
  use?: Record<string, number>;
  /** game minutes per real second while doing it */
  speed?: number;
  needsLight?: boolean;
  special?: 'sleep' | 'work' | 'apply' | 'payrent' | 'genfuel' | 'doctor';
  hours?: [number, number];
}

export interface PlaceDef {
  id: string;
  name: string;
  /** landmark in yaba.json to anchor the door to; home is found near the spawn */
  landmark?: string;
  kind: InteriorKind;
  hours: [number, number];
  offers: Partial<Record<Tag, Offer[]>>;
  /** seated/standing customers to fill the room with */
  patrons?: number;
  sign?: string;
  /** colours for the room theme */
  theme?: { wall: number; floor: number; accent: number };
}

// ---------------------------------------------------------------------------
// reusable offers

const eat = (id: string, label: string, price: number, hunger: number, extra: Partial<Record<Need, number>> = {}, minutes = 30): Offer => ({
  id, label, icon: '🍽️', price, minutes, clip: 'sit_eat', at: 'seat', effects: { hunger, bladder: -8, ...extra },
});
const drink = (id: string, label: string, price: number, fun: number, minutes = 40): Offer => ({
  id, label, icon: '🍺', price, minutes, clip: 'sit', at: 'seat', effects: { fun, social: 6, bladder: -14, hunger: 2 },
});
const toilet = (price = 0): Offer => ({
  id: 'toilet', label: price ? 'Use the toilet' : 'Use the toilet', icon: '🚽', price, minutes: 6, effects: { bladder: 100 },
  clip: 'idle',
});
const watchMatch: Offer = {
  id: 'match', label: 'Watch the Premier League match', icon: '⚽', minutes: 105, clip: 'sit', at: 'seat',
  effects: { fun: 55, social: 25, energy: -6 }, buff: { label: 'Watched the match with the guys', mood: 8, hours: 6 },
};
const dance: Offer = {
  id: 'dance', label: 'Dance to Afrobeats', icon: '💃', minutes: 45, clip: 'dance', at: 'here',
  effects: { fun: 40, social: 22, energy: -14, hygiene: -10 }, buff: { label: 'Danced till e choke', mood: 10, hours: 5 },
};

export const PLACES: PlaceDef[] = [
  {
    id: 'home',
    name: "Tunde's self-contain",
    kind: 'home',
    hours: [0, 0],
    sign: 'Home',
    theme: { wall: 0xd9c9a3, floor: 0x8a6a4a, accent: 0x2e6b4f },
    offers: {
      bed: [
        { id: 'sleep', label: 'Sleep', icon: '😴', minutes: 8 * 60, clip: 'lie', at: 'bed', special: 'sleep', effects: { energy: 100, bladder: -30, hunger: -20 }, speed: 120 },
        { id: 'nap', label: 'Take a nap (1 h)', icon: '💤', minutes: 60, clip: 'lie', at: 'bed', effects: { energy: 16, hunger: -3 }, speed: 40 },
      ],
      shower: [
        { id: 'bucket', label: 'Bucket bath', icon: '🪣', minutes: 20, clip: 'idle', effects: { hygiene: 100, fun: 3 } },
      ],
      toilet: [toilet()],
      stove: [
        { id: 'indomie', label: 'Cook Indomie and egg', icon: '🍜', minutes: 25, clip: 'work', use: { foodstuff: 1 }, effects: { hunger: 45 }, xp: { cooking: 12 }, buff: { label: 'Home-cooked Indomie', mood: 3, hours: 3 } },
        { id: 'cookjollof', label: 'Cook party jollof (Cooking 3)', icon: '🍛', minutes: 70, clip: 'work', use: { foodstuff: 2 }, effects: { hunger: 80, fun: 10 }, xp: { cooking: 25 }, buff: { label: 'Ate correct jollof', mood: 8, hours: 6 } },
      ],
      fridge: [
        { id: 'snack', label: 'Drink pure water and eat gala', icon: '🥤', minutes: 8, clip: 'idle', use: { snack: 1 }, effects: { hunger: 14 } },
      ],
      tv: [
        { id: 'tv', label: 'Watch Nollywood on TV', icon: '📺', minutes: 90, clip: 'sit', at: 'seat', needsLight: true, effects: { fun: 40, energy: -4 } },
      ],
      desk: [
        { id: 'code', label: 'Practise coding on the laptop', icon: '💻', minutes: 120, clip: 'sit_work', at: 'seat', use: {}, effects: { fun: -6, energy: -8 }, xp: { coding: 50 } },
        { id: 'skits', label: 'Scroll social media', icon: '📱', minutes: 45, clip: 'sit', at: 'seat', effects: { fun: 22, social: 10 } },
      ],
      mirror: [
        { id: 'speech', label: 'Practise speaking in the mirror', icon: '🗣️', minutes: 45, clip: 'talk', effects: { fun: -2 }, xp: { charisma: 35 } },
      ],
      door_landlord: [
        { id: 'payrent', label: 'Pay rent to Baba (₦17,500/week)', icon: '🏠', minutes: 5, special: 'payrent' },
        { id: 'genfuel', label: 'Buy fuel for the generator (6 h of light)', icon: '⛽', price: 2500, minutes: 10, special: 'genfuel' },
      ],
    },
  },
  {
    id: 'white_house',
    name: 'White House',
    landmark: 'white_house',
    kind: 'buka',
    hours: [0, 0],
    sign: 'WHITE HOUSE',
    patrons: 4,
    theme: { wall: 0xf2f0e8, floor: 0x9b8f80, accent: 0x2a6ea8 },
    offers: {
      counter: [
        eat('amala', 'Amala, ewedu, gbegiri and 2 meat', 2800, 60, { fun: 6 }),
        eat('jollof', 'Jollof rice, dodo and chicken', 3500, 55, { fun: 8 }),
        eat('eba', 'Eba and egusi soup', 2500, 58),
        eat('pepper', 'Goat meat pepper soup', 3000, 30, { fun: 10 }),
        drink('malt', 'Chilled malt', 700, 6, 15),
      ],
      toilet: [toilet(100)],
    },
  },
  {
    id: 'belleful',
    name: 'Belleful Restaurant',
    landmark: 'belleful',
    kind: 'restaurant',
    hours: [10, 20],
    sign: 'BELLEFUL',
    patrons: 3,
    theme: { wall: 0xf3d9a6, floor: 0x8c6b52, accent: 0xc0392b },
    offers: {
      counter: [eat('fried', 'Fried rice, chicken and salad', 4000, 60, { fun: 8 }), eat('beans', 'Beans and dodo', 1800, 45), eat('ofada', 'Ofada rice and ayamase', 3800, 62, { fun: 6 })],
      toilet: [toilet()],
    },
  },
  {
    id: 'city_grill',
    name: 'City Grill',
    landmark: 'city_grill',
    kind: 'restaurant',
    hours: [12, 22.5],
    sign: 'CITY GRILL',
    patrons: 4,
    theme: { wall: 0xe8e2d4, floor: 0x5c4a3e, accent: 0xd35400 },
    offers: {
      counter: [eat('grill', 'Grilled chicken and chips', 5500, 60, { fun: 12 }), eat('jollof', 'Jollof rice and turkey', 4800, 60, { fun: 8 }), eat('shawarma', 'Shawarma', 3000, 38, { fun: 10 })],
      toilet: [toilet()],
    },
  },
  {
    id: 'the_place',
    name: 'The Place Restaurant',
    landmark: 'the_place',
    kind: 'restaurant',
    hours: [9, 21],
    sign: 'THE PLACE',
    patrons: 4,
    theme: { wall: 0xf4e6c8, floor: 0x7a5a40, accent: 0xb22222 },
    offers: {
      counter: [eat('jollof', 'Jollof rice, chicken and moi moi', 4200, 62, { fun: 8 }), eat('chops', 'Small chops platter', 3500, 35, { fun: 12 }), eat('fried', 'Fried rice and turkey', 4800, 60, { fun: 8 })],
      toilet: [toilet()],
    },
  },
  {
    id: 'tummyline',
    name: 'Tummyline Restaurant',
    landmark: 'tummyline',
    kind: 'restaurant',
    hours: [8, 18],
    sign: 'TUMMYLINE',
    patrons: 3,
    theme: { wall: 0xfbe7b5, floor: 0x7b6650, accent: 0x27ae60 },
    offers: {
      counter: [eat('akara', 'Akara, pap and bread', 1200, 32), eat('rice', 'White rice and stew', 2500, 55), eat('poundo', 'Pounded yam and efo riro', 3500, 64, { fun: 6 })],
      toilet: [toilet()],
    },
  },
  {
    id: 'banilux_bar',
    name: 'Banilux Bar',
    landmark: 'banilux_bar',
    kind: 'bar',
    hours: [16, 2],
    sign: 'BANILUX BAR',
    patrons: 6,
    theme: { wall: 0x2f6e4a, floor: 0x6b6458, accent: 0xf1c40f },
    offers: {
      counter: [drink('beer', 'Cold lager', 1200, 14), eat('pepper', 'Catfish pepper soup', 4500, 35, { fun: 12 }), eat('nkwobi', 'Nkwobi', 4000, 40, { fun: 12 }), drink('stout', 'Stout', 1500, 15)],
      tv: [watchMatch],
      toilet: [toilet()],
    },
  },
  {
    id: 'highway_bar',
    name: 'Highway Bar & Grills',
    landmark: 'highway_bar',
    kind: 'bar',
    hours: [12, 1],
    sign: 'HIGHWAY BAR & GRILLS',
    patrons: 5,
    theme: { wall: 0x7a2e2e, floor: 0x6b6458, accent: 0xf39c12 },
    offers: {
      counter: [drink('beer', 'Cold lager', 1200, 14), eat('asun', 'Asun (spicy goat)', 3500, 30, { fun: 12 }), eat('fish', 'Grilled catfish', 6000, 50, { fun: 12 })],
      tv: [watchMatch],
      toilet: [toilet()],
    },
  },
  {
    id: 'galaxy_cool_spot',
    name: 'Galaxy Cool Spot',
    landmark: 'galaxy_cool_spot',
    kind: 'bar',
    hours: [11, 1],
    sign: 'GALAXY COOL SPOT',
    patrons: 5,
    theme: { wall: 0x2c3e7a, floor: 0x6b6458, accent: 0xe74c3c },
    offers: { counter: [drink('beer', 'Cold lager', 1100, 14), eat('suya', 'Suya and onions', 2000, 25, { fun: 10 })], tv: [watchMatch], toilet: [toilet()] },
  },
  {
    id: 'nkwobi_palace',
    name: 'Nkwobi Palace',
    landmark: 'nkwobi_palace',
    kind: 'bar',
    hours: [12, 0],
    sign: 'NKWOBI PALACE',
    patrons: 4,
    theme: { wall: 0x8e5b2e, floor: 0x6b6458, accent: 0xf1c40f },
    offers: { counter: [eat('nkwobi', 'Nkwobi and palm wine', 4500, 40, { fun: 14 }), eat('isiewu', 'Isi ewu', 5000, 42, { fun: 14 }), drink('palm', 'Palm wine', 1000, 12)], tv: [watchMatch], toilet: [toilet()] },
  },
  {
    id: 'the_village',
    name: 'The Village',
    landmark: 'the_village',
    kind: 'bar',
    hours: [12, 2],
    sign: 'THE VILLAGE',
    patrons: 5,
    theme: { wall: 0x7b5534, floor: 0x5a4632, accent: 0xe67e22 },
    offers: { counter: [drink('beer', 'Cold lager', 1300, 14), drink('wine', 'Glass of wine', 3000, 16)], tv: [watchMatch], stage: [{ id: 'live', label: 'Enjoy the live band', icon: '🎸', minutes: 60, clip: 'sit', at: 'seat', effects: { fun: 40, social: 12 } }], toilet: [toilet()] },
  },
  ...['road_runner_ash', 'yard_stick', 'house55', 'bukay_lounge', 'bcs_wine_bar', 'silver_cafe'].map((id): PlaceDef => ({
    id,
    name: {
      road_runner_ash: 'Road Runner & Ash Bar', yard_stick: 'The Yard Stick Lounge', house55: 'House 55 Bar & Lounge',
      bukay_lounge: 'Bukay Lounge', bcs_wine_bar: "BC's Wine Bar", silver_cafe: 'Silver Cafe',
    }[id]!,
    landmark: id === 'road_runner_ash' ? 'roadrunner_ash' : id,
    kind: 'lounge',
    hours: id === 'road_runner_ash' ? [0, 0] : id === 'silver_cafe' ? [10, 0] : [15, 3],
    patrons: 5,
    theme: { wall: 0x1e1b2e, floor: 0x2b2633, accent: [0x9b59b6, 0xe84393, 0x00cec9, 0xfdcb6e, 0xe17055, 0x74b9ff][id.length % 6] },
    offers: {
      counter: [
        drink('cocktail', 'Cocktail', 5000, 20),
        drink('chapman', 'Chapman', 2500, 14),
        { id: 'shisha', label: 'Share shisha with the table', icon: '💨', price: 8000, minutes: 60, clip: 'sit', at: 'seat', effects: { fun: 30, social: 20 } },
        eat('chops', 'Small chops', 4000, 30, { fun: 10 }),
      ],
      dance: [dance],
      toilet: [toilet()],
    },
  })),
  ...['gondola_club', 'ibikunle_clubs'].map((id): PlaceDef => ({
    id,
    name: id === 'gondola_club' ? 'The Gondola Club' : 'Club Gossip (Ibikunle St)',
    landmark: id,
    kind: 'club',
    hours: [21, 5],
    patrons: 8,
    theme: { wall: 0x0d0d16, floor: 0x15151f, accent: id === 'gondola_club' ? 0xff3b8d : 0x2dd4ff },
    offers: {
      counter: [
        { id: 'entry', label: 'Pay gate fee and party', icon: '🎟️', price: 5000, minutes: 120, clip: 'dance', at: 'here', effects: { fun: 70, social: 40, energy: -25, hygiene: -15 }, buff: { label: 'Owambe energy', mood: 12, hours: 8 } },
        drink('shots', 'Round of shots', 6000, 25),
      ],
      dance: [dance],
      toilet: [toilet()],
    },
  })),
  {
    id: 'domino',
    name: 'Domino',
    landmark: 'domino',
    kind: 'cafe',
    hours: [9, 21],
    sign: 'DOMINO',
    patrons: 3,
    theme: { wall: 0xf5efe0, floor: 0x9a7b5a, accent: 0x2c3e50 },
    offers: { counter: [eat('pizza', 'Pizza slice', 3500, 35, { fun: 8 }), eat('pastry', 'Meat pie and coffee', 1800, 25, { energy: 8 }), drink('wine', 'Glass of wine', 3000, 14)], toilet: [toilet()] },
  },
  {
    id: 'ecentre',
    name: 'E-Centre Mall & Ozone Cinemas',
    landmark: 'ecentre',
    kind: 'cinema',
    hours: [10, 23],
    patrons: 5,
    theme: { wall: 0x23202a, floor: 0x3a2e2e, accent: 0xe50914 },
    offers: {
      counter: [
        { id: 'popcorn', label: 'Popcorn and drink', icon: '🍿', price: 2500, minutes: 10, clip: 'idle', effects: { hunger: 15, fun: 5 } },
        { id: 'shawarma', label: 'Shawarma from the food court', icon: '🌯', price: 3000, minutes: 25, clip: 'sit_eat', at: 'seat', effects: { hunger: 38, fun: 8, bladder: -6 } },
      ],
      screen: [
        { id: 'movie', label: 'Watch the new Nollywood blockbuster', icon: '🎬', price: 5000, minutes: 120, clip: 'sit', at: 'seat', effects: { fun: 75, social: 10, energy: -5 }, buff: { label: 'Saw a great film at Ozone', mood: 8, hours: 8 } },
      ],
      toilet: [toilet()],
    },
  },
  {
    id: 'tejuosho_market',
    name: 'Tejuosho Ultra-Modern Market',
    landmark: 'tejuosho_market',
    kind: 'market',
    hours: [7, 19],
    patrons: 5,
    theme: { wall: 0xe8e2cf, floor: 0x9c968a, accent: 0x1f6fb2 },
    offers: {
      counter: [
        { id: 'foodstuff', label: 'Buy foodstuff (Indomie, eggs, rice)', icon: '🛒', price: 2500, minutes: 10, clip: 'talk', give: { foodstuff: 3 } },
        { id: 'snacks', label: 'Buy gala and pure water (×4)', icon: '🥤', price: 1000, minutes: 5, clip: 'talk', give: { snack: 4 } },
      ],
      rack: [
        { id: 'okrika', label: 'Bend down select: okrika shirt', icon: '👕', price: 3000, minutes: 30, clip: 'work', effects: { fun: 18 }, xp: { hustle: 8 }, buff: { label: 'Fresh okrika fit', mood: 6, hours: 24 } },
        { id: 'new', label: 'New outfit for owambe', icon: '👔', price: 15000, minutes: 40, clip: 'work', effects: { fun: 25 }, buff: { label: 'Looking like money', mood: 12, hours: 48 } },
      ],
      toilet: [toilet(100)],
    },
  },
  {
    id: 'yaba_market',
    name: 'Yaba Market',
    landmark: 'yaba_market',
    kind: 'market',
    hours: [6, 19.5],
    patrons: 6,
    theme: { wall: 0xcdb48a, floor: 0x8f8170, accent: 0xd35400 },
    offers: {
      counter: [
        { id: 'foodstuff', label: 'Buy foodstuff (Indomie, eggs, rice)', icon: '🛒', price: 2300, minutes: 10, clip: 'talk', give: { foodstuff: 3 } },
        { id: 'snacks', label: 'Buy gala and pure water (×4)', icon: '🥤', price: 900, minutes: 5, clip: 'talk', give: { snack: 4 } },
      ],
      rack: [
        { id: 'okrika', label: 'Bend down select: okrika shirt', icon: '👕', price: 2500, minutes: 30, clip: 'work', effects: { fun: 18 }, xp: { hustle: 8 }, buff: { label: 'Fresh okrika fit', mood: 6, hours: 24 } },
        { id: 'discount', label: 'Hunt evening discount sales (6–7pm)', icon: '🏷️', price: 1500, minutes: 40, clip: 'work', effects: { fun: 15 }, xp: { hustle: 12 }, hours: [18, 19.5] },
      ],
      toilet: [toilet(100)],
    },
  },
  ...['sabo_market', 'railway_mini_market', 'mallmart'].map((id): PlaceDef => ({
    id,
    name: { sabo_market: 'Sabo Market', railway_mini_market: 'Railway Mini Market', mallmart: 'Mallmart Hypermarket' }[id]!,
    landmark: id,
    kind: id === 'mallmart' ? 'supermarket' : 'market',
    hours: id === 'mallmart' ? [8, 19] : [8, 19],
    patrons: 3,
    theme: { wall: id === 'mallmart' ? 0xf4f4f0 : 0xd7c49e, floor: 0x9a948a, accent: id === 'mallmart' ? 0x0057a8 : 0x8e44ad },
    offers: {
      counter: [
        { id: 'foodstuff', label: 'Buy foodstuff (Indomie, eggs, rice)', icon: '🛒', price: id === 'mallmart' ? 3000 : 2400, minutes: 10, clip: 'talk', give: { foodstuff: 3 } },
        { id: 'snacks', label: 'Buy gala and pure water (×4)', icon: '🥤', price: 1000, minutes: 5, clip: 'talk', give: { snack: 4 } },
      ],
      shelf: [{ id: 'browse', label: 'Window shop', icon: '👀', minutes: 30, clip: 'idle', effects: { fun: 10 } }],
    },
  })),
  {
    id: 'cchub',
    name: 'CcHUB (Co-Creation Hub)',
    landmark: 'cchub',
    kind: 'office',
    hours: [8, 21],
    patrons: 4,
    theme: { wall: 0xf2f2f2, floor: 0x7c7c7c, accent: 0x00a86b },
    offers: {
      desk: [
        { id: 'cowork', label: 'Co-working day pass: build side project', icon: '💻', price: 3000, minutes: 180, clip: 'sit_work', at: 'seat', effects: { fun: -4, energy: -10, social: 8 }, xp: { coding: 90 } },
      ],
      stage: [
        { id: 'meetup', label: 'Attend Yabacon Valley meetup (6–9pm)', icon: '🎤', minutes: 120, clip: 'sit', at: 'seat', effects: { social: 35, fun: 15, hunger: 12 }, xp: { coding: 40, charisma: 20 }, hours: [18, 21], buff: { label: 'Networked at the meetup', mood: 6, hours: 12 } },
      ],
      toilet: [toilet()],
    },
  },
  {
    id: 'unilag',
    name: 'UNILAG Library',
    landmark: 'unilag',
    kind: 'campus',
    hours: [8, 22],
    patrons: 5,
    theme: { wall: 0xe9e1c9, floor: 0x7a6650, accent: 0x1a4f8b },
    offers: {
      books: [
        { id: 'study_code', label: 'Read programming books', icon: '📘', minutes: 120, clip: 'sit_work', at: 'seat', effects: { fun: -10, energy: -8 }, xp: { coding: 45 } },
        { id: 'study_biz', label: 'Read business books', icon: '📗', minutes: 120, clip: 'sit_work', at: 'seat', effects: { fun: -8, energy: -8 }, xp: { hustle: 35, charisma: 15 } },
      ],
      stage: [
        { id: 'lecture', label: 'Sit in on a public lecture', icon: '🎓', minutes: 90, clip: 'sit', at: 'seat', effects: { social: 15, fun: 5, energy: -6 }, xp: { charisma: 25, coding: 15 }, hours: [9, 16] },
      ],
      toilet: [toilet()],
    },
  },
  {
    id: 'yabatech',
    name: 'YABATECH Library',
    landmark: 'yabatech',
    kind: 'campus',
    hours: [8, 20],
    patrons: 4,
    theme: { wall: 0xe5dcc2, floor: 0x6f5e4b, accent: 0x0b6b3a },
    offers: {
      books: [
        { id: 'study_code', label: 'Read programming books', icon: '📘', minutes: 120, clip: 'sit_work', at: 'seat', effects: { fun: -10, energy: -8 }, xp: { coding: 45 } },
      ],
      toilet: [toilet()],
    },
  },
  ...['army_hospital', 'idh', 'neuro_psych'].map((id): PlaceDef => ({
    id,
    name: { army_hospital: '68 Nigerian Army Reference Hospital', idh: 'Infectious Disease Hospital', neuro_psych: 'Federal Neuro-Psychiatric Hospital' }[id]!,
    landmark: id,
    kind: 'hospital',
    hours: [0, 0],
    patrons: 3,
    theme: { wall: 0xeef3f1, floor: 0xb9c2c0, accent: 0x16a085 },
    offers: {
      reception: [
        { id: 'doctor', label: 'See a doctor', icon: '🩺', price: 8000, minutes: 90, clip: 'sit', at: 'seat', special: 'doctor', effects: { energy: 25 } },
      ],
      bed: [{ id: 'rest', label: 'Rest on a ward bed (₦5,000)', icon: '🛏️', price: 5000, minutes: 6 * 60, clip: 'lie', at: 'bed', special: 'sleep', effects: { energy: 80, hunger: -10 }, speed: 120 }],
      toilet: [toilet()],
    },
  })),
  ...['efex_hotel', 'unilag_guest_house'].map((id): PlaceDef => ({
    id,
    name: id === 'efex_hotel' ? 'Efex Hotel' : 'UNILAG Guest House',
    landmark: id,
    kind: 'hotel',
    hours: [0, 0],
    patrons: 2,
    theme: { wall: 0xe8dcc8, floor: 0x6d4c3d, accent: 0x8e2b2b },
    offers: {
      reception: [eat('room_service', 'Hotel jollof and chicken', 6000, 60, { fun: 10 })],
      bed: [{ id: 'sleep', label: 'Rent a room for the night (₦25,000)', icon: '🛏️', price: 25000, minutes: 8 * 60, clip: 'lie', at: 'bed', special: 'sleep', effects: { energy: 100, hygiene: 60, bladder: -30, hunger: -15 }, speed: 120, buff: { label: 'Slept in AC', mood: 10, hours: 12 } }],
      shower: [{ id: 'shower', label: 'Hot shower', icon: '🚿', price: 2000, minutes: 15, clip: 'idle', effects: { hygiene: 100, fun: 8 } }],
      toilet: [toilet()],
    },
  })),
];

export const placeById = (id: string) => PLACES.find((p) => p.id === id);

/** Outdoor hustles offered at transport hubs (no interior). */
export const STREET_HUSTLE: Offer = {
  id: 'hawk', label: 'Hawk pure water in traffic (bag ₦600)', icon: '💧', price: 600, minutes: 120, clip: 'walk',
  effects: { energy: -16, hygiene: -18, hunger: -10, fun: -5, social: 10 }, xp: { hustle: 30 },
};
