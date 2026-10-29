import { describe, expect, it } from "vitest";

import { directorHash, parseDirectorRoute } from "./route";
import { missingSources, NO_SOURCES, resolveSources } from "./sources";

describe("the director's address", () => {
  it("is #/director for the list and #/director/<scene> for a scene", () => {
    expect(parseDirectorRoute("#/director")?.scene).toBeNull();
    expect(parseDirectorRoute("#/director/")?.scene).toBeNull();
    expect(parseDirectorRoute("#/director/s6-fair-fight")?.scene).toBe("s6-fair-fight");
    expect(parseDirectorRoute("#director/s6-fair-fight")?.scene).toBe("s6-fair-fight");
  });

  it("is not another page's", () => {
    for (const hash of ["", "#/", "#/arena/a/b", "#/run/director", "#/directors", "#/helps"]) expect(parseDirectorRoute(hash), hash).toBeNull();
  });

  it("carries the runs, hold and the readout in its query", () => {
    const route = parseDirectorRoute("#/director/s1-arena-open?swarm=a%20b&rival=r&hold&hud");
    expect(route?.query).toEqual({ swarm: "a b", rival: "r", run: null, ablation: null, hold: true, hud: true });
    expect(parseDirectorRoute("#/director/s4-lens?run=x&ablation=y")?.query).toMatchObject({ run: "x", ablation: "y", hold: false, hud: false });
    expect(parseDirectorRoute("#/director/s4-lens?swarm=")?.query.swarm).toBeNull();
  });

  it("is written back the way it is read", () => {
    expect(directorHash(null)).toBe("#/director");
    expect(directorHash("s1-arena-open")).toBe("#/director/s1-arena-open");
    expect(parseDirectorRoute(directorHash("a b"))?.scene).toBe("a b");
  });

  it("does not fail on an address that is not valid percent-encoding", () => {
    expect(parseDirectorRoute("#/director/100%")?.scene).toBe("100%");
  });
});

describe("the runs a scene plays", () => {
  const none = { swarm: null, rival: null, run: null, ablation: null };

  it("come from the manifest, and the address wins over it", () => {
    const manifest = { swarm: "m-swarm", rival: "m-rival", ablation: "m-abl" };
    expect(resolveSources(manifest, none)).toEqual({ swarm: "m-swarm", rival: "m-rival", run: "m-swarm", ablation: "m-abl" });
    expect(resolveSources(manifest, { ...none, swarm: "q-swarm", run: "q-run" })).toEqual({ swarm: "q-swarm", rival: "m-rival", run: "q-run", ablation: "m-abl" });
  });

  it("play the swarm on a run page unless a run is named", () => {
    expect(resolveSources({}, { ...none, swarm: "s" }).run).toBe("s");
    expect(resolveSources({ run: "r", swarm: "s" }, none).run).toBe("r");
  });

  it("leave nothing when nobody names one", () => {
    expect(resolveSources({}, none)).toEqual(NO_SOURCES);
  });

  it("say what a stage still needs, in the words of the address", () => {
    expect(missingSources("arena", NO_SOURCES)).toEqual(["swarm", "rival"]);
    expect(missingSources("arena", { ...NO_SOURCES, swarm: "s" })).toEqual(["rival"]);
    expect(missingSources("run", NO_SOURCES)).toEqual(["run"]);
    expect(missingSources("run", { ...NO_SOURCES, run: "r" })).toEqual([]);
    expect(missingSources("ablation", NO_SOURCES)).toEqual(["ablation"]);
    expect(missingSources("helps", NO_SOURCES)).toEqual([]);
    expect(missingSources("title", NO_SOURCES)).toEqual([]);
  });
});
