import { useMotionValueEvent, useScroll } from "motion/react";
import { useCallback, useEffect, useRef, useState } from "react";

import { chapterAt, CHAPTERS } from "../chapters";
import { COPY } from "../copy";
import { chapterHash } from "../route";
import { scrollToChapter } from "../scrollTo";

// The chapter counts as current once its top is above this share of the viewport.
const PROBE = 0.4;

/** The index of the chapter being read (-1 above the first). The chapters' tops are measured when the layout changes,
 * never in the scroll handler, which only compares the scroll position with them. */
export function useActiveChapter(): number {
  const [active, setActive] = useState(-1);
  const tops = useRef<number[]>([]);
  const { scrollY } = useScroll();

  const measure = useCallback(() => {
    tops.current = CHAPTERS.map((chapter) => {
      const element = document.getElementById(chapter.id);
      return element ? element.getBoundingClientRect().top + window.scrollY : Number.POSITIVE_INFINITY;
    });
  }, []);

  const update = useCallback((y: number) => {
    const next = chapterAt(tops.current, y + window.innerHeight * PROBE);
    setActive((current) => (current === next ? current : next));
  }, []);

  useEffect(() => {
    measure();
    update(window.scrollY);
    const observer = new ResizeObserver(() => {
      measure();
      update(window.scrollY);
    });
    observer.observe(document.body);
    return () => observer.disconnect();
  }, [measure, update]);

  useMotionValueEvent(scrollY, "change", update);
  return active;
}

/** The chapters, on the right edge: where you are, and a link to each. Hidden while the hero is on screen. */
export function ChapterRail({ active }: { active: number }) {
  return (
    <nav className="home-rail" aria-label={COPY.bar.rail} data-visible={active >= 0 ? "" : undefined}>
      <ol className="home-rail__list">
        {CHAPTERS.map((chapter, index) => (
          <li key={chapter.id}>
            <a
              className="home-rail__item"
              href={chapterHash(chapter.id)}
              aria-current={index === active ? "true" : undefined}
              onClick={(event) => scrollToChapter(chapter.id, event)}
            >
              <span className="home-rail__label">
                <span className="home-rail__number">{chapter.number}</span>
                {chapter.label}
              </span>
              <span className="home-rail__tick" aria-hidden />
            </a>
          </li>
        ))}
      </ol>
    </nav>
  );
}
