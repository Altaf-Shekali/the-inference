/**
 * Self-hosted fonts — registers local woff2 (from public/fonts/) so renders
 * never touch fonts.gstatic.com. Replaces @remotion/google-fonts, which
 * fetches at render time and breaks offline / in CI (NetworkError).
 *
 * The woff2 files are produced by `npm run fonts` (pipeline/fetch-fonts.mjs).
 * If they are missing, the @font-face simply fails to match and the browser
 * falls back to a system sans — i.e. graceful degradation, never a hang.
 *
 * Weight lists MUST stay in sync with pipeline/fetch-fonts.mjs.
 */
import { staticFile, delayRender, continueRender } from "remotion";

type Spec = { family: string; weight: number };

const SPECS: Spec[] = [
  ...[400, 500, 700, 800].map((weight) => ({ family: "Poppins", weight })),
  ...[400, 500, 700].map((weight) => ({ family: "Oswald", weight })),
  ...[400, 600, 800].map((weight) => ({ family: "Sora", weight })),
  ...[400, 600, 800].map((weight) => ({ family: "Archivo", weight })),
  // Indic scripts (hi/kn videos) — used as a fontFamily fallback for non-Latin glyphs
  ...[400, 600, 700, 800].map((weight) => ({ family: "Noto Sans Devanagari", weight })),
  ...[400, 600, 700, 800].map((weight) => ({ family: "Noto Sans Kannada", weight })),
];

/** Family names to reference as `fontFamily` in components. */
export const FONTS = {
  poppins: "Poppins",
  oswald: "Oswald",
  sora: "Sora",
  archivo: "Archivo",
} as const;

/** Append to any fontFamily so Hindi/Kannada glyphs render (Latin stays primary). */
export const INDIC_FALLBACK = '"Noto Sans Devanagari", "Noto Sans Kannada"';
export const withIndic = (family: string) => `${family}, ${INDIC_FALLBACK}`;

if (typeof document !== "undefined") {
  const css = SPECS.map(
    (s) =>
      `@font-face{font-family:"${s.family}";font-style:normal;` +
      `font-weight:${s.weight};font-display:swap;` +
      `src:url(${staticFile(`fonts/${s.family.replace(/ /g, "")}-${s.weight}.woff2`)}) format("woff2");}`,
  ).join("\n");

  const style = document.createElement("style");
  style.setAttribute("data-ainews-fonts", "");
  style.textContent = css;
  document.head.appendChild(style);

  // Block the render until the faces are ready so frame 0 isn't unstyled.
  // Any failure (missing files) resolves too — we never want to hang a render.
  const handle = delayRender("Loading self-hosted AINews fonts");
  Promise.all(SPECS.map((s) => document.fonts.load(`${s.weight} 1em "${s.family}"`)))
    .catch(() => undefined)
    .finally(() => continueRender(handle));
}
