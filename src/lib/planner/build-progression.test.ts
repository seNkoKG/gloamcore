import { describe, expect, it } from "vitest";
import { emptyPobBuild, type ImportedPobItem } from "./pob-build";
import { derivePobBuildProgression, pobGearTradeHandoff } from "./build-progression";

describe("PoB-authored build progression", () => {
  it("uses authored titles and exact node deltas without inventing acts or levels", () => {
    const build = emptyPobBuild("Scion");
    build.specs = [
      { id: "a", title: "Early", treeVersion: "3_29", classId: 0, ascendClassId: 0, secondaryAscendClassId: 0, nodes: [1, 2], masteryEffects: {} },
      { id: "b", title: "Later", treeVersion: "3_29", classId: 0, ascendClassId: 0, secondaryAscendClassId: 0, nodes: [2, 3], masteryEffects: {} },
    ];
    expect(derivePobBuildProgression(build).passive).toMatchObject([
      { title: "Early", added: ["Passive #1", "Passive #2"], removed: [] },
      { title: "Later", added: ["Passive #3"], removed: ["Passive #1"] },
    ]);
  });

  it("opens exact unique identity searches but labels non-unique gear base-only", () => {
    const item = (text: string, name: string): ImportedPobItem => ({
      id: 1, text, name, baseType: "Vaal Regalia", slot: "Body Armour", equipped: true,
    });
    expect(pobGearTradeHandoff(item("Rarity: UNIQUE", "Shavronne's Wrappings"), "Standard"))
      .toMatchObject({ scope: "unique-identity", label: "Exact unique identity" });
    const rare = pobGearTradeHandoff(item("Rarity: Rare", "Doom Mantle"), "Standard");
    expect(rare).toMatchObject({ scope: "base-only", label: "Base type only" });
    expect(decodeURIComponent(rare!.url)).not.toContain("Doom Mantle");
  });
});
