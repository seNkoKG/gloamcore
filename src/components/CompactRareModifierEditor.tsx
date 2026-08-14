import clsx from "clsx";
import { Check } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type {
  CSSProperties,
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
} from "react";
import type {
  ParsedPoeItem,
  ParsedPoeModifier,
  PriceCheckModifierFilter,
} from "../lib/price-check/types";
import { isOfficialPriceCheckFilter } from "../lib/price-check/equipment-properties";
import {
  priceCheckItemFilterControls,
  type PriceCheckItemFilterValue,
} from "../lib/price-check/query-plan";
import {
  isPresenceOnlyPriceCheckFilter,
} from "../lib/price-check/trade-stat-id";
import "../compact-rare-modifier-editor.css";

type ItemFilterValue = PriceCheckItemFilterValue;

export const COMPACT_ITEM_STATE_CONTROLS_PER_ROW = 4;
export const COMPACT_ITEM_STATE_ONE_ROW_HEIGHT = 29;
export const COMPACT_ITEM_STATE_TWO_ROW_HEIGHT = 51;
export const COMPACT_MODIFIER_ROW_HEIGHT = 43;
export const COMPACT_MODIFIER_RANGE_ROW_HEIGHT = 56;
export const COMPACT_MODIFIER_SECTION_HEIGHT = 22;

export function compactPriceCheckItemStateControlCount(
  item: ParsedPoeItem,
  exact = false,
  itemFilters?: Readonly<Record<string, ItemFilterValue>>,
) {
  return priceCheckItemFilterControls(item, { exact, itemFilters }).length;
}

export function compactPriceCheckItemStateRowCount(
  item: ParsedPoeItem,
  exact = false,
  itemFilters?: Readonly<Record<string, ItemFilterValue>>,
) {
  return Math.max(
    1,
    Math.ceil(
      compactPriceCheckItemStateControlCount(item, exact, itemFilters) /
        COMPACT_ITEM_STATE_CONTROLS_PER_ROW,
    ),
  );
}

export function compactPriceCheckItemStateStripHeight(
  item: ParsedPoeItem,
  exact = false,
  itemFilters?: Readonly<Record<string, ItemFilterValue>>,
) {
  const rows = compactPriceCheckItemStateRowCount(item, exact, itemFilters);
  return COMPACT_ITEM_STATE_ONE_ROW_HEIGHT +
    (rows - 1) * (
      COMPACT_ITEM_STATE_TWO_ROW_HEIGHT - COMPACT_ITEM_STATE_ONE_ROW_HEIGHT
    );
}

export function compactVisibleModifierFilters(
  filters: readonly PriceCheckModifierFilter[],
) {
  return filters.filter((filter) => !filter.advancedOnly);
}

function itemModifiers(item: ParsedPoeItem) {
  return [
    ...item.modifiers,
    ...(item.logbookAreas?.flat() || []),
  ];
}

export type CompactModifierSectionKind =
  | "properties"
  | "enchant"
  | "corrupted-implicit"
  | "implicit"
  | "prefix"
  | "suffix"
  | "fractured"
  | "veiled"
  | "crafted"
  | "explicit"
  | "special"
  | "pseudo"
  | "other";

export interface CompactModifierPresentationEntry {
  filter: PriceCheckModifierFilter;
  modifier?: ParsedPoeModifier;
}

export interface CompactModifierPresentationGroup {
  key: string;
  sourceGroupId?: string;
  linked: boolean;
  entries: CompactModifierPresentationEntry[];
}

export interface CompactModifierPresentationSection {
  kind: CompactModifierSectionKind;
  label: string;
  entries: CompactModifierPresentationEntry[];
  groups: CompactModifierPresentationGroup[];
}

const COMPACT_MODIFIER_SECTIONS: ReadonlyArray<{
  kind: CompactModifierSectionKind;
  label: string;
}> = [
  { kind: "properties", label: "Calculated properties" },
  { kind: "enchant", label: "Enchantments" },
  { kind: "corrupted-implicit", label: "Corrupted implicits" },
  { kind: "implicit", label: "Implicits" },
  { kind: "prefix", label: "Prefixes" },
  { kind: "suffix", label: "Suffixes" },
  { kind: "fractured", label: "Fractured" },
  { kind: "veiled", label: "Veiled" },
  { kind: "crafted", label: "Crafted" },
  { kind: "explicit", label: "Explicit modifiers" },
  { kind: "special", label: "Special modifiers" },
  { kind: "pseudo", label: "Pseudo" },
  { kind: "other", label: "Other" },
];

function compactModifierSectionKind(
  filter: PriceCheckModifierFilter,
  modifier?: ParsedPoeModifier,
): CompactModifierSectionKind {
  if (filter.equipmentProperty || filter.tag === "property") return "properties";
  if (
    filter.tag === "foulborn" ||
    filter.tag === "vestigial" ||
    modifier?.generation === "foulborn" ||
    modifier?.generation === "vestigial"
  ) return "special";
  const kind = modifier?.kind || filter.tag;
  if (kind === "crafted") return "crafted";
  if (kind === "fractured") return "fractured";
  if (kind === "veiled") return "veiled";
  if (kind === "enchant") return "enchant";
  if (kind === "implicit" && modifier?.generation === "corrupted") {
    return "corrupted-implicit";
  }
  if (kind === "implicit") return "implicit";
  if (kind === "pseudo") return "pseudo";
  if (
    kind === "scourge" ||
    kind === "crucible" ||
    kind === "rune" ||
    kind === "imbued"
  ) return "special";
  if (modifier?.generation === "prefix") return "prefix";
  if (modifier?.generation === "suffix") return "suffix";
  if (kind === "explicit") return "explicit";
  return "other";
}

function safeCompactSourceGroupId(
  filter: PriceCheckModifierFilter,
  modifier?: ParsedPoeModifier,
) {
  if (
    !modifier?.advanced ||
    !modifier.sourceGroupId ||
    filter.modifierId.includes("+")
  ) return undefined;
  return modifier.sourceGroupId;
}

export function compactModifierFilterSections(
  item: ParsedPoeItem,
  filters: readonly PriceCheckModifierFilter[],
): CompactModifierPresentationSection[] {
  const modifiers = new Map(
    itemModifiers(item).map((modifier) => [modifier.id, modifier]),
  );
  const entriesByKind = new Map<
    CompactModifierSectionKind,
    CompactModifierPresentationEntry[]
  >();

  for (const filter of compactVisibleModifierFilters(filters)) {
    const modifier = modifiers.get(filter.modifierId);
    const kind = compactModifierSectionKind(filter, modifier);
    const entries = entriesByKind.get(kind) || [];
    entries.push({ filter, modifier });
    entriesByKind.set(kind, entries);
  }

  return COMPACT_MODIFIER_SECTIONS.flatMap(({ kind, label }) => {
    const entries = entriesByKind.get(kind);
    if (!entries?.length) return [];

    const groups: CompactModifierPresentationGroup[] = [];
    for (const entry of entries) {
      const sourceGroupId = safeCompactSourceGroupId(
        entry.filter,
        entry.modifier,
      );
      const previous = groups.at(-1);
      if (sourceGroupId && previous?.sourceGroupId === sourceGroupId) {
        previous.entries.push(entry);
        previous.linked = previous.entries.length > 1;
      } else {
        groups.push({
          key: `${kind}:${entry.filter.modifierId}:${groups.length}`,
          sourceGroupId,
          linked: false,
          entries: [entry],
        });
      }
    }

    return [{ kind, label, entries, groups }];
  });
}

export function compactPriceCheckModifierRowsHeight(
  item: ParsedPoeItem,
  filters: readonly PriceCheckModifierFilter[],
  showSliders = true,
) {
  const sections = compactModifierFilterSections(item, filters);
  return sections.reduce(
    (height, section) => height + COMPACT_MODIFIER_SECTION_HEIGHT +
      section.entries.reduce(
        (sectionHeight, { filter, modifier }) => sectionHeight + (
          showSliders &&
          filter.mode === "range" &&
          hasCanonicalSliderBounds(filter) &&
          !isPresenceOnlyPriceCheckFilter(filter, modifier)
            ? COMPACT_MODIFIER_RANGE_ROW_HEIGHT
            : COMPACT_MODIFIER_ROW_HEIGHT
        ),
        0,
      ),
    0,
  );
}

export interface CompactRareModifierEditorProps {
  item: ParsedPoeItem;
  filters: readonly PriceCheckModifierFilter[];
  itemFilters?: Readonly<Record<string, ItemFilterValue>>;
  /** Base/Exact presets expose their additional exact item-state controls. */
  exactItemFilters?: boolean;
  /** Keeps numeric range inputs while omitting slider tracks on short work areas. */
  showSliders?: boolean;
  onModifierChange: (
    modifierId: string,
    patch: Partial<PriceCheckModifierFilter>,
  ) => void;
  onItemFilterChange: (
    key: string,
    value: ItemFilterValue | undefined,
  ) => void;
  className?: string;
}

export interface CompactSliderDomain {
  min: number;
  max: number;
  step: number;
}

export function hasCanonicalSliderBounds(
  filter: Pick<PriceCheckModifierFilter, "bounds">,
) {
  return finite(filter.bounds?.min) &&
    finite(filter.bounds?.max) &&
    filter.bounds.max > filter.bounds.min;
}

/** Awakened activates an unchecked stat as part of the first value edit. */
export function compactModifierEditPatch(
  enabled: boolean,
  patch: Partial<PriceCheckModifierFilter>,
): Partial<PriceCheckModifierFilter> {
  return enabled ? patch : { enabled: true, ...patch };
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function hasOfficialTradeStat(filter: PriceCheckModifierFilter) {
  return isOfficialPriceCheckFilter(filter);
}

function decimalPlaces(value: number) {
  const text = Math.abs(value).toString().toLowerCase();
  const [coefficient, exponentText] = text.split("e");
  const exponent = Number(exponentText || 0);
  const fraction = coefficient.split(".")[1]?.length || 0;
  return Math.max(0, Math.min(4, fraction - exponent));
}

function niceStep(value: number) {
  if (!Number.isFinite(value) || value <= 0) return 0;
  const power = 10 ** Math.floor(Math.log10(value));
  const scaled = value / power;
  const factor = scaled <= 1 ? 1 : scaled <= 2 ? 2 : scaled <= 5 ? 5 : 10;
  return factor * power;
}

function stepPrecision(step: number) {
  if (step >= 1) return 4;
  return Math.min(8, Math.max(4, Math.ceil(-Math.log10(step)) + 2));
}

function rounded(value: number, step: number) {
  return Number(value.toFixed(stepPrecision(step)));
}

/**
 * Derives a decimal-safe slider step without changing the canonical source
 * bounds. APT only renders a slider when both source bounds are available.
 */
export function deriveCompactSliderDomain(
  copiedRoll?: number,
  minimum?: number,
  maximum?: number,
): CompactSliderDomain | null {
  if (!finite(minimum) || !finite(maximum) || maximum <= minimum) return null;
  const values = [copiedRoll, minimum, maximum].filter(finite);
  const span = maximum - minimum;
  const precisionStep = 10 ** -Math.max(...values.map(decimalPlaces));
  const densityStep = niceStep(span / 800);
  const step = rounded(Math.max(precisionStep, densityStep || precisionStep), precisionStep);
  return { min: minimum, max: maximum, step };
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

function firstRoll(modifier?: ParsedPoeModifier) {
  return modifier?.values.find(finite);
}

interface DraftNumberInputProps {
  value?: number;
  disabled?: boolean;
  className?: string;
  inputMode?: "numeric" | "decimal";
  minimum?: number;
  maximum?: number;
  step?: number | "any";
  ariaLabel: string;
  title?: string;
  placeholder?: string;
  onActivate?: () => void;
  onCommit: (value: number | undefined) => void;
}

function DraftNumberInput({
  value,
  disabled,
  className,
  inputMode = "decimal",
  minimum,
  maximum,
  step = "any",
  ariaLabel,
  title,
  placeholder,
  onActivate,
  onCommit,
}: DraftNumberInputProps) {
  const [draft, setDraft] = useState(value == null ? "" : String(value));
  const editing = useRef(false);
  const skipNextBlurCommit = useRef(false);
  const focusValue = useRef(value);
  useEffect(() => {
    if (!editing.current) setDraft(value == null ? "" : String(value));
  }, [value]);

  const normalized = (raw: string) => {
    if (!raw.trim()) return undefined;
    const number = Number(raw);
    if (!Number.isFinite(number)) return null;
    let next = number;
    if (minimum != null) next = Math.max(minimum, next);
    if (maximum != null) next = Math.min(maximum, next);
    return next;
  };
  const commit = () => {
    const next = normalized(draft);
    if (next === null) {
      setDraft(value == null ? "" : String(value));
      return;
    }
    onCommit(next);
    setDraft(next == null ? "" : String(next));
  };
  const onKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      commit();
      skipNextBlurCommit.current = true;
      event.currentTarget.blur();
    } else if (event.key === "Escape") {
      event.preventDefault();
      onCommit(focusValue.current);
      setDraft(focusValue.current == null ? "" : String(focusValue.current));
      skipNextBlurCommit.current = true;
      event.currentTarget.blur();
    }
  };
  const invalid = draft.trim() !== "" && normalized(draft) === null;

  return (
    <input
      className={className}
      type="text"
      inputMode={inputMode}
      value={draft}
      disabled={disabled}
      aria-label={ariaLabel}
      aria-invalid={invalid || undefined}
      title={title}
      placeholder={placeholder}
      data-step={step}
      onFocus={() => {
        editing.current = true;
        focusValue.current = value;
        skipNextBlurCommit.current = false;
        onActivate?.();
      }}
      onChange={(event) => {
        const nextDraft = event.currentTarget.value;
        setDraft(nextDraft);
        const next = normalized(nextDraft);
        if (next !== null && next !== undefined) onCommit(next);
      }}
      onBlur={() => {
        if (skipNextBlurCommit.current) {
          skipNextBlurCommit.current = false;
        } else {
          commit();
        }
        editing.current = false;
      }}
      onKeyDown={onKeyDown}
    />
  );
}

interface PendingModifierChange {
  modifierId: string;
  patch: Partial<PriceCheckModifierFilter>;
}

/**
 * Keeps pointer-driven range updates to at most one parent rebuild per paint.
 * Pointer/key release and blur flush synchronously so the final selected value
 * is committed before another overlay action (such as opening Trade) can run.
 */
function useFrameModifierChange(
  onModifierChange: CompactRareModifierEditorProps["onModifierChange"],
) {
  const callbackRef = useRef(onModifierChange);
  const pendingRef = useRef<PendingModifierChange | null>(null);
  const frameRef = useRef<number | null>(null);
  callbackRef.current = onModifierChange;

  const flush = useCallback(() => {
    if (frameRef.current != null) {
      window.cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    }
    const pending = pendingRef.current;
    pendingRef.current = null;
    if (pending) callbackRef.current(pending.modifierId, pending.patch);
  }, []);

  const schedule = useCallback((
    modifierId: string,
    patch: Partial<PriceCheckModifierFilter>,
  ) => {
    const pending = pendingRef.current;
    if (pending && pending.modifierId !== modifierId) flush();
    pendingRef.current = {
      modifierId,
      patch:
        pending?.modifierId === modifierId
          ? { ...pending.patch, ...patch }
          : patch,
    };
    if (frameRef.current == null) {
      frameRef.current = window.requestAnimationFrame(() => {
        frameRef.current = null;
        const next = pendingRef.current;
        pendingRef.current = null;
        if (next) callbackRef.current(next.modifierId, next.patch);
      });
    }
  }, [flush]);

  useEffect(() => () => {
    if (frameRef.current != null) window.cancelAnimationFrame(frameRef.current);
    frameRef.current = null;
    pendingRef.current = null;
  }, []);

  return { flush, schedule };
}

function CompactDualRange({
  modifierId,
  label,
  domain,
  lower,
  upper,
  enabled,
  style,
  schedule,
  flush,
}: {
  modifierId: string;
  label: string;
  domain: CompactSliderDomain;
  lower: number;
  upper: number;
  enabled: boolean;
  style: CSSProperties;
  schedule: (
    modifierId: string,
    patch: Partial<PriceCheckModifierFilter>,
  ) => void;
  flush: () => void;
}) {
  const track = useRef<HTMLDivElement>(null);
  const draggedBound = useRef<"min" | "max" | null>(null);
  const activationSent = useRef(enabled);
  useEffect(() => {
    activationSent.current = enabled;
  }, [enabled, modifierId]);
  const valueAt = (event: ReactPointerEvent<HTMLDivElement>) => {
    const rect = track.current?.getBoundingClientRect();
    if (!rect?.width) return lower;
    const ratio = clamp((event.clientX - rect.left) / rect.width, 0, 1);
    return rounded(domain.min + ratio * (domain.max - domain.min), domain.step);
  };
  const update = (bound: "min" | "max", value: number) => {
    const patch = bound === "min"
      ? { min: Math.min(value, upper) }
      : { max: Math.max(value, lower) };
    schedule(
      modifierId,
      compactModifierEditPatch(activationSent.current, patch),
    );
    activationSent.current = true;
  };

  return (
    <div
      ref={track}
      className="crme-dual-range"
      style={style}
      role="group"
      aria-label={`Range slider for ${label}`}
      onPointerDown={(event) => {
        if (event.target instanceof HTMLInputElement) return;
        event.preventDefault();
        const value = valueAt(event);
        const bound = lower === upper
          ? value >= upper ? "max" : "min"
          : Math.abs(value - lower) <= Math.abs(value - upper) ? "min" : "max";
        draggedBound.current = bound;
        event.currentTarget.setPointerCapture?.(event.pointerId);
        update(bound, value);
      }}
      onPointerMove={(event) => {
        if (!draggedBound.current) return;
        update(draggedBound.current, valueAt(event));
      }}
      onPointerUp={(event) => {
        if (!draggedBound.current) return;
        update(draggedBound.current, valueAt(event));
        draggedBound.current = null;
        flush();
        event.currentTarget.releasePointerCapture?.(event.pointerId);
      }}
      onPointerCancel={() => {
        draggedBound.current = null;
        flush();
      }}
    >
      <input
        type="range"
        min={domain.min}
        max={domain.max}
        step={domain.step}
        value={lower}
        aria-label={`Minimum slider for ${label}`}
        style={{ zIndex: lower >= upper ? 2 : 1 }}
        onInput={(event) => update(
          "min",
          Number(event.currentTarget.value),
        )}
        onPointerUp={flush}
        onKeyUp={flush}
        onBlur={flush}
      />
      <input
        type="range"
        min={domain.min}
        max={domain.max}
        step={domain.step}
        value={upper}
        aria-label={`Maximum slider for ${label}`}
        style={{ zIndex: upper > lower ? 2 : 1 }}
        onInput={(event) => update(
          "max",
          Number(event.currentTarget.value),
        )}
        onPointerUp={flush}
        onKeyUp={flush}
        onBlur={flush}
      />
    </div>
  );
}

function NumericStateControl({
  filterKey,
  label,
  copiedValue,
  activeFilters,
  maximum,
  onChange,
}: {
  filterKey: string;
  label: string;
  copiedValue: number;
  activeFilters: Readonly<Record<string, ItemFilterValue>>;
  maximum?: number;
  onChange: CompactRareModifierEditorProps["onItemFilterChange"];
}) {
  const enabled = Object.hasOwn(activeFilters, filterKey);
  const activeValue = Number(activeFilters[filterKey]);
  const value = enabled && Number.isFinite(activeValue) ? activeValue : copiedValue;
  const description = `${label} filter`;
  return (
    <span className={clsx("crme-state crme-state--number", enabled && "is-active")}>
      <label title={description}>
        <input
          type="checkbox"
          checked={enabled}
          aria-label={`Use ${label.toLowerCase()} filter`}
          onChange={() => onChange(filterKey, enabled ? undefined : copiedValue)}
        />
        <span aria-hidden><Check size={9} /></span>
        <b>{label}</b>
      </label>
      <DraftNumberInput
        className="crme-state-number-input"
        inputMode="numeric"
        minimum={0}
        maximum={maximum}
        step={1}
        value={value}
        disabled={!enabled}
        ariaLabel={`${label} value`}
        onCommit={(next) => onChange(filterKey, next)}
      />
    </span>
  );
}

function NumericRangeStateControl({
  filterKey,
  upperFilterKey,
  label,
  copiedValue,
  copiedUpperValue,
  activeFilters,
  maximum,
  onChange,
}: {
  filterKey: string;
  upperFilterKey: string;
  label: string;
  copiedValue: number;
  copiedUpperValue: number;
  activeFilters: Readonly<Record<string, ItemFilterValue>>;
  maximum?: number;
  onChange: CompactRareModifierEditorProps["onItemFilterChange"];
}) {
  const enabled = Object.hasOwn(activeFilters, filterKey) ||
    Object.hasOwn(activeFilters, upperFilterKey);
  const activeValue = Number(activeFilters[filterKey]);
  const activeUpperValue = Number(activeFilters[upperFilterKey]);
  const value = Number.isFinite(activeValue) ? activeValue : copiedValue;
  const upperValue = Number.isFinite(activeUpperValue)
    ? activeUpperValue
    : copiedUpperValue;
  const toggle = () => {
    onChange(filterKey, enabled ? undefined : copiedValue);
    onChange(upperFilterKey, enabled ? undefined : copiedUpperValue);
  };
  return (
    <span
      className={clsx(
        "crme-state crme-state--number crme-state--number-range",
        enabled && "is-active",
      )}
    >
      <label title={`${label} range filter`}>
        <input
          type="checkbox"
          checked={enabled}
          aria-label={`Use ${label.toLowerCase()} range filter`}
          onChange={toggle}
        />
        <span aria-hidden><Check size={9} /></span>
        <b>{label}</b>
      </label>
      <DraftNumberInput
        className="crme-state-number-input"
        inputMode="numeric"
        minimum={0}
        maximum={maximum}
        step={1}
        value={value}
        disabled={!enabled}
        ariaLabel={`${label} minimum value`}
        onCommit={(next) => onChange(filterKey, next)}
      />
      <i aria-hidden>–</i>
      <DraftNumberInput
        className="crme-state-number-input"
        inputMode="numeric"
        minimum={0}
        maximum={maximum}
        step={1}
        value={upperValue}
        disabled={!enabled}
        ariaLabel={`${label} maximum value`}
        onCommit={(next) => onChange(upperFilterKey, next)}
      />
    </span>
  );
}

function BooleanStateControl({
  filterKey,
  label,
  copiedValue = true,
  activeFilters,
  onChange,
}: {
  filterKey: string;
  label: string;
  copiedValue?: boolean;
  activeFilters: Readonly<Record<string, ItemFilterValue>>;
  onChange: CompactRareModifierEditorProps["onItemFilterChange"];
}) {
  const enabled = Object.hasOwn(activeFilters, filterKey);
  return (
    <label
      className={clsx("crme-state", enabled && "is-active")}
      title={`${label} filter`}
    >
      <input
        type="checkbox"
        checked={enabled}
        aria-label={`Use ${label.toLowerCase()} filter`}
        onChange={() => onChange(filterKey, enabled ? undefined : copiedValue)}
      />
      <span aria-hidden><Check size={9} /></span>
      <b>{label}</b>
    </label>
  );
}

function IdentityStateControl({
  filterKey,
  label,
  copiedValue,
  activeFilters,
  onChange,
}: {
  filterKey: "identityRelaxed" | "identitySub";
  label: string;
  copiedValue: boolean;
  activeFilters: Readonly<Record<string, ItemFilterValue>>;
  onChange: CompactRareModifierEditorProps["onItemFilterChange"];
}) {
  const selected = typeof activeFilters[filterKey] === "boolean"
    ? Boolean(activeFilters[filterKey])
    : copiedValue;
  return (
    <label
      className="crme-state crme-state--identity is-active"
      title={`${label} identity`}
    >
      <input
        type="checkbox"
        checked={selected}
        aria-label={`Use ${label.toLowerCase()} identity`}
        onChange={(event) => onChange(filterKey, event.currentTarget.checked)}
      />
      <span aria-hidden><Check size={9} /></span>
      <b>{label}</b>
    </label>
  );
}

function StringStateControl({
  filterKey,
  label,
  copiedValue,
  displayValue,
  readonly = false,
  activeFilters,
  onChange,
}: {
  filterKey: string;
  label: string;
  copiedValue: string;
  displayValue?: string;
  readonly?: boolean;
  activeFilters: Readonly<Record<string, ItemFilterValue>>;
  onChange: CompactRareModifierEditorProps["onItemFilterChange"];
}) {
  const enabled = readonly || Object.hasOwn(activeFilters, filterKey);
  const contents = <>
    <span aria-hidden><Check size={9} /></span>
    <b>{label}</b>
    {displayValue ? <small title={displayValue}>{displayValue}</small> : null}
  </>;
  if (readonly) {
    return (
      <span
        className="crme-state crme-state--string is-active is-readonly"
        aria-label={`${label} ${displayValue || copiedValue}`}
        title={`${label}: ${displayValue || copiedValue}`}
      >
        {contents}
      </span>
    );
  }
  return (
    <label
      className={clsx("crme-state crme-state--string", enabled && "is-active")}
      title={`${label} filter`}
    >
      <input
        type="checkbox"
        checked={enabled}
        aria-label={`Use ${label.toLowerCase()} filter`}
        onChange={() => onChange(filterKey, enabled ? undefined : copiedValue)}
      />
      {contents}
    </label>
  );
}

export function CompactRareModifierEditor({
  item,
  filters,
  itemFilters = {},
  exactItemFilters = false,
  showSliders = true,
  onModifierChange,
  onItemFilterChange,
  className,
}: CompactRareModifierEditorProps) {
  const frameModifierChange = useFrameModifierChange(onModifierChange);
  const visibleFilters = filters.filter((filter) => !filter.advancedOnly);
  const modifierSections = compactModifierFilterSections(item, filters);
  // Awakened's summary counts the complete stat plan (including upstream-
  // hidden rows) while its open editor renders only non-hidden rows.
  const appliedCount = filters.filter((filter) => filter.enabled).length;
  const mappedCount = visibleFilters.filter(hasOfficialTradeStat).length;
  const unmappedCount = visibleFilters.length - mappedCount;
  const stateControls = priceCheckItemFilterControls(item, {
    exact: exactItemFilters,
    itemFilters,
  });
  const stateRows = compactPriceCheckItemStateRowCount(
    item,
    exactItemFilters,
    itemFilters,
  );
  const activeVisibleStateCount = stateControls.filter(
    (control) => control.kind === "identity" ||
      (control.kind === "string" && control.readonly) ||
      Object.hasOwn(itemFilters, control.key) ||
      (control.kind === "number-range" &&
        Object.hasOwn(itemFilters, control.upperKey)),
  ).length;

  return (
    <section
      className={clsx(
        "crme",
        !showSliders && "is-without-sliders is-constrained",
        className,
      )}
      aria-label="Item modifier filters"
    >
      {visibleFilters.length ? <header className="crme-heading">
        <div
          aria-label={`${appliedCount} of ${filters.length} Trade stats selected. All non-hidden stats are visible.`}
        >
          <strong>{appliedCount}/{filters.length} STATS</strong>
          <span>
            {unmappedCount ? `${unmappedCount} UNMAPPED / ` : ""}
            {mappedCount
              ? `${mappedCount} TRADE`
              : `${activeVisibleStateCount} ${activeVisibleStateCount === 1 ? "STATE" : "STATES"}`}
          </span>
        </div>
      </header> : null}

      <div
        className="crme-states"
        data-rows={stateRows}
        style={{
          "--crme-state-strip-height": `${compactPriceCheckItemStateStripHeight(
            item,
            exactItemFilters,
            itemFilters,
          )}px`,
        } as CSSProperties}
        role="group"
        aria-label="Item state filters"
        title="Item state filters"
      >
        {stateControls.map((control) => (
          control.kind === "identity" ? (
            <IdentityStateControl
              filterKey={control.key}
              label={control.label}
              copiedValue={control.copiedValue}
              activeFilters={itemFilters}
              onChange={onItemFilterChange}
              key={control.key}
            />
          ) : control.kind === "number" ? (
            <NumericStateControl
              filterKey={control.key}
              label={control.label}
              copiedValue={control.copiedValue}
              activeFilters={itemFilters}
              maximum={control.maximum}
              onChange={onItemFilterChange}
              key={control.key}
            />
          ) : control.kind === "number-range" ? (
            <NumericRangeStateControl
              filterKey={control.key}
              upperFilterKey={control.upperKey}
              label={control.label}
              copiedValue={control.copiedValue}
              copiedUpperValue={control.copiedUpperValue}
              activeFilters={itemFilters}
              maximum={control.maximum}
              onChange={onItemFilterChange}
              key={control.key}
            />
          ) : control.kind === "string" ? (
            <StringStateControl
              filterKey={control.key}
              label={control.label}
              copiedValue={control.copiedValue}
              displayValue={control.displayValue}
              readonly={control.readonly}
              activeFilters={itemFilters}
              onChange={onItemFilterChange}
              key={control.key}
            />
          ) : (
            <BooleanStateControl
              filterKey={control.key}
              label={control.label}
              copiedValue={control.copiedValue}
              activeFilters={itemFilters}
              onChange={onItemFilterChange}
              key={control.key}
            />
          )
        ))}
      </div>

      {modifierSections.length ? <div
        className="crme-list"
        role="group"
        aria-label="Modifier groups"
      >
        {modifierSections.map((section) => (
          <section
            className="crme-section"
            data-section={section.kind}
            aria-label={`${section.label}, ${section.entries.length} ${section.entries.length === 1 ? "modifier" : "modifiers"}`}
            key={section.kind}
          >
            <header className="crme-section-heading">
              <strong>{section.label}</strong>
              <span>{section.entries.length}</span>
            </header>
            <div className="crme-section-list">
              {section.groups.map((group) => (
                <div
                  className={clsx(
                    "crme-affix-group",
                    group.linked && "is-linked",
                  )}
                  role={group.linked ? "group" : undefined}
                  aria-label={group.linked
                    ? `Linked ${section.label.toLowerCase()}, ${group.entries.length} lines`
                    : undefined}
                  data-source-group={group.linked ? group.sourceGroupId : undefined}
                  key={group.key}
                >
                  {group.entries.map(({ filter, modifier }) => {
          const label = filter.label || modifier?.text || filter.modifierId;
          const mapped = hasOfficialTradeStat(filter);
          const presenceOnly = isPresenceOnlyPriceCheckFilter(filter, modifier);
          const effectiveMode = presenceOnly ? "presence" : filter.mode;
          const copiedRoll = firstRoll(modifier) ?? filter.copiedValue;
          const domain = deriveCompactSliderDomain(
            copiedRoll,
            filter.bounds?.min,
            filter.bounds?.max,
          );
          const slider = domain ? (() => {
            const rawLower = finite(filter.min)
              ? filter.min
              : copiedRoll ?? domain.min;
            const rawUpper = finite(filter.max)
              ? filter.max
              : copiedRoll ?? domain.max;
            const lower = clamp(
              Math.min(rawLower, rawUpper),
              domain.min,
              domain.max,
            );
            const upper = clamp(
              Math.max(rawLower, rawUpper),
              domain.min,
              domain.max,
            );
            const span = domain.max - domain.min;
            return {
              lower,
              upper,
              style: {
                "--crme-from": `${((lower - domain.min) / span) * 100}%`,
                "--crme-to": `${((upper - domain.min) / span) * 100}%`,
              } as CSSProperties,
            };
          })() : null;
          const hasSlider =
            effectiveMode === "range" && showSliders && slider != null;
          const invalidRange =
            effectiveMode === "range" &&
            finite(filter.min) &&
            finite(filter.max) &&
            filter.min > filter.max;
          const exactValue = finite(filter.min)
            ? filter.min
            : finite(filter.max)
              ? filter.max
              : copiedRoll;
          const detail = filter.anointmentOils?.length
            ? filter.anointmentOils.join(" + ").toUpperCase()
            : modifier?.roomState === 1
              ? "OPEN ROOM"
              : modifier?.roomState === 2
                ? "OBSTRUCTED ROOM"
                : filter.equipmentProperty
                  ? mapped ? "" : "NEEDS VALUE"
                  : [
                      (modifier?.generation || modifier?.kind || filter.tag || "")
                        .toUpperCase(),
                      modifier?.tier?.toUpperCase(),
                      !mapped ? "UNMAPPED" : "",
                    ].filter(Boolean).join(" / ");

          return (
            <div
              className={clsx(
                "crme-row",
                filter.enabled && "is-enabled",
                hasSlider && "has-slider",
                invalidRange && "is-invalid",
                !mapped && "is-unmapped",
              )}
              key={filter.modifierId}
            >
              <label className="crme-check" title={`Include ${label}`}>
                <input
                  type="checkbox"
                  checked={filter.enabled}
                  aria-label={`Include ${label}`}
                  onChange={(event) => onModifierChange(filter.modifierId, {
                    enabled: event.currentTarget.checked,
                  })}
                />
                <span aria-hidden><Check size={10} /></span>
              </label>

              <div className="crme-copy" title={label}>
                <strong className="crme-label">{label}</strong>
                {detail ? <small>{detail}</small> : null}
              </div>

              {effectiveMode === "range" ? (
                <>
                  <DraftNumberInput
                    className="crme-number"
                    inputMode="decimal"
                    step="any"
                    value={filter.min}
                    minimum={filter.bounds?.min}
                    maximum={filter.bounds?.max}
                    ariaLabel={`Minimum value for ${label}`}
                    title="Minimum"
                    onActivate={() => {
                      if (!filter.enabled) {
                        onModifierChange(filter.modifierId, { enabled: true });
                      }
                    }}
                    placeholder="-∞"
                    onCommit={(value) => onModifierChange(filter.modifierId, {
                      min: value,
                    })}
                  />
                  <DraftNumberInput
                    className="crme-number"
                    inputMode="decimal"
                    step="any"
                    value={filter.max}
                    minimum={filter.bounds?.min}
                    maximum={filter.bounds?.max}
                    ariaLabel={`Maximum value for ${label}`}
                    title="Maximum"
                    onActivate={() => {
                      if (!filter.enabled) {
                        onModifierChange(filter.modifierId, { enabled: true });
                      }
                    }}
                    placeholder="∞"
                    onCommit={(value) => onModifierChange(filter.modifierId, {
                      max: value,
                    })}
                  />
                  {hasSlider && domain && slider ? (
                    <CompactDualRange
                      modifierId={filter.modifierId}
                      label={label}
                      domain={domain}
                      lower={slider.lower}
                      upper={slider.upper}
                      enabled={filter.enabled}
                      style={slider.style}
                      schedule={frameModifierChange.schedule}
                      flush={frameModifierChange.flush}
                    />
                  ) : null}
                </>
              ) : effectiveMode === "exact" ? (
                <DraftNumberInput
                  className="crme-number crme-number--exact"
                  inputMode="decimal"
                  step="any"
                  value={exactValue}
                  minimum={filter.bounds?.min}
                  maximum={filter.bounds?.max}
                  ariaLabel={`Exact value for ${label}`}
                  title="Exact value"
                  onActivate={() => {
                    if (!filter.enabled) {
                      onModifierChange(filter.modifierId, { enabled: true });
                    }
                  }}
                  onCommit={(value) => {
                    onModifierChange(filter.modifierId, { min: value, max: value });
                  }}
                />
              ) : (
                <span className="crme-presence" aria-label={`${label} presence only`}>PRESENT</span>
              )}
            </div>
          );
                  })}
                </div>
              ))}
            </div>
          </section>
        ))}
      </div> : null}
    </section>
  );
}
