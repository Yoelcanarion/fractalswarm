import { ArrowUpRight } from "lucide-react";
import { useRef } from "react";

import { COPY } from "../copy";
import { DOORS, doorState, isStaticShowcase, type Door } from "../doors";
import { useOnScreenAttribute } from "../hooks";
import { SectionHead } from "../parts/Chapter";
import { DoorThumb } from "../slots";

/** The way in: a card per door, each with a small drawing that loops softly in CSS while the section is on screen
 * (`data-onscreen` is false the rest of the time, and the loops pause with it). */
export function Enter() {
  const staticBuild = isStaticShowcase();
  const section = useRef<HTMLElement>(null);
  useOnScreenAttribute(section);
  return (
    <section id="enter" ref={section} className="home-section home-enter" aria-labelledby="enter-title">
      <div className="home-wrap">
        <SectionHead id="enter" title={COPY.enter.title}>
          <p className="home-section__line">{COPY.enter.line}</p>
        </SectionHead>
        <ul className="home-doors">
          {DOORS.map((door) => (
            <DoorCard key={door.id} door={door} open={doorState(door, staticBuild).open} note={doorState(door, staticBuild).note} />
          ))}
        </ul>
      </div>
    </section>
  );
}

function DoorCard({ door, open, note }: { door: Door; open: boolean; note: string | null }) {
  const body = (
    <>
      <span className="home-door__thumb" aria-hidden>
        <DoorThumb door={door.id} />
      </span>
      <span className="home-door__title">{door.title}</span>
      <span className="home-door__purpose">{door.purpose}</span>
      {open ? (
        <span className="home-door__go" aria-hidden>
          <ArrowUpRight size={18} />
        </span>
      ) : (
        <span className="home-door__note">{note ?? COPY.enter.closed}</span>
      )}
    </>
  );
  return (
    <li className={`home-door-slot home-door-slot--${door.id}`}>
      {open ? (
        <a className="home-door" href={door.href}>
          {body}
        </a>
      ) : (
        <div className="home-door home-door--closed" aria-disabled="true">
          {body}
        </div>
      )}
    </li>
  );
}
