// Song DNA: the conversation decides what the final song sounds like.
// The same words always make the same song; different words, a different song.
//
//   mood words      → key "colour" (bright lydian … dark phrygian)
//   energy (!, CAPS, short bursts, party words) → tempo + busier drums
//   the exact text  → a seed that picks key, chords, kit, beat, instruments
//   secret words    → hidden twists (and the end screen counts how many you found)
//   style           → the top gene: a flavour of the garden (lo-fi, bossa, waltz…) that
//                     sets tempo, groove, space and texture; the dice vary things inside it

import { hash } from './glyphs.js';
import { PICTURE_WORDS } from './pictures.js';

// Every picture's words are secret words too (they draw something in the dance).
const PICTURE_WORD_SET = new Set(Object.values(PICTURE_WORDS).flat());

// Scales as semitone steps. `penta` = the 5 safest notes for singing.
export const MODES = {
  lydian: { steps: [0, 2, 4, 6, 7, 9, 11], penta: [0, 1, 2, 4, 5], feel: 'dreamy' },
  major: { steps: [0, 2, 4, 5, 7, 9, 11], penta: [0, 1, 2, 4, 5], feel: 'bright' },
  mixolydian: { steps: [0, 2, 4, 5, 7, 9, 10], penta: [0, 1, 2, 4, 5], feel: 'warm' },
  dorian: { steps: [0, 2, 3, 5, 7, 9, 10], penta: [0, 2, 3, 4, 6], feel: 'bittersweet' },
  minor: { steps: [0, 2, 3, 5, 7, 8, 10], penta: [0, 2, 3, 4, 6], feel: 'melancholy' },
  phrygian: { steps: [0, 1, 3, 5, 7, 8, 10], penta: [0, 2, 3, 4, 6], feel: 'mysterious' },
};

// Chord progressions as scale degrees (0 = home chord).
const PROGRESSIONS = [
  [0, 5, 3, 4], [0, 3, 5, 4], [5, 3, 0, 4], [0, 4, 5, 3],
  [1, 4, 0, 0], [0, 3, 0, 4], [0, 6, 5, 4], [3, 4, 2, 5],
];

const KITS = {
  soft: ['broken', 'half', 'shuffle'],
  glitch: ['broken', 'trap', 'half'],
  deep: ['trap', 'half'],
  tick: ['sparse', 'shuffle'],
  pulse: ['four'],
};
const LEADS = ['mallet', 'bells', 'kalimba', 'glass', 'chip', 'harp'];

// Styles: flavours of the same garden (the rain, the plinks and the reverb stay), each a
// matching bundle so a song has a clear identity instead of an average of random picks.
//   bpm      tempo range (energy picks low or high inside it)
//   patterns drum beats · padMode: hold (long chords) | stab (short comping) | waltz (pah-pah)
//   bassStyle the bass rhythm (roots = the original) · space: reverb amount 0–1
//   tone     muffle (lo-fi) | crunch (chip)
//   meters   beats per bar: 4 = 4/4, 3 = 3/4, 6 = 6/8, 5 = 5/4, 7 = 7/8 (one is rolled)
//   rhythms  how the players' lines are sung (RHYTHMS) · contours: the melody's shape
//   voice    a colour on the players' own instruments · harmony: a soft second line under the melody
// A list left out = anything goes (the original garden behaviour).
export const STYLES = {
  garden: { meters: [4, 4, 4, 3, 6, 5, 7] }, // the original sound, everything rolled freely (any rhythm, any shape)
  drift: {
    meters: [4, 6, 5], rhythms: ['lazy', 'dotted', 'straight'], contours: ['wave', 'walk'], voice: 'shimmer', harmony: ['octave', null],
    bpm: [64, 78], kits: ['tick', 'soft'], patterns: ['sparse'], leads: ['glass', 'bells'], pads: ['choir', 'warm', 'strings'],
    basses: ['sub', 'round'], arps: ['wide', 'updown'], arpRate: 2, swing: [0, 0], space: 0.75, quietDrums: true, echo: 0.15,
  },
  lofi: {
    meters: [4, 4, 6], rhythms: ['longshort', 'dotted', 'lazy'], contours: ['walk', 'pedal'], voice: 'tape', harmony: [null, 'third'],
    bpm: [70, 88], kits: ['soft'], patterns: ['broken', 'half'], leads: ['mallet', 'kalimba'], pads: ['warm', 'organ'],
    basses: ['round'], arps: ['broken', 'alberti'], arpRate: 2, swing: [0.22, 0.32], space: 0.35, tone: 'muffle', bassStyle: 'walk',
  },
  pulse: {
    meters: [4, 4, 7], rhythms: ['straight', 'skip', 'sync'], contours: ['arp', 'pedal'], voice: 'echo', harmony: ['octave'],
    bpm: [104, 120], kits: ['pulse'], patterns: ['four'], leads: ['bells', 'glass', 'chip'], pads: ['strings'],
    basses: ['buzz', 'pluck'], arps: ['up', 'updown'], arpRate: 1, swing: [0, 0], space: 0.55, bassStyle: 'pulse',
  },
  bossa: {
    meters: [4], rhythms: ['dotted', 'sync'], contours: ['walk', 'wave'], voice: 'warm', harmony: ['third', null],
    bpm: [118, 132], kits: ['soft', 'tick'], patterns: ['bossa'], leads: ['harp', 'kalimba', 'mallet'], pads: ['warm'],
    basses: ['round', 'pluck'], arps: ['alberti', 'broken'], arpRate: 2, swing: [0.06, 0.14], space: 0.3, padMode: 'stab', bassStyle: 'bossa',
  },
  chip: {
    meters: [4, 7, 5], rhythms: ['skip', 'straight', 'triplet'], contours: ['arp', 'walk'], voice: 'crunch', harmony: ['octave', null],
    bpm: [138, 156], kits: ['glitch', 'tick'], patterns: ['broken', 'four'], leads: ['chip'], pads: ['organ'],
    basses: ['pluck'], arps: ['up', 'down', 'updown'], arpRate: 1, swing: [0, 0], space: 0.15, tone: 'crunch', bassStyle: 'pulse',
  },
  waltz: {
    meters: [3, 6], rhythms: ['lazy', 'straight', 'triplet'], contours: ['wave', 'arp'], voice: 'tremolo', harmony: ['third', 'octave'],
    bpm: [92, 108], kits: ['soft', 'tick'], patterns: ['waltz'], leads: ['bells', 'kalimba', 'glass'], pads: ['warm', 'strings'],
    basses: ['round'], arps: ['up', 'updown'], arpRate: 2, swing: [0, 0], space: 0.55, padMode: 'waltz', bassStyle: 'waltz',
  },
};
// How a line is sung: note lengths in 16th steps, cycling through the line (the last note rings).
export const RHYTHMS = {
  straight: [2], // even 8ths (the original)
  dotted: [3, 3, 2], // the tresillo: long, long, short
  longshort: [3, 1], // a lazy swing
  lazy: [4, 2], // half a beat behind
  skip: [1, 1, 2], // quick-quick-slow
  triplet: [4 / 3, 4 / 3, 4 / 3], // three to a beat
  sync: [1, 2, 1, 2, 2], // syncopated: notes land between the beats
};
const CONTOURS = ['walk', 'arp', 'wave', 'pedal'];
// What the different time signatures play, and what to call them.
const METER_BEATS = { 3: 'waltz', 6: 'sixeight', 5: 'five', 7: 'seven' };
const METER_NAMES = { 3: '3/4', 4: '4/4', 5: '5/4', 6: '6/8', 7: '7/8' };

// How likely each style is, by the conversation's energy (calm · normal · hype).
const STYLE_ODDS = {
  calm: { garden: 3, drift: 3, lofi: 3, waltz: 2, bossa: 1 },
  normal: { garden: 3, lofi: 2, bossa: 3, pulse: 2, waltz: 1, drift: 1 },
  hype: { garden: 2, pulse: 3, chip: 2, bossa: 1 },
};
// Words that push a song toward a style (the first one said wins).
const STYLE_WORDS = {
  party: 'pulse', dance: 'pulse', club: 'pulse', disco: 'pulse',
  sleep: 'drift', sleepy: 'drift', dream: 'drift', dreams: 'drift', space: 'drift', float: 'drift',
  chill: 'lofi', study: 'lofi', coffee: 'lofi', homework: 'lofi', cozy: 'lofi',
  beach: 'bossa', summer: 'bossa', vacation: 'bossa', brazil: 'bossa', sunny: 'bossa',
  game: 'chip', games: 'chip', gaming: 'chip', nintendo: 'chip', pixel: 'chip', videogame: 'chip', videogames: 'chip',
  halloween: 'waltz', spooky: 'waltz', ballroom: 'waltz', waltz: 'waltz',
};
const PADS = ['warm', 'strings', 'choir', 'organ'];
const BASSES = ['round', 'sub', 'buzz', 'pluck'];
const ARPS = ['up', 'down', 'updown', 'alberti', 'broken', 'wide'];
const NOTE_NAMES = ['C', 'D♭', 'D', 'E♭', 'E', 'F', 'G♭', 'G', 'A♭', 'A', 'B♭', 'B'];

const HAPPY = new Set(['love', 'happy', 'yes', 'good', 'great', 'fun', 'haha', 'lol', 'smile', 'beautiful',
  'sweet', 'cute', 'yay', 'excited', 'hope', 'nice', 'glad', 'best', 'amazing', 'thanks', 'thank', 'kiss', 'hug',
  'laugh', 'together', 'friend', 'friends', 'wonderful', 'awesome', 'cool', 'warm', 'bright']);
const SAD = new Set(['miss', 'sad', 'sorry', 'tired', 'alone', 'cry', 'lost', 'hate', 'bad', 'dark', 'cold',
  'never', 'gone', 'hurt', 'afraid', 'scared', 'lonely', 'empty', 'goodbye', 'bye', 'leave', 'left', 'wish',
  'broken', 'worried', 'anxious', 'no', 'nothing', 'forget', 'late', 'far']);
const HYPE = new Set(['party', 'dance', 'omg', 'wow', 'lets', "let's", 'go', 'now', 'run', 'fast', 'wild',
  'crazy', 'yeah', 'hell', 'hype', 'woo']);

// The feeling of one message, for how its glyphs move:
// 'excited' (!, CAPS, hype words) spin · 'happy' bounce · 'sad' sink · 'calm' drift.
export function messageMood(text) {
  const words = text.toLowerCase().match(/[a-z']+/g) || [];
  let mood = 0;
  let energy = (text.match(/!/g) || []).length + (text.match(/\b[A-Z]{2,}\b/g) || []).length;
  for (const w of words) {
    if (HAPPY.has(w)) mood++;
    if (SAD.has(w)) mood--;
    if (HYPE.has(w)) energy++;
  }
  if (energy >= 2) return 'excited';
  if (mood > 0) return 'happy';
  if (mood < 0) return 'sad';
  return 'calm';
}

// Secret words → hidden twists. Players are never told the list.
// Each is a recipe of ingredients. Ingredients STACK: the first secret to name a
// lead / pad / kit / bass gets it, and a later secret with a different one is
// layered on top (a second lead, a second drum kit's snare + hats…). Numbers add up.
const SECRETS = {
  rain: { rain: 2, delayTime: '8n.' },
  storm: { rain: 2, kit: 'glitch' },
  night: { darker: 1, pad: 'choir' },
  moon: { darker: 1, lead: 'glass' },
  stars: { lead: 'bells', arp: 'wide' },
  love: { brighter: 1, lead: 'bells' },
  heart: { brighter: 1, pad: 'warm' },
  dance: { kit: 'pulse', bpm: 12 },
  party: { kit: 'pulse', bpm: 14 },
  sleep: { kit: 'tick', bpm: -16, arpRate: 2 },
  dream: { darker: -1, pad: 'choir', echo: 0.15 },
  fire: { kit: 'glitch', bass: 'buzz' },
  ocean: { delayTime: '4n', echo: 0.2 },
  sea: { delayTime: '4n', echo: 0.15 },
  sun: { brighter: 1, lead: 'kalimba' },
  summer: { brighter: 1, lead: 'kalimba' },
  game: { lead: 'chip', bass: 'pluck' },
  play: { lead: 'chip' },
  ghost: { darker: 1, lead: 'glass', echo: 0.2 },
  home: { pad: 'organ', kit: 'soft' },
  frog: { lead: 'kalimba', bass: 'pluck', swing: 0.2, bpm: 6 }, // a little hoppy and bouncy
  cloud: { pad: 'choir', echo: 0.2, bpm: -8, brighter: 1 }, // soft and floaty
};
const CATEGORIES = ['lead', 'pad', 'kit', 'bass', 'arp', 'delayTime'];

function applySecret(d, recipe, claimed) {
  for (const key of CATEGORIES) {
    if (!recipe[key]) continue;
    if (!claimed.has(key)) {
      d[key] = recipe[key];
      claimed.add(key);
    } else if (d[key] !== recipe[key]) {
      d.layers[key] ??= recipe[key]; // already taken → play it as an extra layer
    }
  }
  d.darker += recipe.darker || 0;
  d.brighter += recipe.brighter || 0;
  d.bpmShift += recipe.bpm || 0;
  d.rain *= 1 + (recipe.rain || 0);
  d.delayFeedback = Math.min(0.65, d.delayFeedback + (recipe.echo || 0));
  if (recipe.swing) d.swing = Math.max(d.swing, recipe.swing);
  if (recipe.arpRate) d.arpRate = recipe.arpRate;
}

// Seeded random: same text → same "random" choices.
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// options.style forces a style (the sound preview); options.jam leaves out waltz time
// (a jam's loops are built on 4-beat bars).
export function songDNA(messages, options = {}) {
  const text = messages.map((m) => m.text).join(' / ');
  const words = text.toLowerCase().match(/[a-z']+/g) || [];
  const rand = rng(hash(text));
  const choose = (list) => list[Math.floor(rand() * list.length)];

  let mood = 0;
  let energy = 0;
  for (const w of words) {
    if (HAPPY.has(w)) mood++;
    if (SAD.has(w)) mood--;
    if (HYPE.has(w)) energy += 2;
  }
  energy += (text.match(/!/g) || []).length * 2;
  energy += (text.match(/\b[A-Z]{2,}\b/g) || []).length * 2; // SHOUTING
  const avgLen = messages.reduce((n, m) => n + m.text.length, 0) / Math.max(1, messages.length);
  if (avgLen < 18) energy += 3; // quick back-and-forth
  if (avgLen > 45) energy -= 3; // long, thoughtful messages

  // The style comes first: a word that pushes one, or the dice weighted by energy.
  const band = energy >= 6 ? 'hype' : energy >= 2 ? 'normal' : 'calm';
  const pushed = words.map((w) => STYLE_WORDS[w]).find(Boolean);
  const odds = Object.entries(STYLE_ODDS[band]).filter(([name]) => !(options.jam && name === 'waltz'));
  let roll = rand() * odds.reduce((n, [, w]) => n + w, 0);
  const rolled = odds.find(([, w]) => (roll -= w) < 0)?.[0] || 'garden';
  let styleName = options.style || pushed || rolled;
  if (options.jam && styleName === 'waltz') styleName = 'garden'; // a jam's loops are built on 4-beat bars
  const st = STYLES[styleName];
  const within = (list, all) => choose(list || all);

  const d = {
    seed: hash(text),
    style: styleName,
    root: Math.floor(rand() * 12),
    progression: choose(PROGRESSIONS),
    kit: within(st.kits, Object.keys(KITS)),
    lead: within(st.leads, LEADS),
    pad: within(st.pads, PADS),
    bass: within(st.basses, BASSES),
    arp: within(st.arps, ARPS),
    arpRate: st.arpRate || (rand() < 0.5 ? 1 : 2), // 16ths or 8ths
    swing: st.swing ? st.swing[0] + rand() * (st.swing[1] - st.swing[0]) : rand() < 0.4 ? 0.12 + rand() * 0.18 : 0,
    delayTime: choose(['8n', '8n.', '4n', '16n.']),
    delayFeedback: 0.2 + rand() * 0.25 + (st.echo || 0),
    meter: options.jam ? 4 : choose(st.meters || [4]),
    rhythm: within(st.rhythms, Object.keys(RHYTHMS)),
    contour: within(st.contours, CONTOURS),
    voiceColour: st.voice || null,
    harmony: st.harmony ? choose(st.harmony) : null,
    padMode: st.padMode || 'hold',
    bassStyle: st.bassStyle || 'roots',
    space: st.space ?? 0.5,
    tone: st.tone || null,
    quietDrums: !!st.quietDrums,
    rain: 0.4 + rand() * 0.6,
    brighter: 0,
    darker: st.darker || 0,
    bpmShift: 0,
    secrets: [],
    layers: {}, // extra sounds from secrets that stacked on top (e.g. a second lead)
  };

  // Secret words, in the order they were said, each once — and they stack.
  const claimed = new Set();
  for (const w of new Set(words)) {
    if (SECRETS[w]) applySecret(d, SECRETS[w], claimed);
    if (SECRETS[w] || PICTURE_WORD_SET.has(w)) d.secrets.push(w);
  }

  // Mood → mode, from brightest to darkest.
  const ladder = ['lydian', 'major', 'mixolydian', 'dorian', 'minor', 'phrygian'];
  const base = mood >= 2 ? 0.5 : mood === 1 ? 1.5 : mood === 0 ? 2.5 : mood === -1 ? 3.5 : 4.5;
  const step = Math.round(base + (rand() - 0.5) + d.darker - d.brighter);
  d.mode = ladder[Math.max(0, Math.min(ladder.length - 1, step))];

  // Energy → tempo; the kit's beat comes from the kit's own repertoire.
  // Energy → tempo: the original bands, or (in a style) low / middle / high inside its range.
  let bpm;
  if (st.bpm) {
    const [lo, hi] = st.bpm;
    const at = band === 'hype' ? 0.7 : band === 'normal' ? 0.4 : 0.1;
    bpm = lo + (hi - lo) * Math.min(1, at + rand() * 0.3);
  } else bpm = energy >= 6 ? 128 + rand() * 12 : energy >= 2 ? 110 + rand() * 14 : 92 + rand() * 14;
  const [floor, ceiling] = st.bpm ? [st.bpm[0] - 10, st.bpm[1] + 10] : [80, 150];
  d.bpm = Math.round(Math.max(floor, Math.min(ceiling, bpm + d.bpmShift)));
  d.pattern = st.patterns ? choose(st.patterns) : choose(KITS[d.kit] || KITS.soft);
  if (d.meter !== 4 && !(d.meter === 3 && d.pattern === 'waltz')) d.pattern = METER_BEATS[d.meter]; // odd meters get their own beat
  d.meterName = METER_NAMES[d.meter];
  if (energy >= 6 && d.arpRate === 2 && rand() < 0.6) d.arpRate = 1;

  d.keyName = `${NOTE_NAMES[d.root]} ${d.mode}`;
  d.feel = MODES[d.mode].feel;
  return d;
}
