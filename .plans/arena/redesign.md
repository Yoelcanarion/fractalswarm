# The redesign (Yoel, Oct 30, about 21:15 CET)

This brief wins over `w4-polish.md`, `w5-polish.md`, `w6-home.md` and `w7-*` wherever they disagree. Yoel has answered, and he wants no more questions on it: decide, and record the decision in your notes. It replaces the page W6 and W7 built with "the scroll chooses the beat". Everything else in `.plans/arena/worker-rules.md` still holds: no real calls, claims only from `docs/claims.md`, your own files only, HOLD and RELEASE.

## His words

> No quiero que sea toda la animacion de la interfaz de la portada mediante scroll, quiero que hayan varias animaciones de distinto tipo, no quiero que sea tan cargada la interfaz, tiene demasiado texto, deberia de ser lo importante y que se entienda perfectamente, el scroll de la grafica no funciona fluido, va avanzando lento y llegado al apartado 3 explota todo del tiron, con el grafo tambien pasa lo mismo, avanza de forma erronea y de golpe, quiero que ademas en lo que es la aplicacion en si, no tenga 80 mil funcionalidades o botones, pues se ve demasiada informacion para el usuario, quiero que sea mas limpio, no quiero que quites funcionalidades sino hacerlo mas limpio y mas claro para saber como usar, pues yo sabria como usarlo pero si alguien quiere probarlo, no

His answers to four questions:
- **Home:** a short page, nothing pinned to the scroll, five sections, each with a different kind of motion. 1 Hero: the diagram on its constant loop, a title, one sentence, a button. 2 Problem: the animation plays by itself on arrival, with a Repeat button. 3 Solution: three steps that animate on hover. 4 Proof: bars and numbers that grow by themselves. 5 Enter: cards with animated thumbnails.
- **Text:** a title and one short sentence per section, a little more or less depending on the section. Nuances go in a folded See more.
- **Click demo on the home page:** the visitor kills orchestrators with a click and watches the rest take over. It is an illustration in the browser, labelled as such, not a real run.
- **The app:** every page shows the essentials and one main action, the rest under Details, and a 3-step guide the first time. No feature is removed.

The test for everything: **a person who has never heard of orchestrators understands the page, and can use the app, with no explanation.** Yoel: "yo sabria como usarlo pero si alguien quiere probarlo, no".

Baseline at 1920x1080 on the bundle of Oct 30: home 3,280 words and 17,231 px. First view controls: `#/run` 53, `#/runs` 50 (87 in all), `#/arena` 50, `#/new` 17, `#/charts` 20, `#/helps` 74 (94 in all, 981 words).

## The home page

**Targets:** about 6 screens (at most 7,000 px at 1920x1080), and about 200 visible words with every See more closed (at most 230). A test holds both numbers on the rendered page.

### Motion rules

These replace the rules of the 17:00 verdict. Yoel's complaint about the chart and the graph is the test: it moved slowly, then everything burst at once.

1. **Nothing is pinned, and nothing reads the scroll.** No `position: sticky` on the page (the top bar may stay). No `useScroll`, no scroll listeners, no value computed from the scroll position. `scroll/Stage`, its timeline and its clock go, and so does the chapter rail.
2. **Scrolling only starts things.** One hook, `useArrival(ref)`: an IntersectionObserver that fires once, when about 40% of a section is on screen. An animation that has played stays at its end. It plays again only from its Repeat button.
3. **One eased motion, start to end.** Each animation is one playhead with one shared ease. No holds, no steps that pile up, no stack of delays that all land together. A test holds the shared ease: its peak speed is at most 1.6 times its mean, and it has covered at least 10% of the way at 20% of the time. When several parts move, they share the playhead or their delays spread evenly across it.
4. **Durations:** bars and numbers 1.2–2 s, the Problem film 6–8 s, a hover 0.6–0.9 s, a takeover in the click demo 1.2–2 s.
5. **Interruptible and clean:** Repeat restarts from the beginning without a jump. Leaving a hover plays it back to rest or lets it finish, whichever looks better; it never snaps.
6. **Cheap:** `transform` and `opacity` where you can, CSS animations for anything small, one rAF loop per visual, no React render during a motion, zero work off screen or in a hidden tab.
7. **Firefox is the browser that counts.** Yoel uses it, so measure on Playwright Firefox, not only on Chromium, at 1920x1080. Report p50, p95 and p99 frame times for each animation.
8. **Reduced motion and `?still`:** every animation shows its final state, Repeat disappears, the hover cards show their end state, and the click demo works with instant changes.

### The five sections

Words below are a starting point, and W6 owns them. Every section must make sense to someone who has never heard of orchestrators. Say "coordinators", and introduce "brains" only through the tagline. Claims keep the words of `docs/claims.md`: where a claim needs its qualifier, the qualifier stays and everything around it goes.

1. **Hero** (one screen). The tagline as title. One sentence, like: "AI agents led by a tree of small coordinators. Any of them can die mid-run, and the rest take over its work." One button, "Kill one yourself", which glides to the click demo. The diagram on its loop, with the small line that says it is a recorded run replayed on a loop. Under the title a small kicker naming Muse Spark and Muse Wonder, because the hackathon is about them.
2. **Problem** (one screen). Title: "A team that depends on one coordinator." One sentence: in the simplest setup its workers die with it, and their calls are paid for twice. A short film of the real work lanes of the in-process supervisor: the playhead sweeps the run once, the crash lands, the bars stop, the work waits, the redone calls appear in their own colour. It starts on arrival, and it has a Repeat button. The numbers and the better supervisor ("its workers survive, and a standby takes over") go in See more, with the rival's name and reason as R5 demands.
3. **Solution** (about 1.5 screens). Title: "A tree of small coordinators." One sentence from S1 in plain words: the survivors read the same log and each works out the same heir, so nobody votes. Three small cards, each a few words and a drawing that plays on hover, focus or tap: everything goes in one log; everyone works out the same heir; the heir picks up the work. On a touch screen each card plays once on arrival. Below them, **the click demo**.
4. **Proof** (one screen). A title and one sentence: the setting of R6 in its own words. Three or four numbers and the bars of the swarm against both rivals grow by themselves, once, on arrival. Bars carry the rival's name and setting. The visible link to R2 and R3 that R6 requires stays on the section, outside any fold. One line says you can check it: the `demo --verify` line. See more holds the nuance, and a link to the Evidence page. All numbers come from `story.json`: the 10-seed reading will change them, so type none.
5. **Enter** (one screen). Title and one sentence, and the door cards. Each thumbnail is a small drawing that loops softly while it is on screen, in CSS.

**Nothing is lost.** What leaves the page moves to a See more or to a new plain page, `#/evidence`: the Models chapter, the fair-fight table, the charts, where it helps and where it does not, the proof, the tokens. It is a normal document with no animation that matters: its charts draw `still`. The door "The numbers" and the See more of Proof lead to it. Check that R6's way to R2 and R3 survives, and that each number against the in-process supervisor keeps its reason.

### The click demo

An illustration that runs in the browser, and the page says so right on it: "An illustration in your browser, not a real run."
- The same tree and the same drawing language as the hero: a root, three tracks, six sessions, their agents.
- Click, tap, or Tab and Enter on a coordinator kills it. It goes dark, its neighbours notice after about a second, the heir lights up, the orphans re-wire to it, and work keeps moving through the tree. One live line says what happened in plain words, in an `aria-live` region.
- **A "Kill half" button** that kills five in turn, because that is the sentence at the top of the page. A "Reset" button. After a while with no input, or when the visitor has killed everything, it resets itself.
- When nobody is left, it says so plainly: there is nobody to take over. A survivor is the limit, and the demo does not hide it.
- It shows no number from a run, no hash and no cost.
- **The real rule:** run the real HRW, because that is what the visitor is being told happens. `stable_hash("hrw", key, member)` is the first 8 bytes of blake2b over `canonical_json(["hrw", key, member])`; `coord/tree.py::heir` and `coord/hrw.py::remap` are short. Port them to TypeScript with a small blake2b, about 100 lines, and test against the real scores in `story.hrw.rounds`. If the port runs past 200 lines, drop the load bound and say so in your notes.
- Works at phone width, and costs nothing while off screen.

### Who does what

- **W7, the visuals** (`web/src/home/viz/**`, `web/src/home/data/**`, `chapters/Hero.tsx`, `scripts/build_home_data.py`). Export from `viz/index.ts`, with lab sections:
  - `ProblemFilm({ play })`;
  - `StepDrawing({ step, active })`, where `step` is `log`, `heir` or `adopt`;
  - `KillDemo()`, self-contained, with its own buttons and live line;
  - `ProofBars({ play })` and `GrowNumber({ value, format, play })`;
  - `DoorThumb({ door })`.

  `play` is a counter: 0 means not yet, and each increment restarts from the start. The shared ease and its test are W7's. Reuse what exists: `WorkLanes` for the film, `tree` for the demo, `DoorGlyph` for the thumbnails.
- **W6, the page** (`web/src/home/**` except the above). The new sections, `useArrival`, `SeeMore` (a native `details`), `copy.ts`, `home.css`, the route of `#/evidence` and its page, the Repeat button, the removal of `scroll/`, the rail and whatever only they used, and the tests: words, height, no scroll reads, claims. Keep `?still`, the offline rule and `#/?at=<section>` for the five sections.
- W7 and W6 agree on anything else directly, by mail, in one line. Neither waits for the other: W6 draws a placeholder until W7's component lands.

## The app (W4)

W4 owns everything under `web/src/` except `home/**` and `director/**`, and `web/src/arena/**` is W4's too until W5 comes back.
- **On every page:** one line that says what the page is for, one main action, and about 10 controls in the first view. Everything else sits under Details, one click away, using one shared component. Plain words. Technical terms keep their tooltips.
- **No feature is removed.** Keep a checklist in your notes of every control that moved: each stays reachable in at most two clicks.
- **No bare page.** Every empty state says what to do next. A page of zeros must not be the first thing anyone sees: `#/run` with nothing chosen opens the recorded final run (`demo-final`) at its end.
- **A 3-step guide the first time:** choose a run, kill half the brains, verify the replay. Dismissible, can be reopened, and never blocks anything. Make each step honest about what a recorded run can and cannot do, and leave the seen flag in `localStorage` inside a try/catch.
- **Do not break the director.** Keep the anchors the scenes use (`director/targets.ts`). If a target moves under Details, it must be openable from the address or by a prop, and list it in your notes for W5.
- Report the controls in the first view of each page again at 1920x1080, against the baseline above.

## Order

1. **On HOLD, now:** code, tsc and vitest on one worker. W6 and W7 merge `Yoelcanarion/arena` first and start at once. The hard-task skill covers the design turns: invoke it first.
2. **At RELEASE** (about 22:10, when the seeds and the sample pairs are done): browsers, on ports 5174 (W6), 5175 (W7) and 5176 (W4).
3. `merge_ready` as soon as a pass works, rough or not: Yoel wants to see it. The coordinator merges, rebuilds, and tells the first coordinator (`term_ae1ac1e9-7cd5-4791-a3f0-3d5ff941c465`), who shows it to him.
4. Then polish, on what he says.
