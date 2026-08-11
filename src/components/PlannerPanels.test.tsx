import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { emptyPobBuild } from "../lib/planner/pob-build";
import { PlannerBuildsPanel, PlannerCalcsPanel, PlannerConfigPanel, PlannerItemsPanel, PlannerSkillsPanel, presentPlannerItem } from "./PlannerPanels";

const clusterJewel = {
  id: 7,
  name: "Loath Essence",
  baseType: "Medium Cluster Jewel",
  slot: "Jewel 64583",
  equipped: true,
  text: `Rarity: RARE
Loath Essence
Medium Cluster Jewel
Unique ID: 49958f4d37917590d8d5401767ef62e50789a2393cc6b5972b03dbea8
Item Level: 72
LevelReq: 54
Implicits: 3
{crafted}Adds 5 Passive Skills
{crafted}1 Added Passive Skill is a Jewel Socket
{crafted}Added Small Passive Skills grant: 10% increased Armour
Added Small Passive Skills also grant: +4% to Chaos Resistance
<ModRange id="1" range="0.5"/>`,
} as const;

describe("planner item presentation", () => {
  it("turns PoB raw item serialization into readable properties and modifiers", () => {
    const item = presentPlannerItem(clusterJewel);

    expect(item).toMatchObject({
      rarity: "rare",
      rarityLabel: "Rare",
      slotLabel: "Passive tree jewel",
      properties: [
        { label: "Item level", value: "72" },
        { label: "Requires level", value: "54" },
      ],
    });
    expect(item.modifiers).toEqual([
      { text: "Adds 5 Passive Skills", badges: ["Crafted"] },
      { text: "1 Added Passive Skill is a Jewel Socket", badges: ["Crafted"] },
      { text: "Added Small Passive Skills grant: 10% increased Armour", badges: ["Crafted"] },
      { text: "Added Small Passive Skills also grant: +4% to Chaos Resistance", badges: [] },
    ]);
    expect(JSON.stringify(item)).not.toMatch(/Unique ID|Implicits|ModRange|\{crafted\}/);
  });

  it("shows only the selected PoB variant and keeps meaningful item state", () => {
    const item = presentPlannerItem({
      ...clusterJewel,
      name: "Lethal Pride",
      baseType: "Timeless Jewel",
      text: `Rarity: UNIQUE
Lethal Pride
Timeless Jewel
Variant: Kaom
Variant: Rakiata
Selected Variant: 2
Radius: Large
Implicits: 0
{variant:1}Commanded leadership over 12476 warriors under Kaom
{variant:2}{fractured}Commanded leadership over 12476 warriors under Rakiata
Passives in radius are Conquered by the Karui
Historic
Corrupted`,
    });

    expect(item.properties).toContainEqual({ label: "Variant", value: "Rakiata" });
    expect(item.modifiers.map((modifier) => modifier.text)).toEqual([
      "Commanded leadership over 12476 warriors under Rakiata",
      "Passives in radius are Conquered by the Karui",
      "Historic",
    ]);
    expect(item.modifiers[0].badges).toEqual(["Fractured"]);
    expect(item.statuses).toEqual(["Corrupted"]);
  });

  it("uses PoB's one shared Variant list for primary and alternate selectors", () => {
    const item = presentPlannerItem({
      ...clusterJewel,
      name: "Thread of Hope",
      baseType: "Crimson Jewel",
      text: `Rarity: UNIQUE
Thread of Hope
Crimson Jewel
Variant: Small Ring
Variant: Medium Ring
Variant: Massive Ring
Selected Variant: 3
Has Alt Variant: true
Selected Alt Variant: 1
Has Alt Variant Two: true
Selected Alt Variant Two: 2
Implicits: 0
{variant:1}{prefix}{range:0.5}Only affects Passives in the Small Ring
{variant:2}{crafted}Only affects Passives in the Medium Ring
{variant:3}{suffix}Only affects Passives in the Massive Ring`,
    });

    expect(item.properties).toContainEqual({
      label: "Variants",
      value: "Massive Ring / Small Ring / Medium Ring",
    });
    expect(item.modifiers.map((modifier) => modifier.text)).toEqual([
      "Only affects Passives in the Small Ring",
      "Only affects Passives in the Medium Ring",
      "Only affects Passives in the Massive Ring",
    ]);
    expect(JSON.stringify(item)).not.toMatch(
      /Has Alt|Selected Alt|\{variant|\{prefix|\{suffix|\{crafted|\{range/,
    );
  });

  it("matches PoB's grouped version/variant filtering without exposing control records", () => {
    const item = presentPlannerItem({
      ...clusterJewel,
      name: "Grouped Relic",
      baseType: "Cobalt Jewel",
      text: `Rarity: UNIQUE
Grouped Relic
Cobalt Jewel
Implicits: 0
{version:1}{group:1}{variant:1}Legacy fire modifier
{version:2}{group:1}{variant:1}Current fire modifier
{version:2}{group:1}{variant:2}{disabled}Current cold modifier
{version:2}{variant:2}Ungrouped variant control line
Version: Legacy
Version: Current
Selected Version: 2
Variant: Fire
Variant: Cold
Selected Variant Group: 1=2
Allow Duplicate Variants: true`,
    });

    expect(item.properties).toContainEqual({ label: "Version", value: "Current" });
    expect(item.properties).toContainEqual({ label: "Variant", value: "Cold" });
    expect(item.modifiers).toEqual([
      { text: "Current cold modifier", badges: ["Disabled"] },
    ]);
    expect(JSON.stringify(item)).not.toMatch(/Selected Version|Selected Variant Group|Allow Duplicate|\{version|\{group|\{variant/);
  });

  it("renders grouped readable cards without raw text panes or false loadout controls", () => {
    const build = {
      ...emptyPobBuild(),
      items: [
        clusterJewel,
        {
          id: 8,
          name: "Stored Hope",
          baseType: "Cobalt Jewel",
          slot: "",
          equipped: false,
          text: "Rarity: MAGIC\nStored Hope\nImplicits: 0\n+12 to maximum Energy Shield",
        },
      ],
    };
    const markup = renderToStaticMarkup(<PlannerItemsPanel build={build} artwork={new Map()} onChange={() => undefined}/>);

    expect(markup).toContain("planner-paper-doll");
    expect(markup).toContain("Cluster jewels");
    expect(markup).toContain("Imported alternatives");
    expect(markup).toContain("Passive tree jewel");
    expect(markup).toContain("Not assigned");
    expect(markup).toContain("planner-item-modifiers");
    expect(markup).toContain("Official artwork is unavailable");
    expect(markup).not.toContain("<pre");
    expect(markup).not.toMatch(/Jewel 64583|Unique ID|ModRange|\{crafted\}/);
  });

  it("opens the item set's calculated weapon swap and renders its off-hand artwork slot", () => {
    const swapOffhand = {
      id: 9,
      name: "Swap Shield",
      baseType: "Archon Kite Shield",
      slot: "Weapon 2 Swap",
      equipped: true,
      text: "Rarity: RARE\nSwap Shield\nArchon Kite Shield",
      icon: "https://web.poecdn.com/image/swap-shield.png",
      width: 2,
      height: 3,
    };
    const build = {
      ...emptyPobBuild(),
      items: [swapOffhand],
      itemSets: [{ id: 1, title: "Boss swap", useSecondWeaponSet: true, slots: { "Weapon 2 Swap": { itemId: 9 } } }],
    };
    const markup = renderToStaticMarkup(<PlannerItemsPanel build={build} artwork={new Map()} onChange={() => undefined}/>);

    expect(markup).toContain("Weapon swap");
    expect(markup).toContain('aria-label="Off hand: Swap Shield"');
    expect(markup).toContain("https://web.poecdn.com/image/swap-shield.png");
    expect(markup).toContain('aria-label="Use weapon swap set"');
  });

  it("renders official gem art and exact PoB main-skill selectors", () => {
    const build = {
      ...emptyPobBuild(),
      mainSocketGroup: 1,
      skillGroups: [{
        id: "skill-1",
        slot: "Helmet",
        label: "Kinetic Blast",
        enabled: true,
        includeInFullDps: true,
        mainActiveSkill: 1,
        activeSkills: [{ index: 1, name: "Kinetic Blast", parts: ["Projectile", "Explosion"], sourceGemIndex: 1, stages: { min: 1, max: 10 }, mine: true }],
        gems: [{
          name: "Kinetic Blast",
          skillId: "KineticBlast",
          level: 21,
          quality: 20,
          enabled: true,
          support: false,
          icon: "https://web.poecdn.com/image/Art/2DItems/Gems/KineticBlast.png",
        }],
      }],
    };
    const markup = renderToStaticMarkup(<PlannerSkillsPanel build={build} onChange={() => undefined}/>);

    expect(markup).toContain("Main socket group");
    expect(markup).toContain('aria-label="Main socket group"');
    expect(markup).toContain("Kinetic Blast · Helmet");
    expect(markup).toContain("Main active skill");
    expect(markup).toContain("Skill part");
    expect(markup).toContain("Skill stages");
    expect(markup).toContain("Active mines");
    expect(markup).toContain("web.poecdn.com/image/Art/2DItems/Gems/KineticBlast.png");
    expect(markup).toContain("MAIN");
  });

  it("opens the imported main group instead of silently presenting the first support group", () => {
    const build = {
      ...emptyPobBuild(),
      mainSocketGroup: 2,
      skillGroups: [{
        id: "skill-1",
        slot: "Helmet",
        label: "",
        enabled: true,
        includeInFullDps: false,
        mainActiveSkill: 1,
        gems: [
          { name: "Enhance", skillId: "SupportEnhance", level: 4, quality: 0, enabled: true },
          { name: "Blood Rage", skillId: "BloodRage", level: 21, quality: 20, enabled: true },
        ],
      }, {
        id: "skill-2",
        slot: "Body Armour",
        label: "",
        enabled: true,
        includeInFullDps: false,
        mainActiveSkill: 1,
        activeSkills: [{ index: 1, name: "Kinetic Blast", parts: ["Projectile", "Explosion"], sourceGemIndex: 1 }],
        gems: [{ name: "Kinetic Blast", skillId: "KineticBlast", level: 21, quality: 20, enabled: true }],
      }],
    };

    const markup = renderToStaticMarkup(<PlannerSkillsPanel build={build} onChange={() => undefined}/>);

    expect(markup).toMatch(/<header><span><small>Body Armour<\/small><strong>Kinetic Blast<\/strong>/);
    expect(markup).toContain("Skill part");
    expect(markup).not.toMatch(/<header><span><small>Helmet<\/small><strong>Enhance<\/strong>/);
  });

  it("preserves imported PoB config inputs with readable labels and reset semantics", () => {
    const build = { ...emptyPobBuild(), config: { conditionBoss: true, enemyLevel: 84 } };
    const markup = renderToStaticMarkup(<PlannerConfigPanel build={build} onChange={() => undefined}/>);

    expect(markup).toContain("Condition Boss");
    expect(markup).toContain("Enemy Level");
    expect(markup).toContain("Reset Condition Boss");
    expect(markup).not.toContain("conditionBoss");
    expect(markup).not.toContain("Add condition");
  });

  it("renders exact PoB configuration defaults and dropdown choices from the engine catalog", () => {
    const build = { ...emptyPobBuild(), config: { conditionBoss: true } };
    const markup = renderToStaticMarkup(<PlannerConfigPanel
      build={build}
      catalog={[
        { name: "conditionBoss", label: "Is the enemy a boss?", type: "boolean", defaultValue: false, eligible: true, options: [] },
        { name: "bandit", label: "Bandit quest:", type: "list", defaultValue: "None", eligible: true, options: [{ label: "Kill all", value: "None" }, { label: "Help Alira", value: "Alira" }] },
        { name: "enemyLevel", label: "Enemy level:", type: "number", defaultValue: 84, eligible: false, options: [] },
      ]}
      onChange={() => undefined}
    />);

    expect(markup).toContain("Is the enemy a boss?");
    expect(markup).toContain("Bandit quest:");
    expect(markup).toContain("Kill all");
    expect(markup).toContain("Help Alira");
    expect(markup).toContain("PoB default");
    expect(markup).not.toContain("Enemy level:");
    expect(markup).toContain("Show all configurations");
  });

  it("does not expose internal calculation keys", () => {
    const build = {
      ...emptyPobBuild(),
      playerStats: [{ name: "PhysicalMaximumHitTaken", label: "Physical max hit", value: 12345, category: "defence" as const, percent: false }],
    };
    const markup = renderToStaticMarkup(<PlannerCalcsPanel build={build} editedSinceImport={false} comparison={null}/>);

    expect(markup).toContain("Physical max hit");
    expect(markup).not.toContain("PhysicalMaximumHitTaken");
  });
});

describe("planner saved-library recovery", () => {
  it("locks writes and explains the preserve-before-reset recovery action", () => {
    const markup = renderToStaticMarkup(<PlannerBuildsPanel
      builds={[]}
      activeId=""
      baselineId=""
      libraryError="The saved build library contains invalid JSON."
      recoveringLibrary={false}
      onRecoverLibrary={() => undefined}
      onSave={() => undefined}
      onLoad={() => undefined}
      onDelete={() => undefined}
      onDuplicate={() => undefined}
      onBaseline={() => undefined}
      onExport={() => undefined}
    />);

    expect(markup).toContain("Saved library locked");
    expect(markup).toContain("The original browser data has not been changed");
    expect(markup).toContain("Save recovery copy &amp; reset");
    expect(markup).toMatch(/<button[^>]*disabled=""[^>]*>[^<]*(?:<svg[\s\S]*?<\/svg>)?[^<]*Save current/);
  });
});
