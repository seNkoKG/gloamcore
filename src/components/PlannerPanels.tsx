import clsx from "clsx";
import {
  Copy,
  GitCompare,
  Library,
  RotateCcw,
  Save,
  Search,
  Shield,
  Sparkles,
  Trash2,
} from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { pobInputLabel, type ImportedPobBuild, type ImportedPobItem, type ImportedPobStat, type PobStatCategory } from "../lib/planner/pob-build";
import {
  comparePlannerBuilds,
  formatPobStatValue,
  groupPobStats,
  type PlannerWorkspaceSnapshot,
} from "../lib/planner/planner-workspace";

const CATEGORY_ORDER: PobStatCategory[] = ["offence", "defence", "resources", "recovery", "resistances", "attributes", "charges", "other"];
const KEY_STATS = ["FullDPS", "CombinedDPS", "TotalDPS", "TotalEHP", "Life", "EnergyShield", "Mana", "Armour", "Evasion", "PhysicalMaximumHitTaken", "FireResist", "ColdResist", "LightningResist", "ChaosResist"];

function PlannerEmpty({ children }: { children: ReactNode }) {
  return <div className="planner-empty"><p>{children}</p></div>;
}

const ITEM_PROPERTY_LABELS: Record<string, string> = {
  armour: "Armour",
  evasion: "Evasion",
  "energy shield": "Energy shield",
  ward: "Ward",
  "item level": "Item level",
  levelreq: "Requires level",
  quality: "Quality",
  sockets: "Sockets",
  radius: "Radius",
  "limited to": "Limit",
  league: "League",
  catalyst: "Catalyst",
  catalystquality: "Catalyst quality",
  "cluster jewel skill": "Small passives",
  "cluster jewel node count": "Passives",
  "talisman tier": "Talisman tier",
};

const ITEM_MOD_BADGES: Record<string, string> = {
  crafted: "Crafted",
  enchant: "Enchant",
  custom: "Custom",
  scourge: "Scourged",
  crucible: "Crucible",
  mutated: "Foulborn",
  fractured: "Fractured",
  exarch: "Exarch",
  eater: "Eater",
  synthesis: "Synthesised",
  disabled: "Disabled",
};

const ITEM_STATUS_LINES: Record<string, string> = {
  split: "Split",
  mirrored: "Mirrored",
  "fractured item": "Fractured",
  corrupted: "Corrupted",
};

export interface PlannerItemPresentation {
  rarity: string;
  rarityLabel: string;
  slotLabel: string;
  properties: { label: string; value: string }[];
  modifiers: { text: string; badges: string[] }[];
  statuses: string[];
}

function displayItemSlot(slot: string) {
  if (!slot) return "Not assigned";
  if (/^Jewel \d+$/i.test(slot)) return "Passive tree jewel";
  return slot
    .replace(/ Abyssal Socket /i, " · Abyss socket ")
    .replace(/ Swap$/i, " · swap");
}

function formatItemProperty(label: string, value: string) {
  if (/^(?:quality|catalystquality)$/i.test(label) && /^\d+(?:\.\d+)?$/.test(value)) return `+${value}%`;
  return value;
}

function itemKind(item: ImportedPobItem) {
  const source = `${item.slot} ${item.baseType} ${item.name}`.toLowerCase();
  if (/jewel|eye jewel/.test(source)) return "jewel";
  if (/flask/.test(source)) return "flask";
  if (/helmet|helm/.test(source)) return "helmet";
  if (/body armour|chest/.test(source)) return "body";
  if (/glove|gauntlet/.test(source)) return "gloves";
  if (/boot|greave|slipper/.test(source)) return "boots";
  if (/shield|quiver|off hand/.test(source)) return "offhand";
  if (/ring|amulet|belt/.test(source)) return "accessory";
  if (/weapon|sword|axe|mace|bow|wand|staff|dagger|claw|sceptre/.test(source)) return "weapon";
  return "item";
}

function ItemArtwork({ item, compact = false }: { item: ImportedPobItem; compact?: boolean }) {
  return <span className={clsx("planner-item-art", `is-${itemKind(item)}`, compact && "is-compact")}>
    {item.icon
      ? <img src={item.icon} alt="" draggable={false}/>
      : <b title="Official artwork is unavailable for this imported item">{(item.baseType || item.name).replace(/[^a-z0-9]/gi, "").slice(0, 2).toUpperCase() || "?"}</b>}
  </span>;
}

interface ItemVariantSelection {
  variants: ReadonlySet<number>;
  version: number;
  groups: ReadonlyMap<number, number>;
  grouped: boolean;
}

function itemModLine(rawLine: string, selection: ItemVariantSelection) {
  const badges = new Set<string>();
  let variants: number[] = [];
  let versions: number[] = [];
  let groups: number[] = [];
  let text = rawLine;
  for (;;) {
    const tag = /^\{([^}:]+)(?::([^}]*))?\}/.exec(text);
    if (!tag) break;
    const name = tag[1].toLowerCase();
    if (name === "variant") variants = Array.from((tag[2] || "").matchAll(/\d+/g), (match) => Number(match[0]));
    else if (name === "version") versions = Array.from((tag[2] || "").matchAll(/\d+/g), (match) => Number(match[0]));
    else if (name === "group") groups = Array.from((tag[2] || "").matchAll(/\d+/g), (match) => Number(match[0]));
    else if (ITEM_MOD_BADGES[name]) badges.add(ITEM_MOD_BADGES[name]);
    text = text.slice(tag[0].length);
  }
  if (selection.grouped) {
    if (versions.length && (!selection.version || !versions.includes(selection.version))) return null;
    if (groups.length) {
      if (!variants.length || !groups.some((group) => {
        const selected = selection.groups.get(group);
        return selected != null && variants.includes(selected);
      })) return null;
    } else if (variants.length) {
      return null;
    }
  } else if (variants.length && selection.variants.size > 0 && !variants.some((variant) => selection.variants.has(variant))) {
    return null;
  }
  text = text.trim();
  return text ? { text, badges: [...badges] } : null;
}

export function presentPlannerItem(item: ImportedPobItem): PlannerItemPresentation {
  const lines = item.text
    .replace(/<ModRange\b[^>]*\/?\s*>/gi, "\n")
    .replace(/<[A-Za-z][^>]*\/?\s*>/g, " ")
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const rarityLine = lines.find((line) => /^Rarity:/i.test(line));
  const rarityLabel = rarityLine?.replace(/^Rarity:\s*/i, "").trim() || "Normal";
  const rarity = rarityLabel.toLowerCase().replace(/[^a-z]+/g, "-");
  const versions = lines.filter((line) => /^Version:/i.test(line)).map((line) => line.replace(/^Version:\s*/i, "").trim());
  const variants = lines.filter((line) => /^Variant:/i.test(line)).map((line) => line.replace(/^Variant:\s*/i, "").trim());
  const selectedVersion = Number(lines.find((line) => /^Selected Version:/i.test(line))?.replace(/^[^:]+:\s*/i, "")) || 0;
  const selectedVariantGroups = new Map(lines.flatMap((line) => {
    const match = /^Selected Variant Group:\s*(\d+)\s*=\s*(\d+)$/i.exec(line);
    return match ? [[Number(match[1]), Number(match[2])] as const] : [];
  }));
  const selectedVariants = new Set(lines
    .filter((line) => /^Selected (?:Alt )?Variant(?: Two| Three| Four| Five)?:/i.test(line))
    .map((line) => Number(line.replace(/^[^:]+:\s*/i, "")))
    .filter((value) => value > 0));
  const variantSelection: ItemVariantSelection = {
    variants: selectedVariants,
    version: selectedVersion,
    groups: selectedVariantGroups,
    grouped: selectedVersion > 0 || selectedVariantGroups.size > 0 || lines.some((line) => /\{(?:version|group):/i.test(line)),
  };
  const properties = new Map<string, string>();
  const statuses = new Set<string>();
  const modifiers: PlannerItemPresentation["modifiers"] = [];
  let modifierSection = false;
  let skippedName = false;
  let skippedBase = item.baseType === item.name;

  for (const rawLine of lines) {
    if (/^Rarity:/i.test(rawLine) || /^-+$/.test(rawLine)) continue;
    if (!skippedName && rawLine === item.name) {
      skippedName = true;
      continue;
    }
    if (!skippedBase && rawLine === item.baseType) {
      skippedBase = true;
      continue;
    }
    if (/^Implicits:\s*\d+/i.test(rawLine)) {
      modifierSection = true;
      continue;
    }
    if (/^(?:Unique ID|Prefix|Suffix|ArmourBasePercentile|EvasionBasePercentile|EnergyShieldBasePercentile|WardBasePercentile|Selected Version|Selected Variant Group|Selected (?:Alt )?Variant(?: Two| Three| Four| Five)?|Has Variants|Selected Variants|Has Alt Variant(?: Two| Three| Four| Five)?|Allow Duplicate Variants):/i.test(rawLine)) continue;
    if (/^(?:Version|Variant):/i.test(rawLine)) continue;
    if (/^Crafted:\s*true$/i.test(rawLine)) {
      statuses.add("Crafted");
      continue;
    }
    if (/^Unreleased:\s*true$/i.test(rawLine)) {
      statuses.add("Unreleased");
      continue;
    }
    const foil = /^Foil Unique(?:\s*\((.+)\))?$/i.exec(rawLine);
    const influence = modifierSection ? null : /^(.+) Item$/i.exec(rawLine);
    const status = ITEM_STATUS_LINES[rawLine.toLowerCase()] || (foil ? `Foil${foil[1] ? ` · ${foil[1]}` : ""}` : "") || influence?.[1] || "";
    if (status) {
      statuses.add(status);
      continue;
    }
    const classRequirement = /^Requires Class\s+(.+)$/i.exec(rawLine);
    if (classRequirement) {
      properties.set("Class", classRequirement[1]);
      continue;
    }
    const property = /^([^:]+):\s*(.+)$/.exec(rawLine);
    const propertyLabel = property && ITEM_PROPERTY_LABELS[property[1].toLowerCase()];
    if (propertyLabel) {
      properties.set(propertyLabel, formatItemProperty(property[1], property[2]));
      continue;
    }
    const mod = itemModLine(rawLine, variantSelection);
    if (mod && (modifierSection || rawLine.startsWith("{"))) modifiers.push(mod);
  }
  const selectedVariantIds = variantSelection.grouped ? [...selectedVariantGroups.values()] : [...selectedVariants];
  const selectedVariantLabels = [...new Set(selectedVariantIds)]
    .map((variant) => variants[variant - 1])
    .filter((variant): variant is string => Boolean(variant));
  const selectedVersionLabel = versions[selectedVersion - 1];
  if (selectedVersionLabel) properties.set("Version", selectedVersionLabel);
  if (selectedVariantLabels.length) properties.set(selectedVariantLabels.length === 1 ? "Variant" : "Variants", selectedVariantLabels.join(" / "));
  return {
    rarity,
    rarityLabel: rarityLabel.charAt(0).toUpperCase() + rarityLabel.slice(1).toLowerCase(),
    slotLabel: displayItemSlot(item.slot),
    properties: [...properties].map(([label, value]) => ({ label, value })),
    modifiers,
    statuses: [...statuses],
  };
}

const PAPER_DOLL_SLOTS = [
  { key: "weapon-1", label: "Main hand", slots: ["Weapon 1", "Weapon"], area: "main" },
  { key: "helmet", label: "Helmet", slots: ["Helmet", "Helm"], area: "helmet" },
  { key: "weapon-2", label: "Off hand", slots: ["Weapon 2", "Off Hand", "Offhand"], area: "off" },
  { key: "ring-1", label: "Left ring", slots: ["Ring 1", "Ring"], area: "ring1" },
  { key: "body", label: "Body armour", slots: ["Body Armour"], area: "body" },
  { key: "ring-2", label: "Right ring", slots: ["Ring 2"], area: "ring2" },
  { key: "gloves", label: "Gloves", slots: ["Gloves"], area: "gloves" },
  { key: "amulet", label: "Amulet", slots: ["Amulet"], area: "amulet" },
  { key: "boots", label: "Boots", slots: ["Boots"], area: "boots" },
  { key: "belt", label: "Belt", slots: ["Belt"], area: "belt" },
] as const;

function slotMatches(itemSlot: string, choices: readonly string[], swap = false) {
  const normalized = itemSlot.replace(/\s+/g, " ").trim().toLowerCase();
  const isSwap = /\bswap\b/i.test(normalized);
  if (swap !== isSwap) return false;
  const withoutSwap = normalized.replace(/\s*swap\s*$/i, "");
  return choices.some((choice) => withoutSwap === choice.toLowerCase());
}

export function PlannerItemsPanel({ build, onChange }: { build: ImportedPobBuild | null; onChange: (build: ImportedPobBuild) => void }) {
  const [selectedId, setSelectedId] = useState(0);
  const [weaponSet, setWeaponSet] = useState<1 | 2>(1);
  if (!build?.items.length) return <PlannerEmpty>Import a character or PoB build to inspect and edit its item loadout.</PlannerEmpty>;
  const presented = build.items.map((item) => ({ item, view: presentPlannerItem(item) }));
  const equipped = presented.filter(({ item }) => item.equipped && item.slot);
  const isSocketedJewel = (item: ImportedPobItem) => /^Jewel \d+$/i.test(item.slot) || /Abyssal Socket/i.test(item.slot);
  const jewels = equipped.filter(({ item }) => isSocketedJewel(item));
  const clusterJewels = jewels.filter(({ item }) => /cluster jewel/i.test(`${item.name} ${item.baseType}`));
  const baseJewels = jewels.filter(({ item }) => !/cluster jewel/i.test(`${item.name} ${item.baseType}`));
  const flasks = [1, 2, 3, 4, 5].map((index) => equipped.find(({ item }) => slotMatches(item.slot, [`Flask ${index}`, index === 1 ? "Flask" : ""])));
  const alternatives = presented.filter(({ item }) => !item.equipped || !item.slot);
  const selected = presented.find(({ item }) => item.id === selectedId)
    || equipped.find(({ item }) => !isSocketedJewel(item))
    || jewels[0]
    || presented[0];
  const toggle = (id: number) => {
    const target = build.items.find((item) => item.id === id);
    if (!target?.slot) return;
    const nextEquipped = !target.equipped;
    onChange({
      ...build,
      items: build.items.map((item) => item.id === id
        ? { ...item, equipped: nextEquipped }
        : nextEquipped && target.slot && item.slot === target.slot
          ? { ...item, equipped: false }
          : item),
    });
  };
  const paperSlot = (definition: typeof PAPER_DOLL_SLOTS[number]) => {
    const entry = equipped.find(({ item }) => slotMatches(item.slot, definition.slots, weaponSet === 2 && /weapon/.test(definition.key)));
    return <button
      type="button"
      key={definition.key}
      className={clsx("planner-paper-slot", `is-${definition.area}`, entry && `is-${entry.view.rarity}`, entry?.item.id === selected.item.id && "is-selected")}
      onClick={() => entry && setSelectedId(entry.item.id)}
      title={entry ? `${definition.label}: ${entry.item.name}` : `${definition.label}: empty`}
    >
      {entry ? <><ItemArtwork item={entry.item}/><span>{entry.item.name}</span></> : <><i/><span>{definition.label}</span></>}
    </button>;
  };
  const jewelTray = (title: string, entries: typeof jewels) => entries.length > 0 && <section className="planner-jewel-tray">
    <header><strong>{title}</strong><small>{entries.length}</small></header>
    <div>{entries.map(({ item, view }) => <button type="button" key={item.id} className={clsx(`is-${view.rarity}`, item.id === selected.item.id && "is-selected")} onClick={() => setSelectedId(item.id)} title={`${item.name} · ${view.slotLabel}`}><ItemArtwork item={item} compact/><span>{item.name}</span></button>)}</div>
  </section>;
  const selectedEquipped = Boolean(selected.item.equipped && selected.item.slot);
  return <div className="planner-items-panel">
    <section className="planner-loadout-board">
      <header><span><Shield size={15}/><strong>Equipment</strong><small>{equipped.length} equipped · official game artwork</small></span><div className="planner-weapon-set"><button type="button" className={weaponSet === 1 ? "is-active" : ""} onClick={() => setWeaponSet(1)}>I</button><button type="button" className={weaponSet === 2 ? "is-active" : ""} onClick={() => setWeaponSet(2)}>II</button></div></header>
      <div className="planner-paper-doll">{PAPER_DOLL_SLOTS.map(paperSlot)}</div>
      <section className="planner-flask-belt"><header><strong>Flasks</strong></header><div>{[1, 2, 3, 4, 5].map((index) => {
        const entry = flasks[index - 1];
        return <button type="button" key={index} className={clsx("planner-flask-slot", entry && `is-${entry.view.rarity}`, entry?.item.id === selected.item.id && "is-selected")} onClick={() => entry && setSelectedId(entry.item.id)} title={entry?.item.name || `Flask ${index}: empty`}>{entry ? <ItemArtwork item={entry.item}/> : <i/>}</button>;
      })}</div></section>
      {jewelTray("Cluster jewels", clusterJewels)}
      {jewelTray("Base & Timeless jewels", baseJewels)}
      {alternatives.length > 0 && <section className="planner-item-alternatives"><header><strong>Imported alternatives</strong><small>{alternatives.length}</small></header><div>{alternatives.map(({ item, view }) => <button type="button" key={item.id} className={clsx(`is-${view.rarity}`, item.id === selected.item.id && "is-selected")} onClick={() => setSelectedId(item.id)} title={`${item.name} · ${view.slotLabel}`}><ItemArtwork item={item} compact/><span><strong>{item.name}</strong><small>{view.slotLabel}</small></span></button>)}</div></section>}
    </section>
    <aside className={clsx("planner-item-inspector", `is-${selected.view.rarity}`)}>
      <header><ItemArtwork item={selected.item}/><span><small>{selected.view.slotLabel}</small><strong>{selected.item.name}</strong></span></header>
      <div className="planner-item-identity"><small>{selected.view.rarityLabel}</small>{selected.item.baseType && selected.item.baseType !== selected.item.name && <span>{selected.item.baseType}</span>}</div>
      <label className="planner-item-loadout" title={selected.item.slot ? `${selectedEquipped ? "Remove" : "Equip"} ${selected.item.name}` : "This imported item has no saved equipment slot"}><input type="checkbox" checked={selectedEquipped} disabled={!selected.item.slot} onChange={() => toggle(selected.item.id)}/><span>{selectedEquipped ? "Equipped" : selected.item.slot ? "Equip in this slot" : "No saved slot"}</span></label>
      {selected.view.statuses.length > 0 && <div className="planner-item-badges">{selected.view.statuses.map((status) => <b key={status}>{status}</b>)}</div>}
      {selected.view.properties.length > 0 && <dl className="planner-item-properties">{selected.view.properties.map((property) => <div key={property.label}><dt>{property.label}</dt><dd>{property.value}</dd></div>)}</dl>}
      {selected.view.modifiers.length > 0 ? <section className="planner-item-modifiers"><h4>Modifiers</h4><ul>{selected.view.modifiers.map((modifier, index) => <li key={`${modifier.text}-${index}`}>{modifier.badges.length > 0 && <span>{modifier.badges.map((badge) => <b key={badge}>{badge}</b>)}</span>}<em>{modifier.text}</em></li>)}</ul></section> : <p className="planner-item-no-mods">No modifiers in the imported item.</p>}
    </aside>
  </div>;
}

export function PlannerSkillsPanel({ build, onChange }: { build: ImportedPobBuild | null; onChange: (build: ImportedPobBuild) => void }) {
  const [selectedGroupId, setSelectedGroupId] = useState("");
  if (!build?.skillGroups.length) return <PlannerEmpty>Imported socket groups and gems appear here.</PlannerEmpty>;
  const updateGroup = (groupIndex: number, patch: Partial<ImportedPobBuild["skillGroups"][number]>) => onChange({
    ...build,
    skillGroups: build.skillGroups.map((group, index) => index === groupIndex ? { ...group, ...patch } : group),
  });
  const updateGem = (groupIndex: number, gemIndex: number, patch: Partial<ImportedPobBuild["skillGroups"][number]["gems"][number]>) => onChange({
    ...build,
    skillGroups: build.skillGroups.map((group, index) => index === groupIndex ? {
      ...group,
      gems: group.gems.map((gem, index2) => index2 === gemIndex ? { ...gem, ...patch } : gem),
    } : group),
  });
  const selectedGroupIndex = Math.max(0, build.skillGroups.findIndex((group) => group.id === selectedGroupId));
  const selected = build.skillGroups[selectedGroupIndex];
  const isSupport = (gem: typeof selected.gems[number]) => gem.support === true || /support/i.test(`${gem.skillId} ${gem.gemId || ""}`);
  const activeSkills = selected.activeSkills?.length
    ? selected.activeSkills
    : selected.gems.filter((gem) => gem.enabled && !isSupport(gem)).map((gem, index) => ({ index: index + 1, name: gem.name }));
  const selectedActiveSkill = activeSkills.find((skill) => skill.index === (selected.mainActiveSkill || 1)) || activeSkills[0];
  const gemArtwork = (gem: typeof selected.gems[number], compact = false) => <span className={clsx("planner-gem-art", compact && "is-compact", isSupport(gem) && "is-support")}>
    {gem.icon ? <img src={gem.icon} alt="" draggable={false}/> : <b title="Official gem artwork is unavailable">{gem.name.slice(0, 1)}</b>}
  </span>;
  return <div className="planner-skills-workbench">
    <aside className="planner-skill-groups">
      <header><span><Sparkles size={15}/><strong>Socket groups</strong></span><small>{build.skillGroups.length} groups</small></header>
      <div>{build.skillGroups.map((group, groupIndex) => {
        const representative = group.gems.find((gem) => gem.enabled && !(gem.support === true || /support/i.test(`${gem.skillId} ${gem.gemId || ""}`))) || group.gems[0];
        return <button type="button" key={group.id} className={clsx(selected.id === group.id && "is-selected", !group.enabled && "is-disabled", build.mainSocketGroup === groupIndex + 1 && "is-main")} onClick={() => setSelectedGroupId(group.id)}>
        {representative ? gemArtwork(representative, true) : <span className="planner-gem-art is-compact"><b>0</b></span>}<span><small>{group.slot}</small><strong>{group.label || group.gems[0]?.name || `Skill group ${groupIndex + 1}`}</strong><em>{group.gems.map((gem) => gem.name).join(" · ")}</em></span><b>{build.mainSocketGroup === groupIndex + 1 ? "MAIN" : group.includeInFullDps ? "DPS" : ""}</b>
      </button>;})}</div>
    </aside>
    <section className="planner-skill-editor">
      <header><span><small>{selected.slot}</small><strong>{selected.label || selected.gems[0]?.name || "Socket group"}</strong></span><label><input type="checkbox" checked={selected.enabled} onChange={(event) => updateGroup(selectedGroupIndex, { enabled: event.target.checked })}/> Group enabled</label></header>
      <div className="planner-main-skill-controls"><label><span>Main socket group</span><button type="button" className={build.mainSocketGroup === selectedGroupIndex + 1 ? "is-active" : ""} onClick={() => onChange({ ...build, mainSocketGroup: selectedGroupIndex + 1 })}>{build.mainSocketGroup === selectedGroupIndex + 1 ? "Selected for calculations" : "Use this group"}</button></label><label><span>Main active skill</span><select aria-label="Main active skill" value={selectedActiveSkill?.index || 1} disabled={!activeSkills.length} onChange={(event) => updateGroup(selectedGroupIndex, { mainActiveSkill: Number(event.target.value), mainActiveSkillCalcs: Number(event.target.value) })}>{activeSkills.map((skill) => <option key={`${skill.index}-${skill.name}`} value={skill.index}>{skill.name}</option>)}</select></label></div>
      <div className="planner-skill-options"><label><input type="checkbox" checked={selected.includeInFullDps} onChange={(event) => updateGroup(selectedGroupIndex, { includeInFullDps: event.target.checked })}/> Include in Full DPS</label><span>{selected.gems.filter((gem) => gem.enabled).length}/{selected.gems.length} enabled · recalculation uses the selected group and skill</span></div>
      <div className="planner-gem-editor-list">{selected.gems.map((gem, gemIndex) => <article key={`${gem.skillId}-${gemIndex}`} className={!gem.enabled ? "is-disabled" : ""}>
        <label className="planner-gem-toggle"><input type="checkbox" checked={gem.enabled} onChange={(event) => updateGem(selectedGroupIndex, gemIndex, { enabled: event.target.checked })}/>{gemArtwork(gem)}<span><strong>{gem.name}</strong><small>{isSupport(gem) ? "Support gem" : "Active gem"} · {gem.skillId || gem.gemId}</small></span></label>
        <span className="planner-gem-values"><label>LEVEL<input type="number" min="1" max="40" value={gem.level} onChange={(event) => updateGem(selectedGroupIndex, gemIndex, { level: Math.max(1, Math.min(40, Number(event.target.value) || 1)) })}/></label><label>QUALITY<input type="number" min="0" max="100" value={gem.quality} onChange={(event) => updateGem(selectedGroupIndex, gemIndex, { quality: Math.max(0, Math.min(100, Number(event.target.value) || 0)) })}/></label></span>
      </article>)}</div>
    </section>
  </div>;
}

export function PlannerConfigPanel({ build, onChange }: { build: ImportedPobBuild | null; onChange: (build: ImportedPobBuild) => void }) {
  const [query, setQuery] = useState("");
  const [section, setSection] = useState("all");
  if (!build) return <PlannerEmpty>Import a character or PoB build to edit configuration values.</PlannerEmpty>;
  const update = (name: string, value: string | number | boolean) => onChange({ ...build, config: { ...build.config, [name]: value } });
  const remove = (name: string) => {
    const config = { ...build.config };
    delete config[name];
    onChange({ ...build, config });
  };
  if (!Object.keys(build.config).length) return <PlannerEmpty>This build has no saved Path of Building configuration inputs.</PlannerEmpty>;
  const sectionFor = (name: string) => {
    if (/enemy|boss|resist|armour|curse|mark|exposure|wither|shock|chill|ignite|bleed|poison/i.test(name)) return "enemy";
    if (/map|area|league|delirium|ultimatum|ritual|sanctum|pinnacle/i.test(name)) return "map";
    if (/skill|stage|stack|warcry|brand|mine|trap|totem|minion|projectile/i.test(name)) return "skill";
    if (/party|ally|aura|nearby|mercenary/i.test(name)) return "party";
    if (/custom|override|condition/i.test(name)) return "custom";
    return "combat";
  };
  const sections = [
    ["all", "All saved inputs"],
    ["combat", "When in combat"],
    ["enemy", "Enemy state"],
    ["skill", "Skill state"],
    ["map", "Map & encounter"],
    ["party", "Party & allies"],
    ["custom", "Custom overrides"],
  ] as const;
  const entries = Object.entries(build.config);
  const visible = entries.filter(([name]) => (section === "all" || sectionFor(name) === section) && (!query || pobInputLabel(name).toLowerCase().includes(query.toLowerCase())));
  return <div className="planner-config-workbench">
    <aside><header><strong>Configuration</strong><small>{entries.length} saved inputs</small></header><nav>{sections.map(([id, label]) => { const count = id === "all" ? entries.length : entries.filter(([name]) => sectionFor(name) === id).length; return <button type="button" key={id} className={section === id ? "is-selected" : ""} onClick={() => setSection(id)}><span>{label}</span><b>{count}</b></button>; })}</nav></aside>
    <section className="planner-config-shell">
      <header><span><strong>{sections.find(([id]) => id === section)?.[1]}</strong><small>Values are stored in this build and recalculated by local Path of Building.</small></span><label><Search size={12}/><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Filter configuration"/></label></header>
      <p className="planner-config-note">Reset removes the saved override so Path of Building applies its own default. GloamCore does not invent values that were absent from the build.</p>
      <div className="planner-config">{visible.map(([name, value]) => <label key={name}><span>{pobInputLabel(name)}</span><span>{typeof value === "boolean" ? <input aria-label={pobInputLabel(name)} type="checkbox" checked={value} onChange={(event) => update(name, event.target.checked)}/> : typeof value === "number" ? <input aria-label={pobInputLabel(name)} type="number" value={value} onChange={(event) => update(name, Number(event.target.value) || 0)}/> : <input aria-label={pobInputLabel(name)} value={String(value)} onChange={(event) => update(name, event.target.value)}/>}<button type="button" aria-label={`Reset ${pobInputLabel(name)}`} title="Reset to Path of Building default" onClick={() => remove(name)}><RotateCcw size={12}/></button></span></label>)}</div>
      {visible.length === 0 && <PlannerEmpty>No saved inputs match this section and filter.</PlannerEmpty>}
    </section>
  </div>;
}

function statMatches(stat: ImportedPobStat, query: string, category: PobStatCategory | "all") {
  return (category === "all" || stat.category === category) && (!query || `${stat.name} ${stat.label}`.toLowerCase().includes(query.toLowerCase()));
}

export function PlannerCalcsPanel({
  build,
  editedSinceImport,
  comparison,
}: {
  build: ImportedPobBuild | null;
  editedSinceImport: boolean;
  comparison: ReturnType<typeof comparePlannerBuilds> | null;
}) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<PobStatCategory | "all">("all");
  const stats = build?.playerStats || [];
  const filtered = stats.filter((stat) => statMatches(stat, query, category));
  const keys = KEY_STATS.map((name) => stats.find((stat) => stat.name === name)).filter((stat): stat is ImportedPobStat => Boolean(stat));
  const isEngineResult = build?.statSource === "pob-engine";
  if (!build) return <PlannerEmpty>Import a PoB build to inspect its calculated offence, defence, recovery, and resource output.</PlannerEmpty>;
  const categoryCounts = new Map(CATEGORY_ORDER.map((value) => [value, stats.filter((stat) => stat.category === value).length]));
  return <div className="planner-calcs-workbench">
    <aside><header><strong>Calculations</strong><small>{stats.length} exact outputs</small></header><nav><button type="button" className={category === "all" ? "is-selected" : ""} onClick={() => setCategory("all")}><span>Overview</span><b>{stats.length}</b></button>{CATEGORY_ORDER.map((value) => <button type="button" key={value} className={category === value ? "is-selected" : ""} onClick={() => setCategory(value)}><span>{value}</span><b>{categoryCounts.get(value)}</b></button>)}</nav></aside>
    <div className="planner-calcs">
    <div className={clsx("planner-calc-source", editedSinceImport && "is-stale")}><strong>{isEngineResult ? `${stats.length} authoritative outputs calculated by local Path of Building` : stats.length ? `${stats.length} exact PlayerStat values imported from PoB` : "No evaluated PlayerStat snapshot in this import"}</strong><span>{editedSinceImport ? `${isEngineResult ? "The authoritative calculation" : "The imported snapshot"} is now stale because items, gems, config, or tree changed here. Recalculate in PoB to refresh it.` : isEngineResult ? "These values came from a fresh, isolated Path of Building calculation of the current build." : stats.length ? "These are PoB's saved calculation outputs, not estimated values." : "Character API imports contain loadout/tree data but no PoB calculation snapshot."}</span></div>
    {keys.length > 0 && <div className="planner-key-stats">{keys.slice(0, 10).map((stat) => <article key={stat.name}><small>{stat.label}</small><strong>{formatPobStatValue(stat)}</strong></article>)}</div>}
    <div className="planner-calc-controls"><label><Search size={13}/><input aria-label="Search Path of Building calculation outputs" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search this calculation section"/></label><span>{filtered.length} shown</span></div>
    {comparison && <div className="planner-comparison-summary"><GitCompare size={15}/><strong>Compared with saved baseline</strong><span>+{comparison.addedNodes.length}/−{comparison.removedNodes.length} nodes · +{comparison.addedItems.length}/−{comparison.removedItems.length} items · +{comparison.addedGems.length}/−{comparison.removedGems.length} gems</span></div>}
    <div className={clsx("planner-stat-table", comparison && "has-comparison")}><header><span>Output</span><span>Value</span>{comparison && <span>Delta</span>}</header>{filtered.map((stat) => { const delta = comparison?.stats.find((entry) => entry.name === stat.name)?.delta || 0; return <div key={stat.name}><span><small>{stat.category}</small>{stat.label}</span><strong>{formatPobStatValue(stat)}</strong>{comparison && <b className={delta > 0 ? "is-positive" : delta < 0 ? "is-negative" : ""}>{delta ? `${delta > 0 ? "+" : ""}${Number(delta.toFixed(2)).toLocaleString("en-US")}${stat.percent ? "%" : ""}` : "—"}</b>}</div>; })}</div>
    </div>
  </div>;
}

export function PlannerGalaxyPanel({ build }: { build: ImportedPobBuild | null }) {
  const [selected, setSelected] = useState<PobStatCategory>("offence");
  const grouped = useMemo(() => groupPobStats(build?.playerStats || []), [build?.playerStats]);
  const categories = CATEGORY_ORDER.map((category) => ({ category, stats: grouped.get(category) || [] })).filter((entry) => entry.stats.length);
  if (!categories.length) return <PlannerEmpty>Galaxy needs a PoB build containing evaluated PlayerStat outputs.</PlannerEmpty>;
  const selectedStats = grouped.get(selected) || categories[0].stats;
  const actualSelected = selectedStats === categories[0].stats && !grouped.get(selected)?.length ? categories[0].category : selected;
  return <div className="planner-galaxy">
    <div className="planner-galaxy-map" aria-label="Build stat galaxy">{categories.map((entry, index) => {
      const angle = (Math.PI * 2 * index) / categories.length - Math.PI / 2;
      const left = 50 + Math.cos(angle) * 35;
      const top = 50 + Math.sin(angle) * 35;
      const magnitude = entry.stats.reduce((sum, stat) => sum + Math.log10(Math.abs(stat.value) + 1), 0);
      return <button type="button" key={entry.category} className={actualSelected === entry.category ? "is-active" : ""} style={{ left: `${left}%`, top: `${top}%`, width: `${Math.min(92, 48 + magnitude)}px`, height: `${Math.min(92, 48 + magnitude)}px` }} onClick={() => setSelected(entry.category)}><strong>{entry.category}</strong><small>{entry.stats.length} outputs</small></button>;
    })}<div className="planner-galaxy-core"><strong>{build?.ascendancyName || build?.className}</strong><small>LEVEL {build?.level}</small></div></div>
    <section><header><strong>{actualSelected}</strong><span>{selectedStats.length} imported outputs</span></header>{selectedStats.sort((a, b) => Math.abs(b.value) - Math.abs(a.value)).slice(0, 24).map((stat) => <div key={stat.name}><span>{stat.label}</span><strong>{formatPobStatValue(stat)}</strong></div>)}</section>
  </div>;
}

export function PlannerBuildsPanel({
  builds,
  activeId,
  baselineId,
  libraryError,
  recoveringLibrary,
  onRecoverLibrary,
  onSave,
  onLoad,
  onDelete,
  onDuplicate,
  onBaseline,
  onExport,
}: {
  builds: readonly PlannerWorkspaceSnapshot[];
  activeId: string;
  baselineId: string;
  libraryError: string;
  recoveringLibrary: boolean;
  onRecoverLibrary: () => void;
  onSave: (name: string, tags: string[]) => void;
  onLoad: (build: PlannerWorkspaceSnapshot) => void;
  onDelete: (id: string) => void;
  onDuplicate: (build: PlannerWorkspaceSnapshot) => void;
  onBaseline: (id: string) => void;
  onExport: (build: PlannerWorkspaceSnapshot) => void;
}) {
  const [name, setName] = useState("");
  const [tagText, setTagText] = useState("");
  const [query, setQuery] = useState("");
  const filtered = builds.filter((build) => `${build.name} ${build.tags.join(" ")} ${build.build?.className || ""} ${build.build?.ascendancyName || ""}`.toLowerCase().includes(query.toLowerCase()));
  return <div className="planner-build-library">
    <header><span><Library size={18}/><strong>Local build library</strong><small>Saved on this computer. Export JSON or PoB code for portable sharing.</small></span><div><input value={name} onChange={(event) => setName(event.target.value)} placeholder="Build name"/><input value={tagText} onChange={(event) => setTagText(event.target.value)} placeholder="Tags, comma separated"/><button type="button" disabled={Boolean(libraryError) || recoveringLibrary} onClick={() => { onSave(name, tagText.split(",").map((tag) => tag.trim()).filter(Boolean)); setName(""); }}><Save size={13}/> Save current</button></div></header>
    {libraryError && <section className="planner-library-recovery" role="alert"><span><strong>Saved library locked</strong><small>{libraryError}</small><p>The original browser data has not been changed. Reset is allowed only after an exact recovery copy is saved to a file.</p></span><button type="button" disabled={recoveringLibrary} onClick={onRecoverLibrary}><RotateCcw size={13}/> {recoveringLibrary ? "Saving recovery copy…" : "Save recovery copy & reset"}</button></section>}
    <label className="planner-inline-search"><Search size={13}/><input aria-label="Search saved builds and tags" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search saved builds and tags"/><small>{filtered.length}/{builds.length}</small></label>
    <div className="planner-build-rows">{filtered.map((saved) => <article key={saved.id} className={saved.id === activeId ? "is-active" : ""}><div><small>{new Date(saved.updatedAt).toLocaleString()}</small><strong>{saved.name}</strong><span>{saved.build ? `Level ${saved.build.level} ${saved.build.ascendancyName || saved.build.className}` : "Passive tree workspace"} · {saved.allocated.length} saved allocations</span>{saved.tags.length > 0 && <footer>{saved.tags.map((tag) => <b key={tag}>{tag}</b>)}</footer>}</div><nav><button type="button" onClick={() => onLoad(saved)}>Open</button><button type="button" className={baselineId === saved.id ? "is-selected" : ""} onClick={() => onBaseline(baselineId === saved.id ? "" : saved.id)}><GitCompare size={12}/> {baselineId === saved.id ? "Baseline" : "Compare"}</button><button type="button" aria-label={`Duplicate ${saved.name}`} title="Duplicate" onClick={() => onDuplicate(saved)}><Copy size={12}/></button><button type="button" title="Export" onClick={() => onExport(saved)}>Export</button><button type="button" aria-label={`Delete ${saved.name}`} title="Delete" onClick={() => onDelete(saved.id)}><Trash2 size={12}/></button></nav></article>)}</div>
  </div>;
}
