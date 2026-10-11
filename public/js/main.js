// Glyph Garden — the game loop (game mode: duet).
// title → (online lobby | one-screen setup) → take turns writing → interludes → the song.
// Online, both phones run this same loop; the room on the server just relays
// the messages in order, so both see the same glyphs and hear the same song.

import { translate } from './hangul.js';
import { makeCipher, encode, randomSymbol } from './glyphs.js';
import { FORMATIONS, PATTERN_NAMES } from './formations.js';
import { PICTURE_WORDS } from './pictures.js';
import { PROMPTS, openMic, startRecording, processClip, finishBank } from './voicebank.js';
import {
  initAudio, plink, bump, playInterlude, playFinale, previewClip, previewVoice, setClarity, setAmbient, stopAll,
  VOICE_GROUPS, robotVoice, setKey, newChimes,
} from './audio.js';
import { songDNA, messageMood } from './songdna.js';
import { promptFor } from './prompts.js';
import { connect, newCode } from './online.js';

const PER_PLAYER = 4; // messages each before the song
const TOTAL = PER_PLAYER * 2;
// A small palette players pick from; COLORS holds each player's current pick.
const PALETTE = {
  sky: [150, 220, 255], peach: [255, 190, 150], mint: [150, 240, 200],
  lilac: [200, 175, 255], rose: [255, 155, 195], gold: [255, 215, 120],
};
const COLORS = [PALETTE.sky, PALETTE.peach];
const NAMES = ['Player 1', 'Player 2'];

const $ = (id) => document.getElementById(id);
const show = (id) => {
  for (const el of document.querySelectorAll('.panel')) el.hidden = el.id !== id;
};

const state = {
  phase: 'title',
  banks: [null, null],
  cipher: null, // set from the seed below
  messages: [], // { player, text, words: [{ word, syllables }] }
  glyphs: [],
  ripples: [],
  stars: [],
  mic: null,
  recorder: null,
  bankPlayer: 0,
  promptIdx: 0,
  clips: {},
  focus: -1, // message being sung in the finale
  robots: ['guitar', 'keys'], // instrument/robot voice per player if they don't record
  formation: null, // the dance pattern between rounds
  online: null, // { code, conn, me, room } when playing a duet across two phones
  started: false, // has this phone entered the garden yet?
  inbox: [], // messages from the room waiting their turn to fly in
  revealed: new Set(), // letters whose real identity has been revealed (one per message)
  prompts: false, // shared-prompt mode (the host's choice online)
  seed: Math.floor(Math.random() * 2 ** 31), // this duet's seed: glyphs + prompts
  decks: { pattern: [], picture: [] }, // shuffled dances still to come, so none repeats until all have played
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
  $('bank-status').textContent = 'Hold the button (or space), make the sound, let go. Keep the same note throughout — it blends better.';
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
  state.banks[state.bankPlayer] = !skipped && hasClips
    ? finishBank(state.clips)
    : robotVoice(state.robots[state.bankPlayer]);
  if (state.bankPlayer === 0) startBank(1);
  else startWriting();
}

// ───────────────────────── writing turns ─────────────────────────

function currentPlayer() {
  return state.messages.length % 2;
}

function showRoundPrompt(on) {
  const visible = on && state.prompts;
  $('prompt').hidden = !visible;
  if (visible) $('prompt').textContent = promptFor(state.seed, Math.floor(state.messages.length / 2));
}

function startWriting() {
  if (state.inbox.length) return receiveNext();
  showRoundPrompt(true);
  const player = currentPlayer();
  if (state.online && player !== state.online.me) {
    state.phase = 'their-turn';
    show('waiting');
    $('waiting-who').style.color = rgb(COLORS[player]);
    $('waiting-note').textContent = `message ${state.messages.length + 1} / ${TOTAL}`;
    return;
  }
  state.phase = 'write';
  show('write');
  $('write-who').textContent = state.online ? 'your turn' : `${NAMES[player]}, say something`;
  $('write-who').style.color = rgb(COLORS[player]);
  $('write-count').textContent = `message ${state.messages.length + 1} / ${TOTAL}`;
  $('message').value = '';
  $('message').style.caretColor = rgb(COLORS[player]);
  if (!matchMedia('(pointer: coarse)').matches) $('message').focus(); // don't pop the phone keyboard uninvited
}

function send() {
  if (state.phase !== 'write') return;
  stopListening();
  const text = $('message').value.trim().replace(/\s+/g, ' ');
  if (!/[a-z0-9]/i.test(text)) {
    $('write-hint').textContent = 'Try some words.';
    return;
  }
  $('write-hint').textContent = 'enter to send';
  if (state.online) {
    // Send it to the room; it comes back to both phones as 'said', in order.
    state.phase = 'sending';
    show(null);
    state.online.conn.send({ type: 'say', text });
    return;
  }
  receive(currentPlayer(), text);
  // Add its words to the shared word log (online, the room does this itself).
  fetch('/api/words', { method: 'POST', body: JSON.stringify({ text }) }).catch(() => {});
}

// A message enters the space: its glyphs are thrown in, then the game moves on.
// quiet = catching up after (re)joining: no interlude, just put the glyphs in.
function receive(player, text, quiet = false) {
  // Each word keeps its sounds (for singing) next to its letters (for glyphs).
  const words = text.split(' ').map((word) => ({
    word,
    syllables: translate(word).flatMap((w) => w.syllables),
  }));
  const msg = { player, text, words };
  state.messages.push(msg);
  setKey(songDNA(state.messages)); // the space drifts into the conversation's key
  const landing = spawnMessage(msg, state.messages.length - 1);
  revealLetter(text, quiet ? 0 : landing + 400);
  if (quiet) return;
  state.phase = 'wait';
  show(null);
  setTimeout(afterSend, landing + 900);
}

// Each message unlocks one letter of the cipher for both players: its most
// common letter that isn't known yet. Same order on both phones → same letters.
function revealLetter(text, delay) {
  const counts = {};
  for (const ch of text.toLowerCase()) if (ch >= 'a' && ch <= 'z' && !state.revealed.has(ch)) counts[ch] = (counts[ch] || 0) + 1;
  const letter = Object.keys(counts).sort((a, b) => counts[b] - counts[a] || a.localeCompare(b))[0];
  if (!letter) return;
  state.revealed.add(letter);
  const at = P.millis() + delay;
  for (const g of state.glyphs) {
    if (g.ch.toLowerCase() === letter && g.revealAt === null) {
      g.revealAt = at;
    }
  }
  setTimeout(() => {
    glyphsWithLetter(letter).forEach((g) => { g.flash = 1; });
    if (delay) plink(state.cipher[letter]);
    showKey(letter);
  }, delay);
}

function glyphsWithLetter(letter) {
  return state.glyphs.filter((g) => g.ch.toLowerCase() === letter);
}

// The little key in the corner: every glyph you've learned so far.
function showKey(fresh) {
  $('key').hidden = state.revealed.size === 0;
  $('key').innerHTML = [...state.revealed]
    .map((l) => `<span class="${l === fresh ? 'new' : ''}">${escapeHtml(state.cipher[l])}<b>${l}</b></span>`)
    .join('');
}

function receiveNext() {
  const { player, text } = state.inbox.shift();
  receive(player, text);
}

function afterSend() {
  const n = state.messages.length;
  if (n >= TOTAL) return startFinale();
  if (n % 2 === 1) return startWriting();

  // A round is done: play the strange, half-heard interlude.
  state.phase = 'interlude';
  const round = n / 2;
  const items = [];
  for (let m = n - 2; m < n; m++) {
    state.messages[m].words.forEach((w, wi) => {
      const glyphs = glyphsOf(m, wi);
      w.syllables.forEach((syl) => items.push({ syl, player: state.messages[m].player, glyphs }));
    });
  }
  const seconds = playInterlude(items, state.banks, (round / PER_PLAYER) * 0.7, (item) => {
    item.glyphs.forEach((g) => { g.flash = 1; });
  });
  // A pattern first, then (if someone said cat, moon, love…) it turns into that picture halfway.
  startFormation(nextDance('pattern'));
  setTimeout(() => { if (state.phase === 'interlude') startFormation(nextDance('picture')); }, (seconds * 1000) * 0.45);
  setTimeout(() => {
    endFormation();
    startWriting();
  }, seconds * 1000);
}

function glyphsOf(m, wi) {
  return state.glyphs.filter((g) => g.msg === m && (wi === undefined || g.wi === wi));
}

// ───────────────────────── the song ─────────────────────────

// The finale is a performance: everyone dances (on the beat), and the message
// being sung steps out to centre stage, revealing each word as it's sung.
// The song then loops forever with the full band until someone hits stop.
function startFinale() {
  state.phase = 'finale';
  show(null);
  showRoundPrompt(false);
  setAmbient(false);
  state.focus = -1;
  for (const g of state.glyphs) {
    g.mode = 'free';
    g.decodeAt = null;
  }
  startFormation(nextDance('pattern'));
  state.dna = songDNA(state.messages);
  const song = playFinale(state.messages, state.banks, state.dna, {
    onMessage(m) {
      if (state.focus >= 0) {
        decode(state.focus, Infinity);
        glyphsOf(state.focus).forEach((g) => { g.mode = 'form'; }); // back into the dance
      }
      state.focus = m;
      glyphsOf(m).forEach((g) => { g.mode = 'stage'; });
      // A new move every two messages, alternating patterns and pictures.
      if (m % 2 === 0) startFormation(nextDance(m % 4 === 0 ? 'pattern' : 'picture'));
    },
    onSyllable(m, wi, si) {
      if (si === 0) decode(m, wi); // the word appears the moment it starts being sung
      glyphsOf(m, wi).forEach((g) => { g.flash = Math.max(g.flash, 0.7); });
    },
  });
  state.song = song;
  // After the first time through, show the song card — but keep playing.
  setTimeout(() => { if (state.song === song) showEncore(); }, song.firstPass * 1000);
}

// Scramble then reveal the real letters of message m, up to word wi.
function decode(m, wi) {
  const now = P.millis();
  state.glyphs
    .filter((g) => g.msg === m && g.wi <= wi && g.decodeAt === null)
    .forEach((g, k) => { g.decodeAt = now + k * 20; });
}

// The song card, shown while the song keeps looping.
function showEncore() {
  state.phase = 'encore';
  show('end');
  $('replay').textContent = 'stop';
  const d = state.dna;
  const secrets = d.secrets.length;
  $('end-recipe').textContent = [
    `${d.keyName} · ${d.feel}`, `${d.bpm} bpm`, `${d.kit} drums, ${d.pattern} beat`, `${d.lead} + ${d.pad}`,
  ].join('  ·  ');
  $('end-secrets').textContent = secrets ? `✶ you found ${secrets} secret word${secrets > 1 ? 's' : ''}` : '';
  $('end-lyrics').innerHTML = state.messages
    .map((m) => `<li style="color:${rgb(COLORS[m.player])}">${escapeHtml(m.text)}</li>`)
    .join('');
}

// Stop the loop: the band stops, the letters drift off into space again.
function stopSong() {
  stopAll();
  state.phase = 'end';
  state.song = null;
  state.focus = -1;
  state.formation = null;
  state.messages.forEach((_, m) => decode(m, Infinity));
  setAmbient(true);
  setClarity(0.5, 2);
  for (const g of state.glyphs) {
    g.mode = 'free';
    g.vx = (Math.random() - 0.5) * 40;
    g.vy = (Math.random() - 0.5) * 40;
  }
  $('replay').textContent = 'play again';
}

function newDuet(seed = Math.floor(Math.random() * 2 ** 31)) {
  stopAll();
  state.seed = seed;
  state.revealed = new Set();
  showKey();
  state.song = null;
  state.focus = -1;
  setAmbient(true);
  newChimes();
  state.cipher = makeCipher(seed);
  state.inbox = [];
  state.messages = [];
  state.glyphs = [];
  state.ripples = [];
  state.formation = null;
  state.decks = { pattern: [], picture: [] };
  setKey(songDNA([]));
  startWriting();
}

// ───────────────────────── glyphs in space ─────────────────────────

let P = null; // the p5 instance

// Throw a message in from the player's side: Player 1 sprays in from the left,
// Player 2 from the right. Physics takes it from there.
// Returns ms until the spray has settled into drifting.
function spawnMessage(msg, m) {
  const fromLeft = msg.player === 0;
  const originY = P.height * (0.25 + Math.random() * 0.5);
  const aim = (Math.random() - 0.5) * 0.5; // the whole throw angles up or down a bit
  const now = P.millis();

  let wi = 0;
  let order = 0;
  [...msg.text].forEach((ch, col) => {
    if (ch === ' ') { wi++; return; }
    const angle = aim + (Math.random() - 0.5) * 0.6;
    const speed = 380 + Math.random() * 420;
    state.glyphs.push({
      ch,
      sym: encode(state.cipher, ch),
      player: msg.player,
      msg: m,
      wi,
      col,
      len: msg.text.length,
      x: fromLeft ? -20 : P.width + 20,
      y: originY + (Math.random() - 0.5) * 60,
      vx: Math.cos(angle) * speed * (fromLeft ? 1 : -1),
      vy: Math.sin(angle) * speed,
      mode: 'thrown',
      entered: false,
      launched: false,
      born: now + order++ * 45,
      flash: 0,
      decodeAt: null,
      quietUntil: now + order * 45 + 2000, // no chimes while the spray is flying
      seed: Math.random() * 1000,
      mood: messageMood(msg.text), // how this message's glyphs move: excited / happy / sad / calm
      revealAt: state.revealed.has(ch.toLowerCase()) ? now : null, // letter already known? show it
    });
  });
  return order * 45 + 1400;
}

function shuffle(list) {
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list;
}

function glyphSize() {
  return Math.max(18, Math.min(30, Math.min(P.width, P.height) * 0.032));
}

// Centre stage during the song: the message being sung, big, spaced like text.
const STAGE_SCALE = 1.6;
function stageOf(g) {
  const charW = Math.min(glyphSize() * 0.68 * STAGE_SCALE, (P.width * 0.9) / g.len);
  return { x: P.width / 2 + (g.col - (g.len - 1) / 2) * charW, y: P.height / 2 };
}

// Between rounds the glyphs band together into a moving pattern or a picture
// (see formations.js and pictures.js). kind = 'pattern' or 'picture'.
function nextDance(kind) {
  if (kind === 'picture') {
    // Only pictures of things someone has actually said (cat, moon, love…).
    const said = new Set(state.messages.flatMap((m) => m.text.toLowerCase().match(/[a-z']+/g) || []));
    const earned = Object.keys(PICTURE_WORDS).filter((name) => PICTURE_WORDS[name].some((w) => said.has(w)));
    if (!earned.length) return nextDance('pattern');
    const deck = state.decks.picture.filter((name) => earned.includes(name));
    state.decks.picture = deck.length ? deck : shuffle(earned);
    return state.decks.picture.pop();
  }
  const deck = state.decks.pattern;
  if (!deck.length) deck.push(...shuffle([...PATTERN_NAMES]));
  return deck.pop();
}

function startFormation(name) {
  const counts = [0, 0];
  const msgSize = [];
  state.glyphs.forEach((g, i) => {
    g.fi = i;
    g.fj = counts[g.player]++;
    g.fm = msgSize[g.msg] || 0;
    msgSize[g.msg] = g.fm + 1;
    if (g.mode !== 'stage') g.mode = 'form';
  });
  state.formation = {
    name,
    pattern: FORMATIONS[name],
    params: FORMATIONS[name].setup(),
    ctx: { n: state.glyphs.length, counts, msgs: state.messages.length, msgSize },
  };
}

function endFormation() {
  for (const g of state.glyphs) if (g.mode === 'form') g.mode = 'free';
  state.formation = null;
}

// Where glyph g wants to be right now in the current dance.
function formationTarget(g, t) {
  const { pattern, params, ctx } = state.formation;
  const W = P.width;
  const H = P.height;
  const c = { ...ctx, W, H, cx: W / 2, cy: H / 2, R: Math.min(W, H) * 0.42 };
  return pattern.at(g, t, c, params);
}

function updateGlyphs(dt, t, now) {
  const W = P.width;
  const H = P.height;
  const moving = [];

  for (const g of state.glyphs) {
    if (now < g.born) continue;
    if (g.mode === 'thrown') {
      if (!g.launched) {
        g.launched = true;
        plink(g.sym, undefined, 0.45); // a spray of notes as the handful is thrown
      }
      // Air drag slows the throw until it's just drifting.
      const drag = Math.exp(-dt * 1.6);
      g.vx *= drag;
      g.vy *= drag;
      g.x += g.vx * dt;
      g.y += g.vy * dt;
      if (!g.entered && g.x > 14 && g.x < W - 14) g.entered = true;
      if (g.entered) bounceWalls(g, W, H);
      if (Math.hypot(g.vx, g.vy) < 40) {
        g.mode = 'free';
        state.ripples.push({ x: g.x, y: g.y, born: now, color: COLORS[g.player], strength: 0.35, rings: 1 });
      }
      moving.push(g);
    } else if (g.mode === 'form') {
      // Steer toward a moving target: smooth and flowing, not snapping.
      const [tx, ty] = formationTarget(g, t);
      const k = Math.min(1, dt * 3);
      g.vx += ((tx - g.x) * 2.5 - g.vx) * k;
      g.vy += ((ty - g.y) * 2.5 - g.vy) * k;
      g.x += g.vx * dt;
      g.y += g.vy * dt;
    } else if (g.mode === 'stage') {
      const h = stageOf(g);
      const k = Math.min(1, dt * 6);
      g.x += (h.x - g.x) * k;
      g.y += (h.y + Math.sin(t * 2 + g.col * 0.4) * 3 - g.y) * k; // a gentle bob, never still
    } else {
      // Free drift: a noise-driven wander that never fully stops.
      const a = P.noise(g.seed, t * 0.2) * Math.PI * 4;
      g.vx += Math.cos(a) * 25 * dt;
      g.vy += Math.sin(a) * 25 * dt;
      if (g.mood === 'sad') g.vy += 8 * dt; // sad glyphs sink
      if (g.mood === 'happy') g.vy -= 4 * dt; // happy ones float up
      const [slow, fast] = { excited: [28, 75], sad: [5, 16], happy: [12, 42], calm: [10, 38] }[g.mood] || [10, 38];
      const speed = Math.hypot(g.vx, g.vy) || 1;
      const clamped = Math.min(fast, Math.max(slow, speed));
      g.vx *= clamped / speed;
      g.vy *= clamped / speed;
      g.x += g.vx * dt;
      g.y += g.vy * dt;
      bounceWalls(g, W, H);
      moving.push(g);
    }
  }

  // Bumping: glyphs push apart, swap momentum, chime, and ripple like a pebble in water.
  const minD = glyphSize() * 0.6;
  for (let i = 0; i < moving.length; i++) {
    const a = moving[i];
    for (let j = i + 1; j < moving.length; j++) {
      const b = moving[j];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const d2 = dx * dx + dy * dy;
      if (d2 >= minD * minD || d2 === 0) continue;
      const d = Math.sqrt(d2);
      const nx = dx / d;
      const ny = dy / d;
      const push = (minD - d) / 2;
      a.x -= nx * push; a.y -= ny * push;
      b.x += nx * push; b.y += ny * push;
      const closing = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
      if (closing >= 0) continue;
      a.vx += nx * closing; a.vy += ny * closing;
      b.vx -= nx * closing; b.vy -= ny * closing;
      if (now > a.quietUntil && now > b.quietUntil && -closing > 4) {
        const strength = Math.min(1, -closing / 50);
        bump(a.sym + b.sym, strength);
        state.ripples.push({
          x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, born: now,
          color: COLORS[a.player], strength: 0.5 + strength * 0.5, rings: 2,
        });
        a.flash = Math.max(a.flash, 0.5);
        b.flash = Math.max(b.flash, 0.5);
        a.quietUntil = b.quietUntil = now + 1200;
      }
    }
  }
}

function bounceWalls(g, W, H) {
  const m = 14;
  if (g.x < m || g.x > W - m) { g.vx = -g.vx; g.x = Math.min(W - m, Math.max(m, g.x)); }
  if (g.y < m || g.y > H - m) { g.vy = -g.vy; g.y = Math.min(H - m, Math.max(m, g.y)); }
}

// Pebble-in-water rings: a few circles that spread out and fade, one after another.
const RIPPLE_LIFE = 2.4; // seconds each ring lasts
const RING_GAP = 0.5; // seconds between rings

function drawRipples(p, now) {
  p.noFill();
  p.strokeWeight(1);
  for (const rp of state.ripples) {
    const age = (now - rp.born) / 1000;
    for (let k = 0; k < rp.rings; k++) {
      const ringAge = age - k * RING_GAP;
      if (ringAge < 0 || ringAge > RIPPLE_LIFE) continue;
      const fade = (1 - ringAge / RIPPLE_LIFE) ** 1.5;
      p.stroke(...rp.color, 170 * rp.strength * fade);
      p.circle(rp.x, rp.y, (4 + ringAge * 32 * (0.6 + rp.strength * 0.6)) * 2); // slow spread
    }
  }
  state.ripples = state.ripples.filter((rp) => (now - rp.born) / 1000 < RIPPLE_LIFE + rp.rings * RING_GAP);
}

// What a glyph shows right now: its symbol, a scramble, or the real letter.
const SCRAMBLE_MS = 180;
const SMALL_SCREEN = Math.min(window.innerWidth, window.innerHeight) < 600;
function face(g, now) {
  const from = g.decodeAt ?? g.revealAt; // decoded in the song, or its letter was revealed
  if (from === null || now < from) return g.sym;
  if (now < from + SCRAMBLE_MS) return randomSymbol();
  return g.ch;
}

// 1 right on each beat of the song, fading to 0 before the next: makes glyphs pulse.
function beatPulse() {
  if (!state.song) return 0;
  const since = Tone.now() - state.song.songStart;
  if (since < 0) return 0;
  return Math.exp(-((since / state.song.beat) % 1) * 6);
}

function sketch(p) {
  P = p;

  p.setup = () => {
    p.createCanvas(window.innerWidth, window.innerHeight).parent('stage');
    p.textFont('JetBrains Mono'); // loaded in index.html
    p.textAlign(p.CENTER, p.CENTER);
    for (let i = 0; i < 220; i++) {
      state.stars.push({ x: Math.random(), y: Math.random(), r: Math.random() * 1.4 + 0.3, t: Math.random() * 10 });
    }
  };

  p.windowResized = () => p.resizeCanvas(window.innerWidth, window.innerHeight);

  p.draw = () => {
    p.background(5, 6, 10);
    const now = p.millis();
    const t = now / 1000;
    const dt = Math.min(0.05, p.deltaTime / 1000);
    const size = glyphSize();
    const ctx = p.drawingContext;

    p.noStroke();
    for (const s of state.stars) {
      p.fill(200, 210, 255, 40 + 40 * Math.sin(t * 0.8 + s.t));
      p.circle(s.x * p.width, s.y * p.height, s.r);
    }

    updateGlyphs(dt, t, now);

    // Faint threads between neighbouring letters of the same word, while they're close.
    p.strokeWeight(1);
    for (let i = 1; i < state.glyphs.length; i++) {
      const a = state.glyphs[i - 1];
      const b = state.glyphs[i];
      if (a.msg !== b.msg || a.wi !== b.wi || now < a.born || now < b.born) continue;
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (d > size * 5) continue;
      p.stroke(...COLORS[b.player], 30 * (1 - d / (size * 5)) * alphaOf(b));
      p.line(a.x, a.y, b.x, b.y);
    }

    drawRipples(p, now);

    p.noStroke();
    const pulse = beatPulse();
    for (const g of state.glyphs) {
      if (now < g.born) continue;
      const [r, gg, b] = COLORS[g.player];
      const decoded = g.decodeAt !== null && now >= g.decodeAt + SCRAMBLE_MS;
      const glow = Math.max(g.flash, decoded ? 0.35 : 0);
      ctx.shadowBlur = glow > 0.05 && !SMALL_SCREEN ? 6 + glow * 18 : 0; // glow is costly on phones
      ctx.shadowColor = `rgba(${r}, ${gg}, ${b}, ${0.8 * glow})`;
      p.fill(decoded ? 245 : r, decoded ? 245 : gg, decoded ? 250 : b, 255 * alphaOf(g));
      const scale = g.mode === 'stage' ? STAGE_SCALE : 1 + pulse * 0.18;
      // Feelings leak through: happy glyphs hop, excited ones spin, sad ones dim and shrink.
      let hop = 0;
      let spin = 0;
      let shrink = 1;
      if (g.mode !== 'stage') {
        if (g.mood === 'happy') hop = -Math.abs(Math.sin(t * 3.2 + g.seed)) * size * 0.35;
        else if (g.mood === 'excited') spin = t * 2.5 + g.seed;
        else if (g.mood === 'sad') {
          shrink = 0.88;
          p.fill(decoded ? 245 : r, decoded ? 245 : gg, decoded ? 250 : b, 150 * alphaOf(g));
        }
      }
      p.textSize(size * scale * shrink * (1 + g.flash * 0.35));
      p.push();
      p.translate(g.x, g.y + hop);
      if (spin) p.rotate(spin);
      p.text(face(g, now), 0, 0);
      p.pop();
      g.flash *= 0.93;
    }
    ctx.shadowBlur = 0;
  };
}

// During the song, the message being sung is bright and the rest dim.
function alphaOf(g) {
  if (state.focus < 0) return 0.9;
  return g.msg === state.focus ? 1 : 0.4;
}

// ───────────────────────── wiring ─────────────────────────

function rgb([r, g, b]) {
  return `rgb(${r}, ${g}, ${b})`;
}

function escapeHtml(s) {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
}

$('local').addEventListener('click', () => show('local-setup'));
$('begin').addEventListener('click', async () => {
  await startAudio();
  state.started = true;
  startBank(0);
});
$('robots').addEventListener('click', async () => {
  await startAudio();
  state.started = true;
  state.banks = state.robots.map(robotVoice);
  startWriting();
});

// Title screen: each player picks a robot voice (dropdown, previews on change)
// and a colour (swatches; you can't take the other player's colour).
function showPickers() {
  [0, 1].forEach((p) => {
    $(`voice-${p}`).value = state.robots[p];
    $(`player-${p}`).style.color = rgb(COLORS[p]);
    $(`colors-${p}`).querySelectorAll('button').forEach((btn) => {
      const mine = PALETTE[btn.dataset.color] === COLORS[p];
      btn.classList.toggle('on', mine);
      btn.disabled = PALETTE[btn.dataset.color] === COLORS[1 - p];
    });
  });
}
[0, 1].forEach((p) => {
  const select = $(`voice-${p}`);
  select.innerHTML = Object.entries(VOICE_GROUPS)
    .map(([group, names]) => `<optgroup label="${group}">${names.map((n) => `<option value="${n}">${n}</option>`).join('')}</optgroup>`)
    .join('');
  select.addEventListener('change', async () => {
    state.robots[p] = select.value; // save first, before waiting on audio
    await initAudio();
    previewVoice(robotVoice(state.robots[p]), translate('hello there friend').flatMap((w) => w.syllables));
  });
  $(`colors-${p}`).innerHTML = Object.entries(PALETTE)
    .map(([name, c]) => `<button class="swatch" data-color="${name}" title="${name}" style="background:${rgb(c)}"></button>`)
    .join('');
  $(`colors-${p}`).addEventListener('click', (e) => {
    const name = e.target.dataset?.color;
    if (!name || e.target.disabled) return;
    COLORS[p] = PALETTE[name];
    showPickers();
  });
});
showPickers();
$('skip-bank').addEventListener('click', () => endBank(true));
$('finish-early').addEventListener('click', () => endBank(false)); // missing sounds get guessed
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

$('write-form').addEventListener('submit', (e) => {
  e.preventDefault();
  send();
});
let lastTyping = 0;
$('message').addEventListener('input', () => {
  if (state.online && Date.now() - lastTyping > 1500) {
    lastTyping = Date.now();
    state.online.conn.send({ type: 'typing' });
  }
});
$('replay').addEventListener('click', () => (state.song ? stopSong() : startFinale()));
$('save').addEventListener('click', () => P.saveCanvas('glyph-garden', 'png'));
$('again').addEventListener('click', () => {
  if (state.online) state.online.conn.send({ type: 'again' }); // the room resets both phones
  else newDuet();
});

// ───────────────────────── online duet ─────────────────────────

// Sound on phones: has to start from a tap. On iPhone, also ask to play even
// when the ringer switch is on silent (otherwise Web Audio stays mute).
async function startAudio() {
  try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch { /* older browsers */ }
  await initAudio();
}

function openLobby(code) {
  state.online = { code, me: null, room: null, conn: null };
  try { history.replaceState(null, '', `?room=${code}`); } catch { /* ignore */ }
  show('lobby');
  $('lobby-code').textContent = code;
  $('lobby-status').textContent = 'connecting…';
  state.online.conn = connect(code, { message: onRoom, status: onConnection });
}

function shareLink() {
  return `${location.origin}${location.pathname}?room=${state.online.code}`;
}

function onConnection(status) {
  const banner = $('status');
  if (status === 'full') {
    show('title');
    banner.hidden = false;
    banner.textContent = 'that duet already has two people — start a new one';
    state.online.conn.close();
    state.online = null;
    return;
  }
  banner.hidden = status === 'connected';
  banner.textContent = status === 'reconnecting' ? 'reconnecting…' : '';
}

// Copy the room's latest picks onto this phone: voices, colours, who's here.
function applyRoom(room) {
  state.online.room = room;
  state.prompts = !!room.prompts;
  if (state.phase === 'write' || state.phase === 'their-turn') showRoundPrompt(true);
  room.players.forEach((p, i) => {
    if (!p) return;
    if (PALETTE[p.color]) COLORS[i] = PALETTE[p.color];
    const current = state.banks[i]?.robot || state.banks[i]?.instrument;
    if (current !== p.voice) state.banks[i] = robotVoice(p.voice);
  });
  const them = room.players[1 - state.online.me];
  if (state.started && them && !them.online && state.phase !== 'finale' && state.phase !== 'encore') {
    $('status').hidden = false;
    $('status').textContent = 'they left — they can come back with the same link';
  } else if (state.started) {
    $('status').hidden = true;
  }
}

function renderLobby() {
  const { room, me } = state.online;
  const them = room.players[1 - me];
  $('lobby-status').textContent = them?.online
    ? 'they’re here ✶'
    : `send them the link or the code — waiting for them to join`;
  $('me-label').textContent = me === 0 ? 'you (first)' : 'you';
  $('prompts-online').checked = !!room.prompts;
  $('prompts-online').disabled = me !== 0; // the host decides
  $('prompts-note').textContent = me === 0 ? '' : '(the host decides)';
  $('me-label').style.color = rgb(COLORS[me]);
  $('my-voice').value = room.players[me].voice;
  $('my-colors').querySelectorAll('button').forEach((btn) => {
    btn.classList.toggle('on', btn.dataset.color === room.players[me].color);
    btn.disabled = btn.dataset.color === them?.color;
  });
}

function onRoom(msg) {
  const online = state.online;
  if (!online) return;
  if (msg.type === 'welcome') {
    online.me = msg.you;
    if (!state.started) {
      state.seed = msg.room.seed;
      state.cipher = makeCipher(msg.room.seed); // same glyphs on both phones
    }
    applyRoom(msg.room);
    if (!state.started) renderLobby();
    // Rejoined mid-duet after a dropout: pick up anything we missed.
    const known = state.messages.length + state.inbox.length;
    if (state.started) msg.room.messages.slice(known).forEach((m) => onRoom({ type: 'said', ...m }));
  } else if (msg.type === 'room') {
    applyRoom(msg.room);
    if (!state.started) renderLobby();
  } else if (msg.type === 'said') {
    if (!state.started) {
      online.room.messages.push({ player: msg.player, text: msg.text });
      return;
    }
    if (state.messages.length + state.inbox.length > msg.index) return; // already have it
    state.inbox.push(msg);
    if (state.phase === 'their-turn' || state.phase === 'sending') receiveNext();
  } else if (msg.type === 'typing') {
    if (state.phase === 'their-turn') {
      $('waiting-note').textContent = 'they’re writing…';
      clearTimeout(online.typingTimer);
      online.typingTimer = setTimeout(() => {
        $('waiting-note').textContent = `message ${state.messages.length + 1} / ${TOTAL}`;
      }, 2500);
    }
  } else if (msg.type === 'reset') {
    applyRoom(msg.room);
    if (state.started) {
      newDuet(msg.room.seed);
    } else {
      state.seed = msg.room.seed;
      state.cipher = makeCipher(msg.room.seed);
      renderLobby();
    }
  }
}

// Enter the garden: catch up on anything already said, then play.
async function enterGarden() {
  await startAudio();
  state.started = true;
  state.seed = state.online.room.seed;
  state.cipher = makeCipher(state.seed);
  for (const m of state.online.room.messages) receive(m.player, m.text, true);
  if (state.messages.length >= TOTAL) setTimeout(startFinale, 1500);
  else startWriting();
}

$('host').addEventListener('click', () => openLobby(newCode()));
$('join-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const code = $('join-code').value.trim().toUpperCase();
  if (/^[A-Z0-9]{4,8}$/.test(code)) openLobby(code);
});
$('share').addEventListener('click', async () => {
  const url = shareLink();
  try {
    if (navigator.share) await navigator.share({ title: 'Glyph Garden', text: 'come write a duet with me', url });
    else {
      await navigator.clipboard.writeText(url);
      $('share').textContent = 'link copied ✓';
    }
  } catch { /* they cancelled the share sheet */ }
});
$('enter').addEventListener('click', enterGarden);
$('prompts-online').addEventListener('change', () => {
  state.online?.conn.send({ type: 'settings', prompts: $('prompts-online').checked });
});
$('prompts-local').addEventListener('change', () => { state.prompts = $('prompts-local').checked; });

// Your own pick in the lobby goes to the room, which tells the other phone.
$('my-voice').innerHTML = $('voice-0').innerHTML;
$('my-voice').addEventListener('change', async () => {
  const voice = $('my-voice').value;
  state.online?.conn.send({ type: 'settings', voice });
  await startAudio();
  previewVoice(robotVoice(voice), translate('hello there friend').flatMap((w) => w.syllables));
});
$('my-colors').innerHTML = Object.entries(PALETTE)
  .map(([name, c]) => `<button class="swatch" data-color="${name}" title="${name}" style="background:${rgb(c)}"></button>`)
  .join('');
$('my-colors').addEventListener('click', (e) => {
  const color = e.target.dataset?.color;
  if (color && !e.target.disabled) state.online?.conn.send({ type: 'settings', color });
});

// ───────────────────────── speak your message ─────────────────────────
// Uses the browser's built-in speech-to-text (Chrome, Safari on iPhone). It fills
// the box; you can fix it up before sending.
const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
let listening = null;

function stopListening() {
  listening?.stop();
  listening = null;
  $('mic').classList.remove('on');
}

if (Recognition) {
  $('mic').hidden = false;
  $('mic').addEventListener('click', () => {
    if (listening) return stopListening();
    const rec = new Recognition();
    rec.lang = navigator.language || 'en-US';
    rec.interimResults = true;
    rec.onresult = (e) => {
      $('message').value = [...e.results].map((r) => r[0].transcript).join('').slice(0, 80);
    };
    rec.onend = () => stopListening();
    rec.onerror = () => stopListening();
    rec.start();
    listening = rec;
    $('mic').classList.add('on');
    $('write-hint').textContent = 'listening… tap ● to stop';
  });
}

// Opened from a shared link? Go straight to that duet's lobby.
const roomFromLink = new URLSearchParams(location.search).get('room');
if (roomFromLink && /^[A-Za-z0-9]{4,8}$/.test(roomFromLink)) openLobby(roomFromLink.toUpperCase());

state.cipher = makeCipher(state.seed);
window.garden = state; // handy for poking around in the browser console
new p5(sketch);
