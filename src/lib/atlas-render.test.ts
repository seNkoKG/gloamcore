import { describe, expect, it } from "vitest";
import { atlasConnectorArc } from "./atlas-render";

describe("atlasConnectorArc", () => {
  it("uses the short sweep when an orbit connection crosses the angle boundary", () => {
    const degrees = (value: number) => value * Math.PI / 180;
    const point = (angle: number) => ({ x: Math.cos(angle), y: Math.sin(angle) });
    const arc = atlasConnectorArc({ x: 0, y: 0 }, point(degrees(350)), point(degrees(10)));

    expect(arc.endAngle - arc.startAngle).toBeCloseTo(degrees(20));
    expect(arc.anticlockwise).toBe(false);
  });

  it("preserves a short anticlockwise orbit connection", () => {
    const arc = atlasConnectorArc({ x: 10, y: 20 }, { x: 10, y: 10 }, { x: 0, y: 20 });

    expect(arc.endAngle - arc.startAngle).toBeCloseTo(-Math.PI / 2);
    expect(arc.anticlockwise).toBe(true);
  });
});
