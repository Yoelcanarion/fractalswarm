# Home polish (first coordinator, Oct 31)

Yoel, on the home: the film under "A team that depends on one coordinator." stutters, and every See more leaves its right half empty.

## The film

- **Not the frames.** On the old build, Firefox had p99 12.1 ms and max 18.2 ms; Chromium had p99 16.8 ms. Nothing was dropped.
- **The time map.** `buildKnots` was a polyline inside one playhead. Cursor speed, every 0.5 s in Firefox: 89 165 89 18 21 850 765 301 68 0 200 168 124 65 px/s. That is the crawl, the burst and the hold of rule 3 of `.plans/arena/redesign.md`. The test held the ease and never the map.
- **Fix.** `tAt(p) = p × durationMs`. Same measure now: 77 144 195 231 257 273 281 281 273 257 231 195 144 75 px/s, one curve.
- **What the map used to do by stopping.** The damage is shown while the run plays out (`emphasisAt` from the end of the last wait to the end of the run). The captions hang on the run: the first crash, the start of the longest wait, the end of the last wait.
- **`story.json` still carries `keyframes`.** Nothing reads them now. I left them alone, so the generator and the data's digest do not move.
- **Strikes.** `STRIKE_MS` went from 350 to 7000 ms of the run. At about fifty times speed, 350 ms was a pop.
- **A test holds it now.** `lanes.test.ts` steps the film at 60 fps through the ease: no step above 1.6 times the mean, none under half of it between 10% and 90% of the film.

## The folds

- **Layout.** `FoldRow`, two columns from 1280 px, one below in the order of the markup, so a phone reads as before. The right column is at least 654 px: at 3 columns each panel of `HrwPanels` needs about 209 px to keep a score on one line.
- **Right side.**
  - Problem: the pair (it counts up as the fold opens), then `PartsDiagram`, which draws itself, then S3 under it.
  - Solution: `HrwPanels`, first takeover of the recorded run, ending on 9 of 9 pick o1.
  - Proof: S5, its limit, `HashStrip`, the terminal.
- **S3 stays under the diagram**, on the right. Next to the sentence on the better supervisor it read as a contradiction: a standby takes over, then no standby.
- **`LineDraw` is left out on purpose.** It would put 11.2 against 21.9 s beside the sentence that says tied. That is why the home has the dot plot.
- **`FoldDrawing`.** One playhead per opening, on screen only. The drawing is made at the first opening, so a closed fold costs nothing and is not in the DOM.
- **`HashStrip`.** All fifty cards in 3.5 s was 13,000 px: a flicker. `travel` crosses the last 2000 px, about eight cards, and `stripState` lost its own ease, per rule 3. Largest step in Firefox: 4.8 px at about 165 Hz.

## Verified

- `src/home`: 45 files, 709 tests. `tsc` clean.
- On a scratch build, in Chromium: 1920, 1366, 1280, 1024 and 390 wide, no sideways scroll, no overflow in the takeover or the chain.
- Firefox at 1920: the three folds, no errors.
- Opened twice: it plays again from its start. `?still` and reduced motion: the last frame at once. Light theme looked at.

## Not touched

No words, no claim, no take: no scene shows the home. The bundle in `src/fractalswarm/api/static` is the coordinator's, after the merge.
