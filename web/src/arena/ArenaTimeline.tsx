import { useMemo, useRef, type CSSProperties } from "react";
import { useStore } from "zustand";

import { useClockFrame } from "../lib/clockHooks";
import type { Clock } from "../lib/clock";
import { SPEEDS } from "../lib/playback";
import { fraction, MARK_TONE } from "../lib/timeline";
import type { RunStoreApi } from "../store";
import { laneOf, sharedEnd, type Lane } from "./bands";

const BAND_ROW = 13; // px of a band row: the band and its gap

const seconds = (ms: number): string => `${(ms / 1000).toFixed(ms < 10_000 ? 2 : 1)} s`;

function LaneTrack({ clock, lane, end, label, noun }: { clock: Clock; lane: Lane; end: number; label: string; noun: string }) {
  return (
    <>
      <span className="lane__name">{label}</span>
      <div className="lane__track" style={{ minHeight: lane.rows * BAND_ROW + 18 }}>
        <div className="lane__bands" style={{ height: Math.max(1, lane.rows) * BAND_ROW }}>
          {lane.bands.map((band) => {
            const from = fraction(band.since, end);
            const to = fraction(band.until, end);
            const what = band.source === "supervisor" ? "restarting" : "down";
            return (
              <button
                key={`${band.coordinator}@${band.since}`}
                type="button"
                className={`band band--${band.source}${band.open ? " band--open" : ""}`}
                style={{ left: `${from * 100}%`, width: `${(to - from) * 100}%`, top: band.row * BAND_ROW }}
                title={`${band.coordinator} ${what}: ${seconds(band.since)} to ${band.open ? "the end of the run" : seconds(band.until)}`}
                aria-label={`${noun}: ${band.coordinator} ${what} from ${seconds(band.since)}: jump here`}
                onClick={() => {
                  clock.setPlaying(false);
                  clock.seekTime(band.since);
                }}
              />
            );
          })}
        </div>
        <div className="lane__marks">
          {lane.marks.map((mark) => (
            <button
              key={mark.seq}
              type="button"
              className={`mark mark--${mark.kind} mark--${MARK_TONE[mark.kind]}`}
              style={{ left: `${fraction(mark.ts, end) * 100}%` }}
              title={mark.label}
              aria-label={`${mark.label}: jump here`}
              onClick={() => {
                clock.setPlaying(false);
                clock.seekTime(mark.ts);
              }}
            />
          ))}
        </div>
      </div>
    </>
  );
}

export interface ArenaTimelineProps {
  clock: Clock;
  left: RunStoreApi;
  right: RunStoreApi;
}

/** One play button, one scrubber and one speed for both runs, over a lane per side: the band of each
 * outage and the markers of each crash and recovery, on the shared time axis. */
export function ArenaTimeline({ clock, left, right }: ArenaTimelineProps) {
  const leftEvents = useStore(left, (s) => s.events);
  const rightEvents = useStore(right, (s) => s.events);
  const playing = useStore(clock.state, (s) => s.playing);
  const speed = useStore(clock.state, (s) => s.speed);
  const leftLane = useMemo(() => laneOf(leftEvents), [leftEvents]);
  const rightLane = useMemo(() => laneOf(rightEvents), [rightEvents]);
  const end = sharedEnd(leftLane, rightLane);

  // The thumb, the readout and the playhead follow the clock every frame, straight into the DOM.
  const slider = useRef<HTMLInputElement>(null);
  const readout = useRef<HTMLSpanElement>(null);
  useClockFrame((t) => {
    if (slider.current) slider.current.value = String(Math.min(t, end));
    if (readout.current) readout.current.textContent = `t = ${seconds(Math.min(t, end))} / ${seconds(end)}`;
  });

  return (
    <section className="tl" aria-label="Shared timeline">
      <div className="tl__controls">
        <button className="btn btn--play" onClick={() => clock.setPlaying(!playing)} aria-label={playing ? "pause" : "play"}>
          {playing ? "❚❚" : "▶"}
        </button>
        <span ref={readout} className="tl__readout mono" />
        <div className="speeds" role="group" aria-label="replay speed">
          {SPEEDS.map((s) => (
            <button key={s} className={`btn btn--seg ${s === speed ? "btn--on" : ""}`} onClick={() => clock.setSpeed(s)}>
              {s}×
            </button>
          ))}
        </div>
        <button className="btn" onClick={() => clock.seekTime(end)} title="jump to the end" aria-label="jump to the end">
          ⏭
        </button>
        <span className="tl__legend">
          <i className="tl__key tl__key--down" /> coordinator down · <i className="tl__key tl__key--restart" /> supervisor restarting ·{" "}
          <i className="tl__key tl__key--kill" /> crash · <i className="tl__key tl__key--recovery" /> takeover or restart
        </span>
      </div>
      <div className="tl__grid" style={{ "--end": Math.max(end, 1) } as CSSProperties}>
        <span className="lane__name" />
        <input
          ref={slider}
          className="tl__slider"
          type="range"
          min={0}
          max={Math.max(end, 1)}
          step={1}
          defaultValue={0}
          onChange={(e) => {
            clock.setPlaying(false);
            clock.seekTime(Number(e.target.value));
          }}
          aria-label="replay position, both runs"
        />
        <LaneTrack clock={clock} lane={leftLane} end={end} label="Swarm" noun="swarm" />
        <LaneTrack clock={clock} lane={rightLane} end={end} label="Rival" noun="rival" />
        <div className="tl__playhead" aria-hidden />
      </div>
    </section>
  );
}
