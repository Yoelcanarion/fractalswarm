// The bodies of the calls that read the pasted text and run the approved reading.

import { describe, expect, it } from "vitest";

import { parseArenaRoute } from "../arena/route";
import { canonicalBody } from "./spend";
import { BOX_LIMIT, chaosLabel, confirmed, DEFAULT_CHOICE, emptyForm, formProblems, launchBody, practiceTalks, readingBody, requestFor, roomsOf, scenarioLabel, specOf, startedRuns, untilRunsListed, watchHash } from "./launch";

describe("the form", () => {
  const filled = { ...emptyForm(), talks: "Submission 1 ..." };

  describe("with the practice reader", () => {
    const talk = (n: number) => `Submission ${n}\nTitle: Talk ${n}\nSpeaker: Ana Ruiz <a@example.invalid>\nTrack: Data Infra\nAbstract: Why it matters.`;
    const talks = (n: number) => Array.from({ length: n }, (_, i) => talk(i + 1)).join("\n\n");

    it("counts only the blocks it can read", () => {
      expect(practiceTalks(talks(3))).toBe(3);
      expect(practiceTalks("Title: A talk\nSpeaker: Ana Ruiz\nAbstract: No track.")).toBe(0);
      expect(practiceTalks("Rust for data engineers, by Ana Ruiz")).toBe(0);
    });

    it("says before a reading what would leave the review empty", () => {
      expect(formProblems({ ...emptyForm(), talks: talks(2) }, "fake")).toEqual(["The practice reader can read 2 of the 8 talks a program needs. It takes Title, Speaker, Track and Abstract lines, as in the sample text."]);
      expect(formProblems({ ...emptyForm(), talks: talks(8) }, "fake")).toEqual([]);
    });

    it("leaves Muse any wording", () => {
      expect(formProblems({ ...emptyForm(), talks: talks(2) }, "real")).toEqual([]);
    });
  });

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

  it("sends the token and the word with the same launch it priced, and the token is still bound to that launch", () => {
    const body = launchBody("intake-1", { ...DEFAULT_CHOICE, backend: "real" });
    const sent = confirmed(body, "tok-1", "SPEND");
    expect(sent).toEqual({ ...body, preflight_token: "tok-1", confirm: "SPEND" });
    // what the server binds the token to: nothing the token and the word add changes it
    expect(canonicalBody(sent)).toBe(canonicalBody(body));
    // and a changed setting does
    expect(canonicalBody(confirmed({ ...body, chaos: "C1" }, "tok-1", "SPEND"))).not.toBe(canonicalBody(body));
    // the launch it was built from is left as it was
    expect(body).not.toHaveProperty("preflight_token");
  });

  it("says where to watch: the arena for a pair, playing from its start at the speed of a whole run, the run page for one run", () => {
    expect(watchHash({ left: "p-swarm", right: "p-durable-max" })).toBe("#/arena/p-swarm/p-durable-max?speed=5&play");
    expect(parseArenaRoute(watchHash({ left: "p-swarm", right: "p-durable-max" }))?.playback).toEqual({ atMs: null, speed: 5, play: true });
    expect(watchHash({ run_id: "ui 1" })).toBe("#/run/ui%201");
  });

  it("names the runs a launch started: both sides of a pair, or the one run", () => {
    expect(startedRuns({ left: "p-swarm", right: "p-durable-max" })).toEqual(["p-swarm", "p-durable-max"]);
    expect(startedRuns({ run_id: "ui-1" })).toEqual(["ui-1"]);
  });

  it("words the choices the way the rest of the page does", () => {
    expect(scenarioLabel("swarm")).toBe("FractalSwarm");
    expect(scenarioLabel("durable-max")).toBe("Ideal durable supervisor");
    expect(chaosLabel("C0")).toBe("No failures (C0)");
    expect(chaosLabel("C2")).toBe("C2: 3 crashes");
    expect(chaosLabel("half-the-brains")).toContain("Half the brains");
  });
});

describe("what leaves the page", () => {
  const closed = { launch: false, reason: "Type SPEND to confirm." } as const;
  const open = { launch: true, token: "tok-1" } as const;

  it("sends a free launch as it is, with no token, whatever the gate says", () => {
    for (const body of [launchBody("i", DEFAULT_CHOICE), readingBody({ ...emptyForm(), talks: "x" }, "fake")]) {
      expect(requestFor(body, closed, "")).toEqual({ send: body });
      expect(requestFor(body, open, "SPEND")).toEqual({ send: body });
    }
  });

  it("sends a billed launch only through an open gate, with its token and word", () => {
    const body = launchBody("i", { ...DEFAULT_CHOICE, backend: "real" });
    expect(requestFor(body, closed, "")).toEqual({ refused: "Type SPEND to confirm." });
    expect(requestFor(body, open, "SPEND")).toEqual({ send: { ...body, preflight_token: "tok-1", confirm: "SPEND" } });
    const reading = readingBody({ ...emptyForm(), talks: "x" }, "real");
    expect(requestFor(reading, closed, "")).toHaveProperty("refused");
    expect(requestFor(reading, open, "SPEND")).toHaveProperty("send.confirm", "SPEND");
  });

  it("treats a body that does not say it is free as billed: the body decides, not the page's other state", () => {
    const unsaid = { ...launchBody("i", DEFAULT_CHOICE) };
    delete unsaid.backend;
    expect(requestFor(unsaid, closed, "")).toHaveProperty("refused");
    expect(requestFor({ ...unsaid, backend: "Fake" }, closed, "")).toHaveProperty("refused");
    // every choice the panel can make: a billed one is refused with the gate closed, a free one never carries a token
    for (const mode of ["pair", "run"] as const) {
      for (const backend of ["fake", "real"] as const) {
        const body = launchBody("i", { ...DEFAULT_CHOICE, mode, backend });
        expect("refused" in requestFor(body, closed, "")).toBe(backend === "real");
        expect(JSON.stringify(requestFor(body, closed, ""))).not.toContain("preflight_token");
      }
    }
  });
});

describe("waiting for a launch's runs", () => {
  const instant = async () => undefined;

  it("goes on at once when every run is listed", async () => {
    let asked = 0;
    const all = async () => (asked++, new Set(["a", "b", "other"]));
    expect(await untilRunsListed(all, ["a", "b"], { sleep: instant })).toBe(true);
    expect(asked).toBe(1);
  });

  it("asks again until the last run has come, and waits between the asks", async () => {
    let calls = 0;
    const waits: number[] = [];
    const lateRight = async () => new Set(++calls > 3 ? ["left", "right"] : ["left"]);
    expect(await untilRunsListed(lateRight, ["left", "right"], { everyMs: 250, sleep: async (ms) => void waits.push(ms) })).toBe(true);
    expect(waits).toEqual([250, 250, 250]);
  });

  it("gives up after its tries and says so, so the page opens anyway", async () => {
    let asked = 0;
    const never = async () => (asked++, new Set<string>());
    expect(await untilRunsListed(never, ["a"], { tries: 5, sleep: instant })).toBe(false);
    expect(asked).toBe(5);
  });
});
