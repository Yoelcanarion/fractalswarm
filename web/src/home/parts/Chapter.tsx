import type { ReactNode } from "react";

import { Reveal } from "./Reveal";

/** The opening of a chapter: its number and name, a statement, and a line that sets the scene. */
export function ChapterHead({ id, number, eyebrow, title, children }: { id: string; number: string; eyebrow: string; title: string; children?: ReactNode }) {
  return (
    <header className="home-chapter__head">
      <Reveal as="p" className="home-eyebrow">
        <span className="home-eyebrow__number">{number}</span>
        {eyebrow}
      </Reveal>
      <Reveal delay={50}>
        <h2 id={`${id}-title`} className="home-chapter__title">
          {title}
        </h2>
      </Reveal>
      {children && (
        <Reveal delay={100} className="home-chapter__lede">
          {children}
        </Reveal>
      )}
    </header>
  );
}

/** The sentences of a step: a lead in the large type, and what follows in the quieter one. */
export function StepText({ lead, more }: { lead?: ReactNode; more?: ReactNode }) {
  return (
    <>
      {lead && <p className="home-step__lead">{lead}</p>}
      {more && <p className="home-step__more">{more}</p>}
    </>
  );
}

/** The small caption under a result: the task, the failure profile, real or fake model, the seeds. */
export function Setting({ children }: { children: ReactNode }) {
  return <p className="home-setting">{children}</p>;
}

/** A statement alone on the screen, between two parts of the story. */
export function Closer({ children }: { children: ReactNode }) {
  return (
    <div className="home-closer">
      <Reveal as="p" className="home-closer__text">
        {children}
      </Reveal>
    </div>
  );
}
