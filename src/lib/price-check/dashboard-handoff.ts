import {
  buildPriceCheckQueryPlan,
  planPriceCheckFilters,
} from "./query-plan";
import { priceCheckItemForMode } from "./official-trade-workflow";
import {
  sanitizePresenceOnlyPriceCheckFilter,
} from "./trade-stat-id";
import type {
  ClipboardItemCapture,
  PriceCheckDashboardMode,
  PriceCheckDashboardSnapshot,
  PriceCheckModifierFilter,
  PriceCheckSession,
} from "./types";

export function dashboardSnapshotForCapture(
  capture: ClipboardItemCapture,
  preserveChoices = false,
): PriceCheckDashboardSnapshot | null {
  const snapshot = capture.dashboardSnapshot;
  if (
    preserveChoices ||
    !snapshot ||
    !Number.isSafeInteger(capture.captureId) ||
    snapshot.captureId !== capture.captureId ||
    snapshot.capturedAt !== capture.capturedAt ||
    !snapshot.league
  ) {
    return null;
  }
  return snapshot;
}

export function handoffLeague(
  snapshot: PriceCheckDashboardSnapshot | null,
  previous: PriceCheckSession | null,
) {
  if (snapshot?.league) return snapshot.league;
  return previous?.status === "ready" && previous.league
    ? previous.league
    : undefined;
}

export function onlineOnlyAfterSettings(
  defaultOnlineOnly: boolean,
  session: PriceCheckSession,
) {
  return session.query
    ? session.query.status !== "any"
    : defaultOnlineOnly;
}

export function plannedRangeModePatch(
  item: NonNullable<PriceCheckSession["item"]>,
  rollTolerance: number,
  modifierId: string,
  existingBounds?: PriceCheckModifierFilter["bounds"],
): Partial<PriceCheckModifierFilter> | null {
  const planned = planPriceCheckFilters(item, rollTolerance).find(
    (candidate) => candidate.modifierId === modifierId,
  );
  if (!planned) return null;
  return {
    mode: planned.mode,
    min: planned.min,
    max: planned.max,
    bounds: planned.bounds ?? existingBounds,
  };
}

export function sameCaptureDelivery(
  previous: ClipboardItemCapture | null,
  incoming: ClipboardItemCapture,
) {
  if (
    !previous ||
    previous.capturedAt !== incoming.capturedAt ||
    previous.captureId !== incoming.captureId
  ) {
    return false;
  }
  const previousHandoff = previous.dashboardSnapshot?.handoffId;
  const incomingHandoff = incoming.dashboardSnapshot?.handoffId;
  if (previousHandoff != null) {
    return incomingHandoff == null || incomingHandoff <= previousHandoff;
  }
  return incomingHandoff == null;
}

export function filtersFromDashboardSnapshot(
  item: NonNullable<PriceCheckSession["item"]>,
  snapshot: PriceCheckDashboardSnapshot,
) {
  const plannedItem = priceCheckItemForMode(item, snapshot.mode);
  const modifiers = new Map(
    plannedItem.modifiers.map((modifier) => [modifier.id, modifier] as const),
  );
  const edits = new Map(
    snapshot.filters.map((filter) => [filter.modifierId, filter] as const),
  );
  const plannedFilters = buildPriceCheckQueryPlan(item, snapshot.league, {
    mode: snapshot.mode,
    rollTolerance: snapshot.rollTolerance,
    status: snapshot.status,
  }).filters;
  return plannedFilters.map((filter) => {
    const edit = edits.get(filter.modifierId);
    if (!edit) return filter;
    const invalidPropertyPresence = Boolean(
      filter.equipmentProperty && edit.mode === "presence",
    );
    let next: PriceCheckModifierFilter = {
      ...filter,
      enabled: edit.enabled,
      ...(invalidPropertyPresence
        ? {}
        : {
            mode: edit.mode,
            min: edit.min,
            max: edit.max,
          }),
    };
    next = sanitizePresenceOnlyPriceCheckFilter(
      next,
      modifiers.get(filter.modifierId),
    );
    if (next.mode === "presence") {
      delete next.min;
      delete next.max;
    }
    return next;
  });
}

export function dashboardSnapshotFromSession(
  session: PriceCheckSession,
  mode: PriceCheckDashboardMode,
  sourceCapture?: Pick<ClipboardItemCapture, "captureId" | "capturedAt">,
): PriceCheckDashboardSnapshot | undefined {
  const captureId = sourceCapture?.captureId ?? session.captureId;
  const capturedAt = sourceCapture?.capturedAt ?? session.capturedAt;
  if (
    session.status !== "ready" ||
    !Number.isSafeInteger(captureId) ||
    !Number.isSafeInteger(capturedAt) ||
    !session.query
  ) {
    return undefined;
  }
  const modifiers = new Map(
    (session.item ? priceCheckItemForMode(session.item, mode).modifiers : []).map(
      (modifier) => [modifier.id, modifier] as const,
    ),
  );
  return {
    captureId: captureId!,
    capturedAt,
    league: session.league,
    mode,
    identity: session.query.identity,
    status: session.query.status,
    rollTolerance: session.query.rollTolerance,
    filters: session.query.filters.map((filter) => {
      const sanitized = sanitizePresenceOnlyPriceCheckFilter(
        filter,
        modifiers.get(filter.modifierId),
      );
      return {
        modifierId: sanitized.modifierId,
        enabled: sanitized.enabled,
        mode: sanitized.mode,
        ...(sanitized.min != null ? { min: sanitized.min } : {}),
        ...(sanitized.max != null ? { max: sanitized.max } : {}),
      };
    }),
    itemFilters: { ...session.query.itemFilters },
  };
}
