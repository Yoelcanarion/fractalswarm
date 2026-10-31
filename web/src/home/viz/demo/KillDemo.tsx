import { useEffect, useMemo, useRef, type CSSProperties } from "react";
import type { TreeSlice } from "../../data/types";
import { bundledStory, useStory } from "../../story";
import { SECONDS } from "../ease";
import { useCalm } from "../page";
import { onFrame } from "../ticker";
import { Ambient } from "../tree/ambient";
import { treeModel, type TreeModel } from "../tree/model";
import { collectTree, paintAmbient, paintTree, U } from "../tree/paint";
import { TreeSvg } from "../tree/SwarmTree";
import { whileVisible } from "../visible";
import { createStage } from "./stage";

/** The kills "Kill half" makes, in the order the recorded run lost its coordinators; the ones already down are skipped. */
const HALF_ORDER = ["o0", "o2.1", "o1", "o3.2", "o2"] as const;
const HALF = 5;

/** Seconds of nobody touching it before it puts itself back, and of everything being down before it does. */
const IDLE_MS = 16000;
const DOWN_MS = 4500;

const INTRO = "Click a coordinator to crash it.";
const BACK = "Everything is back. Click a coordinator to crash it.";
const NOBODY = "Everyone has crashed. There is nobody left to take over.";

export interface KillDemoProps {
  /** The tree to draw; the recorded run's own when absent. */
  data?: TreeSlice;
  /** Standing still, which the page says through its own context when this is absent: every change is made at once and nothing runs by itself. */
  still?: boolean | undefined;
  /** Print the sentence that says this is an illustration, not a run. The page that holds the demo prints it itself, above it. */
  note?: boolean;
  className?: string;
}

/** The recorded tree without its recorded kills: the demo's dead come from the visitor's clicks, with no time from a run. */
function demoModel(tree: TreeSlice): TreeModel {
  return { ...treeModel(tree), kills: [], killOf: {} };
}

const DESCRIPTION =
  "An illustration, not a run. Coordinators form a tree, with agents at the bottom. Crashing a coordinator makes the survivors pick " +
  "one heir by the same rule, and the work it held moves to that heir.";

function nameOf(model: TreeModel, id: string): string {
  const info = model.node[id];
  return info ? `${info.label} (${id})` : id;
}

function joined(names: string[]): string {
  return names.length <= 1 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/** What the demo says once a coordinator has crashed and its work has gone to its heirs: one heir takes over, two or more take over. */
export function crashLine(lost: string, heirs: string[]): string {
  return `${lost} crashed. ${joined(heirs)} ${heirs.length === 1 ? "takes" : "take"} over, picked by the same rule on every survivor, so there is no election.`;
}

export function KillDemo({ data, still, note = false, className }: KillDemoProps) {
  const page = useStory();
  const tree = data ?? page?.tree ?? bundledStory.tree;
  const model = useMemo(() => demoModel(tree), [tree]);
  const reduced = useCalm(still);
  const sizes = useMemo(
    () => Object.fromEntries(model.ids.map((id) => [id, { size: model.node[id]?.size ?? 0.2, brain: model.node[id]?.kind === "brain" }])),
    [model],
  );
  const brains = useMemo(() => model.ids.filter((id) => model.node[id]?.kind === "brain"), [model]);

  const host = useRef<HTMLElement>(null);
  const svg = useRef<SVGSVGElement>(null);
  const picks = useRef<HTMLDivElement>(null);
  const line = useRef<HTMLParagraphElement>(null);
  const half = useRef<HTMLButtonElement>(null);
  const again = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const element = host.current;
    const picture = svg.current;
    const box = picks.current;
    const say = line.current;
    const killHalf = half.current;
    const reset = again.current;
    if (!element || !picture || !box || !say || !killHalf || !reset) return undefined;

    const seconds = reduced ? 0 : SECONDS.takeover;
    const stage = createStage(tree, seconds);
    const rig = collectTree(picture, sizes);
    const layer = reduced ? null : new Ambient(model);
    const buttons = new Map<string, HTMLButtonElement>();
    for (const el of box.querySelectorAll<HTMLButtonElement>("[data-pick]")) buttons.set(el.dataset["pick"] ?? "", el);
    const b = model.bounds;
    const width = (b.x1 - b.x0) * U;

    let clock = 0;
    let scale = 1;
    let queue: string[] = [];
    let queueAt = 0;
    let later: { at: number; text: string }[] = [];
    let downAt: number | null = null;
    let touched = performance.now();
    let moved = true;

    const text = (value: string): void => {
      if (say.textContent !== value) say.textContent = value;
    };
    const place = (): void => {
      for (const [id, el] of buttons) {
        const at = stage.place(id, clock);
        el.style.transform = `translate(${((at.x - b.x0) * U * scale).toFixed(1)}px, ${((at.y - b.y0) * U * scale).toFixed(1)}px)`;
      }
    };
    const size = (): void => {
      scale = picture.getBoundingClientRect().width / width || 1;
      for (const [id, el] of buttons) el.style.setProperty("--pick", `${Math.max(40, 2 * (sizes[id]?.size ?? 0.3) * U * scale + 12).toFixed(0)}px`);
      place();
    };
    const controls = (): void => {
      const down = new Set(stage.crashed());
      for (const [id, el] of buttons) {
        el.disabled = down.has(id);
        el.setAttribute("aria-label", down.has(id) ? `${nameOf(model, id)}, crashed` : `Crash ${nameOf(model, id)}`);
      }
      killHalf.disabled = down.size >= HALF || queue.length > 0;
      reset.disabled = down.size === 0 && queue.length === 0;
    };
    const paint = (dt: number): void => {
      const frame = stage.at(clock);
      paintTree(rig, frame);
      if (layer) {
        layer.step(dt, frame);
        paintAmbient(rig, layer);
      }
    };
    const draw = (): void => {
      paint(0);
      place();
    };

    const crash = (id: string): void => {
      const out = stage.kill(id, clock);
      if (!out) return;
      const heirs = [...new Set(out.rounds.map((r) => r.heir).filter((h): h is string => h !== null))];
      const lost = nameOf(model, id);
      const after =
        stage.alive().length === 0
          ? NOBODY
          : heirs.length === 0
            ? `${lost} crashed. Nobody is left to take its work.`
            : crashLine(lost, heirs.map((h) => nameOf(model, h)));
      downAt = stage.alive().length === 0 ? clock + seconds * 1000 + DOWN_MS : null;
      if (seconds === 0) text(after);
      else {
        text(`${lost} crashed.`);
        // a line still waiting to be said is about an earlier crash, which this one may have undone (its heir may be this coordinator)
        later = [{ at: clock + seconds * 600, text: after }];
      }
      moved = true;
      controls();
    };
    const restart = (said: string): void => {
      stage.reset(clock);
      queue = [];
      later = [];
      downAt = null;
      text(said);
      moved = true;
      controls();
    };
    const touch = (): void => {
      touched = performance.now();
    };

    const onPick = (event: Event): void => {
      const el = (event.target as Element).closest<HTMLElement>("[data-pick]");
      if (!el) return;
      touch();
      crash(el.dataset["pick"] ?? "");
      if (reduced) {
        clock += 1;
        draw();
      }
    };
    const onHalf = (): void => {
      touch();
      const down = new Set(stage.crashed());
      queue = HALF_ORDER.filter((id) => !down.has(id)).slice(0, Math.max(0, HALF - down.size));
      queueAt = clock;
      if (reduced) {
        for (const id of queue) crash(id);
        queue = [];
        clock += 1;
        draw();
      }
      controls();
    };
    const onReset = (): void => {
      touch();
      restart(BACK);
      if (reduced) {
        clock += 1;
        draw();
      }
    };

    box.addEventListener("click", onPick);
    killHalf.addEventListener("click", onHalf);
    reset.addEventListener("click", onReset);
    const resize = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(size);
    resize?.observe(picture);
    size();
    controls();
    draw();

    // Nobody touched it for a while, or everything is down: it puts itself back. Checked on the wall clock, by the loop while it runs.
    const watch = (): void => {
      const idle = performance.now() - touched > IDLE_MS;
      const quiet = !stage.playing(clock) && queue.length === 0;
      if ((idle && quiet && stage.crashed().length > 0) || (downAt !== null && clock >= downAt)) restart(BACK);
    };

    let stopTimer: (() => void) | null = null;
    if (reduced) {
      const timer = window.setInterval(() => {
        clock += 1000;
        if (stage.crashed().length > 0 && performance.now() - touched > IDLE_MS) {
          restart(BACK);
          clock += 1;
          draw();
        }
      }, 2000);
      stopTimer = () => window.clearInterval(timer);
    }

    const stopLoop = reduced
      ? () => undefined
      : whileVisible(element, () => {
          // A visitor who left while something was crashed finds it put back, with no replay of what they did not watch.
          if (performance.now() - touched > IDLE_MS && stage.crashed().length > 0) {
            restart(BACK);
            clock += SECONDS.grow * 1000 + 50;
          }
          return onFrame((dt) => {
            clock += dt * 1000;
            if (queue.length > 0 && clock >= queueAt) {
              const id = queue.shift();
              if (id) crash(id);
              queueAt = clock + seconds * 1000;
              // Kill half is the visitor's one action, and its result stays for the whole of the wait after the last crash
              if (queue.length === 0) touch();
              controls();
            }
            while (later.length > 0 && (later[0] as { at: number }).at <= clock) text((later.shift() as { text: string }).text);
            watch();
            paint(dt);
            if (moved || stage.playing(clock)) {
              place();
              moved = stage.playing(clock);
            }
          });
        });

    return () => {
      stopLoop();
      stopTimer?.();
      resize?.disconnect();
      box.removeEventListener("click", onPick);
      killHalf.removeEventListener("click", onHalf);
      reset.removeEventListener("click", onReset);
    };
  }, [tree, model, sizes, reduced]);

  const bounds = model.bounds;
  const aspect = (bounds.x1 - bounds.x0) / (bounds.y1 - bounds.y0);

  return (
    <figure ref={host} className={className ? `hv-demo ${className}` : "hv-demo"}>
      <div className="hv-demo-head">
        <p ref={line} className="hv-demo-line" role="status" aria-live="polite">
          {INTRO}
        </p>
        <div className="hv-demo-bar">
          <button ref={half} type="button" className="hv-demo-btn hv-demo-btn--main">
            Kill half
          </button>
          <button ref={again} type="button" className="hv-demo-btn" disabled>
            Reset
          </button>
        </div>
      </div>
      <div className="hv-demo-stage" style={{ "--demo-aspect": aspect.toFixed(3) } as CSSProperties}>
        <TreeSvg
          svgRef={svg}
          model={model}
          labels="ids"
          clock={false}
          ambient={!reduced}
          scoreText={false}
          labelOnRule
          title="The swarm tree, as an illustration"
          description={DESCRIPTION}
        />
        <div ref={picks} className="hv-picks">
          {brains.map((id) => (
            <button key={id} type="button" className="hv-pick" data-pick={id} aria-label={`Crash ${nameOf(model, id)}`} />
          ))}
        </div>
      </div>
      {note && <p className="hv-demo-note">An illustration, not a real run.</p>}
    </figure>
  );
}
