// Sound engine: rain plinks, an always-on ambient bed, a singer that rebuilds
// words out of a voice bank (or a robot voice), and a finale band built from
// the conversation's song DNA (see songdna.js).

import { hash } from './glyphs.js';
import { getClip, findSyllable, findOnset } from './voicebank.js';
import { MODES, RHYTHMS } from './songdna.js';

// The current key. It follows the conversation (setKey after each message),
// so the whole space drifts into new keys as people talk.
const DEFAULT_KEY = { root: 0, mode: 'major', progression: [0, 5, 3, 4] };
let key = DEFAULT_KEY;
let keyRain = null; // raindrop notes in the current key

const midiNote = (m) => Tone.Frequency(m, 'midi').toNote();

// 4-note chord on scale degree `deg` of key k, voiced around C3.
function chordFor(k, deg) {
  const { steps } = MODES[k.mode];
  return [0, 2, 4, 6].map((n) => {
    const d = deg + n;
    return midiNote(48 + k.root + steps[d % 7] + 12 * Math.floor(d / 7));
  });
}

// The 5 "safe" notes of the key, two octaves up high: raindrops and chimes.
function rainNotes(k) {
  const { steps, penta } = MODES[k.mode];
  return [0, 12].flatMap((o) => penta.map((d) => midiNote(72 + k.root + steps[d] + o)));
}

export function setKey(dna) {
  key = dna;
  keyRain = rainNotes(dna);
}

// Compound vowels are sung as a quick glide into the main vowel (ㅑ = ㅣ→ㅏ).
const VOWEL_SOUND = {
  'ㅐ': ['ㅔ'], 'ㅑ': ['ㅣ', 'ㅏ'], 'ㅒ': ['ㅣ', 'ㅔ'], 'ㅕ': ['ㅣ', 'ㅓ'], 'ㅖ': ['ㅣ', 'ㅔ'],
  'ㅛ': ['ㅣ', 'ㅗ'], 'ㅠ': ['ㅣ', 'ㅜ'], 'ㅘ': ['ㅜ', 'ㅏ'], 'ㅙ': ['ㅜ', 'ㅔ'], 'ㅚ': ['ㅜ', 'ㅔ'],
  'ㅝ': ['ㅜ', 'ㅓ'], 'ㅞ': ['ㅜ', 'ㅔ'], 'ㅟ': ['ㅜ', 'ㅣ'], 'ㅢ': ['ㅡ', 'ㅣ'],
};

// Vowel "shapes" for robot voices: the three resonant frequencies (formants).
const FORMANTS = {
  'ㅏ': [800, 1200, 2500], 'ㅓ': [600, 1000, 2400], 'ㅗ': [450, 800, 2400], 'ㅜ': [330, 750, 2300],
  'ㅡ': [350, 1350, 2400], 'ㅣ': [280, 2300, 3000], 'ㅔ': [480, 1900, 2600],
};
const FRICATIVES = new Set(['ㅅ', 'ㅈ', 'ㅊ', 'ㅎ']);

// Robot voices. base = singing pitch (Hz); shift > 1 moves the vowel shapes up,
// which is what makes a voice sound smaller/lighter (more "feminine"), not just higher.
// osc = the raw tone (buzzy saw, hollow square, metallic AM…); scoop = slide into notes.
const ROBOTS = {
  velvet: { base: 125, shift: 1.0, osc: { type: 'sawtooth' }, breath: 0.03, vibrato: [4.5, 0.08], scoop: true },
  silk: { base: 245, shift: 1.18, osc: { type: 'sawtooth' }, breath: 0.12, vibrato: [5.5, 0.12], scoop: true },
  choir: { base: 185, shift: 1.08, osc: { type: 'fatsawtooth', count: 3, spread: 30 }, breath: 0.04, vibrato: [5, 0.1], scoop: true },
  glass: { base: 330, shift: 1.25, osc: { type: 'fmsine', harmonicity: 2, modulationIndex: 2 }, breath: 0, vibrato: [6, 0.06], scoop: true },
  ghost: { base: 200, shift: 1.12, osc: null, breath: 1, vibrato: [0, 0], scoop: false }, // a whisper
  android: { base: 160, shift: 1.0, osc: { type: 'amsquare', harmonicity: 0.5 }, breath: 0, vibrato: [0, 0], scoop: false },
  pixel: { base: 300, shift: 1.2, osc: { type: 'square' }, breath: 0, vibrato: [7, 0.05], scoop: false },
  baritone: { base: 95, shift: 0.9, osc: { type: 'fatsawtooth', count: 2, spread: 15 }, breath: 0.05, vibrato: [4, 0.1], scoop: true },
  pixie: { base: 420, shift: 1.35, osc: { type: 'fmsawtooth', harmonicity: 1, modulationIndex: 1.5 }, breath: 0.1, vibrato: [6.5, 0.1], scoop: true },
  auto: { base: 200, shift: 1.05, osc: { type: 'pwm', modulationFrequency: 0.4 }, breath: 0, vibrato: [0, 0], scoop: false }, // hard autotune
  vapor: { base: 150, shift: 0.95, osc: { type: 'fatsawtooth', count: 5, spread: 50 }, breath: 0.1, vibrato: [3, 0.2], scoop: true },
};
// Instrument "voices": the player's melody played on an instrument instead of sung.
// make() builds the instrument; base = the pitch range it plays around.
const INSTRUMENTS = {
  keys: { base: 260, make: () => new Tone.PolySynth(Tone.FMSynth, { harmonicity: 3, modulationIndex: 10, envelope: { attack: 0.005, decay: 1.2, sustain: 0.1, release: 1 }, modulationEnvelope: { attack: 0.002, decay: 0.5, sustain: 0, release: 0.5 }, volume: -10 }) },
  flute: { base: 520, make: () => new Tone.PolySynth(Tone.Synth, { oscillator: { type: 'sine' }, envelope: { attack: 0.06, decay: 0.1, sustain: 0.8, release: 0.2 }, volume: -8 }), fx: () => [new Tone.Vibrato(5, 0.08)] },
  brass: { base: 230, make: () => new Tone.MonoSynth({ oscillator: { type: 'sawtooth' }, filter: { Q: 2 }, filterEnvelope: { attack: 0.05, decay: 0.2, sustain: 0.6, baseFrequency: 300, octaves: 3 }, envelope: { attack: 0.03, decay: 0.1, sustain: 0.8, release: 0.15 }, volume: -12 }) },
  violin: { base: 330, make: () => new Tone.PolySynth(Tone.Synth, { oscillator: { type: 'fatsawtooth', count: 3, spread: 12 }, envelope: { attack: 0.12, decay: 0.1, sustain: 0.9, release: 0.3 }, volume: -16 }), fx: () => [new Tone.Vibrato(5.5, 0.12), new Tone.Filter(3200, 'lowpass')] },
  synth: { base: 400, make: () => new Tone.MonoSynth({ oscillator: { type: 'square' }, portamento: 0.04, filterEnvelope: { attack: 0.01, decay: 0.2, sustain: 0.5, baseFrequency: 800, octaves: 2 }, envelope: { attack: 0.01, decay: 0.1, sustain: 0.7, release: 0.1 }, volume: -16 }) },
  musicbox: { base: 700, make: () => new Tone.PolySynth(Tone.FMSynth, { harmonicity: 5, modulationIndex: 4, envelope: { attack: 0.001, decay: 0.8, sustain: 0, release: 0.8 }, modulationEnvelope: { attack: 0.001, decay: 0.3, sustain: 0, release: 0.3 }, volume: -10 }) },
  steelpan: { base: 400, make: () => new Tone.PolySynth(Tone.FMSynth, { harmonicity: 2.5, modulationIndex: 3, envelope: { attack: 0.002, decay: 0.5, sustain: 0.1, release: 0.4 }, modulationEnvelope: { attack: 0.002, decay: 0.2, sustain: 0, release: 0.2 }, volume: -8 }) },
  // plucked strings
  harp: { base: 330, make: () => new Tone.PluckSynth({ attackNoise: 0.6, dampening: 6000, resonance: 0.995, volume: -10 }) },
  banjo: { base: 300, make: () => new Tone.PluckSynth({ attackNoise: 3, dampening: 7000, resonance: 0.9, volume: -12 }), fx: () => [new Tone.Filter(250, 'highpass')] },
  koto: { base: 400, make: () => new Tone.PluckSynth({ attackNoise: 1.5, dampening: 4500, resonance: 0.98, volume: -11 }), fx: () => [new Tone.Vibrato(4, 0.05)] },
  sitar: { base: 250, make: () => new Tone.PluckSynth({ attackNoise: 2.5, dampening: 5000, resonance: 0.99, volume: -12 }), fx: () => [new Tone.Distortion(0.15), new Tone.Vibrato(6, 0.08)] },
  // mallets
  marimba: { base: 350, make: () => new Tone.PolySynth(Tone.FMSynth, { harmonicity: 4, modulationIndex: 2, envelope: { attack: 0.001, decay: 0.5, sustain: 0, release: 0.5 }, modulationEnvelope: { attack: 0.001, decay: 0.1, sustain: 0, release: 0.1 }, volume: -8 }) },
  // bowed / blown / squeezed
  cello: { base: 160, make: () => new Tone.PolySynth(Tone.Synth, { oscillator: { type: 'fatsawtooth', count: 2, spread: 8 }, envelope: { attack: 0.15, decay: 0.1, sustain: 0.9, release: 0.4 }, volume: -14 }), fx: () => [new Tone.Vibrato(5, 0.1), new Tone.Filter(1800, 'lowpass')] },
  trumpet: { base: 330, make: () => new Tone.MonoSynth({ oscillator: { type: 'sawtooth' }, filter: { Q: 1 }, filterEnvelope: { attack: 0.03, decay: 0.2, sustain: 0.7, baseFrequency: 500, octaves: 2.5 }, envelope: { attack: 0.02, decay: 0.1, sustain: 0.85, release: 0.15 }, volume: -13 }) },
  clarinet: { base: 250, make: () => new Tone.MonoSynth({ oscillator: { type: 'square' }, filterEnvelope: { attack: 0.05, decay: 0.2, sustain: 0.8, baseFrequency: 900, octaves: 1 }, envelope: { attack: 0.04, decay: 0.1, sustain: 0.9, release: 0.15 }, volume: -15 }) },
  accordion: { base: 280, make: () => new Tone.PolySynth(Tone.Synth, { oscillator: { type: 'fatsawtooth', count: 3, spread: 15 }, envelope: { attack: 0.05, decay: 0.1, sustain: 0.9, release: 0.2 }, volume: -17 }), fx: () => [new Tone.Tremolo(6, 0.3).start(), new Tone.Filter(2500, 'lowpass')] },
  harmonica: { base: 400, make: () => new Tone.MonoSynth({ oscillator: { type: 'square' }, filterEnvelope: { attack: 0.03, decay: 0.2, sustain: 0.8, baseFrequency: 1200, octaves: 1 }, envelope: { attack: 0.03, decay: 0.1, sustain: 0.85, release: 0.15 }, volume: -16 }), fx: () => [new Tone.Tremolo(5, 0.15).start()] },
  ocarina: { base: 600, make: () => new Tone.PolySynth(Tone.Synth, { oscillator: { type: 'triangle' }, envelope: { attack: 0.05, decay: 0.1, sustain: 0.8, release: 0.2 }, volume: -6 }), fx: () => [new Tone.Vibrato(4.5, 0.06)] },
  theremin: { base: 440, make: () => new Tone.MonoSynth({ oscillator: { type: 'sine' }, portamento: 0.12, envelope: { attack: 0.1, decay: 0.1, sustain: 1, release: 0.3 }, filterEnvelope: { baseFrequency: 4000, octaves: 0 }, volume: -6 }), fx: () => [new Tone.Vibrato(6, 0.15)] },
};

export const VOICE_GROUPS = { instruments: Object.keys(INSTRUMENTS), voices: Object.keys(ROBOTS) };

// Any voice or instrument by name. One shared object per name: each voice builds its
// sound engine (oscillators, noise, filters that run for good) the first time it plays,
// so handing out fresh objects piled up engines until the audio choked.
const voices = {};
export function robotVoice(name) {
  if (!INSTRUMENTS[name] && !ROBOTS[name]) name = 'marimba'; // a voice we no longer have (guitar and electric were retired)
  voices[name] ??= INSTRUMENTS[name]
    ? { instrument: name, basePitch: INSTRUMENTS[name].base }
    : { robot: name, basePitch: (ROBOTS[name] || ROBOTS.velvet).base };
  return voices[name];
}

let fx = null;
const timers = new Set();
let ambient = true;
let lastBump = 0;

// Run fn when the audio clock reaches `time` (keeps visuals in sync with sound).
export function at(time, fn) {
  const id = setTimeout(() => {
    timers.delete(id);
    // A busy screen can fire timers late, bunching notes up; a synth that can only play one
    // note at a time then refuses the repeat. Skip that note, never stop the music over it.
    try { fn(); } catch (err) { console.debug('skipped a late note', err.message); }
  }, Math.max(0, (time - Tone.now()) * 1000));
  timers.add(id);
}

// Set something up just before it's due, instead of all at once at the start.
const LOOKAHEAD = 0.4; // schedule notes this far ahead: room for a slow frame without bunching
function soon(time, fn) {
  at(time - LOOKAHEAD, fn);
}

export function stopAll() {
  timers.forEach(clearTimeout);
  timers.clear();
  fx?.pad.releaseAll();
  band?.dispose();
  band = null;
  currentSong = null;
  fx?.reverb.wet.rampTo(0.5, 1); // the garden's own space, until a song's style sets its own
}

export async function initAudio() {
  // Browsers only allow sound after a tap. Don't hang the game waiting on it:
  // give it a moment, then carry on — sound starts as soon as the browser allows.
  await Promise.race([Tone.start(), new Promise((resolve) => setTimeout(resolve, 1500))]);
  if (fx) return;

  const limiter = new Tone.Limiter(-2).toDestination();
  const reverb = new Tone.Reverb({ decay: 7, wet: 0.5 }).connect(limiter);
  const delay = new Tone.FeedbackDelay({ delayTime: '8n.', feedback: 0.35, wet: 0.3 }).connect(reverb);

  // Rain: a soft sine "drop" layered with a glassy FM bell.
  const drop = new Tone.PolySynth(Tone.Synth, {
    oscillator: { type: 'sine' },
    envelope: { attack: 0.001, decay: 0.3, sustain: 0, release: 0.5 },
    volume: -14,
  }).connect(delay);
  const bell = new Tone.PolySynth(Tone.FMSynth, {
    harmonicity: 3.5,
    modulationIndex: 8,
    envelope: { attack: 0.001, decay: 0.18, sustain: 0, release: 0.3 },
    modulationEnvelope: { attack: 0.001, decay: 0.08, sustain: 0, release: 0.1 },
    volume: -26,
  }).connect(delay);

  const pad = new Tone.PolySynth(Tone.Synth, {
    oscillator: { type: 'fattriangle', count: 3, spread: 20 },
    envelope: { attack: 2.5, decay: 1, sustain: 0.6, release: 4 },
    volume: -28,
  }).connect(reverb);

  // Voice chain: muffle → grit → shimmer → echo/space, plus an octave-up ghost.
  const voiceOut = new Tone.Gain(0.35).connect(delay);
  voiceOut.connect(reverb);
  const chorus = new Tone.Chorus({ frequency: 3, delayTime: 2.5, depth: 0.3, wet: 0.2 }).connect(voiceOut).start();
  const crusher = new Tone.BitCrusher(6).connect(chorus);
  crusher.wet.value = 0.2;
  const muffle = new Tone.Filter(18000, 'lowpass').connect(crusher);
  const harmony = new Tone.Gain(0.25).connect(muffle);
  const shifter = new Tone.PitchShift({ pitch: 12, windowSize: 0.05 }).connect(harmony);
  const voiceIn = new Tone.Gain(1).connect(muffle);
  voiceIn.connect(shifter);
  // Recordings are much hotter than the robot voices; this keeps them from burying the drums.
  const recordedIn = new Tone.Gain(0.4).connect(voiceIn);
  // Each person's instrument when it's their line in the song: clean, louder, a little room + echo.
  const soloBus = new Tone.Gain(1.6).connect(limiter);
  soloBus.connect(new Tone.Gain(0.3).connect(reverb));
  soloBus.connect(new Tone.Gain(0.15).connect(delay));
  // Your own spoken words in the song: no grit, chorus or octave ghost — just a little room.
  const cleanVoice = new Tone.Gain(0.55).connect(limiter);
  cleanVoice.connect(new Tone.Gain(0.25).connect(reverb));

  // Each robot voice gets its own vibrato (the little wobble that sounds sung).
  const robotIn = {};
  for (const [name, r] of Object.entries(ROBOTS)) {
    robotIn[name] = r.vibrato[1] > 0
      ? new Tone.Vibrato(r.vibrato[0], r.vibrato[1]).connect(voiceIn)
      : new Tone.Gain(1).connect(voiceIn);
  }

  // The players' featured instruments pass through featureIn, where a song's style can colour them.
  const featureIn = new Tone.Gain(1).connect(soloBus);
  fx = { limiter, reverb, drop, bell, pad, voiceIn, recordedIn, cleanVoice, soloBus, featureIn, robotIn, muffle, crusher, harmony };
  newChimes();
  setKey(DEFAULT_KEY);
  startAmbience();
}

// The space is never silent: a slow pad and the odd raindrop, forever.
function startAmbience() {
  let chord = 0;
  const tick = () => {
    if (ambient) {
      const t = Tone.now() + 0.1;
      fx.pad.triggerAttackRelease(chordFor(key, key.progression[chord++ % key.progression.length]), 7, t, 0.35);
      rain(t, 8, 0.35);
    }
  };
  tick();
  setInterval(tick, 8000);
}

// Pause the background bed while the song plays its own chords.
export function setAmbient(on) {
  ambient = on;
}

// The chime family stays the same, but each session gets its own colour:
// how metallic, how long it rings, which octave, and whether it adds a second note.
let chime = { octave: 0, interval: 0 };
export function newChimes() {
  if (!fx) return; // sound hasn't started yet: the first chimes are rolled when it does
  const pick = (list) => list[Math.floor(Math.random() * list.length)];
  fx.bell.set({
    harmonicity: pick([2, 3, 3.5, 4, 5.07, 7]),
    modulationIndex: 4 + Math.random() * 8,
    envelope: { decay: 0.1 + Math.random() * 0.3 },
  });
  fx.drop.set({ oscillator: { type: pick(['sine', 'triangle', 'sine']) }, envelope: { decay: 0.2 + Math.random() * 0.25 } });
  chime = { octave: pick([-12, 0, 0, 12]), interval: pick([0, 0, 7, 12, 4]) };
}

// Two glyphs touched. Soft, and rate-limited so a crowd doesn't get noisy.
export function bump(seed, strength = 0.5) {
  const now = Tone.now();
  if (now - lastBump < 0.15) return;
  lastBump = now;
  const note = up(keyRain[hash(String(seed)) % keyRain.length], chime.octave);
  fx.bell.triggerAttackRelease(note, 0.04, now, 0.15 + strength * 0.35);
  fx.drop.triggerAttackRelease(note, 0.05, now, 0.08 + strength * 0.2);
  if (chime.interval) fx.bell.triggerAttackRelease(up(note, chime.interval), 0.04, now + 0.03, 0.1 + strength * 0.2);
}

// 0 = garbled, 1 = clear. Interludes climb this slowly; the finale is 1.
export function setClarity(c, seconds = 1) {
  const glide = (param, value) => {
    param.cancelAndHoldAtTime(Tone.now()); // stop any fade still in progress first
    param.rampTo(value, seconds);
  };
  glide(fx.muffle.frequency, 350 + c * c * 12000);
  glide(fx.crusher.wet, 0.03 + (1 - c) * 0.35);
  glide(fx.harmony.gain, (1 - c) * 0.25); // octave-up ghost only while garbled
}

let lastPlink = 0;
export function plink(seed, time = Tone.now(), velocity = 0.8) {
  // Several messages landing at once would be hundreds of notes in a few seconds:
  // keep it to a light shower (about 25 a second) so the sound never chokes.
  if (Math.abs(time - lastPlink) < 0.04) return;
  lastPlink = time;
  const note = keyRain[hash(String(seed)) % keyRain.length];
  fx.drop.triggerAttackRelease(note, 0.1, time, velocity);
  fx.bell.triggerAttackRelease(note, 0.05, time + 0.005, velocity * 0.6);
}

// Let a player hear the clip they just recorded, already through the effects.
export function previewClip(clip) {
  playBuffer(clip.buffer, Tone.now() + 0.05, 1);
}

// Sing a few syllables so a player can hear a voice before choosing it.
const previewVoices = {};
export function previewVoice(voice, syllables) {
  const name = voice.robot || voice.instrument;
  if (name) voice = previewVoices[name] ||= voice; // reuse, don't build a new one each click
  setClarity(1, 0.1);
  const scale = scaleFor(voice.basePitch);
  let t = Tone.now() + 0.05;
  syllables.forEach((syl, i) => {
    sing(voice, syl, t, scale[[2, 3, 4, 3, 1][i % 5]], 0.26);
    t += 0.28;
  });
}

function rain(from, seconds, density = 1.2) {
  const notes = keyRain;
  let t = from;
  while (t < from + seconds) {
    t += (0.4 + Math.random() * 1.2) / density;
    fx.drop.triggerAttackRelease(notes[Math.floor(Math.random() * notes.length)], 0.1, t, 0.15 + Math.random() * 0.25);
  }
}

// Each player sings on the key's 5 safe notes, near their own pitch ("autotune").
// Only the 6 notes closest to it: big shifts sound like chipmunks.
function scaleFor(basePitch = 180, k = key) {
  const { steps, penta } = MODES[k.mode];
  const all = [];
  for (let oct = -3; oct <= 3; oct++) {
    for (const d of penta) all.push(440 * 2 ** ((60 + k.root + steps[d] + 12 * oct - 69) / 12));
  }
  const distance = (f) => Math.abs(Math.log2(f / basePitch));
  return all.sort((a, b) => distance(a) - distance(b)).slice(0, 6).sort((a, b) => a - b);
}

// A melody's shape: walk (small random steps, the original) · arp (leaps between every other
// note, like a broken chord) · wave (climbs, then falls) · pedal (keeps coming back to one home note).
function melody(count, scaleLen, seed, contour = 'walk') {
  let i = Math.floor(scaleLen / 2);
  let s = seed;
  const notes = [];
  const top = scaleLen - 1;
  for (let n = 0; n < count; n++) {
    s = hash(String(s));
    if (contour === 'arp') i = [0, 2, 4, 2][(n + (s % 2)) % 4] % scaleLen;
    else if (contour === 'wave') i = Math.round((Math.sin((n / Math.max(1, count - 1)) * Math.PI) * 0.8 + 0.1) * top + ((s % 3) - 1) * 0.5);
    else if (contour === 'pedal') i = n % 2 === 0 ? 1 : Math.min(top, 2 + (s % (scaleLen - 2)));
    else i += (s % 5) - 2;
    i = Math.min(top, Math.max(0, i));
    notes.push(i);
  }
  if (notes.length > 1) notes[notes.length - 1] = Math.min(1, scaleLen - 1); // settle low at the end
  return notes;
}

// loop = [start, end] as fractions of the clip: the part repeated to hold a note.
function playBuffer(buffer, time, rate, { duration, loop = null } = {}) {
  const src = new Tone.ToneBufferSource({ url: buffer, playbackRate: rate, fadeIn: 0.012, fadeOut: 0.06 });
  src.connect(fx.recordedIn);
  if (loop) {
    src.loop = true;
    src.loopStart = buffer.duration * loop[0];
    src.loopEnd = buffer.duration * loop[1];
  }
  src.onended = () => src.dispose();
  src.start(time);
  if (duration) src.stop(time + duration);
  return src;
}

function singFromBank(bank, syl, time, freq, dur, reverse) {
  const pick = (clip) => (reverse ? clip.reversed : clip.buffer);
  // "Autotune": speed each clip up/down just enough to land on the note.
  // Kept gentle: bigger speed changes make a voice sound less like a person.
  const rateFor = (clip) => Math.min(1.25, Math.max(0.8, freq / (clip.pitch || bank.basePitch)));
  const sounds = VOWEL_SOUND[syl.jung] || [syl.jung];
  const end = time + dur;
  const bodyEnd = syl.jong ? end - 0.05 : end;
  let t = time;

  if (syl.cho !== 'ㅇ') {
    const whole = sounds.length === 1 && findSyllable(bank, syl.cho, sounds[0]);
    if (whole) {
      // Best case: a real recorded syllable, its vowel looped to hold the note.
      const rate = rateFor(whole);
      const hold = bodyEnd - t;
      playBuffer(pick(whole), t, rate, {
        duration: hold,
        loop: hold > whole.buffer.duration / rate ? [0.55, 0.9] : null,
      });
      t = bodyEnd;
    } else {
      // Fallback: the consonant's attack, then the vowel on its own.
      const onset = findOnset(bank, syl.cho);
      if (onset) {
        playBuffer(pick(onset.clip), t, rateFor(onset.clip), { duration: onset.length });
        t += onset.length * 0.8;
      }
    }
  }

  // 중성 (vowel) still to sing: a quick glide for compound vowels, then the main one.
  if (t < bodyEnd - 0.02) {
    sounds.forEach((v, i) => {
      const clip = getClip(bank, v);
      if (!clip) return;
      const glide = sounds.length > 1 && i === 0;
      const start = glide ? t : t + (sounds.length > 1 ? 0.07 : 0);
      const length = glide ? 0.08 : Math.max(0.08, bodyEnd - start);
      const rate = rateFor(clip);
      playBuffer(pick(clip), start, rate, {
        duration: length,
        loop: !glide && length > clip.buffer.duration / rate ? [0.1, 0.9] : null,
      });
    });
  }

  // 종성 (final consonant): a short tail.
  const tail = syl.jong && findOnset(bank, syl.jong);
  if (tail) playBuffer(pick(tail.clip), end - 0.05, rateFor(tail.clip), { duration: 0.09 });
}

// Robot voice: a buzzy tone (or breath) shaped by three vowel filters.
// Each voice is ONE persistent instrument (like a mouth): every syllable just
// re-shapes it. Building fresh filters per syllable overloaded the audio engine.
function robotEngine(voice) {
  if (voice.engine) return voice.engine;
  const r = ROBOTS[voice.robot] || ROBOTS.velvet;
  const out = new Tone.Gain(0.5).connect(fx.robotIn[voice.robot] || fx.voiceIn);
  const env = new Tone.AmplitudeEnvelope({ attack: 0.025, decay: 0.08, sustain: 0.85, release: 0.12 });
  const filters = [[5, 1], [7, 0.5], [9, 0.25]].map(([Q, level]) => {
    const filter = new Tone.Filter({ frequency: 500, type: 'bandpass', Q }).connect(new Tone.Gain(level).connect(out));
    env.connect(filter);
    return filter;
  });
  let osc = null;
  if (r.osc) {
    osc = new Tone.OmniOscillator({ frequency: r.base, ...r.osc }).connect(env);
    osc.start();
  }
  if (r.breath > 0) new Tone.Noise('pink').connect(new Tone.Gain(r.breath).connect(env)).start();
  // Consonants: a short burst of hiss.
  const hiss = new Tone.AmplitudeEnvelope({ attack: 0.001, decay: 0.05, sustain: 0, release: 0.01 }).connect(out);
  new Tone.Noise('white').connect(new Tone.Filter(3000 * r.shift, 'highpass').connect(hiss)).start();
  voice.engine = { r, env, filters, osc, hiss, last: 0 };
  return voice.engine;
}

function singFromRobot(voice, syl, time, freq, dur) {
  const e = robotEngine(voice);
  // A new phrase starting before the last one finished (e.g. quick previews): cut it off.
  if (time < e.last) {
    e.env.cancel(time);
    e.hiss.cancel(time);
    e.filters.forEach((f) => f.frequency.cancelScheduledValues(time));
    e.osc?.frequency.cancelScheduledValues(time);
  }
  const sounds = VOWEL_SOUND[syl.jung] || [syl.jung];
  const from = FORMANTS[sounds[0]] || FORMANTS['ㅓ'];
  const to = FORMANTS[sounds[sounds.length - 1]] || FORMANTS['ㅓ'];
  const start = time + 0.03;

  if (syl.cho !== 'ㅇ') {
    e.hiss.decay = FRICATIVES.has(syl.cho) ? 0.1 : 0.03;
    e.hiss.triggerAttack(time, 0.25);
  }
  // Glide the vowel shape, the way a mouth moves between sounds.
  e.filters.forEach((f, i) => {
    f.frequency.setValueAtTime(from[i] * e.r.shift, start);
    f.frequency.linearRampToValueAtTime(to[i] * e.r.shift, start + 0.09);
  });
  if (e.osc) {
    // A tiny scoop up into the note, like a singer — or a hard jump, like autotune.
    e.osc.frequency.setValueAtTime(e.r.scoop ? freq * 0.97 : freq, start);
    e.osc.frequency.linearRampToValueAtTime(freq, start + 0.05);
  }
  e.env.triggerAttackRelease(dur, start);
  e.last = start + dur + 0.15;
}

// One persistent instrument per voice, like the robot "mouth".
// Each instrument has two outputs: through the scrambling voice effects (interludes),
// or clean and up front (the song, where each person's instrument is the soloist).
function instrumentEngine(voice) {
  if (voice.engine) return voice.engine;
  const spec = INSTRUMENTS[voice.instrument];
  const synth = spec.make();
  const chain = spec.fx ? spec.fx() : [];
  const out = new Tone.Gain(1);
  synth.chain(...chain, out);
  const scrambled = new Tone.Gain(1).connect(fx.voiceIn);
  const featured = new Tone.Gain(0).connect(fx.featureIn);
  out.fan(scrambled, featured);
  voice.engine = { synth, scrambled, featured, mono: !(synth instanceof Tone.PolySynth), last: 0 };
  return voice.engine;
}

function playInstrument(voice, time, freq, dur, solo = false) {
  const e = instrumentEngine(voice);
  // One-note instruments can't go back in time (e.g. quick previews overlapping).
  const t = e.mono ? Math.max(time, e.last + 0.01) : time;
  e.featured.gain.setValueAtTime(solo ? 1 : 0, t);
  e.scrambled.gain.setValueAtTime(solo ? 0 : 1, t);
  e.synth.triggerAttackRelease(freq, dur, t, 0.9);
  e.last = t; // a new note may start while this one still rings
}

// The nearest note of the key's pentatonic scale: the 5 notes that always sound
// good over the chords, so a sung syllable can never land on a clashing note.
function nearestInKey(freq, k) {
  const midi = 69 + 12 * Math.log2(freq / 440);
  const { steps, penta } = MODES[k.mode];
  let best = midi;
  let bestDistance = Infinity;
  for (let oct = -1; oct <= 9; oct++) {
    for (const degree of penta) {
      const note = 12 * oct + k.root + steps[degree];
      if (Math.abs(note - midi) < bestDistance) { bestDistance = Math.abs(note - midi); best = note; }
    }
  }
  return 440 * 2 ** ((best - 69) / 12);
}

// A spoken message in the song: syllable n played as you said it, just tuned to the
// nearest pentatonic note (at most ~2 semitones) and sent down a clean path — so it's your voice.
function singNatural(sung, n, time, k) {
  const seg = sung.segments[n];
  const rate = seg.pitch ? Math.min(1.12, Math.max(0.89, nearestInKey(seg.pitch, k) / seg.pitch)) : 1;
  const src = new Tone.ToneBufferSource({ url: sung.buffer, playbackRate: rate, fadeIn: 0.01, fadeOut: 0.03 }).connect(fx.cleanVoice);
  src.onended = () => src.dispose();
  src.start(time, seg.start, (seg.end - seg.start) + 0.04);
}

// A spoken message, sung: syllable n of the recording, stretched to fit the note's
// length and tuned to the melody note — your real words, in your own (autotuned) voice.
// sung = { buffer, segments: [{ start, end, pitch }] } from voicebank.prepareSung.
function singRecorded(sung, n, time, freq, dur, reverse = false) {
  const seg = sung.segments[Math.min(n, sung.segments.length - 1)];
  const len = Math.max(0.05, seg.end - seg.start);
  const cents = seg.pitch ? Math.max(-1200, Math.min(1200, 1200 * Math.log2(freq / seg.pitch))) : 0;
  const total = sung.buffer.duration;
  const player = new Tone.GrainPlayer({
    url: sung.buffer,
    grainSize: 0.06,
    overlap: 0.03,
    detune: cents,
    playbackRate: Math.min(2, Math.max(0.5, len / dur)), // speed changes length, not pitch
    reverse,
    loop: true,
    loopStart: reverse ? total - seg.end : seg.start,
    loopEnd: reverse ? total - seg.start : seg.end,
  }).connect(fx.recordedIn);
  player.start(time, reverse ? total - seg.end : seg.start);
  player.stop(time + dur);
  at(time + dur + 1, () => player.dispose());
}

// voice = a recorded bank ({ clips }), a robot ({ robot: 'silk' }) or an instrument ({ instrument: 'marimba' }).
// solo = the song's featured line: an instrument plays clean and up front, ringing on.
function sing(voice, syl, time, freq, dur, reverse = false, solo = false) {
  if (voice?.clips) singFromBank(voice, syl, time, freq, dur, reverse);
  else if (voice?.instrument) playInstrument(voice, time, freq, solo ? dur * 1.8 : dur, solo);
  else singFromRobot(voice || robotVoice('velvet'), syl, time, freq, dur);
}

// Between rounds: the round's syllables, shuffled, reversed, muffled.
// items = [{ syl, player }]; voices = [p1, p2]. Returns length in seconds.
export function playInterlude(items, voices, clarity, onSyllable) {
  setClarity(clarity, 0.5);
  const t0 = Tone.now() + 0.3;
  // Every syllable of both messages, in turn. Nearby syllables swap places
  // (more when it's garbled), but nothing gets cut.
  const picked = [...items];
  for (let i = 1; i < picked.length; i++) {
    if (picked[i].player === picked[i - 1].player && Math.random() > clarity + 0.3) {
      [picked[i], picked[i - 1]] = [picked[i - 1], picked[i]];
    }
  }
  fx.pad.triggerAttackRelease(chordFor(key, key.progression[Math.floor(Math.random() * 4)]), 5, t0, 0.5);

  let t = t0 + 0.4;
  picked.forEach((item, n) => {
    const scale = scaleFor(item.message?.sung?.basePitch || voices[item.player]?.basePitch);
    const freq = scale[hash(item.syl.char + n) % scale.length];
    const dur = 0.17 + Math.random() * 0.12;
    const when = t;
    const reverse = Math.random() < (1 - clarity) * 0.6;
    soon(when, () => {
      if (item.message?.sung) singRecorded(item.message.sung, item.n, when, freq, dur, reverse);
      else sing(voices[item.player], item.syl, when, freq, dur, reverse);
    });
    at(t, () => onSyllable(item));
    t += dur + (Math.random() - 0.3) * 0.15 * (1 - clarity);
  });
  rain(t0, t - t0 + 1, 1.5);
  return t - Tone.now() + 0.9;
}

// ── the finale: a band built from the song DNA ──

const LEADS = {
  mallet: [Tone.Synth, { oscillator: { type: 'triangle' }, envelope: { attack: 0.001, decay: 0.25, sustain: 0, release: 0.3 }, volume: -20 }],
  bells: [Tone.FMSynth, { harmonicity: 3.5, modulationIndex: 6, envelope: { attack: 0.001, decay: 0.4, sustain: 0, release: 0.5 }, modulationEnvelope: { attack: 0.001, decay: 0.2, sustain: 0, release: 0.2 }, volume: -24 }],
  kalimba: [Tone.FMSynth, { harmonicity: 8, modulationIndex: 2, envelope: { attack: 0.001, decay: 0.3, sustain: 0, release: 0.2 }, modulationEnvelope: { attack: 0.001, decay: 0.05, sustain: 0, release: 0.05 }, volume: -20 }],
  glass: [Tone.Synth, { oscillator: { type: 'sine' }, envelope: { attack: 0.002, decay: 0.6, sustain: 0, release: 0.8 }, volume: -18 }],
  chip: [Tone.Synth, { oscillator: { type: 'square' }, envelope: { attack: 0.001, decay: 0.12, sustain: 0, release: 0.05 }, volume: -30 }],
  harp: [Tone.Synth, { oscillator: { type: 'fattriangle', count: 2, spread: 10 }, envelope: { attack: 0.002, decay: 0.8, sustain: 0, release: 0.6 }, volume: -22 }],
};
const PADS = {
  warm: { oscillator: { type: 'fattriangle', count: 3, spread: 20 }, envelope: { attack: 0.8, decay: 0.5, sustain: 0.7, release: 2 }, volume: -29 },
  strings: { oscillator: { type: 'fatsawtooth', count: 3, spread: 25 }, envelope: { attack: 0.6, decay: 0.5, sustain: 0.8, release: 2 }, volume: -33 },
  choir: { oscillator: { type: 'fatsine', count: 4, spread: 30 }, envelope: { attack: 1, decay: 0.5, sustain: 0.8, release: 2.5 }, volume: -25 },
  organ: { oscillator: { type: 'amsine', harmonicity: 2 }, envelope: { attack: 0.3, decay: 0.2, sustain: 0.9, release: 1.5 }, volume: -31 },
};
const BASSES = {
  round: { oscillator: { type: 'triangle' }, filterEnvelope: { attack: 0.01, decay: 0.2, sustain: 0.4, baseFrequency: 200, octaves: 2 }, envelope: { attack: 0.01, decay: 0.3, sustain: 0.5, release: 0.4 }, volume: -14 },
  sub: { oscillator: { type: 'sine' }, filterEnvelope: { attack: 0.01, decay: 0.2, sustain: 1, baseFrequency: 300, octaves: 1 }, envelope: { attack: 0.01, decay: 0.4, sustain: 0.7, release: 0.5 }, volume: -11 },
  buzz: { oscillator: { type: 'sawtooth' }, filterEnvelope: { attack: 0.01, decay: 0.25, sustain: 0.2, baseFrequency: 120, octaves: 3 }, envelope: { attack: 0.01, decay: 0.3, sustain: 0.4, release: 0.3 }, volume: -19 },
  pluck: { oscillator: { type: 'square' }, filterEnvelope: { attack: 0.005, decay: 0.12, sustain: 0, baseFrequency: 150, octaves: 3 }, envelope: { attack: 0.005, decay: 0.15, sustain: 0, release: 0.1 }, volume: -20 },
};
// Drum kits: kick shape, snare type (noise or metallic click), hat length.
const KITS = {
  soft: { kick: [0.03, 5, 0.4, -4], snare: ['pink', 0.2, 1200, -14], hat: [0.03, 8000, -20] },
  glitch: { kick: [0.01, 4, 0.2, -3], snare: ['metal'], hat: [0.012, 9000, -18] },
  deep: { kick: [0.12, 8, 1.1, -2], snare: ['white', 0.14, 2400, -13], hat: [0.02, 9000, -20] },
  tick: { kick: [0.02, 3, 0.18, -5], snare: ['metal'], hat: [0.04, 6000, -21] },
  pulse: { kick: [0.05, 6, 0.45, -2], snare: ['white', 0.15, 1800, -13], hat: [0.09, 7000, -20] },
};
// Beats: which of the 16 steps in a bar each drum plays on.
const BEATS = {
  broken: { kick: [0, 6, 8], snare: [4, 12], hat: [2, 6, 10, 14] },
  four: { kick: [0, 4, 8, 12], snare: [4, 12], hat: [2, 6, 10, 14] },
  half: { kick: [0, 10], snare: [8], hat: [0, 2, 4, 6, 8, 10, 12, 14] },
  trap: { kick: [0, 7, 10], snare: [8], hat: [...Array(16).keys()] },
  shuffle: { kick: [0, 9], snare: [4, 12], hat: [0, 3, 6, 8, 11, 14] },
  sparse: { kick: [0, 8], snare: [12], hat: [4, 10, 14] },
  bossa: { kick: [0, 6, 8, 14], snare: [3, 10], hat: [0, 2, 4, 6, 8, 10, 12, 14] },
  waltz: { kick: [0], snare: [4, 8], hat: [2, 6, 10] }, // 12 steps: a bar of 3
  sixeight: { kick: [0, 10], snare: [6], hat: [0, 2, 4, 6, 8, 10] }, // 12 steps felt in 2: ONE-two-three FOUR-five-six
  five: { kick: [0, 12], snare: [8, 16], hat: [0, 2, 4, 6, 8, 10, 12, 14, 16, 18] }, // 20 steps: 3 + 2
  seven: { kick: [0, 8], snare: [4, 11], hat: [0, 2, 4, 6, 8, 10, 12] }, // 14 steps: 2 + 2 + 3
};
// Steps (16th notes) in one bar of each time signature.
const BAR_STEPS = { 3: 12, 4: 16, 5: 20, 6: 12, 7: 14 };
const barSteps = (dna) => BAR_STEPS[dna.meter] || 16;
// Arpeggio shapes over the 4 chord notes (4 = the root an octave up).
const ARPS = {
  up: [0, 1, 2, 3], down: [3, 2, 1, 0], updown: [0, 1, 2, 3, 2, 1],
  alberti: [0, 2, 1, 2], broken: [0, 2, 1, 3], wide: [0, 4, 1, 3],
};

const up = (note, semis) => Tone.Frequency(note).transpose(semis).toNote();
let band = null;

function buildBand(dna) {
  const nodes = [];
  const keep = (n) => { nodes.push(n); return n; };
  // The style's space (how much reverb) and texture (lo-fi muffle, chiptune crunch).
  fx.reverb.wet.cancelScheduledValues(Tone.now()); // (stopAll's ramp back to normal would win otherwise)
  fx.reverb.wet.rampTo(dna.space ?? 0.5, 0.3);
  const muffle = dna.tone === 'muffle';
  const crunch = dna.tone === 'crunch';
  const out = keep(new Tone.Gain(1).connect(fx.limiter));
  // Drums get their own, louder bus so they cut through everything else.
  const drumsOut = muffle ? keep(new Tone.Filter(2800, 'lowpass').connect(fx.limiter))
    : crunch ? keep(new Tone.BitCrusher(6).connect(fx.limiter)) : fx.limiter;
  const drums = keep(new Tone.Gain(dna.quietDrums ? 0.8 : 1.6).connect(drumsOut));
  const echo = keep(new Tone.FeedbackDelay({ delayTime: dna.delayTime, feedback: Math.min(0.7, dna.delayFeedback), wet: 0.3 }).connect(fx.reverb));
  const leadIn = muffle ? keep(new Tone.Filter(1600, 'lowpass').connect(echo)) : crunch ? keep(new Tone.BitCrusher(5).connect(echo)) : echo;
  const [LeadVoice, leadOptions] = LEADS[dna.lead];
  const lead = keep(new Tone.PolySynth(LeadVoice, { ...leadOptions, volume: leadOptions.volume - 2 }).connect(leadIn));
  // The pad ducks on every kick ("pumping"), which makes the drums feel bigger.
  const padTop = muffle ? 1200 : dna.pad === 'strings' ? 1600 : 4000;
  const duck = keep(new Tone.Gain(1).connect(keep(new Tone.Filter(padTop, 'lowpass').connect(fx.reverb))));
  const pad = keep(new Tone.PolySynth(Tone.Synth, PADS[dna.pad]).connect(duck));
  const bass = keep(new Tone.MonoSynth(BASSES[dna.bass]).connect(out));
  // Short chord stabs for the styles that comp instead of holding a pad (bossa, waltz).
  let comp = null;
  if (dna.padMode && dna.padMode !== 'hold') {
    comp = keep(new Tone.PolySynth(Tone.Synth, {
      oscillator: { type: dna.padMode === 'stab' ? 'triangle' : 'fattriangle', count: 2, spread: 12 },
      envelope: { attack: 0.004, decay: 0.22, sustain: 0.05, release: 0.25 }, volume: -19,
    }).connect(muffle ? keep(new Tone.Filter(1800, 'lowpass').connect(out)) : out));
    comp.connect(keep(new Tone.Gain(0.35).connect(fx.reverb)));
  }
  // A soft second voice under the players' melody (some styles).
  const harmony = dna.harmony ? keep(new Tone.PolySynth(Tone.Synth, {
    oscillator: { type: 'sine' }, envelope: { attack: 0.03, decay: 0.3, sustain: 0.4, release: 0.4 }, volume: -20,
  }).connect(fx.featureIn)) : null;
  // The style's colour on the players' own instruments, between featureIn and the solo bus.
  fx.featureIn.disconnect();
  const colour = {
    shimmer: () => [new Tone.Chorus(1.5, 4, 0.6).start(), new Tone.FeedbackDelay('4n', 0.35)], // drift: wide and floaty
    tape: () => [new Tone.Vibrato(4.5, 0.12), new Tone.Filter(1700, 'lowpass')], // lofi: wobbly old tape
    echo: () => [new Tone.PingPongDelay('8n', 0.3)], // pulse: bouncing echoes
    warm: () => [new Tone.Filter(2600, 'lowpass')], // bossa: soft and close
    crunch: () => [new Tone.BitCrusher(4), new Tone.Filter(5000, 'lowpass')], // chip: 8-bit
    tremolo: () => [new Tone.Tremolo(7, 0.45).start()], // waltz: a music-box shiver
  }[dna.voiceColour]?.().map(keep) || [];
  if (colour.length) fx.featureIn.chain(...colour, fx.soloBus);
  else fx.featureIn.connect(fx.soloBus);

  // Lo-fi: the little clicks and pops of an old record.
  const crackle = muffle ? keep(new Tone.NoiseSynth({
    noise: { type: 'white' }, envelope: { attack: 0.0005, decay: 0.004, sustain: 0, release: 0.002 }, volume: -30,
  }).connect(keep(new Tone.Filter(2500, 'highpass').connect(fx.limiter)))) : null;

  const kit = KITS[dna.kit];
  const [pitchDecay, octaves, decay, kickVol] = kit.kick;
  const kick = keep(new Tone.MembraneSynth({
    pitchDecay, octaves, envelope: { attack: 0.001, decay, sustain: 0, release: 0.01 }, volume: kickVol,
  }).connect(drums));
  const main = makeSnareAndHat(kit, drums, keep);
  // A second kit from a stacked secret word adds its own snare + hats on top.
  const extra = dna.layers?.kit ? makeSnareAndHat(KITS[dna.layers.kit], drums, keep, -4) : null;
  // A second lead from a stacked secret word plays a counter-arpeggio, an octave up.
  let lead2 = null;
  if (dna.layers?.lead) {
    const [Voice2, options2] = LEADS[dna.layers.lead];
    lead2 = keep(new Tone.PolySynth(Voice2, { ...options2, volume: options2.volume - 5 }).connect(echo));
  }
  const pad2 = dna.layers?.pad ? keep(new Tone.PolySynth(Tone.Synth, { ...PADS[dna.layers.pad], volume: PADS[dna.layers.pad].volume - 4 }).connect(duck)) : null;
  const crashFilter = keep(new Tone.Filter(5000, 'highpass').connect(drums));
  crashFilter.connect(fx.reverb);
  const crash = keep(new Tone.NoiseSynth({
    noise: { type: 'white' }, envelope: { attack: 0.001, decay: 1.4, sustain: 0, release: 0.01 }, volume: -22,
  }).connect(crashFilter));

  return {
    lead, lead2, pad, pad2, bass, comp, crackle, harmony, hat: main.hat, extra, crash,
    kick: (t, beatLen) => {
      kick.triggerAttackRelease('C1', beatLen / 2, t);
      duck.gain.setValueAtTime(0.35, t);
      duck.gain.linearRampToValueAtTime(1, t + beatLen * 0.45);
    },
    hitSnare: main.hitSnare,
    dispose: () => {
      nodes.forEach((n) => n.dispose());
      fx.featureIn.disconnect(); // the players' instruments go back to their plain sound
      fx.featureIn.connect(fx.soloBus);
    },
  };
}

// A kit's snare (noise or a metallic click) and hi-hat. quieter = dB to drop it by.
function makeSnareAndHat(kit, drums, keep, quieter = 0) {
  let snare;
  if (kit.snare[0] === 'metal') {
    snare = keep(new Tone.MetalSynth({
      envelope: { attack: 0.001, decay: 0.1, release: 0.01 },
      harmonicity: 5.1, modulationIndex: 16, resonance: 3000, octaves: 1.5, volume: -14 + quieter,
    }).connect(drums));
  } else {
    const [type, snareDecay, freq, vol] = kit.snare;
    const body = keep(new Tone.Filter(freq, 'bandpass').connect(drums));
    body.connect(fx.reverb);
    snare = keep(new Tone.NoiseSynth({
      noise: { type }, envelope: { attack: 0.001, decay: snareDecay, sustain: 0, release: 0.01 }, volume: vol + quieter,
    }).connect(body));
  }
  const [hatDecay, hatFreq, hatVol] = kit.hat;
  const hat = keep(new Tone.NoiseSynth({
    noise: { type: 'white' }, envelope: { attack: 0.001, decay: hatDecay, sustain: 0, release: 0.01 }, volume: hatVol + quieter,
  }).connect(keep(new Tone.Filter(hatFreq, 'highpass').connect(drums))));
  return {
    hat,
    hitSnare: (t, velocity = 1) => (kit.snare[0] === 'metal'
      ? snare.triggerAttackRelease(250, 0.05, t, 0.8 * velocity)
      : snare.triggerAttackRelease(0.1, t, velocity)),
  };
}

// The band builds: 0 pad + arpeggio · 1 + bass · 2 + kick & hats · 3 + snare & high pad · 4 everything, busier.
// feature = someone's line is playing: the band's lead steps back to leave them room.
// Jam basslines, one per song. Letters are chord tones: R root, T third, F fifth,
// S seventh, O the root an octave up. Each always comes home to the root on beat 1.
const BASSLINES = {
  walk: { 0: 'R', 3: 'R', 6: 'F', 8: 'R', 10: 'O', 11: 'F', 14: 'F' },
  pulse: { 0: 'R', 2: 'R', 4: 'R', 6: 'R', 8: 'R', 10: 'R', 12: 'F', 14: 'F' },
  disco: { 0: 'R', 2: 'O', 4: 'R', 6: 'O', 8: 'R', 10: 'O', 12: 'R', 14: 'O' },
  offbeat: { 2: 'R', 6: 'R', 10: 'R', 14: 'F' },
  dub: { 0: 'R', 7: 'F', 10: 'R' },
  funk: { 0: 'R', 3: 'O', 6: 'R', 7: 'S', 10: 'R', 13: 'T', 14: 'F' },
  // style-only rhythms (the finale's styles use these too)
  bossa: { 0: 'R', 6: 'F', 8: 'F', 14: 'R' },
  waltz: { 0: 'R' }, // oom (the chords play the pah-pah)
};
const JAM_BASSLINES = ['walk', 'pulse', 'disco', 'offbeat', 'dub', 'funk'];
export const BASSLINE_NAMES = JAM_BASSLINES;

function bassline(dna, chord, name = dna.bassline, bar = 16) {
  const shape = BASSLINES[name] || BASSLINES[JAM_BASSLINES[dna.seed % JAM_BASSLINES.length]];
  const longest = 4;
  const tone = { R: up(chord[0], -12), T: up(chord[1], -12), F: up(chord[2], -12), S: up(chord[3], -12), O: chord[0] };
  const steps = Object.keys(shape).map(Number);
  const line = {};
  steps.forEach((step, i) => {
    const next = steps[i + 1] ?? bar;
    line[step] = { note: tone[shape[step]], len: Math.min(next - step, longest) }; // ring until the next note
  });
  return line;
}

// When a style plays chords as short stabs instead of one long held pad: which steps.
const COMPING = {
  stab: [0, 3, 6, 10, 12], // bossa guitar
  waltz: [4, 8], // the pah-pah
};

// groove (jam): a steady full kit and a walking bassline under everything, no snare rolls.
function playSection(dna, { start, end, chord, level, crash, feature = false, groove = false }) {
  const beatLen = 60 / dna.bpm;
  const six = beatLen / 4;
  const length = end - start;
  const totalSteps = Math.round(length / six);
  const bar = barSteps(dna); // steps in a bar: 16 in 4/4, 12 in 3/4 and 6/8, 20 in 5/4, 14 in 7/8
  const comping = dna.padMode === 'waltz' && dna.meter === 6 ? [6] : COMPING[dna.padMode];
  // held chords: always in the original; quietly under the stabs in a waltz; not at all under bossa stabs
  if (!comping || dna.padMode === 'waltz') band.pad.triggerAttackRelease(chord, length + 0.3, start, comping ? 0.25 : 0.5);
  if (level >= 3 && !comping) band.pad.triggerAttackRelease(chord.map((n) => up(n, 12)), length, start, 0.3);
  band.pad2?.triggerAttackRelease(chord.map((n) => up(n, 12)), length + 0.3, start, 0.4);
  if (crash && level >= 3) band.crash.triggerAttackRelease(0.05, start, 0.8);
  const tones = [...chord.map((n) => up(n, 12)), up(chord[0], 24)];
  const shape = ARPS[dna.arp];
  const rate = level >= 4 ? 1 : dna.arpRate;
  const beat = BEATS[dna.pattern];
  const root = up(chord[0], -12);
  // the bass rhythm: the jam's groove, the style's, or (the original) long roots
  const line = groove ? bassline(dna, chord, undefined, bar)
    : dna.bassStyle && dna.bassStyle !== 'roots' ? bassline(dna, chord, dna.bassStyle, bar) : null;
  const stabChord = chord.map((n) => up(n, 12));

  for (let k = 0; k < totalSteps; k++) {
    const step = k % bar;
    const t = start + k * six + (k % 2 ? dna.swing * six : 0); // swing pushes the off-steps late
    const fill = !groove && level >= 3 && totalSteps >= 8 && k >= totalSteps - 4; // snare roll into the next part
    if (feature) {
      if (step % 4 === 0) band.lead.triggerAttackRelease(tones[shape[(k >> 2) % shape.length]], '16n', t, 0.12); // just a soft pulse
    } else if (k % rate === 0) {
      band.lead.triggerAttackRelease(tones[shape[(k / rate) % shape.length]], '16n', t, step % 4 === 0 ? 0.45 : 0.25);
    }
    // the stacked second lead answers on the in-between steps, an octave up, going the other way
    if (band.lead2 && !feature && k % 2 === 1 && level >= 1) band.lead2.triggerAttackRelease(up(tones[shape[shape.length - 1 - ((k >> 1) % shape.length)]], 12), '16n', t, 0.3);
    if (comping?.includes(step) && level >= 1) band.comp.triggerAttackRelease(stabChord, six * 1.4, t, step === 0 ? 0.8 : 0.6);
    if (band.crackle && Math.random() < 0.3) band.crackle.triggerAttackRelease(0.004, t + Math.random() * six, 0.2 + Math.random() * 0.5); // vinyl dust
    if (line) { if (line[step]) band.bass.triggerAttackRelease(line[step].note, line[step].len * six * 0.9, t, 0.9); }
    else if (level >= 1 && (step % 8 === 0 || step % 8 === 6)) band.bass.triggerAttackRelease(root, step % 8 === 0 ? six * 5.6 : six, t);
    if (level >= 2 && beat.kick.includes(step) && !fill) band.kick(t, beatLen);
    if (level >= 2 && beat.hat.includes(step)) band.hat.triggerAttackRelease(0.02, t, 0.7);
    else if (level >= 4 && step % 2 === 1) band.hat.triggerAttackRelease(0.02, t, 0.3);
    if (dna.kit === 'glitch' && level >= 2 && step === 15 && (dna.seed + k) % 3 === 0) {
      band.hat.triggerAttackRelease(0.01, t + six / 2, 0.5); // a little stutter
    }
    if (fill) band.hitSnare(t, 0.5 + (k - (totalSteps - 4)) * 0.17);
    else if (level >= 3 && beat.snare.includes(step)) band.hitSnare(t);
    // the stacked second kit: its hats on the off-steps, its snare doubling the backbeat
    if (band.extra && level >= 2 && step % 4 === 3) band.extra.hat.triggerAttackRelease(0.02, t, 0.5);
    if (band.extra && level >= 3 && beat.snare.includes(step) && !fill) band.extra.hitSnare(t + 0.005, 0.7);
  }
}

// ── the looping song ──
// The finale plays every message in order, then loops forever with the full band
// (until stopAll). Pass 0 builds up; later passes go big, with a breakdown on odd loops.
let currentSong = null;

function schedulePass(song, passStart, pass) {
  const { messages, voices, dna, beatLen, callbacks } = song;
  const six = beatLen / 4;
  const onBeat = (t) => passStart + Math.ceil((t - passStart) / beatLen - 1e-6) * beatLen;
  const last = messages.length - 1;
  const levelFor = (m) => {
    if (pass === 0) return m >= last ? 4 : m < 2 ? 2 : 3; // drums from the very first message
    if (m === 0 && pass % 2 === 1) return 1; // breakdown: drums drop out for a moment…
    return m >= last - 1 ? 4 : 3; // …then slam back in
  };
  let t = passStart;

  messages.forEach((msg, m) => {
    t = onBeat(t);
    const voice = voices[msg.player];
    const scale = scaleFor(msg.sung?.basePitch || voice?.basePitch, dna); // a spoken message sings near its speaker's pitch
    const syls = msg.words.flatMap((w, wi) => w.syllables.map((s, si) => ({ s, wi, si })));
    const notes = melody(syls.length, scale.length, hash(msg.words.map((w) => w.word).join(' ')) ^ dna.seed, dna.contour);
    // note lengths: the style's rhythm (long messages sing in quick 16ths so they don't drag)
    const rhythm = syls.length > 14 ? [1] : RHYTHMS[dna.rhythm] || [2];
    const msgStart = t;
    at(t, () => song === currentSong && callbacks.onMessage(m, pass));

    if (msg.sung) {
      // A spoken message keeps the speaker's own timing (a long "heyyyy" stays long);
      // each syllable is just nudged onto the nearest note of the key.
      const { segments } = msg.sung;
      const zero = segments[0].start;
      syls.forEach(({ wi, si }, n) => {
        const seg = segments[Math.min(n, segments.length - 1)];
        const when = msgStart + (seg.start - zero);
        if (n < segments.length) soon(when, () => singNatural(msg.sung, n, when, dna));
        at(when, () => song === currentSong && callbacks.onSyllable(m, wi, si));
      });
      t = msgStart + (segments[segments.length - 1].end - zero) + six;
    } else {
      syls.forEach(({ s, wi, si }, n) => {
        const len = (n === syls.length - 1 ? 4 : rhythm[n % rhythm.length]) * six;
        const when = t;
        const freq = scale[notes[n]];
        soon(when, () => sing(voice, s, when, freq, len * 0.95, false, true));
        // the style's harmony: a soft second voice an octave or a third (two notes up the scale) above
        if (band?.harmony && voice?.instrument) {
          const over = dna.harmony === 'octave' ? freq * 2 : scale[Math.min(scale.length - 1, notes[n] + 2)] * (notes[n] + 2 >= scale.length ? 2 : 1);
          soon(when, () => band?.harmony.triggerAttackRelease(over, len * 0.9, when, 0.5));
        }
        at(t, () => song === currentSong && callbacks.onSyllable(m, wi, si));
        t += len;
      });
    }
    const chord = chordFor(dna, dna.progression[m % dna.progression.length]);
    const lineEnd = onBeat(t);
    soon(msgStart, () => playSection(dna, { start: msgStart, end: lineEnd, chord, level: levelFor(m), crash: m === 0 || m === last - 1, feature: true }));
    // The answer: one beat where the band fills back in and the line's instrument
    // echoes its last two notes an octave up — then it's the next person's turn.
    const answerEnd = lineEnd + beatLen;
    soon(lineEnd, () => playSection(dna, { start: lineEnd, end: answerEnd, chord, level: levelFor(m) }));
    if (voice?.instrument && !msg.sung && syls.length) {
      const echo = notes.slice(-2).map((i) => scale[i] * 2);
      echo.forEach((freq, i) => {
        const when = lineEnd + i * (beatLen / 2);
        soon(when, () => playInstrument(voice, when, freq, beatLen * 0.7, true));
      });
    }
    t = answerEnd;
  });

  // One bar back home on the first chord, then go round again.
  const turnaround = onBeat(t);
  const passEnd = turnaround + (beatLen / 4) * barSteps(dna);
  soon(turnaround, () => playSection(dna, { start: turnaround, end: passEnd, chord: chordFor(dna, 0), level: 4 }));
  soon(passEnd, () => { if (song === currentSong) schedulePass(song, passEnd, pass + 1); });
  rain(passStart, passEnd - passStart, dna.rain);
  return passEnd;
}

// Start the song. Returns timing so the visuals can dance on the beat.
export function playFinale(messages, voices, dna, callbacks) {
  stopAll();
  setKey(dna);
  setClarity(1, 1);
  band = buildBand(dna);
  const beatLen = 60 / dna.bpm;
  const songStart = Tone.now() + 0.3;
  const song = { messages, voices, dna, beatLen, callbacks };
  currentSong = song;
  // A two-beat count-in with the drums already going.
  const intro = { start: songStart, end: songStart + beatLen * 2, chord: chordFor(dna, 0), level: 2 };
  soon(intro.start, () => playSection(dna, intro));
  const firstPassEnd = schedulePass(song, intro.end, 0);
  return { songStart, beat: beatLen, firstPass: firstPassEnd - Tone.now() };
}

// ── jam: every symbol is its own sound; a backing beat; a song made of everyone's taps ──
const JAM_DRUMS = [
  () => [new Tone.MembraneSynth({ pitchDecay: 0.05, octaves: 6, envelope: { attack: 0.001, decay: 0.4, sustain: 0, release: 0.01 }, volume: -4 }), 'C1'], // kick
  () => [new Tone.NoiseSynth({ noise: { type: 'white' }, envelope: { attack: 0.001, decay: 0.08, sustain: 0, release: 0.01 }, volume: -14 }), null, 2200], // snap
  () => [new Tone.MembraneSynth({ pitchDecay: 0.02, octaves: 2, envelope: { attack: 0.001, decay: 0.3, sustain: 0, release: 0.01 }, volume: -8 }), 'G2'], // tom
  () => [new Tone.MetalSynth({ envelope: { attack: 0.001, decay: 0.05, release: 0.01 }, harmonicity: 3, resonance: 2000, volume: -20 }), 400], // rim
  () => [new Tone.NoiseSynth({ noise: { type: 'pink' }, envelope: { attack: 0.001, decay: 0.14, sustain: 0, release: 0.01 }, volume: -12 }), null, 1200], // clap
  () => [new Tone.NoiseSynth({ noise: { type: 'white' }, envelope: { attack: 0.001, decay: 0.05, sustain: 0, release: 0.01 }, volume: -18 }), null, 6500], // shaker
  () => [new Tone.MetalSynth({ envelope: { attack: 0.001, decay: 0.15, release: 0.01 }, harmonicity: 1.5, resonance: 1500, volume: -22 }), 560], // cowbell
  () => [new Tone.MembraneSynth({ pitchDecay: 0.04, octaves: 3, envelope: { attack: 0.001, decay: 0.35, sustain: 0, release: 0.01 }, volume: -7 }), 'D2'], // low tom
];
const JAM_CHORDS = ['fattriangle', 'amsine', 'fatsawtooth', 'fmsine'];
// Every sound a symbol can be: 8 drums, 4 basses, 4 chord stabs, 6 leads, 21 instruments.
const JAM_SOUNDS = [
  ...JAM_DRUMS.map((make) => ({ kind: 'drum', make })),
  ...Object.keys(BASSES).map((name) => ({ kind: 'bass', name })),
  ...JAM_CHORDS.map((type) => ({ kind: 'chord', type })),
  ...Object.keys(LEADS).map((name) => ({ kind: 'lead', name })),
  ...Object.keys(INSTRUMENTS).map((name) => ({ kind: 'instrument', name })),
];

// Which sound a symbol (or letter) makes. Always the same for the same symbol, on every device.
export const jamSoundIndex = (symbol) => hash(`jam:${symbol}`) % JAM_SOUNDS.length;

let jam = null; // { dna, start, beat, six, sounds }

// Build (once) the sound for a symbol. Its "register" (how high/low, which drum
// pitch) comes from the symbol too, so two symbols sharing an instrument still differ.
function jamSound(symbol) {
  jam.sounds[symbol] ??= (() => {
    const h = hash(`reg:${symbol}`);
    const spec = JAM_SOUNDS[jamSoundIndex(symbol)];
    const out = new Tone.Gain(1).connect(fx.soloBus);
    const sound = { kind: spec.kind, last: 0, step: 0, index: h % 6, shift: [0, 2, -2, 5, -5, 7][h % 6] };
    if (spec.kind === 'drum') {
      const [synth, note, filter] = spec.make();
      if (filter) synth.chain(new Tone.Filter(filter * 2 ** (sound.shift / 12), filter > 3000 ? 'highpass' : 'bandpass'), out);
      else synth.connect(out);
      Object.assign(sound, { synth, note: note && typeof note === 'string' ? up(note, sound.shift) : note });
    } else if (spec.kind === 'bass') {
      sound.synth = new Tone.MonoSynth({ ...BASSES[spec.name], volume: BASSES[spec.name].volume + 6 }).connect(out);
    } else if (spec.kind === 'chord') {
      sound.synth = new Tone.PolySynth(Tone.Synth, {
        oscillator: { type: spec.type, count: 3, spread: 20 },
        envelope: { attack: 0.005, decay: 0.25, sustain: 0.1, release: 0.3 }, volume: -16,
      }).connect(new Tone.Filter(2500, 'lowpass').connect(out));
    } else if (spec.kind === 'lead') {
      const [Voice, options] = LEADS[spec.name];
      sound.synth = new Tone.PolySynth(Voice, { ...options, volume: options.volume + 8 }).connect(out);
      sound.base = [520, 700, 900][h % 3];
    } else {
      const inst = INSTRUMENTS[spec.name];
      sound.synth = inst.make();
      const chain = inst.fx ? inst.fx() : [];
      sound.synth.chain(...chain, out);
      sound.nodes = chain;
      sound.base = inst.base * [1, 1, 2, 0.5][h % 4];
    }
    return sound;
  })();
  return jam.sounds[symbol];
}

// The chord playing at time t (the backing beat walks the key's progression, a bar each).
function jamChordAt(t) {
  const bar = Math.max(0, Math.floor((t - jam.start) / (jam.beat * 4)));
  return chordFor(jam.dna, jam.dna.progression[bar % jam.dna.progression.length]);
}

const jamIsDrum = (symbol) => JAM_SOUNDS[jamSoundIndex(symbol)].kind === 'drum';

// Play a symbol's sound at time t.
function jamHit(symbol, t, velocity = 0.9) {
  const sound = jamSound(symbol);
  // Same symbol, same 16th (fast tapping, or two phones on one symbol): it's one note, not a pile-up.
  if (t < sound.last + 0.03) return sound.last;
  sound.last = t;
  const n = sound.step++;
  const chord = jamChordAt(t);
  if (sound.kind === 'drum') {
    if (sound.synth instanceof Tone.NoiseSynth) sound.synth.triggerAttackRelease(0.05, t, velocity);
    else sound.synth.triggerAttackRelease(sound.note, 0.1, t, velocity);
  } else if (sound.kind === 'bass') {
    sound.synth.triggerAttackRelease(up(chord[[0, 2, 0, 1][n % 4]], sound.index % 2 ? 0 : -12), jam.six * 1.8, t, velocity);
  } else if (sound.kind === 'chord') {
    sound.synth.triggerAttackRelease(chord.map((note) => up(note, 12 * (sound.index % 2))), jam.six * 2, t, velocity * 0.8);
  } else {
    // a melody: a little random walk over the key's 5 "safe" notes, near the sound's own pitch
    const notes = scaleFor(sound.base, jam.dna);
    sound.at = Math.max(0, Math.min(notes.length - 1, (sound.at ?? sound.index % notes.length) + [-2, -1, 1, 2, 0][(sound.index + n * 3) % 5]));
    sound.synth.triggerAttackRelease(notes[sound.at], jam.six * 2, t, velocity);
  }
  return t;
}

function setupJam(dna) {
  stopAll();
  setKey(dna);
  setClarity(1, 0.5);
  const beat = 60 / dna.bpm;
  jam = { dna, beat, six: beat / 4, start: Tone.now() + 0.2, sounds: jam?.sounds || {} };
}

// The screen's backing beat while everyone jams: pad, bass, soft kick + hats, bar after bar.
export function startJamBacking(dna) {
  setupJam(dna);
  band = buildBand(dna);
  const session = jam;
  const bar = (i) => {
    const start = session.start + i * session.beat * 4;
    soon(start, () => {
      if (jam !== session) return;
      bar(i + 1); // queue the next bar first, so a skipped note can't stop the beat
      playSection(dna, { start, end: start + session.beat * 4, chord: jamChordAt(start + 0.01), level: 3, feature: true, groove: true });
    });
  };
  bar(0);
  return { songStart: session.start, beat: session.beat };
}

// A tap arriving on the screen: snapped to the next 16th of the beat, so everyone locks in.
export function jamTap(symbol) {
  if (!jam) return Tone.now();
  const now = Tone.now() + 0.03;
  const t = jam.start + Math.ceil((now - jam.start) / jam.six) * jam.six;
  return jamHit(symbol, t);
}

// A tap on your own phone (or trying a symbol in the picker): plays right away.
export function jamTapLocal(dna, symbol) {
  if (!jam || jam.dna !== dna) setupJam(dna);
  return jamHit(symbol, Tone.now() + 0.01, 0.7);
}

// The song: everyone's taps, folded into 2-bar loops, all playing at once (no turns).
// The band's drums + bassline run the whole way through. Later loops start with a
// breakdown where only people's drum symbols play over them.
// taps = [[seat, button, ms], …]; glyphs[seat] = that phone's 4 symbols; seats = who played.
// lyrics[seat][button] = a translated word ({ word, syllables }) or null: whenever a glyph
// with a word plays, that person's voice sings it. onNote(seat, button) / onWord(seat, word) for visuals.
export function playJamSong(taps, glyphs, seats, dna, onNote, lyrics = {}, onWord = () => {}) {
  setupJam(dna);
  band = buildBand(dna);
  const { beat, six } = jam;
  const patterns = {}; // seat → [steps for each button]
  for (const seat of seats) {
    patterns[seat] = [0, 1, 2, 3].map((button) => {
      const counts = Array(32).fill(0);
      for (const [s, b, ms] of taps) if (s === seat && b === button) counts[Math.round(ms / 1000 / six) % 32]++;
      const most = Math.max(...counts);
      return counts.map((c, step) => (c && c >= Math.max(1, most * 0.35) ? step : -1)).filter((step) => step >= 0);
    });
  }
  const song = { dna };
  currentSong = song;
  const barLen = beat * 4;

  const singers = Object.keys(ROBOTS);
  const singWords = (seat, start, barIndex) => {
    const words = lyrics[seat];
    if (!words?.some(Boolean)) return;
    const voice = robotVoice(singers[seat % singers.length]);
    const scale = scaleFor(voice.basePitch, dna);
    const hits = [];
    patterns[seat].forEach((steps, button) => {
      if (!words[button]) return;
      for (const step of steps) if ((step >> 4) === barIndex % 2) hits.push([step % 16, button]);
    });
    hits.sort((a, b) => a[0] - b[0]);
    // One word at a time per person. A different word tapped while one is still being
    // sung queues up and follows straight after it, so a long word can't drown the others.
    let busyUntil = -1;
    let last = -1;
    let queued = null;
    const startWord = (step, button) => {
      const { word, syllables } = words[button];
      const notes = melody(syllables.length, scale.length, hash(word) ^ dna.seed);
      syllables.forEach((syl, n) => {
        const when = start + (step + n) * six;
        const len = (n === syllables.length - 1 ? 2 : 1) * six;
        soon(when, () => sing(voice, syl, when, scale[notes[n]], len * 0.95));
      });
      at(start + step * six, () => currentSong === song && onWord(seat, word));
      busyUntil = step + syllables.length + 1;
      last = button;
    };
    for (const [step, button] of hits) {
      if (queued !== null && busyUntil <= step) { startWord(busyUntil, queued); queued = null; }
      if (step < busyUntil) {
        if (queued === null && button !== last) queued = button;
        continue;
      }
      startWord(step, button);
    }
    if (queued !== null && busyUntil < 16) startWord(busyUntil, queued);
  };

  const playBar = (start, barIndex, level, drumsOnly) => {
    playSection(dna, { start, end: start + barLen, chord: jamChordAt(start + 0.01), level, feature: true, groove: true });
    for (const seat of seats) {
      if (!drumsOnly) singWords(seat, start, barIndex);
      patterns[seat].forEach((steps, button) => {
        const symbol = glyphs[seat]?.[button];
        if (!symbol || (drumsOnly && !jamIsDrum(symbol))) return;
        for (const step of steps) {
          if ((step >> 4) !== barIndex % 2) continue; // which half of the 2-bar loop
          const t = start + (step % 16) * six;
          jamHit(symbol, t, 0.85);
          at(t, () => currentSong === song && onNote(seat, button));
        }
      });
    }
  };

  const pass = (passStart, n) => {
    // first time: 2 bars of just the band; after that: 2 bars of only people's drum symbols. Then everyone, all in.
    const plan = n === 0 ? [[3, null], [3, null]] : [[3, true], [3, true]]; // the band's drums + bass never drop out
    for (let i = 0; i < 8; i++) plan.push([i < 4 ? 3 : 4, false]);
    plan.forEach(([level, drumsOnly], i) => {
      const start = passStart + i * barLen;
      soon(start, () => {
        if (currentSong !== song) return;
        if (drumsOnly === null) playSection(dna, { start, end: start + barLen, chord: jamChordAt(start + 0.01), level, feature: true, groove: true });
        else playBar(start, i, level, drumsOnly);
      });
    });
    const end = passStart + plan.length * barLen;
    soon(end, () => { if (currentSong === song) pass(end, n + 1); });
    return end;
  };
  const firstEnd = pass(jam.start, 0);
  return { songStart: jam.start, beat, firstPass: firstEnd - Tone.now() };
}
