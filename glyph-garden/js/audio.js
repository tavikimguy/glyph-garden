// Sound engine: rain plinks, a soft pad, and a singer that rebuilds words
// out of a player's voice bank (or a robot formant voice if they skipped).

import { hash } from './glyphs.js';
import { getClip } from './voicebank.js';

const RAIN = ['C5', 'D5', 'E5', 'G5', 'A5', 'C6', 'D6', 'E6', 'G6', 'A6'];
const CHORDS = [
  ['C3', 'G3', 'D4', 'E4'],
  ['A2', 'E3', 'G3', 'C4'],
  ['F2', 'C3', 'G3', 'A3'],
  ['G2', 'D3', 'A3', 'B3'],
];

// Compound vowels are sung as a quick glide into the main vowel (ㅑ = ㅣ→ㅏ).
const VOWEL_SOUND = {
  'ㅐ': ['ㅔ'], 'ㅑ': ['ㅣ', 'ㅏ'], 'ㅒ': ['ㅣ', 'ㅔ'], 'ㅕ': ['ㅣ', 'ㅓ'], 'ㅖ': ['ㅣ', 'ㅔ'],
  'ㅛ': ['ㅣ', 'ㅗ'], 'ㅠ': ['ㅣ', 'ㅜ'], 'ㅘ': ['ㅜ', 'ㅏ'], 'ㅙ': ['ㅜ', 'ㅔ'], 'ㅚ': ['ㅜ', 'ㅔ'],
  'ㅝ': ['ㅜ', 'ㅓ'], 'ㅞ': ['ㅜ', 'ㅔ'], 'ㅟ': ['ㅜ', 'ㅣ'], 'ㅢ': ['ㅡ', 'ㅣ'],
};

// Vowel "shapes" for the robot voice: the two resonant frequencies (formants).
const FORMANTS = {
  'ㅏ': [800, 1200], 'ㅓ': [600, 1000], 'ㅗ': [450, 800], 'ㅜ': [330, 750],
  'ㅡ': [350, 1350], 'ㅣ': [280, 2300], 'ㅔ': [480, 1900],
};
const FRICATIVES = new Set(['ㅅ', 'ㅈ', 'ㅊ', 'ㅎ']);

let fx = null;
const timers = [];

// Run fn when the audio clock reaches `time` (keeps visuals in sync with sound).
export function at(time, fn) {
  const id = setTimeout(fn, Math.max(0, (time - Tone.now()) * 1000));
  timers.push(id);
}

export function stopAll() {
  timers.forEach(clearTimeout);
  timers.length = 0;
  fx?.pad.releaseAll();
}

export async function initAudio() {
  await Tone.start();
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
  const voiceOut = new Tone.Gain(0.9).connect(delay);
  voiceOut.connect(reverb);
  const chorus = new Tone.Chorus({ frequency: 3, delayTime: 2.5, depth: 0.4, wet: 0.35 }).connect(voiceOut).start();
  const crusher = new Tone.BitCrusher(6).connect(chorus);
  crusher.wet.value = 0.2;
  const muffle = new Tone.Filter(18000, 'lowpass').connect(crusher);
  const harmony = new Tone.Gain(0.25).connect(muffle);
  const shifter = new Tone.PitchShift({ pitch: 12, windowSize: 0.05 }).connect(harmony);
  const voiceIn = new Tone.Gain(1).connect(muffle);
  voiceIn.connect(shifter);

  const noise = new Tone.NoiseSynth({
    noise: { type: 'white' },
    envelope: { attack: 0.001, decay: 0.05, sustain: 0 },
    volume: -18,
  }).connect(new Tone.Filter(3000, 'highpass').connect(voiceIn));

  fx = { drop, bell, pad, voiceIn, muffle, crusher, harmony, noise };
}

// 0 = garbled, 1 = clear. Interludes climb this slowly; the finale is near 1.
export function setClarity(c, seconds = 1) {
  fx.muffle.frequency.rampTo(350 + c * c * 12000, seconds);
  fx.crusher.wet.rampTo(0.4 - c * 0.3, seconds);
  fx.harmony.gain.rampTo(0.35 - c * 0.2, seconds);
}

export function plink(seed, time = Tone.now(), velocity = 0.8) {
  const note = RAIN[hash(String(seed)) % RAIN.length];
  fx.drop.triggerAttackRelease(note, 0.1, time, velocity);
  fx.bell.triggerAttackRelease(note, 0.05, time + 0.005, velocity * 0.6);
}

// Let a player hear the clip they just recorded, already through the effects.
export function previewClip(clip) {
  playBuffer(clip.buffer, Tone.now() + 0.05, 1);
}

function rain(from, seconds, density = 1.2) {
  let t = from;
  while (t < from + seconds) {
    t += (0.4 + Math.random() * 1.2) / density;
    fx.drop.triggerAttackRelease(RAIN[Math.floor(Math.random() * RAIN.length)], 0.1, t, 0.15 + Math.random() * 0.25);
  }
}

// Each player sings on a pentatonic scale near their own speaking pitch ("autotune").
function scaleFor(basePitch = 180) {
  const steps = [0, 2, 4, 7, 9];
  const all = [];
  for (let oct = -3; oct <= 3; oct++) for (const s of steps) all.push(261.63 * 2 ** (oct + s / 12));
  const inRange = all.filter((f) => f >= basePitch * 0.8 && f <= basePitch * 2.1);
  return inRange.length >= 5 ? inRange : all.filter((f) => f >= 130 && f <= 520);
}

function melody(count, scaleLen, seed) {
  let i = Math.floor(scaleLen / 2);
  let s = seed;
  const notes = [];
  for (let n = 0; n < count; n++) {
    s = hash(String(s));
    i = Math.min(scaleLen - 1, Math.max(0, i + (s % 5) - 2));
    notes.push(i);
  }
  if (notes.length > 1) notes[notes.length - 1] = Math.min(1, scaleLen - 1); // settle low at the end
  return notes;
}

function playBuffer(buffer, time, rate, { duration, loop = false } = {}) {
  const src = new Tone.ToneBufferSource({ url: buffer, playbackRate: rate, fadeIn: 0.005, fadeOut: 0.04 });
  src.connect(fx.voiceIn);
  if (loop) {
    src.loop = true;
    src.loopStart = buffer.duration * 0.1;
    src.loopEnd = buffer.duration * 0.9;
  }
  src.onended = () => src.dispose();
  src.start(time);
  if (duration) src.stop(time + duration);
  return src;
}

function singFromBank(bank, syl, time, freq, dur, reverse) {
  const pick = (clip) => (reverse ? clip.reversed : clip.buffer);
  let vowelStart = time;

  // 초성: the consonant attack, pitched with the same "size" as the vowel.
  const cons = syl.cho !== 'ㅇ' && getClip(bank, syl.cho);
  const baseRate = Math.min(2.2, Math.max(0.6, freq / bank.basePitch));
  if (cons) {
    const len = cons.buffer.duration / baseRate;
    playBuffer(pick(cons), time, baseRate);
    vowelStart = time + len * 0.7;
  }

  // 중성: the vowel, snapped to the melody note and held/looped to length.
  const end = time + dur;
  const sounds = VOWEL_SOUND[syl.jung] || [syl.jung];
  sounds.forEach((v, i) => {
    const clip = getClip(bank, v);
    if (!clip) return;
    const rate = Math.min(3, Math.max(0.4, freq / (clip.pitch || bank.basePitch)));
    const glide = sounds.length > 1 && i === 0;
    const start = glide ? vowelStart : vowelStart + (sounds.length > 1 ? 0.07 : 0);
    const length = glide ? 0.08 : Math.max(0.08, end - start);
    playBuffer(pick(clip), start, rate, { duration: length, loop: !glide && length > clip.buffer.duration / rate });
  });

  // 종성: a short tail consonant.
  const tail = syl.jong && getClip(bank, syl.jong);
  if (tail) playBuffer(pick(tail), end - 0.05, baseRate, { duration: 0.09 });
}

// Robot voice for players who skipped recording: sawtooth through vowel formants.
function singFromSynth(syl, time, freq, dur) {
  if (syl.cho !== 'ㅇ') fx.noise.triggerAttackRelease(FRICATIVES.has(syl.cho) ? 0.12 : 0.03, time);
  const sounds = VOWEL_SOUND[syl.jung] || [syl.jung];
  const [f1, f2] = FORMANTS[sounds[sounds.length - 1]] || FORMANTS['ㅓ'];
  const start = time + 0.03;
  const out = new Tone.Gain(0.6).connect(fx.voiceIn);
  const b1 = new Tone.Filter({ frequency: f1, type: 'bandpass', Q: 6 }).connect(out);
  const b2 = new Tone.Filter({ frequency: f2, type: 'bandpass', Q: 8 }).connect(out);
  const env = new Tone.AmplitudeEnvelope({ attack: 0.03, decay: 0.1, sustain: 0.8, release: 0.15 });
  env.fan(b1, b2);
  const osc = new Tone.Oscillator(freq, 'sawtooth').connect(env);
  osc.start(start).stop(start + dur + 0.3);
  env.triggerAttackRelease(dur, start);
  at(start + dur + 1, () => [osc, env, b1, b2, out].forEach((n) => n.dispose()));
}

function sing(bank, syl, time, freq, dur, reverse = false) {
  if (bank) singFromBank(bank, syl, time, freq, dur, reverse);
  else singFromSynth(syl, time, freq, dur);
}

// Between rounds: the round's syllables, shuffled, reversed, muffled.
// items = [{ syl, player }]; banks = [bankP1, bankP2]. Returns length in seconds.
export function playInterlude(items, banks, clarity, onSyllable) {
  setClarity(clarity, 0.5);
  const t0 = Tone.now() + 0.3;
  const order = [...items];
  for (let i = order.length - 1; i > 0; i--) {
    if (Math.random() > clarity) {
      const j = Math.floor(Math.random() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }
  }
  const picked = order.slice(0, 16);
  fx.pad.triggerAttackRelease(CHORDS[Math.floor(Math.random() * CHORDS.length)], 5, t0, 0.5);

  let t = t0 + 0.4;
  picked.forEach((item, n) => {
    const scale = scaleFor(banks[item.player]?.basePitch);
    const freq = scale[hash(item.syl.char + n) % scale.length];
    const dur = 0.2 + Math.random() * 0.25;
    sing(banks[item.player], item.syl, t, freq, dur, Math.random() < (1 - clarity) * 0.6);
    at(t, () => onSyllable(item));
    t += dur + (Math.random() - 0.3) * 0.15 * (1 - clarity);
  });
  rain(t0, t - t0 + 1, 1.5);
  return t - Tone.now() + 1.2;
}

// The song: every message in order, clear(er) voice, lyrics in sync.
// messages = [{ player, words: [{ word, syllables }] }]. Returns length in seconds.
export function playFinale(messages, banks, { onSyllable, onWord, onMessage }) {
  setClarity(0.85, 2);
  const beat = 0.3;
  let t = Tone.now() + 1;
  const songStart = t;

  messages.forEach((msg, m) => {
    const bank = banks[msg.player];
    const scale = scaleFor(bank?.basePitch);
    const syls = msg.words.flatMap((w, wi) => w.syllables.map((s, si) => ({ s, wi, si })));
    const notes = melody(syls.length, scale.length, hash(msg.words.map((w) => w.word).join(' ')));
    const msgStart = t;
    at(t, () => onMessage(m));

    syls.forEach(({ s, wi, si }, n) => {
      const lastOfWord = si === msg.words[wi].syllables.length - 1;
      const dur = n === syls.length - 1 ? beat * 2.5 : beat * (lastOfWord ? 1.2 : 0.95);
      sing(bank, s, t, scale[notes[n]], dur * 0.92);
      at(t, () => onSyllable(m, wi, si));
      if (si === 0) plink(s.char, t, 0.25);
      if (lastOfWord) at(t + dur * 0.5, () => onWord(m, wi));
      t += dur + (lastOfWord ? 0.06 : 0);
    });

    fx.pad.triggerAttackRelease(CHORDS[m % CHORDS.length], t - msgStart + 0.5, msgStart, 0.6);
    t += 0.7;
  });

  rain(songStart, t - songStart, 0.8);
  return t - Tone.now();
}
