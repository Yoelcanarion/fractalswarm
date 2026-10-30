import type { ReactNode } from "react";

/** The head of a section of the home page: its title and the one sentence under it. */
export function SectionHead({ id, title, children }: { id: string; title: string; children?: ReactNode }) {
  return (
    <header className="home-section__head">
      <h2 id={`${id}-title`} className="home-section__title">
        {title}
      </h2>
      {children}
    </header>
  );
}

/** The small caption under a result: the task, the failure profile, real or fake model, the seeds. */
export function Setting({ children }: { children: ReactNode }) {
  return <p className="home-setting">{children}</p>;
}
