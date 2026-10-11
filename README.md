# Glyph Garden

Two people write to each other. Every letter becomes a glyph (ASCII, box-drawing, arrows, math, stars: a new cipher each duet, so `e` might always be `◐`). Player 1's glyphs are thrown in from the left, Player 2's from the right; they drift forever, chime and ripple when they bump, and dance in formations (spiral, helix, orbits, wave) between rounds. Between rounds you hear strange, half-heard snippets. After 8 messages the glyphs line up, decode back into letters, and the conversation is sung by a voice stitched together from each player's own recorded sounds.

Inspired by *"Nuance" Glyph Duet* by Iver Kim & Eunsong Shin.

## Game modes

- **Duet (online):** one person taps *start a duet* and shares the link (or the 4-letter code). The other opens it. Each picks an instrument/voice and colour, types or speaks their messages, and both phones play the same song at the end.
- **Duet (one screen):** both players on one device; can also record your own voices.

## Run it locally

Needs Node 20+. This runs the real server (rooms included) on your machine:

```sh
npm install
npm run dev      # → http://127.0.0.1:8787 (open it in two tabs to play both sides)
```

## Put it online (Cloudflare)

One-time: make a free Cloudflare account, then `npx wrangler login`. After that:

```sh
npm run deploy   # → https://glyph-garden.<your-subdomain>.workers.dev
```

## The word log (which pictures to draw next)

Every message's meaningful words get counted (filler like "the", "lol", "gonna" is skipped; plurals fold together; whole messages are never stored). See the top words at **/words** — gold rows have no picture yet.

- Locally it's open: http://127.0.0.1:8787/words
- Online it's locked. Set a key once with `npx wrangler secret put WORDS_KEY`, then open `/words?key=YOUR_KEY`.
- To add a picture: draw it in `public/js/pictures.js` (`DRAWINGS` + `MOTION`) and list its trigger words in `PICTURE_WORDS`.

## Files

| File | What it does |
| --- | --- |
| `worker/words.js` | The word log: filler-word filter + one global counter (a Durable Object with a small SQL table) |
| `public/words.html` | The private word-log page |
| `worker/index.js` | The server: serves the game, plus one live "Room" (Durable Object) per duet code that relays messages in order |
| `public/js/online.js` | The phone's live connection to its room (with auto-reconnect) |
| `public/js/main.js` | Game loop (title → voices → turns → interludes → song), p5 drawing |
| `public/js/hangul.js` | English → rough syllables for the singer (uses Korean jamo internally as a tidy sound set) |
| `public/js/glyphs.js` | Letter → glyph cipher (7 glyph families) |
| `public/js/voicebank.js` | Mic recording, trimming, pitch detection for the 20 voice sounds |
| `public/js/formations.js` | 16 pattern dances (sunflower, galaxy, helix, heart, rose, tornado…), randomised each time |
| `public/js/pictures.js` | 12 picture dances drawn in glyphs (fish, bird, butterfly, flower, moon, star, sun, note, cat, boat, eye, tree) |
| `public/js/songdna.js` | Conversation → song DNA: key/mode from mood, tempo from energy, kit/beat/instruments from the text, secret words |
| `public/js/audio.js` | Tone.js: plinks, chimes, ambience, voice bank, 11 robot voices + 9 instruments (incl. guitar), interludes, looping finale band |

## Tweak

- `PER_PLAYER` in `js/main.js`: messages each before the song
- `RAIN` / `CHORDS` in `js/audio.js`: the notes
- `setClarity()` in `js/audio.js`: how garbled → clear the voice gets
- `window.garden` in the browser console: the live game state
