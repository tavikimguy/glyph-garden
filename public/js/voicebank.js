// Voice bank: record ~20 short sounds per player, trim them, find their pitch.
// (Keys are Korean jamo internally: it's a tidy set of sounds to stitch words from.)
// Later the singer stitches these clips into any word — your voice, rebuilt.

const VOWEL_PROMPTS = [
  { key: 'ㅏ', say: 'ah', hint: 'as in "father" — hold it on one steady note', type: 'vowel' },
  { key: 'ㅓ', say: 'uh', hint: 'as in "cup" — hold it', type: 'vowel' },
  { key: 'ㅗ', say: 'oh', hint: 'as in "go" — hold it', type: 'vowel' },
  { key: 'ㅜ', say: 'oo', hint: 'as in "moon" — hold it', type: 'vowel' },
  { key: 'ㅡ', say: 'eu', hint: 'like "uh" with a flat smile — hold it', type: 'vowel' },
  { key: 'ㅣ', say: 'ee', hint: 'as in "see" — hold it', type: 'vowel' },
  { key: 'ㅔ', say: 'eh', hint: 'as in "bed" — hold it', type: 'vowel' },
];

// Whole syllables: each consonant with ah / ee / uh. Keeping the consonant and
// vowel in one recording keeps the natural glide between them — that's what
// makes it sound like a person instead of glued-together pieces.
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

// If a sound is missing, guess with a neighbour (lost in translation, on purpose).
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

// Best recorded whole syllable for consonant + vowel: exact, then a near vowel,
// then a near consonant. null means "stitch it from pieces instead".
export function findSyllable(bank, cho, vowel) {
  if (!bank) return null;
  for (const c of [cho, ...(NEAR[cho] || [])]) {
    for (const v of [vowel, (NEAR[vowel] || [])[0]]) {
      if (v && bank.clips[c + v]) return bank.clips[c + v];
    }
  }
  return null;
}

// Just the consonant attack ("g" of "gah"), cut from any syllable starting with it.
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

// Start recording; call the returned stop() to get an AudioBuffer.
// Start recording; call the returned stop() to get an AudioBuffer (and .blob, the raw file).
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
            audio.blob = blob; // keep the compressed file too, to send to the other phone
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

// Autocorrelation pitch finder: compares the wave with shifted copies of itself.
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

// Raw recording → trimmed, normalised clip (or null if it was silence).
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
    // Keep the steady middle of the vowel; that's the part we loop and pitch.
    const len = end - start;
    from = start + Math.floor(len * 0.15);
    to = end - Math.floor(len * 0.15);
  } else {
    // Keep the whole syllable, from just before the consonant to the vowel's end.
    from = Math.max(0, start - Math.floor(sr * 0.01));
    to = Math.min(end, start + Math.floor(sr * 0.8));
  }

  const buffer = copySegment(samples, from, to, sr);
  const data = buffer.getChannelData(0);
  // Pitch comes from the vowel: the whole clip, or a syllable's back half.
  const voiced = prompt.type === 'vowel' ? data : data.subarray(Math.floor(data.length * 0.45));
  return {
    buffer,
    reversed: reverseBuffer(buffer),
    pitch: detectPitch(voiced, sr),
  };
}

// Average speaking pitch of a bank, used to pick each player's singing range.
export function finishBank(clips) {
  const pitches = Object.values(clips).map((c) => c.pitch).filter(Boolean).sort((a, b) => a - b);
  const basePitch = pitches.length ? pitches[Math.floor(pitches.length / 2)] : 180;
  return { clips, basePitch };
}

// ── a spoken message, ready to be sung ──
// Trim the silence, cut the recording into one piece per syllable (cutting at the
// quiet dips between sounds), and find each piece's pitch so it can be tuned.
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

  // Smooth the loudness so tiny wobbles don't count as gaps between syllables.
  const smooth = frames.map((_, i) => {
    let sum = 0;
    let n = 0;
    for (let k = Math.max(0, i - 3); k <= Math.min(frames.length - 1, i + 3); k++) { sum += frames[k]; n++; }
    return sum / n;
  });

  // Ideal cuts are evenly spaced; slide each to the quietest moment nearby.
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
