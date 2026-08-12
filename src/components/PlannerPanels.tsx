import clsx from "clsx";
import {
  Copy,
  FilePlus2,
  GitCompare,
  Library,
  LoaderCircle,
  Pencil,
  Plus,
  RotateCcw,
  Save,
  Search,
  Shield,
  Sparkles,
  Trash2,
} from "lucide-react";
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type CSSProperties,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import type { PobEngineConfigInput, PobEngineGemCatalogEntry, PobEngineScalar } from "../types";
import {
  addPobConfigSet,
  addPobSkillSet,
  importedPobGemArtworkKey,
  pobConfigSetSummaries,
  pobCustomModifierBlocks,
  pobInputLabel,
  pobSkillSetSummaries,
  withActivePobConfigSet,
  withActivePobItemSet,
  withActivePobSkillSet,
  withPobConfigSetTitle,
  withPobCustomModifierBlocks,
  withPobItemEquipped,
  withPobItemText,
  withPobSkillSetTitle,
  withoutPobConfigSet,
  withoutPobItem,
  withoutPobSkillSet,
  type ImportedPobActiveSkill,
  type ImportedPobBuild,
  type ImportedPobItem,
  type ImportedPobStat,
  type PobCustomModifierBlock,
  type PobStatCategory,
} from "../lib/planner/pob-build";
import {
  comparePlannerBuilds,
  formatPobStatValue,
  type PlannerWorkspaceSnapshot,
} from "../lib/planner/planner-workspace";

const CATEGORY_ORDER: PobStatCategory[] = ["offence", "defence", "resources", "recovery", "resistances", "attributes", "charges", "other"];
const KEY_STATS = ["FullDPS", "CombinedDPS", "TotalDPS", "TotalEHP", "Life", "EnergyShield", "Mana", "Armour", "Evasion", "PhysicalMaximumHitTaken", "FireResist", "ColdResist", "LightningResist", "ChaosResist"];
const EMPTY_GEM_ARTWORK = new Map<string, string>();
const EMPTY_GEM_CATALOG: PobEngineGemCatalogEntry[] = [];
const EMPTY_CONFIG_CATALOG: PobEngineConfigInput[] = [];

function PlannerEmpty({ children }: { children: ReactNode }) {
  return <div className="planner-empty"><p>{children}</p></div>;
}

const ITEM_PROPERTY_LABELS: Record<string, string> = {
  armour: "Armour",
  "physical damage": "Physical damage",
  "elemental damage": "Elemental damage",
  "chaos damage": "Chaos damage",
  "critical strike chance": "Critical strike chance",
  "attacks per second": "Attacks per second",
  "weapon range": "Weapon range",
  "chance to block": "Chance to block",
  evasion: "Evasion",
  "energy shield": "Energy shield",
  ward: "Ward",
  "item level": "Item level",
  levelreq: "Requires level",
  strreq: "Requires Str",
  dexreq: "Requires Dex",
  intreq: "Requires Int",
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

interface PlannerInventoryDimensions {
  width?: number;
  height?: number;
}

const EMPTY_ITEM_ARTWORK_DIMENSIONS = new Map<number, PlannerInventoryDimensions>();

function ItemArtwork({ item, artwork, dimensions, compact = false }: { item: ImportedPobItem; artwork?: string; dimensions?: PlannerInventoryDimensions; compact?: boolean }) {
  const image = item.icon || artwork;
  const width = item.width || dimensions?.width;
  const height = item.height || dimensions?.height;
  const style = width && height ? {
    "--planner-item-width": width,
    "--planner-item-height": height,
  } as CSSProperties : undefined;
  return <span className={clsx("planner-item-art", `is-${itemKind(item)}`, compact && "is-compact")} style={style} data-inventory-width={width} data-inventory-height={height}>
    {image
      ? <img src={image} alt="" draggable={false}/>
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

function PlannerItemTooltip({ item, view, anchor }: {
  item: ImportedPobItem;
  view: PlannerItemPresentation;
  anchor: HTMLElement;
}) {
  const tooltipRef = useRef<HTMLElement>(null);
  const [position, setPosition] = useState({ left: -10_000, top: -10_000 });

  useLayoutEffect(() => {
    const update = () => {
      const tooltip = tooltipRef.current;
      if (!tooltip || !anchor.isConnected) return;
      const anchorRect = anchor.getBoundingClientRect();
      const width = tooltip.offsetWidth;
      const height = Math.min(tooltip.offsetHeight, window.innerHeight - 16);
      const gap = 9;
      const left = anchorRect.right + gap + width <= window.innerWidth - 8
        ? anchorRect.right + gap
        : Math.max(8, anchorRect.left - width - gap);
      const top = Math.min(
        Math.max(8, anchorRect.top + (anchorRect.height - height) / 2),
        Math.max(8, window.innerHeight - height - 8),
      );
      setPosition((current) => current.left === left && current.top === top ? current : { left, top });
    };
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [anchor, item.id]);

  return createPortal(
    <aside
      ref={tooltipRef}
      id={`planner-item-tooltip-${item.id}`}
      role="tooltip"
      className={clsx("planner-equipment-tooltip", `is-${view.rarity}`)}
      style={{ left: position.left, top: position.top }}
    >
      <header>
        <strong>{item.name}</strong>
        {item.baseType && item.baseType !== item.name && <span>{item.baseType}</span>}
      </header>
      <div className="planner-equipment-tooltip-kind">{view.rarityLabel} · {view.slotLabel}</div>
      {view.properties.length > 0 && <dl>{view.properties.map((property) => <div key={property.label}><dt>{property.label}</dt><dd>{property.value}</dd></div>)}</dl>}
      {view.statuses.length > 0 && <div className="planner-equipment-tooltip-statuses">{view.statuses.map((status) => <b key={status} className={status.toLowerCase() === "corrupted" ? "is-corrupted" : ""}>{status}</b>)}</div>}
      {view.modifiers.length > 0 && <section><ul>{view.modifiers.map((modifier, index) => <li key={`${modifier.text}-${index}`} className={modifier.badges.some((badge) => badge === "Crafted") ? "is-crafted" : modifier.badges.some((badge) => badge === "Enchant") ? "is-enchant" : ""}>{modifier.badges.length > 0 && <small>{modifier.badges.join(" · ")}</small>}<span>{modifier.text}</span></li>)}</ul></section>}
    </aside>,
    document.body,
  );
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

const EDITABLE_EQUIPMENT_SLOTS = [
  "", "Weapon 1", "Weapon 2", "Weapon 1 Swap", "Weapon 2 Swap", "Helmet", "Body Armour",
  "Gloves", "Boots", "Amulet", "Ring 1", "Ring 2", "Belt", "Flask 1", "Flask 2", "Flask 3",
  "Flask 4", "Flask 5",
] as const;

export interface PlannerBuildCommitResult {
  ok: boolean;
  message: string;
}

function PlannerItemTextEditor({ item, busy, error, onCancel, onSave }: {
  item: ImportedPobItem | null;
  busy: boolean;
  error: string;
  onCancel: () => void;
  onSave: (text: string) => void;
}) {
  const [text, setText] = useState(item?.text || "Rarity: RARE\nNew Item\n<exact base type>\n--------");
  return createPortal(<div className="planner-modal-backdrop" role="presentation">
    <section className="planner-item-text-editor" role="dialog" aria-modal="true" aria-labelledby="planner-item-editor-title">
      <header><span><Pencil size={16}/><strong id="planner-item-editor-title">{item ? `Edit ${item.name}` : "Create or paste item"}</strong></span><button type="button" onClick={onCancel} disabled={busy} aria-label="Close item editor">×</button></header>
      <p>Paste or edit canonical Path of Building item text. This format can represent every item property, socket, influence, enchantment, implicit, explicit modifier, crafted modifier, corruption, variant, and custom modifier supported by PoB.</p>
      <textarea aria-label="Path of Building item text" spellCheck={false} value={text} onChange={(event) => setText(event.target.value)} autoFocus/>
      <aside><code>Rarity: RARE</code><code>Item name</code><code>Exact base type</code><code>--------</code><code>Item Level: 86</code><code>modifier lines…</code></aside>
      {error && <div className="planner-item-editor-error" role="alert">{error}</div>}
      <footer><button type="button" onClick={onCancel} disabled={busy}>Cancel</button><button type="button" className="is-primary" onClick={() => onSave(text)} disabled={busy || !text.trim()}>{busy ? <LoaderCircle className="is-spinning" size={13}/> : <Save size={13}/>} Validate with PoB & apply</button></footer>
    </section>
  </div>, document.body);
}

function slotMatches(itemSlot: string, choices: readonly string[], swap = false) {
  const normalized = itemSlot.replace(/\s+/g, " ").trim().toLowerCase();
  const isSwap = /\bswap\b/i.test(normalized);
  if (swap !== isSwap) return false;
  const withoutSwap = normalized.replace(/\s*swap\s*$/i, "");
  return choices.some((choice) => withoutSwap === choice.toLowerCase());
}

export function PlannerItemsPanel({ build, artwork, artworkDimensions = EMPTY_ITEM_ARTWORK_DIMENSIONS, onChange, onCommitItem }: { build: ImportedPobBuild | null; artwork: ReadonlyMap<number, string>; artworkDimensions?: ReadonlyMap<number, PlannerInventoryDimensions>; onChange: (build: ImportedPobBuild) => void; onCommitItem?: (build: ImportedPobBuild) => Promise<PlannerBuildCommitResult> }) {
  const [selectedId, setSelectedId] = useState(0);
  const [weaponSet, setWeaponSet] = useState<1 | 2>(() => build?.itemSets.find((itemSet) => itemSet.id === build.activeItemSet)?.useSecondWeaponSet ? 2 : 1);
  const [tooltip, setTooltip] = useState<{ itemId: number; anchor: HTMLButtonElement } | null>(null);
  const [editor, setEditor] = useState<{ itemId: number | null; nonce: number } | null>(null);
  const [editorBusy, setEditorBusy] = useState(false);
  const [editorError, setEditorError] = useState("");
  const activeItemSet = build?.itemSets.find((itemSet) => itemSet.id === build.activeItemSet) || build?.itemSets[0];
  useEffect(() => setWeaponSet(activeItemSet?.useSecondWeaponSet ? 2 : 1), [activeItemSet?.id, activeItemSet?.useSecondWeaponSet]);
  if (!build) return <PlannerEmpty>Import a character or PoB build to inspect and edit its item loadout.</PlannerEmpty>;
  const openEditor = (itemId: number | null) => {
    setEditorError("");
    setEditor({ itemId, nonce: Date.now() });
  };
  const saveItemText = async (text: string) => {
    const existing = editor?.itemId ? build.items.find((item) => item.id === editor.itemId) : null;
    const nextId = existing?.id || Math.max(0, ...build.items.map((item) => item.id)) + 1;
    const base: ImportedPobItem = existing || { id: nextId, text: "", name: "New item", baseType: "", slot: "", equipped: false };
    const item = withPobItemText(base, text);
    const nextBuild = {
      ...build,
      items: existing ? build.items.map((entry) => entry.id === existing.id ? item : entry) : [...build.items, item],
    };
    setEditorBusy(true);
    setEditorError("");
    try {
      if (onCommitItem) {
        const result = await onCommitItem(nextBuild);
        if (!result.ok) {
          setEditorError(result.message);
          return;
        }
      } else {
        onChange(nextBuild);
      }
      setSelectedId(item.id);
      setEditor(null);
    } catch (error) {
      setEditorError(error instanceof Error ? error.message : String(error));
    } finally {
      setEditorBusy(false);
    }
  };
  if (!build.items.length) return <div className="planner-items-empty-workbench"><FilePlus2 size={24}/><strong>No items in this build</strong><p>Create an item with exact Path of Building text or paste one copied from the game.</p><button type="button" onClick={() => openEditor(null)}><Plus size={13}/> Create or paste item</button>{editor && <PlannerItemTextEditor key={editor.nonce} item={null} busy={editorBusy} error={editorError} onCancel={() => setEditor(null)} onSave={saveItemText}/>}</div>;
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
  const tooltipEntry = tooltip && presented.find(({ item }) => item.id === tooltip.itemId);
  const tooltipButtonProps = (item: ImportedPobItem): ButtonHTMLAttributes<HTMLButtonElement> => ({
    "aria-describedby": tooltip?.itemId === item.id ? `planner-item-tooltip-${item.id}` : undefined,
    onPointerEnter: (event) => setTooltip({ itemId: item.id, anchor: event.currentTarget }),
    onPointerLeave: (event) => {
      const anchor = event.currentTarget;
      if (document.activeElement !== anchor) setTooltip((current) => current?.anchor === anchor ? null : current);
    },
    onFocus: (event) => setTooltip({ itemId: item.id, anchor: event.currentTarget }),
    onBlur: (event) => {
      const anchor = event.currentTarget;
      if (!anchor.matches(":hover")) setTooltip((current) => current?.anchor === anchor ? null : current);
    },
  });
  const toggle = (id: number) => {
    const target = build.items.find((item) => item.id === id);
    if (!target?.slot) return;
    onChange(withPobItemEquipped(build, id, target.equipped ? "" : target.slot));
  };
  const addItemSet = (duplicate: boolean) => {
    const id = Math.max(0, ...build.itemSets.map((itemSet) => itemSet.id)) + 1;
    const itemSet = {
      id,
      title: duplicate ? `${activeItemSet?.title || "Item set"} copy` : `Item set ${build.itemSets.length + 1}`,
      useSecondWeaponSet: activeItemSet?.useSecondWeaponSet || false,
      slots: duplicate && activeItemSet ? Object.fromEntries(Object.entries(activeItemSet.slots).map(([name, slot]) => [name, { ...slot }])) : {},
    };
    onChange(withActivePobItemSet({ ...build, itemSets: [...build.itemSets, itemSet] }, id));
  };
  const removeActiveItemSet = () => {
    if (!activeItemSet || build.itemSets.length <= 1) return;
    const itemSets = build.itemSets.filter((itemSet) => itemSet.id !== activeItemSet.id);
    onChange(withActivePobItemSet({ ...build, itemSets }, itemSets[0].id));
  };
  const selectWeaponSet = (nextWeaponSet: 1 | 2) => {
    setWeaponSet(nextWeaponSet);
    if (!activeItemSet || activeItemSet.useSecondWeaponSet === (nextWeaponSet === 2)) return;
    onChange({
      ...build,
      itemSets: build.itemSets.map((itemSet) => itemSet.id === activeItemSet.id
        ? { ...itemSet, useSecondWeaponSet: nextWeaponSet === 2 }
        : itemSet),
    });
  };
  const duplicateItem = (item: ImportedPobItem) => {
    const id = Math.max(0, ...build.items.map((entry) => entry.id)) + 1;
    const duplicate = { ...item, id, slot: "", equipped: false, xmlChildren: item.xmlChildren ? [...item.xmlChildren] : undefined };
    onChange({ ...build, items: [...build.items, duplicate] });
    setSelectedId(id);
  };
  const paperSlot = (definition: typeof PAPER_DOLL_SLOTS[number]) => {
    const entry = equipped.find(({ item }) => slotMatches(item.slot, definition.slots, weaponSet === 2 && /weapon/.test(definition.key)));
    return <button
      type="button"
      key={definition.key}
      className={clsx("planner-paper-slot", `is-${definition.area}`, entry ? `is-${entry.view.rarity}` : "is-empty", entry?.item.id === selected.item.id && "is-selected")}
      onClick={() => entry && setSelectedId(entry.item.id)}
      aria-label={entry ? `${definition.label}: ${entry.item.name}` : `${definition.label}: empty`}
      title={entry ? undefined : `${definition.label}: empty`}
      {...(entry ? tooltipButtonProps(entry.item) : {})}
    >
      {entry ? <><ItemArtwork item={entry.item} artwork={artwork.get(entry.item.id)} dimensions={artworkDimensions.get(entry.item.id)}/><span>{entry.item.name}</span></> : <><i/><span>{definition.label}</span></>}
    </button>;
  };
  const jewelTray = (title: string, entries: typeof jewels) => entries.length > 0 && <section className="planner-jewel-tray">
    <header><strong>{title}</strong><small>{entries.length}</small></header>
    <div>{entries.map(({ item, view }) => <button type="button" key={item.id} className={clsx(`is-${view.rarity}`, item.id === selected.item.id && "is-selected")} onClick={() => setSelectedId(item.id)} aria-label={`${item.name} · ${view.slotLabel}`} {...tooltipButtonProps(item)}><ItemArtwork item={item} artwork={artwork.get(item.id)} dimensions={artworkDimensions.get(item.id)} compact/><span>{item.name}</span></button>)}</div>
  </section>;
  const selectedEquipped = Boolean(selected.item.equipped && selected.item.slot);
  return <div className="planner-items-panel">
    <section className="planner-loadout-board">
      <div className="planner-item-set-toolbar">
        <label><span>Item set</span><select aria-label="Active item set" value={activeItemSet?.id || build.activeItemSet} onChange={(event) => onChange(withActivePobItemSet(build, Number(event.target.value)))}>{build.itemSets.map((itemSet) => <option key={itemSet.id} value={itemSet.id}>{itemSet.title}</option>)}</select></label>
        {activeItemSet && <input aria-label="Item set name" value={activeItemSet.title} onChange={(event) => onChange({ ...build, itemSets: build.itemSets.map((itemSet) => itemSet.id === activeItemSet.id ? { ...itemSet, title: event.target.value.slice(0, 160) } : itemSet) })}/>}
        <button type="button" onClick={() => addItemSet(false)} title="New empty item set"><Plus size={12}/> New</button>
        <button type="button" onClick={() => addItemSet(true)} title="Duplicate active item set"><Copy size={12}/> Duplicate</button>
        <button type="button" onClick={removeActiveItemSet} disabled={build.itemSets.length <= 1} title="Delete active item set"><Trash2 size={12}/></button>
        <button type="button" className="is-primary" onClick={() => openEditor(null)}><FilePlus2 size={12}/> Create / paste item</button>
      </div>
      <header><span><Shield size={15}/><strong>Equipment</strong><small>{equipped.length} equipped · official game artwork</small></span><div className="planner-weapon-set"><span>{weaponSet === 1 ? "Active weapons" : "Weapon swap"}</span><button type="button" aria-label="Use active weapon set" title="Use active weapon set for Path of Building calculations" className={weaponSet === 1 ? "is-active" : ""} onClick={() => selectWeaponSet(1)}>I</button><button type="button" aria-label="Use weapon swap set" title="Use weapon swap set for Path of Building calculations" className={weaponSet === 2 ? "is-active" : ""} onClick={() => selectWeaponSet(2)}>II</button></div></header>
      <div className="planner-paper-doll-shell"><div className="planner-paper-doll">{PAPER_DOLL_SLOTS.map(paperSlot)}</div></div>
      <section className="planner-flask-belt"><header><strong>Flasks</strong></header><div>{[1, 2, 3, 4, 5].map((index) => {
        const entry = flasks[index - 1];
        return <button type="button" key={index} className={clsx("planner-flask-slot", entry && `is-${entry.view.rarity}`, entry?.item.id === selected.item.id && "is-selected")} onClick={() => entry && setSelectedId(entry.item.id)} aria-label={entry?.item.name || `Flask ${index}: empty`} title={entry ? undefined : `Flask ${index}: empty`} {...(entry ? tooltipButtonProps(entry.item) : {})}>{entry ? <ItemArtwork item={entry.item} artwork={artwork.get(entry.item.id)} dimensions={artworkDimensions.get(entry.item.id)}/> : <i/>}</button>;
      })}</div></section>
      {jewelTray("Cluster jewels", clusterJewels)}
      {jewelTray("Base & Timeless jewels", baseJewels)}
      {alternatives.length > 0 && <section className="planner-item-alternatives"><header><strong>Imported alternatives</strong><small>{alternatives.length}</small></header><div>{alternatives.map(({ item, view }) => <button type="button" key={item.id} className={clsx(`is-${view.rarity}`, item.id === selected.item.id && "is-selected")} onClick={() => setSelectedId(item.id)} aria-label={`${item.name} · ${view.slotLabel}`} {...tooltipButtonProps(item)}><ItemArtwork item={item} artwork={artwork.get(item.id)} dimensions={artworkDimensions.get(item.id)} compact/><span><strong>{item.name}</strong><small>{view.slotLabel}</small></span></button>)}</div></section>}
    </section>
    <aside className={clsx("planner-item-inspector", `is-${selected.view.rarity}`)}>
      <header><ItemArtwork item={selected.item} artwork={artwork.get(selected.item.id)} dimensions={artworkDimensions.get(selected.item.id)}/><span><small>{selected.view.slotLabel}</small><strong>{selected.item.name}</strong></span></header>
      <nav className="planner-item-actions"><button type="button" onClick={() => openEditor(selected.item.id)}><Pencil size={12}/> Edit text</button><button type="button" onClick={() => duplicateItem(selected.item)}><Copy size={12}/> Duplicate</button><button type="button" className="is-danger" onClick={() => { onChange(withoutPobItem(build, selected.item.id)); setSelectedId(0); }}><Trash2 size={12}/> Delete</button></nav>
      <div className="planner-item-identity"><small>{selected.view.rarityLabel}</small>{selected.item.baseType && selected.item.baseType !== selected.item.name && <span>{selected.item.baseType}</span>}</div>
      <label className="planner-item-slot"><span>Equipped slot</span><select aria-label={`Equipped slot for ${selected.item.name}`} value={selectedEquipped ? selected.item.slot : ""} onChange={(event) => onChange(withPobItemEquipped(build, selected.item.id, event.target.value))}>{EDITABLE_EQUIPMENT_SLOTS.map((slot) => <option key={slot || "none"} value={slot}>{slot || "Not equipped"}</option>)}</select></label>
      {selected.item.slot && <label className="planner-item-loadout" title={`${selectedEquipped ? "Remove" : "Equip"} ${selected.item.name}`}><input type="checkbox" checked={selectedEquipped} onChange={() => toggle(selected.item.id)}/><span>{selectedEquipped ? "Equipped" : "Equip in saved slot"}</span></label>}
      {selected.view.statuses.length > 0 && <div className="planner-item-badges">{selected.view.statuses.map((status) => <b key={status}>{status}</b>)}</div>}
      {selected.view.properties.length > 0 && <dl className="planner-item-properties">{selected.view.properties.map((property) => <div key={property.label}><dt>{property.label}</dt><dd>{property.value}</dd></div>)}</dl>}
      {selected.view.modifiers.length > 0 ? <section className="planner-item-modifiers"><h4>Modifiers</h4><ul>{selected.view.modifiers.map((modifier, index) => <li key={`${modifier.text}-${index}`}>{modifier.badges.length > 0 && <span>{modifier.badges.map((badge) => <b key={badge}>{badge}</b>)}</span>}<em>{modifier.text}</em></li>)}</ul></section> : <p className="planner-item-no-mods">No modifiers in the imported item.</p>}
    </aside>
    {tooltip && tooltipEntry && <PlannerItemTooltip item={tooltipEntry.item} view={tooltipEntry.view} anchor={tooltip.anchor}/>}
    {editor && <PlannerItemTextEditor key={editor.nonce} item={editor.itemId ? build.items.find((item) => item.id === editor.itemId) || null : null} busy={editorBusy} error={editorError} onCancel={() => setEditor(null)} onSave={saveItemText}/>}
  </div>;
}

export function PlannerSkillsPanel({ build, artwork = EMPTY_GEM_ARTWORK, catalog = EMPTY_GEM_CATALOG, onChange }: { build: ImportedPobBuild | null; artwork?: ReadonlyMap<string, string>; catalog?: readonly PobEngineGemCatalogEntry[]; onChange: (build: ImportedPobBuild) => void }) {
  const [selectedGroupId, setSelectedGroupId] = useState("");
  const [gemQuery, setGemQuery] = useState("");
  const skillSets = useMemo(() => build ? pobSkillSetSummaries(build) : [], [build]);
  if (!build) return <PlannerEmpty>Imported socket groups and gems appear here.</PlannerEmpty>;
  const activeSkillSet = skillSets.find((set) => set.active) || skillSets[0];
  const applySkillSetChange = (next: ImportedPobBuild) => {
    setSelectedGroupId("");
    onChange(next);
  };
  const addGroup = (source?: ImportedPobBuild["skillGroups"][number]) => {
    const group = source ? {
      ...source,
      id: `skill-${Date.now()}-${build.skillGroups.length + 1}`,
      label: `${source.label || "Socket group"} copy`,
      activeSkills: undefined,
      gems: source.gems.map((gem) => ({ ...gem })),
    } : {
      id: `skill-${Date.now()}-${build.skillGroups.length + 1}`,
      slot: "None",
      label: `Socket group ${build.skillGroups.length + 1}`,
      enabled: true,
      includeInFullDps: false,
      mainActiveSkill: 1,
      gems: [],
    };
    onChange({ ...build, skillGroups: [...build.skillGroups, group] });
    setSelectedGroupId(group.id);
  };
  const skillSetToolbar = <div className="planner-set-toolbar planner-skill-set-toolbar">
    <label><span>Skill set</span><select aria-label="Active skill set" value={activeSkillSet?.id || build.activeSkillSet} onChange={(event) => applySkillSetChange(withActivePobSkillSet(build, Number(event.target.value)))}>{skillSets.map((set) => <option key={set.id} value={set.id}>{set.title} · {set.entryCount} groups</option>)}</select></label>
    {activeSkillSet && <input key={`${activeSkillSet.id}-${activeSkillSet.title}`} aria-label="Skill set name" defaultValue={activeSkillSet.title} onBlur={(event) => applySkillSetChange(withPobSkillSetTitle(build, activeSkillSet.id, event.target.value))}/>}
    <button type="button" onClick={() => applySkillSetChange(addPobSkillSet(build))} title="New empty skill set"><Plus size={12}/> New set</button>
    <button type="button" onClick={() => applySkillSetChange(addPobSkillSet(build, true))} title="Duplicate active skill set"><Copy size={12}/> Duplicate</button>
    <button type="button" onClick={() => activeSkillSet && applySkillSetChange(withoutPobSkillSet(build, activeSkillSet.id))} disabled={skillSets.length <= 1} title="Delete active skill set"><Trash2 size={12}/></button>
  </div>;
  if (!build.skillGroups.length) return <div className="planner-skills-empty-shell">{skillSetToolbar}<div className="planner-items-empty-workbench"><Sparkles size={24}/><strong>No socket groups</strong><p>Create a socket group, then add exact gems from the verified Path of Building catalog.</p><button type="button" onClick={() => addGroup()}><Plus size={13}/> New socket group</button></div></div>;
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
  const requestedGroupIndex = build.skillGroups.findIndex((group) => group.id === selectedGroupId);
  const importedMainGroupIndex = Math.max(0, Math.min(build.skillGroups.length - 1, (build.mainSocketGroup || 1) - 1));
  const selectedGroupIndex = requestedGroupIndex >= 0 ? requestedGroupIndex : importedMainGroupIndex;
  const selected = build.skillGroups[selectedGroupIndex];
  const removeGroup = () => {
    const skillGroups = build.skillGroups.filter((_, index) => index !== selectedGroupIndex);
    const mainSocketGroup = skillGroups.length ? Math.max(1, Math.min(skillGroups.length, build.mainSocketGroup - (selectedGroupIndex + 1 < build.mainSocketGroup ? 1 : 0))) : 1;
    onChange({ ...build, skillGroups, mainSocketGroup });
    setSelectedGroupId(skillGroups[Math.max(0, Math.min(skillGroups.length - 1, mainSocketGroup - 1))]?.id || "");
  };
  const removeGem = (gemIndex: number) => updateGroup(selectedGroupIndex, {
    gems: selected.gems.filter((_, index) => index !== gemIndex),
    activeSkills: undefined,
    mainActiveSkill: 1,
  });
  const addGem = () => {
    const requested = gemQuery.trim().toLowerCase();
    const entry = catalog.find((gem) => gem.name.toLowerCase() === requested)
      || catalog.find((gem) => `${gem.name} ${gem.variantId}`.toLowerCase() === requested);
    if (!entry) return;
    updateGroup(selectedGroupIndex, {
      gems: [...selected.gems, {
        name: entry.name,
        skillId: entry.skillId,
        ...(entry.gemId ? { gemId: entry.gemId } : {}),
        ...(entry.variantId ? { variantId: entry.variantId } : {}),
        level: entry.naturalMaxLevel,
        quality: 0,
        enabled: true,
        count: 1,
        support: entry.support,
      }],
      activeSkills: undefined,
    });
    setGemQuery("");
  };
  const isSupport = (gem: typeof selected.gems[number]) => gem.support === true || /support/i.test(`${gem.skillId} ${gem.gemId || ""}`);
  const hasAuthoritativeActiveSkills = Boolean(selected.activeSkills?.length);
  const activeSkills: ImportedPobActiveSkill[] = hasAuthoritativeActiveSkills
    ? selected.activeSkills || []
    : selected.gems.flatMap((gem, gemIndex) => gem.enabled && !isSupport(gem)
      ? [{ name: gem.name, sourceGemIndex: gemIndex + 1 }]
      : []).map((skill, index) => ({ ...skill, index: index + 1 }));
  const selectedActiveSkill = activeSkills.find((skill) => skill.index === (selected.mainActiveSkill || 1)) || activeSkills[0];
  const selectedGemIndex = (selectedActiveSkill?.sourceGemIndex || 0) - 1;
  const selectedGem = selectedGemIndex >= 0 ? selected.gems[selectedGemIndex] : undefined;
  const updateSelectedGem = (patch: Partial<ImportedPobBuild["skillGroups"][number]["gems"][number]>) => {
    if (selectedGemIndex >= 0) updateGem(selectedGroupIndex, selectedGemIndex, patch);
  };
  const minionValue = selectedGem?.skillMinionItemSet || selectedGem?.skillMinionItemSetCalcs
    ? `item:${selectedGem.skillMinionItemSet || selectedGem.skillMinionItemSetCalcs}`
    : selectedGem?.skillMinion || selectedGem?.skillMinionCalcs
      ? `minion:${selectedGem.skillMinion || selectedGem.skillMinionCalcs}`
      : selectedActiveSkill?.minions?.[0]?.itemSetId
        ? `item:${selectedActiveSkill.minions[0].itemSetId}`
        : selectedActiveSkill?.minions?.[0]?.minionId
          ? `minion:${selectedActiveSkill.minions[0].minionId}`
          : "";
  const gemArtwork = (gem: typeof selected.gems[number], compact = false) => <span className={clsx("planner-gem-art", compact && "is-compact", isSupport(gem) && "is-support")}>
    {gem.icon || artwork.get(importedPobGemArtworkKey(gem)) ? <img src={gem.icon || artwork.get(importedPobGemArtworkKey(gem))} alt="" draggable={false}/> : <b title="Official gem artwork is unavailable">{gem.name.slice(0, 1)}</b>}
  </span>;
  return <div className="planner-skills-workbench">
    <aside className="planner-skill-groups">
      {skillSetToolbar}
      <header><span><Sparkles size={15}/><strong>Socket groups</strong></span><small>{build.skillGroups.length} groups</small></header>
      <nav className="planner-skill-group-actions"><button type="button" onClick={() => addGroup()}><Plus size={11}/> New</button><button type="button" onClick={() => addGroup(selected)}><Copy size={11}/> Duplicate</button><button type="button" onClick={removeGroup}><Trash2 size={11}/> Delete</button></nav>
      <div>{build.skillGroups.map((group, groupIndex) => {
        const representative = group.gems.find((gem) => gem.enabled && !(gem.support === true || /support/i.test(`${gem.skillId} ${gem.gemId || ""}`))) || group.gems[0];
        return <button type="button" key={group.id} className={clsx(selected.id === group.id && "is-selected", !group.enabled && "is-disabled", build.mainSocketGroup === groupIndex + 1 && "is-main")} onClick={() => setSelectedGroupId(group.id)}>
        {representative ? gemArtwork(representative, true) : <span className="planner-gem-art is-compact"><b>0</b></span>}<span><small>{group.slot}</small><strong>{group.label || group.gems[0]?.name || `Skill group ${groupIndex + 1}`}</strong><em>{group.gems.map((gem) => gem.name).join(" · ")}</em></span><b>{build.mainSocketGroup === groupIndex + 1 ? "MAIN" : group.includeInFullDps ? "DPS" : ""}</b>
      </button>;})}</div>
    </aside>
    <section className="planner-skill-editor">
      <header><span><small>{selected.slot}</small><strong>{selected.label || selected.gems[0]?.name || "Socket group"}</strong></span><label><input type="checkbox" checked={selected.enabled} onChange={(event) => updateGroup(selectedGroupIndex, { enabled: event.target.checked })}/> Group enabled</label></header>
      <div className="planner-socket-group-controls"><label><span>Label</span><input aria-label="Socket group label" value={selected.label} onChange={(event) => updateGroup(selectedGroupIndex, { label: event.target.value.slice(0, 160) })}/></label><label><span>Socketed in</span><input aria-label="Socket group slot" value={selected.slot} onChange={(event) => updateGroup(selectedGroupIndex, { slot: event.target.value.slice(0, 160) })}/></label><label><span>Group count</span><input aria-label="Socket group count" type="number" min="1" max="1000" value={selected.groupCount || 1} onChange={(event) => updateGroup(selectedGroupIndex, { groupCount: Math.max(1, Math.min(1000, Number(event.target.value) || 1)) })}/></label></div>
      <div className="planner-main-skill-controls">
        <label><span>Main socket group</span><select aria-label="Main socket group" value={build.mainSocketGroup || 1} onChange={(event) => { const index = Math.max(0, Math.min(build.skillGroups.length - 1, Number(event.target.value) - 1)); setSelectedGroupId(build.skillGroups[index].id); onChange({ ...build, mainSocketGroup: index + 1 }); }}>{build.skillGroups.map((group, index) => { const mainSkill = group.activeSkills?.find((skill) => skill.index === (group.mainActiveSkill || 1))?.name || group.gems.find((gem) => gem.enabled && !(gem.support === true || /support/i.test(`${gem.skillId} ${gem.gemId || ""}`)))?.name || group.label || group.slot || `Socket group ${index + 1}`; return <option key={group.id} value={index + 1}>{mainSkill} · {group.slot || `Group ${index + 1}`}</option>; })}</select></label>
        <label><span>Main active skill</span><select aria-label="Main active skill" value={selectedActiveSkill?.index || 1} disabled={!activeSkills.length} title={hasAuthoritativeActiveSkills ? "Path of Building active-skill list" : "Enabled active gems; recalculate to verify exact Path of Building choices"} onChange={(event) => { const mainActiveSkill = Number(event.target.value); updateGroup(selectedGroupIndex, { mainActiveSkill, mainActiveSkillCalcs: mainActiveSkill }); }}>{activeSkills.map((skill) => <option key={`${skill.index}-${skill.name}`} value={skill.index}>{skill.name}</option>)}</select></label>
        {(selectedActiveSkill?.parts?.length || 0) > 1 && <label><span>Skill part</span><select aria-label="Main skill part" value={selectedGem?.skillPart || selectedGem?.skillPartCalcs || 1} disabled={!selectedGem || !hasAuthoritativeActiveSkills} onChange={(event) => updateSelectedGem({ skillPart: Number(event.target.value) })}>{selectedActiveSkill?.parts?.map((part, index) => <option key={`${index}-${part}`} value={index + 1}>{part}</option>)}</select></label>}
        {selectedActiveSkill?.stages && <label><span>Skill stages</span><input aria-label="Main skill stages" type="number" min={selectedActiveSkill.stages.min} max={selectedActiveSkill.stages.max} value={selectedGem?.skillStageCount || selectedGem?.skillStageCountCalcs || selectedActiveSkill.stages.max} disabled={!selectedGem || !hasAuthoritativeActiveSkills} onChange={(event) => { const value = Math.max(selectedActiveSkill.stages!.min, Math.min(selectedActiveSkill.stages!.max, Number(event.target.value) || selectedActiveSkill.stages!.min)); updateSelectedGem({ skillStageCount: value }); }}/></label>}
        {selectedActiveSkill?.mine && <label><span>Active mines</span><input aria-label="Active mine count" type="number" min="0" value={selectedGem?.skillMineCount ?? selectedGem?.skillMineCountCalcs ?? ""} placeholder="PoB default" disabled={!selectedGem || !hasAuthoritativeActiveSkills} onChange={(event) => { const value = event.target.value === "" ? undefined : Math.max(0, Number(event.target.value) || 0); updateSelectedGem({ skillMineCount: value }); }}/></label>}
        {(selectedActiveSkill?.minions?.length || 0) > 0 && <label><span>Minion</span><select aria-label="Main skill minion" value={minionValue} disabled={!selectedGem || !hasAuthoritativeActiveSkills} onChange={(event) => { const [kind, rawValue] = event.target.value.split(":"); if (kind === "item") updateSelectedGem({ skillMinionItemSet: Number(rawValue), skillMinion: undefined }); else updateSelectedGem({ skillMinion: rawValue, skillMinionItemSet: undefined }); }}>{selectedActiveSkill?.minions?.map((minion) => { const value = minion.itemSetId ? `item:${minion.itemSetId}` : `minion:${minion.minionId}`; return <option key={value} value={value}>{minion.label}</option>; })}</select></label>}
        {(selectedActiveSkill?.minionSkills?.length || 0) > 0 && <label><span>Minion skill</span><select aria-label="Main minion skill" value={selectedGem?.skillMinionSkill || selectedGem?.skillMinionSkillCalcs || 1} disabled={!selectedGem || !hasAuthoritativeActiveSkills} onChange={(event) => updateSelectedGem({ skillMinionSkill: Number(event.target.value) })}>{selectedActiveSkill?.minionSkills?.map((skill, index) => <option key={`${index}-${skill}`} value={index + 1}>{skill}</option>)}</select></label>}
      </div>
      <div className="planner-skill-options"><label><input type="checkbox" checked={selected.includeInFullDps} onChange={(event) => updateGroup(selectedGroupIndex, { includeInFullDps: event.target.checked })}/> Include in Full DPS</label><span>{selected.gems.filter((gem) => gem.enabled).length}/{selected.gems.length} enabled · recalculation uses the selected group and skill</span></div>
      <div className="planner-gem-add"><label><Search size={12}/><input aria-label="Add gem from Path of Building catalog" list="planner-pob-gem-catalog" value={gemQuery} onChange={(event) => setGemQuery(event.target.value)} placeholder={catalog.length ? `Search ${catalog.length} exact PoB gems` : "Recalculate to load the PoB gem catalog"} disabled={!catalog.length}/><datalist id="planner-pob-gem-catalog">{catalog.map((gem) => <option key={`${gem.name}-${gem.skillId}-${gem.variantId}`} value={gem.name}>{gem.support ? "Support" : "Active"} · level {gem.naturalMaxLevel}</option>)}</datalist></label><button type="button" disabled={!catalog.some((gem) => gem.name.toLowerCase() === gemQuery.trim().toLowerCase())} onClick={addGem}><Plus size={12}/> Add gem</button></div>
      <div className="planner-gem-editor-list">{selected.gems.map((gem, gemIndex) => <article key={`${gem.skillId}-${gemIndex}`} className={!gem.enabled ? "is-disabled" : ""}>
        <label className="planner-gem-toggle"><input type="checkbox" checked={gem.enabled} onChange={(event) => updateGem(selectedGroupIndex, gemIndex, { enabled: event.target.checked })}/>{gemArtwork(gem)}<span><strong>{gem.name}</strong><small>{isSupport(gem) ? "Support gem" : "Active gem"} · {gem.skillId || gem.gemId}</small></span></label>
        <span className="planner-gem-values"><label>LEVEL<input type="number" min="1" max="40" value={gem.level} onChange={(event) => updateGem(selectedGroupIndex, gemIndex, { level: Math.max(1, Math.min(40, Number(event.target.value) || 1)) })}/></label><label>QUALITY<input type="number" min="0" max="100" value={gem.quality} onChange={(event) => updateGem(selectedGroupIndex, gemIndex, { quality: Math.max(0, Math.min(100, Number(event.target.value) || 0)) })}/></label><label>COUNT<input type="number" min="1" max="1000" value={gem.count || 1} onChange={(event) => updateGem(selectedGroupIndex, gemIndex, { count: Math.max(1, Math.min(1000, Number(event.target.value) || 1)) })}/></label><button type="button" aria-label={`Duplicate ${gem.name}`} title="Duplicate gem" onClick={() => updateGroup(selectedGroupIndex, { gems: [...selected.gems.slice(0, gemIndex + 1), { ...gem }, ...selected.gems.slice(gemIndex + 1)], activeSkills: undefined })}><Copy size={11}/></button><button type="button" aria-label={`Delete ${gem.name}`} title="Delete gem" onClick={() => removeGem(gemIndex)}><Trash2 size={11}/></button></span>
      </article>)}</div>
    </section>
  </div>;
}

function PlannerCustomModifierEditor({ block, onCommit, onDelete }: {
  block: PobCustomModifierBlock;
  onCommit: (block: PobCustomModifierBlock) => void;
  onDelete: () => void;
}) {
  const [draft, setDraft] = useState(block);
  useEffect(() => setDraft(block), [block.enabled, block.text, block.title]);
  const commit = (next = draft) => {
    if (next.enabled !== block.enabled || next.text !== block.text || next.title !== block.title) onCommit(next);
  };
  return <article className="planner-custom-mod-block">
    <header>
      <label><input type="checkbox" checked={draft.enabled} onChange={(event) => { const next = { ...draft, enabled: event.target.checked }; setDraft(next); commit(next); }}/><span>Enabled</span></label>
      <input aria-label="Custom modifier group name" value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value.slice(0, 160) })} onBlur={() => commit()}/>
      <button type="button" aria-label={`Delete ${draft.title || "custom modifier group"}`} onClick={onDelete}><Trash2 size={12}/></button>
    </header>
    <textarea aria-label={`${draft.title || "Custom modifier group"} modifiers`} value={draft.text} placeholder="One exact Path of Building custom modifier per line" onChange={(event) => setDraft({ ...draft, text: event.target.value })} onBlur={() => commit()}/>
  </article>;
}

export function PlannerConfigPanel({ build, catalog = EMPTY_CONFIG_CATALOG, onChange }: { build: ImportedPobBuild | null; catalog?: readonly PobEngineConfigInput[]; onChange: (build: ImportedPobBuild) => void }) {
  const [query, setQuery] = useState("");
  const [section, setSection] = useState("all");
  const [showAll, setShowAll] = useState(false);
  const configSets = useMemo(() => build ? pobConfigSetSummaries(build) : [], [build]);
  const customModifiers = useMemo(() => build ? pobCustomModifierBlocks(build) : [], [build]);
  if (!build) return <PlannerEmpty>Import a character or PoB build to edit configuration values.</PlannerEmpty>;
  const activeConfigSet = configSets.find((set) => set.active) || configSets[0];
  const applyConfigSetChange = (next: ImportedPobBuild) => onChange(next);
  const update = (name: string, value: PobEngineScalar) => onChange({ ...build, config: { ...build.config, [name]: value } });
  const remove = (name: string) => {
    const config = { ...build.config };
    delete config[name];
    onChange({ ...build, config });
  };
  const sectionFor = (name: string) => {
    if (/enemy|boss|resist|armour|curse|mark|exposure|wither|shock|chill|ignite|bleed|poison/i.test(name)) return "enemy";
    if (/map|area|league|delirium|ultimatum|ritual|sanctum|pinnacle/i.test(name)) return "map";
    if (/skill|stage|stack|warcry|brand|mine|trap|totem|minion|projectile/i.test(name)) return "skill";
    if (/party|ally|aura|nearby|mercenary/i.test(name)) return "party";
    if (/custom|override|condition/i.test(name)) return "custom";
    return "combat";
  };
  const sections = [
    ["all", "All available inputs"],
    ["combat", "When in combat"],
    ["enemy", "Enemy state"],
    ["skill", "Skill state"],
    ["map", "Map & encounter"],
    ["party", "Party & allies"],
    ["custom", "Custom overrides"],
  ] as const;
  const catalogNames = new Set(catalog.map((entry) => entry.name));
  const inputs: PobEngineConfigInput[] = [
    ...catalog,
    ...Object.entries(build.config)
      .filter(([name]) => !catalogNames.has(name))
      .map(([name, value]) => ({
        name,
        label: pobInputLabel(name),
        type: typeof value === "boolean" ? "boolean" as const : typeof value === "number" ? "number" as const : "string" as const,
        defaultValue: typeof value === "boolean" ? false : typeof value === "number" ? 0 : "",
        eligible: true,
        options: [],
      })),
  ];
  const isSaved = (name: string) => Object.prototype.hasOwnProperty.call(build.config, name);
  const available = inputs.filter((entry) => showAll || entry.eligible || isSaved(entry.name));
  const visible = available.filter((entry) => (
    (section === "all" || sectionFor(entry.name) === section)
    && (!query || `${entry.label} ${pobInputLabel(entry.name)} ${entry.name}`.toLowerCase().includes(query.toLowerCase()))
  ));
  const renderControl = (entry: PobEngineConfigInput) => {
    const value: PobEngineScalar = isSaved(entry.name) ? build.config[entry.name] : entry.defaultValue;
    if (entry.type === "boolean") {
      return <input aria-label={entry.label} type="checkbox" checked={value === true} onChange={(event) => update(entry.name, event.target.checked)}/>;
    }
    if (entry.type === "number") {
      return <input aria-label={entry.label} type="number" value={typeof value === "number" ? value : Number(value) || 0} onChange={(event) => update(entry.name, event.target.value === "" ? 0 : Number(event.target.value))}/>;
    }
    if (entry.type === "list" && entry.options.length) {
      const selectedIndex = entry.options.findIndex((option) => Object.is(option.value, value));
      return <select aria-label={entry.label} value={selectedIndex >= 0 ? selectedIndex : ""} onChange={(event) => {
        const option = entry.options[Number(event.target.value)];
        if (option) update(entry.name, option.value);
      }}>{selectedIndex < 0 && <option value="">Current: {String(value)}</option>}{entry.options.map((option, index) => <option key={`${index}-${String(option.value)}`} value={index}>{option.label || String(option.value)}</option>)}</select>;
    }
    return <input aria-label={entry.label} value={String(value)} onChange={(event) => update(entry.name, event.target.value)}/>;
  };
  return <div className="planner-config-workbench">
    <aside><header><strong>Configuration</strong><small>{Object.keys(build.config).length} saved · {available.length}/{inputs.length} available · {configSets.length} sets</small></header><nav>{sections.map(([id, label]) => { const count = id === "all" ? available.length : available.filter((entry) => sectionFor(entry.name) === id).length; return <button type="button" key={id} className={section === id ? "is-selected" : ""} onClick={() => setSection(id)}><span>{label}</span><b>{count}</b></button>; })}</nav></aside>
    <section className="planner-config-shell">
      <div className="planner-set-toolbar planner-config-set-toolbar">
        <label><span>Config set</span><select aria-label="Active config set" value={activeConfigSet?.id || 1} onChange={(event) => applyConfigSetChange(withActivePobConfigSet(build, Number(event.target.value)))}>{configSets.map((set) => <option key={set.id} value={set.id}>{set.title} · {set.entryCount} inputs</option>)}</select></label>
        {activeConfigSet && <input key={`${activeConfigSet.id}-${activeConfigSet.title}`} aria-label="Config set name" defaultValue={activeConfigSet.title} onBlur={(event) => applyConfigSetChange(withPobConfigSetTitle(build, activeConfigSet.id, event.target.value))}/>}
        <button type="button" onClick={() => applyConfigSetChange(addPobConfigSet(build))} title="New empty config set"><Plus size={12}/> New set</button>
        <button type="button" onClick={() => applyConfigSetChange(addPobConfigSet(build, true))} title="Duplicate active config set"><Copy size={12}/> Duplicate</button>
        <button type="button" onClick={() => activeConfigSet && applyConfigSetChange(withoutPobConfigSet(build, activeConfigSet.id))} disabled={configSets.length <= 1} title="Delete active config set"><Trash2 size={12}/></button>
      </div>
      <header><span><strong>{sections.find(([id]) => id === section)?.[1]}</strong><small>Controls, choices, defaults, and eligibility come from the verified local Path of Building engine.</small></span><label><Search size={12}/><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Filter configuration"/></label></header>
      <label className="planner-config-show-all"><input type="checkbox" checked={showAll} onChange={(event) => setShowAll(event.target.checked)}/><span>Show all configurations</span><small>{showAll ? "Includes options Path of Building marks ineligible for the current build." : "Matches Path of Building's current-build eligibility."}</small></label>
      <p className="planner-config-note">Reset removes the saved override so Path of Building applies its own default. Every listed choice is sourced directly from the installed verified engine.</p>
      {(section === "all" || section === "custom") && <section className="planner-custom-modifiers">
        <header><span><strong>Custom modifiers</strong><small>Exact PoB modifier syntax · applied by the verified local engine</small></span><button type="button" onClick={() => onChange(withPobCustomModifierBlocks(build, [...customModifiers, { title: `Group ${customModifiers.length + 1}`, enabled: true, text: "" }]))}><Plus size={12}/> Add group</button></header>
        {customModifiers.map((block, index) => <PlannerCustomModifierEditor key={`${index}-${block.title}`} block={block} onCommit={(next) => onChange(withPobCustomModifierBlocks(build, customModifiers.map((entry, entryIndex) => entryIndex === index ? next : entry)))} onDelete={() => onChange(withPobCustomModifierBlocks(build, customModifiers.filter((_, entryIndex) => entryIndex !== index)))}/>)}
        {!customModifiers.length && <p>No custom modifier groups in this configuration set.</p>}
      </section>}
      <div className="planner-config">{visible.map((entry) => <label key={entry.name} className={isSaved(entry.name) ? "is-overridden" : "is-default"}><span>{entry.label || pobInputLabel(entry.name)}<small>{isSaved(entry.name) ? "Saved override" : "PoB default"}{entry.eligible ? "" : " · currently ineligible"}</small></span><span>{renderControl(entry)}<button type="button" disabled={!isSaved(entry.name)} aria-label={`Reset ${entry.label}`} title="Reset to Path of Building default" onClick={() => remove(entry.name)}><RotateCcw size={12}/></button></span></label>)}</div>
      {visible.length === 0 && section !== "custom" && <PlannerEmpty>No Path of Building inputs match this section and filter.</PlannerEmpty>}
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
