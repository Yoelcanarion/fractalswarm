import { siteOf, type Site } from "../lib/controls";
import { useRunStore } from "../store";

/** Where the app runs, as the capabilities answer says (`static: true` on the showcase): a copy that depends on it reads it here. Until the
 * answer arrives it is a server's, which only a sentence that is read after a click or a hover can show. */
export function useSite(): Site {
  return useRunStore((s) => siteOf(s.capabilities));
}
