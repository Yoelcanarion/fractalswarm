import { useMemo } from "react";

import { systemName } from "../assumptions";
import type { Honesty, Tally } from "./honesty";
import { countText, fmt, rivalLabel, taskName } from "./labels";
import { Model } from "./Model";
import { comparisonLines, falseDeathNote, tallyRows, type TallyCell, type Which } from "./tally";

/** A cell of the table that is open: the results it counts, listed. */
export interface OpenList {
  hypothesis: string;
  rival: string;
  which: Which;
}

const WORDS: Record<Which, { one: string; many: string; title: string }> = {
  win: { one: "win", many: "wins", title: "Where the swarm won" },
  tie: { one: "tie", many: "ties", title: "Where it tied" },
  loss: { one: "loss", many: "losses", title: "Where the swarm lost" },
  na: { one: "result not scored", many: "results not scored", title: "Not scored" },
};

const SEGMENTS: Which[] = ["win", "tie", "loss"];

const sameList = (a: OpenList | null, b: OpenList): boolean => a !== null && a.hypothesis === b.hypothesis && a.rival === b.rival && a.which === b.which;

interface CountsProps {
  cell: TallyCell;
  hypothesis: string;
  name: string;
  open: OpenList | null;
  onOpen: (list: OpenList | null) => void;
}

/** One rival's cell of one row: the three counts, each a button that lists those results, over a bar to scale. */
function Counts({ cell, hypothesis, name, open, onOpen }: CountsProps) {
  const t: Tally = cell.tally;
  return (
    <div className="tcell">
      <div className="tcell__bar" aria-hidden>
        {SEGMENTS.map((which) => (
          <i key={which} className={`seg seg--${which}`} style={{ flexGrow: t[which] }} />
        ))}
      </div>
      <div className="tcell__counts">
        {SEGMENTS.map((which) => {
          const n = t[which];
          const list: OpenList = { hypothesis, rival: cell.rival, which };
          const word = WORDS[which];
          return (
            <button
              key={which}
              type="button"
              className={`count count--${which}`}
              disabled={n === 0}
              aria-pressed={sameList(open, list)}
              aria-label={`${hypothesis} ${name} against the ${systemName(cell.rival)}: ${countText(n, word.one, word.many)}${n > 0 ? ", list them" : ""}`}
              onClick={() => onOpen(sameList(open, list) ? null : list)}
            >
              {n}
            </button>
          );
        })}
        {t.na > 0 && (
          <button
            type="button"
            className="count count--na"
            aria-pressed={sameList(open, { hypothesis, rival: cell.rival, which: "na" })}
            aria-label={`${hypothesis} ${name} against the ${systemName(cell.rival)}: ${countText(t.na, WORDS.na.one, WORDS.na.many)}, list them`}
            onClick={() => onOpen(sameList(open, { hypothesis, rival: cell.rival, which: "na" }) ? null : { hypothesis, rival: cell.rival, which: "na" })}
          >
            {t.na} n/a
          </button>
        )}
      </div>
    </div>
  );
}

export interface TallyTableProps {
  honesty: Honesty;
  rivals: readonly string[];
  /** The rival the outcome is read against: its column is marked. */
  against: string;
  open: OpenList | null;
  onOpen: (list: OpenList | null) => void;
}

/** The swarm's wins, ties and losses against each rival, per hypothesis, with every list of results one click away. */
export function TallyTable({ honesty, rivals, against, open, onOpen }: TallyTableProps) {
  const rows = useMemo(() => tallyRows(honesty, rivals), [honesty, rivals]);
  const deaths = useMemo(() => falseDeathNote(honesty), [honesty]);
  const heads = (
    <>
      <th scope="col" className="tally__row-head">
        Hypothesis
      </th>
      {rivals.map((rival) => (
        <th scope="col" key={rival} className={rival === against ? "tally__col tally__col--against" : "tally__col"}>
          <span className="tally__rival">{rivalLabel(rival)}</span>
          <span className="tally__order">wins · ties · losses</span>
        </th>
      ))}
    </>
  );
  return (
    <section className="tally" data-helps="table" aria-label="Wins, ties and losses">
      <header className="helps__section-head">
        <div className="helps__h-row">
          <h3 className="helps__h">Wins, ties and losses</h3>
          <Model kind="crash" />
        </div>
        <p className="helps__sub">
          Swarm against each rival, one comparison per setting. A win needs every seed to agree; anything less is a tie. Click a number to list its settings.
        </p>
      </header>
      <table className="tally__table">
        <thead>
          <tr>{heads}</tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className={row.reported ? "tally__row tally__row--reported" : "tally__row"}>
              <th scope="row" className="tally__row-head">
                <span className="tally__name">
                  <b>{row.id}</b> {row.name}
                </span>
                {row.expected && <span className="tally__expected">Expected: {row.expected}</span>}
                <span className="tally__model">
                  <Model kind="crash" />
                </span>
              </th>
              {row.cells.map((cell) => (
                <td key={cell.rival} className={cell.rival === against ? "tally__col--against" : undefined}>
                  <Counts cell={cell} hypothesis={row.id} name={row.name} open={open} onOpen={onOpen} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {open && <ComparisonList honesty={honesty} open={open} onClose={() => onOpen(null)} />}
      {deaths && (
        <p className="tally__note">
          About H5: the swarm's detector can declare a live coordinator dead (a false death), so its work is re-owned and the duplicate paid for. At the gate on {taskName(deaths.task)} ({deaths.profile}) it
          did so {fmt(deaths.swarm.mean)} times per run on average, {deaths.swarm.max} at most
          {deaths.rival && (
            <>
              ; the {systemName(deaths.rival.id)}, which has no detector, did so {fmt(deaths.rival.mean)} times
            </>
          )}
          .
        </p>
      )}
    </section>
  );
}

function ComparisonList({ honesty, open, onClose }: { honesty: Honesty; open: OpenList; onClose: () => void }) {
  const lines = useMemo(() => comparisonLines(honesty, open.hypothesis, open.rival, open.which), [honesty, open]);
  const hypothesis = honesty.hypotheses.find((h) => h.id === open.hypothesis);
  // the count is the file's own, the one on the button that opened the list
  const count = hypothesis?.tally[open.rival]?.[open.which] ?? 0;
  const words = WORDS[open.which];
  return (
    <div className={`list list--${open.which}`} role="region" aria-live="polite" aria-label={`${words.title}: ${open.hypothesis} against the ${systemName(open.rival)}`}>
      <header className="list__head">
        <span className="list__title">
          {words.title}: <b>{open.hypothesis}</b> {hypothesis?.name} against the {systemName(open.rival)}
          <span className="list__count"> ({count})</span>
        </span>
        <button type="button" className="list__close" onClick={onClose}>
          Close
        </button>
      </header>
      <div className="list__scroll">
      <table className="list__table">
        <thead>
          <tr>
            <th scope="col">Setting</th>
            <th scope="col">Task · profile</th>
            <th scope="col" className="num">
              Swarm
            </th>
            <th scope="col" className="num">
              {rivalLabel(open.rival)}
            </th>
          </tr>
        </thead>
        <tbody>
          {lines.map((line) => (
            <tr key={line.key}>
              <th scope="row">{line.where}</th>
              <td>
                {line.context}
                {line.mixed && <span className="list__mixed"> · seeds disagree</span>}
              </td>
              <td className="num">{line.swarm}</td>
              <td className="num">{line.rival}</td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>
    </div>
  );
}
