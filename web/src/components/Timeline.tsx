import { useEffect, useMemo } from "react";

import { SPEEDS } from "../lib/playback";
import { useRun } from "../store";

const MARK_TYPES: Record<string, string> = {
  "chaos.injected": "mark--chaos",
  "member.dead": "mark--dead",
  "tree.adopted": "mark--adopt",
  "collision.detected": "mark--collision",
};

const seconds = (ms: number) => `${(ms / 1000).toFixed(ms < 10_000 ? 2 : 1)} s`;

export function Timeline() {
  const { events, cursor, playhead, playing, speed, live, following } = useRun();
  const { seekTime, setPlaying, setSpeed, tick, seek } = useRun.getState();
  const end = events.at(-1)?.ts_virtual ?? 0;

  useEffect(() => {
    if (!playing) return;
    let last = performance.now();
    let frame = requestAnimationFrame(function loop(now) {
      tick(now - last);
      last = now;
      frame = requestAnimationFrame(loop);
    });
    return () => cancelAnimationFrame(frame);
  }, [playing, tick]);

  const marks = useMemo(
    () => events.filter((e) => MARK_TYPES[e.type]).map((e) => ({ seq: e.seq, ts: e.ts_virtual, cls: MARK_TYPES[e.type], type: e.type })),
    [events],
  );

  return (
    <div className="timeline">
      <button className="btn btn--play" onClick={() => setPlaying(!playing)} aria-label={playing ? "pause" : "play"}>
        {playing ? "❚❚" : "▶"}
      </button>
      <div className="timeline__track">
        <input
          type="range"
          min={0}
          max={Math.max(end, 1)}
          step={1}
          value={Math.min(playhead, end)}
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
        <div>
          t = {seconds(Math.min(playhead, end))} / {seconds(end)}
        </div>
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
