// Glyph Garden server: serves the game, and runs one "Room" per duet code.
// A Room is a Durable Object: a tiny always-consistent server that both
// players' phones connect to over a WebSocket (a live two-way connection).

import { DurableObject } from 'cloudflare:workers';
import { WordLog, wordsWorthCounting } from './words.js';

export { WordLog };

const TOTAL = 8; // messages per duet (4 each)
const MAX_TEXT = 60; // characters per message (the game's box allows the same)
const CODE = /^[A-Z0-9]{4,8}$/;
// Starting picks for a new player: the first ones the other player isn't using.
const DEFAULT_VOICES = ['guitar', 'keys', 'flute', 'violin'];
const DEFAULT_COLORS = ['sky', 'peach', 'mint', 'lilac'];

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
  // room = { seed, players: [{ id, voice, color } | null, …], messages: [{ player, text }] }
  async load() {
    this.room ??= (await this.ctx.storage.get('room')) ?? {
      seed: Math.floor(Math.random() * 2 ** 31),
      players: [null, null],
      messages: [],
    };
    return this.room;
  }

  async save() {
    await this.ctx.storage.put('room', this.room);
  }

  async fetch(request) {
    const room = await this.load();
    const clientId = new URL(request.url).searchParams.get('id') || crypto.randomUUID();
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server);

    // Same browser coming back gets its old seat; otherwise the first empty one.
    let slot = room.players.findIndex((p) => p?.id === clientId);
    if (slot < 0) slot = room.players.findIndex((p) => p === null);
    if (slot < 0) {
      server.send(JSON.stringify({ type: 'full' }));
      server.close(4000, 'room full');
      return new Response(null, { status: 101, webSocket: client });
    }
    if (!room.players[slot]) {
      const other = room.players[1 - slot];
      room.players[slot] = {
        id: clientId,
        voice: DEFAULT_VOICES.find((v) => v !== other?.voice),
        color: DEFAULT_COLORS.find((c) => c !== other?.color),
        entered: false,
      };
    }
    server.serializeAttachment({ clientId, slot });
    await this.save();

    server.send(JSON.stringify({ type: 'welcome', you: slot, room: this.publicRoom() }));
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
      const yourTurn = room.messages.length % 2 === slot;
      if (!text || !yourTurn || room.messages.length >= TOTAL) return;
      room.messages.push({ player: slot, text });
      await this.save();
      await this.env.WORDS.getByName('global').record(wordsWorthCounting(text));
      this.broadcast({ type: 'said', player: slot, text, index: room.messages.length - 1 });
    } else if (msg.type === 'settings') {
      const me = room.players[slot];
      if (!me) return;
      const other = room.players[1 - slot];
      // Instruments and colours are one-per-person: you can't take your partner's.
      if (typeof msg.voice === 'string' && other?.voice !== msg.voice) me.voice = msg.voice.slice(0, 20);
      if (typeof msg.color === 'string' && other?.color !== msg.color) me.color = msg.color.slice(0, 20);
      if (typeof msg.prompts === 'boolean' && slot === 0) room.prompts = msg.prompts; // shared prompts: host's call
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
      room.seed = Math.floor(Math.random() * 2 ** 31);
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
      seed: this.room.seed,
      total: TOTAL,
      prompts: !!this.room.prompts,
      messages: this.room.messages,
      players: this.room.players.map((p, i) => (p ? { voice: p.voice, color: p.color, online: online.has(i), entered: !!p.entered } : null)),
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
