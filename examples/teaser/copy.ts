// The teaser's words, one per scene. The product is fictional on purpose (the design doc's open
// question recommends an obviously fictional developer tool), so changing the whole signature line
// is an edit to this file and nothing else.
//
// The words are meant to be read as one sentence: "Notes that think ahead of their time — ZEPHYR".
// Each word is a whole scene, so a broken word or a dropped connector is what makes the sequence
// unreadable; the sentence is checked here, in one list, rather than across the scenes.

/** The fictional product the teaser ends on. */
export const teaserProduct = 'ZEPHYR';

/** The signature line the product's tagline would be set from. */
export const teaserTagline = 'notes that think';

/** The full teaser: eight words, so one to three are on screen at a time. */
export const teaserWords = [
  'NOTES',
  'THAT',
  'THINK',
  'AHEAD',
  'OF',
  'THEIR',
  'TIME',
  teaserProduct,
] as const;

/** The CI Composition: the opening word plus the first two transitions, per the design doc. */
export const teaserCiWords = teaserWords.slice(0, 3);
