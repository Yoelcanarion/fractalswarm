// What the person pasted, kept for as long as the page stays open and no longer: leaving for another tab and coming back
// does not lose a long paste, and a reload (or "Clear") does. It is never written to localStorage, sessionStorage, a
// cookie or IndexedDB: it can hold private text, and the repo's rule is that it stays on this machine and out of git.
// A test reads the sources of this folder to keep it that way.

import { emptyForm, type ReadingForm } from "./launch";

let remembered: ReadingForm = emptyForm();

export const rememberedForm = (): ReadingForm => remembered;

export function remember(form: ReadingForm): void {
  remembered = form;
}

/** Empty the form, and the memory of it. */
export function forget(): ReadingForm {
  remembered = emptyForm();
  return remembered;
}
