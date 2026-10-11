// Syllable block → glyph: Hangul's structure, drawn as a little constellation.
// Every jamo is a few strokes; their corners become stars, strokes become faint lines.
// A seeded wobble + tilt keeps it Hangul-shaped but not quite readable.

const L = (...pts) => ({ line: pts });
const R = (cx, cy, r) => ({ ring: [cx, cy, r] });

const STEM = L([0.5, 0], [0.5, 1]);
const BAR = L([0, 0.5], [1, 0.5]);

const JAMO = {
  // consonants (square box)
  'ㄱ': [L([0, 0], [1, 0], [1, 1])],
  'ㄴ': [L([0, 0], [0, 1], [1, 1])],
  'ㄷ': [L([1, 0], [0, 0], [0, 1], [1, 1])],
  'ㄹ': [L([0, 0], [1, 0], [1, 0.5], [0, 0.5], [0, 1], [1, 1])],
  'ㅁ': [L([0, 0], [1, 0], [1, 1], [0, 1], [0, 0])],
  'ㅂ': [L([0, 0], [0, 1], [1, 1], [1, 0]), BAR],
  'ㅅ': [L([0, 1], [0.5, 0], [1, 1])],
  'ㅇ': [R(0.5, 0.5, 0.45)],
  'ㅈ': [L([0, 0], [1, 0]), L([0, 1], [0.5, 0], [1, 1])],
  'ㅊ': [L([0.35, -0.2], [0.65, -0.2]), L([0, 0.05], [1, 0.05]), L([0, 1], [0.5, 0.05], [1, 1])],
  'ㅋ': [L([0, 0], [1, 0], [1, 1]), BAR],
  'ㅌ': [L([1, 0], [0, 0], [0, 1], [1, 1]), BAR],
  'ㅍ': [L([0, 0], [1, 0]), L([0.3, 0], [0.3, 1]), L([0.7, 0], [0.7, 1]), L([0, 1], [1, 1])],
  'ㅎ': [L([0.35, -0.15], [0.65, -0.15]), L([0, 0.1], [1, 0.1]), R(0.5, 0.6, 0.3)],
  // vertical vowels (tall box)
  'ㅣ': [STEM],
  'ㅏ': [STEM, L([0.5, 0.5], [0.95, 0.5])],
  'ㅑ': [STEM, L([0.5, 0.38], [0.95, 0.38]), L([0.5, 0.62], [0.95, 0.62])],
  'ㅓ': [STEM, L([0.05, 0.5], [0.5, 0.5])],
  'ㅕ': [STEM, L([0.05, 0.38], [0.5, 0.38]), L([0.05, 0.62], [0.5, 0.62])],
  'ㅐ': [L([0.3, 0], [0.3, 1]), L([0.3, 0.5], [0.6, 0.5]), L([0.75, 0], [0.75, 1])],
  'ㅒ': [L([0.3, 0], [0.3, 1]), L([0.3, 0.38], [0.6, 0.38]), L([0.3, 0.62], [0.6, 0.62]), L([0.75, 0], [0.75, 1])],
  'ㅔ': [L([0.05, 0.5], [0.4, 0.5]), L([0.4, 0], [0.4, 1]), L([0.8, 0], [0.8, 1])],
  'ㅖ': [L([0.05, 0.38], [0.4, 0.38]), L([0.05, 0.62], [0.4, 0.62]), L([0.4, 0], [0.4, 1]), L([0.8, 0], [0.8, 1])],
  // horizontal vowels (wide box)
  'ㅡ': [BAR],
  'ㅗ': [L([0, 0.65], [1, 0.65]), L([0.5, 0.2], [0.5, 0.65])],
  'ㅛ': [L([0, 0.65], [1, 0.65]), L([0.35, 0.2], [0.35, 0.65]), L([0.65, 0.2], [0.65, 0.65])],
  'ㅜ': [L([0, 0.35], [1, 0.35]), L([0.5, 0.35], [0.5, 0.85])],
  'ㅠ': [L([0, 0.35], [1, 0.35]), L([0.35, 0.35], [0.35, 0.85]), L([0.65, 0.35], [0.65, 0.85])],
};

const VERTICAL = new Set('ㅏㅐㅑㅒㅓㅔㅕㅖㅣ');
const HORIZONTAL = new Set('ㅗㅛㅜㅠㅡ');
const COMPOUND = { 'ㅘ': ['ㅗ', 'ㅏ'], 'ㅙ': ['ㅗ', 'ㅐ'], 'ㅚ': ['ㅗ', 'ㅣ'], 'ㅝ': ['ㅜ', 'ㅓ'], 'ㅞ': ['ㅜ', 'ㅔ'], 'ㅟ': ['ㅜ', 'ㅣ'], 'ㅢ': ['ㅡ', 'ㅣ'] };

// Small deterministic random, so the same syllable always draws the same glyph.
export function hash(str) {
  let h = 2166136261;
  for (const ch of str) h = Math.imul(h ^ ch.codePointAt(0), 16777619);
  return h >>> 0;
}

function rng(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Where each jamo sits in the block, as [x, y, w, h] in 0..1.
function layout({ cho, jung, jong }) {
  const T = jong ? 0.62 : 1; // top area height; final consonant takes the rest
  const parts = [];
  if (COMPOUND[jung]) {
    const [h, v] = COMPOUND[jung];
    parts.push([cho, [0, 0, 0.6, T * 0.5]], [h, [0, T * 0.5, 0.65, T * 0.5]], [v, [0.65, 0, 0.35, T]]);
  } else if (HORIZONTAL.has(jung)) {
    parts.push([cho, [0.15, 0, 0.7, T * 0.55]], [jung, [0, T * 0.55, 1, T * 0.45]]);
  } else {
    parts.push([cho, [0, 0, 0.55, T]], [jung, [0.58, 0, 0.42, T]]);
  }
  if (jong) parts.push([jong, [0.1, 0.68, 0.8, 0.32]]);
  return parts;
}

// Build a glyph's geometry once: segments + stars, centered on 0,0, size 1.
export function buildGlyph(syl) {
  const rand = rng(hash(syl.char));
  const wobble = () => (rand() - 0.5) * 0.14;
  const rotate = ([x, y], a, cx = 0, cy = 0) => [
    cx + (x - cx) * Math.cos(a) - (y - cy) * Math.sin(a),
    cy + (x - cx) * Math.sin(a) + (y - cy) * Math.cos(a),
  ];
  const tilt = (rand() - 0.5) * 0.4;
  let jamoTilt = 0;
  const place = (box, [x, y]) => {
    const pad = 0.14;
    // Each jamo is twisted around its own centre, then the whole block tilts.
    let pt = [box[0] + (pad + x * (1 - 2 * pad)) * box[2], box[1] + (pad + y * (1 - 2 * pad)) * box[3]];
    pt = rotate(pt, jamoTilt, box[0] + box[2] / 2, box[1] + box[3] / 2);
    return rotate([pt[0] - 0.5 + wobble(), pt[1] - 0.5 + wobble()], tilt);
  };

  const segments = [];
  const stars = [];
  for (const [jamo, box] of layout(syl)) {
    jamoTilt = (rand() - 0.5) * 1.1;
    for (const shape of JAMO[jamo] || []) {
      let pts;
      if (shape.ring) {
        const [cx, cy, r] = shape.ring;
        pts = [];
        for (let i = 0; i <= 8; i++) {
          const a = (i / 8) * Math.PI * 2;
          pts.push(place(box, [cx + Math.cos(a) * r, cy + Math.sin(a) * r * (box[2] / box[3])]));
        }
        pts[8] = pts[0];
      } else {
        pts = shape.line.map((pt) => place(box, pt));
      }
      // Drop some strokes: the stars stay, the lines between them go missing.
      for (let i = 0; i < pts.length - 1; i++) {
        if (rand() < 0.72) segments.push([...pts[i], ...pts[i + 1]]);
      }
      pts.forEach(([x, y], i) => {
        if (shape.ring && i === 8) return;
        stars.push([x, y, 0.012 + rand() * 0.028]);
      });
    }
  }
  return { segments, stars };
}

// Draw at (x, y) with pixel size s. color = [r, g, b], alpha 0..1, glow 0..1.
export function drawGlyph(p, geo, x, y, s, color, alpha, glow = 0) {
  const [r, g, b] = color;
  p.push();
  p.translate(x, y);
  if (glow > 0) {
    p.stroke(r, g, b, 60 * glow * alpha);
    p.strokeWeight(4 + glow * 4);
    for (const [ax, ay, bx, by] of geo.segments) p.line(ax * s, ay * s, bx * s, by * s);
  }
  p.stroke(r, g, b, 120 * alpha);
  p.strokeWeight(1);
  for (const [ax, ay, bx, by] of geo.segments) p.line(ax * s, ay * s, bx * s, by * s);
  p.noStroke();
  p.fill(r, g, b, 255 * alpha);
  for (const [sx, sy, sr] of geo.stars) p.circle(sx * s, sy * s, Math.max(1.5, sr * s * 2 * (1 + glow * 0.6)));
  p.pop();
}
