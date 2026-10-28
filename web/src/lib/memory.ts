// Memory (spec §9): the shared blackboard as a fold over the fact and artifact events, plus the
// anti-silo measure: how many of the facts that agents found by memory.search were published by
// another squad.
//
//   fact.published     {key, subject, status, squad, agent, contract, version}
//   fact.promoted      {key, by}                                a squad-local draft becomes global
//   artifact.written   {path, version, author, size}
//   msg.sent           topic tool         body {name: "memory.search", call_id, squad, ...}
//   msg.sent           topic tool.result  body {call_id, output: {results: [{key, squad, ...}]}}

import { claimedBy } from "./families";
import {
  appendCapped,
  asNumber,
  asRecord,
  asString,
  GENERIC_CAP,
  genericEntry,
  type GenericEntry,
} from "./generic";
import type { RunEvent } from "./types";

export interface FactRow {
  key: string;
  subject: string;
  status: string;
  squad: string;
  agent: string;
  contract: string;
  version: number;
  seq: number;
  ts: number;
  promoted: boolean;
  promotedBy: string | null;
}

export interface ArtifactRow {
  path: string;
  version: number;
  author: string;
  size: number;
  seq: number;
  ts: number;
}

export interface SquadMemory {
  squad: string;
  published: number;
  promoted: number;
  reused: number; // times another squad found one of this squad's facts by search
}

export interface MemoryState {
  facts: Record<string, FactRow>;
  order: string[];
  published: number; // every publication, new versions included
  promoted: number;
  squads: Record<string, SquadMemory>;
  artifacts: Record<string, ArtifactRow>;
  artifactOrder: string[];
  searches: number;
  hits: number;
  crossSquadHits: number;
  pending: Record<string, string>; // call_id -> the searching squad
  other: GenericEntry[];
}

export const emptyMemory = (): MemoryState => ({
  facts: {},
  order: [],
  published: 0,
  promoted: 0,
  squads: {},
  artifacts: {},
  artifactOrder: [],
  searches: 0,
  hits: 0,
  crossSquadHits: 0,
  pending: {},
  other: [],
});

const MEMORY_TYPES: ReadonlySet<string> = new Set(["fact.published", "fact.promoted", "artifact.written"]);

const squadRow = (state: MemoryState, squad: string): SquadMemory =>
  state.squads[squad] ?? { squad, published: 0, promoted: 0, reused: 0 };

function foldSearch(state: MemoryState, topic: string, body: Record<string, unknown>): MemoryState {
  if (topic === "tool") {
    if (body.name !== "memory.search") return state;
    return {
      ...state,
      searches: state.searches + 1,
      pending: { ...state.pending, [asString(body.call_id)]: asString(body.squad) },
    };
  }
  const callId = asString(body.call_id);
  const caller = state.pending[callId];
  if (caller === undefined) return state;
  const pending = { ...state.pending };
  delete pending[callId];
  const results = asRecord(body.output).results;
  const found = (Array.isArray(results) ? results : []).map(asRecord);
  const squads = { ...state.squads };
  let cross = 0;
  for (const fact of found) {
    const owner = asString(fact.squad);
    if (owner === "" || owner === caller) continue;
    cross += 1;
    const current = squads[owner] ?? squadRow(state, owner);
    squads[owner] = { ...current, reused: current.reused + 1 };
  }
  return { ...state, pending, squads, hits: state.hits + found.length, crossSquadHits: state.crossSquadHits + cross };
}

export function foldMemory(state: MemoryState, event: RunEvent): MemoryState {
  const p = event.payload;
  switch (event.type) {
    case "fact.published": {
      const key = asString(p.key);
      const squad = asString(p.squad);
      const known = state.facts[key];
      const row: FactRow = {
        key,
        subject: asString(p.subject),
        status: asString(p.status),
        squad,
        agent: asString(p.agent),
        contract: asString(p.contract),
        version: asNumber(p.version) ?? (known?.version ?? 0) + 1,
        seq: event.seq,
        ts: event.ts_virtual,
        promoted: known?.promoted ?? false,
        promotedBy: known?.promotedBy ?? null,
      };
      const owner = squadRow(state, squad);
      return {
        ...state,
        facts: { ...state.facts, [key]: row },
        order: known ? state.order : [...state.order, key],
        published: state.published + 1,
        squads: { ...state.squads, [squad]: { ...owner, published: owner.published + 1 } },
      };
    }
    case "fact.promoted": {
      const key = asString(p.key);
      const known = state.facts[key];
      if (!known || known.promoted) return state;
      const owner = squadRow(state, known.squad);
      return {
        ...state,
        facts: { ...state.facts, [key]: { ...known, promoted: true, promotedBy: asString(p.by) } },
        promoted: state.promoted + 1,
        squads: { ...state.squads, [known.squad]: { ...owner, promoted: owner.promoted + 1 } },
      };
    }
    case "artifact.written": {
      const path = asString(p.path);
      const row: ArtifactRow = {
        path,
        version: asNumber(p.version) ?? 1,
        author: asString(p.author),
        size: asNumber(p.size) ?? 0,
        seq: event.seq,
        ts: event.ts_virtual,
      };
      return {
        ...state,
        artifacts: { ...state.artifacts, [path]: row },
        artifactOrder: state.artifacts[path] ? state.artifactOrder : [...state.artifactOrder, path],
      };
    }
    case "msg.sent": {
      const topic = asString(p.topic);
      return topic === "tool" || topic === "tool.result" ? foldSearch(state, topic, asRecord(p.body)) : state;
    }
    default:
      if (claimedBy(event.type) === "memory" && !MEMORY_TYPES.has(event.type)) {
        return { ...state, other: appendCapped(state.other, genericEntry(event), GENERIC_CAP) };
      }
      return state;
  }
}
