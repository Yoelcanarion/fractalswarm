#!/usr/bin/env node
// Records the scenes of the video from director mode (`#/director/<scene>`, web/src/director) at exactly 1920 x 1080.
//
//   node scripts/record_scenes.mjs s6-fair-fight --swarm <run> --rival <run>
//   node scripts/record_scenes.mjs all --run <run> --ablation <run id>
//   node scripts/record_scenes.mjs --list
//
// Tooling: Node and playwright-core@1.48.2 (the version that matches the chromium-1140 build in Playwright's cache on this
// machine), installed in a scratch directory outside the repo, so nothing is added to web/:
//
//   npm install --prefix "%LOCALAPPDATA%\fractalswarm-record" playwright-core@1.48.2      (or set RECORD_TOOLS to another)
//
// It needs a server that serves the built UI and the API of the runs: `uv run fractalswarm serve`, with
// FRACTALSWARM_RUNS_DIR and FRACTALSWARM_LEDGER_PATH pointing at scratch copies (--url says where, default 127.0.0.1:8765).
// It is a browser and a server: ask the coordinator for a SLOT first, and never run it during a paid run.
//
// Two modes:
//   frames   (default) The page's frame clock is replaced by the one in record_scenes.shim.js, so the recorder grants the
//            page one frame of 1/60 s at a time, screenshots it and goes on: a clip has exactly the frames the scene says,
//            at 60 fps, however slowly the machine draws them, and the same scene gives the same frames every time. The
//            output is a PNG sequence (or JPEG with --format jpeg) in video/clips/<scene>/f00001.png ..., and one mp4 per
//            scene when ffmpeg is there (FFMPEG=<path>, or on PATH): H.264, 60 fps, yuv420p.
//   video    Playwright's own recordVideo of the scene playing in real time: a fast look at the choreography, as a webm at
//            the screencast's 25 fps. Soft, and not for the cut.
//
// `--dry` runs a scene's frames without screenshots: what a scene asks of the page that is not there, and whether its
// script finishes inside its duration, in seconds instead of minutes. A long scene can be recorded in chunks with
// --from/--to (frames; the take is repeatable, so the chunks join), or sampled with --every N.

import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, delimiter, dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..");
export const SCENES_DIR = join(REPO, "web", "src", "director", "scenes");
export const SHIM = join(HERE, "record_scenes.shim.js");
export const FRAME = { width: 1920, height: 1080 };
export const FPS = 60;

const USAGE = `usage: node scripts/record_scenes.mjs <scene>... | all  [options]
  --list                 the scenes, and the runs each needs
  --swarm <run> --rival <run>   the pair an arena scene plays (else web/src/director/sources.json)
  --run <run>            the run a run scene plays (else the swarm)
  --ablation <id>        the ablation an ablation scene shows
  --url <base>           the server (default http://127.0.0.1:8765)
  --out <dir>            default video/clips
  --mode frames|video    frames: one screenshot per frame of 1/60 s (default); video: Playwright's real-time recording
  --format png|jpeg      the frames' format (default png, lossless)
  --dry                  run the frames without screenshots: warnings and steps run, fast
  --from <n> --to <n>    only frames n to m (1-based, inclusive): to record a long scene in chunks
  --every <n>            only every nth frame: a quick sample
  --no-encode            leave the frames, do not call ffmpeg
  --strict               a warning, or a script that does not finish, fails the run
  --crf <n>              H.264 quality for the mp4 (default 12; lower is better)
`;

// ---- what can be tested without a browser ----

export function parseArgs(argv) {
  const options = {
    scenes: [],
    url: "http://127.0.0.1:8765",
    out: join(REPO, "video", "clips"),
    mode: "frames",
    format: "png",
    from: 1,
    to: Infinity,
    every: 1,
    dry: false,
    list: false,
    help: false,
    encode: true,
    strict: false,
    crf: 12,
    sources: {},
    loadTimeoutMs: 120_000,
  };
  const value = (flag, i) => {
    if (i + 1 >= argv.length || argv[i + 1].startsWith("--")) throw new Error(`${flag} needs a value`);
    return argv[i + 1];
  };
  const whole = (flag, text, min) => {
    const n = Number(text);
    if (!Number.isInteger(n) || n < min) throw new Error(`${flag} wants a whole number from ${min}, got "${text}"`);
    return n;
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case "--help":
      case "-h":
        options.help = true;
        break;
      case "--list":
        options.list = true;
        break;
      case "--dry":
        options.dry = true;
        break;
      case "--no-encode":
        options.encode = false;
        break;
      case "--strict":
        options.strict = true;
        break;
      case "--url":
        options.url = value(arg, i++).replace(/\/+$/, "");
        break;
      case "--out":
        options.out = resolve(value(arg, i++));
        break;
      case "--mode": {
        const mode = value(arg, i++);
        if (mode !== "frames" && mode !== "video") throw new Error(`--mode is frames or video, got "${mode}"`);
        options.mode = mode;
        break;
      }
      case "--format": {
        const format = value(arg, i++);
        if (format !== "png" && format !== "jpeg") throw new Error(`--format is png or jpeg, got "${format}"`);
        options.format = format;
        break;
      }
      case "--from":
        options.from = whole(arg, value(arg, i++), 1);
        break;
      case "--to":
        options.to = whole(arg, value(arg, i++), 1);
        break;
      case "--every":
        options.every = whole(arg, value(arg, i++), 1);
        break;
      case "--crf":
        options.crf = whole(arg, value(arg, i++), 0);
        break;
      case "--swarm":
      case "--rival":
      case "--run":
      case "--ablation":
        options.sources[arg.slice(2)] = value(arg, i++);
        break;
      default:
        if (arg.startsWith("-")) throw new Error(`unknown option ${arg}`);
        options.scenes.push(arg);
    }
  }
  if (options.to < options.from) throw new Error(`--to ${options.to} is before --from ${options.from}`);
  return options;
}

/** The frames (1-based) a run captures out of `total`. */
export function framesToCapture(total, { from, to, every }) {
  const last = Math.min(total, to);
  const wanted = [];
  for (let n = from; n <= last; n++) if ((n - from) % every === 0) wanted.push(n);
  return wanted;
}

/** True when the capture is the whole clip, so it can be encoded. */
export const isWhole = (total, { from, to, every }) => from === 1 && to >= total && every === 1;

export const frameName = (n, format) => `f${String(n).padStart(5, "0")}.${format === "jpeg" ? "jpg" : "png"}`;

/** The address of a scene on the server. `hold`: the page waits for the recorder to start the take. */
export function sceneUrl(base, id, sources, hold) {
  const query = [];
  if (hold) query.push("hold");
  for (const key of ["swarm", "rival", "run", "ablation"]) if (sources[key]) query.push(`${key}=${encodeURIComponent(sources[key])}`);
  return `${base}/#/director/${encodeURIComponent(id)}${query.length > 0 ? `?${query.join("&")}` : ""}`;
}

/** ffmpeg's arguments for one scene's frames: H.264 at 60 fps. */
export function ffmpegArgs({ dir, format, out, crf, fps = FPS }) {
  return [
    "-y",
    "-framerate",
    String(fps),
    "-start_number",
    "1",
    "-i",
    join(dir, `f%05d.${format === "jpeg" ? "jpg" : "png"}`),
    "-c:v",
    "libx264",
    "-preset",
    "slow",
    "-crf",
    String(crf),
    "-pix_fmt",
    "yuv420p",
    "-movflags",
    "+faststart",
    out,
  ];
}

/** The width and height written in a PNG's header, or null when the bytes are not a PNG. */
export function pngSize(bytes) {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.length < 24 || signature.some((byte, i) => bytes[i] !== byte)) return null;
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

export function findFfmpeg(env = process.env, exists = existsSync) {
  if (env.FFMPEG) return exists(env.FFMPEG) ? env.FFMPEG : null;
  const names = process.platform === "win32" ? ["ffmpeg.exe"] : ["ffmpeg"];
  for (const dir of (env.PATH ?? env.Path ?? "").split(delimiter)) {
    for (const name of names) if (dir && exists(join(dir, name))) return join(dir, name);
  }
  return null;
}

export function toolsDir(env = process.env) {
  return env.RECORD_TOOLS ?? join(env.LOCALAPPDATA ?? join(homedir(), ".cache"), "fractalswarm-record");
}

/** The scenes on disk, in order, and what each needs. */
export function listScenes(dir = SCENES_DIR) {
  return readdirSync(dir)
    .filter((name) => name.endsWith(".json"))
    .sort()
    .map((name) => {
      const scene = JSON.parse(readFileSync(join(dir, name), "utf-8"));
      return { id: basename(name, ".json"), title: scene.title, stage: scene.stage, seconds: scene.duration_ms / 1000 };
    });
}

export const NEEDS = { arena: ["swarm", "rival"], run: ["run"], ablation: ["ablation"], helps: [], title: [] };

/** What is wrong with a take, in words: the page's own errors, what the scene asked for that was not there, and a script
 * that ran out of time before its last step. A clip with a flag is not for the cut. */
export function flagsOf({ trouble, ended }) {
  const flags = [...trouble];
  for (const warning of ended.warnings) flags.push(`the scene says: ${warning}`);
  if (ended.position < ended.steps) flags.push(`the script ran ${ended.position} of ${ended.steps} steps: it is longer than its scene`);
  return flags;
}

/** What a scene still needs, given the sources it will be recorded with (the file's, then the flags). */
export function missingFor(stage, sources, manifest) {
  const have = { ...manifest, ...sources };
  if (stage === "run" && !have.run && have.swarm) have.run = have.swarm;
  return NEEDS[stage].filter((key) => !have[key]);
}

const sourcesManifest = () => JSON.parse(readFileSync(join(REPO, "web", "src", "director", "sources.json"), "utf-8"));

// ---- the browser ----

function loadPlaywright() {
  const dir = toolsDir();
  try {
    return createRequire(join(dir, "noop.js"))("playwright-core");
  } catch {
    throw new Error(`playwright-core is not installed in ${dir}.\n  npm install --prefix "${dir}" playwright-core@1.48.2`);
  }
}

/** What the page says when the take is over: the warnings it collected, and how many of its steps ran. */
const readEnd = (page) => page.evaluate(() => ({ warnings: [...window.__director.warnings], position: window.__director.position, steps: window.__director.steps }));

/** One scene, start to end. Returns what the page said about it. */
async function recordScene(browser, id, options, scene) {
  const frames = options.mode === "frames";
  const dir = join(options.out, id);
  const videoDir = join(options.out, `${id}.video`);
  if (frames && !options.dry) {
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
  }
  if (!frames) mkdirSync(videoDir, { recursive: true });

  const context = await browser.newContext({
    viewport: FRAME,
    deviceScaleFactor: 1,
    ...(frames ? {} : { recordVideo: { dir: videoDir, size: FRAME } }),
  });
  if (frames) await context.addInitScript({ path: SHIM });
  const page = await context.newPage();
  const trouble = [];
  const notes = [];
  page.on("pageerror", (error) => trouble.push(`page error: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") trouble.push(`console error: ${message.text()}`);
  });
  page.on("response", (response) => {
    if (response.status() >= 400 && response.url().includes("/api/")) notes.push(`${response.status()} ${response.url().replace(options.url, "")}`);
  });

  const address = sceneUrl(options.url, id, options.sources, frames);
  console.log(`${id}: ${address}`);
  await page.goto(address, { waitUntil: "load" });
  await page.waitForFunction(() => window.__director && (window.__director.ready || window.__director.problem !== null), null, { timeout: options.loadTimeoutMs, polling: 100 });
  const loaded = await page.evaluate(() => ({ problem: window.__director.problem, frames: window.__director.frames, preroll: window.__director.preroll, steps: window.__director.steps, note: window.__director.note }));
  if (loaded.problem !== null) throw new Error(`${id} cannot be shown: ${loaded.problem}`);
  await page.waitForLoadState("networkidle");
  console.log(`${id}: ${loaded.frames} frames at ${FPS} fps (${(loaded.frames / FPS).toFixed(1)} s)${loaded.note ? ` · "${loaded.note}"` : ""}`);

  const started = Date.now();
  const wanted = framesToCapture(loaded.frames, options);
  let taken = 0;
  let ended;

  if (!frames) {
    await page.waitForFunction(() => window.__director.done, null, { timeout: loaded.frames * 1000 + 120_000, polling: 250 });
    ended = await readEnd(page);
    await page.close();
    const video = page.video();
    await context.close();
    const file = join(options.out, `${id}.webm`);
    renameSync(await video.path(), file);
    rmSync(videoDir, { recursive: true, force: true });
    console.log(`${id}: ${file}`);
  } else {
    // the pre-roll: frames go by with the take held, so what animates by itself settles
    let state = "";
    for (let i = 0; i < loaded.preroll + 600 && state !== "waiting"; i++) {
      state = await page.evaluate(async () => {
        await window.__vt.frame();
        return window.__director.state;
      });
    }
    if (state !== "waiting") throw new Error(`${id}: the page did not reach its first frame (it is "${state}")`);
    await page.evaluate(() => window.__director.go());

    const want = new Set(wanted);
    let size = null;
    for (;;) {
      const now = await page.evaluate(async () => {
        await window.__vt.frame();
        const d = window.__director;
        return { frame: d.frame, done: d.done };
      });
      if (want.has(now.frame) && !options.dry) {
        const file = join(dir, frameName(now.frame, options.format));
        await page.screenshot({ path: file, type: options.format, ...(options.format === "jpeg" ? { quality: 100 } : {}), animations: "allow", caret: "initial" });
        if (size === null && options.format === "png") {
          size = pngSize(readFileSync(file));
          if (size === null || size.width !== FRAME.width || size.height !== FRAME.height) throw new Error(`${id}: a screenshot is ${size === null ? "not a PNG" : `${size.width} x ${size.height}`}, not ${FRAME.width} x ${FRAME.height}`);
        }
        taken += 1;
      }
      if (now.frame % 120 === 0 || now.done) {
        const per = (Date.now() - started) / Math.max(1, now.frame);
        console.log(`  frame ${now.frame}/${loaded.frames} · ${(per / 1000).toFixed(2)} s a frame · about ${(((loaded.frames - now.frame) * per) / 60_000).toFixed(1)} min to go`);
      }
      if (now.done) break;
      if (now.frame > loaded.frames + 5) throw new Error(`${id}: the take did not stop at its ${loaded.frames} frames`);
    }
    ended = await readEnd(page);
    await context.close();
  }

  return { loaded, ended, taken, trouble, notes, seconds: (Date.now() - started) / 1000, dir };
}

function encode(id, dir, options, ffmpeg) {
  const out = join(options.out, `${id}.mp4`);
  const args = ffmpegArgs({ dir, format: options.format, out, crf: options.crf });
  console.log(`${id}: ffmpeg ${args.join(" ")}`);
  const result = spawnSync(ffmpeg, args, { stdio: ["ignore", "ignore", "inherit"] });
  if (result.status !== 0) throw new Error(`ffmpeg failed on ${id} (exit ${result.status})`);
  return out;
}

export async function main(argv) {
  const options = parseArgs(argv);
  if (options.help) {
    console.log(USAGE);
    return 0;
  }
  const scenes = listScenes();
  const manifest = sourcesManifest();
  if (options.list) {
    for (const s of scenes) {
      const missing = missingFor(s.stage, options.sources, manifest);
      console.log(`${s.id.padEnd(20)} ${s.stage.padEnd(9)} ${String(s.seconds).padStart(3)} s  ${s.title}${missing.length > 0 ? `  [needs ${missing.join(", ")}]` : ""}`);
    }
    return 0;
  }
  if (options.scenes.length === 0) throw new Error(`name a scene, or all\n${USAGE}`);
  const wanted = options.scenes.includes("all") ? scenes.map((s) => s.id) : options.scenes;
  for (const id of wanted) {
    const found = scenes.find((s) => s.id === id);
    if (!found) throw new Error(`no scene called ${id} (the scenes: ${scenes.map((s) => s.id).join(", ")})`);
    const missing = missingFor(found.stage, options.sources, manifest);
    if (missing.length > 0) throw new Error(`${id} needs ${missing.map((key) => `--${key}`).join(" and ")} (or fill web/src/director/sources.json)`);
  }

  const ffmpeg = options.mode === "frames" && options.encode && !options.dry ? findFfmpeg() : null;
  const { chromium } = loadPlaywright();
  mkdirSync(options.out, { recursive: true });
  const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM || undefined, args: ["--force-color-profile=srgb", "--hide-scrollbars"] });
  let failed = 0;
  try {
    for (const id of wanted) {
      const scene = scenes.find((s) => s.id === id);
      let report;
      try {
        report = await recordScene(browser, id, options, scene);
      } catch (error) {
        failed += 1;
        console.error(`${id}: FAILED: ${error.message}`);
        continue;
      }
      const flags = flagsOf(report);
      const sidecar = { scene: id, stage: scene.stage, frames: report.loaded.frames, fps: FPS, size: FRAME, mode: options.mode, format: options.format, sources: options.sources, note: report.loaded.note, captured: report.taken, seconds: report.seconds, flags, notes: report.notes };
      if (options.mode === "frames" && !options.dry) writeFileSync(join(options.out, `${id}.json`), `${JSON.stringify(sidecar, null, 2)}\n`);
      for (const line of flags) console.error(`${id}: FLAG: ${line}`);
      for (const line of report.notes) console.log(`${id}: note: ${line}`);
      if (flags.length > 0 && options.strict) failed += 1;
      if (options.mode === "frames" && !options.dry) {
        if (ffmpeg !== null && isWhole(report.loaded.frames, options)) console.log(`${id}: ${encode(id, report.dir, options, ffmpeg)}`);
        else if (isWhole(report.loaded.frames, options) && options.encode) console.log(`${id}: no ffmpeg (set FFMPEG, or put it on PATH): the frames are in ${report.dir}; to encode them: ffmpeg ${ffmpegArgs({ dir: report.dir, format: options.format, out: join(options.out, `${id}.mp4`), crf: options.crf }).join(" ")}`);
      }
    }
  } finally {
    await browser.close();
  }
  return failed > 0 ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (error) => {
      console.error(error.message);
      process.exit(2);
    },
  );
}
