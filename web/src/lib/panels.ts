// The supporting panels' state: one fold per panel (spec §16, Day 9), run on every event
// beside the tree and the schedule. Each fold returns its input unchanged for an event it does
// not read, so replay snapshots share whatever did not change.

import { emptyAuction, foldAuction, type AuctionState } from "./auction";
import { emptyBreakers, foldBreakers, type BreakersState } from "./breakers";
import { emptyCollisions, foldCollisions, type CollisionsState } from "./collisions";
import { emptyEconomy, foldEconomy, type EconomyState } from "./economy";
import { emptyEscalations, foldEscalations, type EscalationsState } from "./escalations";
import { emptyLimits, foldLimits, type LimitsState } from "./limits";
import { emptyMemory, foldMemory, type MemoryState } from "./memory";
import { emptyResults, foldResults, type ResultsState } from "./results";
import type { RunEvent } from "./types";

export interface PanelsState {
  economy: EconomyState;
  auction: AuctionState;
  limits: LimitsState;
  breakers: BreakersState;
  memory: MemoryState;
  collisions: CollisionsState;
  escalations: EscalationsState;
  results: ResultsState;
}

export const emptyPanels = (): PanelsState => ({
  economy: emptyEconomy(),
  auction: emptyAuction(),
  limits: emptyLimits(),
  breakers: emptyBreakers(),
  memory: emptyMemory(),
  collisions: emptyCollisions(),
  escalations: emptyEscalations(),
  results: emptyResults(),
});

export function foldPanels(state: PanelsState, event: RunEvent): PanelsState {
  const next: PanelsState = {
    economy: foldEconomy(state.economy, event),
    auction: foldAuction(state.auction, event),
    limits: foldLimits(state.limits, event),
    breakers: foldBreakers(state.breakers, event),
    memory: foldMemory(state.memory, event),
    collisions: foldCollisions(state.collisions, event),
    escalations: foldEscalations(state.escalations, event),
    results: foldResults(state.results, event),
  };
  const same = (Object.keys(next) as (keyof PanelsState)[]).every((key) => next[key] === state[key]);
  return same ? state : next;
}
