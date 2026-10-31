// A scene script: what the director does, in order, to make one clip of the video (`scenes/<scene id>.json`, one
// per scene of docs/video-script.md). It is read strictly: a field the director does not know, or one of the wrong
// kind, is named by its path and refused, so a typo never becomes a silent no-op in a take.
//
// A scene is a short program over the take's own clock (frames of 1/60 s, so a take repeats exactly):
//
//   seek, play, pause, speed   the replay: where it is, whether it runs, how fast (speed may ramp)
//   wait                       the program stops for some milliseconds of the take, or until the replay reaches a moment
//   camera                     fit a node, a subtree or a panel, zoom, pan; or go home. Eased, and it does not stop the program
//   highlight                  a ring around a node, a counter or a panel, for some milliseconds
//   tooltip                    the hover text an element carries (its `title`), drawn next to it for some milliseconds
//   caption                    a lower third, or a brief overlay, for some milliseconds
//   lens                       open a call of the Muse lens, or close it
//   panel                      show or hide a part of the page
//
// Only `wait` stops the program; everything else starts something and goes on, as the cues of a timeline do.

import { bad, count, flag, list, number, oneOf, reading, record, text, type Read } from "../intake/strict";
import { isRegion, REGIONS, sides, type RegionName, type Side, type Target } from "./targets";
import { milliseconds, parseTime, type TimeExpr } from "./time";

export const STAGES = ["arena", "run", "helps", "ablation", "title"] as const;
export type Stage = (typeof STAGES)[number];

/** The parts of a page a scene may hide. The arena's assumptions line is not among them: it is always on screen. */
export const PANELS: Partial<Record<Stage, readonly string[]>> = {
  arena: ["scoreboard", "timeline"],
  run: ["counters", "schedule", "feed", "timeline"],
};
export type PanelName = "scoreboard" | "timeline" | "counters" | "schedule" | "feed";

export const EASES = ["linear", "out", "inout"] as const;
export type Ease = (typeof EASES)[number];

export const MAX_DURATION_MS = 300_000;
export const MIN_SPEED = 0.1;
export const MAX_SPEED = 40;
export const FRAME_PADDING = 0.1;

/** How a scene picks one call of the Muse lens: every field given must match, then the nth of those (from 0). */
export interface CallPick {
  model: string | null;
  actor: string | null;
  role: string | null;
  purpose: string | null;
  tag: string | null;
  nth: number;
}

export interface Card {
  title: string;
  lines: string[];
}

export type Step =
  | { do: "seek"; to: TimeExpr }
  | { do: "play" }
  | { do: "pause" }
  | { do: "speed"; x: number; rampMs: number }
  | { do: "wait"; ms: number | null; until: TimeExpr | null; timeoutMs: number | null }
  | { do: "camera"; fit: Target | null; zoom: number | null; pan: { x: number; y: number } | null; pad: number; ms: number; ease: Ease }
  | { do: "highlight"; target: Target; ms: number }
  | { do: "tooltip"; target: Target; ms: number }
  | { do: "caption"; text: string; kicker: string | null; ms: number; style: "lower" | "overlay" }
  | { do: "lens"; open: string | null }
  | { do: "panel"; name: PanelName; show: boolean };

/** Whether a scene points the camera, a ring or a tooltip at a named part of the page. */
export function pointsAtRegion(scene: Scene, region: RegionName): boolean {
  return scene.steps.some((step) => {
    const target = step.do === "highlight" || step.do === "tooltip" ? step.target : step.do === "camera" ? step.fit : null;
    return target !== null && target.kind === "region" && target.region === region;
  });
}

export interface Scene {
  id: string;
  title: string;
  stage: Stage;
  durationMs: number;
  /** "Replay of a real recorded run · real cost $X" on the frame (the video script asks for it wherever a replay is shown). */
  replayNote: boolean;
  /** Parts hidden or shown when the scene opens. */
  panels: Partial<Record<PanelName, boolean>>;
  calls: Record<string, CallPick>;
  card: Card | null;
  steps: Step[];
}

/** An actor in a scene: an id, the root's holder, or the coordinator that crashed (or the heir that took over) Nth. */
const ACTOR = /^(\$root|\$(crashed|heir):-?[1-9]\d*|[A-Za-z0-9_.:/#@+-]+)$/;

function known(r: Record<string, unknown>, keys: readonly string[], where: string): void {
  for (const key of Object.keys(r)) if (!keys.includes(key)) bad(`${where}.${key}`, `not a field the director knows here (${keys.join(", ")})`);
}

const optional = <T>(value: unknown, read: (value: unknown) => T): T | null => (value === undefined || value === null ? null : read(value));

function readTarget(raw: unknown, where: string): Target {
  const r = record(raw, where);
  const keys = ["actor", "side", "subtree", "counter", "region"].filter((key) => r[key] !== undefined);
  const kinds = keys.filter((key) => key === "actor" || key === "counter" || key === "region");
  if (kinds.length !== 1) return bad(where, "name exactly one of actor, counter or region");
  if (kinds[0] === "actor") {
    known(r, ["actor", "side", "subtree"], where);
    const actor = text(r.actor, `${where}.actor`);
    if (!ACTOR.test(actor)) return bad(`${where}.actor`, `"${actor}" is not an actor id, $root, $crashed:N or $heir:N`);
    return {
      kind: "actor",
      actor,
      side: r.side === undefined ? null : (oneOf(r.side, sides, `${where}.side`) as Side),
      subtree: r.subtree === undefined ? false : flag(r.subtree, `${where}.subtree`),
    };
  }
  if (kinds[0] === "counter") {
    known(r, ["counter"], where);
    return { kind: "counter", counter: text(r.counter, `${where}.counter`) };
  }
  known(r, ["region"], where);
  const name = text(r.region, `${where}.region`);
  return isRegion(name) ? { kind: "region", region: name } : bad(`${where}.region`, `"${name}" is not a region (${Object.keys(REGIONS).join(", ")})`);
}

function readStep(raw: unknown, where: string): Step {
  const r = record(raw, where);
  const kind = oneOf(r.do, ["seek", "play", "pause", "speed", "wait", "camera", "highlight", "tooltip", "caption", "lens", "panel"] as const, `${where}.do`);
  switch (kind) {
    case "seek":
      known(r, ["do", "to"], where);
      return { do: "seek", to: parseTime(r.to, `${where}.to`) };
    case "play":
    case "pause":
      known(r, ["do"], where);
      return { do: kind };
    case "speed": {
      known(r, ["do", "x", "ramp_ms"], where);
      const x = number(r.x, `${where}.x`);
      if (x < MIN_SPEED || x > MAX_SPEED) return bad(`${where}.x`, `a speed from ${MIN_SPEED} to ${MAX_SPEED}, got ${x}`);
      return { do: "speed", x, rampMs: r.ramp_ms === undefined ? 0 : milliseconds(r.ramp_ms, `${where}.ramp_ms`, 0, 20_000) };
    }
    case "wait": {
      known(r, ["do", "ms", "until", "timeout_ms"], where);
      if ((r.ms === undefined) === (r.until === undefined)) return bad(where, "wait for `ms` of the take, or `until` a moment of the replay: one of the two");
      if (r.ms !== undefined && r.timeout_ms !== undefined) return bad(`${where}.timeout_ms`, "only a wait `until` a moment has a timeout");
      return {
        do: "wait",
        ms: r.ms === undefined ? null : milliseconds(r.ms, `${where}.ms`, 0, 120_000),
        until: r.until === undefined ? null : parseTime(r.until, `${where}.until`),
        timeoutMs: r.timeout_ms === undefined ? null : milliseconds(r.timeout_ms, `${where}.timeout_ms`, 100, 300_000),
      };
    }
    case "camera": {
      known(r, ["do", "fit", "home", "zoom", "pan", "pad", "ms", "ease"], where);
      const home = r.home === undefined ? false : flag(r.home, `${where}.home`);
      if (home === (r.fit !== undefined)) return bad(where, "a camera step fits a target (`fit`) or goes `home`: one of the two");
      if (home && (r.zoom !== undefined || r.pan !== undefined || r.pad !== undefined)) return bad(where, "`home` takes no zoom, pan or pad");
      const pan = optional(r.pan, (value) => {
        const p = record(value, `${where}.pan`);
        known(p, ["x", "y"], `${where}.pan`);
        return { x: number(p.x, `${where}.pan.x`), y: number(p.y, `${where}.pan.y`) };
      });
      const zoom = optional(r.zoom, (value) => {
        const z = number(value, `${where}.zoom`);
        return z >= 0.25 && z <= 8 ? z : bad(`${where}.zoom`, `a zoom from 0.25 to 8, got ${z}`);
      });
      const pad = r.pad === undefined ? FRAME_PADDING : number(r.pad, `${where}.pad`);
      if (pad < 0 || pad > 2) return bad(`${where}.pad`, `a padding from 0 to 2 (a share of the target's size), got ${pad}`);
      return {
        do: "camera",
        fit: home ? null : readTarget(r.fit, `${where}.fit`),
        zoom,
        pan,
        pad,
        ms: r.ms === undefined ? 1200 : milliseconds(r.ms, `${where}.ms`, 0, 20_000),
        ease: r.ease === undefined ? "inout" : oneOf(r.ease, EASES, `${where}.ease`),
      };
    }
    case "highlight":
    case "tooltip":
      // A tooltip has no words of its own: it shows the ones the page carries, so a scene never retypes the UI.
      known(r, ["do", "target", "ms"], where);
      return { do: kind, target: readTarget(r.target, `${where}.target`), ms: milliseconds(r.ms, `${where}.ms`, 200, 60_000) };
    case "caption": {
      known(r, ["do", "text", "kicker", "ms", "style"], where);
      const words = text(r.text, `${where}.text`);
      if (words.trim() === "" || words.length > 200) return bad(`${where}.text`, "a caption of 1 to 200 characters");
      const kicker = optional(r.kicker, (value) => text(value, `${where}.kicker`));
      if (kicker !== null && kicker.length > 60) return bad(`${where}.kicker`, "a kicker of up to 60 characters");
      return {
        do: "caption",
        text: words,
        kicker,
        ms: milliseconds(r.ms, `${where}.ms`, 500, 60_000),
        style: r.style === undefined ? "lower" : oneOf(r.style, ["lower", "overlay"] as const, `${where}.style`),
      };
    }
    case "lens": {
      known(r, ["do", "open", "close"], where);
      if ((r.open === undefined) === (r.close === undefined)) return bad(where, "a lens step opens a call (`open`: its name in `calls`) or closes the lens (`close`: true): one of the two");
      if (r.close !== undefined) return flag(r.close, `${where}.close`) ? { do: "lens", open: null } : bad(`${where}.close`, "close is true, or leave it out");
      return { do: "lens", open: text(r.open, `${where}.open`) };
    }
    case "panel": {
      known(r, ["do", "name", "show"], where);
      return { do: "panel", name: oneOf(r.name, ["scoreboard", "timeline", "counters", "schedule", "feed"] as const, `${where}.name`), show: flag(r.show, `${where}.show`) };
    }
  }
}

function readCall(raw: unknown, where: string): CallPick {
  const r = record(raw, where);
  known(r, ["model", "actor", "role", "purpose", "tag", "nth"], where);
  const pick: CallPick = {
    model: optional(r.model, (v) => text(v, `${where}.model`)),
    actor: optional(r.actor, (v) => text(v, `${where}.actor`)),
    role: optional(r.role, (v) => text(v, `${where}.role`)),
    purpose: optional(r.purpose, (v) => text(v, `${where}.purpose`)),
    tag: optional(r.tag, (v) => text(v, `${where}.tag`)),
    nth: r.nth === undefined ? 0 : count(r.nth, `${where}.nth`),
  };
  if (Object.values({ ...pick, nth: null }).every((v) => v === null)) return bad(where, "name at least one of model, actor, role, purpose or tag");
  return pick;
}

function readCard(raw: unknown, where: string): Card {
  const r = record(raw, where);
  known(r, ["title", "lines"], where);
  return { title: text(r.title, `${where}.title`), lines: list(r.lines ?? [], `${where}.lines`).map((line, i) => text(line, `${where}.lines[${i}]`)) };
}

const REPLAY_STEPS: ReadonlySet<Step["do"]> = new Set(["seek", "play", "pause", "speed", "lens"]);

/** The rules that span fields: a step must make sense on the stage it is for. */
function check(scene: Scene): void {
  const { stage } = scene;
  const replays = stage === "arena" || stage === "run";
  const panels = PANELS[stage] ?? [];
  const where = (i: number) => `scene.steps[${i}]`;
  let waits = 0;
  const targetOk = (target: Target, at: string): void => {
    if (target.kind === "region" && !(REGIONS[target.region].stages as readonly string[]).includes(stage)) bad(at, `the region "${target.region}" is not on the ${stage} stage (${REGIONS[target.region].stages.join(", ")})`);
    if (target.kind === "actor" && !replays) bad(at, `the ${stage} stage has no actors`);
    if (target.kind === "actor" && target.side !== null && stage !== "arena") bad(`${at}.side`, "only the arena has a left and a right side");
    if (target.kind === "counter" && stage !== "arena") bad(at, "only the arena has counters");
  };
  const timeOk = (time: TimeExpr, at: string): void => {
    if (time.anchor?.kind === "call" && scene.calls[time.anchor.name] === undefined) bad(at, `call "${time.anchor.name}" is not in the scene's \`calls\``);
  };
  scene.steps.forEach((step, i) => {
    if (REPLAY_STEPS.has(step.do) && !replays) bad(where(i), `the ${stage} stage has no replay to ${step.do}`);
    if (step.do === "lens" && stage !== "run") bad(where(i), "the Muse lens is on the run page: stage `run`");
    if (step.do === "lens" && step.open !== null && scene.calls[step.open] === undefined) bad(`${where(i)}.open`, `call "${step.open}" is not in the scene's \`calls\``);
    if (step.do === "seek") timeOk(step.to, `${where(i)}.to`);
    if (step.do === "wait") {
      if (step.until !== null) {
        if (!replays) bad(where(i), `the ${stage} stage has no replay to wait for`);
        timeOk(step.until, `${where(i)}.until`);
      }
      waits += step.ms ?? 0;
    }
    if (step.do === "camera" && step.fit !== null) targetOk(step.fit, `${where(i)}.fit`);
    if (step.do === "highlight" || step.do === "tooltip") targetOk(step.target, `${where(i)}.target`);
    if (step.do === "panel" && !panels.includes(step.name)) bad(`${where(i)}.name`, `the ${stage} stage has no "${step.name}" to show or hide${panels.length > 0 ? ` (it has ${panels.join(", ")})` : ""}`);
  });
  for (const name of Object.keys(scene.panels)) if (!panels.includes(name)) bad(`scene.panels.${name}`, `the ${stage} stage has no "${name}" to show or hide`);
  if (stage !== "run" && Object.keys(scene.calls).length > 0) bad("scene.calls", `the ${stage} stage has no lens: calls are for the run stage`);
  if (waits > scene.durationMs) bad("scene.steps", `the waits add up to ${waits} ms, more than the scene's ${scene.durationMs} ms: the last steps would never run`);
  if (stage === "title" && scene.card === null) bad("scene.card", "a title stage shows a card");
  if (stage !== "title" && scene.card !== null) bad("scene.card", "only a title stage has a card");
}

export function parseScene(raw: unknown): Read<Scene> {
  return reading(() => {
    const r = record(raw, "scene");
    known(r, ["id", "title", "stage", "duration_ms", "replay_note", "panels", "calls", "card", "steps"], "scene");
    const id = text(r.id, "scene.id");
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(id)) bad("scene.id", `"${id}" is not a scene id (lower case words joined by dashes, as in docs/video-script.md)`);
    const stage = oneOf(r.stage, STAGES, "scene.stage");
    const panels: Scene["panels"] = {};
    for (const [name, shown] of Object.entries(record(r.panels ?? {}, "scene.panels"))) panels[name as PanelName] = flag(shown, `scene.panels.${name}`);
    const calls: Scene["calls"] = {};
    for (const [name, pick] of Object.entries(record(r.calls ?? {}, "scene.calls"))) {
      if (!/^[A-Za-z][A-Za-z0-9_-]*$/.test(name)) bad(`scene.calls.${name}`, "a call name is letters, digits, _ and -");
      calls[name] = readCall(pick, `scene.calls.${name}`);
    }
    const scene: Scene = {
      id,
      title: text(r.title, "scene.title"),
      stage,
      durationMs: milliseconds(r.duration_ms, "scene.duration_ms", 1000, MAX_DURATION_MS),
      replayNote: r.replay_note === undefined ? stage === "arena" || stage === "run" : flag(r.replay_note, "scene.replay_note"),
      panels,
      calls,
      card: r.card === undefined ? null : readCard(r.card, "scene.card"),
      steps: list(r.steps ?? [], "scene.steps").map((step, i) => readStep(step, `scene.steps[${i}]`)),
    };
    check(scene);
    return scene;
  });
}

/** The regions of a stage, for the author's reference and for the tests. */
export const regionsOf = (stage: Stage): RegionName[] => (Object.keys(REGIONS) as RegionName[]).filter((name) => (REGIONS[name].stages as readonly string[]).includes(stage));
