// The form that starts an ablation on the generator's notes (the practice backend: it costs nothing), and its checks.
// The server takes 0 to 200 notes of each kind, not both 0; the page says so before it asks.

import type { AblationRequest } from "./api";

export const MAX_NOTES = 200;

export interface LauncherForm {
  emails: string;
  abstracts: string;
  seed: string;
}

/** What the server uses when nothing is said: 8 emails, 8 abstracts, seed 1. */
export const defaultLauncher = (): LauncherForm => ({ emails: "8", abstracts: "8", seed: "1" });

const whole = (text: string): number | null => (/^\d+$/.test(text.trim()) ? Number(text.trim()) : null);

/** Why the form cannot start yet, in the person's terms; empty when it can. */
export function launcherProblems(form: LauncherForm): string[] {
  const problems: string[] = [];
  const emails = whole(form.emails);
  const abstracts = whole(form.abstracts);
  if (emails === null || emails > MAX_NOTES) problems.push(`Emails: a whole number from 0 to ${MAX_NOTES}.`);
  if (abstracts === null || abstracts > MAX_NOTES) problems.push(`Abstracts: a whole number from 0 to ${MAX_NOTES}.`);
  if (emails === 0 && abstracts === 0) problems.push("Ask for at least one note.");
  if (whole(form.seed) === null) problems.push("Seed: a whole number.");
  return problems;
}

export function requestOf(form: LauncherForm): AblationRequest {
  return { emails: Number(form.emails.trim()), abstracts: Number(form.abstracts.trim()), seed: Number(form.seed.trim()) };
}
