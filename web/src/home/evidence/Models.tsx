import { useRef, useState } from "react";

import { COPY } from "../copy";
import { count } from "../format";
import { useEnterProgress, useStill } from "../hooks";
import { ablation, extraction, tokens } from "../numbers";
import { SectionHead } from "../parts/Chapter";
import { Claim, PendingTag } from "../parts/Claim";
import { segmentEmail, spanOf } from "../parts/emailSegments";
import { Figure } from "../parts/Figure";
import { Reveal } from "../parts/Reveal";
import { slice, useStory } from "../story";
import { Viz } from "../visuals";

// Colour is never the only cue: every row names its model in words. The dot is the model's own token.
const MODEL_DOT: Record<string, string> = { spark: "var(--model-spark)", wonder: "var(--model-wonder)", guard: "var(--model-guard)" };

export function Models() {
  const story = useStory();
  const still = useStill();
  const example = extraction(story);
  const result = ablation(story);
  const spent = tokens(story);
  const [lit, setLit] = useState<number | null>(null);
  const bars = useRef<HTMLDivElement>(null);
  const barsProgress = useEnterProgress(bars, still, { duration: 1.2 });

  const sources = (example?.constraints ?? []).map((c) => spanOf(example?.email ?? "", c.source));
  const segments = example?.email ? segmentEmail(example.email, sources) : [];
  const of = (n: number) => `${count(n)} ${COPY.models.ablation.of} ${count(result?.total)}`;

  return (
    <section id="models" className="home-chapter home-chapter--calm" aria-labelledby="models-title">
      <div className="home-wrap">
        <SectionHead id="models" title={COPY.models.title} />

        <Reveal className="home-extract">
          {example?.email ? (
            <>
              <div className="home-extract__email">
                <p className="home-label">{COPY.models.email}</p>
                <p className="home-extract__text">
                  {segments.map((part, i) =>
                    part.constraint === null ? (
                      <span key={i}>{part.text}</span>
                    ) : (
                      <mark key={i} className="home-extract__mark" data-lit={lit === part.constraint ? "" : undefined}>
                        {part.text}
                      </mark>
                    ),
                  )}
                </p>
              </div>
              <div className="home-extract__constraints">
                <p className="home-label">{COPY.models.constraints}</p>
                <ul className="home-extract__list">
                  {(example.constraints ?? []).map((constraint, i) => (
                    <li key={i}>
                      <button
                        type="button"
                        className="home-extract__item"
                        data-lit={lit === i ? "" : undefined}
                        onMouseEnter={() => setLit(i)}
                        onMouseLeave={() => setLit(null)}
                        onFocus={() => setLit(i)}
                        onBlur={() => setLit(null)}
                      >
                        {constraint.text}
                      </button>
                    </li>
                  ))}
                </ul>
                {example.model && <p className="home-setting">{example.model}</p>}
              </div>
            </>
          ) : (
            <p className="home-pending">
              <PendingTag>NO DATA YET</PendingTag> {COPY.models.noExtraction}
            </p>
          )}
        </Reveal>

        <div className="home-models-pair">
          <Reveal className="home-ablation">
            <h3 className="home-step__lead">{COPY.models.ablation.lead}</h3>
            <p className="home-step__more">{COPY.models.ablation.more}</p>
            {result && typeof result.total === "number" ? (
              <div className="home-figures">
                <Figure value={result.parser} format={of} label={COPY.models.ablation.parser} tone="rival" size="stat" />
                <Figure value={result.muse} format={of} label={COPY.models.ablation.muse} tone="swarm" size="stat" />
              </div>
            ) : (
              <p className="home-pending">
                <PendingTag />
              </p>
            )}
          </Reveal>

          <Reveal className="home-muse">
            <h3 className="home-step__lead">{COPY.models.muse.lead}</h3>
            <ul className="home-roles">
              {COPY.models.roles.map((role) => (
                <li key={role.id} className="home-role">
                  <span className="home-role__dot" style={{ background: MODEL_DOT[role.id] }} aria-hidden />
                  <span className="home-role__name">{role.name}</span>
                  <span className="home-role__does">{role.does}</span>
                </li>
              ))}
            </ul>
            <div ref={bars} className="home-tokens">
              <p className="home-label">{COPY.models.tokens}</p>
              <div className="home-tokens__bar">
                <Viz name="TokenBar" data={slice(story, "tokensByModel")} progress={barsProgress} still={still} />
              </div>
              <p className="home-tokens__ledger">
                <span>
                  {COPY.models.coordination} <strong>{count(spent.coordination)}</strong>
                </span>
                <span aria-hidden>{"·"}</span>
                <span>
                  {COPY.models.recovery} <strong>{count(spent.recovery)}</strong>
                </span>
              </p>
              <Claim id="S4" className="home-claim--small" />
            </div>
          </Reveal>
        </div>
      </div>
    </section>
  );
}
