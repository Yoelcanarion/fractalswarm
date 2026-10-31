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
const RUNS = (process.env.RUNS ?? "demo-final").split(",");
// The doors of the home page that lead somewhere on a site with no server (web/src/home/doors.ts); "A live run" (#/new) is the closed one.
const OPEN_DOORS = ["#/arena", "#/runs", "#/evidence"];
const BIG = process.env.BIG_RUN ?? RUNS[0]; // the biggest log the site holds: the final run, 8,771 events
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
// The run page has other good badges (the takeover chip, the coordination tokens): the verify badge is the one that says so.
const badgeSelector = ".badge--good";
const verifyBadge = (page) => page.locator(badgeSelector, { hasText: "Replay verified" }).first();

/** Open one hash route of the site and run the checks every page has to pass. */
async function visit(name, hash, { banner = true, needles = [], badge = false, wait, viewport, shoot = true, scroll = true, dataOnly } = {}) {
  console.log(`\n== ${name}  ${hash || "(no hash)"}`);
  const page = await context.newPage();
  if (viewport) await page.setViewportSize(viewport);
  watch(page, name);
  const asked = new Set();
  page.on("request", (r) => asked.add(new URL(r.url()).pathname));
  const started = Date.now();
  await page.goto(baseUrl + hash, { waitUntil: "load" });
  if (badge) await verifyBadge(page).waitFor({ timeout: 120000 });
  if (wait) await wait(page);
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(600);
  timings[name] = Date.now() - started;
  console.log(`  ready after ${timings[name]} ms`);

  if (dataOnly) {
    // a page that needs no run asks for the manifest and for nothing else under data/
    const extra = [...asked].filter((path) => path.includes("/data/") && !dataOnly.some((file) => path.endsWith(`/data/${file}`)));
    if (extra.length) problem(name, `the page asked for data files it should not need: ${extra.join(", ")}`);
  }
  const shown = await bannerOf(page);
  if (banner && !shown?.startsWith(BANNER)) problem(name, `banner is ${JSON.stringify(shown)}`);
  if (banner && shown && !hash.startsWith("#/director/")) {
    // present is not seen: something fixed to the window (a page's own bar) can sit over it. The director's scenes are the
    // exception: a frame as big as the window with none of the app around it (director.css), the banner sits under it by design
    const covered = await page.evaluate(() => {
      const bar = document.querySelector(".staticbar");
      if (!bar) return true;
      const box = bar.getBoundingClientRect();
      const top = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
      return !(top && bar.contains(top));
    });
    if (covered) problem(name, "the banner is covered by something at the top of the window");
  }
  if (!banner && shown !== null) problem(name, `the banner is on this page: ${JSON.stringify(shown)}`);
  if (badge) {
    const label = (await verifyBadge(page).innerText()).replace(/\s+/g, " ");
    const title = (await verifyBadge(page).getAttribute("title")) ?? "";
    console.log(`  badge: ${label}`);
    if (!/Replay verified at build, commit [0-9a-f]{7}\+? ✓ hash match [0-9a-f]{12}/.test(label)) problem(name, `badge text: ${label}`);
    if (!title.includes("not in your browser")) problem(name, "badge tooltip does not say it was not checked in the browser");
  }
  const body = await text(page);
  // innerText applies text-transform: a heading written "Run the ablation" reads RUN THE ABLATION
  for (const needle of needles) if (!body.toLowerCase().includes(needle.toLowerCase())) problem(name, `the page does not contain ${JSON.stringify(needle)}`);
  if (/\bundefined\b|\bNaN\b|\[object Object\]/.test(body)) problem(name, "the page shows undefined, NaN or [object Object]");
  if (body.includes("Loading the static showcase")) problem(name, "the placeholder of index.html is still on the page: the app did not start");
  for (const line of body.split("\n")) {
    if (/^(failed|errors?)$/i.test(line.trim())) continue; // a stat label ("FAILED 0"), not a state
    if (/could not|failed|error|unavailable|not offered/i.test(line)) warn(name, `wording to read: ${line.trim().slice(0, 160)}`);
  }
  if (body.trim().length < 40) problem(name, "the page is (nearly) blank");
  const overflow = await overflowOf(page);
  if (scroll && overflow.y > 1) problem(name, `the page scrolls as a whole: ${overflow.y}px (the banner should leave the app exactly the window)`);
  if (viewport && overflow.x > 1) warn(name, `sideways overflow at ${viewport.width}px: ${overflow.x}px`);
  console.log(`  text: ${body.replace(/\s+/g, " ").slice(0, 200)}`);
  if (shoot) await shot(page, name);
  return page;
}

// ---- home (W6's page): no banner, and no run needed: the manifest is the only file it asks for under data/
for (const [name, hash] of [["home-empty", ""], ["home-slash", "#/"], ["home-name", "#/home"]]) {
  const page = await visit(name, hash, { banner: false, scroll: false, dataOnly: ["manifest.json"], needles: ["Kill half the brains"] });
  await page.close();
}

// ---- home: the doors. The two that need the server are closed and say so; the others lead to pages that open with the
// banner back, and coming back to the home page takes it away again
{
  const name = "home-doors";
  const page = await visit(name, "#/", { banner: false, scroll: false, dataOnly: ["manifest.json"], shoot: false });
  const open = await page.locator("a.home-door").count();
  const closed = await page.locator(".home-door--closed").count();
  console.log(`  ${open} open doors, ${closed} closed`);
  if (open !== OPEN_DOORS.length || closed !== 1) problem(name, `${OPEN_DOORS.length} open and 1 closed doors expected, found ${open} and ${closed}`);
  for (const note of await page.locator(".home-door--closed .home-door__note").allInnerTexts()) {
    if (!/needs the local server/i.test(note)) problem(name, `a closed door does not say it needs the local server: ${JSON.stringify(note)}`);
  }
  for (const href of OPEN_DOORS) {
    const door = page.locator(`a.home-door[href="${href}"]`);
    await door.scrollIntoViewIfNeeded();
    await door.click();
    await page.waitForFunction((wanted) => window.location.hash === wanted, href);
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(800);
    const shown = await bannerOf(page);
    // the app's pages carry the banner; the evidence page has a bar of its own, fixed to the window, and none
    if (href === "#/evidence" ? shown !== null : !shown?.startsWith(BANNER)) problem(name, `the banner is ${JSON.stringify(shown)} on ${href}, reached from the home page`);
    const body = await text(page);
    if (/\bundefined\b|\bNaN\b|\[object Object\]/.test(body)) problem(name, `${href} shows undefined, NaN or [object Object]`);
    if (body.trim().length < 40) problem(name, `${href} is (nearly) blank, reached from the home page`);
    const overflow = await overflowOf(page);
    // the evidence page is a long document: it scrolls as a whole by design, the app's pages do not
    if (href !== "#/evidence" && overflow.y > 1) problem(name, `${href} scrolls as a whole after the home page: ${overflow.y}px`);
    await shot(page, `${name}-${href.slice(2)}`);
    await page.goBack();
    await page.waitForFunction(() => window.location.hash === "#/" || window.location.hash === "");
    await page.waitForTimeout(500);
    if ((await bannerOf(page)) !== null) problem(name, `the banner is still on the home page after coming back from ${href}`);
  }
  await page.close();
}

// ---- every run: its overview at the end with the verify badge and a reload, then each of its views
for (const run of RUNS) {
  const name = `run-${run}`;
  const page = await visit(name, `#/run/${run}?at=end`, { badge: true });
  await page.reload({ waitUntil: "load" });
  await verifyBadge(page).waitFor({ timeout: 120000 });
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
    if (!/muse lens/i.test(body)) problem(name, "the lens did not open");
    if (/undefined|NaN|\[object Object\]/.test(body)) problem(name, "the lens shows undefined, NaN or [object Object]");
    await shot(page, name);
  }
  await page.close();
}

// ---- the other pages and the doors that need the local server
const pages = [
  ["evidence", "#/evidence", [], { scroll: false, banner: false }], // W6's page behind the home page: baked, no banner (its own fixed bar would cover it)
  ["charts", "#/charts", []],
  ["helps", "#/helps", []],
  ["runs", "#/runs", RUNS],
  ["director-list", "#/director", ["Director", "s1-arena-open"]],
  ["director-no-runs", "#/director/s1-arena-open", []], // sources.json names no run until W5 fills it: read what a visitor sees
  ["arena-picker", "#/arena", left === "-" ? [] : [left]],
  ["new-run", "#/new", ["fractalswarm serve", "Use the sample text"]],
  ["ablation", "#/ablation", ["Run the ablation"]],
  ["unknown-run", "#/run/nope", ["nope"]],
];
if (left !== "-") pages.push(["arena-pair", `#/arena/${left}/${right}?at=end`, []]);
for (const [name, hash, needles, options = {}] of pages) {
  const page = await visit(name, hash, { needles, wait: (p) => p.waitForTimeout(1500), ...options });
  await page.close();
}
if (left !== "-") {
  const page = await visit("arena-pair-reload", `#/arena/${left}/${right}?at=end`, { shoot: false });
  await page.reload({ waitUntil: "load" });
  await page.waitForLoadState("networkidle");
  await shot(page, "arena-pair-reloaded");
  await page.close();
}

// ---- the director's scenes that can play here, on the runs the site holds (a frame is a window tall, with nothing around it).
// The ablation scene reads GET api/ablation/<id>, which needs the server: read what it says.
{
  const scenes = [
    ["director-s1", `#/director/s1-arena-open?swarm=${left}&rival=${right}`, left !== "-"],
    ["director-s4", `#/director/s4-lens?run=${RUNS[0]}`, true],
    ["director-s5", `#/director/s5-recovery?run=${RUNS[0]}`, true],
    ["director-s7", "#/director/s7-where-it-helps", true],
    ["director-s9", "#/director/s9-close", true],
    ["director-s3-ablation", "#/director/s3-ablation?ablation=ablation-x", true],
  ];
  for (const [name, hash, wanted] of scenes) {
    if (!wanted) continue;
    const page = await visit(name, hash, { wait: (p) => p.waitForTimeout(5000) });
    await page.close();
  }
}

// ---- the Runs page (W4): "Verify N listed runs" gives the verdict of the build, and never says a replay ran in the browser
{
  const name = "runs-verify";
  const page = await visit(name, "#/runs", { needles: RUNS, shoot: false });
  // since the redesign the table, its filters and its verify buttons sit in a fold ("All N runs"), closed on a first visit
  const fold = page.locator("summary", { hasText: /^All \d+ runs/ });
  if ((await fold.count()) > 0) await fold.first().click();
  const verifyAll = page.getByRole("button", { name: /^Verify \d+ listed runs?$/ });
  if ((await verifyAll.count()) === 0) warn(name, "no 'Verify N listed runs' button on the Runs page: is W4's page merged?");
  else {
    await verifyAll.first().click();
    await page.waitForFunction(
      () => {
        const cells = [...document.querySelectorAll("tbody tr td:last-child")].map((td) => td.innerText);
        return cells.length > 0 && cells.every((c) => /Replay verified|Could not check|Replay mismatch|Log intact/.test(c));
      },
      null,
      { timeout: 120000 },
    );
    await page.waitForTimeout(800);
    const cells = (await page.locator("tbody tr td:last-child").allInnerTexts()).map((c) => c.replace(/\s+/g, " ").trim());
    console.log(`  ${cells.length} verify cell(s): ${[...new Set(cells)].join(" | ")}`);
    if (cells.length < 2) problem(name, `only ${cells.length} row(s) in the table of runs`);
    const bad = cells.filter((c) => !/^Replay verified at build/.test(c));
    if (bad.length) problem(name, `${bad.length} of ${cells.length} cells do not say "Replay verified at build": ${JSON.stringify(bad[0])}`);
    if (/re-run from run\.started/.test(await page.content())) problem(name, "the page says events were re-run from run.started: a replay ran in the browser");
    await shot(page, name);
  }
  await page.close();
}

// ---- the doors that need the server say why when used (the shim answers 503 with its reason in the page's own error box)
for (const [name, hash, button] of [
  ["new-run-sample", "#/new", "Use the sample text"],
  ["ablation-start", "#/ablation", "Run at no cost"],
]) {
  const page = await visit(name, hash, { shoot: false });
  await page.getByRole("button", { name: button }).click();
  await page.waitForTimeout(800);
  const body = await text(page);
  if (!body.includes("needs the local server")) problem(name, `using "${button}" does not say that it needs the local server`);
  await shot(page, name);
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
  // start on a small run (the arena's rival), so that going to the big one loads it: the same run would load nothing
  const small = process.env.SMALL_RUN ?? (right !== "-" && right !== BIG ? right : "demo-toy");
  await page.goto(`${baseUrl}#/run/${small}?at=end`, { waitUntil: "load" });
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
  await verifyBadge(page).waitFor({ timeout: 120000 });
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
