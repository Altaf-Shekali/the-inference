import { staticFile, delayRender, continueRender } from "remotion";

export const ARABIC_FONTS = '"Amiri", "Noto Naskh Arabic", serif';
export const withArabic = (family?: string) => (family ? `${family}, ${ARABIC_FONTS}` : ARABIC_FONTS);

const ISLAMIC_FONT_SPECS = [
  { family: "Amiri", weight: 400 },
  { family: "Amiri", weight: 700 },
  { family: "Noto Naskh Arabic", weight: 400 },
  { family: "Noto Naskh Arabic", weight: 700 },
  { family: "Poppins", weight: 400 },
  { family: "Poppins", weight: 600 },
  { family: "Poppins", weight: 700 },
];

if (typeof document !== "undefined") {
  const css = ISLAMIC_FONT_SPECS.map(
    (s) =>
      `@font-face{font-family:"${s.family}";font-style:normal;` +
      `font-weight:${s.weight};font-display:swap;` +
      `src:url(${staticFile(`fonts/${s.family.replace(/ /g, "")}-${s.weight}.woff2`)}) format("woff2");}`,
  ).join("\n");

  const style = document.createElement("style");
  style.setAttribute("data-islamic-fonts", "");
  style.textContent = css;
  document.head.appendChild(style);

  const handle = delayRender("Loading Islamic fonts");
  Promise.all(ISLAMIC_FONT_SPECS.map((s) => document.fonts.load(`${s.weight} 1em "${s.family}"`)))
    .catch(() => undefined)
    .finally(() => continueRender(handle));
}
