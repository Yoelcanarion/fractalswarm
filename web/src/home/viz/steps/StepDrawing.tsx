import type { Story } from "../../data/types";
import { useStory } from "../../story";
import { useCalm } from "../page";
import "../viz.css";

export type StepId = "log" | "heir" | "adopt";

export const STEP_IDS: readonly StepId[] = ["log", "heir", "adopt"];

export const STEP_LABELS: Record<StepId, string> = {
  log: "Every actor writes what it does to one shared log",
  heir: "Every survivor reads the log and works out the same heir, from one rule",
  adopt: "The orphans of the dead coordinator hang from the heir, and work goes on",
};

export interface StepDrawingProps {
  step: StepId;
  /** Hover, focus or a tap on the card: the drawing plays to its end in under a second, and eases back when it is left. */
  active: boolean;
  /** The score of each candidate as a share of the range, best first; the recorded run's first round when absent. */
  scores?: number[];
  /** Standing still, which the page says through its own context when this is absent: the drawing in its end state, whatever the card is doing. */
  still?: boolean | undefined;
  className?: string;
}

const ROWS = [0, 1, 2, 3, 4];

/** The recorded run's first round, which is the one the page tells: the pool's scores, best first. */
function recordedScores(story: Story | null): number[] {
  return (story?.hrw.rounds[0]?.scores ?? []).map((s) => s.fraction);
}

function Log() {
  return (
    <>
      {[0, 1, 2].map((i) => (
        <g key={i}>
          <circle className="hv-st-node" cx="26" cy={26 + i * 34} r="8" />
          <path className="hv-st-draw" data-part style={{ ["--i" as string]: i }} pathLength={1} d={`M38 ${26 + i * 34}H106`} />
        </g>
      ))}
      <line className="hv-st-chain" data-part x1="112" x2="112" y1="14" y2="106" />
      {ROWS.map((i) => (
        <g key={i} className="hv-st-row" data-part style={{ ["--i" as string]: i }}>
          <rect className="hv-st-slot" x="120" y={14 + i * 21} width="104" height="12" rx="3" />
          <line className="hv-st-ink" x1="126" x2={126 + 40 + ((i * 23) % 44)} y1={20 + i * 21} y2={20 + i * 21} />
        </g>
      ))}
    </>
  );
}

function Heir({ scores }: { scores: number[] }) {
  const shown = scores.length > 0 ? scores.slice(0, 3) : [0.9, 0.25, 0.24];
  const best = shown.indexOf(Math.max(...shown));
  return (
    <>
      {shown.map((share, i) => (
        <g key={i}>
          <circle className="hv-st-node" cx="28" cy={24 + i * 36} r="9" />
          <rect className="hv-st-track" x="52" y={21 + i * 36} width="164" height="6" rx="3" />
          <rect className="hv-st-bar" data-part style={{ ["--i" as string]: i, ["--w" as string]: share.toFixed(3) }} x="52" y={21 + i * 36} width="164" height="6" rx="3" />
        </g>
      ))}
      <circle className="hv-st-heir" data-part style={{ ["--i" as string]: 4 }} cx="28" cy={24 + best * 36} r="15" />
    </>
  );
}

function Adopt() {
  const kids = [34, 72, 110];
  return (
    <>
      {kids.map((x, i) => (
        <path key={`old-${x}`} className="hv-st-old" data-part style={{ ["--i" as string]: i }} d={`M40 38C40 62 ${x} 62 ${x} 88`} />
      ))}
      {kids.map((x, i) => (
        <path key={`new-${x}`} className="hv-st-new" data-part style={{ ["--i" as string]: i + 2 }} pathLength={1} d={`M196 38C196 62 ${x} 62 ${x} 88`} />
      ))}
      <circle className="hv-st-node hv-st-node--dead" cx="40" cy="28" r="10" />
      <path className="hv-st-cross" d="M35 23L45 33M45 23L35 33" />
      <circle className="hv-st-node hv-st-node--heir" cx="196" cy="28" r="10" />
      {kids.map((x) => (
        <rect key={x} className="hv-st-leaf" x={x - 7} y="88" width="14" height="14" rx="3" />
      ))}
    </>
  );
}

/**
 * The drawing on one of the Solution's three cards. It is the same picture at rest and when played, drawn with CSS only: each part
 * has a transition in the page's one ease, their delays spread evenly across it so that they land one after another and the whole
 * takes about nine tenths of a second; leaving the card eases it back from wherever it has got to, and never snaps.
 */
export function StepDrawing({ step, active, scores, still, className }: StepDrawingProps) {
  const story = useStory();
  const on = useCalm(still) || active;
  return (
    <svg
      className={className ? `hv hv-step ${className}` : "hv hv-step"}
      viewBox="0 0 240 120"
      role="img"
      aria-label={STEP_LABELS[step]}
      data-step={step}
      data-on={on ? "true" : "false"}
    >
      {step === "log" && <Log />}
      {step === "heir" && <Heir scores={scores ?? recordedScores(story)} />}
      {step === "adopt" && <Adopt />}
    </svg>
  );
}
