// Records ~20 short sounds per player, trims them and detects pitch. Keys are Korean jamo.

const VOWEL_PROMPTS = [
  { key: 'ㅏ', say: 'ah', hint: 'as in "father" — hold it on one steady note', type: 'vowel' },
  { key: 'ㅓ', say: 'uh', hint: 'as in "cup" — hold it', type: 'vowel' },
  { key: 'ㅗ', say: 'oh', hint: 'as in "go" — hold it', type: 'vowel' },
  { key: 'ㅜ', say: 'oo', hint: 'as in "moon" — hold it', type: 'vowel' },
  { key: 'ㅡ', say: 'eu', hint: 'like "uh" with a flat smile — hold it', type: 'vowel' },
  { key: 'ㅣ', say: 'ee', hint: 'as in "see" — hold it', type: 'vowel' },
  { key: 'ㅔ', say: 'eh', hint: 'as in "bed" — hold it', type: 'vowel' },
];

// Record consonant + vowel together to keep the natural transition between them.
const CONSONANTS = [
  ['ㄱ', 'g'], ['ㄴ', 'n'], ['ㄷ', 'd'], ['ㄹ', 'l'], ['ㅁ', 'm'], ['ㅂ', 'b'], ['ㅅ', 's'],
  ['ㅈ', 'j'], ['ㅊ', 'ch'], ['ㅋ', 'k'], ['ㅌ', 't'], ['ㅍ', 'p'], ['ㅎ', 'h'],
];
const SYLLABLE_VOWELS = [['ㅏ', 'ah'], ['ㅣ', 'ee'], ['ㅓ', 'uh']];

export const PROMPTS = [
  ...VOWEL_PROMPTS,
  ...CONSONANTS.flatMap(([c, roman]) =>
    SYLLABLE_VOWELS.map(([v, sound]) => ({
      key: c + v,
      say: roman + sound,
      hint: 'once, short and natural — same note as before',
      type: 'syllable',
    }))),
];

const NEAR = {
  'ㅏ': ['ㅓ', 'ㅔ'], 'ㅓ': ['ㅏ', 'ㅗ', 'ㅡ'], 'ㅗ': ['ㅜ', 'ㅓ'], 'ㅜ': ['ㅗ', 'ㅡ'],
  'ㅡ': ['ㅜ', 'ㅓ'], 'ㅣ': ['ㅔ', 'ㅡ'], 'ㅔ': ['ㅣ', 'ㅏ'],
  'ㄱ': ['ㅋ', 'ㄷ'], 'ㅋ': ['ㄱ', 'ㅌ'], 'ㄷ': ['ㅌ', 'ㄱ'], 'ㅌ': ['ㄷ', 'ㅋ'],
  'ㅂ': ['ㅍ', 'ㅁ'], 'ㅍ': ['ㅂ'], 'ㅁ': ['ㄴ', 'ㅂ'], 'ㄴ': ['ㅁ', 'ㄹ'], 'ㄹ': ['ㄴ'],
  'ㅅ': ['ㅈ', 'ㅎ'], 'ㅈ': ['ㅊ', 'ㅅ'], 'ㅊ': ['ㅈ', 'ㅅ'], 'ㅎ': ['ㅅ'],
};

const FRICATIVES = new Set(['ㅅ', 'ㅈ', 'ㅊ', 'ㅎ']);

export function getClip(bank, key) {
  if (!bank) return null;
  if (bank.clips[key]) return bank.clips[key];
  for (const alt of NEAR[key] || []) if (bank.clips[alt]) return bank.clips[alt];
  return null;
}

// Closest recorded syllable (exact, near vowel, then near consonant), or null to stitch from parts.
export function findSyllable(bank, cho, vowel) {
  if (!bank) return null;
  for (const c of [cho, ...(NEAR[cho] || [])]) {
    for (const v of [vowel, (NEAR[vowel] || [])[0]]) {
      if (v && bank.clips[c + v]) return bank.clips[c + v];
    }
  }
  return null;
}

// Consonant attack cut from any syllable starting with it.
export function findOnset(bank, cho) {
  if (!bank) return null;
  for (const c of [cho, ...(NEAR[cho] || [])]) {
    for (const v of ['ㅓ', 'ㅏ', 'ㅣ']) {
      const clip = bank.clips[c + v];
      if (clip) return { clip, length: FRICATIVES.has(c) ? 0.14 : 0.09 };
    }
  }
  return null;
}

export async function openMic() {
  return navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: false, noiseSuppression: true, autoGainControl: true },
  });
}

// Returns stop(), which resolves to an AudioBuffer with .blob attached.
export function startRecording(stream, bitsPerSecond) {
  const recorder = new MediaRecorder(stream, bitsPerSecond ? { audioBitsPerSecond: bitsPerSecond } : undefined);
  const chunks = [];
  recorder.ondataavailable = (e) => chunks.push(e.data);
  recorder.start();
  return {
    stop: () =>
      new Promise((resolve, reject) => {
        recorder.onstop = async () => {
          try {
            const blob = new Blob(chunks, { type: recorder.mimeType });
            const data = await blob.arrayBuffer();
            const audio = await Tone.getContext().rawContext.decodeAudioData(data);
            audio.blob = blob;
            resolve(audio);
          } catch (err) {
            reject(err);
          }
        };
        recorder.stop();
      }),
  };
}

function copySegment(samples, from, to, sampleRate) {
  const ctx = Tone.getContext().rawContext;
  const n = Math.max(1, to - from);
  const out = ctx.createBuffer(1, n, sampleRate);
  const data = out.getChannelData(0);
  let peak = 0;
  for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(samples[from + i]));
  const gain = peak > 0 ? 0.9 / peak : 1;
  const fade = Math.min(Math.floor(sampleRate * 0.006), Math.floor(n / 4));
  for (let i = 0; i < n; i++) {
    let env = 1;
    if (i < fade) env = i / fade;
    else if (i > n - fade) env = (n - i) / fade;
    data[i] = samples[from + i] * gain * env;
  }
  return out;
}

function reverseBuffer(buffer) {
  const ctx = Tone.getContext().rawContext;
  const out = ctx.createBuffer(1, buffer.length, buffer.sampleRate);
  const src = buffer.getChannelData(0);
  const dst = out.getChannelData(0);
  for (let i = 0; i < src.length; i++) dst[i] = src[src.length - 1 - i];
  return out;
}

// Autocorrelation pitch detection.
function detectPitch(samples, sampleRate) {
  const size = Math.min(2048, samples.length);
  const start = Math.floor((samples.length - size) / 2);
  const frame = samples.subarray(start, start + size);
  const minLag = Math.floor(sampleRate / 600);
  const maxLag = Math.floor(sampleRate / 70);
  let bestLag = 0;
  let best = 0;
  for (let lag = minLag; lag <= maxLag && lag < size; lag++) {
    let sum = 0;
    for (let i = 0; i < size - lag; i++) sum += frame[i] * frame[i + lag];
    if (sum > best) { best = sum; bestLag = lag; }
  }
  return bestLag ? sampleRate / bestLag : null;
}

// Returns null for silence.
export function processClip(audioBuffer, prompt) {
  const sr = audioBuffer.sampleRate;
  const samples = audioBuffer.getChannelData(0);
  const hop = Math.floor(sr * 0.01);
  const rms = [];
  for (let i = 0; i + hop <= samples.length; i += hop) {
    let sum = 0;
    for (let j = i; j < i + hop; j++) sum += samples[j] * samples[j];
    rms.push(Math.sqrt(sum / hop));
  }
  const peak = Math.max(...rms, 0);
  if (peak < 0.01) return null;
  const threshold = Math.max(0.008, peak * 0.12);
  const first = rms.findIndex((v) => v > threshold);
  const last = rms.length - 1 - [...rms].reverse().findIndex((v) => v > threshold);
  const start = first * hop;
  const end = (last + 1) * hop;
  if (end - start < sr * 0.06) return null;

  let from;
  let to;
  if (prompt.type === 'vowel') {
    const len = end - start;
    from = start + Math.floor(len * 0.15);
    to = end - Math.floor(len * 0.15);
  } else {
    from = Math.max(0, start - Math.floor(sr * 0.01));
    to = Math.min(end, start + Math.floor(sr * 0.8));
  }

  const buffer = copySegment(samples, from, to, sr);
  const data = buffer.getChannelData(0);
  // Pitch from the vowel: whole clip, or back half of a syllable.
  const voiced = prompt.type === 'vowel' ? data : data.subarray(Math.floor(data.length * 0.45));
  return {
    buffer,
    reversed: reverseBuffer(buffer),
    pitch: detectPitch(voiced, sr),
  };
}

export function finishBank(clips) {
  const pitches = Object.values(clips).map((c) => c.pitch).filter(Boolean).sort((a, b) => a - b);
  const basePitch = pitches.length ? pitches[Math.floor(pitches.length / 2)] : 180;
  return { clips, basePitch };
}

// Split a spoken message into syllables at the quiet dips and pitch each one.
export function prepareSung(audioBuffer, syllableCount) {
  const sr = audioBuffer.sampleRate;
  const raw = audioBuffer.getChannelData(0);
  const hop = Math.floor(sr * 0.01);
  const energy = [];
  for (let i = 0; i + hop <= raw.length; i += hop) {
    let sum = 0;
    for (let j = i; j < i + hop; j++) sum += raw[j] * raw[j];
    energy.push(Math.sqrt(sum / hop));
  }
  const peak = Math.max(...energy, 0);
  if (peak < 0.01 || !syllableCount) return null;
  const threshold = Math.max(0.006, peak * 0.08);
  const first = energy.findIndex((v) => v > threshold);
  const last = energy.length - 1 - [...energy].reverse().findIndex((v) => v > threshold);
  const buffer = copySegment(raw, first * hop, Math.min(raw.length, (last + 2) * hop), sr);
  const frames = energy.slice(first, last + 2);

  const smooth = frames.map((_, i) => {
    let sum = 0;
    let n = 0;
    for (let k = Math.max(0, i - 3); k <= Math.min(frames.length - 1, i + 3); k++) { sum += frames[k]; n++; }
    return sum / n;
  });

  // Start from even spacing, then nudge each cut to the nearest quiet point.
  const per = frames.length / syllableCount;
  const cuts = [0];
  for (let k = 1; k < syllableCount; k++) {
    const ideal = Math.round(k * per);
    let best = ideal;
    for (let f = Math.max(cuts[cuts.length - 1] + 2, Math.round(ideal - per * 0.35)); f <= Math.min(frames.length - 2, Math.round(ideal + per * 0.35)); f++) {
      if (smooth[f] < smooth[best]) best = f;
    }
    cuts.push(Math.max(cuts[cuts.length - 1] + 1, best));
  }
  cuts.push(frames.length);

  const data = buffer.getChannelData(0);
  const segments = [];
  for (let k = 0; k < syllableCount; k++) {
    const start = (cuts[k] * hop) / sr;
    const end = Math.max(start + 0.05, (cuts[k + 1] * hop) / sr);
    const piece = data.subarray(Math.floor(start * sr), Math.min(data.length, Math.floor(end * sr)));
    segments.push({ start, end: Math.min(end, buffer.duration), pitch: piece.length > 800 ? detectPitch(piece, sr) : null });
  }
  const pitches = segments.map((x) => x.pitch).filter(Boolean).sort((a, b) => a - b);
  const basePitch = pitches.length ? pitches[Math.floor(pitches.length / 2)] : 180;
  return { buffer, segments, basePitch };
}
