import { useEffect } from "react";

/** Sets the tab's title and returns what puts the old one back: the app sits under the home page, whose title is the page's own, so
 * going home must not leave "Runs · FractalSwarm" in the tab. */
export function applyTitle(title: string): () => void {
  const before = document.title;
  document.title = title;
  return () => {
    document.title = before;
  };
}

/** The browser tab's title follows the page: tabs side by side, history and a screen reader's page list all read it. */
export function useDocumentTitle(title: string): void {
  useEffect(() => applyTitle(title), [title]);
}
