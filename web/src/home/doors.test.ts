import { describe, expect, it } from "vitest";

import { parseAblationRoute } from "../ablation/route";
import { parseArenaRoute } from "../arena/route";
import { parseDirectorRoute } from "../director/route";
import { parseIntakeRoute } from "../intake/route";
import { DOORS, doorState, isStaticShowcase } from "./doors";
import { isHomeHash } from "./route";

describe("the menu at the end of the page", () => {
  it("has doors that are distinct and lead out of the home page", () => {
    expect(new Set(DOORS.map((door) => door.id)).size).toBe(DOORS.length);
    for (const door of DOORS) {
      expect(door.href.startsWith("#/"), door.id).toBe(true);
      expect(isHomeHash(door.href), `${door.id} would lead back to the home page`).toBe(false);
    }
  });

  it("leads each door to a page the app shell has", () => {
    const routes: Record<string, (hash: string) => unknown> = {
      arena: parseArenaRoute,
      live: parseIntakeRoute,
    };
    for (const door of DOORS) {
      const parse = routes[door.id];
      if (parse) expect(parse(door.href), `${door.id} (${door.href}) is not a route of the app`).not.toBeNull();
    }
  });

  it("is four doors, so that a row of four, two rows of two and a column all fill their grid", () => {
    expect(DOORS.map((door) => door.id)).toEqual(["arena", "live", "replays", "numbers"]);
  });

  it("keeps the Director and the ablation off the menu, and their routes in the app", () => {
    // the Director is a page of scenes for the video; the ablation says none has been recorded, and its door comes back when one is
    expect(DOORS.some((door) => door.id === "director" || door.href === "#/director")).toBe(false);
    expect(DOORS.some((door) => door.id === "ablation" || door.href === "#/ablation")).toBe(false);
    expect(parseDirectorRoute("#/director")).not.toBeNull();
    expect(parseAblationRoute("#/ablation")).not.toBeNull();
  });

  it("has no two doors that lead to the same place under two names", () => {
    expect(new Set(DOORS.map((door) => door.href)).size).toBe(DOORS.length);
  });

  it("opens every door in the local build", () => {
    for (const door of DOORS) expect(doorState(door, false)).toEqual({ open: true, note: null });
  });

  it("closes, in the static showcase, exactly the doors that need the local server, and says why", () => {
    for (const door of DOORS) {
      const state = doorState(door, true);
      expect(state.open, door.id).toBe(!door.needsServer);
      if (door.needsServer) expect(state.note, door.id).toMatch(/local server/);
    }
    expect(DOORS.some((door) => door.needsServer)).toBe(true);
    expect(DOORS.some((door) => !door.needsServer)).toBe(true);
  });

  it("knows the static build by the Vite mode W8 builds it with", () => {
    expect(isStaticShowcase("static")).toBe(true);
    expect(isStaticShowcase("production")).toBe(false);
    expect(isStaticShowcase("development")).toBe(false);
    expect(isStaticShowcase()).toBe(false); // the mode of the test run
  });
});
