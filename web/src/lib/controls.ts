// Which controls a person can use right now, and why not when they cannot.
//
// A control acts on a live run, and only where the server really does it: a server that predates a
// control does not have it, so its button must not look usable. Two things decide it:
//
//   - the run's status in the catalog (`running` is live; a recording, a halted or an interrupted
//     run is not), and
//   - the capabilities the server reports (`GET api/capabilities`). A server that does not have the
//     endpoint, or does not list a control, does not offer it. Budget and halt predate the
//     endpoint and work, so they default to on.
//
// Everything here is pure; the store holds the status and the capabilities.

export type RunStatus = "running" | "completed" | "halted" | "interrupted" | "empty";

/** The statuses the catalog may send. Older servers only know the first three. */
export const RUN_STATUSES: readonly RunStatus[] = ["running", "completed", "halted", "interrupted", "empty"];

export const asRunStatus = (value: unknown): RunStatus | null =>
  typeof value === "string" && (RUN_STATUSES as readonly string[]).includes(value) ? (value as RunStatus) : null;

export type ControlKey = "chaos" | "approve" | "tasks" | "budget" | "halt";

export type Capabilities = Record<ControlKey, boolean> & {
  /** True only when the server allows billed launches and has a key. Absent on a server that does not say. */
  real?: boolean;
  /** True only on the static showcase, which has no server behind the API: its runs are recordings, and their replay checks were made when
   * the site was built. The exporter writes it (scripts/build_static_site.py); a server does not send it. */
  static?: boolean;
};

/** Where the app runs: on a server, or on the static showcase. What a page says about starting a run, and about when a recording was
 * checked, is not the same in the two. */
export type Site = "server" | "static";

export const siteOf = (capabilities: Capabilities): Site => (capabilities.static === true ? "static" : "server");

/** What a server without `GET api/capabilities` is taken to offer. */
export const DEFAULT_CAPABILITIES: Capabilities = { chaos: false, approve: false, tasks: false, budget: true, halt: true };

/** Controls that act on the open run. `tasks` starts a new one, so it needs no live run. */
const ACTS_ON_A_RUN: ReadonlySet<ControlKey> = new Set(["chaos", "approve", "budget", "halt"]);

export const LIVE_ONLY = "available on live runs";

export interface ControlState {
  enabled: boolean;
  /** Why it is off, for its tooltip. Empty when enabled. */
  reason: string;
}

export interface ControlContext {
  /** The open run's status in the catalog, or null before it is known. */
  status: RunStatus | null;
  capabilities: Capabilities;
}

/** What a control that is off says about itself: a server that lacks it, or the static showcase, where there is no server to lack anything
 * and the runs are recordings only. */
function offReason(control: ControlKey, capabilities: Capabilities): string {
  if (siteOf(capabilities) === "static") {
    return control === "tasks" ? "this site shows recorded runs only: to start one, run the app with uv run fractalswarm serve" : "this site shows recorded runs only";
  }
  return control === "tasks" ? "this server does not start runs from here" : "this server does not offer it yet";
}

export function controlState(control: ControlKey, { status, capabilities }: ControlContext): ControlState {
  // A recording comes first: whatever the server could do, there is nothing live to do it to.
  if (ACTS_ON_A_RUN.has(control) && status !== "running") return { enabled: false, reason: LIVE_ONLY };
  if (!capabilities[control]) return { enabled: false, reason: offReason(control, capabilities) };
  return { enabled: true, reason: "" };
}

/** Read the capabilities a server sent: any control it does not mention is off, any value that is
 * not `true` is off. */
export function parseCapabilities(body: unknown): Capabilities {
  const source = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  // The list may sit at the top or under `controls`.
  const listed = source.controls && typeof source.controls === "object" ? (source.controls as Record<string, unknown>) : source;
  const result = { ...DEFAULT_CAPABILITIES };
  for (const key of Object.keys(result) as ControlKey[]) result[key] = listed[key] === true;
  if ("real" in listed) result.real = listed.real === true;
  if ("static" in listed) result.static = listed.static === true;
  return result;
}

const STATUS_TEXT: Record<RunStatus, { label: string; tone: "live" | "muted" | "warn" | "bad"; hint: string }> = {
  running: { label: "● LIVE", tone: "live", hint: "the run is recording now" },
  completed: { label: "REPLAY", tone: "muted", hint: "a finished run: you are replaying its log" },
  halted: { label: "HALTED", tone: "warn", hint: "the run was stopped by a kill switch before it finished" },
  interrupted: { label: "INTERRUPTED", tone: "bad", hint: "the process that recorded this run died before the run completed" },
  empty: { label: "EMPTY", tone: "muted", hint: "the run has no events yet" },
};

/** How the top bar and the run list show a run's status. An unknown status is shown as it came. */
export function statusBadge(status: string | null): { label: string; tone: "live" | "muted" | "warn" | "bad"; hint: string } {
  const known = asRunStatus(status);
  if (known) return STATUS_TEXT[known];
  return { label: status ? status.toUpperCase() : "…", tone: "muted", hint: "" };
}
