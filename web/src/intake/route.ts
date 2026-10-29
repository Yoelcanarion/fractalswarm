// The intake page's address: `#/new` is the form, `#/new/<intake id>` a reading on the server (being read, to review,
// approved, or stopped). The address names the reading, so a reload or a shared link lands on it; what the person typed
// into a row stays in the page, and the server holds only what was approved.

export interface IntakeRoute {
  intakeId: string | null;
}

export function parseIntakeRoute(hash: string): IntakeRoute | null {
  const [path] = hash.replace(/^#\/?/, "").split("?");
  const parts = path.split("/");
  if (parts[0] !== "new") return null;
  return { intakeId: parts[1] ? decodeURIComponent(parts[1]) : null };
}

export const intakeHash = (intakeId: string | null): string => (intakeId === null ? "#/new" : `#/new/${encodeURIComponent(intakeId)}`);
