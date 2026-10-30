// The rule that picks an heir, in TypeScript: `coord/hrw.py` (bounded-load rendezvous hashing) and `stable_hash` of `kernel/ids.py`,
// line for line. The click demo runs it, because that is what a visitor is told happens when a coordinator dies: every survivor
// computes the same answer from the same inputs, so nobody votes. rule.test.ts holds it to the values Python gives and to every
// score of the recorded run (`story.hrw.rounds`).
//
// Left out on purpose: `assign` (the first assignment of keys, which the demo never makes).

import { blake2b8 } from "./blake2b";

export const EPSILON = 0.25;

const encoder = new TextEncoder();
const HEX = Array.from({ length: 256 }, (_, i) => i.toString(16).padStart(2, "0"));

/**
 * `stable_hash("hrw", key, member)` as the 16 hex digits the recorded run keeps: the digest of the canonical JSON of the list,
 * which for these three strings is `JSON.stringify` (sorted keys do not matter in a list, and there is no space).
 */
export function scoreHex(key: string, member: string): string {
  const digest = blake2b8(encoder.encode(JSON.stringify(["hrw", key, member])));
  return Array.from(digest, (byte) => HEX[byte]!).join("");
}

export const scoreOf = (key: string, member: string): bigint => BigInt(`0x${scoreHex(key, member)}`);

/** A score as a share of the range it comes from (0..1), which is how the recorded run states it. */
export const fractionOf = (hex: string): number => Number(BigInt(`0x${hex}`)) / 2 ** 64;

/** Members from most to least preferred for `key` (ties by member id). */
export function rank(key: string, members: Iterable<string>): string[] {
  const scored = [...new Set(members)].map((member) => ({ member, score: scoreOf(key, member) }));
  scored.sort((a, b) => (a.score === b.score ? (a.member < b.member ? -1 : a.member > b.member ? 1 : 0) : a.score > b.score ? -1 : 1));
  return scored.map((s) => s.member);
}

export function capacity(keys: number, members: number, epsilon = EPSILON): number {
  if (members <= 0) throw new Error("no members to assign to");
  return Math.max(1, Math.ceil(((1 + epsilon) * keys) / members));
}

/** Keys in (priority descending, key) order. */
function ordered(priorities: Readonly<Record<string, number>>): string[] {
  return Object.keys(priorities).sort((a, b) => {
    const d = (priorities[b] ?? 0) - (priorities[a] ?? 0);
    return d !== 0 ? d : a < b ? -1 : a > b ? 1 : 0;
  });
}

/**
 * The takeover form: survivors keep their keys and only the orphans move. `owners` maps each key to its current owner, `alive`
 * is who may own now; the result maps every key to its owner after the move.
 */
export function remap(
  owners: Readonly<Record<string, string>>,
  alive: Iterable<string>,
  priorities: Readonly<Record<string, number>> = {},
  epsilon = EPSILON,
): Record<string, string> {
  const pool = [...new Set(alive)].sort();
  if (pool.length === 0) throw new Error("no live members to remap to");
  const bound = capacity(Object.keys(owners).length, pool.length, epsilon);
  const kept: Record<string, string> = {};
  const load: Record<string, number> = Object.fromEntries(pool.map((member) => [member, 0]));
  for (const [key, owner] of Object.entries(owners)) {
    if (pool.includes(owner)) {
      kept[key] = owner;
      load[owner] = (load[owner] ?? 0) + 1;
    }
  }
  const orphans = Object.fromEntries(Object.keys(owners).filter((key) => !(key in kept)).map((key) => [key, priorities[key] ?? 0]));
  for (const key of ordered(orphans)) {
    const ranked = rank(key, pool);
    const owner = ranked.find((member) => (load[member] ?? 0) < bound) ?? ranked[0]!;
    kept[key] = owner;
    load[owner] = (load[owner] ?? 0) + 1;
  }
  return kept;
}
