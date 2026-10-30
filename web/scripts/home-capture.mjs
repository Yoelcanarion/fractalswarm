// Capture tools for the home page (W6): screenshots, frame times, what the first load fetches, and the size of a build.
// They drive Playwright's Chromium, which is not a dependency of the web app: install `playwright-core@1.48.2` (it
// matches chromium-1140) into a folder outside the repo and point PW_DIR at the folder that holds its node_modules.
//
//   PW_DIR=<dir> node web/scripts/home-capture.mjs shots  <base url> <out dir> [configs]
//   PW_DIR=<dir> node web/scripts/home-capture.mjs frames <base url> [px per second]
//   PW_DIR=<dir> node web/scripts/home-capture.mjs net    <base url> [hash ...]
//                node web/scripts/home-capture.mjs bundle <dist dir>
//
// shots   configs are comma-separated "<width>:<theme>:<mode>", default "1920:dark:motion".
//         width 1920 (x1080), 1366 (x768) or 390 (x844); theme dark | light; mode motion | reduced (reduced motion) |
//         still (`#/?still`, one image per section). Each config also prints the page errors it saw.
// frames  scrolls the wheel through each part of the page at 1920x1080 and prints the frame times of lib/perf.ts. It needs
//         the dev server (or a build made with VITE_FRAME_LOG=1), not a plain build.
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

const launch = async () => {
  const { chromium } = createRequire(`${process.env.PW_DIR ?? process.cwd()}/`)("playwright-core");
  return chromium.launch({ executablePath: EXE, headless: true });
};

const watchErrors = (page) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
  page.on("console", (msg) => msg.type() === "error" && errors.push(`console: ${msg.text().slice(0, 240)}`));
  return errors;
};

// ---- shots ----------------------------------------------------------------------------------------------------

const VIEWPORTS = { 1920: { width: 1920, height: 1080 }, 1366: { width: 1366, height: 768 }, 390: { width: 390, height: 844 } };
const STAGES = ["problem-stage", "solution-stage"];
const PROGRESS = [0.1, 0.3, 0.5, 0.7, 0.9];
const BEATS = ["models", "fair", "hero-chart", "tie", "helps", "fails", "proof", "enter"];
const SECTIONS = [".home-hero", "#problem", "#solution", "#models", "#evidence", "#enter", ".home-footer"];

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
    await page.goto(`${base}/#/${mode === "still" ? "?still" : ""}`, { waitUntil: "networkidle" });
    await page.evaluate(async (wanted) => {
      await document.fonts.ready;
      if (wanted === "light") document.documentElement.dataset.theme = "light";
      else delete document.documentElement.dataset.theme;
    }, theme);
    await page.waitForTimeout(1500);

    const tag = `${size}-${theme}-${mode}`;
    const shot = (name) => page.screenshot({ path: `${out}/${tag}-${name}.png` });
    if (mode === "still") {
      for (const selector of SECTIONS) {
        await page.locator(selector).first().screenshot({ path: `${out}/${tag}-${selector.replace(/[^a-z]/g, "")}.png` });
      }
    } else {
      await shot("01-hero");
      for (const stage of STAGES) {
        for (const p of PROGRESS) {
          await page.evaluate(
            ([id, progress]) => {
              const el = document.getElementById(id);
              if (!el) return;
              const top = el.getBoundingClientRect().top + window.scrollY;
              window.scrollTo(0, top + progress * (el.offsetHeight - window.innerHeight));
            },
            [stage, p],
          );
          await page.waitForTimeout(1000);
          await shot(`${stage}-${String(Math.round(p * 100)).padStart(2, "0")}`);
        }
      }
      for (const id of BEATS) {
        await page.evaluate((target) => document.getElementById(target)?.scrollIntoView({ block: "start" }), id);
        await page.waitForTimeout(1200);
        await shot(`sect-${id}`);
      }
    }
    const unique = [...new Set(errors)];
    summary.push(`${tag}: ${unique.length ? unique.slice(0, 6).join(" | ") : "no errors"}`);
    await context.close();
  }
  await browser.close();
  console.log(summary.join("\n"));
}

// ---- frames ---------------------------------------------------------------------------------------------------

const SEGMENTS = [
  ["hero", ".home-hero"],
  ["problem", "#problem"],
  ["solution", "#solution"],
  ["models", "#models"],
  ["evidence", "#evidence"],
  ["enter", "#enter"],
];

async function frames(base, speed = "1800") {
  const STEP_MS = 16;
  const step = Math.round((Number(speed) * STEP_MS) / 1000);
  const browser = await launch();
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  const errors = watchErrors(page);
  await page.goto(`${base}/?frames#/`, { waitUntil: "networkidle" });
  await page.waitForTimeout(2000);
  if (!(await page.evaluate(() => typeof window.__frames !== "undefined"))) throw new Error("window.__frames is missing: use the dev server, not a plain build");
  await page.mouse.move(960, 540);

  console.log(`wheel step ${step} px every ${STEP_MS} ms (about ${Number(speed)} px/s)`);
  console.log("segment    frames  seconds     fps  mean ms  p50 ms  p95 ms  p99 ms  max ms  >20 ms  >34 ms");
  const all = [];
  for (const [name, selector] of SEGMENTS) {
    const { top, bottom, viewport } = await page.evaluate((sel) => {
      const el = document.querySelector(sel);
      const top = el.getBoundingClientRect().top + window.scrollY;
      return { top, bottom: top + el.offsetHeight, viewport: window.innerHeight };
    }, selector);
    const from = Math.max(0, top - 200);
    const to = Math.max(from + step, bottom - viewport);
    await page.evaluate((y) => window.scrollTo({ top: y, behavior: "instant" }), from);
    await page.waitForTimeout(900);
    await page.evaluate(() => window.__frames.reset());
    for (let travelled = 0; travelled < to - from; travelled += step) {
      await page.mouse.wheel(0, step);
      await page.waitForTimeout(STEP_MS);
    }
    await page.waitForTimeout(300);
    const r = await page.evaluate(() => window.__frames.report());
    all.push([name, r]);
    const cell = (value, width) => String(value).padStart(width);
    console.log(
      `${name.padEnd(9)} ${cell(r.frames, 7)} ${cell(r.seconds, 8)} ${cell(r.fps, 7)} ${cell(r.meanMs, 8)} ${cell(r.p50Ms, 7)} ${cell(r.p95Ms, 7)} ${cell(r.p99Ms, 7)} ${cell(r.maxMs, 7)} ${cell(r.over20Ms, 7)} ${cell(r.over34Ms, 7)}`,
    );
  }
  const worst = all.reduce((a, b) => (b[1].fps < a[1].fps ? b : a));
  console.log(`lowest fps: ${worst[1].fps} in ${worst[0]}`);
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
    for (const row of seen.sort((a, b) => b.raw - a.raw)) console.log(`${kb(row.raw)} ${kb(row.gzip)}  ${row.type.padEnd(10)}  ${row.url}`);
    const byType = new Map();
    for (const row of seen) {
      const sum = byType.get(row.type) ?? { raw: 0, gzip: 0 };
      byType.set(row.type, { raw: sum.raw + row.raw, gzip: sum.gzip + row.gzip });
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
    for (const row of list.sort((a, b) => b.raw - a.raw)) console.log(`${kb(row.raw)} ${kb(row.gzip)}  ${row.rel}`);
    console.log(`${kb(list.reduce((n, r) => n + r.raw, 0))} ${kb(list.reduce((n, r) => n + r.gzip, 0))}  total (${list.length} files)`);
  };
  print("loaded at once by index.html (scripts, preloads, styles)", rows.filter((row) => row.first));
  print("everything else (lazy chunks, fonts, images)", rows.filter((row) => !row.first));
}

// ---------------------------------------------------------------------------------------------------------------

const [command, ...args] = process.argv.slice(2);
const COMMANDS = { shots, frames, net, bundle };
if (!COMMANDS[command]) {
  console.error("usage: home-capture.mjs shots <base> <out> [configs] | frames <base> [px/s] | net <base> [hash ...] | bundle <dist>");
  process.exit(2);
}
await COMMANDS[command](...args);
