// `#/director/<scene id>`: one scene, played at 1920 x 1080 with none of the app around it, for the video. The page
// builds the stage the scene names (stages.ts), a take of the scene (take.ts) and a driver that draws its frames
// (driver.ts), and puts the captions and rings over the stage (OverlayLayer.tsx). `window.__director` is what a recorder reads.
// `#/director` lists the scenes. The address options are in route.ts.

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useStore } from "zustand";

import "./director.css";
import { fitFrame } from "./camera";
import { createDriver, PREROLL_FRAMES, type DriverState } from "./driver";
import { OverlayLayer } from "./OverlayLayer";
import { directorHash, type DirectorRoute } from "./route";
import { SCENE_FILES, sceneFile, SOURCES } from "./scenes";
import type { Scene, Stage } from "./script";
import { missingSources, resolveSources, type Sources } from "./sources";
import { createArenaStage, createRunStage, noteProblems, replayNote, type StageController } from "./stages";
import { AblationStageView, ArenaStageView, HelpsStageView, RunStageView, TitleStageView } from "./StageViews";
import { createDomSurface } from "./surface";
import { createTake, type Take } from "./take";

/** What a recorder reads and drives. The getters are live. */
export interface DirectorApi {
  id: string;
  /** Frames in the clip, at `fps`. */
  frames: number;
  fps: number;
  /** Frames the driver lets go by, take held, before it starts or waits. */
  preroll: number;
  /** The stage has everything it shows. */
  readonly ready: boolean;
  readonly state: DriverState;
  /** Frames of the take drawn so far. */
  readonly frame: number;
  readonly done: boolean;
  /** Steps in the scene, and how many have run: a scene too short for its own script says so. */
  steps: number;
  readonly position: number;
  readonly warnings: string[];
  /** Why the stage cannot be shown, or null. */
  readonly problem: string | null;
  /** The replay note on the frame, or null. */
  readonly note: string | null;
  go(): void;
  restart(): void;
}

declare global {
  interface Window {
    __director?: DirectorApi;
  }
}

/** The stages laid out at the frame's height, as the app's pages are at 1080p; the others run as long as they are. */
const FITS: Record<Stage, boolean> = { arena: true, run: true, helps: false, ablation: false, title: true };

/** What has to be on the page before a take starts, besides the stage's own stores having loaded. */
const REQUIRED: Record<Stage, string[]> = {
  arena: [".side--swarm .board", ".side--rival .board", ".score"],
  run: [".counters", ".run__tree", ".timeline"],
  helps: ['[data-helps="outcome"]'],
  ablation: [".abl__head"],
  title: [".dir__card"],
};

/** What a stage says when it has nothing to show. */
const NOTHING: Partial<Record<Stage, string>> = { helps: ".helps > .empty", ablation: ".abl__error" };

const need = (value: string | null, name: string): string => {
  if (value === null) throw new Error(`the scene needs a ${name}`);
  return value;
};

interface Built {
  controller: StageController | null;
  view: ReactNode;
}

function build(scene: Scene, sources: Sources): Built {
  switch (scene.stage) {
    case "arena": {
      const stage = createArenaStage(need(sources.swarm, "swarm run"), need(sources.rival, "rival run"));
      return { controller: stage, view: <ArenaStageView stage={stage} /> };
    }
    case "run": {
      const stage = createRunStage(need(sources.run, "run"), scene.calls);
      return { controller: stage, view: <RunStageView stage={stage} /> };
    }
    case "helps":
      return { controller: null, view: <HelpsStageView /> };
    case "ablation":
      return { controller: null, view: <AblationStageView runId={need(sources.ablation, "ablation run")} /> };
    case "title":
      return { controller: null, view: <TitleStageView card={scene.card ?? { title: "", lines: [] }} /> };
  }
}

export function DirectorPage({ route }: { route: DirectorRoute }) {
  if (route.scene === null) return <SceneList />;
  const file = sceneFile(route.scene);
  if (file === null) {
    return (
      <Problem title={`No scene called ${route.scene}`}>
        <p>
          The scenes are the files in <code>web/src/director/scenes</code>. <a href={directorHash(null)}>See the list.</a>
        </p>
      </Problem>
    );
  }
  if (!file.read.ok) {
    return (
      <Problem title={`${file.id} does not read`}>
        <p className="mono">{file.read.reason}</p>
      </Problem>
    );
  }
  const scene = file.read.value;
  const { query } = route;
  const sources = resolveSources(SOURCES, query);
  const missing = missingSources(scene.stage, sources);
  if (missing.length > 0) {
    return (
      <Problem title={`${scene.id} needs ${missing.join(" and ")}`}>
        <p>
          The scene does not name its runs. Fill <code>web/src/director/sources.json</code>, or add{" "}
          {missing.map((name) => (
            <code key={name}>?{name}=&lt;run id&gt; </code>
          ))}
          to the address.
        </p>
      </Problem>
    );
  }
  return <Frame key={`${scene.id}|${JSON.stringify(sources)}`} scene={scene} sources={sources} hold={query.hold} hud={query.hud} />;
}

function Problem({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="dir-page">
      <div className="dir-page__card">
        <h1>{title}</h1>
        {children}
      </div>
    </div>
  );
}

function SceneList() {
  return (
    <div className="dir-page">
      <div className="dir-page__card dir-page__card--wide">
        <h1>Director</h1>
        <p>
          A scene is a script over a replay (<code>web/src/director/scenes/&lt;scene&gt;.json</code>); it plays at 1920 x 1080 with no app around it. Add{" "}
          <code>?hud</code> for the take's clock, <code>?swarm=&amp;rival=</code>, <code>?run=</code> or <code>?ablation=</code> to choose the runs, and <code>&amp;real</code> when they were recorded with the real model. Space pauses, R restarts, . steps one frame.
        </p>
        <ul className="dir-page__list">
          {SCENE_FILES.map((file) => {
            if (!file.read.ok) {
              return (
                <li key={file.id}>
                  <span className="mono">{file.id}</span> <span className="dir-page__bad">does not read: {file.read.reason}</span>
                </li>
              );
            }
            const scene = file.read.value;
            const missing = missingSources(scene.stage, resolveSources(SOURCES, { swarm: null, rival: null, run: null, ablation: null, real: false }));
            return (
              <li key={file.id}>
                <a className="mono" href={directorHash(file.id)}>
                  {file.id}
                </a>{" "}
                <span className="muted">
                  {scene.title} · {scene.stage} · {(scene.durationMs / 1000).toFixed(0)} s
                  {missing.length > 0 ? ` · needs ${missing.join(", ")}` : ""}
                </span>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}

function useWindowFrame() {
  const [box, setBox] = useState(() => fitFrame(window.innerWidth, window.innerHeight));
  useEffect(() => {
    const on = () => setBox(fitFrame(window.innerWidth, window.innerHeight));
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, []);
  return box;
}

interface FrameProps {
  scene: Scene;
  sources: Sources;
  hold: boolean;
  hud: boolean;
}

function Frame({ scene, sources, hold, hud }: FrameProps) {
  const box = useWindowFrame();
  const boxRef = useRef(box);
  boxRef.current = box;
  const frameRef = useRef<HTMLDivElement>(null);
  const cameraRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const [built, setBuilt] = useState<Built | null>(null);
  const [take, setTake] = useState<Take | null>(null);
  const [phase, setPhase] = useState<DriverState>("loading");
  const [problem, setProblem] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    document.documentElement.classList.add("dir-on");
    return () => document.documentElement.classList.remove("dir-on");
  }, []);

  // The stage is made in an effect, not in render, so a development remount (which runs the cleanup) never leaves the
  // page holding a disposed clock.
  useEffect(() => {
    const made = build(scene, sources);
    setBuilt(made);
    return () => made.controller?.dispose();
  }, [scene, sources]);

  useEffect(() => {
    const frame = frameRef.current;
    const camera = cameraRef.current;
    const stage = stageRef.current;
    if (built === null || !frame || !camera || !stage) return;
    const { controller } = built;
    const surface = createDomSurface({
      frame,
      camera,
      stage,
      scale: () => boxRef.current.scale,
      sides: controller?.sides ?? { left: null, right: null },
      lens: controller?.lens ?? null,
      end: () => controller?.replay.end() ?? 0,
    });
    const made = createTake(scene, controller?.replay ?? null, surface);
    let state: DriverState = "loading";
    const drive = createDriver(made, {
      hold,
      preroll: PREROLL_FRAMES,
      loop: { request: (callback) => requestAnimationFrame(callback), cancel: (handle) => cancelAnimationFrame(handle) },
      onChange: (next) => {
        state = next;
        setPhase(next);
      },
    });
    let ready = false;
    let trouble: string | null = null;
    let words: string | null = null;
    let noted: string[] = [];

    const check = (): void => {
      const said = controller?.problem() ?? null;
      const empty = NOTHING[scene.stage] === undefined ? null : stage.querySelector(NOTHING[scene.stage] as string);
      if (said !== null || empty !== null) {
        trouble = said ?? (empty?.textContent ?? "").trim();
        setProblem(trouble);
        return;
      }
      if (controller !== null && !controller.loaded()) return;
      if (!REQUIRED[scene.stage].every((css) => stage.querySelector(css) !== null)) return;
      if (document.fonts.status !== "loaded") return;
      clearInterval(poll);
      ready = true;
      words = scene.replayNote && controller !== null ? replayNote(controller.costs(), sources.real) : null;
      noted = scene.replayNote && controller !== null ? noteProblems(controller.costs(), sources.real) : [];
      setNote(words);
      made.restart();
      drive.ready();
    };
    const poll = setInterval(check, 100);

    window.__director = {
      id: scene.id,
      frames: made.frames,
      fps: 60,
      preroll: PREROLL_FRAMES,
      get ready() {
        return ready;
      },
      get state() {
        return state;
      },
      get frame() {
        return made.state.getState().frame;
      },
      get done() {
        return made.state.getState().done;
      },
      steps: scene.steps.length,
      get position() {
        return made.state.getState().position;
      },
      get warnings() {
        return [...made.state.getState().warnings, ...noted];
      },
      get problem() {
        return trouble;
      },
      get note() {
        return words;
      },
      go: () => drive.go(),
      restart: () => drive.restart(),
    };

    const onKey = (event: KeyboardEvent): void => {
      if (event.key === " ") {
        event.preventDefault();
        if (state === "playing") drive.pause();
        else drive.resume();
      } else if (event.key === "r") drive.restart();
      else if (event.key === ".") drive.step();
    };
    window.addEventListener("keydown", onKey);
    setTake(made);
    return () => {
      clearInterval(poll);
      window.removeEventListener("keydown", onKey);
      drive.dispose();
      delete window.__director;
      setTake(null);
      setPhase("loading");
    };
  }, [built, scene, hold]);

  return (
    <div className="dir" data-scene={scene.id} data-stage={scene.stage}>
      <div ref={frameRef} className="dir__frame" style={{ left: box.left, top: box.top, transform: `scale(${box.scale})` }}>
        <div ref={cameraRef} className="dir__camera">
          <div ref={stageRef} className={`app dir__stage dir__stage--${FITS[scene.stage] ? "fit" : "flow"}`} data-stage={scene.stage}>
            {built?.view}
          </div>
        </div>
        {take !== null && <OverlayLayer take={take} note={note} />}
        {problem !== null && (
          <div className="dir__problem" role="alert">
            <strong>{scene.id} cannot be shown</strong>
            <span>{problem}</span>
          </div>
        )}
        {hud && take !== null && <Hud take={take} phase={phase} replay={built?.controller?.replay ?? null} />}
      </div>
    </div>
  );
}

/** The author's readout (`?hud`): never on in a recording. */
function Hud({ take, phase, replay }: { take: Take; phase: DriverState; replay: StageController["replay"] | null }) {
  const { frame, ms, warnings, camera } = useStore(take.state);
  return (
    <div className="dir__hud mono">
      <div>
        {take.scene.id} · {phase} · frame {frame}/{take.frames} · take {(ms / 1000).toFixed(2)} s
      </div>
      {replay !== null && (
        <div>
          replay {(replay.playhead() / 1000).toFixed(2)} of {(replay.end() / 1000).toFixed(1)} s · x{replay.speed().toFixed(2)} · {replay.playing() ? "playing" : "paused"}
        </div>
      )}
      <div>
        camera {camera.x.toFixed(0)}, {camera.y.toFixed(0)} · zoom {camera.zoom.toFixed(2)}
      </div>
      {warnings.map((warning) => (
        <div key={warning} className="dir__warn">
          {warning}
        </div>
      ))}
    </div>
  );
}
