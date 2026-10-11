# Glyph Garden

Two people write to each other. Messages get lost in translation: English is guessed into Korean sounds, drawn as Hangul-shaped constellations, and played back as strange, half-heard snippets. After 8 messages it all resolves into a song, sung by a voice stitched together from each player's own recorded sounds.

Inspired by *"Nuance" Glyph Duet* by Iver Kim & Eunsong Shin.

## Run it

No install or build step. It needs a local server, because ES modules and the microphone don't work from `file://`:

```sh
cd glyph-garden
python3 -m http.server 5178
# open http://localhost:5178
```

Or use the VS Code **Live Server** extension on `index.html`.

## Files

| File | What it does |
| --- | --- |
| `js/main.js` | Game loop (title → voices → turns → interludes → song), p5 drawing |
| `js/hangul.js` | English / 한글 text → syllable blocks (초성·중성·종성) |
| `js/glyphs.js` | Syllable block → constellation glyph geometry + drawing |
| `js/voicebank.js` | Mic recording, trimming, pitch detection for the 20 voice sounds |
| `js/audio.js` | Tone.js: rain plinks, pad, singer, interlude + finale |

## Tweak

- `PER_PLAYER` in `js/main.js`: messages each before the song
- `RAIN` / `CHORDS` in `js/audio.js`: the notes
- `setClarity()` in `js/audio.js`: how garbled → clear the voice gets
- `window.garden` in the browser console: the live game state
