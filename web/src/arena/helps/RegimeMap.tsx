import { useMemo } from "react";

import { Details, Tooltip } from "../../components/ui";
import { systemName } from "../assumptions";
import type { Honesty, Locality } from "./honesty";
import { fmt, LOCALITY_WORD } from "./labels";
import { Model } from "./Model";
import { localityLine, RATIO_NAMES, regimeRows, type MapCell } from "./regime";

/** A locality as a class suffix: "n/a" cannot be one. */
const slug = (locality: Locality): string => (locality === "n/a" ? "na" : locality);

/** The verdict of a point as a shape, so it never rests on colour alone: filled holds, hollow ties, a cross fails. */
export function Mark({ locality }: { locality: Locality }) {
  return (
    <svg className={`locality locality--${slug(locality)}`} viewBox="0 0 20 20" width="20" height="20" aria-hidden>
      {locality === "holds" && <circle cx="10" cy="10" r="7.5" />}
      {locality === "ties" && <circle cx="10" cy="10" r="6.5" />}
      {locality === "fails" && <path d="M4.5 4.5l11 11m0-11l-11 11" />}
      {locality === "n/a" && <path d="M5 10h10" />}
    </svg>
  );
}

const ratioText = (value: number | null): string => (value === null ? "—" : `${fmt(value)}×`);

/** Everything a cell knows, in words: its tooltip, and its name for a screen reader. */
function describe(cell: MapCell, rival: string): string {
  const { locality, ratios } = cell.point;
  const where = cell.sub ? `${cell.setting} (${cell.sub})` : cell.setting;
  const numbers = RATIO_NAMES.map(({ key, label }) => `${label} ${ratioText(ratios[key])}`).join(" · ");
  return `${where}: locality ${LOCALITY_WORD[locality]} against the ${systemName(rival)}. ${numbers}. Swarm over supervisor, seed means; 1 is equal.`;
}

function Cell({ cell, rival }: { cell: MapCell; rival: string }) {
  const text = describe(cell, rival);
  return (
    <li className={`rcell rcell--${slug(cell.point.locality)}${cell.decides ? " rcell--decides" : ""}`} aria-label={text}>
      <Tooltip label={text}>
        <span className="rcell__box">
          <span className="rcell__setting">{cell.setting}</span>
          <Mark locality={cell.point.locality} />
          <span className="rcell__num">{ratioText(cell.point.ratios.cdt)}</span>
          {cell.sub && <span className="rcell__sub">{cell.sub}</span>}
        </span>
      </Tooltip>
    </li>
  );
}

const LEGEND: { locality: Locality; word: string; text: string }[] = [
  { locality: "holds", word: "Holds", text: "Holds: dependency time and blast radius are wins, idle agent-seconds is not a loss" },
  { locality: "ties", word: "Ties", text: "Ties: anything else" },
  { locality: "fails", word: "Fails", text: "Fails: a loss on dependency time or blast radius" },
];

export interface RegimeMapProps {
  honesty: Honesty;
  /** The rival the map is read against. */
  rival: string;
}

/** Where the swarm's recovery stays local against a rival. One assumption changes along each row. */
export function RegimeMap({ honesty, rival }: RegimeMapProps) {
  const rows = useMemo(() => regimeRows(honesty, rival), [honesty, rival]);
  const cut = honesty.rules.ratio.cdt_s?.ratio;
  const localities = honesty.localityByRival[rival];
  return (
    <section className="map" data-helps="map" aria-label="Regime map">
      <header className="helps__section-head">
        <div className="helps__h-row">
          <h3 className="helps__h">Regime map</h3>
          <Model kind="crash" />
        </div>
        <p className="helps__sub">
          Against the {systemName(rival)}: {localities ? `${localityLine(localities)}.` : "at each setting the swarm's recovery stays local (holds), ties or fails."} One assumption changes along each row.
        </p>
      </header>
      {rows.length === 0 ? (
        <p className="helps__none">The bench ran no settings against the {systemName(rival)}.</p>
      ) : (
        <div className="map__rows">
          {rows.map((row) => (
            <div className="map__row" key={row.id} data-helps={`row:${row.id}`}>
              <div className="map__head">
                <span className="map__title">{row.title}</span>
                <span className="map__model">
                  <Model kind="crash" text={row.model} />
                </span>
              </div>
              <ul className="map__cells">
                {row.cells.map((cell) => (
                  <Cell key={cell.key} cell={cell} rival={rival} />
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
      <ul className="map__legend" aria-label="Key">
        {LEGEND.map(({ locality, word }) => (
          <li key={locality}>
            <Mark locality={locality} />
            <span>{word}</span>
          </li>
        ))}
      </ul>
      <Details inline summary="How to read the map">
        <ul className="map__legend" aria-label="How to read the map">
          {LEGEND.map(({ locality, text }) => (
            <li key={locality}>
              <Mark locality={locality} />
              <span>{text}</span>
            </li>
          ))}
          <li>
            <span className="map__swatch map__swatch--decides" aria-hidden />
            <span>Heavy outline: decides the outcome (the default settings and the plausible region, fixed before any result). The rest are conditions.</span>
          </li>
          <li>
            <span className="map__num" aria-hidden>
              N×
            </span>
            <span>
              Coordinator-dependency time, swarm over supervisor, mean of the seeds.
              {cut !== undefined && ` A win needs every seed to reach ${fmt(cut)}× or lower, so a mean under ${fmt(cut)}× can still tie.`}
            </span>
          </li>
        </ul>
        <dl className="map__terms">
          {rows.map((row) => (
            <div key={row.id}>
              <dt>{row.title}</dt>
              <dd>{row.detail}</dd>
            </div>
          ))}
        </dl>
      </Details>
    </section>
  );
}
