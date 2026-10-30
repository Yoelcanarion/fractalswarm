// The entry of the static showcase (vite --mode static). main.tsx loads this only in that mode, through a dynamic import
// the other builds fold away, and starts the app from `mount` once the shim is in place: the app's first `api/...` call
// happens as it mounts, so the answers must be there before it does.

import { createRoot } from "react-dom/client";

import { StaticBanner } from "./Banner";
import { readManifest, type SiteStamp } from "./manifest";
import { PROGRESS_EVENT } from "./progress";
import { createStaticFetch } from "./shim";
import { silenceEventStreams } from "./socket";
import "./static.css";

function showBanner(site: SiteStamp): void {
  const host = document.createElement("div");
  host.id = "static-banner";
  document.body.insertBefore(host, document.getElementById("root"));
  createRoot(host).render(<StaticBanner site={site} />);
}

/** Why the page is empty, in the page. The usual cause is opening index.html from disk: a browser will not let a page
 * read its own data files over file://. */
function explain(error: unknown): void {
  console.error(error);
  const note = document.createElement("div");
  note.className = "empty empty--bad";
  note.textContent = `The static showcase could not load its data: ${error instanceof Error ? error.message : String(error)}. It needs a web server, and cannot run from a file: serve this folder (python -m http.server) and open it at http://localhost:8000/.`;
  document.getElementById("root")?.replaceChildren(note);
}

export async function startStatic(mount: () => void): Promise<void> {
  try {
    const base = document.baseURI;
    const data = new URL("data/", base);
    const original = window.fetch.bind(window);
    // The manifest is asked again every time (a cheap revalidation); the files it names carry the build in their URL,
    // so a site published again is never read through the old copies a cache still holds (GitHub Pages keeps a file
    // for ten minutes, and a new manifest over old pages would not describe them).
    const found = await original(new URL("manifest.json", data), { cache: "no-cache" });
    if (!found.ok) throw new Error(`data/manifest.json answered ${found.status}`);
    const manifest = readManifest(await found.json());
    const build = encodeURIComponent(`${manifest.site.commit_short}-${manifest.site.built_at}`);
    window.fetch = createStaticFetch({
      manifest,
      base,
      load: (file, signal) => original(new URL(`${file}?v=${build}`, data), { signal }),
      passthrough: original,
      onProgress: (detail) => window.dispatchEvent(new CustomEvent(PROGRESS_EVENT, { detail })),
    });
    silenceEventStreams(base, window);
    showBanner(manifest.site);
    mount();
  } catch (error) {
    explain(error);
  }
}
