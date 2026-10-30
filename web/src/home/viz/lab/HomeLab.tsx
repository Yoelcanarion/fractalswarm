import { useMotionValue, type MotionValue } from "motion/react";
import { useEffect, useState, type ReactNode } from "react";
import { currentTheme, setTheme } from "../../../lib/theme";
import { story } from "../../data/story";
import { usePlayback } from "../playback";
import { treePlayer } from "../tree/frame";
import { SwarmTree } from "../tree/SwarmTree";
import type { Pacing } from "../tree/timeline";
import "./lab.css";

/** True for ``#/home-lab``: the page that shows every home-page visual with a progress slider. */
export function isHomeLabHash(hash: string = typeof location === "undefined" ? "" : location.hash): boolean {
  return hash.startsWith("#/home-lab");
}

function useProgressReadout(progress: MotionValue<number>): number {
  const [value, setValue] = useState(progress.get());
  useEffect(() => progress.on("change", setValue), [progress]);
  return value;
}

interface JumpTo {
  label: string;
  p: number;
}

function Scrubber({
  progress,
  seconds,
  jumps = [],
  readout,
}: {
  progress: MotionValue<number>;
  seconds: number;
  jumps?: JumpTo[];
  readout?: (p: number) => string;
}) {
  const playback = usePlayback(progress, seconds, { loop: true });
  const p = useProgressReadout(progress);
  return (
    <div className="lab-scrub">
      <button type="button" onClick={playback.toggle} aria-label={playback.playing ? "Pause" : "Play"}>
        {playback.playing ? "Pause" : "Play"}
      </button>
      <button type="button" onClick={playback.restart}>
        Restart
      </button>
      <input
        type="range"
        min={0}
        max={1}
        step={0.0005}
        value={p}
        aria-label="progress"
        onChange={(e) => {
          playback.pause();
          progress.set(Number(e.target.value));
        }}
      />
      <output>
        p {p.toFixed(3)}
        {readout ? ` · ${readout(p)}` : ""}
      </output>
      {jumps.length > 0 && (
        <div className="lab-jumps">
          {jumps.map((j) => (
            <button
              key={j.label}
              type="button"
              onClick={() => {
                playback.pause();
                progress.set(j.p);
              }}
            >
              {j.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function Section({ id, title, note, children }: { id: string; title: string; note: string; children: ReactNode }) {
  return (
    <section className="lab-section" id={id}>
      <h2>{title}</h2>
      <p className="lab-note">{note}</p>
      {children}
    </section>
  );
}

function TreeSection({ still }: { still: boolean }) {
  const [pacing, setPacing] = useState<Pacing>("story");
  const [labels, setLabels] = useState<"ids" | "names" | "none">("ids");
  const progress = useMotionValue(0);
  const player = treePlayer(story.tree, pacing);
  const jumps = player.keyframes
    .filter((k) => k.kind === "kill" || k.kind === "verdict" || k.kind === "remap" || k.kind === "end")
    .map((k) => ({ label: `${k.kind} ${k.node ?? k.id.replace("remap:", "#")}`, p: k.kind === "remap" ? (k.p + k.pEnd) / 2 : k.p }));
  return (
    <Section
      id="tree"
      title="SwarmTree"
      note="The demo bundle's real tree: five of ten brains killed, the survivors re-own their work by hashing."
    >
      <div className="lab-controls">
        <label>
          pacing
          <select value={pacing} onChange={(e) => setPacing(e.target.value as Pacing)}>
            <option value="story">story (scroll-driven, the default)</option>
            <option value="hero">hero (time-driven)</option>
          </select>
        </label>
        <label>
          labels
          <select value={labels} onChange={(e) => setLabels(e.target.value as "ids" | "names" | "none")}>
            <option value="ids">ids</option>
            <option value="names">ids and names</option>
            <option value="none">none</option>
          </select>
        </label>
      </div>
      <div className="lab-stage">
        <SwarmTree progress={progress} data={story.tree} pacing={pacing} labels={labels} still={still} />
      </div>
      <Scrubber
        progress={progress}
        seconds={player.timeline.totalS}
        jumps={jumps}
        readout={(p) => `${(player.timeline.at(p).tMs / 1000).toFixed(1)} s of the run`}
      />
    </Section>
  );
}

export function HomeLab() {
  const [still, setStill] = useState(false);
  const [theme, setThemeState] = useState(currentTheme());
  return (
    <main className="lab">
      <header className="lab-header">
        <h1>Home page visuals</h1>
        <p>
          Every number comes from <code>web/src/home/data/story.json</code>, which <code>scripts/build_home_data.py</code> writes from
          committed results and recorded runs.
        </p>
        <div className="lab-controls">
          <label>
            <input type="checkbox" checked={still} onChange={(e) => setStill(e.target.checked)} /> still (reduced motion: final state)
          </label>
          <button
            type="button"
            onClick={() => {
              const next = theme === "dark" ? "light" : "dark";
              setTheme(next);
              setThemeState(next);
            }}
          >
            Theme: {theme}
          </button>
        </div>
      </header>
      <TreeSection still={still} />
    </main>
  );
}
