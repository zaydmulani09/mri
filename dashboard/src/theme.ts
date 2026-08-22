// Canvas-side mirror of the CSS custom properties in styles.css.
// DESIGN.md: two signal channels only; everything else is neutral ink.
export const C = {
  bg: "#101312",
  surface: "#171c19",
  border: "#29312c",
  edgeBase: "#232a26",
  text: "#d8ded9",
  muted: "#8f9a92",
  accent: "#4cd787",
  caution: "#e0b04b",
} as const;

export const FONT_MONO =
  'ui-monospace, "Cascadia Mono", "JetBrains Mono", Consolas, monospace';

export const TICK_MS = 140;
