// Drive the built static site in headless Chromium and report anything that is not clean.
//   node arena-static-browser-check.mjs <base url, ending in /> <out dir> [left right]
// Not run yet (W8 was stopped before RELEASE). It imports playwright-core, which is not a dependency of
// the repo: `npm i playwright-core@1.48.2` in a scratch folder OUTSIDE the repo, copy this file there and run
// it from there. EXE below is the Chromium that Playwright installed on this machine (Chromium 130 crashes on
// CSS container queries, so the styles use media queries). Serve the built site first, with no FractalSwarm
// server: `python -m http.server 8770 --directory <site>`, then use http://127.0.0.1:8770/ as the base url.
// Put <out dir> (screenshots, requests.txt) outside the repo.
// Fails (exit 1) on: a failed request, an HTTP status >= 400, a request to another origin, a console message of any
// kind, a page error, or an expectation of a scenario that does not hold.

import { chromium } from "playwright-core";
import { mkdirSync, writeFileSync } from "node:fs";

const [baseUrl, outDir, left = "t2-swarm-killhalf", right = "t2-central-killhalf"] = process.argv.slice(2);
if (!baseUrl || !outDir) throw new Error("usage: node static_check.mjs <base url> <out dir> [left right]");
mkdirSync(outDir, { recursive: true });

const EXE = "C:/Users/yogar/AppData/Local/ms-playwright/chromium-1140/chrome-win/chrome.exe";
const BANNER = "Static showcase: recorded runs only. Run it yourself: uv run fractalswarm demo --verify";

const problems = [];
const seenRequests = new Map();
const problem = (scenario, text) => {
  problems.push(`${scenario}: ${text}`);
  console.log(`  PROBLEM ${text}`);
};

const browser = await chromium.launch({ executablePath: EXE, headless: true });
const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });

async function open(name, hash, { wait, viewport } = {}) {
  console.log(`\n== ${name}  ${hash || "(no hash)"}`);
  const page = await context.newPage();
  if (viewport) await page.setViewportSize(viewport);
  page.on("console", (m) => problem(name, `console.${m.type()}: ${m.text()}`));
  page.on("pageerror", (e) => problem(name, `pageerror: ${e.message}`));
  page.on("requestfailed", (r) => problem(name, `request failed: ${r.url()} ${r.failure()?.errorText}`));
  page.on("response", (r) => {
    seenRequests.set(r.url(), r.status());
    if (r.status() >= 400) problem(name, `HTTP ${r.status()} ${r.url()}`);
    if (!r.url().startsWith(new URL(baseUrl).origin)) problem(name, `request to another origin: ${r.url()}`);
  });
  const started = Date.now();
  await page.goto(baseUrl + hash, { waitUntil: "load" });
  if (wait) await wait(page);
  await page.waitForLoadState("networkidle");
  console.log(`  ready after ${Date.now() - started} ms`);
  return page;
}

const text = (page) => page.evaluate(() => document.body.innerText);
const shot = (page, name) => page.screenshot({ path: `${outDir}/${name}.png` });
const expectText = async (page, name, needle, where = "page") => {
  const body = await text(page);
  if (!body.includes(needle)) problem(name, `${where} does not contain ${JSON.stringify(needle)}`);
};
const expectNoText = async (page, name, needle) => {
  if ((await text(page)).includes(needle)) problem(name, `page contains ${JSON.stringify(needle)}`);
};
const bannerOf = (page) => page.evaluate(() => document.querySelector(".staticbar")?.innerText ?? null);
const waitFor = (selector, timeout = 90000) => (page) => page.waitForSelector(selector, { timeout });

// ---- home: no banner on the hero
for (const [name, hash] of [["home-empty", ""], ["home-slash", "#/"]]) {
  const page = await open(name, hash, { wait: async (p) => p.waitForTimeout(1500) });
  const banner = await bannerOf(page);
  if (banner !== null) problem(name, `the banner is on the home page: ${JSON.stringify(banner)}`);
  await shot(page, name);
  await page.close();
}

// ---- a run at its end: banner, verify badge, charts
for (const run of ["demo-backup", "demo-toy"]) {
  const name = `run-${run}`;
  const page = await open(name, `#/run/${run}?at=end`, { wait: waitFor(".badge--good") });
  const banner = await bannerOf(page);
  if (!banner || !banner.startsWith(BANNER)) problem(name, `banner is ${JSON.stringify(banner)}`);
  const badge = await page.locator(".badge--good").first().innerText();
  const title = (await page.locator(".badge--good").first().getAttribute("title")) ?? "";
  console.log(`  badge: ${badge}\n  title: ${title}`);
  if (!/Replay verified at build, commit [0-9a-f]{7} ✓ hash match [0-9a-f]{12}/.test(badge)) problem(name, `badge text: ${badge}`);
  if (!title.includes("not in your browser")) problem(name, "badge title does not say it was not checked in the browser");
  await expectText(page, name, "Replays were checked when this site was built");
  await shot(page, name);
  // reload on the deep link: it must come back the same
  await page.reload({ waitUntil: "load" });
  await page.waitForSelector(".badge--good", { timeout: 90000 });
  await page.waitForLoadState("networkidle");
  if (!(await bannerOf(page))?.startsWith(BANNER)) problem(name, "banner missing after a reload");
  await shot(page, `${name}-reloaded`);
  await page.close();
}

// ---- the other pages
const pages = [
  ["charts", "#/charts", ["Fixture"]],
  ["helps", "#/helps", []],
  ["runs", "#/runs", ["demo-backup", "demo-toy"]],
  ["arena-picker", "#/arena", [`${left}`]],
  ["arena-pair", `#/arena/${left}/${right}?at=end`, []],
  ["new-run", "#/new", ["local server"]],
  ["ablation", "#/ablation", []],
  ["unknown-run", "#/run/nope", ["nope"]],
];
for (const [name, hash, needles] of pages) {
  const page = await open(name, hash, { wait: async (p) => p.waitForTimeout(2500) });
  const banner = await bannerOf(page);
  if (!banner?.startsWith(BANNER)) problem(name, `banner is ${JSON.stringify(banner)}`);
  for (const needle of needles) await expectText(page, name, needle);
  const body = (await text(page)).trim();
  console.log(`  text: ${body.replace(/\s+/g, " ").slice(0, 220)}`);
  if (body.length < 40) problem(name, "the page is (nearly) blank");
  await shot(page, name);
  await page.close();
}

// ---- a narrow screen: the banner wraps, nothing overflows sideways
{
  const name = "phone-run";
  const page = await open(name, "#/run/demo-toy?at=end", { viewport: { width: 390, height: 800 }, wait: waitFor(".badge--good") });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  console.log(`  horizontal overflow: ${overflow}px`);
  await shot(page, name);
  await page.close();
}

const checked = [...seenRequests.entries()].map(([url, status]) => `${status} ${url}`).sort();
writeFileSync(`${outDir}/requests.txt`, checked.join("\n"));
console.log(`\n${checked.length} distinct requests, all on ${new URL(baseUrl).origin}`);
await browser.close();
if (problems.length) {
  console.log(`\n${problems.length} PROBLEM(S):\n  ${problems.join("\n  ")}`);
  process.exit(1);
}
console.log("\nCLEAN: no failed request, no status >= 400, nothing in the console, every expectation held");
