// The answers of a server that is not there. Where the static showcase cannot do what the API does, it answers with
// the status the local server gives for a feature that is off, so the fallbacks the app already has run unchanged
// (`fetchCapabilities`, `fetchTakeover`, `postControl` and the pages' own error states read the status), and with the
// reason in the server's own `{error}` shape, so a person reads why instead of a bare code.

export const NOTE = "this is the static showcase: recorded runs only";
export const COMMAND = "uv run fractalswarm demo --verify";

export const JSON_HEADERS = { "Content-Type": "application/json" };

export const jsonResponse = (status: number, body: unknown): Response => new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });

/** The response of `http_error` in api/app.py: `{"error": reason}`. */
export const refusal = (status: number, reason: string): Response => jsonResponse(status, { error: reason });

/** A feature that needs the server (starting a run, reading pasted text). The local server answers 503 for these when
 * it was started without a private directory, which the app already takes to mean "not offered here". */
export const needsServer = (what: string): Response =>
  refusal(503, `${what} needs the local server: ${NOTE}. Run it yourself: ${COMMAND}`);

/** A control on a recording. The local server answers 409 for every run that is not live. */
export const notLive = (what: string, id: string): Response => refusal(409, `${what} '${id}' is a recording, not a live run (${NOTE})`);

export const unknownRun = (id: string, known: readonly string[]): Response =>
  refusal(404, `no run '${id}' in this showcase, which holds ${known.length === 0 ? "no runs" : known.join(", ")}. Run it yourself: ${COMMAND}`);

export const unknownCall = (effectId: string, runId: string): Response => refusal(404, `no LLM call '${effectId}' in run '${runId}'`);

export const notFound = (path: string): Response => refusal(404, `Not Found: ${path} is not part of the static showcase`);

export const methodNotAllowed = (): Response => refusal(405, "Method Not Allowed");

/** A data file that did not load: the site was published incompletely, which is not the visitor's doing. */
export const missingFile = (file: string, status: number): Response =>
  refusal(502, `the showcase's data file ${file} did not load (${status}); the site was not published completely`);
