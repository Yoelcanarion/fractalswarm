// Cutting a message into the stretches that constraints were read from, so that each can be highlighted.

export interface Segment {
  text: string;
  /** Index of the constraint read from this stretch, or null for the text between. */
  constraint: number | null;
}

/** Where a constraint's source sits in the message: given as a character range, or as the sentence itself. */
export function spanOf(email: string, source: readonly [number, number] | string | undefined): [number, number] | null {
  if (Array.isArray(source)) {
    const [from, to] = source as [number, number];
    return Number.isInteger(from) && Number.isInteger(to) && from >= 0 && to <= email.length && from < to ? [from, to] : null;
  }
  if (typeof source === "string" && source.length > 0) {
    const at = email.indexOf(source);
    return at < 0 ? null : [at, at + source.length];
  }
  return null;
}

/** The message in order, split at the sources. A source that cannot be placed, or that overlaps an earlier one, is skipped
 * (the constraint is still listed; only its highlight is missing). */
export function segmentEmail(email: string, sources: readonly ([number, number] | null)[]): Segment[] {
  const placed = sources
    .map((span, constraint) => ({ span, constraint }))
    .filter((entry): entry is { span: [number, number]; constraint: number } => entry.span !== null)
    .sort((a, b) => a.span[0] - b.span[0]);

  const out: Segment[] = [];
  let cursor = 0;
  for (const { span, constraint } of placed) {
    if (span[0] < cursor) continue;
    if (span[0] > cursor) out.push({ text: email.slice(cursor, span[0]), constraint: null });
    out.push({ text: email.slice(span[0], span[1]), constraint });
    cursor = span[1];
  }
  if (cursor < email.length) out.push({ text: email.slice(cursor), constraint: null });
  return out;
}
