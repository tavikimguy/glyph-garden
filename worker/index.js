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
  jam: { seats: 8, length: 90_000, maxTaps: 4000, minGap: 70 },
};
const partyRounds = (people) => (people <= 4 ? 3 : 2);
const MAX_TEXT = 60; // characters per message (the game's box allows the same)
const MAX_VOICE = 400_000; // a spoken message's recording, base64 (8 s of compressed audio is far less)
const CODE = /^[A-Z0-9]{4,8}$/;
// Starting picks for a new player: the first ones the other player isn't using.
const DEFAULT_VOICES = ['guitar', 'keys', 'flute', 'violin', 'harp', 'marimba', 'cello', 'trumpet', 'ocarina', 'banjo'];
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

export class Room extends DurableObject {
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
