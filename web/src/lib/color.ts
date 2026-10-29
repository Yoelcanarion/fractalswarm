// Colour science used by the token tests: WCAG contrast and the dataviz validator's metrics
// (OKLab distance x100, Machado 2009 dichromacy at severity 1.0). Test-only; the app never
// computes a colour at runtime.

export type Rgb = [number, number, number];

const MACHADO = {
  protan: [
    [0.152286, 1.052583, -0.204868],
    [0.114503, 0.786281, 0.099216],
    [-0.003882, -0.048116, 1.051998],
  ],
  deutan: [
    [0.367322, 0.860646, -0.227968],
    [0.280085, 0.672501, 0.047413],
    [-0.01182, 0.04294, 0.968881],
  ],
} as const;

const toLinear = (c: number): number => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const clamp01 = (c: number): number => Math.max(0, Math.min(1, c));

export function parseHex(hex: string): Rgb {
  const h = hex.trim().replace(/^#/, "");
  const full = h.length === 3 ? [...h].map((c) => c + c).join("") : h;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) throw new Error(`not a #rrggbb colour: ${hex}`);
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16) / 255) as Rgb;
}

const linearRgb = (hex: string): Rgb => parseHex(hex).map(toLinear) as Rgb;

export function luminance(hex: string): number {
  const [r, g, b] = linearRgb(hex);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG 2 contrast ratio, 1 to 21. */
export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

export type Lab = [number, number, number];

function oklab([r, g, b]: Rgb): Lab {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

export function lab(hex: string): Lab {
  return oklab(linearRgb(hex));
}

export const lightness = (hex: string): number => lab(hex)[0];
export const chroma = (hex: string): number => Math.hypot(lab(hex)[1], lab(hex)[2]);

function simulate(hex: string, kind: keyof typeof MACHADO): Lab {
  const [r, g, b] = linearRgb(hex);
  const M = MACHADO[kind];
  return oklab([0, 1, 2].map((i) => clamp01(M[i][0] * r + M[i][1] * g + M[i][2] * b)) as Rgb);
}

const distance = (a: Lab, b: Lab): number => 100 * Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/** Delta E (OKLab x100) with unsimulated vision. */
export const deltaE = (a: string, b: string): number => distance(lab(a), lab(b));

/** The smaller of the protanopia and deuteranopia distances: the pair's colour-blind separation. */
export const cvdDeltaE = (a: string, b: string): number =>
  Math.min(distance(simulate(a, "protan"), simulate(b, "protan")), distance(simulate(a, "deutan"), simulate(b, "deutan")));
