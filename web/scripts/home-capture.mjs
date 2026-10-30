// Capture tools for the home page (W6): screenshots, the length and the words of the page, frame times per animation, what the
// first load fetches, and the size of a build. They drive Playwright's Chromium (or Firefox), which is not a dependency of the
// web app: install `playwright-core@1.48.2` (it matches chromium-1140) into a folder outside the repo and point PW_DIR at the
// folder that holds its node_modules.
//
//   PW_DIR=<dir> node web/scripts/home-capture.mjs shots  <base url> <out dir> [configs]
//   PW_DIR=<dir> node web/scripts/home-capture.mjs layout <base url>
//   PW_DIR=<dir> node web/scripts/home-capture.mjs frames <base url> [part of an animation's name ...]
//   PW_DIR=<dir> node web/scripts/home-capture.mjs net    <base url> [hash ...]
//                node web/scripts/home-capture.mjs bundle <dist dir>
//
// shots   configs are comma-separated "<width>:<theme>:<mode>", default "1920:dark:motion". Width 1920 (x1080), 1366 (x768)
//         or 390 (x844); theme dark | light; mode motion (each section scrolled to and waited for, then the whole page, then
//         the page with every See more open) | reduced (reduced motion) | still (`#/?still`, one image per section). Each
//         config also takes the evidence page (`#/evidence`) and prints the page errors it saw.
// layout  the redesign brief's numbers: the height of the page and of each section at three sizes (at most 7,000 px at
//         1920x1080), the words in view with every See more closed (about 200, at most 230: the count words.test.ts holds,
//         taken from the rendered page), what is `fixed` or `sticky` (only the top bar and the skip link may be), whether the
//         page scrolls sideways, the number of folds, and every request the page makes (none outside the server, none to /api).
// frames  frame times (every requestAnimationFrame: p50, p95, p99, max, and the share over 17 ms and over 33 ms) of each
//         animation on its own, at 1920x1080, each in a fresh page so that an animation that plays on arrival has not played
//         yet: the hero's loop, the problem film (on arrival, and again from Repeat), the three step cards on hover, the proof
//         bars and numbers, a takeover in the click demo, the door thumbnails (idle and on hover) and a wheel through the whole
//         page. BROWSER=firefox runs it in Playwright's Firefox instead of Chromium.
// net     lists what a browser fetches on the first load of each hash of a served build (`vite preview`), raw and gzip.
// bundle  lists the files index.html loads at once, and every other asset of a build, raw and gzip.
//
// Build into a scratch folder (`npx vite build --outDir <dir> --emptyOutDir`), never over src/fractalswarm/api/static,
// which is tracked.

import { mkdirSync, readdirSync, readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { extname, join } from "node:path";
import { gzipSync } from "node:zlib";

const EXE = process.env.CHROMIUM_EXE ?? join(homedir(), "AppData/Local/ms-playwright/chromium-1140/chrome-win/chrome.exe");
const kb = (n) => (n / 1024).toFixed(1).padStart(9);
const cell = (value, width) => String(value).padStart(width);

// BROWSER=firefox drives Playwright's own Firefox (`node <PW_DIR>/node_modules/playwright-core/cli.js install firefox`).
const launch = async () => {
  const { chromium, firefox } = createRequire(`${process.env.PW_DIR ?? process.cwd()}/`)("playwright-core");
  return process.env.BROWSER === "firefox" ? firefox.launch({ headless: true }) : chromium.launch({ executablePath: EXE, headless: true });
};

const watchErrors = (page) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
  page.on("console", (msg) => msg.type() === "error" && errors.push(`console: ${msg.text().slice(0, 240)}`));
  return errors;
};

const VIEWPORTS = { 1920: { width: 1920, height: 1080 }, 1366: { width: 1366, height: 768 }, 390: { width: 390, height: 844 } };

/** Scroll to an element and put it in the middle of the screen at once: the jump is part of what arrival has to bear. */
const centre = (page, selector) =>
  page.evaluate((sel) => document.querySelector(sel)?.scrollIntoView({ block: "center", behavior: "instant" }), selector);
const toTop = (page, selector) =>
  page.evaluate((sel) => document.querySelector(sel)?.scrollIntoView({ block: "start", behavior: "instant" }), selector);

const ready = async (page, base, hash = "#/") => {
  await page.goto(`${base}/${hash}`, { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);
};

// ---- shots ----------------------------------------------------------------------------------------------------

// The section, and how long its animation takes to play (a section's own animation starts when about 40% of it is on screen).
const WALK = [
  ["problem", "#problem", 8500],
  ["solution", "#solution", 2500],
  ["demo", "#demo", 1200],
  ["proof", "#proof", 3000],
  ["enter", "#enter", 2500],
];
const SECTIONS = ["#hero", "#problem", "#solution", "#proof", "#enter", ".home-footer"];

async function shots(base, out, configs = "1920:dark:motion") {
  mkdirSync(out, { recursive: true });
  const browser = await launch();
  const summary = [];
  for (const config of configs.split(",")) {
    const [size, theme, mode] = config.split(":");
    const viewport = VIEWPORTS[size];
    if (!viewport) throw new Error(`unknown width in "${config}"`);
    const context = await browser.newContext({
      viewport,
      deviceScaleFactor: 1,
      reducedMotion: mode === "reduced" ? "reduce" : "no-preference",
      hasTouch: size === "390",
    });
    const page = await context.newPage();
    const errors = watchErrors(page);
    const theming = async () =>
      page.evaluate(async (wanted) => {
        await document.fonts.ready;
        if (wanted === "light") document.documentElement.dataset.theme = "light";
        else delete document.documentElement.dataset.theme;
      }, theme);
    const tag = `${size}-${theme}-${mode}`;
    const shot = (name, options = {}) => page.screenshot({ path: `${out}/${tag}-${name}.png`, ...options });

    await page.goto(`${base}/#/${mode === "still" ? "?still" : ""}`, { waitUntil: "networkidle" });
    await theming();
    await page.waitForTimeout(mode === "motion" ? 2500 : 1200);

    if (mode === "still") {
      for (const selector of SECTIONS) {
        await page.locator(selector).first().screenshot({ path: `${out}/${tag}-${selector.replace(/[^a-z]/g, "")}.png` });
      }
    } else {
      await shot("01-hero");
      if (mode === "motion") {
        for (const [name, selector, wait] of WALK) {
          await toTop(page, selector);
          await page.waitForTimeout(wait);
          await shot(`02-${name}`);
        }
      }
      await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
      await page.waitForTimeout(400);
      await shot("03-full", { fullPage: true });
      // every See more open: what a visitor finds when they ask for the nuance
      await page.evaluate(() => document.querySelectorAll("details.home-fold").forEach((d) => (d.open = true)));
      await page.waitForTimeout(600);
      await shot("04-full-open", { fullPage: true });
    }

    await page.goto(`${base}/#/evidence`, { waitUntil: "networkidle" });
    await theming();
    await page.waitForTimeout(1200);
    await shot("05-evidence", { fullPage: true });

    const unique = [...new Set(errors)];
    summary.push(`${tag}: ${unique.length ? unique.slice(0, 6).join(" | ") : "no errors"}`);
    await context.close();
  }
  await browser.close();
  console.log(summary.join("\n"));
}

// ---- layout ---------------------------------------------------------------------------------------------------

// Run in the page. The words are counted the way words.test.ts counts them: what is in view with every See more closed, leaving
// out what is hidden from the eye (aria-hidden, the text only a screen reader gets, the skip link). The text inside a drawing
// (an svg: node names, bar labels) is counted apart, as svgWords: the test leaves it out because it comes and goes with the
// animation, and this shows what it comes to.
const measurePage = () => {
  const root = document.querySelector(".home");
  const hiddenFromTheEye = "[aria-hidden='true'], [hidden], script, style, .home-sr, .home-skip, .home-placeholder";
  let words = 0;
  let svgWords = 0;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const element = node.parentElement;
    if (!element || element.closest(hiddenFromTheEye)) continue;
    const details = element.closest("details");
    if (details && !details.open && !element.closest("summary")) continue;
    const style = getComputedStyle(element);
    if (style.display === "none" || style.visibility === "hidden") continue;
    const count = node.textContent.split(/\s+/).filter((piece) => /[\p{L}\p{N}]/u.test(piece)).length;
    if (element.closest("svg")) svgWords += count;
    else words += count;
  }
  const sections = [...document.querySelectorAll("main > section")].map((s) => `${s.id} ${Math.round(s.getBoundingClientRect().height)}`);
  const pinned = [...document.querySelectorAll("body *")]
    .filter((el) => ["fixed", "sticky"].includes(getComputedStyle(el).position))
    .map((el) => `${el.tagName.toLowerCase()}.${String(el.className).split(" ")[0]} (${getComputedStyle(el).position})`);
  return {
    height: document.documentElement.scrollHeight,
    width: document.documentElement.scrollWidth,
    screen: innerWidth,
    words,
    svgWords,
    sections,
    pinned,
    folds: document.querySelectorAll("details.home-fold").length,
  };
};

async function layout(base) {
  const browser = await launch();
  const origin = new URL(base).origin;
  const problems = [];
  console.log(`${process.env.BROWSER ?? "chromium"}: the home page and the evidence page, three sizes`);
  for (const [size, viewport] of Object.entries(VIEWPORTS)) {
    for (const hash of ["#/", "#/evidence"]) {
      const page = await browser.newPage({ viewport, deviceScaleFactor: 1 });
      const errors = watchErrors(page);
      const requests = [];
      page.on("request", (request) => requests.push(request.url()));
      await ready(page, base, hash);
      await page.waitForTimeout(1500);
      const m = await page.evaluate(measurePage);
      const outside = requests.filter((url) => !url.startsWith(origin) && !url.startsWith("data:") && !url.startsWith("blob:"));
      const api = requests.filter((url) => url.startsWith(origin) && new URL(url).pathname.startsWith("/api"));
      const sideways = m.width > m.screen;
      const bad = [];
      if (hash === "#/" && size === "1920" && m.height > 7000) bad.push(`height ${m.height} over 7000`);
      if (hash === "#/" && m.words > 230) bad.push(`${m.words} words over 230`);
      const loose = m.pinned.filter((p) => !/home-bar|home-skip/.test(p));
      if (loose.length) bad.push(`pinned: ${loose.join(", ")}`);
      if (sideways) bad.push("page scrolls sideways");
      if (outside.length) bad.push(`outside requests: ${outside.join(", ")}`);
      if (api.length) bad.push(`/api requests: ${api.join(", ")}`);
      if (errors.length) bad.push(`errors: ${[...new Set(errors)].slice(0, 4).join(" | ")}`);
      console.log(
        `${size.padStart(4)} ${hash.padEnd(10)} height ${String(m.height).padStart(6)} px (${(m.height / viewport.height).toFixed(1)} screens)` +
          `  words ${String(m.words).padStart(4)} (+${m.svgWords} in drawings)  folds ${m.folds}  ${bad.length ? "CHECK: " + bad.join("; ") : "OK"}`,
      );
      if (hash === "#/") console.log(`      sections: ${m.sections.join(" | ")}   pinned: ${m.pinned.join(", ") || "none"}`);
      if (bad.length) problems.push(`${size} ${hash}: ${bad.join("; ")}`);
      await page.close();
    }
  }
  await browser.close();
  console.log(problems.length ? `\n${problems.length} thing(s) to look at` : "\nall within the brief");
}

// ---- frames ---------------------------------------------------------------------------------------------------

// A frame logger of its own (every requestAnimationFrame), so that it works on any build and in any browser.
const frameLogger = () => {
  const dt = [];
  let last = 0;
  const loop = (t) => {
    if (last) dt.push(t - last);
    last = t;
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
  window.__frameLog = {
    reset: () => {
      dt.length = 0;
      last = 0;
    },
    take: () => dt.slice(),
  };
};

const quantile = (sorted, q) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1))] ?? 0;
const HEADER = "animation                                   frames  seconds  fps  p50 ms  p95 ms  p99 ms  max ms   >17 ms   >33 ms";

function row(name, dt) {
  const sorted = dt.slice().sort((a, b) => a - b);
  const total = dt.reduce((a, b) => a + b, 0);
  const share = (limit) => `${((100 * dt.filter((x) => x > limit).length) / Math.max(1, dt.length)).toFixed(1)}%`;
  return (
    `${name.padEnd(42)} ${cell(dt.length, 7)} ${cell((total / 1000).toFixed(1), 8)} ${cell(Math.round((1000 * dt.length) / Math.max(1, total)), 4)}` +
    ` ${cell(quantile(sorted, 0.5).toFixed(1), 7)} ${cell(quantile(sorted, 0.95).toFixed(1), 7)} ${cell(quantile(sorted, 0.99).toFixed(1), 7)}` +
    ` ${cell((sorted.at(-1) ?? 0).toFixed(1), 7)} ${cell(share(17), 8)} ${cell(share(33), 8)}`
  );
}

// Each animation: `run(page, record)` gets a fresh page that has just loaded and settled. `record(ms, action)` clears the log, does
// the action, waits `ms` and returns the frames. A run may record several windows; its row joins them.
const ANIMATIONS = [
  {
    name: "hero loop (one pass, nothing else)",
    run: async (page, record) => [await record(14000, async () => {})],
  },
  {
    name: "problem film, on arrival",
    run: async (page, record) => [await record(9000, () => centre(page, ".home-film"))],
  },
  {
    name: "problem film, from Repeat",
    run: async (page, record) => {
      await centre(page, ".home-film");
      await page.waitForTimeout(9000);
      if ((await page.locator(".home-repeat").count()) === 0) return null;
      return [await record(9000, () => page.locator(".home-repeat").first().click())];
    },
  },
  {
    name: "step cards, hover (three cards)",
    run: async (page, record) => {
      await centre(page, ".home-steps");
      await page.waitForTimeout(2500);
      const windows = [];
      for (let i = 1; i <= 3; i++) {
        windows.push(await record(1500, () => page.hover(`.home-step:nth-child(${i})`)));
        await page.mouse.move(5, 5);
        await page.waitForTimeout(900);
      }
      return windows;
    },
  },
  {
    name: "proof bars and numbers, on arrival",
    run: async (page, record) => [await record(3500, () => centre(page, ".home-proof__chart"))],
  },
  {
    name: "click demo, a takeover",
    run: async (page, record) => {
      await centre(page, "#demo");
      await page.waitForTimeout(1500);
      const control = page.locator("#demo button:not([disabled])").first();
      if ((await control.count()) === 0) return null;
      return [await record(3500, () => control.click())];
    },
  },
  {
    name: "door thumbnails, idle on screen",
    run: async (page, record) => [await record(6000, () => centre(page, "#enter"))],
  },
  {
    name: "door thumbnail, hover (three doors)",
    run: async (page, record) => {
      await centre(page, "#enter");
      await page.waitForTimeout(2500);
      const windows = [];
      for (let i = 1; i <= 3; i++) {
        windows.push(await record(1500, () => page.hover(`#enter .home-door-slot:nth-child(${i}) .home-door`)));
        await page.mouse.move(5, 5);
        await page.waitForTimeout(900);
      }
      return windows;
    },
  },
  {
    name: "the whole page, wheel at 1800 px/s",
    run: async (page, record) => {
      const STEP_MS = 16;
      const step = Math.round((1800 * STEP_MS) / 1000);
      const total = await page.evaluate(() => document.documentElement.scrollHeight - innerHeight);
      await page.mouse.move(960, 540);
      return [
        await record(0, async () => {
          for (let travelled = 0; travelled < total; travelled += step) {
            await page.mouse.wheel(0, step);
            await page.waitForTimeout(STEP_MS);
          }
          await page.waitForTimeout(300);
        }),
      ];
    },
  },
];

async function frames(base, ...only) {
  const browser = await launch();
  const chosen = ANIMATIONS.filter((a) => only.length === 0 || only.some((word) => a.name.includes(word)));
  console.log(`${process.env.BROWSER ?? "chromium"}, 1920x1080, each animation in a fresh page`);
  console.log(HEADER);
  const errors = [];
  for (const animation of chosen) {
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
    errors.push(...watchErrors(page));
    await page.addInitScript(frameLogger);
    await ready(page, base);
    await page.mouse.move(5, 5);
    await page.waitForTimeout(1500);
    const record = async (ms, action) => {
      await page.evaluate(() => window.__frameLog.reset());
      await action();
      if (ms) await page.waitForTimeout(ms);
      return page.evaluate(() => window.__frameLog.take());
    };
    const windows = await animation.run(page, record);
    console.log(windows ? row(animation.name, windows.flat()) : `${animation.name.padEnd(42)} (nothing to trigger yet)`);
    await page.close();
  }
  console.log(errors.length ? `errors: ${[...new Set(errors)].slice(0, 6).join(" | ")}` : "no page errors");
  await browser.close();
}

// ---- net ------------------------------------------------------------------------------------------------------

async function net(base, ...hashes) {
  const browser = await launch();
  for (const hash of hashes.length ? hashes : ["#/"]) {
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
    const errors = watchErrors(page);
    const seen = [];
    page.on("response", async (response) => {
      try {
        const body = await response.body();
        const type = response.request().resourceType();
        const text = ["script", "stylesheet", "document"].includes(type);
        seen.push({ url: response.url().replace(base, ""), type, raw: body.length, gzip: text ? gzipSync(body).length : body.length });
      } catch {
        /* a redirect or an aborted request has no body */
      }
    });
    await page.goto(`${base}/${hash}`, { waitUntil: "networkidle" });
    await page.waitForTimeout(1500);
    console.log(`\n## first load of ${hash}`);
    console.log("      raw KB   gzip KB  type        url");
    for (const r of seen.sort((a, b) => b.raw - a.raw)) console.log(`${kb(r.raw)} ${kb(r.gzip)}  ${r.type.padEnd(10)}  ${r.url}`);
    const byType = new Map();
    for (const r of seen) {
      const sum = byType.get(r.type) ?? { raw: 0, gzip: 0 };
      byType.set(r.type, { raw: sum.raw + r.raw, gzip: sum.gzip + r.gzip });
    }
    for (const [type, sum] of [...byType].sort()) console.log(`${kb(sum.raw)} ${kb(sum.gzip)}  ${type} in total`);
    console.log(`${kb(seen.reduce((n, r) => n + r.raw, 0))} ${kb(seen.reduce((n, r) => n + r.gzip, 0))}  everything (${seen.length} requests)`);
    console.log(errors.length ? `errors: ${[...new Set(errors)].slice(0, 8).join("\n  ")}` : "no page errors");
    await page.close();
  }
  await browser.close();
}

// ---- bundle ---------------------------------------------------------------------------------------------------

function bundle(dist) {
  const TEXT = new Set([".js", ".css", ".html", ".svg", ".json"]);
  const walk = (dir) =>
    readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      return statSync(path).isDirectory() ? walk(path) : [path];
    });
  const html = readFileSync(join(dist, "index.html"), "utf-8");
  const first = new Set(["index.html"]);
  for (const match of html.matchAll(/(?:src|href)="\.?\/?(assets\/[^"]+)"/g)) first.add(match[1]);
  const rows = walk(dist).map((path) => {
    const bytes = readFileSync(path);
    const rel = path.slice(dist.length + 1).replaceAll("\\", "/");
    return { rel, raw: bytes.length, gzip: TEXT.has(extname(path)) ? gzipSync(bytes).length : bytes.length, first: first.has(rel) };
  });
  const print = (title, list) => {
    console.log(`\n## ${title}`);
    console.log("      raw KB   gzip KB  file");
    for (const r of list.sort((a, b) => b.raw - a.raw)) console.log(`${kb(r.raw)} ${kb(r.gzip)}  ${r.rel}`);
    console.log(`${kb(list.reduce((n, r) => n + r.raw, 0))} ${kb(list.reduce((n, r) => n + r.gzip, 0))}  total (${list.length} files)`);
  };
  print("loaded at once by index.html (scripts, preloads, styles)", rows.filter((r) => r.first));
  print("everything else (lazy chunks, fonts, images)", rows.filter((r) => !r.first));
}

// ---------------------------------------------------------------------------------------------------------------

const [command, ...args] = process.argv.slice(2);
const COMMANDS = { shots, layout, frames, net, bundle };
if (!COMMANDS[command]) {
  console.error("usage: home-capture.mjs shots <base> <out> [configs] | layout <base> | frames <base> [name ...] | net <base> [hash ...] | bundle <dist>");
  process.exit(2);
}
await COMMANDS[command](...args);
