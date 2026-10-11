// Shared prompts (a mode the host can turn on): both players get the same
// question each round, so they talk about the same thing without reading each other.

import { seededRandom } from './glyphs.js';

const PROMPTS = [
  'tell them about your day',
  'describe the sky right now',
  'what are you eating lately?',
  'a memory from when you were small',
  'what song is stuck in your head?',
  'something you’re a little scared of',
  'describe the room you’re in',
  'a dream you had',
  'what would you do with a free day?',
  'a smell you love',
  'who do you miss?',
  'what’s outside your window?',
  'your favourite place in the world',
  'what’s making you happy lately?',
  'describe your perfect night',
  'if you were an animal, which one?',
  'the weather inside you today',
  'a secret wish',
  'somewhere you want to go together',
  'the best thing you ate this week',
  'a sound you love',
  'what are you looking forward to?',
  'a small thing that made you smile',
  'what does home feel like?',
  'something you want to tell them',
  'what colour is today?',
  'the last time you laughed really hard',
  'a place you could fall asleep anywhere',
];

// Same seed + round → same prompt on both phones; no repeats within a duet.
export function promptFor(seed, round) {
  const rand = seededRandom(seed ^ 0x5eed);
  const order = PROMPTS.map((p) => [rand(), p]).sort((a, b) => a[0] - b[0]).map(([, p]) => p);
  return order[round % order.length];
}
