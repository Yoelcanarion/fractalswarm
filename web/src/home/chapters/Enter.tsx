import { animate, useMotionValue } from "motion/react";
import { ArrowUpRight } from "lucide-react";

import { COPY } from "../copy";
import { DOORS, doorState, isStaticShowcase, type Door } from "../doors";
import { useStill } from "../hooks";
import { ChapterHead } from "../parts/Chapter";
import { Reveal } from "../parts/Reveal";
import { Viz } from "../visuals";

export function Enter() {
  const staticBuild = isStaticShowcase();
  return (
    <section id="enter" className="home-chapter home-chapter--enter" aria-labelledby="enter-title">
      <div className="home-wrap">
        <ChapterHead id="enter" number="05" eyebrow={COPY.enter.eyebrow} title={COPY.enter.title}>
          <p>{COPY.enter.lede}</p>
        </ChapterHead>
        <ul className="home-doors">
          {DOORS.map((door, index) => (
            <DoorCard key={door.id} door={door} open={doorState(door, staticBuild).open} note={doorState(door, staticBuild).note} index={index} />
          ))}
        </ul>
      </div>
    </section>
  );
}

function DoorCard({ door, open, note, index }: { door: Door; open: boolean; note: string | null; index: number }) {
  const still = useStill();
  // The glyph plays while the pointer or the focus is on the door, and rests at the end otherwise.
  const hover = useMotionValue(still ? 1 : 0);
  const play = (to: number) => {
    if (!still) animate(hover, to, { duration: to === 1 ? 0.9 : 0.4, ease: [0.23, 1, 0.32, 1] });
  };
  const body = (
    <>
      <span className="home-door__glyph" aria-hidden>
        <Viz name="DoorGlyph" data={door.id} progress={hover} still={still} />
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
    <Reveal as="li" delay={Math.min(index, 6) * 50} className={`home-door-slot home-door-slot--${door.id}`}>
      {open ? (
        <a
          className="home-door"
          href={door.href}
          onPointerEnter={() => play(1)}
          onPointerLeave={() => play(0)}
          onFocus={() => play(1)}
          onBlur={() => play(0)}
        >
          {body}
        </a>
      ) : (
        <div className="home-door home-door--closed" aria-disabled="true">
          {body}
        </div>
      )}
    </Reveal>
  );
}
