// The theme is put on twice: by a script in web/index.html before the first paint (so a light page never starts dark), and by
// initTheme() when the bundle runs. They read the same address and the same storage and must never disagree, or the page flashes.

import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";

import { REPO_ROOT } from "./testing";
import { initTheme, THEME_KEY } from "./theme";

const HTML = readFileSync(REPO_ROOT + "web/index.html", "utf-8");
const SCRIPT = /<script>([\s\S]*?)<\/script>/.exec(HTML)?.[1] ?? "";

interface Page {
  search: string;
  /** What the browser has kept: a name, nothing, or storage that throws (a private window, blocked site data). */
  stored: string | null | "throws";
}

/** A page with a root element, the colour-scheme meta, an address and a storage, as far as the two readers touch them. */
function makePage({ search, stored }: Page) {
  const root = {
    dataset: {} as Record<string, string | undefined>,
    setAttribute(name: string, value: string) {
      if (name === "data-theme") this.dataset.theme = value;
    },
  };
  const meta = {
    content: "dark",
    setAttribute(name: string, value: string) {
      if (name === "content") this.content = value;
    },
  };
  const storage = {
    getItem: (key: string) => {
      if (stored === "throws") throw new Error("blocked");
      return key === THEME_KEY ? stored : null;
    },
  };
  const document = { documentElement: root, querySelector: (selector: string) => (selector === 'meta[name="color-scheme"]' ? meta : null) };
  const window = { location: { search }, localStorage: storage };
  return { root, meta, storage, document, window };
}

/** What the page ends up with after the script in index.html has run. */
function beforePaint(page: Page) {
  const p = makePage(page);
  new Function("window", "document", SCRIPT)(p.window, p.document);
  return { theme: p.root.dataset.theme, meta: p.meta.content };
}

/** What the page ends up with after the bundle's initTheme() has run. */
function inTheBundle(page: Page) {
  const p = makePage(page);
  vi.stubGlobal("window", p.window);
  vi.stubGlobal("document", p.document);
  vi.stubGlobal("localStorage", p.storage);
  initTheme();
  return { theme: p.root.dataset.theme, meta: p.meta.content };
}

afterEach(() => vi.unstubAllGlobals());

const CASES: [string, Page, "light" | "dark"][] = [
  ["asked for in the address", { search: "?theme=light", stored: null }, "light"],
  ["asked for dark in the address, over a saved light", { search: "?theme=dark", stored: "light" }, "dark"],
  ["saved as light", { search: "", stored: "light" }, "light"],
  ["saved as dark", { search: "", stored: "dark" }, "dark"],
  ["not said anywhere: dark, the default", { search: "", stored: null }, "dark"],
  ["an empty request in the address is an answer, and it is dark", { search: "?theme=", stored: "light" }, "dark"],
  ["an unknown name is dark", { search: "?theme=sepia", stored: "light" }, "dark"],
  ["another parameter leaves it to the storage", { search: "?run=1", stored: "light" }, "light"],
  ["blocked storage is dark, and does not throw", { search: "", stored: "throws" }, "dark"],
  ["asking in the address needs no storage", { search: "?theme=light", stored: "throws" }, "light"],
];

describe("the theme before the first paint", () => {
  it.each(CASES)("%s", (_name, page, theme) => {
    const want = { theme: theme === "light" ? "light" : undefined, meta: theme };
    expect(beforePaint(page)).toEqual(want);
    expect(inTheBundle(page)).toEqual(want);
  });

  it("sits in the head before the page's own script, and is the only inline one", () => {
    expect(SCRIPT).not.toBe("");
    expect(HTML.match(/<script>/g)).toHaveLength(1);
    expect(HTML.indexOf("<script>")).toBeLessThan(HTML.indexOf("</head>"));
    expect(HTML.indexOf("<script>")).toBeLessThan(HTML.indexOf('type="module"'));
  });

  it("leaves the meta saying dark, the default, and reads the key the bundle writes, behind a try", () => {
    expect(HTML).toContain('<meta name="color-scheme" content="dark" />');
    expect(SCRIPT).toContain(`"${THEME_KEY}"`);
    expect(SCRIPT).toMatch(/try\s*\{[\s\S]*localStorage[\s\S]*\}\s*catch/);
  });
});
