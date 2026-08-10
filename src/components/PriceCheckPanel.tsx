import clsx from "clsx";
import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import {
  AlertTriangle,
  Check,
  Clipboard,
  Copy,
  ExternalLink,
  RefreshCw,
  Search,
  ShieldCheck,
  Star,
} from "lucide-react";
import { formatPrice, formatRelativeTime } from "../lib/format";
import { formatPriceCheckHotkey } from "../lib/price-check/hotkey";
import { isOfficialPriceCheckFilter } from "../lib/price-check/equipment-properties";
import {
  officialTradeNeedsExplicitSearch,
  priceCheckItemForMode,
  priceCheckModesForItem,
} from "../lib/price-check/official-trade-workflow";
import {
  priceCheckAvailabilityDescription,
  priceCheckAvailabilityLabel,
  type PriceCheckAvailability,
} from "../lib/price-check/availability";
import {
  priceCheckItemFilterControls,
} from "../lib/price-check/query-plan";
import {
  isPresenceOnlyPriceCheckFilter,
} from "../lib/price-check/trade-stat-id";
import type {
  PriceCheckMatch,
  PriceCheckDashboardMode,
  PriceCheckModifierFilter,
  PriceCheckSession,
} from "../lib/price-check/types";
import { CompactTradeListings } from "./CompactTradeListings";
import { CurrencyMark } from "./CurrencyMark";
import { UnidentifiedUniqueResolver } from "./UnidentifiedUniqueResolver";

export type PriceCheckMode = PriceCheckDashboardMode;

export interface PriceCheckPanelProps {
  session: PriceCheckSession;
  mode: PriceCheckMode;
  rollTolerance: number;
  availability: PriceCheckAvailability;
  hotkey: string;
  isMobile?: boolean;
  showAdvanced?: boolean;
  onCaptureRequested: () => void;
  onRetry: () => void;
  onModeChange: (mode: PriceCheckMode) => void;
  onIdentifyUnique?: (name: string) => void;
  onMatchSelect: (matchKey: string) => void;
  onModifierChange: (
    modifierId: string,
    patch: Partial<PriceCheckModifierFilter>,
  ) => void;
  onItemFilterChange: (
    key: string,
    value: string | number | boolean | undefined,
  ) => void;
  onRollToleranceChange: (value: number) => void;
  onAvailabilityChange: (value: PriceCheckAvailability) => void;
  onOpenTrade: () => void;
  onCopySummary: () => Promise<boolean>;
  onWatchMatch?: () => void;
}

const modeCopy: Record<PriceCheckMode, string> = {
  exact: "Exact",
  bulk: "Bulk",
  similar: "Similar",
  base: "Base",
  I: "I",
  II: "II",
  III: "III",
  IV: "IV",
  V: "V",
};

function matchLabel(match: PriceCheckMatch) {
  const detail = [
    match.row.variant,
    match.row.baseType,
    match.row.categoryId === "base-types" && match.row.levelRequired != null
      ? `requires level ${match.row.levelRequired}`
      : undefined,
    match.row.gemLevel != null ? `level ${match.row.gemLevel}` : undefined,
    match.row.gemQuality != null ? `${match.row.gemQuality}% quality` : undefined,
    match.row.links ? `${match.row.links}-link` : undefined,
    match.row.mapTier != null ? `tier ${match.row.mapTier}` : undefined,
  ]
    .filter((value, index, values) => value && values.indexOf(value) === index)
    .join(" - ");
  const identity = detail ? `${match.row.name} - ${detail}` : match.row.name;
  return `${identity} - ${formatPrice(match.row.chaosValue)} chaos`;
}

function selectedMatch(session: PriceCheckSession) {
  return (
    session.matches.find(
      (match) => match.row.key === session.selectedMatchKey,
    ) || session.matches[0]
  );
}

const genericWarningCopy = new Set([
  "Market values are asking-price estimates, not verified completed sales.",
  "poe.ninja market values are aggregate estimates, not completed sales.",
  "Open official Trade and apply this comparison plan manually to verify current listings.",
  "Official Trade opens with selected mapped filters prefilled; review current listings before pricing.",
]);

function itemDisplayName(session: PriceCheckSession) {
  const item = session.item;
  if (!item) return "Copied Path of Exile item";
  return item.name || item.baseType || "Unnamed item";
}

function itemSubtitle(session: PriceCheckSession) {
  const item = session.item;
  if (!item) return "Waiting for item data";
  const values = [
    item.name && item.baseType && item.baseType !== item.name
      ? item.baseType
      : undefined,
    item.itemClass || undefined,
  ].filter(Boolean);
  return values.join(" - ") || "Path of Exile item";
}

function PriceCheckStatus({
  session,
  isMobile,
  hotkey,
}: {
  session: PriceCheckSession;
  isMobile?: boolean;
  hotkey: string;
}) {
  const loading = session.status === "parsing" || session.status === "resolving";
  if (loading) {
    return (
        <section className="pc-state pc-state--loading" aria-live="polite">
          <span className="pc-state-icon">
            <span className="pc-state-pulse" aria-hidden />
          </span>
        <div>
          <strong>
            {session.status === "parsing"
              ? "Reading item"
              : "Matching market"}
          </strong>
        </div>
      </section>
    );
  }

  if (session.status === "invalid" || session.status === "error") {
    return (
      <section className="pc-state pc-state--error" role="alert">
        <span className="pc-state-icon">
          <AlertTriangle size={25} aria-hidden />
        </span>
        <div>
          <strong>
            {session.status === "invalid"
              ? "Not a PoE item"
              : "Price check failed"}
          </strong>
          <p>
            {session.message ||
              (isMobile
                ? "Paste full item text starting with Item Class."
                : `Hover a PoE item and press ${formatPriceCheckHotkey(hotkey)} again.`)}
          </p>
          {session.item?.errors.length ? (
            <ul>
              {session.item.errors.slice(0, 3).map((error) => (
                <li key={error}>{error}</li>
              ))}
            </ul>
          ) : null}
        </div>
      </section>
    );
  }

  return (
    <section className="pc-state pc-state--empty">
      <span className="pc-state-icon">
        <Clipboard size={26} aria-hidden />
      </span>
      <div>
        <strong>{isMobile ? "Paste item text" : `Press ${formatPriceCheckHotkey(hotkey)} on an item`}</strong>
      </div>
    </section>
  );
}

function EstimateCard({ session }: { session: PriceCheckSession }) {
  const estimate = session.estimate;
  if (!estimate) {
    const usesModifierComparison =
      session.item?.rarity === "rare" || session.item?.rarity === "magic";
    const unavailable =
      session.status === "ready" &&
      (Boolean(session.message) || usesModifierComparison);
    return (
      <section
        className="pc-estimate pc-estimate--none"
        aria-label={unavailable ? "Market estimate unavailable" : "Market estimate loading"}
      >
        <div className="pc-estimate-value">
          <strong>{unavailable ? "No market reference" : "Loading market reference..."}</strong>
        </div>
      </section>
    );
  }
  const match = selectedMatch(session);
  const showDivine =
    estimate.divineValue != null &&
    (estimate.divineValue >= 1 || estimate.chaosValue == null);
  const value = showDivine ? estimate.divineValue : estimate.chaosValue;
  const unit = showDivine ? "divine" : "chaos";
  const low = showDivine
    ? estimate.lowChaos != null && estimate.chaosValue
      ? (estimate.lowChaos / estimate.chaosValue) * estimate.divineValue!
      : null
    : estimate.lowChaos;
  const high = showDivine
    ? estimate.highChaos != null && estimate.chaosValue
      ? (estimate.highChaos / estimate.chaosValue) * estimate.divineValue!
      : null
    : estimate.highChaos;

  return (
    <section
      className={clsx(
        "pc-estimate",
        `pc-estimate--${estimate.confidence}`,
      )}
      aria-label="Market estimate"
    >
      <div className="pc-estimate-topline">
        <span className="pc-eyebrow" title={estimate.label}>PRICE</span>
        <span className={clsx("pc-confidence", `is-${estimate.confidence}`)}>
          <ShieldCheck size={13} aria-hidden />
          {estimate.confidence === "none"
            ? "NO MATCH"
            : estimate.confidence.toUpperCase()}
          {estimate.confidence !== "none" ? (
            <b>{Math.round(estimate.confidenceScore)}%</b>
          ) : null}
        </span>
      </div>

      <div className="pc-estimate-value">
        <strong>{value == null ? "No reliable price" : formatPrice(value)}</strong>
        {value != null ? <CurrencyMark unit={unit} size="medium" /> : null}
      </div>

      <div className="pc-estimate-range">
        {low != null && high != null ? (
          <span>
            RANGE <b>{formatPrice(low)}</b>–<b>{formatPrice(high)}</b>
            <CurrencyMark unit={unit} />
          </span>
        ) : (
          <span>NO RANGE</span>
        )}
        {match ? (
          <span title={match.reasons.join(". ")}>
            MATCH {Math.round(match.score)}%
          </span>
        ) : null}
      </div>
    </section>
  );
}

interface EditableNumberInputProps {
  value?: number;
  disabled?: boolean;
  inputMode?: "numeric" | "decimal";
  minimum?: number;
  maximum?: number;
  allowEmpty?: boolean;
  placeholder?: string;
  ariaLabel: string;
  onActivate?: () => void;
  onCommit: (value: number | undefined) => void;
}

/** Awakened activates an unchecked stat as part of the first value edit. */
export function dashboardModifierEditPatch(
  enabled: boolean,
  patch: Partial<PriceCheckModifierFilter>,
): Partial<PriceCheckModifierFilter> {
  return enabled ? patch : { enabled: true, ...patch };
}

/**
 * Keeps partial numeric text such as `-`, `2.`, and `-.5` editable while the
 * parent query is rebuilt. Valid values still update immediately; Escape
 * restores the value that was present when the field received focus.
 */
function EditableNumberInput({
  value,
  disabled,
  inputMode = "decimal",
  minimum,
  maximum,
  allowEmpty = true,
  placeholder,
  ariaLabel,
  onActivate,
  onCommit,
}: EditableNumberInputProps) {
  const [draft, setDraft] = useState(value == null ? "" : String(value));
  const editing = useRef(false);
  const focusValue = useRef(value);
  const skipNextBlurCommit = useRef(false);

  useEffect(() => {
    if (!editing.current) setDraft(value == null ? "" : String(value));
  }, [value]);

  const normalize = (raw: string) => {
    if (!raw.trim()) return allowEmpty ? undefined : null;
    const numeric = Number(raw);
    if (!Number.isFinite(numeric)) return null;
    return Math.min(maximum ?? numeric, Math.max(minimum ?? numeric, numeric));
  };
  const commit = () => {
    const next = normalize(draft);
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
  const invalid = draft.trim() !== "" && normalize(draft) === null;

  return (
    <input
      type="text"
      inputMode={inputMode}
      value={draft}
      disabled={disabled}
      aria-label={ariaLabel}
      aria-invalid={invalid || undefined}
      placeholder={placeholder}
      onFocus={() => {
        editing.current = true;
        focusValue.current = value;
        skipNextBlurCommit.current = false;
        onActivate?.();
      }}
      onChange={(event) => {
        const nextDraft = event.currentTarget.value;
        setDraft(nextDraft);
        const next = normalize(nextDraft);
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

function EquipmentPropertySlider({
  filter,
  label,
  onModifierChange,
}: {
  filter: PriceCheckModifierFilter;
  label: string;
  onModifierChange: PriceCheckPanelProps["onModifierChange"];
}) {
  const copied = filter.copiedValue;
  const minimum = filter.bounds?.min;
  const maximum = filter.bounds?.max;
  const hasCanonicalBounds =
    typeof minimum === "number" &&
    Number.isFinite(minimum) &&
    typeof maximum === "number" &&
    Number.isFinite(maximum) &&
    maximum > minimum;
  const editsMaximum =
    filter.mode === "range" && filter.min == null && filter.max != null;
  const active = filter.mode === "exact"
    ? filter.min ?? filter.max ?? copied
    : editsMaximum
      ? filter.max ?? copied
      : filter.min ?? copied;
  const decimalPlaces = [copied, filter.min, filter.max, minimum, maximum]
    .filter((value): value is number => value != null && Number.isFinite(value))
    .reduce((maximumPlaces, value) => {
      const text = Math.abs(value).toString().toLowerCase();
      const [coefficient, exponentText] = text.split("e");
      const exponent = Number(exponentText || 0);
      const fraction = coefficient.split(".")[1]?.length || 0;
      return Math.max(
        maximumPlaces,
        Math.max(0, Math.min(4, fraction - exponent)),
      );
    }, 0);
  const step = 10 ** -decimalPlaces;
  const initial = active ?? minimum ?? 0;
  const [draft, setDraft] = useState(initial);
  const committed = useRef(active);
  const activationSent = useRef(filter.enabled);
  useEffect(() => {
    setDraft(active ?? minimum ?? 0);
    committed.current = active;
    activationSent.current = filter.enabled;
  }, [active, filter.enabled, filter.modifierId, minimum]);
  if (!hasCanonicalBounds || filter.mode === "presence") return null;
  const domainMinimum = minimum as number;
  const domainMaximum = maximum as number;

  const commit = (value: number) => {
    if (!Number.isFinite(value) || committed.current === value) return;
    committed.current = value;
    const valuePatch = filter.mode === "exact"
      ? { min: value, max: value }
      : editsMaximum
        ? { max: value }
        : { min: value };
    onModifierChange(
      filter.modifierId,
      dashboardModifierEditPatch(activationSent.current, valuePatch),
    );
    activationSent.current = true;
  };
  const boundedDraft = Math.min(
    domainMaximum,
    Math.max(domainMinimum, draft),
  );
  return (
    <input
      className="pc-equipment-property-slider"
      type="range"
      min={domainMinimum}
      max={domainMaximum}
      step={step}
      value={boundedDraft}
      aria-label={`${filter.mode === "exact" ? "Exact" : "Minimum"} slider for ${label}`}
      onInput={(event) => {
        const value = Number(event.currentTarget.value);
        setDraft(value);
        if (!activationSent.current) commit(value);
      }}
      onPointerUp={(event) => commit(Number(event.currentTarget.value))}
      onKeyUp={(event) => commit(Number(event.currentTarget.value))}
      onBlur={(event) => commit(Number(event.currentTarget.value))}
    />
  );
}

function ModifierControls({
  session,
  mode,
  rollTolerance,
  showAdvanced,
  onModifierChange,
  onRollToleranceChange,
}: Pick<
  PriceCheckPanelProps,
  | "session"
  | "mode"
  | "rollTolerance"
  | "showAdvanced"
  | "onModifierChange"
  | "onRollToleranceChange"
>) {
  const itemModifiers = new Map(
    (session.item ? priceCheckItemForMode(session.item, mode).modifiers : [])
      .map((modifier) => [modifier.id, modifier]),
  );
  const allFilters = session.query?.filters || [];
  const filters = allFilters.filter(
    (filter) => !filter.advancedOnly || showAdvanced,
  );
  const hasOfficialId = (filter: PriceCheckModifierFilter) =>
    isOfficialPriceCheckFilter(filter);

  if (mode === "base") {
    return (
      <div className="pc-filter-note">
        Modifiers off.
      </div>
    );
  }

  if (!filters.length) {
    return (
      <div className="pc-filter-note">
        No searchable modifiers.
      </div>
    );
  }

  const selectedCount = allFilters.filter((filter) => filter.enabled).length;
  const manualCount = allFilters.filter(
    (filter) => filter.enabled && !hasOfficialId(filter),
  ).length;

  return (
    <div className="pc-modifiers">
      <div className="pc-modifier-heading">
        <div>
          <strong>Search filters</strong>
          <span>
            {selectedCount}/{allFilters.length}
            {manualCount ? ` · ${manualCount} manual` : ""}
          </span>
        </div>
        {mode === "similar" ? (
          <label className="pc-tolerance">
            <span>Roll tolerance</span>
            <output>{rollTolerance}%</output>
            <input
              type="range"
              min="0"
              max="30"
              step="1"
              value={rollTolerance}
              onChange={(event) =>
                onRollToleranceChange(Number(event.currentTarget.value))
              }
              aria-label="Similar roll tolerance"
            />
          </label>
        ) : null}
      </div>

      <div className="pc-modifier-list">
        {filters.map((filter) => {
          const modifier = itemModifiers.get(filter.modifierId);
          const label = filter.label || modifier?.text || filter.modifierId;
          const presenceOnly = isPresenceOnlyPriceCheckFilter(filter, modifier);
          const effectiveMode = presenceOnly ? "presence" : filter.mode;
          return (
            <div
              className={clsx(
                "pc-modifier-row",
                filter.enabled && "is-enabled",
              )}
              key={filter.modifierId}
            >
              <label className="pc-check-control">
                <input
                  type="checkbox"
                  checked={filter.enabled}
                  aria-label={`Include ${label} in the filter plan`}
                  onChange={(event) =>
                    onModifierChange(filter.modifierId, {
                      enabled: event.currentTarget.checked,
                    })
                  }
                />
                <span aria-hidden>
                  <Check size={11} />
                </span>
              </label>
              <div className="pc-modifier-copy">
                <strong title={label}>{label}</strong>
                {showAdvanced ? (
                  <small>
                    {filter.equipmentProperty ? "calculated property" : modifier?.kind || "modifier"} - {filter.importance}
                    {filter.explanation ? ` - ${filter.explanation}` : ""}
                  </small>
                ) : null}
                {modifier?.roomState ? (
                  <em>{modifier.roomState === 1 ? "OPEN ROOM" : "OBSTRUCTED ROOM"}</em>
                ) : null}
                {filter.anointmentOils?.length ? (
                  <em>Oils: {filter.anointmentOils.join(" + ")}</em>
                ) : null}
                {!hasOfficialId(filter) ? (
                  <em>{filter.equipmentProperty ? "NEEDS VALUE" : "MANUAL"}</em>
                ) : null}
                {showAdvanced && modifier?.advanced && modifier.tags.length ? (
                  <em>Tags: {modifier.tags.join(", ")}</em>
                ) : null}
              </div>
              {filter.emptyModifier != null ? (
                <select
                  value={filter.emptyModifier}
                  disabled={!filter.enabled}
                  onChange={(event) => onModifierChange(filter.modifierId, {
                    emptyModifier: Number(event.currentTarget.value) as 0 | 1 | 2,
                  })}
                  aria-label={`Empty modifier type for ${label}`}
                >
                  <option value={0}>Any</option>
                  <option value={1}>Prefix</option>
                  <option value={2}>Suffix</option>
                </select>
              ) : (
                <select
                  value={effectiveMode}
                  disabled={!filter.enabled || presenceOnly}
                  onChange={(event) =>
                    onModifierChange(filter.modifierId, {
                      mode: event.currentTarget.value as PriceCheckModifierFilter["mode"],
                    })
                  }
                  aria-label={`Match mode for ${label}`}
                >
                  {!presenceOnly ? <option value="exact">Exact</option> : null}
                  {!presenceOnly ? <option value="range">Range</option> : null}
                  {!filter.equipmentProperty || presenceOnly ? (
                    <option value="presence">Present</option>
                  ) : null}
                </select>
              )}
              <div className={clsx("pc-modifier-range", `is-${effectiveMode}`)}>
                {effectiveMode === "range" ? (
                  <>
                    <label>
                      <span>Min</span>
                      <EditableNumberInput
                        inputMode="decimal"
                        value={filter.min}
                        minimum={filter.bounds?.min}
                        maximum={filter.bounds?.max}
                        onActivate={() => {
                          if (!filter.enabled) {
                            onModifierChange(filter.modifierId, { enabled: true });
                          }
                        }}
                        placeholder="-∞"
                        onCommit={(value) =>
                          onModifierChange(filter.modifierId, {
                            min: value,
                          })
                        }
                        ariaLabel={`Minimum value for ${label}`}
                      />
                    </label>
                    <label>
                      <span>Max</span>
                      <EditableNumberInput
                        inputMode="decimal"
                        value={filter.max}
                        minimum={filter.bounds?.min}
                        maximum={filter.bounds?.max}
                        onActivate={() => {
                          if (!filter.enabled) {
                            onModifierChange(filter.modifierId, { enabled: true });
                          }
                        }}
                        placeholder="∞"
                        onCommit={(value) =>
                          onModifierChange(filter.modifierId, {
                            max: value,
                          })
                        }
                        ariaLabel={`Maximum value for ${label}`}
                      />
                    </label>
                  </>
                ) : effectiveMode === "exact" ? (
                  <label>
                    <span>Value</span>
                    <EditableNumberInput
                      inputMode="decimal"
                      value={filter.min ?? filter.max}
                      minimum={filter.bounds?.min}
                      maximum={filter.bounds?.max}
                      allowEmpty={false}
                      onActivate={() => {
                        if (!filter.enabled) {
                          onModifierChange(filter.modifierId, { enabled: true });
                        }
                      }}
                      onCommit={(value) => {
                        if (value != null) {
                          onModifierChange(filter.modifierId, {
                            min: value,
                            max: value,
                          });
                        }
                      }}
                      ariaLabel={`Exact value for ${label}`}
                    />
                  </label>
                ) : (
                  <span
                    className="pc-modifier-presence"
                    aria-label={`${label} presence only`}
                  >
                    PRESENT
                  </span>
                )}
                {!presenceOnly ? (
                  <EquipmentPropertySlider
                    filter={filter}
                    label={label}
                    onModifierChange={onModifierChange}
                  />
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ItemStateControls({
  session,
  mode,
  onItemFilterChange,
}: Pick<PriceCheckPanelProps, "session" | "mode" | "onItemFilterChange">) {
  if (!session.item || !session.query) return null;
  const active = session.query.itemFilters;
  const controls = priceCheckItemFilterControls(session.item, {
    exact: mode !== "similar",
    mode,
    itemFilters: active,
  });
  if (!controls.length) return null;
  const isEnabled = (control: (typeof controls)[number]) =>
    control.kind === "identity" ||
    (control.kind === "string" && control.readonly) ||
    Object.hasOwn(active, control.key) ||
    (control.kind === "number-range" && Object.hasOwn(active, control.upperKey));

  return (
    <div className="pc-item-filters">
      <div className="pc-item-filter-heading">
        <strong>Item filters</strong>
        <span>{controls.filter(isEnabled).length}/{controls.length}</span>
      </div>
      <div className="pc-item-filter-grid">
        {controls.map((control) => {
          const enabled = isEnabled(control);
          const readonly = control.kind === "string" && control.readonly;
          const toggle = (checked: boolean) => {
            if (readonly) return;
            if (control.kind === "identity") {
              onItemFilterChange(control.key, checked);
              return;
            }
            onItemFilterChange(
              control.key,
              checked ? control.copiedValue : undefined,
            );
            if (control.kind === "number-range") {
              onItemFilterChange(
                control.upperKey,
                checked ? control.copiedUpperValue : undefined,
              );
            }
          };
          return (
            <div
              className={clsx(
                "pc-item-filter",
                (control.kind === "boolean" || control.kind === "identity" ||
                  control.kind === "string") &&
                  "pc-item-filter--logical",
                control.kind === "number-range" && "pc-item-filter--range",
                readonly && "is-readonly",
                enabled && "is-enabled",
              )}
              key={control.key}
            >
              <label title={readonly ? `${control.label}: ${control.copiedValue}` : undefined}>
                {readonly ? null : <input
                  type="checkbox"
                  checked={control.kind === "identity"
                    ? Boolean(active[control.key] ?? control.copiedValue)
                    : enabled}
                  onChange={(event) => toggle(event.currentTarget.checked)}
                />}
                <span aria-hidden><Check size={10} /></span>
                <strong>{control.label}</strong>
                {control.kind === "string" && control.displayValue
                  ? <small>{control.displayValue}</small>
                  : null}
              </label>
              {control.kind === "number" ? (
                <EditableNumberInput
                  inputMode="numeric"
                  minimum={0}
                  maximum={control.maximum ?? 100}
                  allowEmpty={false}
                  value={Number(active[control.key] ?? control.copiedValue)}
                  disabled={!enabled}
                  ariaLabel={`${control.label} value`}
                  onCommit={(value) => {
                    if (value != null) onItemFilterChange(control.key, value);
                  }}
                />
              ) : control.kind === "number-range" ? (
                <div className="pc-item-filter-range-values">
                  <EditableNumberInput
                    inputMode="numeric"
                    minimum={0}
                    maximum={control.maximum ?? 100}
                    allowEmpty={false}
                    value={Number(active[control.key] ?? control.copiedValue)}
                    disabled={!enabled}
                    ariaLabel={`${control.label} minimum value`}
                    onCommit={(value) => {
                      if (value != null) onItemFilterChange(control.key, value);
                    }}
                  />
                  <span aria-hidden>–</span>
                  <EditableNumberInput
                    inputMode="numeric"
                    minimum={0}
                    maximum={control.maximum ?? 100}
                    allowEmpty={false}
                    value={Number(active[control.upperKey] ?? control.copiedUpperValue)}
                    disabled={!enabled}
                    ariaLabel={`${control.label} maximum value`}
                    onCommit={(value) => {
                      if (value != null) onItemFilterChange(control.upperKey, value);
                    }}
                  />
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function EvidenceList({ session }: { session: PriceCheckSession }) {
  const evidence = session.estimate?.evidence || [];
  if (!evidence.length) return null;

  return (
    <details className="pc-evidence">
      <summary>
        <span>Price evidence</span>
        <small>{evidence.length} source{evidence.length === 1 ? "" : "s"}</small>
      </summary>
      <div className="pc-evidence-list">
        {evidence.map((entry, index) => (
          <article key={`${entry.source}:${entry.label}:${index}`}>
            <span className={clsx("pc-source-dot", entry.stale && "is-stale")} />
            <div>
              <strong>{entry.label}</strong>
              <p>{entry.detail}</p>
            </div>
            <div className="pc-evidence-market">
              <strong>
                {entry.chaosValue == null ? "No value" : formatPrice(entry.chaosValue)}
              </strong>
              {entry.chaosValue != null ? <CurrencyMark unit="chaos" /> : null}
              <small>
                {entry.sampleCount == null
                  ? "sample unknown"
                  : entry.source === "poe-ninja" &&
                      session.matches.find((match) => match.row.key === session.selectedMatchKey)?.row.observationCount == null &&
                      session.matches.find((match) => match.row.key === session.selectedMatchKey)?.row.listingCount == null
                    ? `${entry.sampleCount.toLocaleString()} volume`
                    : `${entry.sampleCount.toLocaleString()} sample${entry.sampleCount === 1 ? "" : "s"}`}
                {entry.ageMs != null
                  ? ` - ${entry.stale ? "stale" : "updated"} ${formatRelativeTime(Date.now() - entry.ageMs)}`
                  : ""}
              </small>
            </div>
          </article>
        ))}
      </div>
    </details>
  );
}

export function PriceCheckPanel(props: PriceCheckPanelProps) {
  const {
    session,
    mode,
    rollTolerance,
    availability,
    hotkey,
    isMobile,
    showAdvanced,
    onCaptureRequested,
    onRetry,
    onModeChange,
    onIdentifyUnique,
    onMatchSelect,
    onModifierChange,
    onItemFilterChange,
    onRollToleranceChange,
    onAvailabilityChange,
    onOpenTrade,
    onCopySummary,
    onWatchMatch,
  } = props;
  const ready = session.status === "ready" && !!session.item;
  const match = selectedMatch(session);
  const icon = match?.row.icon || session.item?.iconHint;
  const waitingForManualTradeSearch = officialTradeNeedsExplicitSearch(session);
  const availableModes = session.item
    ? priceCheckModesForItem(session.item)
    : (["similar"] as const);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");

  if (!ready) {
    return (
      <section className="pc-panel pc-panel--state" aria-live="polite">
      <PriceCheckStatus session={session} isMobile={isMobile} hotkey={hotkey} />
        <div className="pc-state-actions">
          {!isMobile ? (
            <button
              className="pc-button pc-button--primary"
              type="button"
              onClick={session.status === "idle" ? onCaptureRequested : onRetry}
              disabled={session.status === "parsing" || session.status === "resolving"}
            >
              {session.status === "parsing" || session.status === "resolving" ? (
                <span className="pc-state-pulse pc-state-pulse--small" aria-hidden />
              ) : session.status === "idle" ? (
                <Clipboard size={15} aria-hidden />
              ) : (
                <RefreshCw size={15} aria-hidden />
              )}
              {session.status === "idle" ? "Check clipboard" : "Try again"}
            </button>
          ) : null}
        </div>
      </section>
    );
  }

  const filterControls = (
    <div className="pc-filter-controls">
      <div className="pc-mode-tabs" role="group" aria-label="Comparison mode">
        {availableModes.map((value) => (
          <button
            type="button"
            aria-pressed={mode === value}
            className={mode === value ? "is-active" : undefined}
            key={value}
            onClick={() => onModeChange(value)}
          >
            <strong>{modeCopy[value]}</strong>
          </button>
        ))}
      </div>

      <ItemStateControls
        session={session}
        mode={mode}
        onItemFilterChange={onItemFilterChange}
      />

      <ModifierControls
        session={session}
        mode={mode}
        rollTolerance={rollTolerance}
        showAdvanced={showAdvanced}
        onModifierChange={onModifierChange}
        onRollToleranceChange={onRollToleranceChange}
      />

      <div className="pc-availability">
        <strong>SELLERS</strong>
        <div role="group" aria-label="Seller availability">
          {(["available", "securable", "any"] as const).map((value) => (
            <button
              type="button"
              key={value}
              className={availability === value ? "is-active" : undefined}
              aria-pressed={availability === value}
              title={priceCheckAvailabilityDescription(value)}
              onClick={() => onAvailabilityChange(value)}
            >
              {priceCheckAvailabilityLabel(value)}
            </button>
          ))}
        </div>
      </div>
      {session.query?.tradeApi !== "exchange" ? (
        <div className="pc-trade-advanced" aria-label="Trade listing filters">
          <label>
            <span>LISTED</span>
            <select
              aria-label="Listed age"
              value={String(session.query?.itemFilters.listed || "")}
              onChange={(event) => onItemFilterChange(
                "listed",
                event.currentTarget.value || undefined,
              )}
            >
              <option value="">Any time</option>
              <option value="1day">1 day</option>
              <option value="3days">3 days</option>
              <option value="1week">1 week</option>
              <option value="2weeks">2 weeks</option>
              <option value="1month">1 month</option>
              <option value="2months">2 months</option>
            </select>
          </label>
          <label>
            <span>PRICE</span>
            <select
              aria-label="Listing currency"
              value={String(session.query?.itemFilters.tradeCurrency || "")}
              onChange={(event) => onItemFilterChange(
                "tradeCurrency",
                event.currentTarget.value || undefined,
              )}
            >
              <option value="">Any currency</option>
              <option value="chaos">Chaos only</option>
              <option value="divine">Divine only</option>
              <option value="chaos_divine">Chaos + Divine</option>
            </select>
          </label>
        </div>
      ) : null}
    </div>
  );
  const rawWarnings = [
    ...(session.estimate?.warnings || []),
    ...(session.query?.warnings || []),
    ...session.item!.warnings,
  ].filter((warning, index, all) => all.indexOf(warning) === index);
  const hasGenericDisclaimer = rawWarnings.some((warning) => genericWarningCopy.has(warning));
  const specificWarnings = rawWarnings.filter((warning) => !genericWarningCopy.has(warning));
  const officialRows = (session.officialTrade?.listings || [])
    .filter((listing) => listing.price != null)
    .map((listing) => ({
      id: listing.id,
      amount: listing.price!.amount,
      currency: listing.price!.currency,
      indexedAt: listing.indexed,
      seller: listing.seller.account,
      character: listing.seller.character,
      itemName: listing.item.name,
      baseType: listing.item.baseType,
      icon: listing.item.icon,
      whisper: listing.whisper,
      groupedCount: listing.groupedCount,
      stock: listing.stock,
      exchange: listing.exchange ? {
        haveAmount: listing.exchange.haveAmount,
        itemAmount: listing.exchange.itemAmount,
        stock: listing.exchange.stock,
      } : undefined,
    }));

  return (
    <section className="pc-panel" aria-live="polite" aria-atomic="false">
      <UnidentifiedUniqueResolver
        item={session.item!}
        onIdentify={(name) => onIdentifyUnique?.(name)}
      />
      <section className={clsx("pc-item", `is-${session.item!.rarity}`)}>
        <span className="pc-item-icon">
          {icon ? <img src={icon} alt="" /> : <Search size={25} aria-hidden />}
        </span>
        <div className="pc-item-name">
          <span>{session.item!.rarity.replace("-", " ").toUpperCase()}</span>
          <h1 title={itemDisplayName(session)}>{itemDisplayName(session)}</h1>
          <p title={itemSubtitle(session)}>{itemSubtitle(session)}</p>
        </div>
        <dl className="pc-item-facts">
          {session.item!.itemLevel != null ? (
            <div>
              <dt>ILVL</dt>
              <dd>{session.item!.itemLevel}</dd>
            </div>
          ) : null}
          {session.item!.links ? (
            <div>
              <dt>LINKS</dt>
              <dd>{session.item!.links}</dd>
            </div>
          ) : null}
          {session.item!.gemLevel != null ? (
            <div>
              <dt>GEM LVL</dt>
              <dd>{session.item!.gemLevel}</dd>
            </div>
          ) : null}
          {session.item!.mapTier != null ? (
            <div>
              <dt>TIER</dt>
              <dd>{session.item!.mapTier}</dd>
            </div>
          ) : null}
        </dl>
      </section>

      <div className="pc-ready-grid">
        <EstimateCard session={session} />

        <section className="pc-query-card" aria-label="Price check controls">
          <div className="pc-match-field">
            <label htmlFor={`pc-match-${session.id}`}>Market match</label>
            <select
              id={`pc-match-${session.id}`}
              value={match?.row.key || ""}
              onChange={(event) => onMatchSelect(event.currentTarget.value)}
              disabled={!session.matches.length}
              title={match?.reasons.join(". ")}
            >
              {!session.matches.length ? (
                <option value="">No close match found</option>
              ) : null}
              {session.matches.map((candidate) => (
                <option value={candidate.row.key} key={candidate.row.key}>
                  {matchLabel(candidate)} ({Math.round(candidate.score)}%)
                </option>
              ))}
            </select>
          </div>

          {isMobile ? (
            <details className="pc-mobile-filters">
              <summary>
                <span>FILTERS</span>
                <small>{modeCopy[mode]}</small>
              </summary>
              {filterControls}
            </details>
          ) : filterControls}
        </section>

        {session.officialTradeLoading || session.officialTrade ? (
          <CompactTradeListings
            className="pc-official-listings"
            rows={officialRows}
            total={session.officialTrade?.total || 0}
            loading={session.officialTradeLoading}
            stale={session.officialTrade?.stale}
            error={session.officialTrade?.error || undefined}
            onRetry={onRetry}
            onOpenTrade={onOpenTrade}
          />
        ) : null}

        {(session.message ||
          hasGenericDisclaimer ||
          specificWarnings.length ||
          session.sourceStale) ? (
          <section className="pc-warnings" aria-label="Price check warnings">
            <AlertTriangle size={16} aria-hidden />
            <div>
              <strong>Warnings</strong>
              <ul>
                {session.sourceStale ? (
                  <li>Stale market data.</li>
                ) : null}
                {session.message ? <li>{session.message}</li> : null}
                {hasGenericDisclaimer ? (
                  <li>Estimate only — verify on Trade.</li>
                ) : null}
                {specificWarnings.map((warning) => <li key={warning}>{warning}</li>)}
              </ul>
            </div>
          </section>
        ) : null}

        <EvidenceList session={session} />
      </div>

      <div className="pc-panel-actions">
        <button
          className="pc-button pc-button--primary"
          type="button"
          onClick={onOpenTrade}
          disabled={!session.query?.tradeUrl}
          title="Open official Trade with these filters prefilled"
        >
          <ExternalLink size={15} aria-hidden />
          Trade
        </button>
        <button
          className="pc-button"
          type="button"
          aria-label="Copy estimate and active Trade filters"
          onClick={async () => {
            const copied = await onCopySummary();
            setCopyState(copied ? "copied" : "failed");
            window.setTimeout(() => setCopyState("idle"), 1600);
          }}
        >
          {copyState === "copied" ? (
            <Check size={15} aria-hidden />
          ) : copyState === "failed" ? (
            <AlertTriangle size={15} aria-hidden />
          ) : (
            <Copy size={15} aria-hidden />
          )}
          {copyState === "copied"
              ? "Copied"
            : copyState === "failed"
              ? "Copy failed"
              : "Copy"}
        </button>
        {onWatchMatch ? (
          <button
            className="pc-button"
            type="button"
            onClick={onWatchMatch}
            disabled={!match}
          >
            <Star size={15} aria-hidden />
            Market
          </button>
        ) : null}
        <button className="pc-button pc-button--quiet" type="button" onClick={onRetry}>
          {waitingForManualTradeSearch
            ? <Search size={15} aria-hidden />
            : <RefreshCw size={15} aria-hidden />}
          {waitingForManualTradeSearch ? "Search Trade" : "Refresh"}
        </button>
        <span className="pc-freshness" title={session.sourceFetchedAt ? new Date(session.sourceFetchedAt).toLocaleString() : undefined}>
          <i className={session.sourceStale ? "is-stale" : undefined} />
          {session.sourceFetchedAt
            ? `${session.sourceStale ? "Stale" : "Updated"} ${formatRelativeTime(session.sourceFetchedAt)}`
            : session.item?.rarity === "rare" || session.item?.rarity === "magic"
              ? "Trade filters ready"
              : "No update time"}
        </span>
      </div>
    </section>
  );
}
