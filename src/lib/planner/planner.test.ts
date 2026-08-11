import { describe, expect, it } from "vitest";
import type { PassiveTreeData, PassiveTreeNodeData } from "../../types";
import { emptyPobBuild, enrichPobBuildWithCharacterAssets, itemsWithPassiveSpecLoadout, parsePobXml, pobStatPercent, serializePobXml, specsWithActiveJewelLoadout } from "./pob-build";
import { applyImportedMasteryEffects } from "./cluster-jewel-graph";
import {
  comparePlannerBuilds,
  createPlannerSnapshot,
  formatPobStatValue,
  MAX_SAVED_PLANNER_LIBRARY_BYTES,
  parseActivePlannerWorkspace,
  parseSavedPlannerBuilds,
  recoverSavedPlannerLibrary,
  RETIRED_PLANNER_FORMAT,
  SavedPlannerLibraryError,
  sanitizePlannerSnapshot,
  serializeActivePlannerWorkspace,
  serializeSavedPlannerBuilds,
  upsertSavedPlannerBuild,
} from "./planner-workspace";
import {
  allocatePassivePath,
  buildPassiveAllocationContext,
  countAllocatedPassivePoints,
  dependentAllocatedNodes,
  extendPassiveTracePath,
  isAllocatedClassConnected,
  refundNodeAndDependents,
  retainConnectedAllocatedPassives,
  searchPassiveNodes,
  shortestAllocationPath,
  summarizeAllocatedStats,
} from "./passive-graph";
import {
  defaultPassiveTreeViewport,
  orderedMasteryEffects,
  passiveTreeConnections,
  resizedPassiveTreeViewport,
  visiblePassiveNodes,
} from "./passive-render";

const node = (id: number, out: number[], extra: Partial<PassiveTreeNodeData> = {}): PassiveTreeNodeData => ({
  id,
  name: `Node ${id}`,
  stats: [],
  x: id * 100,
  y: 0,
  out,
  in: [],
  classStartIndex: null,
  classStartIds: [],
  ascendancyName: null,
  notable: false,
  keystone: false,
  mastery: false,
  jewelSocket: false,
  multipleChoice: false,
  bloodline: false,
  ...extra,
});

const tree: PassiveTreeData = {
  game: "poe1",
  version: "3_29",
  sourcePath: "tree.lua",
  bounds: { minX: 0, minY: 0, maxX: 400, maxY: 0 },
  classes: [{ id: 0, name: "Scion", ascendancies: [] }],
  points: { total: 123, ascendancy: 8 },
  nodes: [
    node(1, [2], { classStartIndex: 0, classStartIds: [0] }),
    node(2, [1, 3, 4], { stats: ["+10% increased maximum Life"] }),
    node(3, [2]),
    node(4, [2, 5], { notable: true, name: "Vitality Void" }),
    node(5, [4]),
  ],
};

describe("passive graph behavior", () => {
  it("allocates the shortest path from the current tree", () => {
    expect(shortestAllocationPath(tree, new Set([1]), 5, 0)).toEqual([2, 4, 5]);
  });

  it("refunds dependent disconnected branches", () => {
    expect([...refundNodeAndDependents(tree, new Set([1, 2, 3, 4, 5]), 2, 0)]).toEqual([1]);
  });

  it("matches PoB path boundaries for starts, masteries, and Ascendant Path nodes", () => {
    const pathTree = {
      ...tree,
      nodes: [
        node(1, [2], { classStartIndex: 0, classStartIds: [0] }),
        node(2, [1, 30]),
        node(30, [2, 31], { mastery: true }),
        node(31, [30]),
        node(10, [11], { ascendancyName: "Ascendant", isAscendancyStart: true }),
        node(11, [10, 20], { ascendancyName: "Ascendant", name: "Path of the Witch" }),
        node(20, [11]),
        node(40, [41], { ascendancyName: "Elementalist", isAscendancyStart: true }),
        node(41, [40], { ascendancyName: "Elementalist" }),
      ],
    };
    expect(shortestAllocationPath(pathTree, new Set([1]), 31, 0)).toEqual([]);
    expect(shortestAllocationPath(pathTree, new Set([1, 10, 11]), 20, 0, "Ascendant")).toEqual([20]);
    expect(shortestAllocationPath(pathTree, new Set([1, 10]), 41, 0, "Ascendant")).toEqual([]);
  });

  it("retains selected ascendancy roots on refund and enforces multiple-choice siblings", () => {
    const choiceTree = {
      ...tree,
      nodes: [
        node(1, [2], { classStartIndex: 0, classStartIds: [0] }),
        node(2, [1, 3]),
        node(3, [2, 4, 5], { multipleChoice: true }),
        node(4, [3], { multipleChoice: true, multipleChoiceOption: true }),
        node(5, [3], { multipleChoice: true, multipleChoiceOption: true }),
        node(10, [11], { ascendancyName: "Ascendant", isAscendancyStart: true }),
        node(11, [10], { ascendancyName: "Ascendant" }),
      ],
    };
    const chosen = allocatePassivePath(choiceTree, new Set([1, 2, 3, 4, 10, 11]), [5], 5);
    expect([...chosen].sort((a, b) => a - b)).toEqual([1, 2, 3, 5, 10, 11]);
    expect([...dependentAllocatedNodes(choiceTree, chosen, 2, 0, "Ascendant")].sort((a, b) => a - b)).toEqual([2, 3, 5]);
    expect([...refundNodeAndDependents(choiceTree, chosen, 2, 0, "Ascendant")].sort((a, b) => a - b)).toEqual([1, 10, 11]);
  });

  it("matches PoB item-granted remote allocation and refund dependencies", () => {
    const remoteTree: PassiveTreeData = {
      ...tree,
      nodes: [
        node(1, [2], { x: 0, classStartIndex: 0, classStartIds: [0] }),
        node(2, [1, 3, 6], { x: 100 }),
        node(3, [2], { x: 200, jewelSocket: true }),
        node(4, [5], { x: 300, name: "Remote passive" }),
        node(5, [4], { x: 1400, name: "Beyond radius" }),
        node(6, [2], { x: 150 }),
      ],
    };
    const spec = {
      id: "remote",
      title: "Remote",
      treeVersion: "3_29",
      classId: 0,
      ascendClassId: 0,
      secondaryAscendClassId: 0,
      nodes: [1, 2, 3, 4, 6],
      masteryEffects: {},
      sockets: { 3: 7 },
    };
    const context = buildPassiveAllocationContext(remoteTree, spec, [{
      id: 7,
      name: "Intuitive Leap",
      baseType: "Viridian Jewel",
      slot: "Jewel 3",
      equipped: true,
      text: "Rarity: UNIQUE\nIntuitive Leap\nViridian Jewel\n--------\nRadius: Small\nPassive Skills in Radius can be Allocated without being connected to your tree",
    }]);
    const allocated = new Set(spec.nodes);
    expect(context.remoteProviders[0].affected.has(4)).toBe(true);
    expect(context.remoteProviders[0].affected.has(5)).toBe(false);
    expect(shortestAllocationPath(remoteTree, new Set([1, 2, 3]), 4, 0, undefined, undefined, context)).toEqual([4]);
    expect(shortestAllocationPath(remoteTree, allocated, 5, 0, undefined, undefined, context)).toEqual([]);
    expect([...refundNodeAndDependents(remoteTree, allocated, 6, 0, undefined, undefined, context)].sort((a, b) => a - b)).toEqual([1, 2, 3, 4]);
    expect([...refundNodeAndDependents(remoteTree, allocated, 3, 0, undefined, undefined, context)].sort((a, b) => a - b)).toEqual([1, 2, 6]);
  });

  it("matches PoB Shift tracing and cross-class connection checks", () => {
    const traceTree: PassiveTreeData = {
      ...tree,
      classes: [
        { id: 0, name: "Scion", ascendancies: [] },
        { id: 1, name: "Witch", ascendancies: [] },
      ],
      nodes: [
        node(1, [2], { classStartIndex: 0, classStartIds: [0] }),
        node(2, [1, 3]),
        node(3, [2, 4, 5]),
        node(4, [3, 6]),
        node(5, [3]),
        node(6, [4], { classStartIndex: 1, classStartIds: [1] }),
        node(7, [5], { mastery: true }),
      ],
    };
    expect(isAllocatedClassConnected(traceTree, new Set([1, 2, 3, 4]), 0, 1)).toBe(true);
    expect(isAllocatedClassConnected(traceTree, new Set([1, 2, 3]), 0, 1)).toBe(false);
    expect(extendPassiveTracePath(traceTree, [], 3, [2, 3])).toEqual([2, 3]);
    expect(extendPassiveTracePath(traceTree, [2, 3], 5, [2, 3, 5])).toEqual([2, 3, 5]);
    expect(extendPassiveTracePath(traceTree, [2, 3, 5], 3, [2, 3])).toEqual([2, 5, 3]);
    expect(extendPassiveTracePath(traceTree, [2, 3, 5], 4, [2, 3, 4])).toEqual([2, 3, 5]);
    expect(extendPassiveTracePath(traceTree, [2, 3, 5, 7], 5, [2, 3, 5])).toEqual([2, 3, 5, 7]);
  });

  it("limits Foulborn Intuitive Leap and Impossible Escape exactly", () => {
    const specialTree: PassiveTreeData = {
      ...tree,
      nodes: [
        node(1, [], { x: 0, classStartIndex: 0, classStartIds: [0] }),
        node(3, [], { x: 0, jewelSocket: true }),
        node(10, [], { x: 100, keystone: true, name: "Arsenal of Vengeance" }),
        node(11, [], { x: 150 }),
        node(12, [], { x: 180, mastery: true }),
        node(13, [], { x: 200, keystone: true, name: "Another Keystone" }),
      ],
    };
    const baseSpec = { id: "special", title: "Special", treeVersion: "3_29", classId: 0, ascendClassId: 0, secondaryAscendClassId: 0, nodes: [1, 3], masteryEffects: {}, sockets: { 3: 7 } };
    const foulborn = buildPassiveAllocationContext(specialTree, baseSpec, [{ id: 7, name: "Intuitive Leap", baseType: "Viridian Jewel", slot: "", equipped: true, text: "Intuitive Leap\nRadius: Small\nKeystone Passive Skills in Radius can be Allocated without being connected to your tree" }]);
    expect([...foulborn.remoteProviders[0].affected].sort((a, b) => a - b)).toEqual([10, 13]);
    const impossible = buildPassiveAllocationContext(specialTree, baseSpec, [{ id: 7, name: "Impossible Escape", baseType: "Viridian Jewel", slot: "", equipped: true, text: "Impossible Escape\nRadius: Small\nPassive Skills in Radius of Arsenal of Vengeance can be Allocated without being connected to your tree" }]);
    expect([...impossible.remoteProviders[0].affected].sort((a, b) => a - b)).toEqual([11, 13]);
  });

  it("supports phrases, types, IDs, and stat summaries", () => {
    expect(searchPassiveNodes(tree, '"vitality void" notable')[0].id).toBe(4);
    expect(searchPassiveNodes(tree, "#3")[0].id).toBe(3);
    expect(summarizeAllocatedStats(tree, new Set([2]))[0]).toMatchObject({ value: 10, percent: true });
  });
});

describe("passive tree presentation model", () => {
  it("retains directed links whose target ID is lower and deduplicates in/out pairs", () => {
    const high = node(20, [10]);
    const low = node(10, [], { in: [20] });
    expect(passiveTreeConnections([high, low]).map((edge) => [edge.from.id, edge.to.id])).toEqual([[20, 10]]);
  });

  it("keeps logical start/mastery/cross-ascendancy links out of rendered connectors", () => {
    const base = node(1, [2, 3, 4]);
    const classStart = node(2, [1], { classStartIndex: 0, classStartIds: [0] });
    const mastery = node(3, [1], { mastery: true });
    const ascendant = node(4, [1, 5], { ascendancyName: "Ascendant" });
    const sameAscendancy = node(5, [4], { ascendancyName: "Ascendant" });
    expect(passiveTreeConnections([base, classStart, mastery, ascendant, sameAscendancy])
      .map((edge) => [edge.from.id, edge.to.id])).toEqual([[4, 5]]);
  });

  it("keeps current ascendancies visible, filters retired Wildwood trees, and uses PoB's default zoom", () => {
    const nodes = [
      node(1, []),
      node(2, [], { ascendancyName: "Elementalist" }),
      node(3, [], { ascendancyName: "Occultist" }),
      node(4, [], { ascendancyName: "Abyssal", bloodline: true }),
      node(5, [], { ascendancyName: "Warlock", bloodline: true }),
    ];
    expect(visiblePassiveNodes({ ...tree, nodes }, "Elementalist", "").map((entry) => entry.id)).toEqual([1, 2, 3, 4]);
    expect(visiblePassiveNodes({ ...tree, nodes }, "Elementalist", "Abyssal").map((entry) => entry.id)).toEqual([1, 2, 3, 4]);
    const viewport = defaultPassiveTreeViewport({ ...tree, size: 1000 }, 2000, 1000);
    expect(viewport).toMatchObject({ x: 1000, y: 500 });
    expect(viewport.scale).toBeCloseTo(1.728);
  });

  it("preserves the viewed world centre and zoom across ordinary canvas resizes", () => {
    const viewport = { x: -350, y: 125, scale: 0.25 };
    const previous = { width: 1200, height: 800 };
    const next = { width: 1500, height: 680 };
    const beforeCentre = {
      x: (previous.width / 2 - viewport.x) / viewport.scale,
      y: (previous.height / 2 - viewport.y) / viewport.scale,
    };
    const resized = resizedPassiveTreeViewport(viewport, previous, next);

    expect(resized.scale).toBe(viewport.scale);
    expect((next.width / 2 - resized.x) / resized.scale).toBeCloseTo(beforeCentre.x);
    expect((next.height / 2 - resized.y) / resized.scale).toBeCloseTo(beforeCentre.y);
  });

  it("applies a selected mastery effect and round-trips a replacement through PoB XML", () => {
    const masteryTree: PassiveTreeData = {
      ...tree,
      nodes: [
        ...tree.nodes,
        node(6, [4], {
          name: "Life Mastery",
          mastery: true,
          masteryEffects: {
            101: { stats: ["10% increased maximum Life"], reminderText: [] },
            202: { stats: ["You count as on Full Life while at 90% of maximum Life or above"], reminderText: [] },
          },
        }),
      ],
    };
    const spec = {
      id: "mastery",
      title: "Mastery",
      treeVersion: "3_29",
      classId: 0,
      ascendClassId: 0,
      secondaryAscendClassId: 0,
      nodes: [1, 2, 4, 6],
      masteryEffects: { 6: 101 },
    };
    expect(applyImportedMasteryEffects(masteryTree, spec).nodes.find((entry) => entry.id === 6)).toMatchObject({
      stats: ["10% increased maximum Life"],
      selectedMasteryEffect: 101,
    });

    const build = parsePobXml('<PathOfBuilding><Build/><Tree activeSpec="1"><Spec title="Mastery" treeVersion="3_29" classId="0" nodes="1,2,4,6" masteryEffects="{6,101}"/></Tree></PathOfBuilding>');
    const xml = serializePobXml(build, [{ ...build.specs[0], masteryEffects: { 6: 202 } }], build.specs[0].id);
    expect(parsePobXml(xml).specs[0].masteryEffects).toEqual({ 6: 202 });
  });

  it("renders mastery choices in PoB's authored order", () => {
    const mastery = node(6, [], {
      mastery: true,
      masteryEffects: {
        101: { stats: ["First by ID"], reminderText: [] },
        202: { stats: ["First in PoB"], reminderText: [] },
      },
      masteryEffectOrder: [202, 101],
    });
    expect(orderedMasteryEffects(mastery).map(({ id }) => id)).toEqual([202, 101]);
  });
});

describe("Path of Building XML import", () => {
  it("imports metadata, specs, items, gems, config, and notes", () => {
    const build = parsePobXml(`<PathOfBuilding><Build level="94" className="Witch" ascendClassName="Necromancer" mainSocketGroup="2"><PlayerStat stat="FullDPS" value="1234567"/><PlayerStat stat="FireResist" value="75"/></Build><Tree><Spec title="Bossing" treeVersion="3_29" classId="3" ascendClassId="2" nodes="1,2,3" masteryEffects="{2,99}"/></Tree><Items activeItemSet="1"><Item id="7">Rarity: UNIQUE\nShavronne's Wrappings\nOccultist's Vestment\n--------</Item><ItemSet id="1"><Slot name="Body Armour" itemId="7"/></ItemSet></Items><Skills activeSkillSet="1"><SkillSet id="1"><Skill slot="Body Armour" label="Main" includeInFullDPS="true"><Gem nameSpec="Raise Spectre" skillId="Metadata/Skills/RaiseSpectre" level="20" quality="20" enabled="true"/></Skill></SkillSet></Skills><Config activeConfigSet="1"><ConfigSet id="1"><Input name="conditionBoss" boolean="true"/></ConfigSet></Config><Notes>Hello &amp; welcome</Notes></PathOfBuilding>`);
    expect(build).toMatchObject({ level: 94, className: "Witch", ascendancyName: "Necromancer", notes: "Hello & welcome" });
    expect(build.specs[0]).toMatchObject({ title: "Bossing", nodes: [1, 2, 3], masteryEffects: { 2: 99 } });
    expect(build.items[0]).toMatchObject({ id: 7, name: "Shavronne's Wrappings", baseType: "Occultist's Vestment" });
    expect(build.items[0]).toMatchObject({ slot: "Body Armour", equipped: true });
    expect(build.skillGroups[0].gems[0].name).toBe("Raise Spectre");
    expect(build.skillGroups[0].includeInFullDps).toBe(true);
    expect(build.config.conditionBoss).toBe(true);
    expect(build.playerStats).toMatchObject([
      { name: "FullDPS", value: 1234567, category: "offence" },
      { name: "FireResist", value: 75, category: "resistances", percent: true },
    ]);
    expect(pobStatPercent("CritChance")).toBe(true);
    expect(pobStatPercent("EffectiveMovementSpeedMod")).toBe(false);
  });

  it("retains only trusted official artwork from character imports", () => {
    const build = parsePobXml(`<PathOfBuilding><Build mainSocketGroup="1"/><Tree><Spec nodes="1"/></Tree><Items activeItemSet="1"><Item id="7">Rarity: RARE\nStorm Crown\nHubris Circlet\n--------\nUnique ID: helmet-id</Item><ItemSet id="1"><Slot name="Helmet" itemId="7"/></ItemSet></Items><Skills><SkillSet id="1"><Skill slot="Helmet"><Gem nameSpec="Kinetic Blast" skillId="KineticBlast" level="20" quality="0"/></Skill></SkillSet></Skills></PathOfBuilding>`);
    const enriched = enrichPobBuildWithCharacterAssets(build, {
      equipment: [{
        id: "helmet-id",
        inventoryId: "Helm",
        name: "Storm Crown",
        typeLine: "Hubris Circlet",
        icon: "https://web.poecdn.com/image/helmet.png",
        socketedItems: [{ typeLine: "Kinetic Blast", icon: "https://web.poecdn.com/image/kinetic-blast.png", support: false }],
      }],
      jewels: [{ id: "bad", typeLine: "Cobalt Jewel", icon: "https://example.com/tracker.png" }],
    });

    expect(enriched.items[0].icon).toBe("https://web.poecdn.com/image/helmet.png");
    expect(enriched.skillGroups[0].gems[0]).toMatchObject({ icon: "https://web.poecdn.com/image/kinetic-blast.png", support: false });
    expect(JSON.stringify(enriched)).not.toContain("example.com");
  });

  it("exports edited trees and skills without dropping PoB-only spec children", () => {
    const build = parsePobXml(`<PathOfBuilding><Build level="90" className="Scion"></Build><Tree activeSpec="1"><Spec title="Tree" treeVersion="3_29" classId="0" nodes="1,2"><Sockets><Socket nodeId="2" itemId="7"/></Sockets><Overrides><Override nodeId="2" dn="Tattoo of the Kitava Warrior">5% increased maximum Life</Override></Overrides><CustomThing foo="bar"><Nested value="kept"/></CustomThing></Spec></Tree><Skills><SkillSet id="1"><Skill slot="Helmet"><Gem nameSpec="Grace" skillId="Grace" level="20" quality="0"/></Skill></SkillSet></Skills><Items><ItemSet id="1"/></Items></PathOfBuilding>`);
    const xml = serializePobXml({ ...build, skillGroups: [{ ...build.skillGroups[0], gems: [{ ...build.skillGroups[0].gems[0], quality: 20 }] }] }, [{ ...build.specs[0], nodes: [1, 2, 3] }], build.specs[0].id);
    expect(xml).toContain('nodes="1,2,3"');
    expect(xml).toContain('<Socket nodeId="2" itemId="7"/>');
    expect(build.specs[0].skillOverrides).toMatchObject({ 2: { name: "Tattoo of the Kitava Warrior", stats: ["5% increased maximum Life"] } });
    expect(xml).toContain('dn="Tattoo of the Kitava Warrior"');
    expect(xml).toContain('<CustomThing foo="bar"><Nested value="kept"/></CustomThing>');
    expect(xml).toContain('skillId="Grace" level="20" quality="20"');
  });

  it("patches only the active SkillSet and preserves PoB-only Skill/Gem data", () => {
    const build = parsePobXml(`<PathOfBuilding>
      <Build level="90" className="Scion"></Build>
      <Tree activeSpec="1"><Spec title="Tree" treeVersion="3_29" classId="0" nodes="1"/></Tree>
      <Skills activeSkillSet="2" sortGemsByDPS="true" customSkills="keep">
        <SkillSet id="1" title="Inactive"><Skill slot="Weapon 1"><Gem nameSpec="Inactive Gem" skillId="InactiveGem" level="1" quality="0"/></Skill></SkillSet>
        <SkillSet id="2" title="Active" customSet="keep">
          <Skill slot="Helmet" label="Aura" enabled="true" includeInFullDPS="false" imbuedSupport="Advanced Traps" mainActiveSkill="2" mainActiveSkillCalcs="3" groupCount="4" source="Item" customSkill="keep">
            <Gem nameSpec="Firestorm of Pelting" skillId="FirestormAltY" gemId="Metadata/Items/Gems/SkillGemFirestorm" variantId="FirestormAltY" level="20" quality="0" enabled="true" enableGlobal1="false" enableGlobal2="true" qualityId="Divergent" skillPart="2" count="3" customGem="keep"><GemMeta value="keep"/></Gem>
            <Gem nameSpec="Grace" skillId="Grace" gemId="Metadata/Items/Gems/SkillGemGrace" level="19" quality="1" enabled="true" enableGlobal1="true" enableGlobal2="nil" count="nil"/>
            <SkillMeta value="keep"/>
          </Skill>
          <SetMeta value="keep"/>
        </SkillSet>
      </Skills>
      <Items activeItemSet="1"><ItemSet id="1"/></Items>
    </PathOfBuilding>`);
    expect(build.skillGroups[0]).toMatchObject({
      imbuedSupport: "Advanced Traps",
      mainActiveSkill: 2,
      mainActiveSkillCalcs: 3,
      groupCount: 4,
      source: "Item",
    });
    expect(build.skillGroups[0].gems[0]).toMatchObject({
      name: "Firestorm of Pelting",
      skillId: "FirestormAltY",
      gemId: "Metadata/Items/Gems/SkillGemFirestorm",
      variantId: "FirestormAltY",
      level: 20,
      quality: 0,
      enabled: true,
      enableGlobal1: false,
      enableGlobal2: true,
      count: 3,
    });
    expect(build.skillGroups[0].gems[1]).toMatchObject({
      name: "Grace",
      gemId: "Metadata/Items/Gems/SkillGemGrace",
      enableGlobal1: true,
    });
    expect(build.skillGroups[0].gems[1].enableGlobal2).toBeUndefined();
    expect(build.skillGroups[0].gems[1].count).toBeUndefined();
    const xml = serializePobXml({
      ...build,
      skillGroups: [{
        ...build.skillGroups[0],
        enabled: false,
        includeInFullDps: true,
        gems: build.skillGroups[0].gems.map((gem, index) => index === 0 ? { ...gem, quality: 20, enabled: false } : gem),
      }],
    }, build.specs, build.specs[0].id);

    expect(xml).toContain('<Skills activeSkillSet="2" sortGemsByDPS="true" customSkills="keep">');
    expect(xml).toContain('<SkillSet id="1" title="Inactive"><Skill slot="Weapon 1"><Gem nameSpec="Inactive Gem" skillId="InactiveGem" level="1" quality="0"/></Skill></SkillSet>');
    expect(xml).toContain('customSet="keep"');
    expect(xml).toMatch(/<Skill\b(?=[^>]*enabled="false")(?=[^>]*includeInFullDPS="true")(?=[^>]*imbuedSupport="Advanced Traps")(?=[^>]*mainActiveSkill="2")(?=[^>]*mainActiveSkillCalcs="3")(?=[^>]*groupCount="4")(?=[^>]*source="Item")(?=[^>]*customSkill="keep")[^>]*>/);
    expect(xml).toMatch(/<Gem\b(?=[^>]*nameSpec="Firestorm of Pelting")(?=[^>]*skillId="FirestormAltY")(?=[^>]*gemId="Metadata\/Items\/Gems\/SkillGemFirestorm")(?=[^>]*variantId="FirestormAltY")(?=[^>]*level="20")(?=[^>]*quality="20")(?=[^>]*enabled="false")(?=[^>]*enableGlobal1="false")(?=[^>]*enableGlobal2="true")(?=[^>]*qualityId="Divergent")(?=[^>]*skillPart="2")(?=[^>]*count="3")(?=[^>]*customGem="keep")[^>]*>/);
    expect(xml).toMatch(/<Gem\b(?=[^>]*nameSpec="Grace")(?=[^>]*gemId="Metadata\/Items\/Gems\/SkillGemGrace")(?=[^>]*enableGlobal1="true")(?=[^>]*enableGlobal2="nil")(?=[^>]*count="nil")[^>]*\/>/);
    expect(xml).toContain('<GemMeta value="keep"/>');
    expect(xml).toContain('<SkillMeta value="keep"/>');
    expect(xml).toContain('<SetMeta value="keep"/>');
  });

  it("emits and reparses exact gem identity and skill-group selection attributes", () => {
    const build = parsePobXml(`<PathOfBuilding>
      <Build level="90" className="Scion"/>
      <Tree activeSpec="1"><Spec title="Tree" treeVersion="3_29" classId="0" nodes="1"/></Tree>
      <Skills activeSkillSet="1"><SkillSet id="1"/></Skills>
      <Items activeItemSet="1"><ItemSet id="1"/></Items>
    </PathOfBuilding>`);
    const xml = serializePobXml({
      ...build,
      skillGroups: [{
        id: "skill-transfigured",
        slot: "Helmet",
        label: "Transfigured",
        enabled: true,
        includeInFullDps: false,
        imbuedSupport: "Advanced Traps",
        mainActiveSkill: 1,
        mainActiveSkillCalcs: 2,
        groupCount: 3,
        source: "Item",
        gems: [{
          name: "Firestorm of Pelting",
          skillId: "FirestormAltY",
          gemId: "Metadata/Items/Gems/SkillGemFirestorm",
          variantId: "FirestormAltY",
          level: 20,
          quality: 20,
          enabled: true,
          enableGlobal1: true,
          enableGlobal2: false,
          count: 2,
        }],
      }],
    }, build.specs, build.specs[0].id);

    expect(xml).toMatch(/<Skill\b(?=[^>]*imbuedSupport="Advanced Traps")(?=[^>]*mainActiveSkill="1")(?=[^>]*mainActiveSkillCalcs="2")(?=[^>]*groupCount="3")(?=[^>]*source="Item")[^>]*>/);
    expect(xml).toMatch(/<Gem\b(?=[^>]*nameSpec="Firestorm of Pelting")(?=[^>]*skillId="FirestormAltY")(?=[^>]*gemId="Metadata\/Items\/Gems\/SkillGemFirestorm")(?=[^>]*variantId="FirestormAltY")(?=[^>]*enableGlobal1="true")(?=[^>]*enableGlobal2="false")(?=[^>]*count="2")[^>]*\/>/);
    expect(parsePobXml(xml).skillGroups[0]).toMatchObject({
      imbuedSupport: "Advanced Traps",
      mainActiveSkill: 1,
      mainActiveSkillCalcs: 2,
      groupCount: 3,
      source: "Item",
      gems: [{
        gemId: "Metadata/Items/Gems/SkillGemFirestorm",
        variantId: "FirestormAltY",
        enableGlobal1: true,
        enableGlobal2: false,
        count: 2,
      }],
    });
  });

  it("patches active Config/Item sets and jewel sockets without flattening inactive or unknown XML", () => {
    const build = parsePobXml(`<PathOfBuilding>
      <Build level="90" className="Scion"></Build>
      <Tree activeSpec="1"><Spec title="Tree" treeVersion="3_29" classId="0" nodes="1"><Sockets><Socket nodeId="77" itemId="3" customSocket="keep"/><SocketMeta value="keep"/></Sockets></Spec></Tree>
      <Config activeConfigSet="2" customConfig="keep">
        <ConfigSet id="1" title="Inactive"><Input name="inactive" boolean="true"/></ConfigSet>
        <ConfigSet id="2" title="Active" customSet="keep"><Input name="conditionBoss" boolean="false" customInput="keep"><InputMeta value="keep"/></Input><Input name="enemyLevel" number="83"/><ConfigMeta value="keep"/></ConfigSet>
      </Config>
      <Skills activeSkillSet="1"><SkillSet id="1"/></Skills>
      <Items activeItemSet="2" customItems="keep">
        <Item id="1">Rarity: UNIQUE\nOld Helm\nHelmet Base\n<ModRange range="0.5" id="1"/></Item>
        <Item id="2">Rarity: UNIQUE\nNew Helm\nHelmet Base</Item>
        <Item id="3">Rarity: UNIQUE\nSocketed Jewel\nCobalt Jewel</Item>
        <ItemSet id="1" title="Inactive"><Slot name="Helmet" itemId="1" inactiveAttr="keep"/></ItemSet>
        <ItemSet id="2" title="Active" customSet="keep"><Slot name="Helmet" itemId="1" customSlot="keep"/><Slot name="Boots" itemId="2"/><ItemSetMeta value="keep"/></ItemSet>
      </Items>
    </PathOfBuilding>`);
    expect(build.config).toMatchObject({ conditionBoss: false, enemyLevel: 83 });
    const xml = serializePobXml({
      ...build,
      config: { conditionBoss: true, newCondition: 3 },
      items: build.items.map((item) => item.id === 1
        ? { ...item, equipped: false }
        : item.id === 2
          ? { ...item, equipped: true, slot: "Helmet" }
          : { ...item, equipped: false }),
    }, build.specs, build.specs[0].id);

    expect(xml).toContain('<Config activeConfigSet="2" customConfig="keep">');
    expect(xml).toContain('<ConfigSet id="1" title="Inactive"><Input name="inactive" boolean="true"/></ConfigSet>');
    expect(xml).toMatch(/<Input\b(?=[^>]*name="conditionBoss")(?=[^>]*boolean="true")(?=[^>]*customInput="keep")[^>]*>/);
    expect(xml).not.toContain('name="enemyLevel"');
    expect(xml).toContain('<Input name="newCondition" number="3"/>');
    expect(xml).toContain('<ConfigMeta value="keep"/>');
    expect(xml).toContain('<InputMeta value="keep"/>');

    expect(xml).toContain('<Items activeItemSet="2" customItems="keep">');
    expect(xml).toContain('<ItemSet id="1" title="Inactive"><Slot name="Helmet" itemId="1" inactiveAttr="keep"/></ItemSet>');
    expect(xml).toMatch(/<Slot\b(?=[^>]*name="Helmet")(?=[^>]*itemId="2")(?=[^>]*customSlot="keep")[^>]*\/>/);
    expect(xml).not.toContain('<Slot name="Boots"');
    expect(xml).toContain('<ItemSetMeta value="keep"/>');
    expect(xml).toContain('<ModRange range="0.5" id="1"/>');
    expect(xml).not.toContain('&lt;ModRange');

    expect(xml).not.toContain('nodeId="77"');
    expect(xml).toContain('<SocketMeta value="keep"/>');
  });
});

describe("planner saved builds and comparisons", () => {
  const savedLibraryErrorCode = (run: () => unknown) => {
    try {
      run();
    } catch (error) {
      expect(error).toBeInstanceOf(SavedPlannerLibraryError);
      return (error as SavedPlannerLibraryError).code;
    }
    throw new Error("Expected the saved-library operation to fail.");
  };

  it("sanitizes, orders, and replaces saved snapshots", () => {
    const snapshot = createPlannerSnapshot({
      id: "one",
      name: "  Boss\nBuild  ",
      tags: ["mapping", "mapping"],
      game: "poe1",
      treeVersion: "3_29",
      build: null,
      specs: [],
      activeSpecId: "",
      classId: 0,
      ascendancyId: 0,
      allocated: [1, 2, 2],
      editedSinceImport: false,
      now: 10,
    });
    expect(snapshot).toMatchObject({ name: "Boss Build", tags: ["mapping"], allocated: [1, 2] });
    const newer = { ...snapshot, name: "Updated", updatedAt: 20 };
    expect(upsertSavedPlannerBuild([snapshot], newer)).toHaveLength(1);
    expect(parseSavedPlannerBuilds(JSON.stringify([newer]))[0].name).toBe("Updated");
  });

  it("round-trips the active per-user workspace without credentials or repository state", () => {
    const imported = {
      ...emptyPobBuild(),
      className: "Witch",
      ascendancyName: "Elementalist",
      level: 97,
      notes: "persist me",
      items: [{ id: 11, text: "Rarity: UNIQUE\nStorm Prism\nCobalt Jewel", name: "Storm Prism", baseType: "Cobalt Jewel", slot: "Jewel 2491", equipped: true }],
      config: { conditionBoss: true },
    };
    const snapshot = createPlannerSnapshot({
      id: "active-workspace",
      name: "Persisted Witch",
      game: "poe1",
      treeVersion: "3_29",
      build: imported,
      specs: [],
      activeSpecId: "",
      classId: 3,
      ascendancyId: 1,
      allocated: [2491, 131_072],
      editedSinceImport: true,
      now: 123,
    });
    const raw = serializeActivePlannerWorkspace(snapshot, "items", 456);
    const restored = parseActivePlannerWorkspace(raw);

    expect(restored).toMatchObject({ version: 1, tab: "items", savedAt: 456 });
    expect(restored.snapshot).toMatchObject({
      name: "Persisted Witch",
      allocated: [2491, 131_072],
      editedSinceImport: true,
      build: { className: "Witch", notes: "persist me", config: { conditionBoss: true } },
    });
    expect(raw).not.toMatch(/accessToken|accountName|oauth|poesessid/i);
  });

  it("leaves malformed active autosaves fail-closed and normalizes unknown tabs", () => {
    expect(() => parseActivePlannerWorkspace("{broken")).toThrow("left unchanged");
    expect(() => parseActivePlannerWorkspace(JSON.stringify({ version: 1, snapshot: { unexpected: true } }))).toThrow("unsupported format");
    const snapshot = createPlannerSnapshot({
      game: "poe1", treeVersion: "3_29", build: null, specs: [], activeSpecId: "", classId: 0,
      ascendancyId: 0, allocated: [], editedSinceImport: false,
    });
    const unknownTab = JSON.stringify({ version: 1, tab: "secrets", savedAt: 1, snapshot });
    expect(parseActivePlannerWorkspace(unknownTab).tab).toBe("tree");
  });

  it("locks malformed, wrong-shaped, partially invalid, and oversized saved libraries", () => {
    expect(savedLibraryErrorCode(() => parseSavedPlannerBuilds("{broken"))).toBe("INVALID_JSON");
    expect(savedLibraryErrorCode(() => parseSavedPlannerBuilds(JSON.stringify({ builds: [] })))).toBe("INVALID_LIBRARY");
    expect(savedLibraryErrorCode(() => parseSavedPlannerBuilds(JSON.stringify([{
      format: RETIRED_PLANNER_FORMAT,
      allocated: [],
    }, { unexpected: true }])))).toBe("INVALID_BUILD");
    expect(savedLibraryErrorCode(() => parseSavedPlannerBuilds("x".repeat(MAX_SAVED_PLANNER_LIBRARY_BYTES + 1)))).toBe("LIBRARY_TOO_LARGE");
  });

  it("refuses to serialize a library that the next launch would lock", () => {
    const snapshot = createPlannerSnapshot({
      id: "oversized",
      game: "poe1",
      treeVersion: "3_29",
      build: { ...emptyPobBuild(), notes: "x".repeat(MAX_SAVED_PLANNER_LIBRARY_BYTES) },
      specs: [],
      activeSpecId: "",
      classId: 0,
      ascendancyId: 0,
      allocated: [],
      editedSinceImport: false,
    });

    expect(savedLibraryErrorCode(() => serializeSavedPlannerBuilds([snapshot]))).toBe("LIBRARY_TOO_LARGE");
  });

  it("exports the exact invalid payload before resetting its storage entry", async () => {
    const original = "{recoverable but invalid";
    const entries = new Map([["gloamcore:saved-planner-builds:v1", original]]);
    let exported = "";
    const result = await recoverSavedPlannerLibrary({
      storage: {
        getItem: (key) => entries.get(key) ?? null,
        removeItem: (key) => { entries.delete(key); },
      },
      saveRecoveryCopy: async (raw) => {
        exported = raw;
        return { name: "planner-recovery.txt" };
      },
    });

    expect(exported).toBe(original);
    expect(result).toEqual({ status: "recovered", backupName: "planner-recovery.txt" });
    expect(entries.size).toBe(0);
  });

  it("keeps the original library locked when recovery export is cancelled or reset fails", async () => {
    const original = "{still recoverable";
    const entries = new Map([["gloamcore:saved-planner-builds:v1", original]]);
    const storage = {
      getItem: (key: string) => entries.get(key) ?? null,
      removeItem: (_key: string) => undefined,
    };

    await expect(recoverSavedPlannerLibrary({
      storage,
      saveRecoveryCopy: async () => null,
    })).resolves.toEqual({ status: "cancelled" });
    expect(entries.get("gloamcore:saved-planner-builds:v1")).toBe(original);

    await expect(recoverSavedPlannerLibrary({
      storage,
      saveRecoveryCopy: async () => ({ name: "planner-recovery.txt" }),
    })).rejects.toThrow("browser storage entry could not be removed");
    expect(entries.get("gloamcore:saved-planner-builds:v1")).toBe(original);
  });

  it("rejects malformed nested workspace state without truncating cluster node IDs", () => {
    const snapshot = sanitizePlannerSnapshot({
      format: RETIRED_PLANNER_FORMAT,
      allocated: [1, 131_072, "bad"],
      specs: [null, {
        id: "cluster",
        title: "Cluster",
        treeVersion: "3_29",
        nodes: [1, 131_072, "bad"],
        masteryEffects: { 131072: 40001, bad: "value" },
        sockets: { 7960: 7, bad: null },
      }],
      activeSpecId: "missing",
      build: {
        className: "Witch",
        items: [null, { id: 7, text: "Rarity: UNIQUE\nLethal Pride\nTimeless Jewel", slot: "Jewel 7960" }],
        skillGroups: [null],
        config: { conditionBoss: true, invalid: { nested: true } },
        playerStats: [null, { name: "Life", value: 4000 }],
      },
    });

    expect(snapshot).not.toBeNull();
    expect(snapshot?.allocated).toEqual([1, 131_072]);
    expect(snapshot?.activeSpecId).toBe("cluster");
    expect(snapshot?.specs[0]).toMatchObject({ nodes: [1, 131_072], masteryEffects: { 131072: 40001 }, sockets: { 7960: 7 } });
    expect(snapshot?.build?.items).toHaveLength(1);
    expect(snapshot?.build?.config).toEqual({ conditionBoss: true });
    expect(snapshot?.build?.playerStats[0]).toMatchObject({ name: "Life", value: 4000 });
  });

  it("compares nodes, equipped items, enabled gems, and PoB stat snapshots", () => {
    const baseBuild = parsePobXml(`<PathOfBuilding><Build><PlayerStat stat="Life" value="4000"/></Build><Tree><Spec nodes="1,2"/></Tree><Items activeItemSet="1"><Item id="1">Rarity: UNIQUE\nAlpha\nHelmet\n--------</Item><ItemSet id="1"><Slot name="Helmet" itemId="1"/></ItemSet></Items><Skills><Skill slot="Helmet"><Gem nameSpec="Grace" skillId="Grace" level="20" quality="0"/></Skill></Skills></PathOfBuilding>`);
    const nextBuild = parsePobXml(`<PathOfBuilding><Build><PlayerStat stat="Life" value="4500"/></Build><Tree><Spec nodes="1,3"/></Tree><Items activeItemSet="1"><Item id="2">Rarity: UNIQUE\nBeta\nHelmet\n--------</Item><ItemSet id="1"><Slot name="Helmet" itemId="2"/></ItemSet></Items><Skills><Skill slot="Helmet"><Gem nameSpec="Determination" skillId="Determination" level="20" quality="20"/></Skill></Skills></PathOfBuilding>`);
    const comparison = comparePlannerBuilds(
      { build: nextBuild, allocated: [1, 3] },
      { build: baseBuild, allocated: [1, 2] },
    );
    expect(comparison).toMatchObject({ addedNodes: [3], removedNodes: [2] });
    expect(comparison.addedItems[0]).toContain("Beta");
    expect(comparison.removedGems[0]).toContain("Grace");
    expect(comparison.stats[0]).toMatchObject({ name: "Life", delta: 500 });
    expect(formatPobStatValue(nextBuild.playerStats[0])).toBe("4,500");
    expect(formatPobStatValue({ name: "CritMultiplier", value: 5.21, percent: false })).toBe("521%");
    expect(formatPobStatValue({ name: "EffectiveMovementSpeedMod", value: 1.19, percent: false })).toBe("+19%");
  });
});

describe("PoB planner state invariants", () => {
  it("counts only point-spending passives like PoB CountAllocNodes", () => {
    const countTree: PassiveTreeData = {
      ...tree,
      nodes: [
        node(10, [11], { classStartIndex: 0, classStartIds: [0] }),
        node(11, [10], { jewelSocket: true }),
        node(20, [21], { name: "Necromancer", ascendancyName: "Necromancer", isAscendancyStart: true }),
        node(21, [20, 22], { ascendancyName: "Necromancer" }),
        node(22, [21], { ascendancyName: "Necromancer", multipleChoiceOption: true }),
        node(30, [31], { name: "Bloodline", ascendancyName: "Bloodline", isAscendancyStart: true, bloodline: true }),
        node(31, [30], { ascendancyName: "Bloodline", bloodline: true }),
      ],
    };

    expect(countAllocatedPassivePoints(countTree, new Set([10, 11, 20, 21, 22, 30, 31]))).toEqual({
      passive: 1,
      ascendancy: 2,
      secondaryAscendancy: 1,
      sockets: 1,
    });
  });

  it("refunds remote allocations when their jewel provider disappears", () => {
    const remoteTree: PassiveTreeData = {
      ...tree,
      nodes: [
        node(1, [2], { classStartIndex: 0, classStartIds: [0] }),
        node(2, [1, 3]),
        node(3, [2], { jewelSocket: true }),
        node(4, []),
      ],
    };
    const allocated = new Set([1, 2, 3, 4]);
    const withProvider = retainConnectedAllocatedPassives(remoteTree, allocated, 0, undefined, undefined, {
      remoteProviders: [{ providerId: 3, centerId: 3, kind: "intuitive-leap", affected: new Set([4]) }],
    });

    expect([...withProvider]).toEqual([1, 2, 3, 4]);
    expect([...retainConnectedAllocatedPassives(remoteTree, allocated, 0)]).toEqual([1, 2, 3]);
  });

  it("keeps tree-spec jewels authoritative while synchronising Items-tab state", () => {
    const items = [
      { id: 1, name: "Old jewel", baseType: "Cobalt Jewel", text: "Rarity: MAGIC\nOld jewel", slot: "Jewel 100", equipped: true },
      { id: 2, name: "Spec jewel", baseType: "Crimson Jewel", text: "Rarity: MAGIC\nSpec jewel", slot: "", equipped: false },
    ];
    const spec = {
      id: "second",
      title: "Second",
      treeVersion: "3_29",
      classId: 0,
      ascendClassId: 0,
      secondaryAscendClassId: 0,
      nodes: [1],
      masteryEffects: {},
      sockets: { 200: 2 },
    };
    expect(itemsWithPassiveSpecLoadout(items, spec)).toMatchObject([
      { id: 1, slot: "Jewel 100", equipped: false },
      { id: 2, slot: "Jewel 200", equipped: true },
    ]);

    const toggledBuild = {
      ...emptyPobBuild(),
      items: items.map((item) => item.id === 1
        ? { ...item, equipped: false }
        : { ...item, slot: "Jewel 100", equipped: true }),
    };
    expect(specsWithActiveJewelLoadout(toggledBuild, [{ ...spec, sockets: { 100: 1 } }], spec.id)[0].sockets).toEqual({ 100: 2 });
  });
});
