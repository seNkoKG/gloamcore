import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { PassiveTreeNodeData } from "../types";
import { PassiveNodeTooltip } from "./BuildPlannerPanel";

vi.hoisted(() => {
  Object.assign(globalThis, { window: { location: { search: "" } } });
});

const socketNode: PassiveTreeNodeData = {
  id: 33753,
  name: "Basic Jewel Socket",
  stats: [],
  x: 0,
  y: 0,
  out: [],
  in: [],
  classStartIndex: null,
  classStartIds: [],
  ascendancyName: null,
  notable: false,
  keystone: false,
  mastery: false,
  jewelSocket: true,
  multipleChoice: false,
  bloodline: false,
};

describe("passive socket tooltip", () => {
  it("uses the shared item presentation for a real Lethal Pride and never exposes PoB serialization", () => {
    const markup = renderToStaticMarkup(<PassiveNodeTooltip
      hover={{ node: socketNode, x: 500, y: 300, width: 1200, height: 800 }}
      allocated
      previewPath={[]}
      dependents={new Set()}
      socketedItem={{
        id: 61419,
        name: "Lethal Pride",
        baseType: "Timeless Jewel",
        slot: "Jewel 33753",
        equipped: true,
        text: `Rarity: UNIQUE
Lethal Pride
Timeless Jewel
Unique ID: 079ce1fedf85bf140c7fe783ea10ecff16f6e054fc4dd06329a21f17b9bd0307
Prefix: {range:0.5}InternalTimelessPrefix
Suffix: InternalTimelessSuffix
Variant: Kaom
Variant: Rakiata
Selected Variant: 2
Radius: Large
Implicits: 0
{variant:1}Commanded leadership over 13796 warriors under Kaom
{variant:2}{fractured}Commanded leadership over 13796 warriors under Rakiata
Passives in radius are Conquered by the Karui
Historic
<ModRange id="1" range="0.5"/>`,
      }}
      usedMasteryEffects={new Set()}
      radiusSummary={null}
      selectedAscendancyName=""
      selectedSecondaryName=""
    />);

    expect(markup).toContain("Basic Jewel Socket");
    expect(markup).toContain("Lethal Pride");
    expect(markup).toContain("Timeless Jewel");
    expect(markup).toContain("Rakiata");
    expect(markup).toContain("13796 warriors under Rakiata");
    expect(markup).toContain("Fractured");
    expect(markup).toContain("Radius");
    expect(markup).not.toMatch(/Unique ID|InternalTimeless|Prefix:|Suffix:|ModRange|\{variant|\{fractured|#33753/);
  });
});
