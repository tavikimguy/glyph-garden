// Song DNA: the conversation decides what the final song sounds like.
// The same words always make the same song; different words, a different song.
//
//   mood words      → key "colour" (bright lydian … dark phrygian)
//   energy (!, CAPS, short bursts, party words) → tempo + busier drums
//   the exact text  → a seed that picks key, chords, kit, beat, instruments
//   secret words    → hidden twists (and the end screen counts how many you found)

import { hash } from './glyphs.js';

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

export function songDNA(messages) {
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

  const d = {
    seed: hash(text),
    root: Math.floor(rand() * 12),
    progression: choose(PROGRESSIONS),
    kit: choose(Object.keys(KITS)),
    lead: choose(LEADS),
    pad: choose(PADS),
    bass: choose(BASSES),
    arp: choose(ARPS),
    arpRate: rand() < 0.5 ? 1 : 2, // 16ths or 8ths
    swing: rand() < 0.4 ? 0.12 + rand() * 0.18 : 0,
    delayTime: choose(['8n', '8n.', '4n', '16n.']),
    delayFeedback: 0.2 + rand() * 0.25,
    rain: 0.4 + rand() * 0.6,
    brighter: 0,
    darker: 0,
    bpmShift: 0,
    secrets: [],
    layers: {}, // extra sounds from secrets that stacked on top (e.g. a second lead)
  };

  // Secret words, in the order they were said, each once — and they stack.
  const claimed = new Set();
  for (const w of new Set(words)) {
    if (SECRETS[w]) {
      applySecret(d, SECRETS[w], claimed);
      d.secrets.push(w);
    }
  }

  // Mood → mode, from brightest to darkest.
  const ladder = ['lydian', 'major', 'mixolydian', 'dorian', 'minor', 'phrygian'];
  const base = mood >= 2 ? 0.5 : mood === 1 ? 1.5 : mood === 0 ? 2.5 : mood === -1 ? 3.5 : 4.5;
  const step = Math.round(base + (rand() - 0.5) + d.darker - d.brighter);
  d.mode = ladder[Math.max(0, Math.min(ladder.length - 1, step))];

  // Energy → tempo; the kit's beat comes from the kit's own repertoire.
  const bpm = energy >= 6 ? 128 + rand() * 12 : energy >= 2 ? 110 + rand() * 14 : 92 + rand() * 14;
  d.bpm = Math.round(Math.max(80, Math.min(150, bpm + d.bpmShift)));
  d.pattern = choose(KITS[d.kit]);
  if (energy >= 6 && d.arpRate === 2 && rand() < 0.6) d.arpRate = 1;

  d.keyName = `${NOTE_NAMES[d.root]} ${d.mode}`;
  d.feel = MODES[d.mode].feel;
  return d;
}
