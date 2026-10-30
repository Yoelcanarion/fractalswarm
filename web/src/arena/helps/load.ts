// Where the panel gets honesty.json: GET /api/bench/honesty, the committed file as it is. There is no
// bundled copy to fall back on, because a copy could drift from the committed results.

import { useCallback, useEffect, useState } from "react";

import { parseHonesty, type Honesty } from "./honesty";

export type HonestyState =
  | { status: "loading" }
  | { status: "ready"; honesty: Honesty }
  /** The server answered 404: the bench has not written the file. */
  | { status: "missing" }
  /** No server, or an error from it. */
  | { status: "unreachable"; reason: string }
  /** The file is there but this panel cannot read it. */
  | { status: "invalid"; reason: string };

const ENDPOINT = "api/bench/honesty";

/** What asking the server for the file came to. */
export type Fetched = { kind: "file"; body: unknown } | { kind: "missing" } | { kind: "failed"; reason: string };

async function fetchFile(url: string): Promise<Fetched> {
  try {
    const response = await fetch(url);
    if (response.status === 404) return { kind: "missing" };
    if (!response.ok) return { kind: "failed", reason: `the server answered ${response.status}` };
    return { kind: "file", body: await response.json() };
  } catch (error) {
    return { kind: "failed", reason: error instanceof Error ? error.message : String(error) };
  }
}

export async function loadHonesty(get: (url: string) => Promise<Fetched> = fetchFile): Promise<HonestyState> {
  const got = await get(ENDPOINT);
  if (got.kind === "missing") return { status: "missing" };
  if (got.kind === "failed") return { status: "unreachable", reason: got.reason };
  const parsed = parseHonesty(got.body);
  return parsed.ok ? { status: "ready", honesty: parsed.honesty } : { status: "invalid", reason: parsed.reason };
}

const LOADING: HonestyState = { status: "loading" };

/** The file's state, and a way to ask the server for it again: after "not there yet" or a failure, a person should not have to reload the page. */
export function useHonesty(): { state: HonestyState; reload: () => void } {
  const [state, setState] = useState<HonestyState>(LOADING);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let live = true;
    setState(LOADING);
    void loadHonesty().then((next) => live && setState(next));
    return () => {
      live = false;
    };
  }, [attempt]);
  const reload = useCallback(() => setAttempt((n) => n + 1), []);
  return { state, reload };
}
