import { useEffect } from "react";

/** The browser tab's title follows the page: tabs side by side, history and a screen reader's page list all read it. */
export function useDocumentTitle(title: string): void {
  useEffect(() => {
    document.title = title;
  }, [title]);
}
