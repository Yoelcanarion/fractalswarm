import { useRef, type ReactNode } from "react";

import { COPY, word } from "../copy";
import { figure, MISSING } from "../format";
import { useEnterProgress, useStill } from "../hooks";
import { assumptions, captionFor, failures, gateCrashes, proofSteps, realFalseDeaths, type FailureFigure } from "../numbers";
import { ChapterHead, Setting } from "../parts/Chapter";
import { Claim, PendingTag } from "../parts/Claim";
import { Figure } from "../parts/Figure";
import { Inline } from "../parts/Inline";
import { Reveal } from "../parts/Reveal";
import { Terminal } from "../parts/Terminal";
import { slice, useStory } from "../story";
import { Viz, type VizName } from "../visuals";

export function Evidence() {
  return (
    <section id="evidence" className="home-chapter" aria-labelledby="evidence-title">
      <div className="home-wrap">
        <ChapterHead id="evidence" number="04" eyebrow={COPY.evidence.eyebrow} title={COPY.evidence.title} />
        <FairFight />
        <HeroChart />
        <Tie />
        <Helps />
        <Fails />
        <Proof />
      </div>
    </section>
  );
}

/** One thing the evidence shows. Its id is an address: R6 in the hero links to the one named `tie`. */
function Beat({ id, lead, children }: { id: string; lead: ReactNode; children: ReactNode }) {
  return (
    <article id={id} className="home-beat" aria-labelledby={`${id}-lead`}>
      <Reveal>
        <h3 id={`${id}-lead`} className="home-beat__lead">
          {lead}
        </h3>
      </Reveal>
      {children}
    </article>
  );
}

/** A chart of W7's that draws itself once, when it comes into view. `path` names the slice of the story it draws. */
function Chart({
  name,
  path,
  duration,
  className = "",
  extra,
}: {
  name: VizName;
  path: string;
  duration: number;
  className?: string;
  /** Props of the visual itself, beyond its slice and progress. */
  extra?: Record<string, unknown>;
}) {
  const story = useStory();
  const still = useStill();
  const ref = useRef<HTMLDivElement>(null);
  const progress = useEnterProgress(ref, still, { duration });
  return (
    <div ref={ref} className={`home-chart ${className}`.trim()}>
      <Viz name={name} data={slice(story, path)} progress={progress} still={still} {...extra} />
    </div>
  );
}

function FairFight() {
  const rows = assumptions(useStory());
  return (
    <Beat id="fair" lead={COPY.evidence.fair.lead}>
      <Reveal delay={60} className="home-beat__why">
        <p>{COPY.evidence.fair.why}</p>
      </Reveal>
      <Reveal delay={120}>
        <table className="home-table">
          <thead>
            <tr>
              <th scope="col">{COPY.evidence.fair.columns.what}</th>
              <th scope="col">{COPY.evidence.fair.columns.value}</th>
              <th scope="col" className="home-table__why">
                {COPY.evidence.fair.columns.why}
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={3}>
                  <PendingTag>NO DATA YET</PendingTag>
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr key={row.id}>
                  <th scope="row">
                    <Inline text={row.label} />
                  </th>
                  <td>
                    <Inline text={row.value} />
                  </td>
                  <td className="home-table__why">
                    <Inline text={row.why} />
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </Reveal>
    </Beat>
  );
}

function HeroChart() {
  const story = useStory();
  return (
    <Beat id="hero-chart" lead={COPY.evidence.hero.lead}>
      {/* the chart prints its own setting by default; the page prints it once, in the same words as everywhere else */}
      <Chart name="LineDraw" path="hero" duration={2.2} className="home-chart--hero" extra={{ setting: false }} />
      <Setting>{captionFor(story, "hero")}</Setting>
    </Beat>
  );
}

function Tie() {
  const story = useStory();
  return (
    <Beat id="tie" lead={<span className="home-beat__tie">{COPY.evidence.tie.word}</span>}>
      <Reveal delay={60}>
        <Claim id="R2" className="home-claim--lead" />
        <Claim id="R3" className="home-claim--small" />
      </Reveal>
      <Chart name="DotPlot" path="headline" duration={1.8} />
      <Setting>
        {COPY.evidence.tie.note} {captionFor(story, "headline")}
      </Setting>
    </Beat>
  );
}

function Helps() {
  const story = useStory();
  const cost = realFalseDeaths(story);
  return (
    <Beat id="helps" lead={COPY.evidence.helps.lead}>
      <Reveal delay={60}>
        <Claim id="R4" className="home-claim--lead" />
      </Reveal>
      <Chart name="PairedBars" path="verdicts" duration={1.6} />
      <Setting>{captionFor(story, "headline")}</Setting>
      <Reveal delay={80} className="home-beat__why">
        <p>{COPY.evidence.helps.gate(gateCrashes(story).map(word).join(" and ") || MISSING)}</p>
      </Reveal>
      {cost && (
        <Reveal delay={100}>
          <p className="home-beat__verdict">{COPY.evidence.helps.cost}</p>
          <div className="home-figures">
            <Figure value={cost.perRun} format={(n) => figure(n, 1)} label={COPY.evidence.helps.perRun} tone="loss" size="stat" />
          </div>
        </Reveal>
      )}
    </Beat>
  );
}

function FailGroup({ title, figures, suffix = "" }: { title: string; figures: FailureFigure[]; suffix?: string }) {
  return (
    <div className="home-fail">
      <h4 className="home-fail__title">{title}</h4>
      <div className="home-figures">
        {figures.length ? (
          figures.map((item) => <Figure key={item.label} value={item.value} format={(n) => `${figure(n, item.decimals)}${suffix}`} label={item.label} tone="loss" size="stat" />)
        ) : (
          <PendingTag>NO DATA YET</PendingTag>
        )}
      </div>
    </div>
  );
}

function Fails() {
  const found = failures(useStory());
  return (
    <Beat id="fails" lead={COPY.evidence.fails.lead}>
      <Reveal delay={60}>
        <p className="home-beat__verdict">{COPY.evidence.fails.wins}</p>
      </Reveal>
      <Reveal delay={100} className="home-fails">
        <FailGroup title={COPY.evidence.fails.fast} figures={found.fastRestart} suffix={COPY.evidence.fails.times} />
        <FailGroup title={COPY.evidence.fails.falseDeaths} figures={found.falseDeaths} />
        <FailGroup title={COPY.evidence.fails.perProcess} figures={found.perProcess ? [found.perProcess] : []} />
        <div className="home-fail">
          <h4 className="home-fail__title">{COPY.evidence.fails.log}</h4>
          <Claim id="S6" className="home-claim--small" />
          <p className="home-limit">{COPY.solution.steps.log.limit}</p>
        </div>
      </Reveal>
      <Chart name="RegimeStrip" path="regime" duration={1.6} />
    </Beat>
  );
}

function Proof() {
  const steps = proofSteps(useStory());
  return (
    <Beat id="proof" lead={COPY.evidence.proof.lead}>
      <Reveal delay={60}>
        <Claim id="S5" className="home-claim--lead" />
      </Reveal>
      <Chart name="HashStrip" path="hashes" duration={2.4} className="home-chart--strip" />
      <Reveal delay={60}>
        <Terminal steps={steps} label={COPY.evidence.proof.terminal} />
      </Reveal>
      <Reveal delay={100}>
        <p className="home-limit home-limit--wide">{COPY.evidence.proof.proves}</p>
      </Reveal>
    </Beat>
  );
}
