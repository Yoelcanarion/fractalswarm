// Drive the built static site in headless Chromium and report anything that is not clean.
//   node arena-static-browser-check.mjs <base url, ending in /> <out dir> [left right]
// Not run in a browser yet when this was written (W8 was stopped before RELEASE). It imports playwright-core, which is
// not a dependency of the repo: `npm i playwright-core@1.48.2` in a scratch folder OUTSIDE the repo, copy this file there
// and run it from there. CHROMIUM_EXE is the Chromium that Playwright installed on this machine (Chromium 130 crashes on
// CSS container queries, so the styles use media queries). Serve the built site first, with no FractalSwarm server:
// `python -m http.server 8770 --directory <site>`, then use http://127.0.0.1:8770/ as the base url. To check a sub-path,
// copy the site into <tmp>/fractalswarm/ and serve <tmp>, then pass http://127.0.0.1:8770/fractalswarm/ as the base url.
// Put <out dir> (screenshots, requests.txt, summary.json) outside the repo. RUNS (comma separated, default
// demo-toy,demo-backup) names the runs whose pages are visited; left and right name the arena pair ("-" for none).
//
// PROBLEM (exit 1): a failed request, an HTTP status >= 400, a request to another origin, a console message of any kind,
// a page error, a page with `undefined`, `NaN` or `[object Object]` in its text, a missing banner (or one on the home page),
// a missing verify badge, a page that scrolls as a whole, or an expectation of a scenario that does not hold.
// WARN (exit 0): wording that looks like an error state, and a sideways overflow at phone width: read them.

import { chromium } from "playwright-core";
import { mkdirSync, writeFileSync } from "node:fs";

const [baseUrl, outDir, left = "t2-swarm-killhalf", right = "t2-central-killhalf"] = process.argv.slice(2);
if (!baseUrl || !outDir) throw new Error("usage: node arena-static-browser-check.mjs <base url> <out dir> [left right]");
mkdirSync(outDir, { recursive: true });

const EXE = process.env.CHROMIUM_EXE ?? "C:/Users/yogar/AppData/Local/ms-playwright/chromium-1140/chrome-win/chrome.exe";
const BANNER = "Static showcase: recorded runs only. Run it yourself: uv run fractalswarm demo --verify";
const RUNS = (process.env.RUNS ?? "demo-toy,demo-backup").split(",");
const BIG = process.env.BIG_RUN ?? "demo-backup";
const VIEWS = ["", "/plan", "/panels", "/security", "/results", "/events"];
const ORIGIN = new URL(baseUrl).origin;

const problems = [];
const warnings = [];
const requests = new Map();
const timings = {};
const note = (list, tag) => (scenario, text) => {
  list.push(`${scenario}: ${text}`);
  console.log(`  ${tag} ${text}`);
};
const problem = note(problems, "PROBLEM");
const warn = note(warnings, "WARN");

const browser = await chromium.launch({ executablePath: EXE, headless: true });
const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });

function watch(page, name) {
  page.on("console", (m) => problem(name, `console.${m.type()}: ${m.text()}`));
  page.on("pageerror", (e) => problem(name, `pageerror: ${e.message}`));
  page.on("requestfailed", (r) => problem(name, `request failed: ${r.url()} ${r.failure()?.errorText}`));
  page.on("response", (r) => {
    requests.set(r.url(), r.status());
    if (r.status() >= 400) problem(name, `HTTP ${r.status()} ${r.url()}`);
    if (!r.url().startsWith(ORIGIN)) problem(name, `request to another origin: ${r.url()}`);
  });
}

const text = (page) => page.evaluate(() => document.body.innerText);
const shot = (page, name) => page.screenshot({ path: `${outDir}/${name}.png` });
const bannerOf = (page) => page.evaluate(() => document.querySelector(".staticbar")?.innerText ?? null);
const overflowOf = (page) =>
  page.evaluate(() => ({
    x: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    y: document.documentElement.scrollHeight - document.documentElement.clientHeight,
  }));
const badgeSelector = ".badge--good";

/** Open one hash route of the site and run the checks every page has to pass. */
async function visit(name, hash, { banner = true, needles = [], badge = false, wait, viewport, shoot = true, scroll = true } = {}) {
  console.log(`\n== ${name}  ${hash || "(no hash)"}`);
  const page = await context.newPage();
  if (viewport) await page.setViewportSize(viewport);
  watch(page, name);
  const started = Date.now();
  await page.goto(baseUrl + hash, { waitUntil: "load" });
  if (badge) await page.waitForSelector(badgeSelector, { timeout: 120000 });
  if (wait) await wait(page);
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(600);
  timings[name] = Date.now() - started;
  console.log(`  ready after ${timings[name]} ms`);

  const shown = await bannerOf(page);
  if (banner && !shown?.startsWith(BANNER)) problem(name, `banner is ${JSON.stringify(shown)}`);
  if (!banner && shown !== null) problem(name, `the banner is on this page: ${JSON.stringify(shown)}`);
  if (badge) {
    const label = await page.locator(badgeSelector).first().innerText();
    const title = (await page.locator(badgeSelector).first().getAttribute("title")) ?? "";
    console.log(`  badge: ${label}`);
    if (!/Replay verified at build, commit [0-9a-f]{7}\+? ✓ hash match [0-9a-f]{12}/.test(label)) problem(name, `badge text: ${label}`);
    if (!title.includes("not in your browser")) problem(name, "badge tooltip does not say it was not checked in the browser");
  }
  const body = await text(page);
  for (const needle of needles) if (!body.includes(needle)) problem(name, `the page does not contain ${JSON.stringify(needle)}`);
  if (/\bundefined\b|\bNaN\b|\[object Object\]/.test(body)) problem(name, "the page shows undefined, NaN or [object Object]");
  if (body.includes("Loading the static showcase")) problem(name, "the placeholder of index.html is still on the page: the app did not start");
  for (const line of body.split("\n")) if (/could not|failed|error|unavailable|not offered/i.test(line)) warn(name, `wording to read: ${line.trim().slice(0, 160)}`);
  if (body.trim().length < 40) problem(name, "the page is (nearly) blank");
  const overflow = await overflowOf(page);
  if (scroll && overflow.y > 1) problem(name, `the page scrolls as a whole: ${overflow.y}px (the banner should leave the app exactly the window)`);
  if (viewport && overflow.x > 1) warn(name, `sideways overflow at ${viewport.width}px: ${overflow.x}px`);
  console.log(`  text: ${body.replace(/\s+/g, " ").slice(0, 200)}`);
  if (shoot) await shot(page, name);
  return page;
}

// ---- home: no banner on the hero
for (const [name, hash] of [["home-empty", ""], ["home-slash", "#/"]]) {
  const page = await visit(name, hash, { banner: false, scroll: false });
  await page.close();
}

// ---- every run: its overview at the end with the verify badge and a reload, then each of its views
for (const run of RUNS) {
  const name = `run-${run}`;
  const page = await visit(name, `#/run/${run}?at=end`, { badge: true });
  await page.reload({ waitUntil: "load" });
  await page.waitForSelector(badgeSelector, { timeout: 120000 });
  await page.waitForLoadState("networkidle");
  if (!(await bannerOf(page))?.startsWith(BANNER)) problem(name, "banner missing after a reload");
  await shot(page, `${name}-reloaded`);
  await page.close();
  for (const view of VIEWS.slice(1)) {
    const viewPage = await visit(`${name}-${view.slice(1)}`, `#/run/${run}${view}?at=end`);
    await viewPage.close();
  }
}

// ---- the Muse lens: a call opened from the event log reads its file of call details
{
  const name = "lens";
  const page = await visit(name, `#/run/${RUNS[0]}/events?at=end`, { shoot: false });
  const button = page.locator(".lens-button").first();
  if ((await button.count()) === 0) warn(name, "no lens button in the event log of this run");
  else {
    await button.click();
    await page.waitForSelector("aside.lens", { timeout: 15000 });
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(800);
    const body = await text(page);
    if (!body.includes("Muse lens")) problem(name, "the lens did not open");
    if (/undefined|NaN|\[object Object\]/.test(body)) problem(name, "the lens shows undefined, NaN or [object Object]");
    await shot(page, name);
  }
  await page.close();
}

// ---- the other pages and the doors that need the local server
const pages = [
  ["charts", "#/charts", []],
  ["helps", "#/helps", []],
  ["runs", "#/runs", RUNS],
  ["arena-picker", "#/arena", left === "-" ? [] : [left]],
  ["new-run", "#/new", ["local server"]],
  ["ablation", "#/ablation", []],
  ["unknown-run", "#/run/nope", ["nope"]],
];
if (left !== "-") pages.push(["arena-pair", `#/arena/${left}/${right}?at=end`, []]);
for (const [name, hash, needles] of pages) {
  const page = await visit(name, hash, { needles, wait: (p) => p.waitForTimeout(1500) });
  await page.close();
}
if (left !== "-") {
  const page = await visit("arena-pair-reload", `#/arena/${left}/${right}?at=end`, { shoot: false });
  await page.reload({ waitUntil: "load" });
  await page.waitForLoadState("networkidle");
  await shot(page, "arena-pair-reloaded");
  await page.close();
}

// ---- a narrow screen: the banner wraps, nothing overflows sideways
for (const [name, hash] of [["phone-run", `#/run/${RUNS[0]}?at=end`], ["phone-helps", "#/helps"]]) {
  const page = await visit(name, hash, { viewport: { width: 390, height: 800 }, scroll: false });
  await page.close();
}

// ---- a big log over a slow line: the page loads in files and the banner shows the progress
{
  const name = "progress";
  console.log(`\n== ${name}  ${BIG} over 750 kB/s`);
  const page = await context.newPage();
  watch(page, name);
  await page.goto(`${baseUrl}#/run/${RUNS[0]}?at=end`, { waitUntil: "load" });
  await page.waitForLoadState("networkidle");
  const cdp = await context.newCDPSession(page);
  await cdp.send("Network.enable");
  await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });
  await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: 60, downloadThroughput: 750 * 1024, uploadThroughput: 750 * 1024 });
  const started = Date.now();
  await page.evaluate((id) => {
    window.location.hash = `#/run/${id}?at=end`;
  }, BIG);
  try {
    await page.waitForSelector('[role="progressbar"]', { timeout: 20000 });
    const seen = [];
    for (let i = 0; i < 12; i += 1) {
      const bar = page.locator('[role="progressbar"]');
      if ((await bar.count()) === 0) break;
      seen.push(Number(await bar.getAttribute("aria-valuenow")));
      if (i === 1) await shot(page, `${name}-bar`);
      await page.waitForTimeout(400);
    }
    console.log(`  progress seen: ${seen.join(", ")} %`);
    if (seen.length < 2) warn(name, "the progress bar was seen once only");
  } catch {
    problem(name, "no progress bar appeared while the big log loaded over a slow line");
  }
  await page.waitForSelector(badgeSelector, { timeout: 120000 });
  timings[name] = Date.now() - started;
  console.log(`  verify badge after ${timings[name]} ms`);
  await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  if (await page.locator('[role="progressbar"]').count()) problem(name, "the progress bar is still there after the log loaded");
  await shot(page, `${name}-done`);
  await page.close();
}

// ---- opened from disk: what a visitor sees (not counted as a problem; a module script cannot load over file://)
{
  const name = "file-protocol";
  console.log(`\n== ${name}`);
  const page = await context.newPage();
  const url = process.env.SITE_INDEX_FILE;
  if (url) {
    await page.goto(url, { waitUntil: "load" });
    await page.waitForTimeout(1500);
    console.log(`  what shows: ${JSON.stringify((await text(page)).slice(0, 240))}`);
    await shot(page, name);
  } else console.log("  skipped: set SITE_INDEX_FILE=file:///.../index.html to see it");
  await page.close();
}

const checked = [...requests.entries()].map(([url, status]) => `${status} ${url}`).sort();
writeFileSync(`${outDir}/requests.txt`, checked.join("\n"));
writeFileSync(`${outDir}/summary.json`, JSON.stringify({ baseUrl, timings, problems, warnings, requests: checked.length }, null, 2));
console.log(`\n${checked.length} distinct requests, all to ${ORIGIN}`);
await browser.close();
if (warnings.length) console.log(`\n${warnings.length} WARNING(S) to read:\n  ${warnings.join("\n  ")}`);
if (problems.length) {
  console.log(`\n${problems.length} PROBLEM(S):\n  ${problems.join("\n  ")}`);
  process.exit(1);
}
console.log("\nCLEAN: no failed request, no status >= 400, nothing in the console, every expectation held");
