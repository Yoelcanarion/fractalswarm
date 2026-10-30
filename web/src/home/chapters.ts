// The chapters of the home page, in reading order. The rail, the bar and the deep links
// (`#/?at=solution`) all read this list.

export const CHAPTERS = [
  { id: "problem", number: "01", label: "Problem" },
  { id: "solution", number: "02", label: "Solution" },
  { id: "models", number: "03", label: "Models" },
  { id: "evidence", number: "04", label: "Evidence" },
  { id: "enter", number: "05", label: "Enter" },
] as const;

export type ChapterId = (typeof CHAPTERS)[number]["id"];

export const isChapterId = (value: string | null | undefined): value is ChapterId => CHAPTERS.some((chapter) => chapter.id === value);

/** The index of the chapter under a probe line: the last chapter whose top is at or above `y`,
 * or -1 while the page is still above the first one (the hero). `tops` are in page order. */
export function chapterAt(tops: readonly number[], y: number): number {
  let found = -1;
  for (let i = 0; i < tops.length; i++) {
    if (tops[i] <= y) found = i;
    else break;
  }
  return found;
}
