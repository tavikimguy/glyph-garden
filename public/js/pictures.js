// Picture dances: the glyphs line up along the outline of a little drawing
// (a fish, a bird, a flower…) that moves like the real thing.
// Drawings live in a -1…1 box (y points down); glyphs spread evenly along the lines.

const TAU = Math.PI * 2;
const between = (a, b) => a + Math.random() * (b - a);
const dir = () => (Math.random() < 0.5 ? -1 : 1);

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
function shape(strokes) {
  const segs = [];
  let total = 0;
  for (const s of strokes) {
    for (let i = 0; i < s.length - 1; i++) {
      const [ax, ay] = s[i];
      const [bx, by] = s[i + 1];
      const len = Math.hypot(bx - ax, by - ay);
      segs.push({ ax, ay, bx, by, len, start: total });
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
  return [s.ax + (s.bx - s.ax) * k, s.ay + (s.by - s.ay) * k];
}

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
  ]),
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
  tree: (x, y, t) => [x + Math.sin(t * 1.3) * 0.08 * Math.max(0, 0.5 - y), y],
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
  heart: ['love', 'heart', 'loving', 'lovely'],
};

export const PICTURES = Object.fromEntries(Object.keys(DRAWINGS).map((name) => [name, {
  setup: () => ({ dir: dir(), size: between(1, 1.2), flip: Math.random() < 0.5 ? -1 : 1 }),
  at: (g, t, c, v) => {
    const [x, y] = MOTION[name](...pointAt(DRAWINGS[name], (g.fi + 0.5) / c.n), t, v);
    const s = c.R * v.size;
    return [c.cx + x * s * (name === 'fish' ? v.flip : 1), c.cy + y * s];
  },
}]));
