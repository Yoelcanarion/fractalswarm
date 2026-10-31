import { useMemo, useRef, type CSSProperties } from "react";
import { useStore } from "zustand";

import { useClockFrame } from "../lib/clockHooks";
import type { Clock } from "../lib/clock";
import { SPEEDS } from "../lib/playback";
import { fraction, MARK_TONE } from "../lib/timeline";
import type { RunStoreApi } from "../store";
import { useRoving } from "../components/useRoving";
import { laneOf, sharedEnd, type Lane } from "./bands";
import { bringBoardIntoView, clockReadout, seconds } from "./play";

const BAND_ROW = 13; // px of a band row: the band and its gap

function LaneTrack({ clock, lane, end, label, noun }: { clock: Clock; lane: Lane; end: number; label: string; noun: string }) {
  // a lane is one tab stop, the bands and then the marks along it: Tab lands on one, the arrow keys move between them
  const roving = useRoving(".band, .mark");
  const count = lane.bands.length + lane.marks.length;
  return (
    <>
      <span className="lane__name">{label}</span>
      <div className="lane__track" style={{ minHeight: lane.rows * BAND_ROW + 18 }} role="group" aria-label={`${label}: outages and crashes, jump to one`} onKeyDown={roving.onKeyDown}>
        <div className="lane__bands" style={{ height: Math.max(1, lane.rows) * BAND_ROW }}>
          {lane.bands.map((band, index) => {
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
                {...roving.stop(index, count)}
                onClick={() => clock.seekTime(band.since)}
              />
            );
          })}
        </div>
        <div className="lane__marks">
          {lane.marks.map((mark, index) => (
            <button
              key={mark.seq}
              type="button"
              className={`mark mark--${mark.kind} mark--${MARK_TONE[mark.kind]}`}
              style={{ left: `${fraction(mark.ts, end) * 100}%` }}
              title={mark.label}
              aria-label={`${mark.label}: jump here`}
              {...roving.stop(lane.bands.length + index, count)}
              onClick={() => clock.seekTime(mark.ts)}
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
 * outage and the markers of each crash and recovery, on the shared time axis. As on the run page, a click on a band or a marker only moves
 * the playhead (a replay that plays goes on from there), and dragging the scrubber pauses. */
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
    if (readout.current) readout.current.textContent = clockReadout(t, end);
  });

  return (
    <section className="tl" aria-label="Shared timeline">
      <div className="tl__controls">
        <button
          className="btn btn--play"
          onClick={() => {
            clock.setPlaying(!playing);
            if (!playing) bringBoardIntoView();
          }}
          aria-label={playing ? "pause" : "play"}
        >
          {playing ? "❚❚" : "▶"}
        </button>
        <span ref={readout} className="tl__readout mono" />
        <label className="speedpick">
          Speed
          <select value={speed} onChange={(event) => clock.setSpeed(Number(event.target.value))} aria-label="replay speed">
            {SPEEDS.map((s) => (
              <option key={s} value={s}>
                {s}×
              </option>
            ))}
          </select>
        </label>
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
