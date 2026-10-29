// Where the facts of the reading stand in the pasted text. The sample text is the real one: it repeats sentences
// ("Track: HCC track" under nine submissions), which is what a highlight must not get wrong.

import { describe, expect, it } from "vitest";

import { BLOCK_FIELDS, factKey, marksFor, nearest, occurrences, pieces, placeFacts, type Span } from "./highlight";
import { patchTalk } from "./edit";
import { museReading, museTexts } from "./testing";

describe("finding a sentence", () => {
  const texts = { talks: "Submission 1\nTrack: HCC  track\nAbstract: One.\n\nSubmission 2\nTrack: HCC track\nAbstract: Two.", notes: "Please:\n  a MORNING slot, thanks" };

  it("ignores spacing and case, as the server does when it checks a quote", () => {
    expect(occurrences("track: hcc track", texts)).toHaveLength(2);
    expect(occurrences("a morning slot,\nthanks", texts)).toEqual([{ box: "notes", start: 10, end: 32 }]);
  });

  it("gives the exact span in the text, so a mark covers the sentence and nothing else", () => {
    const [first] = occurrences("Track: HCC track", texts);
    expect(texts.talks.slice(first.start, first.end)).toBe("Track: HCC  track");
  });

  it("does not treat a sentence as a pattern: dots, brackets and the like are just characters", () => {
    expect(occurrences("(a+b)? [x].", { talks: "see (a+b)? [x]. and a+b" })).toEqual([{ box: "talks", start: 4, end: 15 }]);
    expect(occurrences(".*", { talks: "abc" })).toEqual([]);
  });

  it("finds nothing for an empty sentence or one that is not there", () => {
    expect(occurrences("   ", texts)).toEqual([]);
    expect(occurrences("a sentence nobody wrote", texts)).toEqual([]);
  });

  it("picks the occurrence nearest the anchor, in the anchor's own box", () => {
    const spans: Span[] = [
      { box: "talks", start: 0, end: 10 },
      { box: "talks", start: 100, end: 110 },
      { box: "notes", start: 52, end: 60 },
    ];
    expect(nearest(spans, { box: "talks", start: 120, end: 200 })).toEqual(spans[1]);
    expect(nearest(spans, { box: "talks", start: 12, end: 30 })).toEqual(spans[0]);
    expect(nearest(spans, null)).toEqual(spans[0]);
    expect(nearest([], null)).toBeNull();
    // with none in the anchor's box, any is better than none
    expect(nearest([spans[2]], { box: "talks", start: 0, end: 5 })).toEqual(spans[2]);
  });
});

describe("placing the facts of the real reading", () => {
  const muse = museReading();
  const texts = museTexts();
  const facts = placeFacts(muse, texts);
  const byKey = new Map(facts.map((fact) => [fact.key, fact]));
  const at = (kind: "talks" | "speakers", id: string, field: Parameters<typeof factKey>[2]) => byKey.get(factKey(kind, id, field));

  it("finds every quote the reading carries: this one is word for word", () => {
    expect(facts.length).toBeGreaterThan(50);
    expect(facts.filter((fact) => fact.span === null)).toEqual([]);
  });

  it("holds the sample to what the test is for: the same sentence stands under several submissions and emails", () => {
    const track = muse.talks.filter((talk) => occurrences(talk.track_source, texts).length > 1);
    const preference = muse.speakers.filter((s) => s.preference_source !== "" && occurrences(s.preference_source, texts).length > 1);
    expect(track.length).toBeGreaterThanOrEqual(9);
    expect(preference.length).toBeGreaterThanOrEqual(5);
  });

  it("puts each talk's track line in its own submission, not the first one that says the same", () => {
    const talks = texts.talks as string;
    const submissionAt = (offset: number) => talks.slice(0, offset).lastIndexOf("Submission ");
    for (const talk of muse.talks) {
      const abstract = at("talks", talk.id, "abstract")?.span;
      const track = at("talks", talk.id, "track_source")?.span;
      if (!abstract || !track) throw new Error(`${talk.id} was not placed`);
      expect(submissionAt(track.start), `${talk.id} track`).toBe(submissionAt(abstract.start));
    }
  });

  it("puts each speaker's preference sentence inside that speaker's own email", () => {
    for (const speaker of muse.speakers.filter((s) => s.preference_source !== "")) {
      const note = at("speakers", speaker.id, "note")?.span;
      const preference = at("speakers", speaker.id, "preference_source")?.span;
      if (!note || !preference) throw new Error(`${speaker.id} was not placed`);
      expect(preference.box).toBe(note.box);
      expect(preference.start).toBeGreaterThanOrEqual(note.start);
      expect(preference.end).toBeLessThanOrEqual(note.end);
    }
  });

  it("marks the quote itself: the text under a span is the sentence the row carries", () => {
    for (const fact of facts) {
      const span = fact.span as Span;
      const covered = (texts[span.box] as string).slice(span.start, span.end);
      expect(covered.split(/\s+/).join(" ").toLowerCase(), fact.key).toBe(fact.quote.split(/\s+/).join(" ").toLowerCase());
    }
  });

  it("leaves out what was not stated: no fact for an empty sentence", () => {
    const free = muse.speakers.find((s) => s.available === null);
    expect(free).toBeDefined();
    expect(byKey.has(factKey("speakers", (free as { id: string }).id, "availability_source"))).toBe(false);
  });

  it("says a quote is not there when it is not, and does not guess a place for it", () => {
    const reworded = patchTalk(muse, "T01", { attendance_source: "Roughly thirty people expected." });
    const fact = placeFacts(reworded, texts).find((f) => f.key === factKey("talks", "T01", "attendance_source"));
    expect(fact?.span).toBeNull();
  });

  it("still places a row's sentences by its title when its abstract was reworded", () => {
    const reworded = patchTalk(muse, "T03", { abstract: "A summary that is not in the text." });
    const placed = placeFacts(reworded, texts);
    expect(placed.find((f) => f.key === factKey("talks", "T03", "abstract"))?.span).toBeNull();
    const track = placed.find((f) => f.key === factKey("talks", "T03", "track_source"))?.span;
    const original = placeFacts(muse, texts).find((f) => f.key === factKey("talks", "T03", "track_source"))?.span;
    expect(track).toEqual(original);
  });
});

describe("cutting a box into pieces", () => {
  it("is the whole text, in order, with each piece knowing which marks cover it", () => {
    const body = "0123456789";
    const cut = pieces(body, [{ key: "a", start: 2, end: 6 }, { key: "b", start: 4, end: 8 }]);
    expect(cut.map((piece) => piece.text).join("")).toBe(body);
    expect(cut.map((piece) => [piece.text, piece.keys])).toEqual([
      ["01", []],
      ["23", ["a"]],
      ["45", ["a", "b"]],
      ["67", ["b"]],
      ["89", []],
    ]);
  });

  it("is one plain piece with no marks, and none for no text", () => {
    expect(pieces("abc", [])).toEqual([{ text: "abc", keys: [] }]);
    expect(pieces("", [])).toEqual([]);
  });

  it("ignores a mark that runs past the end", () => {
    expect(pieces("abc", [{ key: "a", start: 1, end: 99 }]).map((p) => p.text).join("")).toBe("abc");
  });
});

describe("what the pane marks", () => {
  const facts = placeFacts(museReading(), museTexts());

  it("marks the short sentences of every row, and the long quotes only for the row that is picked", () => {
    const none = marksFor(facts, "talks", null).map((mark) => mark.key);
    expect(none.length).toBeGreaterThan(10);
    expect(none.every((key) => !BLOCK_FIELDS.has(key.split(":")[2] as never))).toBe(true);
    const picked = marksFor(facts, "talks", { kind: "talks", id: "T01" }).map((mark) => mark.key);
    expect(picked).toContain(factKey("talks", "T01", "abstract"));
    expect(picked).not.toContain(factKey("talks", "T02", "abstract"));
  });

  it("keeps each box to its own marks", () => {
    const keys = (box: "talks" | "notes" | "conference") => marksFor(facts, box, { kind: "speakers", id: "S01" }).map((mark) => mark.key);
    expect(keys("notes")).toContain(factKey("speakers", "S01", "note"));
    expect(keys("talks").some((key) => key.startsWith("speakers"))).toBe(false);
    expect(keys("conference")).toEqual([]);
  });
});
