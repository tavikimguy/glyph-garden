// Per-session cipher: each letter always maps to the same symbol.

const FAMILIES = {
  ascii: [...'!#$%&*+/<=>?@[]^{}|~\\();:'],
  lines: [...'┼╳┤├┬┴╱╲═║┌┐└┘╭╮╰╯━┃'],
  geometry: [...'◊○●◐◑◒◓△▽◇◆□■◯▲▼◀▶◢◣◤◥'],
  arrows: [...'←↑→↓↺↻⇌⇄⇅↯↹↬↫⇐⇒⇑⇓↰↱↲↳'],
  math: [...'∑∂∞≈≠∆∇∫√πΩµ±×÷∴∵∅⊕⊗⊙∈∩∪⊂⊃≡∝∠⊥∥'],
  stars: [...'✶✦✧※⁂☼✺✹✸✷✵❋❊❉✻✼✽✾✿❀❁'],
  runes: [...'ᚠᚢᚦᚨᚱᚲᚷᚹᚺᚾᛁᛃᛇᛈᛉᛊᛏᛒᛖᛗᛚᛜᛞᛟ'],
  braille: [...'⠁⠃⠉⠙⠑⠋⠛⠓⠊⠚⠅⠇⠍⠝⠕⠏⠟⠗⠎⠞⠥⠧⠺⠭⠽⠵⠿⠷⠾⠮'],
  sky: [...'☉☽☾☿♁♃♄♅♆♇☊☋♩♪♫♬♭♮♯'],
  marks: [...'§¶¤°¿¡«»†‡⌘∿≋⌀⌇⌁⌂⌬'],
};
const NEEDED = 36;
export const SYMBOLS = Object.values(FAMILIES).flat();

let current = FAMILIES.ascii;

// Deterministic hash so a symbol always plays the same note.
export function hash(str) {
  let h = 2166136261;
  for (const ch of str) h = Math.imul(h ^ ch.codePointAt(0), 16777619);
  return h >>> 0;
}

// Seeded so every phone gets the same picks.
export function seededRandom(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffled(list, rand = Math.random) {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// Core families plus one rotating guest family.
const CORE = { ascii: 9, arrows: 6, math: 7, stars: 5 };
const GUESTS = ['geometry', 'lines', 'runes', 'braille', 'sky', 'marks'];

// Seeded so both players in an online duet share the cipher.
export function makeCipher(seed = Math.floor(Math.random() * 2 ** 31)) {
  const rand = seededRandom(seed);
  const guest = GUESTS[Math.floor(rand() * GUESTS.length)];
  const coreCount = Object.values(CORE).reduce((a, b) => a + b, 0);
  const picked = [
    ...Object.entries(CORE).flatMap(([name, n]) => shuffled(FAMILIES[name], rand).slice(0, n)),
    ...shuffled(FAMILIES[guest], rand).slice(0, NEEDED - coreCount),
  ];
  current = shuffled(picked, rand);
  const cipher = {};
  [...'abcdefghijklmnopqrstuvwxyz0123456789'].forEach((ch, i) => { cipher[ch] = current[i]; });
  cipher.theme = [...Object.keys(CORE), guest];
  return cipher;
}

// Anything else (punctuation, accents) becomes a dot, one per character.
export function encode(cipher, ch) {
  return cipher[ch.toLowerCase()] || '•';
}

export function randomSymbol() {
  return current[Math.floor(Math.random() * current.length)];
}
