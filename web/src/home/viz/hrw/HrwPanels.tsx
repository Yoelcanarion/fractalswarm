import { useCallback, useLayoutEffect, useMemo, useRef } from "react";
import type { HrwRound, HrwSlice } from "../../data/types";
import { useBox } from "../charts/parts";
import { useProgress, type VizProps } from "../shared";
import "../viz.css";
import { Pen } from "../tree/paint";
import { HRW_DEFAULT_BOX, fitHrw } from "./fit";
import { digitsShown, groupHex, hiddenAt, hrwState, rowsOf } from "./state";

export interface HrwPanelsProps extends VizProps<HrwSlice> {
  /** Which takeover of the run to show: 0 is the first, the root's. */
  round?: number;
}

interface RowRig {
  row: Pen<HTMLElement>;
  digits: Pen<HTMLElement>;
  bar: Pen<HTMLElement>;
  /** The score is all in the markup and the digits are shown by clipping it: how much is still clipped, by count of digits shown. */
  hidden: number[];
  fraction: number;
}

interface Rig {
  panels: Pen<HTMLElement>[];
  rows: RowRig[];
  agree: Pen<HTMLElement>[];
  verdict: Pen<HTMLElement> | null;
}

function collect(root: HTMLElement, round: HrwRound): Rig {
  const rows: RowRig[] = [];
  const hexOf = new Map(round.scores.map((s) => [s.member, s]));
  for (const row of root.querySelectorAll<HTMLElement>("[data-row]")) {
    const score = hexOf.get(row.dataset["row"] ?? "");
    const digits = row.querySelector<HTMLElement>(".hv-hrw-digits");
    const bar = row.querySelector<HTMLElement>(".hv-hrw-bar");
    if (!score || !digits || !bar) continue;
    rows.push({ row: new Pen(row), digits: new Pen(digits), bar: new Pen(bar), hidden: hiddenAt(score.score), fraction: score.fraction });
  }
  const pens = (selector: string): Pen<HTMLElement>[] => [...root.querySelectorAll<HTMLElement>(selector)].map((el) => new Pen(el));
  const verdict = root.querySelector<HTMLElement>(".hv-hrw-verdict");
  return { panels: pens("[data-panel]"), rows, agree: pens(".hv-hrw-agree"), verdict: verdict ? new Pen(verdict) : null };
}

export function HrwPanels({ progress, data, still, stillAt, className, round: index = 0 }: HrwPanelsProps) {
  const round = data.rounds[index];
  const [root, box] = useBox(HRW_DEFAULT_BOX, 100);
  const rig = useRef<Rig | null>(null);
  const rows = useMemo(() => (round ? rowsOf(round) : []), [round]);
  const fit = useMemo(() => fitHrw(round?.survivors.length ?? 0, round?.pool.length ?? 0, box.width, box.height), [round, box]);

  useLayoutEffect(() => {
    rig.current = root.current && round ? collect(root.current, round) : null;
  }, [round]);

  const apply = useCallback((p: number) => {
    const r = rig.current;
    if (!r) return;
    const s = hrwState(p);
    for (const panel of r.panels) {
      panel.set("style", `opacity:${s.appear.toFixed(3)};transform:translateY(${((1 - s.appear) * 8).toFixed(2)}px)`);
    }
    const digits = digitsShown(s.compute);
    for (const row of r.rows) {
      row.digits.set("style", `clip-path:inset(0 ${row.hidden[digits] ?? 0}% 0 0)`);
      row.bar.set("style", `transform:scaleX(${(row.fraction * s.compute).toFixed(4)})`);
      row.row.set("data-pick", s.decide > 0.5 ? "true" : "false");
    }
    for (const a of r.agree) a.set("style", `opacity:${s.agree.toFixed(3)}`);
    r.verdict?.set("style", `opacity:${s.agree.toFixed(3)}`);
  }, []);
  useProgress(progress, apply, still, stillAt);

  if (!round) return null;
  const heir = round.heir ?? "";
  const summary =
    `${round.survivors.length} surviving orchestrators each compute the score of ${round.pool.length === 1 ? "the one candidate" : `the ${round.pool.length} candidates`} ` +
    `for the goal ${round.goal} from the same log: ` +
    `${round.scores.map((s) => `${s.member} ${s.score}`).join(", ")}. All of them pick ${heir}.`;

  return (
    <div ref={root} className={className ? `hv hv-hrw ${className}` : "hv hv-hrw"} data-tier={fit.tier} role="img" aria-label={summary}>
      <div className="hv-hrw-head" aria-hidden="true">
        <span className="hv-hrw-goal">
          goal <b>{round.goal}</b>
        </span>
        <span className="hv-hrw-dead">
          <b>{round.previous}</b> is declared dead
        </span>
        <span className="hv-hrw-rule">{data.rule}</span>
      </div>
      <div className="hv-hrw-grid" style={{ gridTemplateColumns: `repeat(${fit.cols}, minmax(0, 1fr))` }} aria-hidden="true">
        {round.survivors.map((survivor) => (
          <article key={survivor} className="hv-hrw-panel" data-panel={survivor} style={{ opacity: 0 }}>
            <header>
              <span className="hv-hrw-who">{survivor}</span>
              <span className="hv-hrw-reads">reads the log</span>
            </header>
            {rows.map((r) => (
              <div key={r.member} className="hv-hrw-row" data-row={r.member} data-win={r.win ? "true" : "false"} data-pick="false">
                <span className="hv-hrw-member">{r.member}</span>
                <span className="hv-hrw-hex">
                  <span className="hv-hrw-digits" style={{ clipPath: "inset(0 100% 0 0)" }}>
                    {groupHex(r.score)}
                  </span>
                </span>
                <span className="hv-hrw-track">
                  <i className="hv-hrw-bar" style={{ transform: "scaleX(0)" }} />
                </span>
              </div>
            ))}
            <footer className="hv-hrw-agree" style={{ opacity: 0 }}>
              heir <b>{heir}</b>
            </footer>
          </article>
        ))}
      </div>
      <p className="hv-hrw-verdict" aria-hidden="true" style={{ opacity: 0 }}>
        {round.survivors.length} of {round.survivors.length} pick <b>{heir}</b>.
      </p>
    </div>
  );
}
