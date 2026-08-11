import { describe, expect, it } from "vitest";
import type { PassiveTreeData } from "../../types";
import { defaultPassiveTreeViewport, passiveTreeViewportWithCircles } from "./passive-render";

const tree = {
  size: 23_747.9,
  bounds: { minX: -14_159, minY: -10_689, maxX: 12_430, maxY: 10_900 },
} as PassiveTreeData;

describe("passive tree viewport", () => {
  it("preserves PoB's default view when no radius overlays are active", () => {
    expect(passiveTreeViewportWithCircles(tree, 1_148, 701, []))
      .toEqual(defaultPassiveTreeViewport(tree, 1_148, 701));
  });

  it("keeps an edge socket's full timeless-jewel radius inside the canvas", () => {
    const width = 1_148;
    const height = 701;
    const padding = 10;
    const circle = { x: 157.825, y: -6_767.07, radius: 1_800 };
    const view = passiveTreeViewportWithCircles(tree, width, height, [circle], padding);
    const x = circle.x * view.scale + view.x;
    const y = circle.y * view.scale + view.y;
    const radius = circle.radius * view.scale;

    expect(x - radius).toBeGreaterThanOrEqual(padding - 0.001);
    expect(x + radius).toBeLessThanOrEqual(width - padding + 0.001);
    expect(y - radius).toBeGreaterThanOrEqual(padding - 0.001);
    expect(y + radius).toBeLessThanOrEqual(height - padding + 0.001);
  });
});
