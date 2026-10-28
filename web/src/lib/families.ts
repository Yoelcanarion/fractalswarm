// Which supporting panel an event type belongs to, by name alone.
//
// The panels read the fields of the event types registered today. Other workers add families
// while the panels are written (market epochs and bids, channel and topic breakers, cross-squad
// audits, risk scores, feasibility reports), so a type the panels do not know is routed by its
// name: it shows up as a generic row in the panel that claims its family, and in the event list.
// A panel claims a type when the first segment of the type is one of its roots, or any segment
// is one of its words (``market.epoch.closed``, ``budget.epoch``, ``breaker.channel.opened``).

export type PanelId = "market" | "limits" | "breakers" | "memory" | "collisions" | "escalations" | "results";

interface Claim {
  roots: readonly string[];
  words: readonly string[];
}

// Order matters when two panels claim the same type: the first listed wins.
const CLAIMS: readonly (readonly [PanelId, Claim])[] = [
  ["breakers", { roots: ["breaker", "circuit", "mailbox"], words: ["breaker", "pingpong", "ping_pong", "storm", "mailbox"] }],
  [
    "limits",
    {
      roots: ["ratelimit", "rate_limit", "quota", "aimd", "throttle", "bucket"],
      words: ["quota", "aimd", "ratelimit", "throttle"],
    },
  ],
  ["collisions", { roots: ["collision", "lease", "arbitration", "arbiter", "conflict"], words: ["collision", "arbitration"] }],
  ["memory", { roots: ["fact", "artifact", "memory", "blackboard"], words: ["memory"] }],
  ["escalations", { roots: ["escalation", "replan"], words: ["escalation", "replan"] }],
  ["results", { roots: ["task", "audit", "result"], words: ["audit"] }],
  [
    "market",
    {
      roots: ["budget", "market", "epoch", "auction", "bid", "topup", "ledger", "price", "feasibility", "risk", "scaling"],
      words: ["epoch", "bid", "bids", "auction", "topup", "allocation", "feasibility", "risk"],
    },
  ],
];

export function claimedBy(type: string): PanelId | null {
  const segments = type.split(".");
  for (const [panel, claim] of CLAIMS) {
    if (claim.roots.includes(segments[0]) || segments.some((segment) => claim.words.includes(segment))) return panel;
  }
  return null;
}
