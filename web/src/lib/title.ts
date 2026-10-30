// The browser tab's title. A page names itself while it is on screen and hands the tab back to the app's name
// when it leaves, so a page that does not name itself never shows another page's title.

import { useEffect } from "react";

export const APP_NAME = "FractalSwarm";

/** "Charts · FractalSwarm", "Run demo-backup · Plan · FractalSwarm": the page's parts, most specific first. */
export function titleOf(...parts: (string | null | undefined)[]): string {
  return [...parts.filter((part): part is string => Boolean(part)), APP_NAME].join(" · ");
}

export function useDocumentTitle(...parts: (string | null | undefined)[]): void {
  const title = titleOf(...parts);
  useEffect(() => {
    document.title = title;
    return () => {
      document.title = APP_NAME;
    };
  }, [title]);
}
