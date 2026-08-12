import { describe, expect, it } from "vitest";
import { routeStepIsVisible } from "./CommandCenterPanel";
import type { NavigatorRouteStep } from "../lib/game-data";

function step(conditions: string[]): NavigatorRouteStep {
  return { id: "test", act: 2, label: "Test", kind: "action", areaIds: [], questIds: [], conditions };
}

describe("League Navigator route branches", () => {
  it("selects exactly the requested bandit branch", () => {
    expect(routeStepIsVisible(step(["BANDIT_KILL"]), "kill", false)).toBe(true);
    expect(routeStepIsVisible(step(["!BANDIT_KILL"]), "alira", false)).toBe(true);
    expect(routeStepIsVisible(step(["BANDIT_ALIRA"]), "alira", false)).toBe(true);
    expect(routeStepIsVisible(step(["BANDIT_ALIRA"]), "oak", false)).toBe(false);
  });

  it("includes the optional Library route only when enabled", () => {
    expect(routeStepIsVisible(step(["LIBRARY"]), "kill", true)).toBe(true);
    expect(routeStepIsVisible(step(["LIBRARY"]), "kill", false)).toBe(false);
  });

  it("fails closed for an unknown future directive", () => {
    expect(routeStepIsVisible(step(["UNREVIEWED_BRANCH"]), "kill", true)).toBe(false);
  });
});
