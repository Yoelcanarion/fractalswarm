// The bodies of the calls that read the pasted text and run the approved reading.

import { describe, expect, it } from "vitest";

import { BOX_LIMIT, chaosLabel, DEFAULT_CHOICE, emptyForm, formProblems, launchBody, readingBody, roomsOf, scenarioLabel, specOf, watchHash } from "./launch";

describe("the form", () => {
  const filled = { ...emptyForm(), talks: "Submission 1 ..." };

  it("needs talks, and nothing else", () => {
    expect(formProblems(emptyForm())).toEqual(["Paste the talks: titles, speakers, abstracts."]);
    expect(formProblems({ ...emptyForm(), talks: "  \n " })).toHaveLength(1);
    expect(formProblems(filled)).toEqual([]);
  });

  it("stops at the server's limit for a box", () => {
    expect(formProblems({ ...filled, notes: "x".repeat(BOX_LIMIT + 1) })).toEqual([`The notes box is over 200,000 characters.`]);
    expect(formProblems({ ...filled, notes: "x".repeat(BOX_LIMIT) })).toEqual([]);
  });

  it("sends only what the person filled in, and the backend it was told", () => {
    expect(readingBody(filled, "fake")).toEqual({ talks: "Submission 1 ...", names: false, backend: "fake" });
    const full = { ...filled, conference: "  DevConf  ", notes: "Hi", names: true, rooms: [{ name: "Hall A", capacity: "200" }, { name: " Room  B ", capacity: "60" }] };
    expect(readingBody(full, "real")).toEqual({
      talks: "Submission 1 ...",
      notes: "Hi",
      conference: "DevConf",
      rooms: [{ name: "Hall A", capacity: 200 }, { name: "Room B", capacity: 60 }],
      names: true,
      backend: "real",
    });
  });

  it("leaves the pasted text exactly as it was typed", () => {
    const text = "  indented\n\nlines  \t";
    expect(readingBody({ ...filled, talks: text }, "fake").talks).toBe(text);
  });
});

describe("the rooms", () => {
  it("are optional: none filled in means the server's default four", () => {
    expect(roomsOf([])).toEqual({ rooms: [], problems: [] });
    expect(roomsOf([{ name: "", capacity: "" }, { name: " ", capacity: " " }])).toEqual({ rooms: [], problems: [] });
  });

  it("name a row that is half filled in, or has a capacity that is not one", () => {
    expect(roomsOf([{ name: "", capacity: "50" }]).problems).toEqual(["room 1 has a capacity but no name"]);
    expect(roomsOf([{ name: "A", capacity: "" }, { name: "B", capacity: "0" }, { name: "C", capacity: "12x" }, { name: "D", capacity: "-4" }]).problems).toEqual([
      "room A needs a capacity of at least 1",
      "room B needs a capacity of at least 1",
      "room C needs a capacity of at least 1",
      "room D needs a capacity of at least 1",
    ]);
  });

  it("need two, because the root gives each track a home room that is not the largest", () => {
    expect(roomsOf([{ name: "Hall", capacity: "100" }]).problems).toEqual(["give at least 2 rooms, or none to use the default rooms"]);
    expect(formProblems({ ...emptyForm(), talks: "x", rooms: [{ name: "Hall", capacity: "100" }] })).toEqual(["Give at least 2 rooms, or none to use the default rooms."]);
  });
});

describe("running the approved reading", () => {
  it("is the arena pair on the default failure plan, on the simulated clock and the fake LLM, until told otherwise", () => {
    expect(DEFAULT_CHOICE).toMatchObject({ mode: "pair", rival: "durable-max", pairChaos: "half-the-brains", clock: "sim", backend: "fake" });
  });

  it("names the intake in a spec the same for both sides of a pair", () => {
    expect(specOf("intake-1")).toEqual({ goal: "Program the live conference", task: "t2_conference", inputs: { intake: "intake-1" }, seed: "1" });
    const pair = launchBody("intake-1", DEFAULT_CHOICE);
    expect(pair).toEqual({ spec: specOf("intake-1"), rival: "durable-max", chaos: "half-the-brains", clock: "sim", backend: "fake" });
    expect(launchBody("intake-1", { ...DEFAULT_CHOICE, rival: "central" }).rival).toBe("central");
  });

  it("is one run of a system under a failure profile when that is chosen", () => {
    const run = launchBody("intake-1", { ...DEFAULT_CHOICE, mode: "run", scenario: "durable", runChaos: "C2" });
    expect(run).toEqual({ spec: specOf("intake-1"), scenario: "durable", chaos: "C2", clock: "sim", backend: "fake" });
    expect(run).not.toHaveProperty("rival");
  });

  it("sends the speed only on the live clock, and the backend it was told", () => {
    expect(launchBody("i", { ...DEFAULT_CHOICE, clock: "live", speed: 4 })).toMatchObject({ clock: "live", speed: 4 });
    expect(launchBody("i", DEFAULT_CHOICE)).not.toHaveProperty("speed");
    expect(launchBody("i", { ...DEFAULT_CHOICE, backend: "real" }).backend).toBe("real");
  });

  it("says where to watch: the arena for a pair, the run page for one run", () => {
    expect(watchHash({ left: "p-swarm", right: "p-durable-max" })).toBe("#/arena/p-swarm/p-durable-max");
    expect(watchHash({ run_id: "ui 1" })).toBe("#/run/ui%201");
  });

  it("words the choices the way the rest of the page does", () => {
    expect(scenarioLabel("swarm")).toBe("FractalSwarm");
    expect(scenarioLabel("durable-max")).toBe("Ideal durable supervisor");
    expect(chaosLabel("C0")).toBe("No failures (C0)");
    expect(chaosLabel("C2")).toBe("C2: 3 crashes");
    expect(chaosLabel("half-the-brains")).toContain("Half the brains");
  });
});
