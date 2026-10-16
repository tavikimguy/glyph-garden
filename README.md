# Glyph Garden

A two-player writing game. Every letter you type becomes a glyph from a cipher that changes each game. The glyphs drift around the screen, chime when they bump, and dance between rounds. After 8 messages they decode back into letters and the conversation gets sung by a voice built from both players' recorded sounds.

Inspired by *"Nuance" Glyph Duet* by Iver Kim & Eunsong Shin.

You can play online (one person starts a duet and shares the link or 4-letter code) or with both players on one screen.

## Running it

Needs Node 20+.

```sh
npm install
npm run dev      # http://127.0.0.1:8787, open two tabs to play both sides
```

To deploy to Cloudflare, run `npx wrangler login` once, then:

```sh
npm run deploy
```

## Word log

Each message's words get counted (filler words skipped, full messages never stored) so I know which pictures to draw next. The top words are at `/words`; highlighted rows don't have a picture yet.

- Locally it's open at http://127.0.0.1:8787/words
- Online it needs a key: `npx wrangler secret put WORDS_KEY`, then open `/words?key=YOUR_KEY`
- To add a picture, draw it in `public/js/pictures.js` (`DRAWINGS` and `MOTION`) and add its trigger words to `PICTURE_WORDS`

## Layout

- `worker/` is the Cloudflare Worker: rooms, letters, inboxes, and the word log (Durable Objects)
- `public/js/main.js` is the game loop and p5 drawing
- `public/js/audio.js` handles all the sound (Tone.js)
- `public/js/songdna.js` turns a conversation into a song: key, tempo, instruments
- `public/js/glyphs.js`, `formations.js`, `pictures.js` are the cipher and the dances
- `public/js/voicebank.js` and `hangul.js` handle recording voices and turning text into singable syllables
