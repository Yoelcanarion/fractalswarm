import { useMemo, useRef } from "react";

import { useClockFrame } from "../lib/clockHooks";
import { eventGroup } from "../lib/eventlog";
import { SPEEDS } from "../lib/playback";
import type { RunEvent } from "../lib/types";
import { useRunStoreApi, useRunStoreShallow } from "../store";

const MARK_TYPES: Record<string, string> = {
  "chaos.injected": "mark--chaos",
  "member.dead": "mark--dead",
  "baseline.crashed": "mark--dead",
  "baseline.restarted": "mark--adopt",
  "tree.adopted": "mark--adopt",
  "collision.detected": "mark--collision",
  "run.halted": "mark--dead",
  "breaker.opened": "mark--dead",
  "escalation.raised": "mark--dead",
  "budget.shock": "mark--warn",
};

// The chaos network's faults come by the thousand; they would paint the whole track.
const markOf = (event: RunEvent): string | undefined =>
  eventGroup(event) === "net-fault" ? undefined : MARK_TYPES[event.type];

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

  const marks = useMemo(
    () =>
      events.flatMap((e) => {
        const cls = markOf(e);
        return cls ? [{ seq: e.seq, ts: e.ts_virtual, cls, type: e.type }] : [];
      }),
    [events],
  );

  return (
    <div className="timeline">
      <button className="btn btn--play" onClick={() => setPlaying(!playing)} aria-label={playing ? "pause" : "play"}>
        {playing ? "❚❚" : "▶"}
      </button>
      <div className="timeline__track">
        <input
          ref={slider}
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
        <div className="timeline__marks">
          {marks.map((m) => (
            <i key={m.seq} className={`mark ${m.cls}`} style={{ left: `${end ? (m.ts / end) * 100 : 0}%` }} title={`${m.type} @ seq ${m.seq}`} />
          ))}
        </div>
      </div>
      <div className="timeline__readout mono">
        <div ref={readout} />
        <div>
          event {cursor} / {events.length}
        </div>
      </div>
      <div className="speeds" role="group" aria-label="replay speed">
        {SPEEDS.map((s) => (
          <button key={s} className={`btn btn--seg ${s === speed ? "btn--on" : ""}`} onClick={() => setSpeed(s)}>
            {s}×
          </button>
        ))}
      </div>
      {live ? (
        <button className={`btn ${following ? "btn--on" : ""}`} onClick={() => seek(events.length)}>
          ● LIVE
        </button>
      ) : (
        <button className="btn" onClick={() => seek(events.length)} title="jump to the end">
          ⏭
        </button>
      )}
    </div>
  );
}
