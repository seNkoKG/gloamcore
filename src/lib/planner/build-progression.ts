import { buildOfficialTradeBrowserUrl } from "../price-check/official-trade-route";
import {
  pobSkillSetSummaries,
  withActivePobSkillSet,
  type ImportedPobBuild,
  type ImportedPobGem,
  type ImportedPobItem,
} from "./pob-build";

export interface PobAuthoredStage {
  id: string;
  title: string;
  count: number;
  added: string[];
  removed: string[];
}

export interface PobBuildProgression {
  passive: PobAuthoredStage[];
  skills: PobAuthoredStage[];
  items: PobAuthoredStage[];
}

function differences(current: Map<string, string>, previous: Map<string, string>) {
  return {
    added: [...current].filter(([key]) => !previous.has(key)).map(([, label]) => label),
    removed: [...previous].filter(([key]) => !current.has(key)).map(([, label]) => label),
  };
}

function gemKey(gem: ImportedPobGem, group: string, index: number) {
  return `${group}\0${gem.gemId || gem.skillId || gem.name}\0${gem.variantId || ""}\0${index}`;
}

export function derivePobBuildProgression(build: ImportedPobBuild): PobBuildProgression {
  let previousNodes = new Map<string, string>();
  const passive = build.specs.map((spec, index): PobAuthoredStage => {
    const current = new Map(spec.nodes.map((id) => [String(id), `Passive #${id}`]));
    const delta = differences(current, previousNodes);
    previousNodes = current;
    return {
      id: `passive:${spec.id}`,
      title: spec.title || `Tree spec ${index + 1}`,
      count: current.size,
      ...delta,
    };
  });

  let previousGems = new Map<string, string>();
  const skills = pobSkillSetSummaries(build).map((summary): PobAuthoredStage => {
    const selected = withActivePobSkillSet(build, summary.id);
    const current = new Map(selected.skillGroups.flatMap((group) =>
      group.gems.map((gem, index) => [
        gemKey(gem, group.id, index),
        `${gem.name} · ${group.label || group.slot || "Skill group"}`,
      ] as const),
    ));
    const delta = differences(current, previousGems);
    previousGems = current;
    return {
      id: `skills:${summary.id}`,
      title: summary.title,
      count: current.size,
      ...delta,
    };
  });

  const itemsById = new Map(build.items.map((item) => [item.id, item]));
  let previousItems = new Map<string, string>();
  const items = build.itemSets.map((set, index): PobAuthoredStage => {
    const current = new Map(Object.entries(set.slots).flatMap(([slot, value]) => {
      const item = itemsById.get(value.itemId);
      return item ? [[slot, `${slot}: ${item.name || item.baseType}`] as const] : [];
    }));
    const changed = [...current].flatMap(([slot, label]) => {
      const previous = previousItems.get(slot);
      return previous != null && previous !== label
        ? [{ slot, current: label, previous }]
        : [];
    });
    const delta = differences(current, previousItems);
    previousItems = current;
    return {
      id: `items:${set.id}`,
      title: set.title || `Item set ${index + 1}`,
      count: current.size,
      added: [...delta.added, ...changed.map((entry) => entry.current)],
      removed: [...delta.removed, ...changed.map((entry) => entry.previous)],
    };
  });
  return { passive, skills, items };
}

function itemRarity(item: ImportedPobItem) {
  return /^Rarity:\s*(\S+)/mi.exec(item.text)?.[1]?.toLocaleLowerCase() || "";
}

export function pobGearTradeHandoff(item: ImportedPobItem, league: string) {
  const unique = itemRarity(item) === "unique";
  const type = item.baseType.trim();
  if (!league.trim() || !type) return null;
  const query = {
    query: {
      status: { option: "securable" },
      stats: [{ type: "and", filters: [] }],
      filters: {
        type_filters: {
          filters: { rarity: { option: unique ? "unique" : "nonunique" } },
        },
      },
      ...(unique && item.name.trim() ? { name: item.name.trim() } : {}),
      type,
    },
    sort: { price: "asc" },
  };
  return {
    url: buildOfficialTradeBrowserUrl({ league: league.trim(), tradeQuery: query }),
    scope: unique ? "unique-identity" as const : "base-only" as const,
    label: unique ? "Exact unique identity" : "Base type only",
    warning: unique
      ? "Official Trade will match this unique name and base; verify rolls before buying."
      : "Rare and magic modifiers are not inferred. Official Trade opens a base-type search only.",
  };
}

export function activePobGear(build: ImportedPobBuild) {
  const set = build.itemSets.find((entry) => entry.id === build.activeItemSet) || build.itemSets[0];
  const items = new Map(build.items.map((item) => [item.id, item]));
  return set
    ? Object.entries(set.slots).flatMap(([slot, value]) => {
        const item = items.get(value.itemId);
        return item ? [{ slot, item }] : [];
      })
    : build.items.filter((item) => item.equipped).map((item) => ({ slot: item.slot, item }));
}
