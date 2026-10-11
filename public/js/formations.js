// Interlude dances. Each pattern says where glyph g wants to be at time t;
// glyphs steer toward that point, so every pattern flows instead of snapping.
// `setup(rand)` rolls the settings so the same pattern looks different each time;
// rand is seeded, so both players' screens roll the very same settings.
//
// Glyph fields used: fi (index among all), fj (index within its player),
// fm (index within its message), player, msg.
// ctx: { W, H, cx, cy, R (comfortable radius), n, counts: [p1, p2], msgs, msgSize: [] }

import { PICTURES } from './pictures.js';

const pick = (rand, list) => list[Math.floor(rand() * list.length)];
const between = (rand, a, b) => a + rand() * (b - a);
const dir = (rand) => (rand() < 0.5 ? -1 : 1);
const TAU = Math.PI * 2;

export const FORMATIONS = {
  // Sunflower: the golden-angle spiral seeds grow in, slowly turning.
  sunflower: {
    setup: (rand) => ({ spin: dir(rand) * between(rand, 0.3, 0.7) }),
    at: (g, t, c, v) => {
      const r = Math.sqrt((g.fi + 0.5) / c.n) * c.R;
      const a = g.fi * 2.39996 + t * v.spin;
      return [c.cx + Math.cos(a) * r, c.cy + Math.sin(a) * r];
    },
  },

  // Galaxy: a few curved arms sweeping around the centre.
  galaxy: {
    setup: (rand) => ({ arms: pick(rand, [2, 3, 4, 5]), twist: between(rand, 2, 4) * dir(rand), spin: dir(rand) * between(rand, 0.2, 0.5) }),
    at: (g, t, c, v) => {
      const arm = g.fi % v.arms;
      const k = Math.floor(g.fi / v.arms) / Math.max(1, c.n / v.arms);
      const fluff = ((Math.sin(g.fi * 12.9898) * 43758.5453) % 1 + 1) % 1 - 0.5; // steady random scatter off the arm
      const r = (0.08 + 0.92 * k) * c.R * (1 + fluff * 0.25);
      const a = (arm / v.arms) * TAU + k * v.twist + t * v.spin + fluff * 0.35;
      return [c.cx + Math.cos(a) * r, c.cy + Math.sin(a) * r];
    },
  },

  // Helix: one strand per player, weaving around each other — the duet.
  helix: {
    setup: (rand) => ({ twists: between(rand, 1.5, 3), speed: dir(rand) * between(rand, 1.5, 2.5), tilt: between(rand, -0.25, 0.25) }),
    at: (g, t, c, v) => {
      const k = c.counts[g.player] > 1 ? g.fj / (c.counts[g.player] - 1) : 0.5;
      const along = (k - 0.5) * c.W * 0.84;
      const across = Math.sin(k * Math.PI * 2 * v.twists + t * v.speed + g.player * Math.PI) * c.H * 0.2;
      return [c.cx + along - across * Math.sin(v.tilt), c.cy + across + along * Math.sin(v.tilt)];
    },
  },

  // Orbits: one ring per message, neighbouring rings turning opposite ways.
  orbits: {
    setup: (rand) => ({ spin: between(rand, 0.3, 0.7), squash: between(rand, 0.6, 1) }),
    at: (g, t, c, v) => {
      const r = c.R * (0.25 + (0.75 * g.msg) / Math.max(1, c.msgs - 1));
      const a = (g.fm / c.msgSize[g.msg]) * TAU + t * v.spin * (g.msg % 2 ? 1 : -1);
      return [c.cx + Math.cos(a) * r, c.cy + Math.sin(a) * r * v.squash];
    },
  },

  // Wave: a grid rippling like a flag in wind.
  wave: {
    setup: (rand) => ({ freq: between(rand, 0.3, 0.7), speed: between(rand, 2, 4), height: between(rand, 0.02, 0.05) }),
    at: (g, t, c, v) => {
      const cols = Math.ceil(Math.sqrt((c.n * c.W) / c.H));
      const rows = Math.ceil(c.n / cols);
      const col = g.fi % cols;
      const row = Math.floor(g.fi / cols);
      const x = c.W * 0.1 + (col / Math.max(1, cols - 1)) * c.W * 0.8;
      const y = c.H * 0.2 + (row / Math.max(1, rows - 1)) * c.H * 0.6;
      return [x, y + Math.sin(col * v.freq - t * v.speed + row * 0.3) * v.height * c.H];
    },
  },

  // Heart: the two players trace one heart from opposite sides.
  heart: {
    setup: (rand) => ({ speed: dir(rand) * between(rand, 0.15, 0.3), beat: between(rand, 1.5, 2.5) }),
    at: (g, t, c, v) => {
      const k = g.fj / Math.max(1, c.counts[g.player]);
      const th = (g.player === 0 ? k * Math.PI : Math.PI + k * Math.PI) + t * v.speed;
      const pulse = 1 + Math.sin(t * v.beat * TAU) * 0.04;
      const s = (c.R / 17) * pulse;
      const x = 16 * Math.sin(th) ** 3;
      const y = 13 * Math.cos(th) - 5 * Math.cos(2 * th) - 2 * Math.cos(3 * th) - Math.cos(4 * th);
      return [c.cx + x * s, c.cy - y * s];
    },
  },

  // Lissajous: one looping curve, with a different knot every time.
  lissajous: {
    setup: (rand) => ({ ratio: pick(rand, [[1, 2], [3, 2], [2, 3]]), speed: dir(rand) * between(rand, 0.2, 0.4) }),
    at: (g, t, c, v) => {
      const th = (g.fi / c.n) * TAU + t * v.speed;
      const [a, b] = v.ratio;
      return [c.cx + Math.sin(a * th + t * 0.2) * c.W * 0.38, c.cy + Math.sin(b * th) * c.H * 0.34];
    },
  },

  // Rose: petals drawn by r = cos(kθ), slowly turning.
  rose: {
    setup: (rand) => ({ k: pick(rand, [2, 3, 4, 5, 6, 7]), spin: dir(rand) * between(rand, 0.15, 0.35) }),
    at: (g, t, c, v) => {
      const th = (g.fi / c.n) * Math.PI * (v.k % 2 ? 1 : 2) + t * 0.15;
      const r = Math.cos(v.k * th) * c.R * 1.05;
      const a = th + t * v.spin;
      return [c.cx + Math.cos(a) * r, c.cy + Math.sin(a) * r];
    },
  },

  // Binary stars: each player circles their own point; the two points circle each other.
  binary: {
    setup: (rand) => ({ spin: dir(rand) * between(rand, 0.3, 0.6), inner: dir(rand) * between(rand, 0.8, 1.4) }),
    at: (g, t, c, v) => {
      const centre = t * v.spin + g.player * Math.PI;
      const ox = c.cx + Math.cos(centre) * c.R * 0.5;
      const oy = c.cy + Math.sin(centre) * c.R * 0.5;
      const r = (0.15 + 0.85 * Math.sqrt(g.fj / Math.max(1, c.counts[g.player]))) * c.R * 0.42;
      const a = g.fj * 2.39996 + t * v.inner;
      return [ox + Math.cos(a) * r, oy + Math.sin(a) * r];
    },
  },

  // Conversation: two clusters leaning toward each other in turn, like talking.
  conversation: {
    setup: (rand) => ({ speed: between(rand, 1.5, 2.5), lean: between(rand, 0.06, 0.12) }),
    at: (g, t, c, v) => {
      const side = g.player === 0 ? -1 : 1;
      const lean = (Math.sin(t * v.speed + g.player * Math.PI) + 1) / 2;
      const ox = c.cx + side * c.W * (0.24 - lean * v.lean);
      const r = Math.sqrt((g.fj + 0.5) / Math.max(1, c.counts[g.player])) * c.R * 0.55;
      const a = g.fj * 2.39996 + t * 0.4 * side;
      return [ox + Math.cos(a) * r, c.cy + Math.sin(a) * r];
    },
  },

  // Starburst: rays from the centre, turning and stretching.
  starburst: {
    setup: (rand) => ({ rays: pick(rand, [6, 8, 10, 12]), spin: dir(rand) * between(rand, 0.1, 0.3), breathe: between(rand, 1, 2) }),
    at: (g, t, c, v) => {
      const ray = g.fi % v.rays;
      const k = (Math.floor(g.fi / v.rays) + 1) / Math.ceil(c.n / v.rays);
      const r = k * c.R * (1 + Math.sin(t * v.breathe + ray) * 0.12);
      const a = (ray / v.rays) * TAU + t * v.spin;
      return [c.cx + Math.cos(a) * r, c.cy + Math.sin(a) * r];
    },
  },

  // Bloom: concentric rings that breathe in and out one after another.
  bloom: {
    setup: (rand) => ({ rings: pick(rand, [4, 5, 6]), speed: between(rand, 1.5, 3), spin: dir(rand) * between(rand, 0.1, 0.3) }),
    at: (g, t, c, v) => {
      const ring = g.fi % v.rings;
      const inRing = Math.floor(g.fi / v.rings);
      const size = Math.ceil(c.n / v.rings);
      const r = c.R * ((ring + 1) / v.rings) * (1 + Math.sin(t * v.speed - ring * 0.8) * 0.1);
      const a = (inRing / size) * TAU + t * v.spin * (ring % 2 ? 1 : -1);
      return [c.cx + Math.cos(a) * r, c.cy + Math.sin(a) * r];
    },
  },

  // Tornado: a funnel spinning around a vertical axis, wide at the top.
  tornado: {
    setup: (rand) => ({ spin: dir(rand) * between(rand, 1.5, 2.5), sway: between(rand, 20, 60) }),
    at: (g, t, c, v) => {
      const k = g.fi / Math.max(1, c.n - 1);
      const y = c.H * 0.12 + k * c.H * 0.76;
      const r = (0.08 + (1 - k) * 0.92) * c.R * 0.9;
      const a = g.fi * 0.7 + t * v.spin;
      return [c.cx + Math.cos(a) * r + Math.sin(t + k * 3) * v.sway, y + Math.sin(a) * r * 0.15];
    },
  },

  // Ribbons: one sine ribbon per message, stacked, each with its own phase.
  ribbons: {
    setup: (rand) => ({ speed: dir(rand) * between(rand, 1.5, 3), waves: between(rand, 1, 2.5) }),
    at: (g, t, c, v) => {
      const k = g.fm / Math.max(1, c.msgSize[g.msg] - 1);
      const y0 = c.H * (0.15 + (0.7 * g.msg) / Math.max(1, c.msgs - 1));
      return [c.W * 0.08 + k * c.W * 0.84, y0 + Math.sin(k * TAU * v.waves + t * v.speed + g.msg) * c.H * 0.05];
    },
  },

  // Infinity: a figure-eight, the two players chasing each other around it.
  infinity: {
    setup: (rand) => ({ speed: dir(rand) * between(rand, 0.25, 0.5) }),
    at: (g, t, c, v) => {
      const k = g.fj / Math.max(1, c.counts[g.player]);
      const th = k * Math.PI + g.player * Math.PI + t * v.speed;
      const d = 1 + Math.sin(th) ** 2;
      return [c.cx + (Math.cos(th) / d) * c.W * 0.38, c.cy + ((Math.sin(th) * Math.cos(th)) / d) * c.H * 0.6];
    },
  },

  // Pulse grid: a square lattice, turning slowly, waves of pressure through it.
  lattice: {
    setup: (rand) => ({ spin: dir(rand) * between(rand, 0.1, 0.25), speed: between(rand, 2, 3) }),
    at: (g, t, c, v) => {
      const side = Math.ceil(Math.sqrt(c.n));
      const gap = (c.R * 1.7) / side;
      const lx = ((g.fi % side) - (side - 1) / 2) * gap;
      const ly = (Math.floor(g.fi / side) - (side - 1) / 2) * gap;
      const push = 1 + Math.sin(Math.hypot(lx, ly) * 0.03 - t * v.speed) * 0.08;
      const a = t * v.spin;
      return [c.cx + (lx * Math.cos(a) - ly * Math.sin(a)) * push, c.cy + (lx * Math.sin(a) + ly * Math.cos(a)) * push];
    },
  },
};

// The heart is drawn by its own formula above, but it counts as a picture.
export const PATTERN_NAMES = Object.keys(FORMATIONS).filter((name) => name !== 'heart');
export const PICTURE_NAMES = [...Object.keys(PICTURES), 'heart'];
Object.assign(FORMATIONS, PICTURES); // fish, bird, butterfly, flower, moon, star, sun, note, cat, boat, eye, tree
