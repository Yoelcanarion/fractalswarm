// The sections of the home page, in reading order, and the places a link can name. The skip link, the bar and the deep links
// (`#/?at=solution`) all read this list. The evidence page has its own list of places below.

export const SECTION_IDS = ["hero", "problem", "solution", "proof", "enter"] as const;
export type SectionId = (typeof SECTION_IDS)[number];

export const isSectionId = (value: string | null | undefined): value is SectionId => SECTION_IDS.some((id) => id === value);

/** Places inside a section that a link can name too: the click demo, which the hero's button glides to. */
export const SPOTS = ["demo"] as const;
export type SpotId = (typeof SPOTS)[number];

/** Anything a link on the home page, or `#/?at=`, can scroll to: the id of an element of the page. */
export type Target = SectionId | SpotId;
export const isTarget = (value: string | null | undefined): value is Target => isSectionId(value) || SPOTS.some((spot) => spot === value);

/** The places of the evidence page (`#/evidence?at=tie`): R6 on the home page points to the one where R2 and R3 stand together. */
export const EVIDENCE_IDS = ["models", "run", "fair", "hero-chart", "tie", "helps", "fails", "proof"] as const;
export type EvidenceId = (typeof EVIDENCE_IDS)[number];
export const isEvidenceId = (value: string | null | undefined): value is EvidenceId => EVIDENCE_IDS.some((id) => id === value);
