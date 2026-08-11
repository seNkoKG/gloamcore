import { describe, expect, it } from "vitest";
import { jewelSocketOverlayName, timelessJewelVisual } from "./jewel-visuals";

const jewel = (name: string, baseType: string, text = "") => ({ name, baseType, text });

describe("planner jewel visuals", () => {
  it("maps ordinary, cluster, abyss, and timeless jewels to PoB socket overlays", () => {
    expect(jewelSocketOverlayName(jewel("Rare", "Crimson Jewel"), false)).toBe("JewelSocketActiveRed");
    expect(jewelSocketOverlayName(jewel("Rare", "Cobalt Jewel"), true)).toBe("JewelSocketActiveBlueAlt");
    expect(jewelSocketOverlayName(jewel("Rare", "Large Cluster Jewel"), true)).toBe("JewelSocketActiveAltPurple");
    expect(jewelSocketOverlayName(jewel("Rare", "Murderous Eye Jewel"), false)).toBe("JewelSocketActiveAbyss");
    expect(jewelSocketOverlayName(jewel("Lethal Pride", "Timeless Jewel"), true)).toBe("JewelSocketActiveLegionAlt");
  });

  it("uses PoB's exact radius scale and family art for every timeless jewel", () => {
    expect(timelessJewelVisual(jewel("Lethal Pride", "Timeless Jewel", "Radius: Large"))).toEqual({
      family: "karui",
      radius: 1800,
      spriteNames: ["KaruiJewelCircle1", "KaruiJewelCircle2"],
    });
    expect(timelessJewelVisual(jewel("Brutal Restraint", "Timeless Jewel", "Radius: Massive"))?.radius).toBe(2880);
    expect(timelessJewelVisual(jewel("Glorious Vanity", "Timeless Jewel"))?.family).toBe("vaal");
    expect(timelessJewelVisual(jewel("Ordinary", "Crimson Jewel"))).toBeNull();
  });
});
