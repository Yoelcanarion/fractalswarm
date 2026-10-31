import { ArrowRight } from "lucide-react";
import { useRef, useState, type ReactNode } from "react";

import { COPY, word } from "../copy";
import { count, figure, MISSING, usd } from "../format";
import { useEnterProgress, useStill } from "../hooks";
import { assumptions, captionFor, failures, finish, gateCrashes, limits, proofSteps, realFalseDeaths, runSetting, settingText, type FailureFigure } from "../numbers";
import { SectionHead, Setting } from "../parts/Chapter";
import { Claim, PendingTag } from "../parts/Claim";
import { Figure } from "../parts/Figure";
import { Inline } from "../parts/Inline";
import { Reveal } from "../parts/Reveal";
import { Terminal } from "../parts/Terminal";
import { evidenceHash } from "../route";
import { slice, useStory } from "../story";
import { Viz, type VizName } from "../visuals";

export function Evidence() {
  return (
    <section id="evidence" className="home-chapter" aria-labelledby="evidence-title">
      <div className="home-wrap">
        {/* the title and the run it opens on share one row: the title alone leaves half the page empty beside it */}
        <div className="home-evidence__open">
          <SectionHead id="evidence" title={COPY.evidence.title} />
          <Finished />
        </div>
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

/** How a beat sits on a wide screen. `split`: the words (`text`, under the lead) stand beside what they speak of
 * (`children`). `over`: the lead, the text and an `aside` make one row over the children, which keep the whole width (a chart
 * that is drawn for that width). `wide`: one column, for a chart or a row of figures that wants the whole width.
 * On a narrow screen all of them are one column, in the order lead, text, aside, children, foot. */
type Layout = "split" | "over" | "wide";

/** One thing the evidence shows. Its id is an address: R6 in the hero links to the one named `tie`. `foot` is what follows from it,
 * in a row of its own under both columns, for words that would leave the short column empty beside them. */
function Beat({
  id,
  lead,
  text,
  aside,
  layout = "split",
  foot,
  children,
}: {
  id: string;
  lead: ReactNode;
  text?: ReactNode;
  aside?: ReactNode;
  layout?: Layout;
  foot?: ReactNode;
  children: ReactNode;
}) {
  return (
    <article id={id} className={`home-beat home-beat--${layout}`} aria-labelledby={`${id}-lead`}>
      <div className="home-beat__text">
        <Reveal>
          <h3 id={`${id}-lead`} className="home-beat__lead">
            {lead}
          </h3>
        </Reveal>
        {text}
      </div>
      {aside && <div className="home-beat__aside">{aside}</div>}
      <div className="home-beat__body">{children}</div>
      {foot && <div className="home-beat__foot">{foot}</div>}
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

/** The recorded run that the home page replays: what it placed, what it cost, and S2 beside it. */
function Finished() {
  const story = useStory();
  const result = finish(story);
  return (
    <Beat id="run" lead={COPY.evidence.proof.finished} layout="wide">
      <div className="home-figures">
        <Figure value={result?.talksPlaced} format={count} label={COPY.evidence.finish.placed} tone="swarm" size="stat" />
        <Figure value={result?.hardViolations} format={count} label={COPY.evidence.finish.violations} tone="ok" size="stat" />
        <Figure value={result?.duplicateCalls} format={count} label={COPY.evidence.finish.duplicates} tone="plain" size="stat" />
        <Figure value={result?.costUsd} format={(n) => usd(n)} label={COPY.evidence.finish.cost} tone="plain" size="stat" />
      </div>
      <Setting>{settingText(story, runSetting(story))}</Setting>
      <Claim id="S2" className="home-claim--small" />
    </Beat>
  );
}

/** The terms of the rival that are shown with the argument; the rest are in the page too, behind the control under them. */
const TERMS_SHOWN = 4;
const TERMS_ID = "fair-terms";

function FairFight() {
  const rows = assumptions(useStory());
  const [open, setOpen] = useState(false);
  return (
    <Beat
      id="fair"
      lead={COPY.evidence.fair.lead}
      text={
        <Reveal delay={60} className="home-beat__why">
          <p>{COPY.evidence.fair.why}</p>
        </Reveal>
      }
    >
      <Reveal delay={120}>
        <table id={TERMS_ID} className="home-table">
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
              rows.map((row, index) => (
                <tr key={row.id} hidden={!open && index >= TERMS_SHOWN}>
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
        {rows.length > TERMS_SHOWN && (
          <button type="button" className="home-more" aria-expanded={open} aria-controls={TERMS_ID} onClick={() => setOpen((was) => !was)}>
            <span>{open ? COPY.evidence.fair.showFewer : COPY.evidence.fair.showAll(rows.length)}</span>
            <svg className="home-more__chevron" width="14" height="14" viewBox="0 0 14 14" aria-hidden="true" focusable="false">
              <path d="M3 5.5 7 9.5 11 5.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        )}
      </Reveal>
    </Beat>
  );
}

function HeroChart() {
  const story = useStory();
  return (
    <Beat id="hero-chart" lead={COPY.evidence.hero.lead} layout="wide">
      {/* the chart prints its own setting by default; the page prints it once, in the same words as everywhere else */}
      <Chart name="LineDraw" path="hero" duration={2.2} className="home-chart--hero" extra={{ setting: false }} />
      {/* its extra cost is on R5's pre-registered basis, and R5 names both bases: it stands here with its setting and its reason */}
      <Setting>
        {captionFor(story, "hero")} {"·"} {COPY.rivalReason}
      </Setting>
      <Claim id="R5" className="home-claim--small" />
    </Beat>
  );
}

function Tie() {
  const story = useStory();
  return (
    <Beat
      id="tie"
      lead={<span className="home-beat__tie">{COPY.evidence.tie.word}</span>}
      layout="over"
      text={
        <Reveal delay={60}>
          <Claim id="R2" className="home-claim--lead" />
        </Reveal>
      }
      aside={
        <>
          <Reveal delay={100}>
            <Claim id="R3" className="home-claim--small" />
          </Reveal>
          <Reveal delay={110}>
            <p className="home-limit">{COPY.evidence.tie.terms}</p>
          </Reveal>
          <Reveal delay={120}>
            <a className="home-link" href={evidenceHash("fails")}>
              {COPY.evidence.tie.worse}
              <ArrowRight size={14} aria-hidden />
            </a>
          </Reveal>
        </>
      }
    >
      <Chart name="DotPlot" path="headline" duration={1.8} extra={{ setting: false }} />
      <Setting>
        {COPY.evidence.tie.note} {COPY.evidence.tie.rule} {captionFor(story, "headline")}
      </Setting>
    </Beat>
  );
}

function Helps() {
  const story = useStory();
  const cost = realFalseDeaths(story);
  return (
    <Beat
      id="helps"
      lead={COPY.evidence.helps.lead}
      text={
        <>
          <Reveal delay={60}>
            <Claim id="R4" className="home-claim--lead" />
          </Reveal>
          <Reveal delay={80} className="home-beat__why">
            <p>{COPY.evidence.helps.gate(gateCrashes(story).map(word).join(" and ") || MISSING)}</p>
          </Reveal>
        </>
      }
      foot={
        <>
          <Reveal delay={90}>
            <p className="home-beat__verdict">{COPY.evidence.helps.realistic}</p>
            <Claim id="R7" />
          </Reveal>
          {cost && (
            <Reveal delay={100}>
              <p className="home-beat__verdict">{COPY.evidence.helps.cost}</p>
              <div className="home-figures">
                <Figure value={cost.perRun} format={(n) => figure(n, 2)} label={COPY.evidence.helps.perRun} tone="loss" size="stat" />
              </div>
            </Reveal>
          )}
        </>
      }
    >
      <Chart name="PairedBars" path="verdicts" duration={1.6} extra={{ setting: false }} />
      <Setting>{captionFor(story, "headline")}</Setting>
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

function LimitGroup({ title, why }: { title: string; why: string | null }) {
  return (
    <div className="home-fail">
      <h4 className="home-fail__title">{title}</h4>
      {why ? (
        <p className="home-limit">
          <Inline text={why} />
        </p>
      ) : (
        <PendingTag>NO DATA YET</PendingTag>
      )}
    </div>
  );
}

function Fails() {
  const story = useStory();
  const found = failures(story);
  const limit = limits(story);
  return (
    <Beat
      id="fails"
      lead={COPY.evidence.fails.lead}
      layout="wide"
      text={
        <Reveal delay={60}>
          <p className="home-beat__verdict">{COPY.evidence.fails.wins}</p>
        </Reveal>
      }
    >
      <Reveal delay={100} className="home-fails">
        <FailGroup title={COPY.evidence.fails.fast} figures={found.fastRestart} suffix={COPY.evidence.fails.times} />
        <FailGroup title={COPY.evidence.fails.falseDeaths} figures={found.falseDeaths} />
        <FailGroup title={COPY.evidence.fails.perProcess} figures={found.perProcess ? [found.perProcess] : []} />
        <div className="home-fail">
          <h4 className="home-fail__title">{COPY.evidence.fails.log}</h4>
          <Claim id="S6" className="home-claim--small" />
          <p className="home-limit">{COPY.solution.more.limit}</p>
        </div>
        <LimitGroup title={COPY.evidence.fails.deaths} why={limit.deaths} />
        <LimitGroup title={COPY.evidence.fails.trackLead} why={limit.trackLead} />
      </Reveal>
      <Chart name="RegimeStrip" path="regime" duration={1.6} className="home-chart--regime" />
    </Beat>
  );
}

function Proof() {
  const steps = proofSteps(useStory());
  return (
    <Beat
      id="proof"
      lead={COPY.evidence.proof.lead}
      text={
        <>
          <Reveal delay={60}>
            <Claim id="S5" className="home-claim--lead" />
          </Reveal>
          <Reveal delay={100}>
            <p className="home-limit home-limit--wide">{COPY.proof.more.proves}</p>
          </Reveal>
        </>
      }
    >
      <Chart name="HashStrip" path="hashes" duration={2.4} className="home-chart--strip" />
      <Reveal delay={60}>
        <Terminal steps={steps} label={COPY.proof.more.terminal} />
      </Reveal>
    </Beat>
  );
}
