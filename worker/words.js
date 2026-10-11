// The word log: counts meaningful words across every duet, so we know which
// pictures to draw next. Only single words + counts are kept — never messages.

import { DurableObject } from 'cloudflare:workers';

// Filler that would never make a good picture: "the", "and", "lol", "gonna"…
const STOPWORDS = new Set(`
a about above after again against all also am an and any are aren't as at be because been before being
below between both but by can can't cannot could couldn't did didn't do does doesn't doing don't down
during each few for from further get gets got had hadn't has hasn't have haven't having he he'd he'll
he's her here here's hers herself him himself his how how's i i'd i'll i'm i've if in into is isn't it
it's its itself just let's like me more most mustn't my myself no nor not now of off on once only or
other ought our ours ourselves out over own really same shan't she she'd she'll she's should shouldn't
so some such than that that's the their theirs them themselves then there there's these they they'd
they'll they're they've this those through to too under until up us very was wasn't we we'd we'll
we're we've were weren't what what's when when's where where's which while who who's whom why why's
will with won't would wouldn't you you'd you'll you're you've your yours yourself yourselves
im ive id ill youre dont cant wont didnt isnt doesnt thats whats theres lets
yeah yes yep nope nah ok okay oh ohh ah um uh hmm hm lol lmao haha hahaha hehe omg wow hey hi hello bye
gonna wanna gotta kinda sorta maybe also just still even much many lot lots thing things stuff
one two three really very pretty quite something anything nothing everything someone anyone everyone
go going went gone come came coming know knew think thought want wanted say said tell told make made
see saw look looked feel felt need needed take took give gave way well back good bad new old big little
`.trim().split(/\s+/));

// Fold simple plurals/verb endings together: stars → star, loves → love, stories → story.
// (Rough on purpose; good enough to count what people mean.)
function base(word) {
  if (word.length > 4 && word.endsWith('ies')) return `${word.slice(0, -3)}y`;
  if (word.length > 3 && word.endsWith('s') && !/(ss|us|is|ys|ws)$/.test(word)) return word.slice(0, -1);
  return word;
}

// Words worth counting in one message: lowercase, 3–20 letters, no filler, each once.
export function wordsWorthCounting(text) {
  const words = String(text).toLowerCase().replace(/[’`]/g, "'").match(/[a-z']+/g) || [];
  return [...new Set(words.map((w) => w.replace(/^'+|'+$/g, '')).filter((w) => !STOPWORDS.has(w) && !STOPWORDS.has(w.replace(/'/g, ''))).map(base))]
    .filter((w) => w.length >= 3 && w.length <= 20 && !STOPWORDS.has(w));
}

// One global log for the whole game (a single Durable Object with a tiny SQL table).
export class WordLog extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS words (
        word TEXT PRIMARY KEY,
        count INTEGER NOT NULL,
        last_seen INTEGER NOT NULL
      )
    `);
  }

  record(words) {
    const now = Date.now();
    for (const word of words.slice(0, 30)) {
      this.ctx.storage.sql.exec(
        `INSERT INTO words (word, count, last_seen) VALUES (?, 1, ?)
         ON CONFLICT(word) DO UPDATE SET count = count + 1, last_seen = excluded.last_seen`,
        word, now,
      );
    }
  }

  // The most-used words. minCount hides one-offs (names, private words).
  top(limit = 200, minCount = 2) {
    return this.ctx.storage.sql
      .exec('SELECT word, count, last_seen FROM words WHERE count >= ? ORDER BY count DESC, word LIMIT ?', minCount, limit)
      .toArray();
  }
}
