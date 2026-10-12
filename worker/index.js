// Glyph Garden server: serves the game, and runs one "Room" per duet code.
// A Room is a Durable Object: a tiny always-consistent server that both
// players' phones connect to over a WebSocket (a live two-way connection).

import { DurableObject } from 'cloudflare:workers';
import { WordLog, wordsWorthCounting } from './words.js';

export { WordLog };

// Game modes. A duet is 2 people taking turns, 4 messages each.
// A party is up to 8 people with no turns: anyone sends whenever they like (max 2
// per round). A round ends — and everyone dances — once every person in the room has
// at least one line in it, or 30 s after it began if someone's gone quiet.
// 3 rounds for up to 4 people, 2 for bigger parties.
// A jam: one shared screen (not a player) + up to 8 phones. Each phone picks 4 glyphs,
// then taps them as fast as they like for 90 s; the screen plays along and, at the end,
// turns everyone's recorded taps into a song.
const MODES = {
  duet: { seats: 2, perPlayer: 4 },
  party: { seats: 8, perRound: 2, roundTimeout: 30_000 },
  jam: { seats: 8, length: 45_000, maxTaps: 4000, minGap: 70 },
};
const partyRounds = (people) => (people <= 4 ? 3 : 2);
const MAX_TEXT = 60; // characters per message (the game's box allows the same)
const MAX_VOICE = 400_000; // a spoken message's recording, base64 (8 s of compressed audio is far less)
const CODE = /^[A-Z0-9]{4,8}$/;
// Starting picks for a new player: the first ones the other player isn't using.
const DEFAULT_VOICES = ['marimba', 'keys', 'flute', 'violin', 'harp', 'cello', 'trumpet', 'ocarina', 'banjo', 'steelpan'];
const DEFAULT_COLORS = ['sky', 'peach', 'mint', 'lilac', 'rose', 'gold', 'coral', 'lime'];

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    // /api/room/ABCD/ws → the room's live connection
    const match = url.pathname.match(/^\/api\/room\/([A-Za-z0-9]+)\/ws$/);
    if (match) {
      const code = match[1].toUpperCase();
      if (!CODE.test(code)) return new Response('bad room code', { status: 400 });
      if (request.headers.get('Upgrade') !== 'websocket') return new Response('expected websocket', { status: 426 });
      return env.ROOMS.getByName(code).fetch(request);
    }

    // Inboxes: a name (@tavi) + 4 secret words. The words never leave your phone except to be
    // checked; the server keeps only a salted fingerprint of them (a hash).
    //   POST /api/user        { handle, phrase } → claim a name
    //   POST /api/user/login  { handle, phrase } → check the words (to sign in on a new phone)
    //   GET  /api/user/NAME   → { exists }
    //   GET  /api/inbox       (signed) → your conversations
    if (url.pathname === '/api/user' && request.method === 'POST') {
      const { handle, phrase } = (await request.json().catch(() => null)) || {};
      if (!HANDLE.test(handle || '') || !PHRASE.test(phrase || '')) return new Response('bad name or words', { status: 400 });
      const ok = await env.ROOMS.getByName(`user:${handle}`).claimUser(handle, phrase);
      return ok ? Response.json({ handle }) : new Response('taken', { status: 409 });
    }
    if (url.pathname === '/api/user/login' && request.method === 'POST') {
      const { handle, phrase } = (await request.json().catch(() => null)) || {};
      if (!HANDLE.test(handle || '') || !PHRASE.test(phrase || '')) return new Response('bad name or words', { status: 400 });
      const result = await env.ROOMS.getByName(`user:${handle}`).checkUser(phrase);
      return result === 'ok' ? Response.json({ handle }) : new Response(result, { status: result === 'locked' ? 429 : 401 });
    }
    const userMatch = url.pathname.match(/^\/api\/user\/([a-z0-9_]{3,16})$/);
    if (userMatch && request.method === 'GET') {
      return Response.json({ exists: await env.ROOMS.getByName(`user:${userMatch[1]}`).hasUser() });
    }
    if (url.pathname === '/api/inbox') {
      const me = await whoIs(request, env);
      if (!me) return new Response('sign in', { status: 401 });
      return Response.json({ handle: me, inbox: await env.ROOMS.getByName(`user:${me}`).getInbox() });
    }

    // Your diary, kept with your inbox (signed in), so it follows you to any phone.
    //   GET  /api/diary (signed) → entries   POST /api/diary (signed) { entry } → saved
    if (url.pathname === '/api/diary') {
      const me = await whoIs(request, env);
      if (!me) return new Response('sign in', { status: 401 });
      const user = env.ROOMS.getByName(`user:${me}`);
      if (request.method === 'POST') {
        const entry = cleanDiary((await request.json().catch(() => null))?.entry);
        if (!entry) return new Response('bad entry', { status: 400 });
        await user.saveDiary(entry);
        return Response.json({ ok: true });
      }
      return Response.json({ entries: await user.getDiary() });
    }

    // Letters: one link per conversation (a thread). You write 4 lines and send the link;
    // they write back into the same thread; anyone with the link can come back and see it all.
    //   POST /api/letter          { letter, author } → a new thread, { id }
    //   POST /api/letter/ID       { letter, author } → added to that thread
    //   GET  /api/letter/ID       → { id, letters: [...] }
    if (url.pathname === '/api/letter' && request.method === 'POST') {
      const body = await request.json().catch(() => null);
      const letter = cleanLetter(body?.letter, body?.author);
      if (!letter) return new Response('bad letter', { status: 400 });
      // Addressed to someone's inbox? You need to be signed in, and they need to exist.
      const me = await whoIs(request, env);
      const to = typeof body?.to === 'string' ? body.to.toLowerCase().replace(/^@/, '') : '';
      if (to && !me) return new Response('sign in to write to a name', { status: 401 });
      if (to && (!HANDLE.test(to) || !(await env.ROOMS.getByName(`user:${to}`).hasUser()))) return new Response('no such name', { status: 404 });
      if (me) letter.from = me;
      const id = letterId();
      const people = to ? [me, to].filter((h, i, all) => all.indexOf(h) === i) : me ? [me] : [];
      const { count } = await env.ROOMS.getByName(`letter:${id}`).addLetter(letter, false, people);
      await deliver(env, id, people, letter, count);
      return Response.json({ id, count });
    }
    // Made an inbox after writing letters as a guest? Bring those conversations into it:
    // POST /api/letter/ID/join (signed) { author } → you're in it, and the letters this
    // device wrote (same author id) are marked as yours.
    const joinMatch = url.pathname.match(/^\/api\/letter\/([a-z0-9]{8})\/join$/);
    if (joinMatch && request.method === 'POST') {
      const me = await whoIs(request, env);
      if (!me) return new Response('sign in', { status: 401 });
      const { author } = (await request.json().catch(() => null)) || {};
      const joined = await env.ROOMS.getByName(`letter:${joinMatch[1]}`).joinThread(me, typeof author === 'string' ? author : '');
      if (!joined) return new Response('no such letter', { status: 404 });
      // Into your inbox (at the top), and everyone else's row now shows your name (in place).
      const last = joined.letters.at(-1);
      await Promise.all(joined.people.map((h) => env.ROOMS.getByName(`user:${h}`).touchInbox({
        thread: joinMatch[1], with: joined.people.filter((x) => x !== h), lastFrom: last.from || null,
        count: joined.letters.length, line: last.messages[0], at: last.sent,
      }, h !== me)));
      return Response.json({ ok: true });
    }
    const letterMatch = url.pathname.match(/^\/api\/letter\/([a-z0-9]{8})$/);
    if (letterMatch) {
      const [, id] = letterMatch;
      const thread = env.ROOMS.getByName(`letter:${id}`);
      if (request.method === 'POST') {
        const body = await request.json().catch(() => null);
        const letter = cleanLetter(body?.letter, body?.author);
        if (!letter) return new Response('bad letter', { status: 400 });
        const me = await whoIs(request, env);
        if (me) letter.from = me;
        const added = await thread.addLetter(letter, true, me ? [me] : []);
        if (!added) return new Response('no such letter', { status: 404 });
        await deliver(env, id, added.people, letter, added.count);
        return Response.json({ id, count: added.count });
      }
      const letters = await thread.getThread();
      return letters ? Response.json({ id, letters, people: await thread.getPeople() }) : new Response('no such letter', { status: 404 });
    }

    // The word log. POST: count a one-screen game's message. GET: the top words (private).
    if (url.pathname === '/api/words') {
      const log = env.WORDS.getByName('global');
      if (request.method === 'POST') {
        const { text } = await request.json().catch(() => ({}));
        await log.record(wordsWorthCounting(String(text || '').slice(0, MAX_TEXT)));
        return new Response(null, { status: 204 });
      }
      // Locked with a secret once it's online (set it with: npx wrangler secret put WORDS_KEY).
      const local = ['localhost', '127.0.0.1'].includes(url.hostname);
      const allowed = env.WORDS_KEY ? url.searchParams.get('key') === env.WORDS_KEY : local;
      if (!allowed) return new Response('not allowed', { status: 403 });
      return Response.json(await log.top(500, Number(url.searchParams.get('min') || 2)));
    }

    return env.ASSETS.fetch(request);
  },
};

// A letter: up to 4 short lines, the writer's voice + colour, the seed (so the glyphs
// and the song come out the same for the reader), and an author: a random id each device
// makes for itself (no names, nothing personal), so a device knows which letters were its own.
const LETTER_LINES = 4;
const THREAD_MAX = 60; // letters kept per conversation
function cleanLetter(raw, author) {
  if (!raw || !Array.isArray(raw.messages)) return null;
  const messages = raw.messages.slice(0, LETTER_LINES).map((m) => String(m ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT)).filter(Boolean);
  if (!messages.length) return null;
  const word = (v) => (typeof v === 'string' && /^[a-z0-9]{1,20}$/.test(v) ? v : null);
  return {
    messages,
    voice: word(raw.voice) || 'marimba',
    color: word(raw.color) || 'sky',
    seed: Number.isInteger(raw.seed) ? raw.seed >>> 0 : Math.floor(Math.random() * 2 ** 31),
    author: typeof author === 'string' && /^[a-z0-9]{8,40}$/.test(author) ? author : null,
    sent: Date.now(),
  };
}
// Names: 3–16 of a-z, 0-9, _. Secret: one lowercase word (a few, for the earliest inboxes).
const HANDLE = /^[a-z0-9_]{3,16}$/;
const PHRASE = /^[a-z]{2,12}( [a-z]{2,12}){0,3}$/;

// Who's asking? A signed request carries x-handle + x-phrase; null if missing or wrong.
async function whoIs(request, env) {
  const handle = (request.headers.get('x-handle') || '').toLowerCase();
  const phrase = request.headers.get('x-phrase') || '';
  if (!HANDLE.test(handle) || !PHRASE.test(phrase)) return null;
  return (await env.ROOMS.getByName(`user:${handle}`).checkUser(phrase)) === 'ok' ? handle : null;
}

// A letter landed in a conversation: everyone in it sees it at the top of their inbox.
async function deliver(env, thread, people, letter, count) {
  await Promise.all(people.map((handle) => env.ROOMS.getByName(`user:${handle}`).touchInbox({
    thread,
    with: people.filter((h) => h !== handle),
    lastFrom: letter.from || null,
    count,
    line: letter.messages[0],
    at: letter.sent,
  })));
}

async function fingerprint(salt, phrase) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${salt}:${phrase}`));
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// A diary entry: its lines (up to 6), when it was written, and the voice/colour/seed to replay it.
function cleanDiary(raw) {
  if (!raw || typeof raw.id !== 'string' || !/^[a-z0-9]{6,24}$/.test(raw.id) || !Array.isArray(raw.lines)) return null;
  const lines = raw.lines.slice(0, 6).map((l) => String(l ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT)).filter(Boolean);
  if (!lines.length) return null;
  const word = (v) => (typeof v === 'string' && /^[a-z0-9]{1,20}$/.test(v) ? v : null);
  return {
    id: raw.id, lines, at: Number.isFinite(raw.at) ? raw.at : Date.now(),
    voice: word(raw.voice) || 'marimba', color: word(raw.color) || 'sky', seed: Number.isInteger(raw.seed) ? raw.seed >>> 0 : 0,
  };
}

function letterId() {
  const abc = 'abcdefghijkmnpqrstuvwxyz23456789';
  return [...crypto.getRandomValues(new Uint8Array(8))].map((b) => abc[b % abc.length]).join('');
}

export class Room extends DurableObject {
  // A letter thread lives in its own little Room (named letter:ID), just stored, no live connection.
  // (Letters from before threads were stored singly under 'letter': they read as a thread of one.)
  async getThread() {
    const letters = await this.ctx.storage.get('letters');
    if (letters) return letters;
    const single = await this.ctx.storage.get('letter');
    return single ? [single] : null;
  }

  // The names in this conversation (empty for a link-only letter).
  async getPeople() {
    return (await this.ctx.storage.get('people')) || [];
  }

  // Adds a letter; mustExist = it's a reply (a thread that isn't there → null).
  // join = names to add to the conversation (whoever wrote this letter, signed in).
  async addLetter(letter, mustExist, join = []) {
    const letters = await this.getThread();
    if (mustExist && !letters) return null;
    const next = [...(letters || []), letter].slice(-THREAD_MAX);
    const people = [...new Set([...(await this.getPeople()), ...join])];
    await this.ctx.storage.put({ letters: next, people });
    return { count: next.length, people };
  }

  // Someone signed in joins this conversation; letters their device wrote become theirs.
  async joinThread(handle, author) {
    const letters = await this.getThread();
    if (!letters) return null;
    const mine = (l) => author && l.author === author && !l.from;
    const next = letters.map((l) => (mine(l) ? { ...l, from: handle } : l));
    const people = [...new Set([...(await this.getPeople()), handle])];
    await this.ctx.storage.put({ letters: next, people });
    return { letters: next, people };
  }

  // ── an inbox (a Room named user:NAME) ──
  async hasUser() {
    return !!(await this.ctx.storage.get('user'));
  }

  async claimUser(handle, phrase) {
    if (await this.ctx.storage.get('user')) return false;
    const salt = crypto.randomUUID();
    await this.ctx.storage.put('user', { handle, salt, hash: await fingerprint(salt, phrase), created: Date.now(), fails: 0, lockedUntil: 0 });
    await this.ctx.storage.put('inbox', []);
    return true;
  }

  // 'ok' | 'bad' | 'none' | 'locked'. With a one-word secret, guessing is the risk:
  // 6 wrong tries locks the name for an hour.
  async checkUser(phrase) {
    const user = await this.ctx.storage.get('user');
    if (!user) return 'none';
    if (Date.now() < user.lockedUntil) return 'locked';
    if ((await fingerprint(user.salt, phrase)) === user.hash) {
      if (user.fails) await this.ctx.storage.put('user', { ...user, fails: 0 });
      return 'ok';
    }
    const fails = user.fails + 1;
    await this.ctx.storage.put('user', { ...user, fails: fails >= 6 ? 0 : fails, lockedUntil: fails >= 6 ? Date.now() + 60 * 60_000 : 0 });
    return 'bad';
  }

  async getDiary() {
    return (await this.ctx.storage.get('diary')) || [];
  }

  async saveDiary(entry) {
    const diary = (await this.getDiary()).filter((e) => e.id !== entry.id);
    diary.unshift(entry);
    diary.sort((a, b) => b.at - a.at);
    await this.ctx.storage.put('diary', diary.slice(0, 1000));
  }

  async getInbox() {
    return (await this.ctx.storage.get('inbox')) || [];
  }

  // A conversation changed: it moves to the top (or, keepPlace, just updates where it is).
  async touchInbox(entry, keepPlace = false) {
    const inbox = await this.getInbox();
    const at = inbox.findIndex((e) => e.thread === entry.thread);
    if (keepPlace && at >= 0) inbox[at] = entry;
    else {
      if (at >= 0) inbox.splice(at, 1);
      inbox.unshift(entry);
    }
    await this.ctx.storage.put('inbox', inbox.slice(0, 200));
  }

  // room = { mode, seed, players: [{ id, voice, color, entered } | null, …],
  //         order: [seats, in turn order] (set when a party starts), messages: [{ player, text }] }
  // The first person to open a room decides its mode (duet or party).
  async load(mode = 'duet') {
    if (this.room) return this.room;
    this.room = await this.ctx.storage.get('room');
    if (this.room) return this.room;
    // A new room: save it straight away. Cloudflare puts idle rooms to sleep (dropping
    // what's in memory), and an unsaved jam would wake up as a brand-new duet.
    this.room = {
      mode: MODES[mode] ? mode : 'duet',
      seed: Math.floor(Math.random() * 2 ** 31),
      players: Array(MODES[mode]?.seats || 2).fill(null),
      order: mode === 'party' ? null : [0, 1],
      started: mode === 'duet', // a party waits for its host, a jam for its screen
      prompts: mode === 'party', // parties answer a shared prompt by default
      messages: [],
    };
    await this.save();
    return this.room;
  }

  // Duet: a fixed number of messages. Party: open-ended (the rounds decide).
  total() {
    const mode = MODES[this.room.mode];
    return mode.perPlayer ? this.room.order.length * mode.perPlayer : Infinity;
  }

  // Party round bookkeeping: roundEnds = message counts where rounds finished.
  roundStart() {
    return this.room.roundEnds?.at(-1) ?? 0;
  }

  partyOver() {
    return (this.room.roundEnds?.length || 0) >= (this.room.rounds || 3);
  }

  async endRound(reason) {
    const room = this.room;
    if (room.messages.length <= this.roundStart()) return;
    room.roundEnds = [...(room.roundEnds || []), room.messages.length];
    await this.ctx.storage.deleteAlarm();
    await this.save();
    this.broadcast({ type: 'round', end: room.messages.length, rounds: room.rounds, final: this.partyOver(), reason });
  }

  // Timers: the party's 30-second safety net, or the end of a 90-second jam.
  async alarm() {
    await this.load();
    if (this.room.mode === 'party' && !this.partyOver()) await this.endRound('timeout');
    if (this.room.mode === 'jam' && this.room.started && !this.room.ended) await this.endJam();
  }

  // ── jam ──
  async jamMessage(ws, slot, msg) {
    const room = this.room;
    const isScreen = !!ws.deserializeAttachment()?.screen;
    if (msg.type === 'glyphs' && room.players[slot]) {
      // Your 4 buttons: one character each.
      const glyphs = (Array.isArray(msg.glyphs) ? msg.glyphs : []).slice(0, 4).map((g) => [...String(g)].slice(0, 1).join(''));
      if (glyphs.length === 4 && glyphs.every(Boolean)) room.players[slot].glyphs = glyphs;
      // …and a word for each, sung in the song when that glyph plays (blank = no word).
      const words = (Array.isArray(msg.words) ? msg.words : []).slice(0, 4);
      room.players[slot].words = [0, 1, 2, 3].map((i) => String(words[i] ?? '').replace(/[^\p{L}' ]/gu, '').trim().slice(0, 12));
      await this.save();
      this.broadcast({ type: 'room', room: this.publicRoom() });
    } else if (msg.type === 'tap' && room.started && !room.ended && room.players[slot]) {
      // Fire a glyph: relayed to the screen right away, and recorded for the song.
      const now = Date.now();
      this.lastTap ??= {};
      if (now - (this.lastTap[slot] || 0) < MODES.jam.minGap) return; // no machine-gunning
      this.lastTap[slot] = now;
      const button = Math.max(0, Math.min(3, msg.button | 0));
      if (room.taps.length < MODES.jam.maxTaps) room.taps.push([slot, button, now - room.jamStart]);
      this.toScreens({ type: 'tap', player: slot, button });
      if (room.taps.length % 50 === 0) await this.save(); // don't write storage on every tap
    } else if (msg.type === 'start' && isScreen && !room.started) {
      room.started = true;
      room.ended = false;
      room.jamStart = Date.now();
      room.taps = [];
      await this.ctx.storage.setAlarm(room.jamStart + MODES.jam.length);
      await this.save();
      this.broadcast({ type: 'room', room: this.publicRoom() });
    } else if (msg.type === 'end' && isScreen && room.started && !room.ended) {
      await this.endJam();
    } else if (msg.type === 'again' && isScreen) {
      Object.assign(room, { started: false, ended: false, taps: [], seed: Math.floor(Math.random() * 2 ** 31) });
      await this.ctx.storage.deleteAlarm();
      await this.save();
      this.broadcast({ type: 'reset', room: this.publicRoom() });
    }
  }

  async endJam() {
    this.room.ended = true;
    await this.ctx.storage.deleteAlarm();
    await this.save();
    this.broadcast({ type: 'room', room: this.publicRoom() });
    this.toScreens({ type: 'jam-end', taps: this.room.taps });
  }

  toScreens(message) {
    const text = JSON.stringify(message);
    for (const ws of this.ctx.getWebSockets()) {
      if (ws.deserializeAttachment()?.screen) try { ws.send(text); } catch { /* gone */ }
    }
  }

  async save() {
    await this.ctx.storage.put('room', this.room);
  }

  async fetch(request) {
    const url = new URL(request.url);
    const room = await this.load(url.searchParams.get('mode') || 'duet');
    const clientId = url.searchParams.get('id') || crypto.randomUUID();
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server);

    // A jam's shared screen isn't a player: it just watches, plays the sound, starts/ends the jam.
    if (room.mode === 'jam' && url.searchParams.get('role') === 'screen') {
      server.serializeAttachment({ clientId, slot: -1, screen: true });
      server.send(JSON.stringify({ type: 'welcome', you: -1, screen: true, room: this.publicRoom() }));
      return new Response(null, { status: 101, webSocket: client });
    }

    // Same browser coming back gets its old seat; otherwise the first empty one.
    let slot = room.players.findIndex((p) => p?.id === clientId);
    // New people take an empty seat (a party can be joined any time, while there's room).
    if (slot < 0) slot = room.players.findIndex((p) => p === null);
    if (slot < 0) {
      server.send(JSON.stringify({ type: 'full' }));
      server.close(4000, 'room full');
      return new Response(null, { status: 101, webSocket: client });
    }
    if (!room.players[slot]) {
      const taken = (key) => room.players.filter(Boolean).map((p) => p[key]);
      room.players[slot] = {
        id: clientId,
        voice: DEFAULT_VOICES.find((v) => !taken('voice').includes(v)),
        color: DEFAULT_COLORS.find((c) => !taken('color').includes(c)),
        entered: false,
      };
    }
    server.serializeAttachment({ clientId, slot });
    await this.save();

    server.send(JSON.stringify({ type: 'welcome', you: slot, room: this.publicRoom() }));
    // Someone (re)joining also gets the recordings of any spoken messages so far.
    for (const [key, voice] of await this.ctx.storage.list({ prefix: 'voice:' })) {
      server.send(JSON.stringify({ type: 'voice', index: Number(key.slice(6)), ...voice }));
    }
    this.broadcast({ type: 'room', room: this.publicRoom() });
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws, raw) {
    const room = await this.load();
    const { slot } = ws.deserializeAttachment() || {};
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    if (msg.type === 'say') {
      const text = String(msg.text || '').trim().replace(/\s+/g, ' ').slice(0, MAX_TEXT);
      if (!text || !room.started || room.messages.length >= this.total()) return;
      const mode = MODES[room.mode];
      if (room.mode === 'party') {
        // Party: no turns, but at most 2 messages per person per round.
        if (this.partyOver()) return;
        const mine = room.messages.slice(this.roundStart()).filter((m) => m.player === slot).length;
        if (mine >= mode.perRound) return;
      } else if (room.order[room.messages.length % room.order.length] !== slot) {
        return; // duet: not your turn
      }
      room.messages.push({ player: slot, text });
      const index = room.messages.length - 1;
      // A spoken message's recording: kept apart from the text, sent to both phones.
      const voice = typeof msg.voice?.data === 'string' && msg.voice.data.length <= MAX_VOICE
        ? { data: msg.voice.data, mime: String(msg.voice.mime || 'audio/webm').slice(0, 40) }
        : undefined;
      if (voice) await this.ctx.storage.put(`voice:${index}`, voice);
      await this.save();
      await this.env.WORDS.getByName('global').record(wordsWorthCounting(text));
      this.broadcast({ type: 'said', player: slot, text, index, voice });
      if (room.mode === 'party') {
        // First line of a round starts the safety-net timer; everyone having a line ends it.
        const inRound = room.messages.slice(this.roundStart());
        if (inRound.length === 1) await this.ctx.storage.setAlarm(Date.now() + mode.roundTimeout);
        const here = this.ctx.getWebSockets().map((w) => w.deserializeAttachment()?.slot);
        const everyone = [...new Set(here)].filter((i) => room.players[i]);
        if (everyone.every((i) => inRound.some((m) => m.player === i))) await this.endRound('everyone');
      }
    } else if (msg.type === 'settings') {
      const me = room.players[slot];
      if (!me) return;
      const others = room.players.filter((p, i) => p && i !== slot);
      // Instruments and colours are one-per-person: you can't take someone else's.
      if (typeof msg.voice === 'string' && !others.some((p) => p.voice === msg.voice)) me.voice = msg.voice.slice(0, 20);
      if (typeof msg.color === 'string' && !others.some((p) => p.color === msg.color)) me.color = msg.color.slice(0, 20);
      if (typeof msg.prompts === 'boolean' && slot === 0) room.prompts = msg.prompts; // shared prompts: host's call
      await this.save();
      this.broadcast({ type: 'room', room: this.publicRoom() });
    } else if (room.mode === 'jam') {
      await this.jamMessage(ws, slot, msg);
    } else if (msg.type === 'start') {
      // The party host starts it (needs at least 2 people here).
      if (room.mode !== 'party' || slot !== 0 || room.started) return;
      const here = new Set(this.ctx.getWebSockets().map((w) => w.deserializeAttachment()?.slot));
      if (here.size < 2) return;
      room.started = true;
      room.rounds = partyRounds(here.size);
      room.roundEnds = [];
      await this.save();
      this.broadcast({ type: 'room', room: this.publicRoom() });
    } else if (msg.type === 'entered') {
      // This player has left the lobby and is in the garden.
      if (room.players[slot]) room.players[slot].entered = true;
      await this.save();
      this.broadcast({ type: 'room', room: this.publicRoom() });
    } else if (msg.type === 'typing') {
      this.broadcast({ type: 'typing', player: slot }, ws);
    } else if (msg.type === 'again') {
      room.messages = [];
      room.roundEnds = [];
      await this.ctx.storage.deleteAlarm();
      room.seed = Math.floor(Math.random() * 2 ** 31);
      await this.ctx.storage.delete([...(await this.ctx.storage.list({ prefix: 'voice:' })).keys()]);
      await this.save();
      this.broadcast({ type: 'reset', room: this.publicRoom() });
    }
  }

  async webSocketClose(ws) {
    await this.load();
    this.broadcast({ type: 'room', room: this.publicRoom(ws) }, ws);
  }

  // What players see: no client ids, plus who's connected right now.
  publicRoom(leaving) {
    const online = new Set(this.ctx.getWebSockets().filter((ws) => ws !== leaving).map((ws) => ws.deserializeAttachment()?.slot));
    return {
      mode: this.room.mode,
      seed: this.room.seed,
      order: this.room.order,
      started: !!this.room.started,
      ended: !!this.room.ended,
      jamLength: this.room.mode === 'jam' ? MODES.jam.length : null,
      jamElapsed: this.room.mode === 'jam' && this.room.started ? Date.now() - this.room.jamStart : null,
      total: Number.isFinite(this.total()) ? this.total() : null,
      rounds: this.room.rounds || null,
      roundEnds: this.room.roundEnds || [],
      prompts: !!this.room.prompts,
      messages: this.room.messages,
      players: this.room.players.map((p, i) => (p ? { voice: p.voice, color: p.color, online: online.has(i), entered: !!p.entered, glyphs: p.glyphs || null, words: p.words || null } : null)),
    };
  }

  broadcast(message, except) {
    const text = JSON.stringify(message);
    for (const ws of this.ctx.getWebSockets()) {
      if (ws === except) continue;
      try { ws.send(text); } catch { /* already gone */ }
    }
  }
}
