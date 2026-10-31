// Whether a run's replay has played it out: a recording (not live) with events, whose cursor is past the last one. The status line,
// the scoreboard and the end of the pair all ask it, and must agree.

export const playedOut = (s: { live: boolean; events: readonly unknown[]; cursor: number }): boolean =>
  !s.live && s.events.length > 0 && s.cursor >= s.events.length;
