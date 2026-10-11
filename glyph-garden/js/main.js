// Glyph Garden — the game loop.
// title → record voices → take turns writing → interludes → the song.

import { translate } from './hangul.js';
import { buildGlyph, drawGlyph } from './glyphs.js';
import { PROMPTS, openMic, startRecording, processClip, finishBank } from './voicebank.js';
import { initAudio, plink, playInterlude, playFinale, previewClip, setClarity, stopAll } from './audio.js';

const PER_PLAYER = 4; // messages each before the song
const TOTAL = PER_PLAYER * 2;
const COLORS = [[150, 220, 255], [255, 190, 150]];
const NAMES = ['Player 1', 'Player 2'];

const $ = (id) => document.getElementById(id);
const show = (id) => {
  for (const el of document.querySelectorAll('.panel')) el.hidden = el.id !== id;
};

const state = {
  phase: 'title',
  banks: [null, null],
  messages: [], // { player, text, words }
  glyphs: [],
  ripples: [],
  stars: [],
  mic: null,
  recorder: null,
  bankPlayer: 0,
  promptIdx: 0,
  clips: {},
  focus: -1, // message being sung in the finale
};

// ───────────────────────── voice bank ─────────────────────────

async function startBank(player) {
  state.phase = 'bank';
  state.bankPlayer = player;
  state.promptIdx = 0;
  state.clips = {};
  show('bank');
  $('bank-who').textContent = `${NAMES[player]}, lend us your voice`;
  $('bank-who').style.color = rgb(COLORS[player]);
  if (!state.mic) {
    try {
      state.mic = await openMic();
    } catch {
      $('bank-status').textContent = 'No microphone — using a robot voice instead.';
      setTimeout(() => endBank(true), 1500);
      return;
    }
  }
  showPrompt();
}

function showPrompt() {
  const prompt = PROMPTS[state.promptIdx];
  $('bank-say').textContent = prompt.say;
  $('bank-hint').textContent = prompt.hint;
  $('bank-progress').textContent = `${state.promptIdx + 1} / ${PROMPTS.length}`;
  $('bank-status').textContent = 'Hold the button (or space), make the sound, let go.';
}

function recordDown() {
  if (state.phase !== 'bank' || !state.mic || state.recorder) return;
  state.recorder = startRecording(state.mic);
  $('record').classList.add('on');
}

async function recordUp() {
  if (!state.recorder) return;
  const recorder = state.recorder;
  state.recorder = null;
  $('record').classList.remove('on');
  const prompt = PROMPTS[state.promptIdx];
  try {
    const clip = processClip(await recorder.stop(), prompt);
    if (!clip) {
      $('bank-status').textContent = "Didn't catch that — hold a little longer, a little louder.";
      return;
    }
    state.clips[prompt.key] = clip;
    previewClip(clip);
    state.promptIdx++;
    if (state.promptIdx >= PROMPTS.length) endBank(false);
    else showPrompt();
  } catch (err) {
    console.error(err);
    $('bank-status').textContent = 'Recording failed — try again.';
  }
}

function endBank(skipped) {
  const hasClips = Object.keys(state.clips).length > 0;
  state.banks[state.bankPlayer] = !skipped && hasClips ? finishBank(state.clips) : null;
  if (state.bankPlayer === 0) startBank(1);
  else startWriting();
}

// ───────────────────────── writing turns ─────────────────────────

function currentPlayer() {
  return state.messages.length % 2;
}

function startWriting() {
  state.phase = 'write';
  const player = currentPlayer();
  show('write');
  $('write-who').textContent = `${NAMES[player]}, say something`;
  $('write-who').style.color = rgb(COLORS[player]);
  $('write-count').textContent = `message ${state.messages.length + 1} / ${TOTAL}`;
  $('message').value = '';
  $('message').style.caretColor = rgb(COLORS[player]);
  $('message').focus();
}

function send() {
  if (state.phase !== 'write') return;
  const text = $('message').value.trim();
  const words = translate(text);
  if (!words.length) {
    $('write-hint').textContent = 'Try some words (English or 한글).';
    return;
  }
  $('write-hint').textContent = 'enter to send';
  const msg = { player: currentPlayer(), text, words };
  state.messages.push(msg);
  const landing = spawnMessage(msg, state.messages.length - 1);
  state.phase = 'wait';
  show(null);
  setTimeout(afterSend, landing + 900);
}

function afterSend() {
  const n = state.messages.length;
  if (n >= TOTAL) return startFinale();
  if (n % 2 === 1) return startWriting();

  // A round is done: play the strange, half-heard interlude.
  state.phase = 'interlude';
  const round = n / 2;
  const items = state.glyphs
    .filter((g) => g.msg >= n - 2)
    .map((g) => ({ syl: g.syl, player: g.player, glyph: g }));
  const seconds = playInterlude(items, state.banks, (round / PER_PLAYER) * 0.7, (item) => {
    item.glyph.flash = 1;
  });
  setTimeout(startWriting, seconds * 1000);
}

// ───────────────────────── the song ─────────────────────────

function startFinale() {
  state.phase = 'finale';
  show('lyrics');
  $('lyric-sound').innerHTML = '';
  $('lyric-words').innerHTML = '';
  const seconds = playFinale(state.messages, state.banks, {
    onMessage(m) {
      state.focus = m;
      const msg = state.messages[m];
      const color = rgb(COLORS[msg.player]);
      $('lyric-sound').innerHTML = msg.words
        .map((w, wi) => w.syllables.map((s, si) => `<span data-k="${wi}-${si}">${s.char}</span>`).join(''))
        .join(' ');
      $('lyric-words').innerHTML = msg.words.map((w, wi) => `<span data-w="${wi}">${escapeHtml(w.word)}</span>`).join(' ');
      $('lyric-words').style.color = color;
    },
    onSyllable(m, wi, si) {
      const g = state.glyphs.find((x) => x.msg === m && x.wi === wi && x.si === si);
      if (g) g.flash = 1;
      $('lyric-sound').querySelector(`[data-k="${wi}-${si}"]`)?.classList.add('lit');
    },
    onWord(m, wi) {
      $('lyric-words').querySelector(`[data-w="${wi}"]`)?.classList.add('lit');
    },
  });
  setTimeout(showEnd, seconds * 1000 + 1500);
}

function showEnd() {
  state.phase = 'end';
  state.focus = -1;
  setClarity(0.5, 2);
  show('end');
  $('end-lyrics').innerHTML = state.messages
    .map((m) => `<li style="color:${rgb(COLORS[m.player])}"><span class="sound">${m.words
      .map((w) => w.syllables.map((s) => s.char).join(''))
      .join(' ')}</span>${escapeHtml(m.text)}</li>`)
    .join('');
}

function newDuet() {
  stopAll();
  state.messages = [];
  state.glyphs = [];
  state.ripples = [];
  startWriting();
}

// ───────────────────────── glyphs in space ─────────────────────────

let P = null; // the p5 instance

// Lay a message out as a drifting line of glyphs, then let them fall like rain.
// Returns ms until the last glyph lands.
function spawnMessage(msg, m) {
  // Each message gets its own slot in a loose 2×4 grid, so they never pile up.
  if (m === 0) state.slots = shuffle([0, 1, 2, 3, 4, 5, 6, 7]);
  const slot = state.slots[m % 8];
  const best = {
    x: (slot % 2 ? 0.72 : 0.28) + (Math.random() - 0.5) * 0.08,
    y: 0.13 + Math.floor(slot / 2) * 0.18 + (Math.random() - 0.5) * 0.05,
  };
  msg.center = best;

  const size = glyphSize();
  const flat = msg.words.flatMap((w, wi) => w.syllables.map((syl, si) => ({ syl, wi, si })));
  const units = flat.length + (msg.words.length - 1) * 0.5;
  // Long messages squeeze together instead of sprawling across the screen.
  const step = Math.min(size * 1.25, (P.width * 0.3) / units) / P.width;
  const angle = (Math.random() - 0.5) * 0.5;
  const bend = (Math.random() - 0.5) * 0.3; // gentle arc, like a constellation
  const span = units * step;
  let along = -span / 2;
  const now = P.millis();

  flat.forEach(({ syl, wi, si }, i) => {
    if (si === 0 && wi > 0) along += step * 0.5;
    const wave = Math.sin(i * 0.9) * 0.008 + bend * (along * along) * 4;
    const hx = Math.min(0.95, Math.max(0.05, best.x + Math.cos(angle) * along - Math.sin(angle) * wave));
    const hy = Math.min(0.85, Math.max(0.06, best.y + (Math.sin(angle) * along + Math.cos(angle) * wave) * (P.width / P.height)));
    state.glyphs.push({
      syl, wi, si, msg: m, player: msg.player,
      geo: buildGlyph(syl),
      hx, hy,
      y: -40,
      vy: 2 + Math.random() * 2,
      born: now + i * 120,
      landed: false,
      flash: 0,
      seed: Math.random() * 1000,
    });
    along += step;
  });
  return flat.length * 120 + 1400;
}

function shuffle(list) {
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list;
}

function glyphSize() {
  return Math.max(26, Math.min(44, Math.min(P.width, P.height) * 0.045));
}

function sketch(p) {
  P = p;

  p.setup = () => {
    p.createCanvas(window.innerWidth, window.innerHeight).parent('stage');
    for (let i = 0; i < 220; i++) {
      state.stars.push({ x: Math.random(), y: Math.random(), r: Math.random() * 1.4 + 0.3, t: Math.random() * 10 });
    }
  };

  p.windowResized = () => p.resizeCanvas(window.innerWidth, window.innerHeight);

  p.draw = () => {
    p.background(5, 6, 10);
    const t = p.millis() / 1000;
    const size = glyphSize();
    const dancing = state.phase === 'interlude';

    p.noStroke();
    for (const s of state.stars) {
      p.fill(200, 210, 255, 40 + 40 * Math.sin(t * 0.8 + s.t));
      p.circle(s.x * p.width, s.y * p.height, s.r);
    }

    // Where each glyph is this frame: home + slow drift (+ a dance between rounds).
    for (const g of state.glyphs) {
      const hx = g.hx * p.width;
      const hy = g.hy * p.height;
      const amp = dancing ? 14 : 5;
      const speed = dancing ? 0.9 : 0.25;
      g.x = hx + (p.noise(g.seed, t * speed) - 0.5) * amp * 2;
      const driftY = hy + (p.noise(g.seed + 50, t * speed) - 0.5) * amp * 2;
      if (!g.landed) {
        if (p.millis() < g.born) continue;
        // Time-based fall (not per-frame), so it's the same speed on any screen.
        const age = (p.millis() - g.born) / 1000;
        g.y = -40 + g.vy * 60 * age + 900 * age * age;
        if (g.y >= driftY) {
          g.landed = true;
          plink(g.syl.char);
          state.ripples.push({ x: hx, y: hy, r: 4, a: 1, color: COLORS[g.player] });
        }
      } else {
        g.y = driftY;
      }
    }

    // Faint constellation lines between neighbours in the same message.
    p.strokeWeight(1);
    for (let i = 1; i < state.glyphs.length; i++) {
      const a = state.glyphs[i - 1];
      const b = state.glyphs[i];
      if (a.msg !== b.msg || !a.landed || !b.landed) continue;
      const [r, gg, bb] = COLORS[b.player];
      p.stroke(r, gg, bb, 22 * msgAlpha(b));
      p.line(a.x, a.y, b.x, b.y);
    }

    for (const rp of state.ripples) {
      p.noFill();
      p.stroke(...rp.color, 120 * rp.a);
      p.circle(rp.x, rp.y, rp.r * 2);
      rp.r += 0.9;
      rp.a *= 0.955;
    }
    state.ripples = state.ripples.filter((rp) => rp.a > 0.02);

    for (const g of state.glyphs) {
      if (p.millis() < g.born) continue;
      const pulse = dancing ? 1 + Math.sin(t * 3 + g.seed) * 0.08 : 1;
      drawGlyph(p, g.geo, g.x, g.y, size * pulse * (1 + g.flash * 0.45), COLORS[g.player], msgAlpha(g), g.flash);
      g.flash *= 0.93;
    }
  };
}

// During the song, the message being sung is bright and the rest dim.
function msgAlpha(g) {
  if (state.focus < 0) return 0.9;
  return g.msg === state.focus ? 1 : 0.35;
}

// ───────────────────────── wiring ─────────────────────────

function rgb([r, g, b]) {
  return `rgb(${r}, ${g}, ${b})`;
}

function escapeHtml(s) {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
}

$('begin').addEventListener('click', async () => {
  await initAudio();
  startBank(0);
});
$('robots').addEventListener('click', async () => {
  await initAudio();
  startWriting();
});
$('skip-bank').addEventListener('click', () => endBank(true));
$('redo').addEventListener('click', () => {
  if (state.promptIdx > 0) state.promptIdx--;
  showPrompt();
});

const rec = $('record');
rec.addEventListener('pointerdown', recordDown);
rec.addEventListener('pointerup', recordUp);
rec.addEventListener('pointerleave', recordUp);
window.addEventListener('keydown', (e) => {
  if (e.code === 'Space' && state.phase === 'bank' && !e.repeat) { e.preventDefault(); recordDown(); }
});
window.addEventListener('keyup', (e) => {
  if (e.code === 'Space' && state.phase === 'bank') { e.preventDefault(); recordUp(); }
});

$('message').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.isComposing) send(); // isComposing: don't send mid-한글 typing
});
$('replay').addEventListener('click', startFinale);
$('save').addEventListener('click', () => P.saveCanvas('glyph-garden', 'png'));
$('again').addEventListener('click', newDuet);

window.garden = state; // handy for poking around in the browser console
new p5(sketch);
