// Picture dances: the glyphs line up along the outline of a little drawing
// (a fish, a bird, a flower…) that moves like the real thing.
// Drawings live in a -1…1 box (y points down); glyphs spread evenly along the lines.

const TAU = Math.PI * 2;
const between = (rand, a, b) => a + rand() * (b - a);
const dir = (rand) => (rand() < 0.5 ? -1 : 1);

// ── tiny drawing kit ──
function arc(cx, cy, rx, ry, from = 0, to = TAU, steps = 28) {
  const pts = [];
  for (let i = 0; i <= steps; i++) {
    const a = from + ((to - from) * i) / steps;
    pts.push([cx + Math.cos(a) * rx, cy + Math.sin(a) * ry]);
  }
  return pts;
}

function polar(fn, steps = 80) {
  const pts = [];
  for (let i = 0; i <= steps; i++) {
    const a = (TAU * i) / steps;
    const r = fn(a);
    pts.push([Math.cos(a) * r, Math.sin(a) * r]);
  }
  return pts;
}

// Turn strokes (lists of points) into something we can sample by distance.
// colors (optional): an [r, g, b] for each stroke (null = the player's own colour).
function shape(strokes, colors = []) {
  const segs = [];
  let total = 0;
  for (const [n, s] of strokes.entries()) {
    for (let i = 0; i < s.length - 1; i++) {
      const [ax, ay] = s[i];
      const [bx, by] = s[i + 1];
      const len = Math.hypot(bx - ax, by - ay);
      segs.push({ ax, ay, bx, by, len, start: total, color: colors[n] || null });
      total += len;
    }
  }
  return { segs, total };
}

// The point a fraction f (0…1) of the way along all the lines.
function pointAt({ segs, total }, f) {
  const d = f * total;
  let lo = 0;
  let hi = segs.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (segs[mid].start <= d) lo = mid;
    else hi = mid - 1;
  }
  const s = segs[lo];
  const k = s.len ? Math.min(1, (d - s.start) / s.len) : 0;
  return [s.ax + (s.bx - s.ax) * k, s.ay + (s.by - s.ay) * k, s.color];
}

const line = (...pts) => pts;
// a little zig-zag "Z"
const zed = (x, y, w) => [[x, y], [x + w, y], [x, y + w], [x + w, y + w]];
// a small flower of petals (for shaymin's ear)
const petals = (cx, cy, r) => polar((a) => r * (0.55 + 0.45 * Math.abs(Math.cos(a * 2.5))), 40).map(([x, y]) => [x + cx, y + cy]);

// Colours a picture can paint itself in.
const C = {
  yellow: [255, 222, 70], orange: [255, 150, 50], red: [255, 80, 80], green: [110, 215, 105],
  olive: [150, 185, 70], leaf: [90, 190, 90], brown: [190, 130, 80], tan: [235, 195, 140],
  cream: [250, 235, 190], white: [245, 245, 255], ink: [125, 125, 145], pink: [255, 150, 200],
  purple: [170, 100, 255], blue: [90, 160, 255], sky: [140, 210, 255], amber: [255, 185, 60],
  wine: [200, 40, 90], silver: [200, 210, 225], grey: [160, 165, 180],
};

// ── the drawings ──
const STAR = [];
for (let i = 0; i <= 10; i++) {
  const a = -Math.PI / 2 + (i * Math.PI) / 5;
  const r = i % 2 ? 0.38 : 0.9;
  STAR.push([Math.cos(a) * r, Math.sin(a) * r]);
}

const DRAWINGS = {
  fish: shape([
    arc(-0.15, 0, 0.6, 0.36),
    [[0.42, 0], [0.92, -0.38], [0.85, 0], [0.92, 0.38], [0.42, 0]],
    arc(-0.5, -0.08, 0.06, 0.06, 0, TAU, 10),
    arc(-0.05, 0, 0.12, 0.25, -1.2, 1.2, 10), // gill
  ]),
  bird: shape([
    arc(-0.45, 0.05, 0.45, 0.35, Math.PI * 1.05, Math.PI * 1.95, 18),
    arc(0.45, 0.05, 0.45, 0.35, Math.PI * 1.05, Math.PI * 1.95, 18),
    arc(0, 0.12, 0.12, 0.08, 0, TAU, 10),
  ]),
  butterfly: shape([
    arc(-0.42, -0.3, 0.38, 0.32), arc(0.42, -0.3, 0.38, 0.32),
    arc(-0.3, 0.35, 0.26, 0.24), arc(0.3, 0.35, 0.26, 0.24),
    [[0, -0.55], [0, 0.6]],
    [[0, -0.55], [-0.2, -0.85]], [[0, -0.55], [0.2, -0.85]],
  ]),
  flower: shape([
    polar((a) => 0.25 + 0.4 * Math.abs(Math.cos(a * 2.5))).map(([x, y]) => [x, y - 0.3]),
    arc(0, -0.3, 0.12, 0.12, 0, TAU, 12),
    [[0, 0.15], [0, 0.95]],
    arc(0.18, 0.6, 0.18, 0.08, 0, TAU, 12),
  ]),
  moon: shape([
    arc(0, 0, 0.8, 0.8, Math.PI * 0.35, Math.PI * 1.65, 32),
    arc(0.35, 0, 0.62, 0.62, Math.PI * 0.62, Math.PI * 1.38, 24).reverse(),
  ]),
  star: shape([STAR]),
  sun: shape([
    arc(0, 0, 0.42, 0.42),
    ...Array.from({ length: 12 }, (_, i) => {
      const a = (i / 12) * TAU;
      return [[Math.cos(a) * 0.55, Math.sin(a) * 0.55], [Math.cos(a) * 0.85, Math.sin(a) * 0.85]];
    }),
  ], [C.yellow, ...Array(12).fill(C.orange)]),
  note: shape([
    arc(-0.35, 0.6, 0.25, 0.18),
    [[-0.1, 0.6], [-0.1, -0.85]],
    [[-0.1, -0.85], [0.25, -0.65], [0.45, -0.35], [0.35, -0.1]],
  ]),
  cat: shape([
    arc(0, 0.1, 0.62, 0.55),
    [[-0.55, -0.15], [-0.5, -0.8], [-0.15, -0.42]],
    [[0.55, -0.15], [0.5, -0.8], [0.15, -0.42]],
    arc(-0.22, 0, 0.07, 0.1, 0, TAU, 8), arc(0.22, 0, 0.07, 0.1, 0, TAU, 8),
    [[-0.3, 0.25], [-0.85, 0.15]], [[-0.3, 0.32], [-0.85, 0.4]],
    [[0.3, 0.25], [0.85, 0.15]], [[0.3, 0.32], [0.85, 0.4]],
  ]),
  boat: shape([
    [[-0.75, 0.25], [0.75, 0.25], [0.5, 0.5], [-0.5, 0.5], [-0.75, 0.25]],
    [[0, 0.25], [0, -0.85]],
    [[0, -0.8], [0.55, 0.15], [0, 0.15]],
    Array.from({ length: 25 }, (_, i) => [-1 + i / 12, 0.68 + Math.sin(i * 0.9) * 0.05]),
  ]),
  eye: shape([
    arc(0, 0.45, 0.95, 0.75, Math.PI * 1.2, Math.PI * 1.8, 20),
    arc(0, -0.45, 0.95, 0.75, Math.PI * 0.2, Math.PI * 0.8, 20),
    arc(0, 0, 0.22, 0.22, 0, TAU, 16),
  ]),
  frog: shape([
    arc(0, 0.2, 0.78, 0.5),
    arc(-0.38, -0.32, 0.22, 0.22), arc(0.38, -0.32, 0.22, 0.22),
    arc(-0.38, -0.32, 0.07, 0.07, 0, TAU, 8), arc(0.38, -0.32, 0.07, 0.07, 0, TAU, 8),
    arc(0, 0.22, 0.42, 0.2, Math.PI * 0.15, Math.PI * 0.85, 16),
  ]),
  cloud: shape([
    [[-0.8, 0.25], [0.8, 0.25]],
    arc(-0.5, 0.25, 0.3, 0.32, Math.PI, Math.PI * 2, 14),
    arc(0, 0.1, 0.42, 0.5, Math.PI, Math.PI * 2, 18),
    arc(0.5, 0.25, 0.3, 0.32, Math.PI, Math.PI * 2, 14),
  ]),
  rain: shape([
    [[-0.6, -0.25], [0.6, -0.25]],
    arc(-0.35, -0.25, 0.25, 0.25, Math.PI, Math.PI * 2, 12),
    arc(0.05, -0.38, 0.33, 0.38, Math.PI, Math.PI * 2, 14),
    arc(0.4, -0.25, 0.2, 0.22, Math.PI, Math.PI * 2, 10),
    ...[-0.5, -0.25, 0, 0.25, 0.5].map((x, i) => [[x, -0.05 + (i % 2) * 0.12], [x - 0.08, 0.3 + (i % 2) * 0.12]]),
    ...[-0.38, -0.12, 0.12, 0.38].map((x, i) => [[x, 0.45 + (i % 2) * 0.1], [x - 0.08, 0.8 + (i % 2) * 0.1]]),
  ]),
  monkey: shape([
    arc(0, 0, 0.55, 0.55),
    arc(-0.66, -0.05, 0.2, 0.22), arc(0.66, -0.05, 0.2, 0.22),
    arc(0, 0.22, 0.36, 0.25),
    arc(-0.2, -0.15, 0.06, 0.08, 0, TAU, 8), arc(0.2, -0.15, 0.06, 0.08, 0, TAU, 8),
    arc(0, 0.22, 0.15, 0.09, Math.PI * 0.15, Math.PI * 0.85, 8),
  ], [C.brown, C.brown, C.brown, C.tan, C.ink, C.ink, C.ink]),
  turtle: shape([
    arc(-0.05, 0.15, 0.62, 0.55, Math.PI, TAU, 24),
    line([-0.67, 0.15], [0.57, 0.15]),
    line([-0.35, 0.15], [-0.2, -0.15], [0.1, -0.15], [0.25, 0.15]),
    line([-0.2, -0.15], [-0.3, -0.33]), line([0.1, -0.15], [0.2, -0.33]),
    arc(0.78, 0.02, 0.16, 0.14),
    arc(-0.42, 0.28, 0.12, 0.12, 0, Math.PI, 8), arc(0.3, 0.28, 0.12, 0.12, 0, Math.PI, 8),
  ], [C.green, C.green, C.olive, C.olive, C.olive, C.leaf, C.leaf, C.leaf]),
  dino: shape([
    arc(-0.05, 0.25, 0.5, 0.3),
    line([0.3, 0.05], [0.5, -0.35], [0.62, -0.6]),
    arc(0.72, -0.64, 0.15, 0.09),
    line([-0.5, 0.3], [-0.95, 0.45]),
    line([-0.3, 0.5], [-0.3, 0.85]), line([-0.05, 0.53], [-0.05, 0.85]), line([0.2, 0.5], [0.2, 0.85]),
    line([-0.4, 0.0], [-0.3, -0.12], [-0.2, 0.0], [-0.1, -0.12], [0, 0.0], [0.1, -0.12], [0.2, 0.0]),
  ], [C.green, C.green, C.green, C.green, C.leaf, C.leaf, C.leaf, C.orange]),
  olive: shape([
    arc(0, 0.05, 0.5, 0.72),
    arc(0, 0.05, 0.15, 0.24, 0, TAU, 14),
    line([0, -0.67], [0.05, -0.95]),
  ], [C.olive, C.red, C.brown]),
  pizza: shape([
    line([-0.7, -0.55], [0, 0.9], [0.7, -0.55]),
    line([-0.78, -0.62], [0.78, -0.62]), line([-0.72, -0.72], [0.72, -0.72]),
    arc(-0.25, -0.25, 0.12, 0.12, 0, TAU, 10), arc(0.22, -0.3, 0.12, 0.12, 0, TAU, 10), arc(0, 0.25, 0.11, 0.11, 0, TAU, 10),
  ], [C.yellow, C.brown, C.brown, C.red, C.red, C.red]),
  taco: shape([
    arc(0, -0.15, 0.8, 0.75, 0, Math.PI, 26),
    Array.from({ length: 17 }, (_, i) => [-0.75 + i * 0.094, -0.18 + Math.sin(i * 1.6) * 0.08]),
    arc(-0.3, -0.3, 0.09, 0.09, 0, TAU, 8), arc(0.05, -0.33, 0.09, 0.09, 0, TAU, 8), arc(0.38, -0.3, 0.09, 0.09, 0, TAU, 8),
    line([-0.55, -0.1], [0.55, -0.1]),
  ], [C.yellow, C.green, C.red, C.red, C.red, C.brown]),
  football: shape([
    arc(0, 0, 0.88, 0.48, 0, TAU, 32),
    line([-0.3, 0], [0.3, 0]),
    ...[-0.2, -0.07, 0.07, 0.2].map((x) => line([x, -0.09], [x, 0.09])),
    arc(-0.55, 0, 0.12, 0.33, -1.2, 1.2, 8), arc(0.55, 0, 0.12, 0.33, Math.PI - 1.2, Math.PI + 1.2, 8),
  ], [C.brown, C.white, C.white, C.white, C.white, C.white, C.white, C.white]),
  baseball: shape([
    arc(0, 0, 0.72, 0.72),
    arc(-1.0, 0, 0.55, 0.62, -0.9, 0.9, 14), arc(1.0, 0, 0.55, 0.62, Math.PI - 0.9, Math.PI + 0.9, 14),
  ], [C.white, C.red, C.red]),
  videogames: shape([
    [...arc(-0.5, 0.05, 0.38, 0.4, Math.PI * 0.5, Math.PI * 1.5, 14), ...arc(0.5, 0.05, 0.38, 0.4, -Math.PI * 0.5, Math.PI * 0.5, 14), [-0.5, 0.45]],
    line([-0.68, 0.05], [-0.32, 0.05]), line([-0.5, -0.13], [-0.5, 0.23]),
    arc(0.45, -0.1, 0.07, 0.07, 0, TAU, 8), arc(0.62, 0.05, 0.07, 0.07, 0, TAU, 8),
    arc(0.28, 0.05, 0.07, 0.07, 0, TAU, 8), arc(0.45, 0.2, 0.07, 0.07, 0, TAU, 8),
  ], [C.grey, C.white, C.white, C.red, C.blue, C.green, C.yellow]),
  pikachu: shape([
    arc(0, 0.2, 0.6, 0.52),
    line([-0.42, -0.18], [-0.7, -0.75], [-0.22, -0.3]), line([0.42, -0.18], [0.7, -0.75], [0.22, -0.3]),
    line([-0.6, -0.55], [-0.7, -0.75], [-0.55, -0.62]), line([0.6, -0.55], [0.7, -0.75], [0.55, -0.62]),
    arc(-0.22, 0.08, 0.07, 0.07, 0, TAU, 8), arc(0.22, 0.08, 0.07, 0.07, 0, TAU, 8),
    arc(-0.42, 0.32, 0.12, 0.11, 0, TAU, 10), arc(0.42, 0.32, 0.12, 0.11, 0, TAU, 10),
    line([-0.12, 0.33], [-0.06, 0.4], [0, 0.34], [0.06, 0.4], [0.12, 0.33]),
  ], [C.yellow, C.yellow, C.yellow, C.ink, C.ink, C.ink, C.ink, C.red, C.red, C.ink]),
  charmander: shape([
    arc(-0.1, -0.45, 0.33, 0.3),
    arc(-0.1, 0.28, 0.36, 0.42),
    arc(-0.1, 0.33, 0.2, 0.28, 0, TAU, 14),
    line([0.22, 0.5], [0.5, 0.45], [0.68, 0.2], [0.72, -0.05]),
    arc(0.74, -0.25, 0.13, 0.2, 0, TAU, 12),
    arc(0.74, -0.2, 0.06, 0.1, 0, TAU, 8),
    arc(-0.2, -0.5, 0.05, 0.07, 0, TAU, 8), arc(0.04, -0.5, 0.05, 0.07, 0, TAU, 8),
  ], [C.orange, C.orange, C.cream, C.orange, C.red, C.yellow, C.ink, C.ink]),
  shaymin: shape([
    arc(0, 0.28, 0.68, 0.32, 0, Math.PI, 20),
    Array.from({ length: 25 }, (_, i) => {
      const a = Math.PI + (i / 24) * Math.PI;
      const bump = 1 + 0.12 * Math.abs(Math.sin(i * 1.3));
      return [Math.cos(a) * 0.68 * bump, 0.28 + Math.sin(a) * 0.55 * bump];
    }),
    petals(-0.45, -0.2, 0.2),
    arc(0.25, 0.25, 0.05, 0.07, 0, TAU, 8), arc(0.45, 0.25, 0.05, 0.07, 0, TAU, 8),
  ], [C.white, C.green, C.pink, C.ink, C.ink]),
  dog: shape([
    arc(0, 0, 0.5, 0.5),
    arc(-0.55, 0.08, 0.17, 0.38), arc(0.55, 0.08, 0.17, 0.38),
    arc(0, 0.17, 0.09, 0.07, 0, TAU, 8),
    arc(-0.18, -0.1, 0.06, 0.07, 0, TAU, 8), arc(0.18, -0.1, 0.06, 0.07, 0, TAU, 8),
    arc(0, 0.42, 0.08, 0.12, 0, Math.PI, 8),
  ], [C.tan, C.brown, C.brown, C.ink, C.ink, C.ink, C.pink]),
  drinks: shape([
    line([-0.7, -0.7], [0.7, -0.7], [0, 0.05], [-0.7, -0.7]),
    line([0, 0.05], [0, 0.75]), line([-0.35, 0.8], [0.35, 0.8]),
    line([-0.55, -0.55], [0.55, -0.55]),
    arc(0.12, -0.38, 0.1, 0.1, 0, TAU, 10), arc(0.12, -0.38, 0.04, 0.04, 0, TAU, 6),
    line([-0.15, -0.85], [0.3, -0.2]),
  ], [C.silver, C.silver, C.silver, C.sky, C.olive, C.red, C.brown]),
  beer: shape([
    line([-0.45, -0.45], [-0.45, 0.8], [0.35, 0.8], [0.35, -0.45]),
    arc(0.35, 0.15, 0.3, 0.32, -Math.PI / 2, Math.PI / 2, 12),
    arc(-0.3, -0.45, 0.16, 0.16, Math.PI, TAU, 8), arc(-0.05, -0.5, 0.18, 0.18, Math.PI, TAU, 8), arc(0.22, -0.45, 0.15, 0.15, Math.PI, TAU, 8),
    ...[[-0.2, 0.5], [0.05, 0.25], [-0.1, 0]].map(([x, y]) => arc(x, y, 0.05, 0.05, 0, TAU, 6)),
  ], [C.amber, C.amber, C.white, C.white, C.white, C.cream, C.cream, C.cream]),
  wine: shape([
    arc(0, -0.4, 0.45, 0.5, 0, Math.PI, 18),
    line([-0.45, -0.4], [-0.45, -0.75]), line([0.45, -0.4], [0.45, -0.75]),
    [...arc(0, -0.4, 0.38, 0.42, 0.15, Math.PI - 0.15, 14), [0.37, -0.34]],
    line([0, 0.1], [0, 0.75]), line([-0.32, 0.8], [0.32, 0.8]),
  ], [C.silver, C.silver, C.silver, C.wine, C.silver, C.silver]),
  beach: shape([
    line([0.05, 0.75], [0.08, 0.3], [0.15, -0.15], [0.25, -0.45]),
    ...[-2.6, -2.0, -1.3, -0.6, 0.0].map((a) => arc(0.25 + Math.cos(a) * 0.3, -0.45 + Math.sin(a) * 0.15, 0.32, 0.18, a + Math.PI * 0.6, a + Math.PI * 1.4, 8)),
    Array.from({ length: 25 }, (_, i) => [-1 + i / 12, 0.78 + Math.sin(i * 0.9) * 0.05]),
    arc(-0.6, -0.55, 0.16, 0.16),
  ], [C.brown, C.leaf, C.leaf, C.leaf, C.leaf, C.leaf, C.blue, C.yellow]),
  mountain: shape([
    line([-0.95, 0.7], [-0.4, -0.3], [-0.1, 0.1], [0.3, -0.75], [0.95, 0.7], [-0.95, 0.7]),
    line([0.1, -0.4], [0.2, -0.32], [0.3, -0.45], [0.4, -0.32], [0.5, -0.42]),
    line([-0.55, -0.05], [-0.45, 0], [-0.38, -0.08], [-0.27, -0.05]),
  ], [C.grey, C.white, C.white]),
  snow: shape([
    ...Array.from({ length: 6 }, (_, i) => {
      const a = (i / 6) * TAU;
      return [[0, 0], [Math.cos(a) * 0.85, Math.sin(a) * 0.85]];
    }),
    ...Array.from({ length: 6 }, (_, i) => {
      const a = (i / 6) * TAU;
      const [mx, my] = [Math.cos(a) * 0.5, Math.sin(a) * 0.5];
      return [[mx + Math.cos(a + 0.8) * 0.22, my + Math.sin(a + 0.8) * 0.22], [mx, my], [mx + Math.cos(a - 0.8) * 0.22, my + Math.sin(a - 0.8) * 0.22]];
    }),
  ], [...Array(6).fill(C.white), ...Array(6).fill(C.sky)]),
  sleepy: shape([
    zed(-0.75, 0.25, 0.4), zed(-0.15, -0.2, 0.32), zed(0.35, -0.6, 0.24),
    arc(0.55, 0.45, 0.3, 0.3, Math.PI * 0.35, Math.PI * 1.65, 18),
  ], [[200, 180, 255], [200, 180, 255], [200, 180, 255], C.yellow]),
  halloween: shape([
    arc(0, 0.1, 0.78, 0.62),
    arc(-0.3, 0.1, 0.25, 0.6, Math.PI * 0.5, Math.PI * 1.5, 14), arc(0.3, 0.1, 0.25, 0.6, -Math.PI * 0.5, Math.PI * 0.5, 14),
    line([0, -0.52], [0.06, -0.85]),
    line([-0.42, -0.12], [-0.28, -0.32], [-0.14, -0.12], [-0.42, -0.12]),
    line([0.14, -0.12], [0.28, -0.32], [0.42, -0.12], [0.14, -0.12]),
    line([-0.45, 0.25], [-0.3, 0.4], [-0.15, 0.28], [0, 0.42], [0.15, 0.28], [0.3, 0.4], [0.45, 0.25]),
  ], [C.orange, C.orange, C.orange, C.green, C.purple, C.purple, C.purple]),
  tree: shape([
    [[-0.08, 0.95], [-0.08, 0.45], [0.08, 0.45], [0.08, 0.95]],
    [[-0.7, 0.45], [0, -0.05], [0.7, 0.45], [-0.7, 0.45]],
    [[-0.55, 0.05], [0, -0.45], [0.55, 0.05]],
    [[-0.38, -0.32], [0, -0.85], [0.38, -0.32]],
  ]),
};

// How each drawing moves. (x, y) is a point of the drawing; return where it goes now.
const MOTION = {
  fish: (x, y, t, v) => {
    const wag = x > 0.4 ? Math.sin(t * 7) * 0.18 * (x - 0.4) : 0;
    return [x + Math.sin(t * 0.6) * 0.35 * v.dir, y + wag + Math.sin(t * 1.3) * 0.06];
  },
  bird: (x, y, t) => [x + Math.sin(t * 0.5) * 0.3, y + Math.sin(t * 4.5) * 0.4 * Math.abs(x) - Math.sin(t * 0.8) * 0.15],
  butterfly: (x, y, t) => [x * (0.35 + 0.65 * Math.abs(Math.cos(t * 3))), y + Math.sin(t * 1.1) * 0.12],
  flower: (x, y, t) => {
    if (y > 0.15) return [x + Math.sin(t * 1.2) * 0.05 * (1 - y), y]; // the stem sways
    const a = t * 0.4;
    const dy = y + 0.3;
    return [x * Math.cos(a) - dy * Math.sin(a), x * Math.sin(a) + dy * Math.cos(a) - 0.3];
  },
  moon: (x, y, t) => [x + Math.sin(t * 0.5) * 0.08, y + Math.cos(t * 0.5) * 0.08],
  star: (x, y, t) => {
    const a = t * 0.5;
    const s = 1 + Math.sin(t * 3) * 0.08;
    return [(x * Math.cos(a) - y * Math.sin(a)) * s, (x * Math.sin(a) + y * Math.cos(a)) * s];
  },
  sun: (x, y, t) => {
    const r = Math.hypot(x, y);
    const s = r > 0.5 ? 1 + Math.sin(t * 3 + Math.atan2(y, x) * 3) * 0.1 : 1;
    return [x * s, y * s];
  },
  note: (x, y, t) => [x, y - Math.abs(Math.sin(t * 3)) * 0.2],
  cat: (x, y, t) => [x + Math.sin(t * 1.2) * 0.06, y + (Math.abs(x) > 0.3 && y > 0.1 ? Math.sin(t * 5) * 0.03 : 0)],
  boat: (x, y, t) => {
    const tilt = Math.sin(t * 1.4) * 0.12;
    return [x * Math.cos(tilt) - y * Math.sin(tilt), x * Math.sin(tilt) + y * Math.cos(tilt) + Math.sin(t * 1.4) * 0.05];
  },
  eye: (x, y, t) => {
    const blink = Math.abs(Math.sin(t * 0.7)) < 0.08 ? 0.15 : 1;
    const inIris = Math.hypot(x, y) < 0.3;
    return [x + (inIris ? Math.sin(t * 0.9) * 0.35 : 0), y * blink];
  },
  monkey: (x, y, t) => {
    const tilt = Math.sin(t * 2) * 0.15;
    return [x * Math.cos(tilt) - y * Math.sin(tilt) + Math.sin(t * 1.1) * 0.1, x * Math.sin(tilt) + y * Math.cos(tilt) - Math.abs(Math.sin(t * 2.2)) * 0.1];
  },
  turtle: (x, y, t) => [x + Math.sin(t * 0.3) * 0.3, y + (y > 0.2 ? Math.sin(t * 3 + x * 4) * 0.04 : 0)], // slow walk, paddling legs
  dino: (x, y, t) => (x > 0.25 && y < 0.1 ? [x + Math.sin(t * 1.2) * 0.12 * (0.1 - y), y] : [x + Math.sin(t * 0.4) * 0.15, y]), // the long neck sways
  olive: (x, y, t) => {
    const a = Math.sin(t * 0.8) * 0.3;
    return [x * Math.cos(a) - y * Math.sin(a), x * Math.sin(a) + y * Math.cos(a)];
  },
  pizza: (x, y, t) => [x, y + (y > 0.3 ? Math.sin(t * 2) * 0.08 * y : 0) + Math.sin(t * 1.3) * 0.05], // the cheesy tip droops
  taco: (x, y, t) => [x + Math.sin(t * 1.5) * 0.05, y - Math.abs(Math.sin(t * 2)) * 0.12],
  football: (x, y, t) => {
    const a = -0.4 + Math.sin(t * 0.5) * 0.15;
    const spin = Math.cos(t * 6); // a tight spiral
    const yy = y * spin;
    return [x * Math.cos(a) - yy * Math.sin(a) + Math.sin(t * 0.5) * 0.3, x * Math.sin(a) + yy * Math.cos(a)];
  },
  baseball: (x, y, t) => {
    const a = t * 2;
    return [x * Math.cos(a) - y * Math.sin(a), x * Math.sin(a) + y * Math.cos(a) - Math.abs(Math.sin(t * 1.5)) * 0.2];
  },
  videogames: (x, y, t) => {
    const a = Math.sin(t * 5) * 0.06; // button mashing
    return [x * Math.cos(a) - y * Math.sin(a), x * Math.sin(a) + y * Math.cos(a)];
  },
  pikachu: (x, y, t) => [x + (y < -0.2 ? Math.sin(t * 6) * 0.04 : 0), y - Math.abs(Math.sin(t * 2.5)) * 0.12],
  charmander: (x, y, t) => {
    if (x > 0.6 && y < 0) return [x + Math.sin(t * 9 + y * 10) * 0.05, y * (1 + Math.sin(t * 11) * 0.1)]; // the tail flame flickers
    return [x + Math.sin(t * 1.2) * 0.05, y];
  },
  shaymin: (x, y, t) => [x + Math.sin(t * 0.7) * 0.15, y - Math.abs(Math.sin(t * 1.8)) * 0.08],
  dog: (x, y, t) => {
    const ear = Math.abs(x) > 0.4 ? Math.sin(t * 6) * 0.06 : 0; // floppy ears flap
    const tilt = Math.sin(t * 1.1) * 0.12;
    return [x * Math.cos(tilt) - y * Math.sin(tilt), x * Math.sin(tilt) + y * Math.cos(tilt) + ear];
  },
  drinks: (x, y, t) => {
    const a = Math.sin(t * 1.2) * 0.1;
    return [x * Math.cos(a) - y * Math.sin(a), x * Math.sin(a) + y * Math.cos(a)];
  },
  beer: (x, y, t) => {
    const a = Math.max(0, Math.sin(t * 0.9)) * 0.25; // cheers!
    return [x * Math.cos(a) - y * Math.sin(a), x * Math.sin(a) + y * Math.cos(a) - (y < -0.4 ? Math.abs(Math.sin(t * 3 + x * 5)) * 0.04 : 0)];
  },
  wine: (x, y, t) => [x + (y < -0.2 && y > -0.45 ? Math.sin(t * 3 + x * 3) * 0.04 : 0), y + Math.sin(t * 0.8) * 0.04], // a swirl
  beach: (x, y, t) => {
    if (y > 0.7) return [x + Math.sin(t * 1.2) * 0.08, y]; // the waves roll
    if (y < -0.2 && x > -0.4) return [x + Math.sin(t * 1.4) * 0.06 * (0.4 - y), y]; // the palm sways
    return [x, y];
  },
  mountain: (x, y, t) => [x + Math.sin(t * 0.3) * 0.05, y + Math.sin(t * 0.5) * 0.03],
  snow: (x, y, t) => {
    const a = t * 0.4;
    return [x * Math.cos(a) - y * Math.sin(a) + Math.sin(t * 0.6) * 0.15, x * Math.sin(a) + y * Math.cos(a) + Math.sin(t * 0.3) * 0.1];
  },
  sleepy: (x, y, t) => (x < 0.25 || y < 0 ? [x + Math.sin(t + y * 3) * 0.04, y - ((t * 0.15) % 0.3)] : [x, y + Math.sin(t * 0.6) * 0.03]), // the Zs float up
  halloween: (x, y, t) => {
    const flicker = 1 + Math.sin(t * 8) * Math.sin(t * 3.1) * 0.05;
    return [x * flicker, y * flicker + Math.sin(t * 1.5) * 0.05];
  },
  tree: (x, y, t) => [x + Math.sin(t * 1.3) * 0.08 * Math.max(0, 0.5 - y), y],
  frog: (x, y, t) => [x, y - Math.abs(Math.sin(t * 2.5)) * 0.3], // hop hop
  cloud: (x, y, t) => [x + Math.sin(t * 0.4) * 0.3, y + Math.sin(t * 0.9) * 0.04],
  rain: (x, y, t) => (y > -0.1 ? [x, -0.1 + ((y + 0.1 + t * 0.6) % 1)] : [x + Math.sin(t * 0.5) * 0.05, y]), // drops fall and loop
};

// A picture only appears once one of its words has been said in the conversation.
export const PICTURE_WORDS = {
  fish: ['fish', 'fishes', 'fishing'],
  bird: ['bird', 'birds', 'fly', 'flying', 'wings'],
  butterfly: ['butterfly', 'butterflies'],
  flower: ['flower', 'flowers', 'rose', 'roses', 'bloom', 'garden'],
  moon: ['moon', 'moonlight'],
  star: ['star', 'stars', 'starry'],
  sun: ['sun', 'sunny', 'sunshine', 'sunrise', 'sunset'],
  note: ['music', 'song', 'songs', 'sing', 'singing', 'note'],
  cat: ['cat', 'cats', 'kitty', 'kitten', 'miami', 'jade'],
  boat: ['boat', 'sail', 'sailing', 'ship', 'sea', 'ocean'],
  eye: ['eye', 'eyes', 'see', 'look', 'looking', 'watch'],
  tree: ['tree', 'trees', 'forest', 'woods'],
  monkey: ['monkey', 'monkeys', 'ape', 'apes', 'banana', 'bananas'],
  turtle: ['turtle', 'turtles', 'tortoise'],
  dino: ['dino', 'dinos', 'dinosaur', 'dinosaurs', 'trex'],
  olive: ['olive', 'olives'],
  pizza: ['pizza', 'pizzas'],
  taco: ['taco', 'tacos'],
  football: ['football', 'touchdown', 'nfl'],
  baseball: ['baseball', 'homerun', 'mlb'],
  videogames: ['videogame', 'videogames', 'gaming', 'gamer', 'game', 'games', 'nintendo', 'xbox', 'playstation', 'controller'],
  pikachu: ['pikachu', 'pokemon'],
  charmander: ['charmander'],
  shaymin: ['shaymin'],
  dog: ['dog', 'dogs', 'puppy', 'puppies', 'pup', 'doggy', 'doggo'],
  drinks: ['drink', 'drinks', 'martini', 'martinis', 'cocktail', 'cocktails'],
  beer: ['beer', 'beers'],
  wine: ['wine', 'wines'],
  beach: ['beach', 'beaches', 'palm', 'vacation'],
  mountain: ['mountain', 'mountains', 'hike', 'hiking'],
  snow: ['snow', 'snowy', 'snowing', 'snowflake', 'winter'],
  sleepy: ['sleepy', 'sleep', 'tired', 'nap', 'zzz', 'goodnight', 'bedtime'],
  halloween: ['halloween', 'pumpkin', 'pumpkins', 'spooky', 'jackolantern'],
  heart: ['love', 'heart', 'loving', 'lovely'],
  frog: ['frog', 'frogs', 'toad', 'ribbit'],
  cloud: ['cloud', 'clouds', 'cloudy'],
  rain: ['rain', 'rainy', 'raining', 'storm'],
};

export const PICTURES = Object.fromEntries(Object.keys(DRAWINGS).map((name) => [name, {
  setup: (rand) => ({ dir: dir(rand), size: between(rand, 1, 1.2), flip: rand() < 0.5 ? -1 : 1 }),
  at: (g, t, c, v) => {
    const [px, py, paint] = pointAt(DRAWINGS[name], (g.fi + 0.5) / c.n);
    g.paint = paint; // some pictures paint their parts (a green olive, its red pit)
    const [x, y] = MOTION[name](px, py, t, v);
    const s = c.R * v.size;
    return [c.cx + x * s * (name === 'fish' ? v.flip : 1), c.cy + y * s];
  },
}]));
