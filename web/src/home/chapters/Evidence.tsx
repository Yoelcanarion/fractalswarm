import { useRef, type ReactNode } from "react";

import { COPY } from "../copy";
import { figure } from "../format";
import { useEnterProgress, useStill } from "../hooks";
import { assumptions, captionFor, failures, proofLines } from "../numbers";
import { ChapterHead, Setting } from "../parts/Chapter";
import { Claim, PendingTag } from "../parts/Claim";
import { Figure } from "../parts/Figure";
import { Reveal } from "../parts/Reveal";
import { Terminal } from "../parts/Terminal";
import type { StoryFigure } from "../storyTypes";
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

function Beat({ id, lead, children }: { id: string; lead: ReactNode; children: ReactNode }) {
  return (
    <article className="home-beat" aria-labelledby={`${id}-lead`}>
      <Reveal>
        <h3 id={`${id}-lead`} className="home-beat__lead">
          {lead}
        </h3>
      </Reveal>
      {children}
    </article>
  );
}

/** A chart of W7's that draws itself once, when it comes into view. */
function Chart({ name, path, duration, className = "" }: { name: VizName; path: string; duration: number; className?: string }) {
  const story = useStory();
  const still = useStill();
  const ref = useRef<HTMLDivElement>(null);
  const progress = useEnterProgress(ref, still, { duration });
  return (
    <div ref={ref} className={`home-chart ${className}`.trim()}>
      <Viz name={name} data={slice(story, path)} progress={progress} still={still} />
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
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={2}>
                  <PendingTag>NO DATA YET</PendingTag>
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr key={row.id}>
                  <th scope="row">{row.label}</th>
                  <td>{row.value}</td>
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
      <Chart name="LineDraw" path="hero" duration={2.2} className="home-chart--hero" />
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
  return (
    <Beat id="helps" lead={COPY.evidence.helps.lead}>
      <Reveal delay={60}>
        <Claim id="R4" className="home-claim--lead" />
      </Reveal>
      <Chart name="PairedBars" path="verdicts" duration={1.6} />
      <Setting>
        {captionFor(story, "headline")} {"·"} {COPY.evidence.helps.gate}
      </Setting>
    </Beat>
  );
}

function FailGroup({ title, figures, suffix = "" }: { title: string; figures: StoryFigure[] | undefined; suffix?: string }) {
  return (
    <div className="home-fail">
      <h4 className="home-fail__title">{title}</h4>
      <div className="home-figures">
        {figures?.length ? (
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
        <FailGroup title={COPY.evidence.fails.perProcess} figures={found.perProcess ? [found.perProcess] : undefined} />
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
  const story = useStory();
  return (
    <Beat id="proof" lead={COPY.evidence.proof.lead}>
      <Reveal delay={60}>
        <Claim id="S5" className="home-claim--lead" />
      </Reveal>
      <Chart name="HashStrip" path="hashes" duration={2.4} className="home-chart--strip" />
      <Reveal delay={60}>
        <Terminal command={COPY.evidence.proof.command} lines={proofLines(story)} label={COPY.evidence.proof.terminal} />
      </Reveal>
      <Reveal delay={100}>
        <p className="home-limit home-limit--wide">{COPY.evidence.proof.proves}</p>
      </Reveal>
    </Beat>
  );
}
