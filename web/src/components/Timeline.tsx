import { useMemo, useRef } from "react";

import { useClockFrame } from "../lib/clockHooks";
import { SPEEDS } from "../lib/playback";
import { fraction, MARK_TONE, marksOf } from "../lib/timeline";
import { useRunStoreApi, useRunStoreShallow } from "../store";
import { Tooltip } from "./ui";
import { useRoving } from "./useRoving";

const seconds = (ms: number) => `${(ms / 1000).toFixed(ms < 10_000 ? 2 : 1)} s`;

export function Timeline() {
  const { events, cursor, playing, speed, live, following } = useRunStoreShallow((s) => ({
    events: s.events,
    cursor: s.cursor,
    playing: s.playing,
    speed: s.speed,
    live: s.live,
    following: s.following,
  }));
  const { seekTime, setPlaying, setSpeed, seek } = useRunStoreApi().getState();
  const end = events.at(-1)?.ts_virtual ?? 0;

  // The thumb and the time readout follow the clock every frame, straight into the DOM, so a
  // playing replay re-renders nothing here between events.
  const slider = useRef<HTMLInputElement>(null);
  const readout = useRef<HTMLDivElement>(null);
  useClockFrame((t) => {
    if (slider.current) slider.current.value = String(Math.min(t, end));
    if (readout.current) readout.current.textContent = `t = ${seconds(Math.min(t, end))} / ${seconds(end)}`;
  });

  const marks = useMemo(() => marksOf(events), [events]);
  // the marks are one tab stop (the bar has a few dozen of them): Tab lands on one, the arrow keys move along them
  const roving = useRoving(".mark");

  return (
    <div className="timeline">
      <button className="btn btn--play" onClick={() => setPlaying(!playing)} aria-label={playing ? "pause" : "play"}>
        {playing ? "❚❚" : "▶"}
      </button>
      <div className="timeline__track">
        <input
          ref={slider}
          id="replay-position"
          type="range"
          min={0}
          max={Math.max(end, 1)}
          step={1}
          defaultValue={0}
          onChange={(e) => {
            setPlaying(false);
            seekTime(Number(e.target.value));
          }}
          aria-label="replay position"
        />
        <div className="timeline__marks" role="group" aria-label="Kills and takeovers on the bar" onKeyDown={roving.onKeyDown}>
          {marks.map((m, index) => (
            <button
              key={m.seq}
              type="button"
              {...roving.stop(index, marks.length)}
              className={`mark mark--${m.kind} mark--${MARK_TONE[m.kind]}`}
              style={{ left: `${fraction(m.ts, end) * 100}%` }}
              title={m.label}
              aria-label={`${m.label}: jump here`}
              onClick={() => {
                setPlaying(false);
                seekTime(m.ts);
              }}
            />
          ))}
        </div>
      </div>
      <div className="timeline__readout mono">
        <div ref={readout} />
        <div>
          event {cursor} / {events.length}
        </div>
      </div>
      <label className="speedpick">
        <span className="speedpick__label">Speed</span>
        <select value={speed} onChange={(event) => setSpeed(Number(event.target.value))} aria-label="replay speed">
          {SPEEDS.map((s) => (
            <option key={s} value={s}>
              {s}×
            </option>
          ))}
        </select>
      </label>
      {live ? (
        <button className={`btn ${following ? "btn--on" : ""}`} onClick={() => seek(events.length)}>
          ● LIVE
        </button>
      ) : (
        <Tooltip label="Jump to the end of the run" placement="top-end">
          <button className="btn" onClick={() => seek(events.length)} aria-label="Jump to the end of the run">
            ⏭
          </button>
        </Tooltip>
      )}
    </div>
  );
}
