// What an address can ask the page's folded parts to do. Every fold of the app is the one Details component, and a fold with an id opens
// when the address says so: `#/run/demo-final?at=end&details=lens,feed`. The director opens the part a scene points at this way, and so
// can a link. Pure.

/** The ids an address asks to have open. */
export function detailsAskedFor(hash: string): string[] {
  const query = hash.split("?")[1] ?? "";
  const asked = new URLSearchParams(query).get("details");
  return asked === null ? [] : asked.split(",").map((id) => id.trim()).filter((id) => id !== "");
}

/** Whether the address asks for the fold with this id to be open. */
export const opensDetails = (hash: string, id: string | undefined): boolean => id !== undefined && detailsAskedFor(hash).includes(id);

/** The address with a fold added to the ones it asks for, for a link that must land on an open fold. */
export function withDetails(hash: string, id: string): string {
  if (opensDetails(hash, id)) return hash;
  const [path, query = ""] = hash.split("?");
  const params = new URLSearchParams(query);
  params.set("details", [...detailsAskedFor(hash), id].join(","));
  return `${path}?${params.toString().replace(/%2C/g, ",")}`;
}
