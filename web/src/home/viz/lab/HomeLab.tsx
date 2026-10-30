import { useMotionValue, type MotionValue } from "motion/react";
import { useEffect, useState, type ReactNode } from "react";
import { currentTheme, setTheme } from "../../../lib/theme";
import { story } from "../../data/story";
import { DotPlot } from "../charts/DotPlot";
import { LineDraw } from "../charts/LineDraw";
import { PairedBars } from "../charts/PairedBars";
import { RegimeStrip } from "../charts/RegimeStrip";
import { TokenBar } from "../charts/TokenBar";
import { DOOR_IDS } from "../doors/doors";
import { DoorGlyph } from "../doors/DoorGlyph";
import { HashStrip } from "../hash/HashStrip";
import { HrwPanels } from "../hrw/HrwPanels";
import { WorkLanes } from "../lanes/WorkLanes";
import { CountUp } from "../parts/CountUp";
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

const WIDTHS: [string, string][] = [
  ["the page's width", "100%"],
  ["1224 px (a laptop)", "1224px"],
  ["820 px (a tablet)", "820px"],
  ["390 px (a phone)", "390px"],
];
const HEIGHTS = [280, 353, 388, 460, 520];

/** A visual in a frame of a size the person picks, as the page frames it, with the progress slider under it. */
function FrameSection({
  id,
  title,
  note,
  seconds,
  height,
  heights = HEIGHTS,
  controls,
  children,
}: {
  id: string;
  title: string;
  note: string;
  seconds: number;
  height: number;
  heights?: number[];
  controls?: ReactNode;
  children: (progress: MotionValue<number>) => ReactNode;
}) {
  const progress = useMotionValue(0);
  const [width, setWidth] = useState("100%");
  const [h, setH] = useState(height);
  const options = [...new Set([...heights, height])].sort((a, b) => a - b);
  return (
    <Section id={id} title={title} note={note}>
      <div className="lab-controls">
        <label>
          frame width
          <select value={width} onChange={(e) => setWidth(e.target.value)}>
            {WIDTHS.map(([label, value]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label>
          frame height
          <select value={h} onChange={(e) => setH(Number(e.target.value))}>
            {options.map((value) => (
              <option key={value} value={value}>
                {value} px
              </option>
            ))}
          </select>
        </label>
        {controls}
      </div>
      <div className="lab-stage">
        <div className="lab-frame" style={{ width, maxWidth: "100%", height: h }}>
          {children(progress)}
        </div>
      </div>
      <Scrubber progress={progress} seconds={seconds} />
    </Section>
  );
}

const NONE = <p className="lab-note">The data file has no rows for this visual yet, and the visual is not drawn without them.</p>;

function LanesSection({ still }: { still: boolean }) {
  const [which, setWhich] = useState<"central" | "swarm">("central");
  return (
    <FrameSection
      id="lanes"
      title="WorkLanes"
      note="The lanes of a recorded run: the in-process supervisor's run of the benchmark, or the swarm's recorded demo."
      seconds={18}
      height={420}
      controls={
        <label>
          run
          <select value={which} onChange={(e) => setWhich(e.target.value as "central" | "swarm")}>
            <option value="central">in-process supervisor (benchmark run)</option>
            <option value="swarm">swarm (recorded demo)</option>
          </select>
        </label>
      }
    >
      {(progress) => <WorkLanes progress={progress} data={story.lanes[which]} still={still} />}
    </FrameSection>
  );
}

function HrwSection({ still }: { still: boolean }) {
  const [round, setRound] = useState(0);
  return (
    <FrameSection
      id="hrw"
      title="HrwPanels"
      note="The survivors' panels of one takeover: each scores the candidates with the same hash and picks the same one."
      seconds={10}
      height={388}
      controls={
        <label>
          takeover
          <select value={round} onChange={(e) => setRound(Number(e.target.value))}>
            {story.hrw.rounds.map((_, i) => (
              <option key={i} value={i}>
                {i + 1} of {story.hrw.rounds.length}
              </option>
            ))}
          </select>
        </label>
      }
    >
      {(progress) => <HrwPanels progress={progress} data={story.hrw} round={round} still={still} />}
    </FrameSection>
  );
}

function HashSection({ still }: { still: boolean }) {
  return (
    <FrameSection id="hash" title="HashStrip" note="The hash chain of the recorded run's log." seconds={8} height={160} heights={[120, 160, 200]}>
      {(progress) => <HashStrip progress={progress} data={story.hashes} still={still} />}
    </FrameSection>
  );
}

function HeroSection({ still, setting }: { still: boolean; setting: boolean }) {
  return (
    <FrameSection
      id="hero"
      title="LineDraw"
      note={`The hero chart: stall time and extra cost against the coordinators killed, from ${story.hero.source}.`}
      seconds={6}
      height={520}
    >
      {(progress) => <LineDraw progress={progress} data={story.hero} still={still} setting={setting} />}
    </FrameSection>
  );
}

function DotsSection({ still, setting }: { still: boolean; setting: boolean }) {
  return (
    <FrameSection id="dots" title="DotPlot" note="One dot for each run: stall time and extra cost, three seeds, the swarm beside the rivals." seconds={5} height={460}>
      {(progress) => (story.headline ? <DotPlot progress={progress} data={story.headline} still={still} setting={setting} /> : NONE)}
    </FrameSection>
  );
}

function PairsSection({ still, setting }: { still: boolean; setting: boolean }) {
  const [rival, setRival] = useState("durable-max");
  return (
    <FrameSection
      id="pairs"
      title="PairedBars"
      note="Locality, the swarm's bar against the rival's, with the line the pre-registered rule draws at half."
      seconds={5}
      height={420}
      controls={
        <label>
          against
          <select value={rival} onChange={(e) => setRival(e.target.value)}>
            <option value="durable-max">ideal durable supervisor</option>
            <option value="durable">realistic durable supervisor</option>
          </select>
        </label>
      }
    >
      {(progress) => (story.verdicts ? <PairedBars progress={progress} data={story.verdicts} rival={rival} still={still} setting={setting} /> : NONE)}
    </FrameSection>
  );
}

function RegimeSection({ still, setting }: { still: boolean; setting: boolean }) {
  return (
    <FrameSection id="regime" title="RegimeStrip" note="Where locality holds, ties or fails, a strip for each assumption the rival was granted." seconds={5} height={353}>
      {(progress) => <RegimeStrip progress={progress} data={story.regime} still={still} setting={setting} />}
    </FrameSection>
  );
}

function TokensSection({ still }: { still: boolean }) {
  return (
    <FrameSection id="tokens" title="TokenBar" note="The recorded run's tokens by model, in the 56 px the page gives it." seconds={4} height={56} heights={[40, 56, 80]}>
      {(progress) => <TokenBar progress={progress} data={story.tokensByModel} still={still} />}
    </FrameSection>
  );
}

function DoorsSection({ still }: { still: boolean }) {
  const progress = useMotionValue(0);
  return (
    <Section id="doors" title="DoorGlyph" note="The six doors, driven together: 0 is the picture at rest, 1 the one a visitor who asked for less motion gets.">
      <div className="lab-doors">
        {DOOR_IDS.map((id) => (
          <div key={id} className="lab-door">
            <div className="lab-door__glyph">
              <DoorGlyph progress={progress} data={id} still={still} />
            </div>
            <code>{id}</code>
          </div>
        ))}
      </div>
      <Scrubber progress={progress} seconds={2.4} />
    </Section>
  );
}

function CountSection({ still }: { still: boolean }) {
  const progress = useMotionValue(0);
  const { r2 } = story.numbers;
  const tokens = story.tokensByModel.models.reduce((sum, m) => sum + m.inputTokens + m.outputTokens, 0);
  const counts = [
    { label: "swarm stall", data: { value: r2.swarmStallS, decimals: 1, suffix: " s" } },
    { label: "ideal durable stall", data: { value: r2.durableMaxStallS, decimals: 1, suffix: " s" } },
    { label: "swarm extra cost", data: { value: r2.swarmExtraPct, decimals: 1, suffix: "%" } },
    { label: "ideal durable extra cost", data: { value: r2.durableMaxExtraPct, decimals: 1, prefix: "+", suffix: "%" } },
    { label: "tokens in the recorded run", data: { value: tokens } },
  ];
  return (
    <Section id="count" title="CountUp" note="A number that counts once to the number it is: tabular, the end number's width kept, nothing around it moves.">
      <div className="lab-counts">
        {counts.map((c) => (
          <div key={c.label} className="lab-count">
            <CountUp progress={progress} data={c.data} still={still} className="lab-count__number" />
            <span>{c.label}</span>
          </div>
        ))}
      </div>
      <Scrubber progress={progress} seconds={2} />
    </Section>
  );
}

export function HomeLab() {
  const [still, setStill] = useState(false);
  const [setting, setSetting] = useState(true);
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
          <label>
            <input type="checkbox" checked={setting} onChange={(e) => setSetting(e.target.checked)} /> print each chart's setting (the page may print it itself)
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
      <LanesSection still={still} />
      <HrwSection still={still} />
      <HashSection still={still} />
      <HeroSection still={still} setting={setting} />
      <DotsSection still={still} setting={setting} />
      <PairsSection still={still} setting={setting} />
      <RegimeSection still={still} setting={setting} />
      <TokensSection still={still} />
      <DoorsSection still={still} />
      <CountSection still={still} />
    </main>
  );
}
