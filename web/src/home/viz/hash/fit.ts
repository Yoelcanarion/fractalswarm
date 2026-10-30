// What the strip draws in the box the page gives it. In full it is the log as cards (the event, its actor, its
// hash and the hash of the one before it) with the head hash and the verdict under them. In less height the
// cards lose their actor and keep their hashes on one line, and in less again they are a line each: the chain
// (each card holds the hash of the one before) and the verdict stay, the detail goes.

export type HashTier = "full" | "compact" | "mini";

/** What the box is before it is measured (and on the server): tall enough for everything. */
export const HASH_DEFAULT_BOX = { width: 690, height: 270 };

/** The least height each tier needs, measured in the lab (see the notes). */
export const HASH_FULL_MIN = 262;
export const HASH_COMPACT_MIN = 158;

export const fitHash = (height: number): HashTier => (height >= HASH_FULL_MIN ? "full" : height >= HASH_COMPACT_MIN ? "compact" : "mini");
