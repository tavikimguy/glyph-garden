// Voice bank: record ~20 short sounds per player, trim them, find their pitch.
// Later the singer stitches these clips into any word — your voice, rebuilt.

export const PROMPTS = [
  { key: 'ㅏ', say: '아', hint: 'ah — hold it', type: 'vowel' },
  { key: 'ㅓ', say: '어', hint: 'uh — hold it', type: 'vowel' },
  { key: 'ㅗ', say: '오', hint: 'oh — hold it', type: 'vowel' },
  { key: 'ㅜ', say: '우', hint: 'oo — hold it', type: 'vowel' },
  { key: 'ㅡ', say: '으', hint: 'eu — hold it', type: 'vowel' },
  { key: 'ㅣ', say: '이', hint: 'ee — hold it', type: 'vowel' },
  { key: 'ㅔ', say: '에', hint: 'eh — hold it', type: 'vowel' },
  { key: 'ㄱ', say: '그', hint: 'short', type: 'consonant' },
  { key: 'ㄴ', say: '느', hint: 'short', type: 'consonant' },
  { key: 'ㄷ', say: '드', hint: 'short', type: 'consonant' },
  { key: 'ㄹ', say: '르', hint: 'short', type: 'consonant' },
  { key: 'ㅁ', say: '므', hint: 'short', type: 'consonant' },
  { key: 'ㅂ', say: '브', hint: 'short', type: 'consonant' },
  { key: 'ㅅ', say: '스', hint: 'short', type: 'consonant' },
  { key: 'ㅈ', say: '즈', hint: 'short', type: 'consonant' },
  { key: 'ㅊ', say: '츠', hint: 'short', type: 'consonant' },
  { key: 'ㅋ', say: '크', hint: 'short', type: 'consonant' },
  { key: 'ㅌ', say: '트', hint: 'short', type: 'consonant' },
  { key: 'ㅍ', say: '프', hint: 'short', type: 'consonant' },
  { key: 'ㅎ', say: '흐', hint: 'short', type: 'consonant' },
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

export async function openMic() {
  return navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: false, noiseSuppression: true, autoGainControl: true },
  });
}

// Start recording; call the returned stop() to get an AudioBuffer.
export function startRecording(stream) {
  const recorder = new MediaRecorder(stream);
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
            resolve(await Tone.getContext().rawContext.decodeAudioData(data));
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
    // Keep just the attack: the "g" of 그, the "s" of 스.
    from = Math.max(0, start - Math.floor(sr * 0.01));
    to = Math.min(end, start + Math.floor(sr * (FRICATIVES.has(prompt.key) ? 0.16 : 0.11)));
  }

  const buffer = copySegment(samples, from, to, sr);
  return {
    buffer,
    reversed: reverseBuffer(buffer),
    pitch: prompt.type === 'vowel' ? detectPitch(buffer.getChannelData(0), sr) : null,
  };
}

// Average speaking pitch of a bank, used to pick each player's singing range.
export function finishBank(clips) {
  const pitches = Object.values(clips).map((c) => c.pitch).filter(Boolean).sort((a, b) => a - b);
  const basePitch = pitches.length ? pitches[Math.floor(pitches.length / 2)] : 180;
  return { clips, basePitch };
}
