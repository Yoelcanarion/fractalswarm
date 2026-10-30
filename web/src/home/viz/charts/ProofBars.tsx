import { useMemo } from "react";
import { prefersReducedMotion } from "../../../lib/motion";
import { story } from "../../data/story";
import type { Story } from "../../data/types";
import { SECONDS } from "../ease";
import { GrowNumber } from "../parts/GrowNumber";
import "../viz.css";
import { barShare, proofPanels, proofText, type ProofRow } from "./proof";

export interface ProofBarsProps {
  /** 0 is not yet (the bars are at nothing); each increment grows them again, by themselves, from nothing. */
  play: number;
  /** The home data to draw; the recorded runs' own when absent. */
  data?: Pick<Story, "numbers" | "verdicts" | "workflows">;
  /** A still page, or a person who asked for less motion: the bars as long as they are, at once. */
  still?: boolean;
  className?: string;
}

/** Bars start this many seconds apart and end together, so no two land at once and nothing waits for the others. */
const STEP = 0.06;

const valueText = (row: ProofRow, who: "swarm" | "rival"): string => proofText(who === "swarm" ? row.swarm : row.rival, row.unit);

/**
 * The swarm against each rival on the same task, one panel for each: a bar and a number for both, the setting beside them and, where
 * the data has a verdict, the verdict as it is. The bars and numbers grow once, by themselves, together: one eased motion each,
 * 1.2 to 1.6 seconds, in the page's one ease.
 */
export function ProofBars({ play, data, still = false, className }: ProofBarsProps) {
  const panels = useMemo(() => proofPanels(data ?? story), [data]);
  const calm = still || prefersReducedMotion();
  const swarm = (data ?? story).workflows["swarm"] ?? "swarm";
  let line = 0;
  return (
    <div className={className ? `hv-proof ${className}` : "hv-proof"}>
      {panels.map((panel) => (
        <section key={`${panel.id}:${play}`} className="hv-proof-panel" data-play={calm ? "still" : play > 0 ? "on" : "off"} aria-label={`The swarm against the ${panel.rival.toLowerCase()}`}>
          <header className="hv-proof-head">
            <h3>{panel.rival}</h3>
            <p>{panel.setting}</p>
          </header>
          {panel.rows.map((row) => {
            const drawn = row.swarm >= 0 && row.rival >= 0;
            return (
              <div key={row.id} className="hv-proof-row">
                <p className="hv-proof-label">
                  {row.label}
                  {row.verdict && <span className="hv-proof-verdict">{row.verdict}</span>}
                </p>
                {(["swarm", "rival"] as const).map((who) => {
                  const i = line++;
                  const value = who === "swarm" ? row.swarm : row.rival;
                  const share = drawn ? barShare(value, who === "swarm" ? row.rival : row.swarm) : 0;
                  return (
                    <div key={who} className="hv-proof-line" data-who={who}>
                      <span className="hv-proof-name">{who === "swarm" ? swarm : panel.rival}</span>
                      <span className="hv-proof-track" aria-hidden>
                        {drawn && <span className="hv-proof-bar" style={{ ["--w" as string]: share.toFixed(4), ["--i" as string]: i }} />}
                      </span>
                      <GrowNumber
                        className="hv-proof-number"
                        value={value}
                        format={(v) => proofText(v, row.unit)}
                        play={play}
                        delay={i * STEP}
                        seconds={SECONDS.grow - i * STEP}
                        still={still}
                      />
                    </div>
                  );
                })}
                <span className="hv-sr">{`${swarm} ${valueText(row, "swarm")}, ${panel.rival} ${valueText(row, "rival")}.`}</span>
              </div>
            );
          })}
        </section>
      ))}
    </div>
  );
}
