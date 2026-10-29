// The parts of the recorder (scripts/record_scenes.mjs) that need no browser: its options, the frames it asks for, the
// address of a scene, the ffmpeg command, the checks on what it got back.

import { pathToFileURL } from "node:url";

import { beforeAll, describe, expect, it } from "vitest";

import { REPO_ROOT } from "../lib/testing";

interface Options {
  scenes: string[];
  url: string;
  out: string;
  mode: string;
  format: string;
  from: number;
  to: number;
  every: number;
  real: boolean;
  dry: boolean;
  list: boolean;
  help: boolean;
  encode: boolean;
  strict: boolean;
  crf: number;
  sources: Record<string, string>;
}

interface Window {
  from: number;
  to: number;
  every: number;
}

interface Recorder {
  FRAME: { width: number; height: number };
  FPS: number;
  parseArgs(argv: string[]): Options;
  framesToCapture(total: number, window: Window): number[];
  isWhole(total: number, window: Window): boolean;
  frameName(n: number, format: string): string;
  sceneUrl(base: string, id: string, sources: Record<string, string>, hold: boolean, real?: boolean): string;
  ffmpegArgs(args: { dir: string; format: string; out: string; crf: number; fps?: number }): string[];
  pngSize(bytes: Buffer): { width: number; height: number } | null;
  findFfmpeg(env: Record<string, string | undefined>, exists: (path: string) => boolean): string | null;
  toolsDir(env: Record<string, string | undefined>): string;
  listScenes(): { id: string; title: string; stage: string; seconds: number }[];
  missingFor(stage: string, sources: Record<string, string>, manifest: Record<string, string | null>): string[];
  flagsOf(report: { trouble: string[]; ended: { warnings: string[]; position: number; steps: number } }): string[];
}

let r: Recorder;
beforeAll(async () => {
  r = (await import(pathToFileURL(`${REPO_ROOT}scripts/record_scenes.mjs`).href)) as Recorder;
});

const whole: Window = { from: 1, to: Infinity, every: 1 };

describe("the recorder's options", () => {
  it("record at 1920 x 1080 and 60 fps whatever is asked", () => {
    expect(r.FRAME).toEqual({ width: 1920, height: 1080 });
    expect(r.FPS).toBe(60);
  });

  it("have defaults that record a scene whole, as frames", () => {
    const options = r.parseArgs(["s6-fair-fight"]);
    expect(options).toMatchObject({ scenes: ["s6-fair-fight"], mode: "frames", format: "png", from: 1, every: 1, real: false, dry: false, encode: true, strict: false, sources: {} });
    expect(options.to).toBe(Infinity);
    expect(options.url).toBe("http://127.0.0.1:8765");
    expect(options.out.replaceAll("\\", "/")).toMatch(/\/video\/clips$/);
  });

  it("take scenes, runs and switches in any order", () => {
    const options = r.parseArgs(["--swarm", "a", "s1-arena-open", "--rival", "b", "s6-fair-fight", "--dry", "--strict", "--no-encode", "--url", "http://x:9000/"]);
    expect(options.scenes).toEqual(["s1-arena-open", "s6-fair-fight"]);
    expect(options.sources).toEqual({ swarm: "a", rival: "b" });
    expect(options).toMatchObject({ dry: true, strict: true, encode: false, url: "http://x:9000" });
  });

  it("call the runs real only when they are told to", () => {
    expect(r.parseArgs(["s1-arena-open"]).real).toBe(false);
    expect(r.parseArgs(["s1-arena-open", "--real"]).real).toBe(true);
  });

  it("read a window of frames, a sample and a quality", () => {
    expect(r.parseArgs(["s", "--from", "61", "--to", "120", "--every", "2", "--crf", "8"])).toMatchObject({ from: 61, to: 120, every: 2, crf: 8 });
    expect(r.parseArgs(["s", "--mode", "video", "--format", "jpeg"])).toMatchObject({ mode: "video", format: "jpeg" });
    expect(r.parseArgs(["--list"]).list).toBe(true);
    expect(r.parseArgs(["-h"]).help).toBe(true);
  });

  it("refuse what they do not understand, and say what", () => {
    expect(() => r.parseArgs(["--nope"])).toThrow(/unknown option --nope/);
    expect(() => r.parseArgs(["--swarm"])).toThrow(/--swarm needs a value/);
    expect(() => r.parseArgs(["--swarm", "--rival", "x"])).toThrow(/--swarm needs a value/);
    expect(() => r.parseArgs(["--mode", "gif"])).toThrow(/frames or video/);
    expect(() => r.parseArgs(["--format", "gif"])).toThrow(/png or jpeg/);
    expect(() => r.parseArgs(["--from", "0"])).toThrow(/whole number from 1/);
    expect(() => r.parseArgs(["--every", "1.5"])).toThrow(/whole number/);
    expect(() => r.parseArgs(["--from", "50", "--to", "10"])).toThrow(/before --from/);
  });
});

describe("the frames of a clip", () => {
  it("are every frame, from the first to the last, unless asked otherwise", () => {
    expect(r.framesToCapture(5, whole)).toEqual([1, 2, 3, 4, 5]);
    expect(r.framesToCapture(0, whole)).toEqual([]);
  });

  it("can be a window, and the window ends with the clip", () => {
    expect(r.framesToCapture(10, { from: 3, to: 6, every: 1 })).toEqual([3, 4, 5, 6]);
    expect(r.framesToCapture(10, { from: 8, to: 99, every: 1 })).toEqual([8, 9, 10]);
    expect(r.framesToCapture(10, { from: 11, to: 99, every: 1 })).toEqual([]);
  });

  it("can be a sample counted from the window's start", () => {
    expect(r.framesToCapture(10, { from: 1, to: Infinity, every: 4 })).toEqual([1, 5, 9]);
    expect(r.framesToCapture(10, { from: 3, to: Infinity, every: 3 })).toEqual([3, 6, 9]);
  });

  it("make a clip only when they are all there", () => {
    expect(r.isWhole(100, whole)).toBe(true);
    expect(r.isWhole(100, { from: 1, to: 100, every: 1 })).toBe(true);
    expect(r.isWhole(100, { from: 2, to: Infinity, every: 1 })).toBe(false);
    expect(r.isWhole(100, { from: 1, to: 99, every: 1 })).toBe(false);
    expect(r.isWhole(100, { from: 1, to: Infinity, every: 2 })).toBe(false);
  });

  it("are named so that they sort in the order they were drawn, and ffmpeg reads them back with one pattern", () => {
    expect(r.frameName(1, "png")).toBe("f00001.png");
    expect(r.frameName(1920, "png")).toBe("f01920.png");
    expect(r.frameName(7, "jpeg")).toBe("f00007.jpg");
    const names = [9, 10, 100, 2].map((n) => r.frameName(n, "png"));
    expect([...names].sort()).toEqual([r.frameName(2, "png"), r.frameName(9, "png"), r.frameName(10, "png"), r.frameName(100, "png")]);
  });
});

describe("where a scene is shown", () => {
  it("is its address on the server, with the runs it plays", () => {
    expect(r.sceneUrl("http://127.0.0.1:8770", "s6-fair-fight", { swarm: "a", rival: "b" }, false)).toBe("http://127.0.0.1:8770/#/director/s6-fair-fight?swarm=a&rival=b");
    expect(r.sceneUrl("http://h", "s9-close", {}, false)).toBe("http://h/#/director/s9-close");
  });

  it("holds the take for the recorder when it is the recorder that turns the clock", () => {
    expect(r.sceneUrl("http://h", "s4-lens", { run: "x" }, true)).toBe("http://h/#/director/s4-lens?hold&run=x");
    expect(r.sceneUrl("http://h", "s9-close", {}, true)).toBe("http://h/#/director/s9-close?hold");
  });

  it("says the runs are real only when they are", () => {
    expect(r.sceneUrl("http://h", "s1-arena-open", { swarm: "a", rival: "b" }, true, true)).toBe("http://h/#/director/s1-arena-open?hold&swarm=a&rival=b&real");
    expect(r.sceneUrl("http://h", "s1-arena-open", { swarm: "a", rival: "b" }, true, false)).not.toContain("real");
    expect(r.sceneUrl("http://h", "s1-arena-open", { swarm: "a", rival: "b" }, true)).not.toContain("real");
    expect(r.sceneUrl("http://h", "s9-close", {}, false, true)).toBe("http://h/#/director/s9-close?real");
  });

  it("writes a run's name so that the page reads the same one back", () => {
    expect(r.sceneUrl("http://h", "s4-lens", { run: "a b&c" }, false)).toBe("http://h/#/director/s4-lens?run=a%20b%26c");
  });
});

describe("the ffmpeg command", () => {
  const after = (command: string[], flag: string): string => command[command.indexOf(flag) + 1];

  it("reads the frames at 60 fps and writes H.264 that every player reads", () => {
    const command = r.ffmpegArgs({ dir: "clips/s1", format: "png", out: "clips/s1.mp4", crf: 12 });
    expect(after(command, "-framerate")).toBe("60");
    expect(after(command, "-i").replaceAll("\\", "/")).toBe("clips/s1/f%05d.png");
    expect(after(command, "-start_number")).toBe("1");
    expect(after(command, "-c:v")).toBe("libx264");
    expect(after(command, "-crf")).toBe("12");
    expect(after(command, "-pix_fmt")).toBe("yuv420p");
    expect(command.at(-1)).toBe("clips/s1.mp4");
    expect(command[0]).toBe("-y");
  });

  it("reads jpeg frames by their own extension", () => {
    expect(r.ffmpegArgs({ dir: "d", format: "jpeg", out: "o.mp4", crf: 18 }).some((a) => a.endsWith("f%05d.jpg"))).toBe(true);
  });
});

describe("a screenshot's size", () => {
  const png = (width: number, height: number): Buffer => {
    const bytes = Buffer.alloc(33);
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(bytes);
    bytes.writeUInt32BE(13, 8);
    bytes.write("IHDR", 12, "ascii");
    bytes.writeUInt32BE(width, 16);
    bytes.writeUInt32BE(height, 20);
    return bytes;
  };

  it("is read from the PNG's header", () => {
    expect(r.pngSize(png(1920, 1080))).toEqual({ width: 1920, height: 1080 });
    expect(r.pngSize(png(2400, 1350))).toEqual({ width: 2400, height: 1350 });
  });

  it("is nothing for bytes that are not a PNG", () => {
    expect(r.pngSize(Buffer.from("not a png at all, but long enough to have a header"))).toBeNull();
    expect(r.pngSize(Buffer.alloc(10))).toBeNull();
  });
});

describe("the tools it finds", () => {
  it("takes the ffmpeg it is told about, and none if that is not there", () => {
    expect(r.findFfmpeg({ FFMPEG: "/opt/ffmpeg" }, (path) => path === "/opt/ffmpeg")).toBe("/opt/ffmpeg");
    expect(r.findFfmpeg({ FFMPEG: "/nowhere/ffmpeg" }, () => false)).toBeNull();
  });

  it("looks for ffmpeg on the path when it is not told", () => {
    const sep = process.platform === "win32" ? ";" : ":";
    const exe = process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg";
    const found = r.findFfmpeg({ PATH: ["/a", "/b", "/c"].join(sep) }, (path) => path.replaceAll("\\", "/") === `/b/${exe}`);
    expect(found?.replaceAll("\\", "/")).toBe(`/b/${exe}`);
    expect(r.findFfmpeg({ PATH: "/a" }, () => false)).toBeNull();
    expect(r.findFfmpeg({}, () => true)).toBeNull();
  });

  it("keeps playwright-core in a directory of its own unless it is told where", () => {
    expect(r.toolsDir({ RECORD_TOOLS: "/tools" })).toBe("/tools");
    expect(r.toolsDir({ LOCALAPPDATA: "/local" }).replaceAll("\\", "/")).toBe("/local/fractalswarm-record");
  });
});

describe("the scenes it records", () => {
  it("are the scene files, in order, each with the stage it plays and its length", () => {
    const scenes = r.listScenes();
    expect(scenes.map((s) => s.id)).toEqual(["s1-arena-open", "s3-ablation", "s4-lens", "s5-recovery", "s6-fair-fight", "s7-where-it-helps", "s8-proof", "s9-close"]);
    for (const s of scenes) {
      expect(["arena", "run", "helps", "ablation", "title"]).toContain(s.stage);
      expect(s.seconds).toBeGreaterThanOrEqual(1);
      expect(s.title.length).toBeGreaterThan(0);
    }
  });

  it("need the runs their stage plays, from the file or from the options", () => {
    expect(r.missingFor("arena", {}, {})).toEqual(["swarm", "rival"]);
    expect(r.missingFor("arena", { swarm: "a" }, {})).toEqual(["rival"]);
    expect(r.missingFor("arena", {}, { swarm: "a", rival: "b" })).toEqual([]);
    expect(r.missingFor("arena", { rival: "c" }, { swarm: "a", rival: "b" })).toEqual([]);
    expect(r.missingFor("ablation", {}, { ablation: null })).toEqual(["ablation"]);
    expect(r.missingFor("helps", {}, {})).toEqual([]);
    expect(r.missingFor("title", {}, {})).toEqual([]);
  });

  it("play the swarm on a run page when no run is named, as the page does", () => {
    expect(r.missingFor("run", {}, {})).toEqual(["run"]);
    expect(r.missingFor("run", { swarm: "s" }, {})).toEqual([]);
    expect(r.missingFor("run", {}, { swarm: "s" })).toEqual([]);
  });

  it("are the same files the director page lists", () => {
    const ids = r.listScenes().map((s) => s.id);
    expect(ids).not.toContain("s2-intake"); // recorded live
  });
});

describe("what makes a take unfit for the cut", () => {
  const clean = { trouble: [], ended: { warnings: [], position: 12, steps: 12 } };

  it("is nothing, when the page was quiet and the script ran through", () => {
    expect(r.flagsOf(clean)).toEqual([]);
  });

  it("is an error of the page, a warning of the scene, or a script that ran out of time", () => {
    expect(r.flagsOf({ ...clean, trouble: ["page error: boom"] })).toEqual(["page error: boom"]);
    expect(r.flagsOf({ ...clean, ended: { ...clean.ended, warnings: ["no node o9 on the left"] } })).toEqual(["the scene says: no node o9 on the left"]);
    expect(r.flagsOf({ ...clean, ended: { ...clean.ended, position: 9 } })).toEqual(["the script ran 9 of 12 steps: it is longer than its scene"]);
    expect(r.flagsOf({ trouble: ["a"], ended: { warnings: ["b"], position: 1, steps: 2 } })).toHaveLength(3);
  });
});
