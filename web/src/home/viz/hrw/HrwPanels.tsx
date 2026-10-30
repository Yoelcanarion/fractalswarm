import { useCallback, useLayoutEffect, useMemo, useRef } from "react";
import type { HrwRound } from "../../data/types";
import { useProgress, type VizProps } from "../shared";
import "../viz.css";
import { Pen } from "../tree/paint";
import { digitsShown, groupHex, hrwState, rowsOf } from "./state";

export interface HrwPanelsProps extends VizProps {
  /** Which takeover of the run to show: 0 is the first, the root's. */
  round?: number;
}

interface RowRig {
  row: Pen<HTMLElement>;
  shown: Pen<HTMLElement>;
  rest: Pen<HTMLElement>;
  bar: Pen<HTMLElement>;
  hex: string;
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
    const shown = row.querySelector<HTMLElement>(".hv-hrw-shown");
    const rest = row.querySelector<HTMLElement>(".hv-hrw-rest");
    const bar = row.querySelector<HTMLElement>(".hv-hrw-bar");
    if (!score || !shown || !rest || !bar) continue;
    rows.push({ row: new Pen(row), shown: new Pen(shown), rest: new Pen(rest), bar: new Pen(bar), hex: score.score, fraction: score.fraction });
  }
  const pens = (selector: string): Pen<HTMLElement>[] => [...root.querySelectorAll<HTMLElement>(selector)].map((el) => new Pen(el));
  const verdict = root.querySelector<HTMLElement>(".hv-hrw-verdict");
  return { panels: pens("[data-panel]"), rows, agree: pens(".hv-hrw-agree"), verdict: verdict ? new Pen(verdict) : null };
}

export function HrwPanels({ progress, data, still, stillAt, className, round: index = 0 }: HrwPanelsProps) {
  const round = data.hrw.rounds[index];
  const root = useRef<HTMLDivElement>(null);
  const rig = useRef<Rig | null>(null);
  const rows = useMemo(() => (round ? rowsOf(round) : []), [round]);

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
      row.shown.text(groupHex(row.hex.slice(0, digits)));
      row.rest.text(groupHex(row.hex).slice(groupHex(row.hex.slice(0, digits)).length));
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
    <div ref={root} className={className ? `hv hv-hrw ${className}` : "hv hv-hrw"} role="img" aria-label={summary}>
      <div className="hv-hrw-head" aria-hidden="true">
        <span className="hv-hrw-goal">
          goal <b>{round.goal}</b>
        </span>
        <span className="hv-hrw-dead">
          <b>{round.previous}</b> is declared dead
        </span>
        <span className="hv-hrw-rule">{data.hrw.rule}</span>
      </div>
      <div className="hv-hrw-grid" aria-hidden="true">
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
                  <span className="hv-hrw-shown" />
                  <span className="hv-hrw-rest">{groupHex(r.score)}</span>
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
