// Helpers for unit tests: synthetic events in the kernel's envelope, and the golden bundles.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import type { RunEvent } from "./types";

export const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));

export function loadJsonl(relativePath: string): RunEvent[] {
  return readFileSync(REPO_ROOT + relativePath, "utf-8")
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line) as RunEvent);
}

/** Builds a stream of events with consecutive seqs. */
export class Stream {
  events: RunEvent[] = [];
  ts = 0;
  epoch = 0;

  at(ts: number): this {
    this.ts = ts;
    return this;
  }

  emit(type: string, actor: string, payload: Record<string, unknown> = {}): this {
    const seq = this.events.length + 1;
    if (type === "member.dead") this.epoch += 1;
    this.events.push({
      seq,
      run_id: "synthetic",
      ts_virtual: this.ts,
      lamport: seq,
      member_epoch: this.epoch,
      market_epoch: 0,
      type,
      actor,
      causation_id: null,
      correlation_id: null,
      idem_key: `${type}:${seq}`,
      payload,
      prev_hash: "",
      hash: `h${seq}`,
    });
    return this;
  }

  spawn(id: string, kind: string, parent: string | null): this {
    return this.emit("actor.spawned", parent ?? "@kernel", { actor_id: id, kind, args: {}, parent });
  }
}

/** The T2 demo shape: root → 3 tracks → 2 sessions each (10 orchestrators), 1 agent per session. */
export function depthTwoTree(): Stream {
  const s = new Stream().emit("run.started", "@kernel", { seed: "0", scenario: "t2", params: {}, clock: "sim" });
  s.spawn("root", "root", null);
  for (const track of ["t1", "t2", "t3"]) {
    s.spawn(track, "track", "root");
    for (const day of ["d1", "d2"]) {
      const session = `${track}-${day}`;
      s.spawn(session, "session", track);
      s.spawn(`${session}-a`, "agent", session);
    }
  }
  return s;
}
