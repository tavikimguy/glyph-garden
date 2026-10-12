// Glyph Garden — the game loop (game mode: duet).
// title → (online lobby | one-screen setup) → take turns writing → interludes → the song.
// Online, both phones run this same loop; the room on the server just relays
// the messages in order, so both see the same glyphs and hear the same song.

import { translate } from './hangul.js';
import { makeCipher, encode, randomSymbol, hash, seededRandom, SYMBOLS } from './glyphs.js';
import { FORMATIONS, PATTERN_NAMES, PICTURE_NAMES } from './formations.js';
import { PICTURE_WORDS } from './pictures.js';
import { PROMPTS, openMic, startRecording, processClip, finishBank, prepareSung } from './voicebank.js';
import {
  initAudio, plink, bump, playInterlude, playFinale, previewClip, previewVoice, setClarity, setAmbient, stopAll,
  VOICE_GROUPS, robotVoice, setKey, newChimes, startJamBacking, jamTap, jamTapLocal, playJamSong, jamSoundIndex,
} from './audio.js';
import { songDNA, messageMood, STYLES } from './songdna.js';
import { promptFor } from './prompts.js';
import { connect, newCode } from './online.js';

const MAX_CHARS = 60; // per message (the room enforces the same limit)
// Game modes: how many messages each person writes, and how many messages
// make one "round" (an interlude plays after every round).
const GAME_MODES = {
  duet: { perPlayer: 4 }, // take turns, 4 each
  diary: { perPlayer: 6, round: 2 }, // just you, 6 lines, a dance every 2
  letter: { perPlayer: 4, round: 4 }, // just you, 4 lines, no dances: straight to the song, then send it
  // Party: no turns, max 2 each per round. The room decides when a round ends (once
  // everyone has a line in, or after 30 s) and tells every phone; 3 rounds (2 if 5+ people).
  party: { perRound: 2, free: true },
  jam: { free: true }, // no messages at all: phones tap glyphs onto the screen
};
const isParty = () => !!GAME_MODES[state.mode].free;
const totalMessages = () => state.order.length * (GAME_MODES[state.mode].perPlayer || 0);
const roundSize = () => GAME_MODES[state.mode].round || state.order.length;

// ── rounds ── (duet/diary: fixed sizes; party: wherever the room said rounds ended)
function roundEndsSoFar(n = state.messages.length) {
  return state.roundEnds.filter((end) => end <= n);
}
function roundStartIndex(n = state.messages.length) {
  if (!isParty()) return Math.floor(n / roundSize()) * roundSize();
  return Math.max(0, ...roundEndsSoFar(n));
}
function roundsDone(n = state.messages.length) {
  return isParty() ? roundEndsSoFar(n).length : Math.floor(n / roundSize());
}
function roundCount() {
  return isParty() ? state.partyRounds : totalMessages() / roundSize();
}
function isRoundEnd(n) {
  return isParty() ? state.roundEnds.includes(n) : n % roundSize() === 0;
}
function isGameOver(n) {
  return isParty() ? roundsDone(n) >= state.partyRounds : n >= totalMessages();
}
// Party: how many messages you've sent in the current round (the cap is 2).
function mineThisRound() {
  const me = state.online?.me;
  return state.messages.slice(roundStartIndex()).filter((m) => m.player === me).length
    + state.inbox.filter((m) => m.player === me).length;
}
// A small palette players pick from; COLORS holds each player's current pick.
const PALETTE = {
  sky: [150, 220, 255], peach: [255, 190, 150], mint: [150, 240, 200],
  lilac: [200, 175, 255], rose: [255, 155, 195], gold: [255, 215, 120],
  coral: [255, 140, 120], lime: [195, 240, 130],
};
const COLORS = Object.values(PALETTE); // per seat (up to 8 in a party)
const NAMES = Array.from({ length: 8 }, (_, i) => `Player ${i + 1}`);

const $ = (id) => document.getElementById(id);
const show = (id) => {
  for (const el of document.querySelectorAll('.panel')) el.hidden = el.id !== id;
};

const state = {
  phase: 'title',
  banks: Array(8).fill(null),
  mode: 'duet', // duet · party · diary
  order: [0, 1], // seats, in turn order
  roundEnds: [], // party: message counts where the room ended a round
  partyRounds: 3,
  danced: new Set(), // party: round ends we've already danced
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
  robots: ['marimba', 'keys'], // instrument/robot voice per player if they don't record
  formation: null, // the dance pattern between rounds
  online: null, // { code, conn, me, room } when playing a duet across two phones
  started: false, // has this phone entered the garden yet?
  inbox: [], // messages from the room waiting their turn to fly in
  spoken: null, // the recording of the message being written (if they spoke it)
  lateVoices: {}, // recordings that arrived before their message did (rejoining)
  revealed: new Set(), // letters whose real identity has been revealed (one per message)
  prompts: false, // shared-prompt mode (the host's choice online)
  seed: Math.floor(Math.random() * 2 ** 31), // this duet's seed: glyphs + prompts
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
  if (state.bankPlayer === 0 && state.mode !== 'diary') startBank(1);
  else startWriting();
}

// ───────────────────────── writing turns ─────────────────────────

function currentPlayer() {
  if (isParty()) return state.online.me; // no turns: you can always write
  return state.order[state.messages.length % state.order.length];
}

// The round's prompt sits right above the typing box (and on the "their turn" screen).
function showRoundPrompt(on) {
  const visible = on && state.prompts;
  const text = visible ? promptFor(state.seed, roundsDone()) : '';
  for (const el of document.querySelectorAll('.prompt')) {
    el.hidden = !visible;
    el.textContent = text;
  }
}

function startWriting() {
  // Let in anything that arrived meanwhile (e.g. during a dance). Stop if one of
  // them finishes a round — that starts the next dance instead.
  while (state.inbox.length) {
    if (receiveNext() === 'wait') return;
  }
  // A party round can also end with no new message (the 30-second safety net).
  if (isParty() && isRoundEnd(state.messages.length) && !state.danced.has(state.messages.length)) return beginRoundEnd();
  showRoundPrompt(true);
  const player = currentPlayer();
  if (isParty() && mineThisRound() >= GAME_MODES.party.perRound) {
    // You've said your two this round — wait for the others to fill it.
    state.phase = 'round-full';
    show('waiting');
    $('waiting-who').textContent = 'you’ve said yours this round';
    $('waiting-who').style.color = rgb(COLORS[player]);
    $('waiting-note').textContent = 'waiting for the others…';
    return;
  }
  if (state.online && player !== state.online.me) {
    state.phase = 'their-turn';
    show('waiting');
    $('waiting-who').textContent = state.mode === 'party' ? `${NAMES[player].toLowerCase()}’s turn` : 'their turn';
    $('waiting-who').style.color = rgb(COLORS[player]);
    $('waiting-note').textContent = `message ${state.messages.length + 1} / ${totalMessages()}`;
    return;
  }
  const wasWriting = state.phase === 'write';
  state.phase = 'write';
  show('write');
  $('write-who').textContent = isParty() ? 'say anything — into the void'
    : state.online ? 'your turn'
      : state.mode === 'diary' ? 'dear diary…'
        : state.mode === 'letter' ? (state.writingIn ? 'write back…' : 'dear you…') : `${NAMES[player]}, say something`;
  $('write-who').style.color = rgb(COLORS[player]);
  if (!wasWriting) {
    // a fresh message (in a party, a half-typed one survives other people's words)
    $('message').value = '';
    state.spoken = null;
    $('mic').classList.remove('voiced');
    $('write-hint').classList.remove('show');
    $('write-hint').textContent = 'enter to send';
  }
  updateCount();
  $('message').style.caretColor = rgb(COLORS[player]);
  if (!matchMedia('(pointer: coarse)').matches) $('message').focus(); // don't pop the phone keyboard uninvited
}

async function send() {
  if (state.phase !== 'write') return;
  await stopSpeaking(); // tapped send mid-sentence? keep what was recorded
  const text = cleanText($('message').value);
  if (!/[a-z0-9]/i.test(text)) {
    $('write-hint').textContent = 'Try some words.';
    return;
  }
  $('write-hint').textContent = 'enter to send';
  if (state.online) {
    // Send it to the room; it comes back to both phones as 'said', in order.
    const voice = state.spoken ? await encodeVoice(state.spoken.blob) : undefined;
    state.online.conn.send({ type: 'say', text, voice });
    if (isParty()) {
      // No turns: clear the box and keep going; your words come back from the room.
      $('message').value = '';
      state.spoken = null;
      $('mic').classList.remove('voiced');
      $('write-hint').classList.remove('show');
      updateCount();
      return;
    }
    state.phase = 'sending';
    show(null);
    return;
  }
  receive(currentPlayer(), text, false, state.spoken);
  // Add its words to the shared word log (online, the room does this itself).
  fetch('/api/words', { method: 'POST', body: JSON.stringify({ text }) }).catch(() => {});
}

// Phones "smarten" punctuation: "..." becomes one "…" character, quotes curl.
// Turn them back into plain characters so every dot/dash becomes its own glyph.
function cleanText(raw) {
  return raw
    .replace(/…/g, '...').replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, '-')
    .trim().replace(/\s+/g, ' ').slice(0, MAX_CHARS);
}

// A message enters the space: its glyphs are thrown in, then the game moves on.
// quiet = catching up after (re)joining: no interlude, just put the glyphs in.
function receive(player, text, quiet = false, voice = null) {
  // Each word keeps its sounds (for singing) next to its letters (for glyphs).
  const words = text.split(' ').map((word) => ({
    word,
    syllables: translate(word).flatMap((w) => w.syllables),
  }));
  const msg = { player, text, words };
  state.messages.push(msg);
  const late = state.lateVoices[state.messages.length - 1];
  if (voice || late) attachVoice(msg, voice || late);
  setKey(songDNA(state.messages)); // the space drifts into the conversation's key
  const landing = spawnMessage(msg, state.messages.length - 1);
  revealLetter(text, quiet ? 0 : landing + 400);
  if (quiet) return;
  const n = state.messages.length;
  if (isParty() && !isRoundEnd(n)) {
    // Mid-round: words just drift in; you keep writing (or waiting) as you were.
    if (state.phase === 'write') updateCount();
    return 'drift';
  }
  if (isParty()) state.danced.add(n);
  state.phase = 'wait';
  show(null);
  setTimeout(afterSend, landing + 900);
  return 'wait'; // a round (or the duet's turn) is done — the next step takes over
}

// A party round ended with nothing new to land (e.g. the 30-second safety net).
function beginRoundEnd() {
  state.danced.add(state.messages.length);
  state.phase = 'wait';
  show(null);
  setTimeout(afterSend, 600);
  return 'wait';
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
    .map((l) => `<span class="${l === fresh ? 'new' : ''}">${escapeHtml(state.cipher[l])}${TEXT_STYLE}<b>${l}</b></span>`)
    .join('');
}

// Returns 'wait' if that message finished a round (so a dance/turn change is coming).
function receiveNext() {
  const { player, text, voice } = state.inbox.shift();
  return receive(player, text, false, voice);
}

// ── a spoken message's recording ──
// voice = { audio } (recorded on this phone) or { data, mime } (sent through the room).
async function attachVoice(msg, voice) {
  try {
    const audio = voice.audio || await decodeVoice(voice);
    const count = msg.words.reduce((n, w) => n + w.syllables.length, 0);
    msg.sung = prepareSung(audio, count); // ready for the interlude and the song
  } catch (err) {
    console.warn('could not use that recording', err);
  }
}

function encodeVoice(blob) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve({ data: String(reader.result).split(',')[1], mime: blob.type || 'audio/webm' });
    reader.onerror = () => resolve(undefined);
    reader.readAsDataURL(blob);
  });
}

async function decodeVoice({ data, mime }) {
  const bytes = await (await fetch(`data:${mime};base64,${data}`)).arrayBuffer();
  return Tone.getContext().rawContext.decodeAudioData(bytes);
}

function afterSend() {
  const n = state.messages.length;
  if (isGameOver(n)) return startFinale();
  if (!isRoundEnd(n)) return startWriting();

  // A round is done: play the strange, half-heard interlude.
  state.phase = 'interlude';
  const round = roundsDone(n);
  const rounds = roundCount();
  const from = roundStartIndex(n - 1);
  const items = [];
  for (let m = from; m < n; m++) {
    const message = state.messages[m];
    let k = 0;
    message.words.forEach((w, wi) => {
      const glyphs = glyphsOf(m, wi);
      w.syllables.forEach((syl) => items.push({ syl, player: message.player, glyphs, message, n: k++ }));
    });
  }
  // A party round has 4 people's words: play a spread-out sample of ~16 syllables
  // (a bit of everyone) so the interlude stays around 4–5 seconds.
  const heard = isParty() && items.length > 16 ? items.filter((_, i) => i % Math.ceil(items.length / 16) === 0) : items;
  // Duet: what each of you said, decoded, appears as it's heard.
  const lines = state.mode === 'duet' ? showInterludeLines(state.messages.slice(from, n)) : null;
  const seconds = playInterlude(heard, state.banks, (round / rounds) * 0.7, (item) => {
    item.glyphs.forEach((g) => { g.flash = 1; });
    lines?.get(item.message)?.classList.add('on');
  });
  // Two dances, max (see interludeDances for the rules).
  const { dances, golden } = interludeDances(state.messages.slice(from, n), round);
  startFormation(dances[0], `interlude${round}a`, golden === 0);
  setTimeout(() => {
    if (state.phase === 'interlude') startFormation(dances[1], `interlude${round}b`, golden === 1);
  }, seconds * 1000 * 0.45);
  setTimeout(() => {
    endFormation();
    $('interlude-lines').hidden = true;
    startWriting();
  }, seconds * 1000);
}

// The round's messages as plain text, each in its writer's colour. Returns message → line,
// so each line can fade in when its sounds start playing.
function showInterludeLines(messages) {
  const list = $('interlude-lines');
  list.innerHTML = '';
  const lines = new Map();
  for (const m of messages) {
    const li = document.createElement('li');
    li.textContent = m.text;
    li.style.color = rgb(COLORS[m.player]);
    list.append(li);
    lines.set(m, li);
  }
  list.hidden = false;
  return lines;
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
  startFormation(danceFor('pattern', 3), 'finale');
  state.dna = songDNA(state.messages, { style: state.styleOverride }); // (the override is only the sound preview's)
  const song = playFinale(state.messages, state.banks, state.dna, {
    onMessage(m, pass) {
      if (state.focus >= 0) decode(state.focus, Infinity);
      state.focus = m; // its glyphs light up where they are; the lyric shows centre stage
      // The dance follows the words: a line with a picture word ("a big cat!") dances
      // that picture; other lines get patterns — a new one every two lines, or right
      // away if a picture from the last line would otherwise linger.
      const pictures = picturesIn(state.messages[m]);
      const showingPicture = !!PICTURE_WORDS[state.formation?.name];
      if (pictures.length) {
        startFormation(pictures[pictures.length - 1], `song${pass}-${m}`);
      } else if (m % 2 === 0 || showingPicture) {
        startFormation(danceFor('pattern', 4 + pass * 8 + m), `song${pass}-${m}`);
      }
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
  if (state.preview) return; // the sound preview keeps its own panel
  state.phase = 'encore';
  show('end');
  $('end-lyrics-box').hidden = false;
  $('replay').textContent = 'stop';
  const d = state.dna;
  const secrets = d.secrets.length;
  $('end-recipe').textContent = [
    `${d.style}`, `${d.keyName} · ${d.feel}`, `${d.bpm} bpm`, `${d.kit} drums, ${d.pattern} beat`, `${d.lead} + ${d.pad}`,
  ].join('  ·  ');
  $('end-secrets').textContent = secrets ? `✶ you found ${secrets} secret word${secrets > 1 ? 's' : ''}` : '';
  $('end-lyrics').innerHTML = state.messages
    .map((m) => `<li style="color:${rgb(COLORS[m.player])}">${escapeHtml(m.text)}</li>`)
    .join('');
  const letter = state.mode === 'letter';
  const reading = letter && state.readingIndex !== null && state.readingIndex !== undefined;
  const lastIsMine = state.thread ? isMine(state.thread.letters.at(-1)) : true;
  $('letter-send').hidden = !letter || reading;
  $('letter-reply').hidden = !reading || lastIsMine; // write back when they wrote last
  $('letter-back').hidden = !letter || !state.thread;
  $('again').hidden = letter;
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

function newDuet(seed) {
  resetGarden(seed);
  startWriting();
}

function resetGarden(seed = Math.floor(Math.random() * 2 ** 31)) {
  stopAll();
  $('interlude-lines').hidden = true;
  state.seed = seed;
  state.revealed = new Set();
  showKey();
  state.song = null;
  state.focus = -1;
  setAmbient(true);
  newChimes();
  state.cipher = makeCipher(seed);
  state.inbox = [];
  state.roundEnds = [];
  state.danced = new Set();
  state.messages = [];
  state.glyphs = [];
  state.ripples = [];
  state.formation = null;
  setKey(songDNA([]));
}

// ───────────────────────── glyphs in space ─────────────────────────

let P = null; // the p5 instance

// Throw a message in from the player's side: Player 1 sprays in from the left,
// Player 2 from the right. Physics takes it from there.
// Returns ms until the spray has settled into drifting.
function spawnMessage(msg, m) {
  // Wide screens: player 1 from the left, player 2 from the right.
  // Tall phone screens: your words rise from the bottom, theirs fall from the top.
  const portrait = P.height > P.width;
  const mine = state.online ? msg.player === state.online.me : msg.player === state.order[0];
  const fromLeft = state.order.indexOf(msg.player) % 2 === 0;
  const fromBottom = mine;
  const origin = portrait ? P.width * (0.25 + Math.random() * 0.5) : P.height * (0.25 + Math.random() * 0.5);
  const aim = (Math.random() - 0.5) * 0.5; // the whole throw angles a little
  const now = P.millis();

  let wi = 0;
  let order = 0;
  [...msg.text].forEach((ch, col) => {
    if (ch === ' ') { wi++; return; }
    const angle = aim + (Math.random() - 0.5) * 0.6;
    const speed = (portrait ? 0.75 : 1) * (380 + Math.random() * 420);
    const spread = (Math.random() - 0.5) * 60;
    const start = portrait
      ? { x: origin + spread, y: fromBottom ? P.height + 20 : -20 }
      : { x: fromLeft ? -20 : P.width + 20, y: origin + spread };
    const dirX = portrait ? Math.sin(angle) : Math.cos(angle) * (fromLeft ? 1 : -1);
    const dirY = portrait ? Math.cos(angle) * (fromBottom ? -1 : 1) : Math.sin(angle);
    state.glyphs.push({
      ch,
      sym: encode(state.cipher, ch),
      player: msg.player,
      msg: m,
      wi,
      col,
      len: msg.text.length,
      x: start.x,
      y: start.y,
      vx: dirX * speed,
      vy: dirY * speed,
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

function glyphSize() {
  return Math.max(18, Math.min(30, Math.min(P.width, P.height) * 0.032));
}

// Centre stage during the song: the message being sung, big, wrapped onto as
// many lines as it needs (shrinking a little if it's long), like song lyrics.
const STAGE_SCALE = 1.6;
let stageCache = null;

function stageLayout(m) {
  const key = `${m}:${P.width}:${P.height}`;
  if (stageCache?.key === key) return stageCache;
  const text = state.messages[m].text;
  let size = glyphSize() * STAGE_SCALE;
  let lines;
  for (;;) {
    const perLine = Math.max(4, Math.floor((P.width * 0.88) / (size * 0.68)));
    lines = wrapWords(text, perLine);
    if (lines.length * size * 1.3 <= P.height * 0.5 || size <= 16) break;
    size *= 0.9;
  }
  const charW = size * 0.68;
  const lineH = size * 1.3;
  const pos = {};
  lines.forEach((line, li) => {
    const y = P.height / 2 + (li - (lines.length - 1) / 2) * lineH;
    line.cols.forEach((col, i) => {
      pos[col] = { x: P.width / 2 + (i - (line.cols.length - 1) / 2) * charW, y };
    });
  });
  stageCache = { key, size, pos };
  return stageCache;
}

// Greedy word wrap. Returns lines as lists of character positions in the text;
// a word longer than a whole line gets split.
function wrapWords(text, perLine) {
  const lines = [];
  let cols = [];
  let col = 0;
  for (const word of text.split(' ')) {
    const wordCols = [...word].map((_, i) => col + i);
    col += [...word].length + 1;
    for (let start = 0; start < wordCols.length; start += perLine) {
      const piece = wordCols.slice(start, start + perLine);
      if (cols.length && cols.length + 1 + piece.length > perLine) {
        lines.push({ cols });
        cols = [];
      }
      if (cols.length) cols.push(null); // the space between words
      cols.push(...piece);
    }
  }
  if (cols.length) lines.push({ cols });
  // turn space placeholders into real gaps
  return lines.map((line) => ({ cols: line.cols.map((c, i) => (c === null ? `gap${i}` : c)) }));
}

function stageOf(g) {
  return stageLayout(g.msg).pos[g.col] || { x: P.width / 2, y: P.height / 2 };
}

// Between rounds the glyphs band together into a moving pattern or a picture
// (see formations.js and pictures.js). Which one plays in each slot comes from
// the duet's seed and the words said — never from this phone's own randomness —
// so both screens (even one that joined late) dance the same dance.
// Patterns use even slots for "first" dances and odd slots for "second" ones, so a
// second dance is never a repeat of the first (e.g. when no picture word was said).
function danceFor(kind, slot) {
  if (kind === 'picture') {
    const earned = earnedPictures();
    if (earned.length) return earned[earned.length - 1 - (slot % earned.length)]; // newest first
  }
  const rand = seededRandom(state.seed ^ 0xda);
  const order = PATTERN_NAMES.map((name) => [rand(), name]).sort((a, b) => a[0] - b[0]).map(([, name]) => name);
  return order[(slot * 2 + (kind === 'picture' ? 1 : 0)) % order.length];
}

// The picture words in one message, in the order said ("I love cats" → heart, cat).
function picturesIn(message) {
  const found = [];
  for (const word of message.text.toLowerCase().match(/[a-z']+/g) || []) {
    const name = Object.keys(PICTURE_WORDS).find((pic) => PICTURE_WORDS[pic].includes(word));
    if (name && !found.includes(name)) found.push(name);
  }
  return found;
}

// The interlude's two dances:
//  · both people earned a picture → their picture, then the other's (no pattern)
//  · otherwise → a pattern, then ONE picture:
//      a picture 2+ of you said wins (and glows gold), else the one said last
//  · no picture words → a pattern, then another pattern
// Pictures that miss out aren't lost: the finale works through all of them.
function interludeDances(roundMessages, round) {
  const per = roundMessages.map(picturesIn);
  const shared = per.flat().find((pic) => per.filter((list) => list.includes(pic)).length >= 2) || null;
  const lastSaid = (list) => list[list.length - 1];
  if (roundMessages.length === 2 && per[0].length && per[1].length && !shared) {
    return { dances: [lastSaid(per[0]), lastSaid(per[1])], golden: -1 };
  }
  const all = per.flat();
  const pick = shared || lastSaid(all);
  return {
    dances: [danceFor('pattern', round - 1), pick || danceFor('picture', round - 1)],
    golden: shared ? 1 : -1,
  };
}

// Pictures someone has "earned" by saying their word (cat, moon, love…), in the order first said.
function earnedPictures(messages = state.messages) {
  const earned = [];
  for (const m of messages) {
    for (const word of m.text.toLowerCase().match(/[a-z']+/g) || []) {
      const name = Object.keys(PICTURE_WORDS).find((pic) => PICTURE_WORDS[pic].includes(word));
      if (name && !earned.includes(name)) earned.push(name);
    }
  }
  return earned;
}

// Colour words: say "blue" and the next shape is dyed blue — and stays blue.
const COLOR_WORDS = {
  red: [255, 90, 90], crimson: [220, 40, 70], orange: [255, 160, 70], yellow: [255, 230, 90],
  gold: [255, 205, 80], green: [110, 230, 120], lime: [180, 255, 90], teal: [70, 210, 190],
  turquoise: [80, 230, 210], cyan: [90, 230, 255], blue: [90, 150, 255], navy: [90, 110, 220],
  indigo: [120, 100, 255], purple: [180, 110, 255], violet: [200, 130, 255], lavender: [200, 180, 255],
  pink: [255, 140, 200], magenta: [255, 80, 220], brown: [190, 130, 90], white: [250, 250, 255],
  silver: [200, 210, 225], grey: [150, 155, 170], gray: [150, 155, 170], black: [95, 95, 110],
  rainbow: 'rainbow',
};

// The most recent colour word said in the conversation (or null).
function latestColor() {
  for (let i = state.messages.length - 1; i >= 0; i--) {
    const words = state.messages[i].text.toLowerCase().match(/[a-z]+/g) || [];
    for (let j = words.length - 1; j >= 0; j--) if (COLOR_WORDS[words[j]]) return COLOR_WORDS[words[j]];
  }
  return null;
}

function hueToRgb(h) {
  const f = (n) => {
    const k = (n + h / 30) % 12;
    return Math.round(255 * (0.65 - 0.35 * Math.max(-1, Math.min(k - 3, 9 - k, 1))));
  };
  return [f(0), f(8), f(4)];
}

// A glyph's colour: its dye if a picture coloured it, else its player's colour.
// The colour a glyph is showing: it glides toward its wanted colour (below) instead of
// jumping, so a picture's paint arrives as the glyphs fly into the shape, not before.
function tintOf(g, now) {
  return g.shade || wantedTint(g, now);
}

function fadeTint(g, dt, now) {
  const want = wantedTint(g, now);
  if (!g.shade) { g.shade = [...want]; return; }
  const k = Math.min(1, dt * 2.2);
  for (let i = 0; i < 3; i++) g.shade[i] += (want[i] - g.shade[i]) * k;
}

function wantedTint(g, now) {
  if (state.formation?.golden && g.mode === 'form') return [255, 215, 120];
  if (g.paint && g.mode === 'form') return g.paint; // a picture painting its parts (olive green, pit red)
  if (g.tint === 'rainbow') return hueToRgb((g.fi * 9 + now / 25) % 360);
  return g.tint || COLORS[g.player];
}

// slot = a name for this moment ("interlude2b", "song0-4"); with the seed it
// fixes the dance's settings so every phone rolls the same ones.
function startFormation(name, slot, golden = false) {
  const counts = [0, 0];
  const msgSize = [];
  state.glyphs.forEach((g, i) => {
    g.fi = i;
    g.paint = null; // only a picture paints; it sets this again every frame
    g.side = (isParty() ? g.player : state.order.indexOf(g.player)) % 2; // two groups, alternating
    g.fj = counts[g.side]++;
    g.fm = msgSize[g.msg] || 0;
    msgSize[g.msg] = g.fm + 1;
    if (g.mode !== 'stage') g.mode = 'form';
  });
  const dye = latestColor();
  if (dye) state.glyphs.forEach((g) => { g.tint = dye; }); // the shape takes the colour, for good
  state.formation = {
    golden, // you both said this picture's word: it glows gold
    name,
    pattern: FORMATIONS[name],
    params: FORMATIONS[name].setup(seededRandom(hash(`${state.seed}:${slot}:${name}`))),
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
    fadeTint(g, dt, now);
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
      if (!g.entered && g.x > 14 && g.x < W - 14 && g.y > 14 && g.y < H - 14) g.entered = true;
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
    } else if (g.mode === 'jam') {
      // Jam: fly in, then hold your place in your player's drifting shape.
      const k = Math.min(1, dt * 2.2);
      g.vx += ((g.tx - g.x) * 2.5 - g.vx) * k;
      g.vy += ((g.ty - g.y) * 2.5 - g.vy) * k;
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
          color: [...tintOf(a, now)], strength: 0.5 + strength * 0.5, rings: 2,
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
const TEXT_STYLE = '\uFE0E'; // asks phones to draw a symbol as plain text, never as an emoji
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
    p.createCanvas(window.innerWidth, appHeight).parent('stage');
    p.textFont('JetBrains Mono'); // loaded in index.html
    p.textAlign(p.CENTER, p.CENTER);
    for (let i = 0; i < 220; i++) {
      state.stars.push({ x: Math.random(), y: Math.random(), r: Math.random() * 1.4 + 0.3, t: Math.random() * 10 });
    }
  };

  p.windowResized = () => {
    if (keyboardUp()) return; // a keyboard opening isn't a resize: the garden keeps its full height
    appHeight = window.innerHeight;
    document.documentElement.style.setProperty('--app-h', `${appHeight}px`);
    p.resizeCanvas(window.innerWidth, appHeight);
  };

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

    if (state.phase === 'jam') updateJamGroups(dt, t, now);
    updateGlyphs(dt, t, now);

    // Faint threads between neighbouring letters of the same word, while they're close.
    p.strokeWeight(1);
    for (let i = 1; i < state.glyphs.length; i++) {
      const a = state.glyphs[i - 1];
      const b = state.glyphs[i];
      if (a.msg !== b.msg || a.wi !== b.wi || now < a.born || now < b.born) continue;
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (d > size * 5) continue;
      p.stroke(...tintOf(b, now), 30 * (1 - d / (size * 5)) * alphaOf(b));
      p.line(a.x, a.y, b.x, b.y);
    }

    drawRipples(p, now);

    p.noStroke();
    const pulse = beatPulse();
    for (const g of state.glyphs) {
      if (now < g.born) continue;
      const decoded = g.decodeAt !== null && now >= g.decodeAt + SCRAMBLE_MS && !g.tint;
      // Decoded letters keep their colour, a little brighter (a picture's paint stays exact),
      // so an olive stays green and red all song long, every time round.
      const lift = decoded && !(g.paint && g.mode === 'form') ? 0.35 : 0;
      const [r, gg, b] = tintOf(g, now).map((c) => c + (255 - c) * lift);
      const glow = Math.max(g.flash, decoded ? 0.35 : 0);
      ctx.shadowBlur = glow > 0.05 && !SMALL_SCREEN ? 6 + glow * 18 : 0; // glow is costly on phones
      ctx.shadowColor = `rgba(${r}, ${gg}, ${b}, ${0.8 * glow})`;
      p.fill(r, gg, b, 255 * alphaOf(g));
      const scale = 1 + pulse * 0.18;
      // Feelings leak through: happy glyphs hop, excited ones spin, sad ones dim and shrink.
      let hop = 0;
      let spin = 0;
      let shrink = 1;
      if (g.mode !== 'stage') {
        if (g.mood === 'happy') hop = -Math.abs(Math.sin(t * 3.2 + g.seed)) * size * 0.35;
        else if (g.mood === 'excited') spin = t * 2.5 + g.seed;
        else if (g.mood === 'sad') {
          shrink = 0.88;
          p.fill(r, gg, b, 150 * alphaOf(g));
        }
      }
      p.textSize(size * scale * shrink * (1 + g.flash * 0.35));
      p.push();
      p.translate(g.x, g.y + hop);
      if (spin) p.rotate(spin);
      p.text(face(g, now) + TEXT_STYLE, 0, 0);
      p.pop();
      g.flash *= 0.93;
    }
    ctx.shadowBlur = 0;
    drawLyric(p, now);
  };
}

// During the song, the message being sung is bright and the rest a little dimmer
// (not too dim — they still have to draw the shape).
function alphaOf(g) {
  if (state.focus < 0) return 0.9;
  return g.msg === state.focus ? 1 : 0.6;
}

// The lyric being sung, as readable text in the middle (wrapped onto lines),
// decoding letter by letter in sync with the glyphs out in the shape.
function drawLyric(p, now) {
  if (!state.song || state.focus < 0) return;
  const layout = stageLayout(state.focus);
  const ctx = p.drawingContext;
  p.textSize(layout.size);
  ctx.shadowBlur = SMALL_SCREEN ? 0 : 14;
  for (const g of glyphsOf(state.focus)) {
    const { x, y } = layout.pos[g.col] || {};
    if (x === undefined) continue;
    const [r, gg, b] = tintOf(g, now);
    ctx.shadowColor = `rgba(${r}, ${gg}, ${b}, 0.6)`;
    const decoded = g.decodeAt !== null && now >= g.decodeAt + SCRAMBLE_MS;
    p.fill(decoded ? 250 : r, decoded ? 250 : gg, decoded ? 252 : b, 255);
    p.text(face(g, now) + TEXT_STYLE, x, y);
  }
  ctx.shadowBlur = 0;
}

// ───────────────────────── wiring ─────────────────────────

function rgb([r, g, b]) {
  return `rgb(${r}, ${g}, ${b})`;
}

function escapeHtml(s) {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
}

$('local').addEventListener('click', () => {
  state.mode = 'duet';
  state.order = [0, 1];
  showLocalSetup();
});
function showLocalSetup() {
  const solo = state.mode === 'diary' || state.mode === 'letter';
  $('local-mode').textContent = state.mode === 'letter' ? (state.writingIn ? 'letter · writing back' : 'letter') : solo ? 'diary' : 'duet · one screen';
  $('local-p2').hidden = solo;
  $('player-0').textContent = solo ? 'you' : 'player 1';
  $('begin').textContent = solo ? 'record your own voice instead' : 'record your own voices instead';
  $('begin').hidden = state.mode === 'letter'; // a letter carries your words, not recordings
  showPickers();
  show('local-setup');
}
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
      btn.disabled = state.mode !== 'diary' && state.mode !== 'letter' && PALETTE[btn.dataset.color] === COLORS[1 - p]; // solo: no one else
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
// "message 3/8 · 12/60" under the box; turns gold near the limit.
function updateCount() {
  const used = cleanText($('message').value).length;
  $('write-count').textContent = isParty()
    ? `round ${Math.min(state.partyRounds, roundsDone() + 1)}/${state.partyRounds} · you ${mineThisRound()}/${GAME_MODES.party.perRound} · ${used}/${MAX_CHARS}`
    : `message ${state.messages.length + 1}/${totalMessages()} · ${used}/${MAX_CHARS}`;
  $('write-count').classList.toggle('near', used >= MAX_CHARS - 10);
}

$('message').addEventListener('input', () => {
  updateCount();
  if (state.online && Date.now() - lastTyping > 1500) {
    lastTyping = Date.now();
    state.online.conn.send({ type: 'typing' });
  }
});
// ───────────────────────── pattern viewer (dev only: /?patterns on localhost) ─────────────────────────
// Every dance and picture, one click each, with real glyphs in motion. ← → to step through.
function openPatternViewer() {
  resetGarden(12345);
  state.mode = 'duet';
  state.order = [0, 1];
  state.phase = 'gallery';
  show(null);
  const names = [...PATTERN_NAMES, ...PICTURE_NAMES];
  const panel = document.createElement('div');
  panel.id = 'pattern-viewer';
  panel.innerHTML = `<p class="quiet-text">patterns · ← → to step · <label><input type="checkbox" id="pv-gold"> gold</label> · glyphs
    <select id="pv-count"><option>40</option><option selected>80</option><option>140</option></select></p>
    <div>${names.map((n) => `<button data-name="${n}" class="${PICTURE_NAMES.includes(n) ? 'pic' : ''}">${n}</button>`).join('')}</div>`;
  document.body.append(panel);
  let current = 0;
  let take = 0;
  const fill = (count) => {
    state.glyphs = [];
    state.messages = Array.from({ length: 4 }, (_, m) => ({ player: m % 2, text: '', words: [] }));
    for (let i = 0; i < count; i++) {
      const m = i % 4;
      state.glyphs.push({
        ch: 'x', sym: SYMBOLS[(i * 7) % SYMBOLS.length], player: m % 2, msg: m, wi: 0, col: i, len: count,
        x: Math.random() * P.width, y: Math.random() * P.height, vx: 0, vy: 0,
        mode: 'free', entered: true, launched: true, born: 0, flash: 0, decodeAt: null,
        quietUntil: Infinity, seed: Math.random() * 1000, mood: 'calm', revealAt: null,
      });
    }
  };
  const play = (i) => {
    current = (i + names.length) % names.length;
    panel.querySelectorAll('button').forEach((b, k) => b.classList.toggle('on', k === current));
    startFormation(names[current], `gallery${take++}`, $('pv-gold').checked);
  };
  fill(80);
  play(0);
  panel.addEventListener('click', (e) => { if (e.target.dataset.name) play(names.indexOf(e.target.dataset.name)); });
  $('pv-count').addEventListener('change', () => { fill(Number($('pv-count').value)); play(current); });
  $('pv-gold').addEventListener('change', () => play(current));
  addEventListener('keydown', (e) => {
    if (e.key === 'ArrowRight') play(current + 1);
    if (e.key === 'ArrowLeft') play(current - 1);
  });
}

// ───────────────────────── sound preview (dev only: /?sounds on localhost) ─────────────────────────
// Hear every style with the same words: a real finale (glyphs, voices, band), style forced.
// "new words" swaps the lines and the two instruments, so you hear how the dice vary inside a style.
const DEMO_LINES = [
  ['hey are you up', 'yeah just thinking about stuff', 'like what', 'how fast this year went'],
  ['i made soup today', 'what kind', 'the green kind', 'save me some please'],
  ['look outside right now', 'the sky is pink', 'wish you were here', 'me too honestly'],
  ['did you get my note', 'i did it made me smile', 'good thats the point', 'call me later ok'],
];
function openSoundPreview() {
  resetGarden(777);
  state.mode = 'duet';
  state.order = [0, 1];
  state.phase = 'sounds';
  state.preview = true;
  show(null);
  const names = Object.keys(STYLES);
  const panel = document.createElement('div');
  panel.id = 'pattern-viewer';
  panel.innerHTML = `<p class="quiet-text">sound styles · tap one to hear it (loops) · <button id="sp-words">new words</button> <button id="sp-stop">stop</button></p>
    <div>${names.map((n) => `<button data-style="${n}">${n}</button>`).join('')}</div>
    <p id="sp-info" class="quiet-text" style="margin-top:6px"></p>`;
  document.body.append(panel);
  let take = 0;
  let current = null;
  const instruments = VOICE_GROUPS.instruments;
  let voices = ['marimba', 'keys'];
  const play = async (style) => {
    current = style;
    panel.querySelectorAll('[data-style]').forEach((b) => b.classList.toggle('on', b.dataset.style === style));
    await startAudio();
    resetGarden(1000 + take);
    state.phase = 'sounds';
    state.robots = [...voices];
    state.banks = voices.map(robotVoice);
    DEMO_LINES[take % DEMO_LINES.length].forEach((text, i) => receive(i % 2, text, true));
    state.styleOverride = style;
    startFinale();
    const d = state.dna;
    $('sp-info').textContent = [`${d.style}`, `${d.meterName}`, `${d.bpm} bpm`, `${d.keyName} (${d.feel})`,
      `sung: ${d.rhythm} rhythm, ${d.contour} melody`, `voices: ${voices.join(' + ')}${d.voiceColour ? ` (${d.voiceColour})` : ''}${d.harmony ? ` + ${d.harmony} harmony` : ''}`,
      `${d.kit} drums, ${d.pattern} beat`, `${d.lead} lead, ${d.pad} pad (${d.padMode})`, `${d.bass} bass (${d.bassStyle})`,
      d.swing ? `swing ${d.swing.toFixed(2)}` : 'straight', `reverb ${d.space}`, d.tone || ''].filter(Boolean).join('  ·  ');
  };
  panel.addEventListener('click', (e) => { if (e.target.dataset.style) play(e.target.dataset.style); });
  $('sp-words').addEventListener('click', () => {
    take++;
    voices = [0, 1].map(() => instruments[Math.floor(Math.random() * instruments.length)]);
    if (current) play(current);
  });
  $('sp-stop').addEventListener('click', () => { stopSong(); current = null; panel.querySelectorAll('[data-style]').forEach((b) => b.classList.remove('on')); });
}

// ───────────────────────── letters ─────────────────────────
// A letter is a conversation with one link. You write 4 lines, hear them as a song, and
// send the link; they open it, hear the same song (same seed → same glyphs, same music) and
// write back into the same conversation. Anyone with the link can come back any time and
// see what's new. Each device makes itself a random id so it knows which letters were its own.

const deviceId = (() => {
  try {
    let id = localStorage.getItem('glyph-device');
    if (!id) {
      id = crypto.randomUUID().replace(/-/g, '').slice(0, 20);
      localStorage.setItem('glyph-device', id);
    }
    return id;
  } catch {
    return `anon${Math.random().toString(36).slice(2, 12)}`; // private mode: just for this visit
  }
})();
const letterLink = (id) => `${location.origin}${location.pathname}?letter=${id}`;
const isMine = (letter) => letter.author === deviceId || (!!me && letter.from === me.handle);

// ── your inbox: a name + one secret word (no email, no password) ──
// The word is picked here, shown to you, and kept on this phone so you stay signed in.
// The server only keeps a salted fingerprint of it, to check it.
const SECRET_WORDS = 'moss fern leaf seed root bloom petal stem vine reed pine oak elm ash birch maple cedar willow ivy clover daisy lily rose tulip poppy lotus iris violet lilac sage mint thyme basil olive plum pear peach apple berry cherry lemon lime mango melon fig date grape kiwi cocoa honey sugar salt pepper toast bread cake pie jam tea milk cream butter cheese soup rice bean corn wheat oat barley rain snow hail mist fog dew frost storm cloud sky sun moon star comet orbit nova dawn dusk noon night ember spark flame smoke coal stone pebble sand dune shore wave tide reef coral shell pearl river creek brook lake pond pool bay cove cliff hill peak vale glen field meadow grove forest cave canyon delta island marsh swamp desert tundra prairie fox wolf bear deer elk moose hare rabbit otter beaver badger mole owl hawk crow robin wren finch swan duck goose heron crane stork gull puffin seal whale shark squid crab shrimp eel trout salmon koi frog toad newt snail slug bee wasp ant moth beetle cricket firefly spider lizard turtle panda koala lemur sloth tiger lion lynx puma zebra camel llama yak goat sheep lamb pony horse mule donkey kitten puppy piglet chick lantern candle kettle teapot cup bowl spoon fork plate basket rope knot thread needle button ribbon velvet silk wool cotton linen paper ink quill brush paint chalk crayon marble domino puzzle kite yoyo drum flute harp bell gong chime piano violin cello banjo whistle anchor sail oar raft canoe ferry'.split(' ');
const makePhrase = () => SECRET_WORDS[crypto.getRandomValues(new Uint8Array(1))[0]];
const cleanName = (text) => text.trim().toLowerCase().replace(/^@/, '').replace(/\s+/g, '_');
const cleanPhrase = (text) => text.toLowerCase().replace(/[^a-z]+/g, ' ').trim();
let me = (() => { try { return JSON.parse(localStorage.getItem('glyph-me') || 'null'); } catch { return null; } })();
function saveMe(next) {
  me = next;
  try { if (me) localStorage.setItem('glyph-me', JSON.stringify(me)); else localStorage.removeItem('glyph-me'); } catch { /* ok */ }
}
const signed = () => (me ? { 'x-handle': me.handle, 'x-phrase': me.phrase } : {});
// How many letters of each conversation you've seen (so new ones can glow).
const seenCounts = () => { try { return JSON.parse(localStorage.getItem('glyph-seen') || '{}'); } catch { return {}; } };
function markSeen(id, count) {
  try { localStorage.setItem('glyph-seen', JSON.stringify({ ...seenCounts(), [id]: count })); } catch { /* ok */ }
}
const inboxNote = (text) => { $('inbox-note').textContent = text; };

async function renderLetterTab() {
  $('inbox-out').hidden = !!me;
  $('inbox-in').hidden = !me;
  $('my-letters').hidden = !!me;
  if (!me) return renderMyLetters();
  $('me-handle').textContent = `@${me.handle}`;
  $('inbox-list').innerHTML = '<p class="quiet-text">opening your inbox…</p>';
  try {
    const res = await fetch('/api/inbox', { headers: signed() });
    if (res.status === 401) { saveMe(null); inboxNote('your secret word stopped working — open your inbox again'); return renderLetterTab(); }
    const { inbox } = await res.json();
    const seen = seenCounts();
    $('inbox-list').innerHTML = inbox.length ? inbox.map((e) => {
      const who = e.with.length ? e.with.map((h) => `@${escapeHtml(h)}`).join(', ') : 'via link'; // a letter sent as a link
      const theirs = e.lastFrom !== me.handle;
      const fresh = theirs && e.count > (seen[e.thread] || 0);
      const what = fresh ? 'new letter ✉' : theirs ? `“${escapeHtml(e.line)}”` : 'waiting for their reply';
      return `<button data-id="${escapeHtml(e.thread)}" class="${fresh ? 'new' : ''}"><span class="who">${who}</span><span class="what">${what}</span></button>`;
    }).join('') : '<p class="quiet-text">no letters yet — write a friend by their name</p>';
  } catch {
    $('inbox-list').innerHTML = '<p class="quiet-text">couldn’t reach your inbox — try again in a moment</p>';
  }
}
$('inbox-list').addEventListener('click', (e) => { const id = e.target.closest('button')?.dataset.id; if (id) openLetter(id); });

$('claim-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const handle = cleanName($('claim-name').value);
  if (!/^[a-z0-9_]{3,16}$/.test(handle)) return inboxNote('a name is 3–16 letters, numbers or _');
  const phrase = makePhrase();
  const res = await fetch('/api/user', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ handle, phrase }) }).catch(() => null);
  if (!res?.ok) return inboxNote(res?.status === 409 ? `@${handle} is taken — try another` : 'couldn’t make it — try again');
  saveMe({ handle, phrase });
  inboxNote('');
  showPhrase();
  renderLetterTab();
});
$('have-inbox').addEventListener('click', () => { $('login-form').hidden = false; $('have-inbox').hidden = true; });
$('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const handle = cleanName($('login-name').value);
  const phrase = cleanPhrase($('login-phrase').value);
  const res = await fetch('/api/user/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ handle, phrase }) }).catch(() => null);
  if (!res?.ok) return inboxNote(res?.status === 429 ? 'too many tries — wait an hour' : 'that name and that word don’t match');
  saveMe({ handle, phrase });
  inboxNote('');
  renderLetterTab();
});
function showPhrase() {
  $('phrase-words').textContent = me.phrase.split(' ').join(' · '); // (one word now; older inboxes had four)
  $('phrase-box').hidden = false;
}
$('show-phrase').addEventListener('click', () => ($('phrase-box').hidden ? showPhrase() : ($('phrase-box').hidden = true)));
$('phrase-saved').addEventListener('click', () => { $('phrase-box').hidden = true; });
$('sign-out').addEventListener('click', () => {
  saveMe(null);
  $('phrase-box').hidden = true;
  inboxNote('signed out — your name and secret word open your inbox again');
  renderLetterTab();
});
$('letter-to-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const to = cleanName($('letter-to').value);
  // No name: a letter you send as a link (they don't need an inbox). It still shows in yours.
  if (to) {
    const res = await fetch(`/api/user/${encodeURIComponent(to)}`).catch(() => null);
    const { exists } = res?.ok ? await res.json() : {};
    if (!exists) return inboxNote(`no one’s called @${to} yet — leave it blank to send a link instead`);
  }
  inboxNote('');
  state.thread = null;
  state.letterTo = to || null;
  writeLetter(null);
});

// The conversations this device has been part of, newest first (so you can find them again).
function myLetters() {
  try { return JSON.parse(localStorage.getItem('glyph-letters') || '[]'); } catch { return []; }
}
function rememberLetter(id, line) {
  try {
    const list = [{ id, line, at: Date.now() }, ...myLetters().filter((l) => l.id !== id)].slice(0, 12);
    localStorage.setItem('glyph-letters', JSON.stringify(list));
  } catch { /* no storage: the link still works */ }
}
function renderMyLetters() {
  const list = myLetters();
  $('my-letters').innerHTML = list.length
    ? `<p class="quiet-text">your letters</p>${list.map((l) => `<button data-id="${escapeHtml(l.id)}">“${escapeHtml(l.line || '…')}”</button>`).join('')}`
    : '';
}
$('my-letters').addEventListener('click', (e) => { const id = e.target.closest('button')?.dataset.id; if (id) openLetter(id); });

// Start writing: a new conversation (threadId null) or a reply into one.
function writeLetter(threadId) {
  resetGarden();
  state.mode = 'letter';
  state.order = [0];
  state.readingIndex = null;
  state.writingIn = threadId;
  state.sentLink = null;
  $('letter-send').textContent = 'send it ✉';
  // writing back: start in a different colour from theirs
  const theirs = state.thread?.letters.findLast((l) => !isMine(l))?.color;
  if (threadId && COLORS[0] === PALETTE[theirs]) COLORS[0] = Object.values(PALETTE).find((c) => c !== COLORS[0]);
  showLocalSetup();
}
$('letter-write').addEventListener('click', () => { state.thread = null; state.letterTo = null; writeLetter(null); });
$('letter-reply').addEventListener('click', () => { state.letterTo = null; writeLetter(state.thread.id); });
$('letter-write-back').addEventListener('click', () => { state.letterTo = null; writeLetter(state.thread.id); });

$('letter-send').addEventListener('click', async () => {
  const button = $('letter-send');
  if (!state.sentLink) {
    button.textContent = 'sending…';
    try {
      const letter = {
        messages: state.messages.map((m) => m.text),
        voice: state.robots[0],
        color: Object.keys(PALETTE).find((name) => PALETTE[name] === COLORS[0]),
        seed: state.seed,
      };
      const res = await fetch(state.writingIn ? `/api/letter/${state.writingIn}` : '/api/letter', {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...signed() },
        body: JSON.stringify({ letter, author: deviceId, to: state.writingIn ? undefined : state.letterTo || undefined }),
      });
      if (!res.ok) throw new Error(res.status);
      if (me) letter.from = me.handle;
      const { id } = await res.json();
      const earlier = state.thread?.id === id ? state.thread.letters : [];
      state.thread = { id, letters: [...earlier, { ...letter, author: deviceId }] };
      rememberLetter(id, state.thread.letters[0].messages[0]);
      state.sentLink = letterLink(id);
      try { history.replaceState(null, '', `?letter=${id}`); } catch { /* ignore */ }
      $('letter-back').hidden = false;
    } catch {
      button.textContent = 'couldn’t send — try again';
      return;
    }
  }
  // Written to a name (or back to one): it's already in their inbox, no link needed.
  // A conversation with someone who has no inbox still gets the share sheet.
  const otherNames = (state.thread?.people || []).filter((h) => h !== me?.handle);
  if (me && state.thread && (state.letterTo || (state.writingIn && otherNames.length))) {
    button.textContent = state.letterTo ? `sent to @${state.letterTo} ✓` : 'sent ✓';
    return;
  }
  await shareLetter(state.writingIn ? 'i wrote back ✉' : 'i wrote you a letter ✉', button);
});

async function shareLetter(text, button) {
  try {
    if (navigator.share) await navigator.share({ title: 'Glyph Garden', text, url: state.sentLink || letterLink(state.thread.id) });
    else {
      await navigator.clipboard.writeText(state.sentLink || letterLink(state.thread.id));
      button.textContent = 'link copied ✓';
      return;
    }
  } catch { /* they closed the share sheet: the link's still ready */ }
  button.textContent = button === $('letter-send') ? 'send it again' : 'share the link';
}
$('letter-share').addEventListener('click', () => shareLetter('my letter ✉', $('letter-share')));

// A letter link: fetch the whole conversation and show where it's at.
async function openLetter(id) {
  if (state.song) stopSong();
  show('letter-open');
  $('letter-from').textContent = 'a letter is on its way…';
  for (const b of ['letter-open-btn', 'letter-write-back', 'letter-share', 'letter-thread']) $(b).hidden = true;
  try { history.replaceState(null, '', `?letter=${id}`); } catch { /* ignore */ }
  try {
    const res = await fetch(`/api/letter/${id}`);
    if (!res.ok) throw new Error(res.status);
    const { letters, people } = await res.json();
    state.thread = { id, letters, people };
  } catch {
    $('letter-from').textContent = 'this letter got lost — ask them to send it again';
    return;
  }
  rememberLetter(id, state.thread.letters[0].messages[0]);
  const { letters } = state.thread;
  markSeen(id, letters.length);
  const last = letters.at(-1);
  const mine = isMine(last);
  const them = last.from ? `@${last.from}` : 'someone';
  $('letter-from').textContent = mine
    ? (letters.length === 1 ? 'your letter is out there ✉ waiting for them to write back' : 'you wrote last ✉ waiting for their reply')
    : (letters.length === 1 ? `${them} wrote you a letter ✉` : `${last.from ? them : 'they'} wrote back ✉`);
  $('letter-open-btn').textContent = mine ? 'hear yours again' : 'open it';
  $('letter-open-btn').hidden = false;
  $('letter-write-back').hidden = mine;
  $('letter-share').hidden = !mine;
  $('letter-thread').hidden = letters.length < 2;
  $('letter-list').innerHTML = letters.map((l, i) => `<button data-i="${i}" style="color:${rgb(PALETTE[l.color] || COLORS[0])}">${i + 1} · ${isMine(l) ? 'you' : l.from ? `@${escapeHtml(l.from)}` : 'them'}</button>`).join('');
}
$('letter-open-btn').addEventListener('click', () => playLetter(state.thread.letters.length - 1));
$('letter-list').addEventListener('click', (e) => { const i = e.target.closest('button')?.dataset.i; if (i !== undefined) playLetter(Number(i)); });
$('letter-back').addEventListener('click', () => openLetter(state.thread.id)); // fetch again: maybe they've written back
$('letter-home').addEventListener('click', () => {
  try { history.replaceState(null, '', location.pathname); } catch { /* ignore */ }
  show('title');
  pickMode('letter');
});

// Hear letter i of the conversation: its words fly in, then its song plays.
async function playLetter(i) {
  await startAudio();
  const letter = state.thread.letters[i];
  resetGarden(letter.seed);
  state.mode = 'letter';
  state.order = [0];
  state.readingIndex = i;
  state.writingIn = null;
  if (PALETTE[letter.color]) COLORS[0] = PALETTE[letter.color];
  state.banks[0] = robotVoice(letter.voice);
  state.started = true;
  show(null);
  for (const text of letter.messages) receive(0, text, true);
  setTimeout(startFinale, 1500); // let the words fly in first
}

$('replay').addEventListener('click', () => {
  if (state.song) stopSong();
  else if (state.mode === 'jam') finishJam(state.jamTaps);
  else startFinale();
});
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

// mode only matters when creating a room; joiners get whatever mode the room is.
function openLobby(code, mode = 'duet') {
  state.online = { code, me: null, room: null, conn: null };
  try { history.replaceState(null, '', `?room=${code}`); } catch { /* ignore */ }
  show('lobby');
  $('lobby-code').textContent = code;
  $('lobby-status').textContent = 'connecting…';
  $('party-list').innerHTML = '';
  state.online.conn = connect(code, { message: onRoom, status: onConnection }, mode);
}

function shareLink() {
  return `${location.origin}${location.pathname}?room=${state.online.code}`;
}

function onConnection(status) {
  const banner = $('status');
  if (status === 'full') {
    show('title');
    banner.hidden = false;
    banner.textContent = 'that room is full (or the party already started) — start your own';
    state.online.conn.close();
    state.online = null;
    return;
  }
  banner.hidden = status === 'connected';
  banner.textContent = status === 'reconnecting' ? 'reconnecting…' : '';
}

// Copy the room's latest picks onto this phone: voices, colours, who's here.
// Who's playing: a duet's fixed turn order, or (party) everyone with a seat.
function partyOrDuetOrder(room) {
  return room.order || room.players.map((p, i) => (p ? i : -1)).filter((i) => i >= 0);
}

function applyRoom(room) {
  state.online.room = room;
  state.order = partyOrDuetOrder(room);
  state.roundEnds = room.roundEnds || [];
  state.partyRounds = room.rounds || 3;
  state.prompts = !!room.prompts;
  if (state.phase === 'write' || state.phase === 'their-turn') showRoundPrompt(true);
  room.players.forEach((p, i) => {
    if (!p) return;
    if (PALETTE[p.color]) COLORS[i] = PALETTE[p.color];
    const current = state.banks[i]?.robot || state.banks[i]?.instrument;
    if (current !== p.voice) state.banks[i] = robotVoice(p.voice);
  });
  // In the garden: say what the other person is up to, if they're not here yet.
  if (state.started && state.phase !== 'finale' && state.phase !== 'encore') {
    const note = partnerNote(room, true);
    $('status').hidden = !note;
    $('status').textContent = note;
  }
}

// "player 1" / "player 2", from your point of view.
const partnerName = () => `player ${2 - state.online.me}`;

// What the others are doing. inGarden = shown to someone already playing.
function partnerNote(room, inGarden) {
  if (room.mode === 'party') return partyNote(room, inGarden);
  const them = room.players[1 - state.online.me];
  if (!them) return inGarden ? 'waiting for them to join — send the link' : 'send them the link or the code — waiting for them to join';
  if (!them.online) return `${partnerName()} left — they can come back with the same link`;
  if (them.entered) return inGarden ? '' : `${partnerName()} is in the garden — waiting for you ✶`;
  return inGarden ? `waiting for ${partnerName()} to enter the garden` : `${partnerName()} is here — picking their sound`;
}

// Party: who's missing from the garden (or, in the lobby, who's here).
function partyNote(room, inGarden) {
  const me = state.online.me;
  if (!room.started) {
    const here = room.players.filter((p) => p?.online).length;
    if (me !== 0) return `${here} here — waiting for the host to start`;
    return here < 2 ? 'send the link or code — you need at least 2 people' : `${here} here — start when everyone’s in`;
  }
  const seats = room.players.map((p, i) => (p ? i : -1)).filter((i) => i >= 0 && i !== me);
  const outside = seats.filter((i) => room.players[i].online && !room.players[i].entered);
  if (outside.length) return inGarden ? `waiting for ${outside.map((i) => NAMES[i].toLowerCase()).join(', ')} to enter` : 'the party has started ✶';
  return inGarden ? '' : 'the party has started ✶';
}

function renderLobby() {
  const { room, me } = state.online;
  const others = room.players.filter((p, i) => p && i !== me);
  const party = room.mode === 'party';
  $('lobby-mode').textContent = party ? 'party' : 'duet';
  $('lobby-status').textContent = partnerNote(room, false);
  // Someone else's instrument is theirs: grey it out in your list.
  for (const option of $('my-voice').options) option.disabled = others.some((p) => p.voice === option.value);
  // Party: the guest list, and the host's start button.
  $('party-list').hidden = !party;
  if (party) {
    $('party-list').innerHTML = room.players.map((p, i) => (p && p.online
      ? `<li style="color:${rgb(COLORS[i])}">${NAMES[i].toLowerCase()}${i === me ? ' (you)' : ''}${i === 0 ? ' · host' : ''} — ${escapeHtml(p.voice)}</li>`
      : '')).join('');
  }
  const started = !party || room.started;
  $('start-party').hidden = !party || me !== 0 || started;
  $('start-party').disabled = room.players.filter((p) => p?.online).length < 2;
  $('enter').hidden = !started;
  if (state.online.autoEnter && started) {
    state.online.autoEnter = false;
    enterGarden();
  }
  $('me-label').textContent = me === 0 ? 'you (first)' : 'you';
  $('prompts-online').checked = !!room.prompts;
  $('prompts-online').disabled = me !== 0; // the host decides
  $('prompts-note').textContent = me === 0 ? '' : '(the host decides)';
  $('me-label').style.color = rgb(COLORS[me]);
  $('my-voice').value = room.players[me].voice;
  $('my-colors').querySelectorAll('button').forEach((btn) => {
    btn.classList.toggle('on', btn.dataset.color === room.players[me].color);
    btn.disabled = others.some((p) => p.color === btn.dataset.color);
  });
}

function onRoom(msg) {
  const online = state.online;
  if (!online) return;
  if (online.screen) return onJamScreen(msg);
  if (msg.room?.mode === 'jam' || state.mode === 'jam') return onJamPhone(msg);
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
    const ready = ['their-turn', 'sending'].concat(isParty() ? ['write', 'round-full'] : []);
    if (ready.includes(state.phase)) receiveNext(); // (in a dance or mid-landing, it waits its turn)
  } else if (msg.type === 'round') {
    // The room says a party round is over (everyone's in, or the timer ran out).
    if (!state.roundEnds.includes(msg.end)) state.roundEnds.push(msg.end);
    state.partyRounds = msg.rounds || state.partyRounds;
    const idle = state.phase === 'write' || state.phase === 'round-full';
    if (state.started && idle && state.messages.length === msg.end && !state.danced.has(msg.end)) beginRoundEnd();
  } else if (msg.type === 'voice') {
    const voice = { data: msg.data, mime: msg.mime };
    if (state.messages[msg.index]) attachVoice(state.messages[msg.index], voice);
    else state.lateVoices[msg.index] = voice;
  } else if (msg.type === 'typing') {
    if (state.phase === 'their-turn') {
      $('waiting-note').textContent = 'they’re writing…';
      clearTimeout(online.typingTimer);
      online.typingTimer = setTimeout(() => {
        $('waiting-note').textContent = `message ${state.messages.length + 1} / ${totalMessages()}`;
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
  state.mode = state.online.room.mode;
  state.order = partyOrDuetOrder(state.online.room);
  state.online.conn.send({ type: 'entered' });
  state.seed = state.online.room.seed;
  state.cipher = makeCipher(state.seed);
  for (const m of state.online.room.messages) receive(m.player, m.text, true);
  roundEndsSoFar().forEach((end) => state.danced.add(end)); // don't replay old dances
  if (isGameOver(state.messages.length)) setTimeout(startFinale, 1500);
  else startWriting();
  const note = partnerNote(state.online.room, true);
  $('status').hidden = !note;
  $('status').textContent = note;
}

$('host').addEventListener('click', () => openLobby(newCode(), 'duet'));
$('host-party').addEventListener('click', () => openLobby(newCode(), 'party'));
// The host starts the party (and walks straight into the garden once it's set up).
$('start-party').addEventListener('click', async () => {
  await startAudio(); // start sound now, while we still have the tap
  state.online.autoEnter = true;
  state.online.conn.send({ type: 'start' });
});

// ── title screen: pick a game mode ──
const BLURBS = {
  duet: 'Two people write to each other. The words get lost in translation — into drifting glyphs, into strange half-heard sounds — until, at the end, they come back as a song.',
  party: 'Up to 8 people, no turns: throw words into the void whenever you like. Once everyone has said something, the garden dances; after a few rounds, it all comes back as one song.',
  diary: 'Just you. Write a few lines to yourself and let them drift — at the end, they come back as a song.',
  letter: 'Write a friend 4 lines: no dances, straight to the song. Make an inbox and friends can write to you by name; or just send a letter as a link.',
  jam: 'One big screen, everyone’s phones as instruments. Pick 4 symbols (every one is its own sound), then tap away and fire them onto the screen. No turns. After 45 seconds, your taps become a song.',
};
function pickMode(mode) {
  const tabs = [...document.querySelectorAll('.modes button')];
  tabs.forEach((b) => b.classList.toggle('on', b.dataset.mode === mode));
  document.querySelector('.modes').style.setProperty('--i', tabs.findIndex((b) => b.dataset.mode === mode)); // slide the pill
  $('mode-blurb').textContent = BLURBS[mode];
  for (const m of ['duet', 'party', 'diary', 'jam', 'letter']) $(`mode-${m}`).hidden = m !== mode;
  if (mode === 'letter') renderLetterTab();
  $('join-form').hidden = mode === 'diary' || mode === 'letter';
  $('local').hidden = mode !== 'duet';
}
document.querySelector('.modes').addEventListener('click', (e) => { if (e.target.dataset.mode) pickMode(e.target.dataset.mode); });
pickMode('duet');

// Diary: the one-screen setup, with just you.
$('diary').addEventListener('click', () => {
  state.mode = 'diary';
  state.order = [0];
  showLocalSetup();
});
// ← back from the duet lobby: leave the room and go home.
$('lobby-back').addEventListener('click', () => {
  state.online?.conn.close();
  state.online = null;
  try { history.replaceState(null, '', location.pathname); } catch { /* ignore */ }
  $('share').textContent = 'share link';
  show('title');
});
$('local-back').addEventListener('click', () => show('title'));
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

// ───────────────────────── jam ─────────────────────────
// The shared screen (TV/laptop) shows and plays everything; phones are 4-button instruments.

// The jam's song recipe, the same on the screen and every phone: from the room's seed + everyone's glyphs.
function jamDNA(room) {
  // the symbols and everyone's words: secret words (cat, rain…) stack their sounds, like in the finale
  const texts = [String(room.seed), ...room.players.filter(Boolean).map((p) => [(p.glyphs || []).join(''), ...(p.words || [])].join(' '))];
  return songDNA(texts.map((text) => ({ text })), { jam: true });
}

function applyJamColors(room) {
  room.players.forEach((p, i) => { if (p && PALETTE[p.color]) COLORS[i] = PALETTE[p.color]; });
}

const clock = (ms) => `${Math.floor(ms / 60000)}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, '0')}`;

// ── the screen ──
function openJamScreen(code) {
  state.mode = 'jam';
  state.online = { code, me: -1, screen: true, room: null, conn: null };
  try { history.replaceState(null, '', `?screen=${code}`); } catch { /* ignore */ }
  show('jam-screen');
  $('jam-code').textContent = code;
  $('jam-url').textContent = location.host;
  $('jam-hud-code').textContent = `join: ${location.host} · ${code}`;
  state.online.conn = connect(code, { message: onRoom, status: onConnection }, 'jam', 'screen');
}

function renderJamScreen(room) {
  $('jam-players').innerHTML = room.players.map((p, i) => (p && p.online
    ? `<li style="color:${rgb(COLORS[i])}">${NAMES[i].toLowerCase()} ${p.glyphs ? `<b>${p.glyphs.map(escapeHtml).join('')}</b>${p.words?.some(Boolean) ? ` <span class="quiet-text">${p.words.filter(Boolean).map(escapeHtml).join(' · ')}</span>` : ''}` : '<span class="quiet-text">picking glyphs…</span>'}</li>`
    : '')).join('') || '<li class="quiet-text">waiting for phones to join…</li>';
  $('jam-start').disabled = !room.players.some((p) => p?.online && p.glyphs);
}

function onJamScreen(msg) {
  const room = msg.room;
  if (room) {
    state.online.room = room;
    applyJamColors(room);
    if (!room.started) renderJamScreen(room);
    else if (!room.ended && state.phase !== 'jam') beginJamScreen(room);
  }
  if (msg.type === 'tap' && state.phase === 'jam') {
    const symbol = state.online.room.players[msg.player]?.glyphs?.[msg.button];
    if (!symbol) return;
    const at = jamTap(symbol);
    setTimeout(() => spawnJamGlyph(msg.player, msg.button), Math.max(0, (at - Tone.now()) * 1000));
  } else if (msg.type === 'jam-end') {
    finishJam(msg.taps);
  } else if (msg.type === 'reset') {
    stopAll();
    clearInterval(state.jamDance);
    state.song = null;
    state.glyphs = [];
    state.formation = null;
    state.phase = 'jam-lobby';
    show('jam-screen');
  }
}

function beginJamScreen(room) {
  state.phase = 'jam';
  state.jamGroups = {};
  show(null);
  setAmbient(false);
  state.dna = jamDNA(room);
  state.song = startJamBacking(state.dna); // the beat glyphs pulse to
  $('jam-hud').hidden = false;
  const endsAt = performance.now() + room.jamLength - (room.jamElapsed || 0);
  clearInterval(state.jamClock);
  state.jamClock = setInterval(() => { $('jam-timer').textContent = clock(Math.max(0, endsAt - performance.now())); }, 250);
}

// ── the jam's shapes ──
// Each player's glyphs gather into their own small shape that drifts around the screen.
// When two shapes bump, they merge into one big pattern for a while, then split again.
const SOLO_SHAPES = ['sunflower', 'galaxy', 'rose', 'starburst', 'bloom', 'tornado', 'lissajous', 'infinity', 'orbits'];
const DUO_SHAPES = ['helix', 'conversation', 'orbits', 'ribbons', 'binary', 'heart', 'tornado', 'infinity'];
const PER_PLAYER = 48; // glyphs each shape holds; older ones drift off as new ones fly in
const MERGE_TIME = 9000;
const pickFrom = (list) => list[Math.floor(Math.random() * list.length)];
const shapeOf = (name) => ({ name, pattern: FORMATIONS[name], params: FORMATIONS[name].setup(Math.random) });

function jamGroup(seat) {
  state.jamGroups ??= {};
  return (state.jamGroups[seat] ??= (() => {
    const W = P.width;
    const H = P.height;
    const a = Math.random() * Math.PI * 2;
    const home = (seat / 8) * Math.PI * 2 + Math.random() * 0.5; // spread around the screen, so meetings take a while
    return {
      seat, x: W / 2 + Math.cos(home) * W * 0.32, y: H / 2 + Math.sin(home) * H * 0.3,
      vx: Math.cos(a) * 30, vy: Math.sin(a) * 30, shape: shapeOf(pickFrom(SOLO_SHAPES)),
      merged: null, calmUntil: 0,
    };
  })());
}

// Where a glyph goes in a shape centred on (x, y) with radius R.
function shapeTarget(shape, g, t, x, y, R, ctx) {
  const box = R * 2.4;
  const [tx, ty] = shape.pattern.at(g, t, { ...ctx, W: box, H: box, cx: box / 2, cy: box / 2, R }, shape.params);
  return [tx - box / 2 + x, ty - box / 2 + y];
}

function updateJamGroups(dt, t, now) {
  const W = P.width;
  const H = P.height;
  const groups = Object.values(state.jamGroups || {});
  const members = {};
  for (const g of state.glyphs) if (g.mode === 'jam') (members[g.player] ??= []).push(g);
  const radius = (n) => Math.min(H * 0.16, 34 + Math.sqrt(n) * 11);

  // drift, bounce off the edges
  for (const grp of groups) {
    if (grp.merged && grp.merged.lead !== grp) continue; // the pair moves together
    const R = grp.merged ? grp.merged.R : radius(members[grp.seat]?.length || 1);
    const wobble = P.noise(grp.seat * 9.1, t * 0.15) * Math.PI * 4;
    grp.vx += Math.cos(wobble) * 6 * dt;
    grp.vy += Math.sin(wobble) * 6 * dt;
    const speed = Math.hypot(grp.vx, grp.vy) || 1;
    const want = grp.merged ? 14 : 34;
    grp.vx *= want / speed;
    grp.vy *= want / speed;
    grp.x += grp.vx * dt;
    grp.y += grp.vy * dt;
    if (grp.x < R || grp.x > W - R) { grp.vx = Math.abs(grp.vx) * (grp.x < R ? 1 : -1); grp.x = Math.min(W - R, Math.max(R, grp.x)); }
    if (grp.y < R + 40 || grp.y > H - R) { grp.vy = Math.abs(grp.vy) * (grp.y < R + 40 ? 1 : -1); grp.y = Math.min(H - R, Math.max(R + 40, grp.y)); }
    if (grp.merged) { const other = grp.merged.other; other.x = grp.x; other.y = grp.y; }
  }

  // split pairs whose time is up: they push apart, and won't re-merge for a bit
  for (const grp of groups) {
    const m = grp.merged;
    if (!m || m.lead !== grp || now < m.until) continue;
    const a = Math.random() * Math.PI * 2;
    for (const [g, sign] of [[m.lead, 1], [m.other, -1]]) {
      g.merged = null;
      g.calmUntil = now + 6000;
      g.vx = Math.cos(a) * 60 * sign;
      g.vy = Math.sin(a) * 60 * sign;
      g.shape = shapeOf(pickFrom(SOLO_SHAPES)); // each leaves as something new
    }
  }

  // two shapes touching: they merge into one big pattern
  for (let i = 0; i < groups.length; i++) {
    for (let j = i + 1; j < groups.length; j++) {
      const a = groups[i];
      const b = groups[j];
      if (a.merged || b.merged || now < a.calmUntil || now < b.calmUntil) continue;
      const na = members[a.seat]?.length || 0;
      const nb = members[b.seat]?.length || 0;
      if (na < 4 || nb < 4) continue; // a shape needs a few glyphs before it can hug
      if (Math.hypot(a.x - b.x, a.y - b.y) > radius(na) + radius(nb)) continue;
      const pair = { lead: a, other: b, until: now + MERGE_TIME, shape: shapeOf(pickFrom(DUO_SHAPES)), R: Math.min(W, H) * 0.3 };
      a.merged = b.merged = pair;
      a.x = (a.x + b.x) / 2;
      a.y = (a.y + b.y) / 2;
      state.ripples.push({ x: a.x, y: a.y, born: now, color: COLORS[a.seat], strength: 1, rings: 3 });
      state.ripples.push({ x: a.x, y: a.y, born: now + 120, color: COLORS[b.seat], strength: 1, rings: 3 });
    }
  }

  // every glyph's target
  const done = new Set();
  for (const grp of groups) {
    if (done.has(grp)) continue;
    const m = grp.merged;
    if (m) {
      done.add(m.lead).add(m.other);
      const A = members[m.lead.seat] || [];
      const B = members[m.other.seat] || [];
      const all = [...A, ...B];
      const ctx = { n: all.length, counts: [A.length, B.length], msgs: 2, msgSize: [A.length, B.length] };
      all.forEach((g, fi) => {
        const side = fi < A.length ? 0 : 1;
        Object.assign(g, { fi, side, fj: side ? fi - A.length : fi, msg: side, fm: side ? fi - A.length : fi });
        [g.tx, g.ty] = shapeTarget(m.shape, g, t, m.lead.x, m.lead.y, m.R, ctx);
      });
    } else {
      done.add(grp);
      const mine = members[grp.seat] || [];
      const ctx = { n: mine.length, counts: [mine.length, 0], msgs: 1, msgSize: [mine.length] };
      const R = radius(mine.length);
      mine.forEach((g, fi) => {
        Object.assign(g, { fi, side: 0, fj: fi, msg: 0, fm: fi });
        [g.tx, g.ty] = shapeTarget(grp.shape, g, t, grp.x, grp.y, R, ctx);
      });
    }
  }
}

// A tap lands: the glyph flies in from a random edge and joins its player's shape.
function spawnJamGlyph(seat, button) {
  const ch = state.online.room.players[seat]?.glyphs?.[button];
  if (!ch) return;
  const now = P.millis();
  const W = P.width;
  const H = P.height;
  const grp = jamGroup(seat);
  const edge = Math.floor(Math.random() * 4);
  const along = Math.random();
  const [x, y] = [[along * W, -20], [W + 20, along * H], [along * W, H + 20], [-20, along * H]][edge];
  // thrown roughly at the shape, a bit off-line so it swoops in on a curve
  const dx = grp.x - x;
  const dy = grp.y - y;
  const d = Math.hypot(dx, dy) || 1;
  const speed = 500 + Math.random() * 300;
  const swerve = (Math.random() - 0.5) * 0.9;
  const vx = (dx / d) * Math.cos(swerve) * speed - (dy / d) * Math.sin(swerve) * speed;
  const vy = (dy / d) * Math.cos(swerve) * speed + (dx / d) * Math.sin(swerve) * speed;
  state.glyphs.push({
    ch, sym: ch, player: seat, msg: 0, wi: 0, col: 0, len: 1, x, y, vx, vy, tx: grp.x, ty: grp.y,
    mode: 'jam', entered: true, launched: true, born: now, flash: 1, decodeAt: null,
    quietUntil: Infinity, // no collision chimes in a jam — the taps are the music
    seed: Math.random() * 1000, mood: ['excited', 'calm', 'happy', 'excited'][button], revealAt: null,
  });
  // each shape holds its newest glyphs; the oldest let go and drift off on their own
  const mine = state.glyphs.filter((g) => g.player === seat && g.mode === 'jam');
  if (mine.length > PER_PLAYER) mine[0].mode = 'free';
  if (state.glyphs.length > 300) state.glyphs.shift(); // keep it light
}

// Time's up: the screen turns everyone's taps into a song.
function finishJam(taps) {
  stopAll();
  clearInterval(state.jamClock);
  clearInterval(state.jamDance);
  $('jam-hud').hidden = true;
  state.jamTaps = taps;
  state.phase = 'finale';
  const room = state.online.room;
  const seats = room.players.map((p, i) => (p && taps.some(([s]) => s === i) ? i : -1)).filter((i) => i >= 0);
  if (!seats.length) seats.push(...room.players.map((p, i) => (p ? i : -1)).filter((i) => i >= 0));
  state.dna = jamDNA(room);
  let dance = 0;
  startFormation(danceFor('pattern', dance), 'jam0');
  const lyrics = {};
  for (const seat of seats) {
    lyrics[seat] = (room.players[seat].words || []).map((w) => (w ? { word: w, syllables: translate(w).flatMap((x) => x.syllables) } : null))
      .map((w) => (w?.syllables.length ? w : null));
  }
  const glyphs = room.players.map((p) => p?.glyphs || null);
  const song = playJamSong(taps, glyphs, seats, state.dna, (seat) => {
    const mine = state.glyphs.filter((g) => g.player === seat);
    const g = mine[Math.floor(Math.random() * mine.length)];
    if (g) g.flash = 1;
  }, lyrics, showJamLyric);
  state.song = song;
  // a new dance every 4 bars
  state.jamDance = setInterval(() => { if (state.song) startFormation(danceFor('pattern', ++dance), `jam${dance}`); }, song.beat * 16 * 1000);
  setTimeout(() => { if (state.song === song) showJamEnd(); }, song.firstPass * 1000);
}

// A sung word, big on the screen in the singer's colour, floating up and away.
function showJamLyric(seat, word) {
  const el = $('jam-lyric');
  el.hidden = false;
  el.textContent = word;
  el.style.color = rgb(COLORS[seat]);
  el.style.animation = 'none';
  void el.offsetWidth; // restart the fade
  el.style.animation = '';
}

function showJamEnd() {
  state.phase = 'encore';
  show('end');
  $('replay').textContent = 'stop';
  const d = state.dna;
  $('end-recipe').textContent = `${d.style}  ·  ${d.keyName} · ${d.feel}  ·  ${d.bpm} bpm  ·  ${state.jamTaps.length} taps`;
  const secrets = d.secrets.length;
  $('end-secrets').textContent = secrets ? `✶ you found ${secrets} secret word${secrets > 1 ? 's' : ''}` : '';
  // the lyrics: each person's glyphs and the words they gave them
  const room = state.online.room;
  const lines = room.players.map((p, i) => (p?.glyphs && p.words?.some(Boolean)
    ? `<li style="color:${rgb(COLORS[i])}">${p.glyphs.map((g, b) => (p.words[b] ? `${escapeHtml(g)} ${escapeHtml(p.words[b])}` : '')).filter(Boolean).join('  ·  ')}</li>`
    : '')).join('');
  $('end-lyrics').innerHTML = lines;
  $('end-lyrics-box').hidden = !lines;
}

// ── a phone ──
function onJamPhone(msg) {
  const online = state.online;
  const room = msg.room;
  if (msg.type === 'welcome') {
    online.me = msg.you;
    state.mode = 'jam';
  }
  if (!room) return;
  online.room = room;
  applyJamColors(room);
  state.dna = jamDNA(room);
  const me = room.players[online.me];
  if (!me) return;
  if (msg.type === 'welcome' && !me.glyphs) showJamSetup();
  else if (me.glyphs) renderJamPad(room);
}

// The 40 symbols a phone can choose from: symbols and letters, each making a different
// sound where possible. "new symbols" deals another 40 (keeping the ones you've picked).
const JAM_POOL = [...SYMBOLS, ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'];
function dealSymbols() {
  const picks = state.jamPicks;
  const offer = [...picks];
  const sounds = new Set(picks.map(jamSoundIndex));
  const pool = JAM_POOL.filter((s) => !picks.includes(s)).sort(() => Math.random() - 0.5);
  for (const s of pool) {
    if (offer.length >= 40) break;
    if (!sounds.has(jamSoundIndex(s))) { offer.push(s); sounds.add(jamSoundIndex(s)); }
  }
  for (const s of pool) if (offer.length < 40 && !offer.includes(s)) offer.push(s); // more symbols than sounds: top up
  state.jamOffer = offer.slice(picks.length).sort(() => Math.random() - 0.5);
  state.jamOffer.unshift(...picks);
  renderJamChoices();
}

function renderJamChoices() {
  const color = rgb(COLORS[state.online.me]);
  $('jam-choices').innerHTML = state.jamOffer.map((s) => `<button data-s="${escapeHtml(s)}" class="${state.jamPicks.includes(s) ? 'chosen' : ''}" style="color:${color}">${escapeHtml(s)}${TEXT_STYLE}</button>`).join('');
  $('jam-picked').innerHTML = [0, 1, 2, 3].map((i) => {
    const s = state.jamPicks[i];
    return `<label style="color:${color}"><span class="slot ${s ? 'filled' : ''}">${s ? escapeHtml(s) + TEXT_STYLE : ''}</span>`
      + `<input class="word-input" maxlength="12" autocomplete="off" placeholder="word" data-s="${s ? escapeHtml(s) : ''}" value="${escapeHtml(state.jamWords[s] || '')}" ${s ? '' : 'disabled'}></label>`;
  }).join('');
  $('jam-ready').disabled = state.jamPicks.length < 4;
}

function showJamSetup() {
  show('jam-setup');
  $('jam-pad').hidden = true;
  $('jam-you').style.color = rgb(COLORS[state.online.me]);
  const me = state.online.room.players[state.online.me];
  state.jamPicks = me?.glyphs ? [...me.glyphs] : [];
  state.jamWords = {};
  state.jamPicks.forEach((s, i) => { state.jamWords[s] = me.words?.[i] || ''; });
  dealSymbols();
}

function renderJamPad(room) {
  show(null);
  $('jam-pad').hidden = false;
  const me = state.online.me;
  const glyphs = room.players[me].glyphs;
  document.querySelectorAll('.pad').forEach((pad, i) => {
    pad.querySelector('b').textContent = glyphs[i] + TEXT_STYLE;
    pad.querySelector('span').textContent = room.players[me].words?.[i] || '';
    pad.style.color = rgb(COLORS[me]);
    pad.style.borderColor = rgb(COLORS[me]);
  });
  const live = room.started && !room.ended;
  $('jam-pad-note').textContent = room.ended ? 'look at the screen ✶'
    : live ? 'tap away — fire your glyphs at the screen' : 'waiting for the screen to start… (try your sounds)';
  document.querySelector('.pads').style.opacity = room.ended ? 0.35 : 1;
}

$('host-jam').addEventListener('click', () => openJamScreen(newCode()));
$('jam-back').addEventListener('click', () => {
  state.online?.conn.close();
  state.online = null;
  state.mode = 'duet';
  try { history.replaceState(null, '', location.pathname); } catch { /* ignore */ }
  show('title');
});
$('jam-start').addEventListener('click', async () => {
  await startAudio(); // the screen plays all the sound: start it on this click
  state.online.conn.send({ type: 'start' });
});
$('jam-end').addEventListener('click', () => state.online?.conn.send({ type: 'end' }));
$('jam-shuffle').addEventListener('click', dealSymbols);
// Tap a symbol: hear it, and pick it (or un-pick it). A 5th pick replaces your first.
$('jam-choices').addEventListener('click', async (e) => {
  const symbol = e.target.closest('button')?.dataset.s;
  if (!symbol) return;
  await startAudio();
  jamTapLocal(state.dna, symbol);
  const picks = state.jamPicks;
  if (picks.includes(symbol)) picks.splice(picks.indexOf(symbol), 1);
  else {
    if (picks.length >= 4) picks.shift();
    picks.push(symbol);
  }
  renderJamChoices();
});
// Tap a picked slot to hear it again.
$('jam-picked').addEventListener('click', (e) => {
  const i = [...$('jam-picked').children].indexOf(e.target.closest('label'));
  if (e.target.classList.contains('slot') && state.jamPicks[i]) jamTapLocal(state.dna, state.jamPicks[i]);
});
$('jam-picked').addEventListener('input', (e) => {
  if (e.target.dataset.s) state.jamWords[e.target.dataset.s] = e.target.value;
});
$('jam-ready').addEventListener('click', async () => {
  if (state.jamPicks.length < 4) return;
  await startAudio(); // your phone plays your taps
  const glyphs = [...state.jamPicks];
  const words = glyphs.map((s) => (state.jamWords[s] || '').trim());
  state.online.conn.send({ type: 'glyphs', glyphs, words });
});
document.querySelectorAll('.pad').forEach((pad) => {
  pad.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    const room = state.online?.room;
    if (!room || room.ended) return;
    const button = Number(pad.dataset.b);
    jamTapLocal(state.dna, room.players[state.online.me].glyphs[button]);
    if (room.started) state.online.conn.send({ type: 'tap', button });
    pad.classList.add('hit');
    setTimeout(() => pad.classList.remove('hit'), 90);
  });
  pad.addEventListener('contextmenu', (e) => e.preventDefault());
});

// ───────────────────────── speak (and sing) your message ─────────────────────────
// Press and hold ● while you talk; let go when you're done. Your voice is recorded
// (so the song can sing your actual words, autotuned) and, where the browser can,
// turned into text in the box to fix up. Max 8 seconds.
const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
const canRecord = !!(navigator.mediaDevices?.getUserMedia && window.MediaRecorder);
let listening = null; // { rec, recorder, timer } while the mic is on

async function startSpeaking() {
  $('mic').classList.add('on');
  $('write-hint').classList.add('show');
  $('write-hint').textContent = 'listening… let go when you’re done';
  listening = { rec: null, recorder: null, timer: setTimeout(stopSpeaking, 8000) };
  const session = listening;
  if (canRecord) {
    try {
      state.mic ??= await openMic();
      if (listening === session) session.recorder = startRecording(state.mic, 32000);
    } catch { /* no microphone: words only */ }
  }
  if (Recognition && listening === session) {
    const rec = new Recognition();
    rec.lang = navigator.language || 'en-US';
    rec.interimResults = true;
    rec.onresult = (e) => {
      $('message').value = cleanText([...e.results].map((r) => r[0].transcript).join(''));
      updateCount();
    };
    rec.onerror = () => {}; // e.g. it can't share the mic on some phones — the recording still counts
    try { rec.start(); session.rec = rec; } catch { /* ignore */ }
  }
}

async function stopSpeaking() {
  if (!listening) return;
  const { rec, recorder, timer } = listening;
  listening = null;
  clearTimeout(timer);
  $('mic').classList.remove('on');
  try { rec?.stop(); } catch { /* already stopped */ }
  if (!recorder) return;
  try {
    const audio = await recorder.stop();
    state.spoken = { audio, blob: audio.blob };
    $('mic').classList.add('voiced');
    $('write-hint').textContent = '♪ your voice will sing this — hold ● again to redo';
  } catch {
    $('write-hint').textContent = 'couldn’t record that — try again, or just type';
  }
}

if (Recognition || canRecord) {
  const mic = $('mic');
  mic.hidden = false;
  mic.addEventListener('pointerdown', (e) => {
    e.preventDefault(); // keep the keyboard from popping up / the button from being "selected"
    mic.setPointerCapture?.(e.pointerId); // still counts as holding if your thumb slides a little
    if (!listening) startSpeaking();
  });
  for (const end of ['pointerup', 'pointercancel']) mic.addEventListener(end, () => stopSpeaking());
  mic.addEventListener('contextmenu', (e) => e.preventDefault()); // long-press menus on phones
}

// ───────────────────────── phone keyboard ─────────────────────────
// The screen itself never moves. When the keyboard opens, the visible area shrinks:
// measure how much of the screen the keyboard covers and sit the typing bar right
// on top of it (no animation, no page scrolling — those made it jumpy).
// Phones: while you type, the box glides up to the upper middle of the screen, out of the
// keyboard's reach. iPhones only say how tall the keyboard is once it has finished sliding
// up, so a box that follows it always arrives late and bounces; one that steps out of the
// way never has to. The tap is caught before the browser focuses the box, so iOS doesn't
// shove the whole page up either: we move the box first, then focus it without scrolling.
const touchUI = matchMedia('(pointer: coarse)').matches;
// The whole page is locked to the screen's height from the start (see --app-h in style.css),
// so the keyboard slides over the garden instead of squashing or stretching it.
let appHeight = window.innerHeight;
document.documentElement.style.setProperty('--app-h', `${appHeight}px`);
const keyboardUp = () => ['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName) && touchUI;
// iOS can still slide the page into the empty space behind the keyboard: snap it back.
window.visualViewport?.addEventListener('scroll', () => { if (window.visualViewport.offsetTop > 0) window.scrollTo(0, 0); });
// …and dragging the background never scrolls anything (lists inside panels still scroll).
document.addEventListener('touchmove', (e) => {
  if (!e.target.closest?.('.panel, #pattern-viewer, .symbol-strip, details')) e.preventDefault();
}, { passive: false });
function setComposing(on) {
  if (!touchUI || document.body.classList.contains('composing') === on) return;
  const box = $('write');
  const before = box.getBoundingClientRect().top;
  document.body.classList.toggle('composing', on);
  const after = box.getBoundingClientRect().top;
  if (!box.hidden && before !== after) {
    box.animate([{ translate: `0 ${before - after}px` }, { translate: '0 0' }], { duration: 300, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' });
  }
}
$('message').addEventListener('touchend', (e) => {
  if (!touchUI || document.activeElement === $('message')) return; // already typing: let the tap move the cursor
  e.preventDefault(); // no native focus (it would scroll the page)
  setComposing(true);
  $('message').focus({ preventScroll: true });
}, { passive: false });
$('message').addEventListener('focus', () => setComposing(true));
$('message').addEventListener('blur', () => {
  setTimeout(() => { if (document.activeElement !== $('message')) setComposing(false); }, 60);
});

// Opened from a shared link? Go straight to that room (or, for a jam screen, back to being the screen).
const linkParams = new URLSearchParams(location.search);
const roomFromLink = linkParams.get('room');
const screenFromLink = linkParams.get('screen');
const letterFromLink = linkParams.get('letter');
const devHost = ['localhost', '127.0.0.1'].includes(location.hostname);
if (linkParams.has('patterns') && devHost) setTimeout(openPatternViewer, 300);
else if (linkParams.has('sounds') && devHost) setTimeout(openSoundPreview, 300);
else if (letterFromLink && /^[a-z0-9]{8}$/.test(letterFromLink)) openLetter(letterFromLink);
else if (screenFromLink && /^[A-Za-z0-9]{4,8}$/.test(screenFromLink)) openJamScreen(screenFromLink.toUpperCase());
else if (roomFromLink && /^[A-Za-z0-9]{4,8}$/.test(roomFromLink)) openLobby(roomFromLink.toUpperCase());

state.cipher = makeCipher(state.seed);
window.garden = state; // handy for poking around in the browser console
new p5(sketch);
