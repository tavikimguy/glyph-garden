// English text to rough Korean syllable blocks, deliberately lossy (strike: 스트라이크).

const VOWELS = 'aeiou';
const FINALS = new Set(['ㄱ', 'ㄴ', 'ㄹ', 'ㅁ', 'ㅂ', 'ㅇ']);

// Words the spelling rules get wrong.
const EXCEPTIONS = {
  the: '더', a: '어', i: '아이', you: '유', your: '유어', are: '아', what: '왓', we: '위',
  be: '비', me: '미', he: '히', she: '쉬', to: '투', too: '투', do: '두', my: '마이',
  love: '러브', one: '원', is: '이즈', of: '오브', was: '워즈', have: '해브', there: '데어',
  they: '데이', hi: '하이', hey: '헤이', ok: '오케이', okay: '오케이', good: '굿', night: '나이트',
};

// Checked longest first.
const PATTERNS = [
  ['tch', ['ㅊ']], ['igh', ['ㅏ', 'ㅣ']], ['ough', ['ㅗ']], ['augh', ['ㅗ']],
  ['sh', ['ㅅ']], ['ch', ['ㅊ']], ['th', ['ㄷ']], ['ph', ['ㅍ']], ['ck', ['ㅋ']],
  ['ng', ['ㅇ']], ['nk', ['ㅇ', 'ㅋ']], ['qu', ['ㅋ', 'w']], ['wh', ['w']],
  ['wr', ['ㄹ']], ['kn', ['ㄴ']], ['gh', []],
  ['ee', ['ㅣ']], ['ea', ['ㅣ']], ['ie', ['ㅣ']], ['oo', ['ㅜ']],
  ['ou', ['ㅏ', 'ㅜ']], ['ow', ['ㅏ', 'ㅜ']], ['oi', ['ㅗ', 'ㅣ']], ['oy', ['ㅗ', 'ㅣ']],
  ['ai', ['ㅔ', 'ㅣ']], ['ay', ['ㅔ', 'ㅣ']], ['ey', ['ㅔ', 'ㅣ']],
  ['au', ['ㅗ']], ['aw', ['ㅗ']], ['ew', ['ㅠ']], ['ue', ['ㅜ']], ['oa', ['ㅗ']],
];

// Vowel + r before a consonant or word end drops the r (car: 카).
const R_VOWELS = { ar: 'ㅏ', er: 'ㅓ', ir: 'ㅓ', or: 'ㅗ', ur: 'ㅓ' };

const LETTERS = {
  a: 'ㅐ', b: 'ㅂ', d: 'ㄷ', e: 'ㅔ', f: 'ㅍ', g: 'ㄱ', h: 'ㅎ', i: 'ㅣ', j: 'ㅈ',
  k: 'ㅋ', l: 'ㄹ', m: 'ㅁ', n: 'ㄴ', o: 'ㅗ', p: 'ㅍ', q: 'ㅋ', r: 'ㄹ', s: 'ㅅ',
  t: 'ㅌ', u: 'ㅓ', v: 'ㅂ', w: 'w', z: 'ㅈ',
};

const VOWEL_JAMO = new Set('ㅏㅐㅑㅒㅓㅔㅕㅖㅗㅘㅙㅚㅛㅜㅝㅞㅟㅠㅡㅢㅣ');

const W_GLIDE = { 'ㅏ': 'ㅘ', 'ㅐ': 'ㅞ', 'ㅓ': 'ㅝ', 'ㅔ': 'ㅞ', 'ㅣ': 'ㅟ' };
const Y_GLIDE = { 'ㅏ': 'ㅑ', 'ㅐ': 'ㅒ', 'ㅓ': 'ㅕ', 'ㅔ': 'ㅖ', 'ㅗ': 'ㅛ', 'ㅜ': 'ㅠ', 'ㅣ': 'ㅣ' };

function isVowelLetter(ch) {
  return VOWELS.includes(ch) || ch === 'y';
}

function wordToJamo(word) {
  let w = word.toLowerCase().replace(/[^a-z]/g, '');
  // Silent final e, except in short words (be, me).
  if (w.length > 3 && w.endsWith('e') && !isVowelLetter(w[w.length - 2])) w = w.slice(0, -1);

  const out = [];
  let i = 0;
  while (i < w.length) {
    const rest = w.slice(i);
    const next2 = w[i + 2];

    // ll splits across syllables (hello: 헬로), other doubles collapse.
    if (i > 0 && w[i] === w[i - 1] && !isVowelLetter(w[i])) {
      if (w[i] === 'l') out.push('ㄹ');
      i++; continue;
    }

    const rv = R_VOWELS[rest.slice(0, 2)];
    if (rv && (next2 === undefined || !isVowelLetter(next2))) {
      out.push(rv); i += 2; continue;
    }

    const match = PATTERNS.find(([pat]) => rest.startsWith(pat));
    if (match) { out.push(...match[1]); i += match[0].length; continue; }

    const ch = w[i];
    const after = w[i + 1];
    if (ch === 'c') out.push(after && 'eiy'.includes(after) ? 'ㅅ' : 'ㅋ');
    else if (ch === 'x') out.push('ㅋ', 'ㅅ');
    else if (ch === 'y') out.push(after && VOWELS.includes(after) ? 'y' : 'ㅣ');
    else if (LETTERS[ch]) out.push(LETTERS[ch]);
    i++;
  }
  return out;
}

function mergeGlides(tokens) {
  const out = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    const next = tokens[i + 1];
    if (t === 'w' || t === 'y') {
      const table = t === 'w' ? W_GLIDE : Y_GLIDE;
      if (next && VOWEL_JAMO.has(next)) {
        out.push(table[next] || (t === 'w' ? 'ㅜ' : next));
        i++;
      } else {
        out.push(t === 'w' ? 'ㅜ' : 'ㅣ');
      }
    } else {
      out.push(t);
    }
  }
  return out;
}

// Inserts ㅡ between clustered consonants (st: 스트).
function toSyllables(tokens) {
  const syls = [];
  let pending = null;
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    const next = tokens[i + 1];
    if (VOWEL_JAMO.has(t)) {
      syls.push({ cho: pending || 'ㅇ', jung: t, jong: '' });
      pending = null;
    } else if (next && VOWEL_JAMO.has(next)) {
      if (pending) syls.push({ cho: pending, jung: 'ㅡ', jong: '' });
      pending = t;
    } else {
      const last = syls[syls.length - 1];
      if (!pending && last && !last.jong && FINALS.has(t)) {
        last.jong = t;
      } else {
        if (pending) syls.push({ cho: pending, jung: 'ㅡ', jong: '' });
        pending = null;
        // Final ㅈ/ㅊ take ㅣ instead of ㅡ (bench: 벤치).
        syls.push({ cho: t, jung: t === 'ㅈ' || t === 'ㅊ' ? 'ㅣ' : 'ㅡ', jong: '' });
      }
    }
  }
  if (pending) syls.push({ cho: pending, jung: 'ㅡ', jong: '' });
  return syls;
}

const CHO = 'ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ';
const JUNG = 'ㅏㅐㅑㅒㅓㅔㅕㅖㅗㅘㅙㅚㅛㅜㅝㅞㅟㅠㅡㅢㅣ';
const JONG = ['', ...'ㄱㄲㄳㄴㄵㄶㄷㄹㄺㄻㄼㄽㄾㄿㅀㅁㅂㅄㅅㅆㅇㅈㅊㅋㅌㅍㅎ'];

// Tense consonants share a glyph and voice clip with their plain form.
const PLAIN = {
  'ㄲ': 'ㄱ', 'ㄸ': 'ㄷ', 'ㅃ': 'ㅂ', 'ㅆ': 'ㅅ', 'ㅉ': 'ㅈ', 'ㄳ': 'ㄱ', 'ㄵ': 'ㄴ', 'ㄶ': 'ㄴ',
  'ㄺ': 'ㄹ', 'ㄻ': 'ㄹ', 'ㄼ': 'ㄹ', 'ㄽ': 'ㄹ', 'ㄾ': 'ㄹ', 'ㄿ': 'ㄹ', 'ㅀ': 'ㄹ', 'ㅄ': 'ㅂ',
};
const plain = (j) => PLAIN[j] || j;

function decompose(char) {
  const n = char.charCodeAt(0) - 0xac00;
  return {
    cho: plain(CHO[Math.floor(n / 588)]),
    jung: JUNG[Math.floor((n % 588) / 28)],
    jong: plain(JONG[n % 28]),
    char,
  };
}

const isSyllable = (ch) => ch >= '가' && ch <= '힣';

export function compose({ cho, jung, jong }) {
  const c = CHO.indexOf(cho);
  const v = JUNG.indexOf(jung);
  const f = JONG.indexOf(jong);
  if (c < 0 || v < 0 || f < 0) return '?';
  return String.fromCharCode(0xac00 + (c * 21 + v) * 28 + f);
}

// Returns [{ word, syllables: [{ cho, jung, jong, char }] }]. Hangul input passes through.
export function translate(text) {
  return text
    .split(/\s+/)
    .map((word) => {
      let syllables;
      if ([...word].some(isSyllable)) {
        syllables = [...word].filter(isSyllable).map(decompose);
      } else {
        const key = word.toLowerCase().replace(/[^a-z]/g, '');
        syllables = EXCEPTIONS[key]
          ? [...EXCEPTIONS[key]].map(decompose)
          : toSyllables(mergeGlides(wordToJamo(word)));
        syllables.forEach((syl) => { syl.char = compose(syl); });
      }
      return { word, syllables };
    })
    .filter((w) => w.syllables.length > 0);
}
