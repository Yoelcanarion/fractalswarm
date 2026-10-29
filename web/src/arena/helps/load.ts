// Where the panel gets honesty.json: the server's copy when it has one, a bundled sample when it has none.

import { useEffect, useState } from "react";

import { asRecord } from "../../lib/generic";
import { looksLikeHonesty, parseHonesty, type Honesty } from "./honesty";

/** "api": read from the server. "sample": the bundled copy, shown as a sample because it may not be the bench's latest. */
export type HonestySource = "api" | "sample";

export type HonestyState =
  | { status: "loading" }
  | { status: "ready"; honesty: Honesty; source: HonestySource }
  | { status: "invalid"; reason: string; source: HonestySource };

const ENDPOINT = "api/bench/honesty";

export interface LoadDeps {
  /** The server's answer as JSON; null for anything that is not a file (a 404, an error page, no server). */
  fetchJson?: (url: string) => Promise<unknown | null>;
  /** The bundled sample. */
  sample?: () => Promise<unknown>;
}

async function fetchJson(url: string): Promise<unknown | null> {
  const response = await fetch(url);
  if (!response.ok) return null;
  return response.json();
}

// A lazy chunk: the sample is 360 KB and only the panel reads it.
const bundledSample = (): Promise<unknown> => import("./../fixtures/honesty.sample.json").then((module) => module.default);

/** The server's file wins. A file that is there but cannot be read is an error, never a quiet fall back to
 * the sample: the sample would show other numbers as if they were the file's. */
export async function loadHonesty({ fetchJson: get = fetchJson, sample = bundledSample }: LoadDeps = {}): Promise<HonestyState> {
  let served: unknown | null = null;
  try {
    served = await get(ENDPOINT);
  } catch {
    served = null;
  }
  // `/api/bench/results` wraps its file as `{source, fixture, data}`: take either form.
  const body = served !== null && !looksLikeHonesty(served) ? asRecord(served).data : served;
  if (body !== undefined && body !== null && looksLikeHonesty(body)) {
    const parsed = parseHonesty(body);
    return parsed.ok ? { status: "ready", honesty: parsed.honesty, source: "api" } : { status: "invalid", reason: parsed.reason, source: "api" };
  }
  const parsed = parseHonesty(await sample());
  return parsed.ok ? { status: "ready", honesty: parsed.honesty, source: "sample" } : { status: "invalid", reason: parsed.reason, source: "sample" };
}

export function useHonesty(): HonestyState {
  const [state, setState] = useState<HonestyState>({ status: "loading" });
  useEffect(() => {
    let live = true;
    void loadHonesty().then((next) => live && setState(next));
    return () => {
      live = false;
    };
  }, []);
  return state;
}
