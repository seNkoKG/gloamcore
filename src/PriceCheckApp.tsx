import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { PriceCheckSurface } from "./components/PriceCheckSurface";
import { compactPriceCheckPanelHeight } from "./components/CompactPriceCheckOverlay";
import { categoryById, defaultSource } from "./config/categories";
import type {
  PriceCheckMode,
} from "./components/PriceCheckPanel";
import type { PriceCheckSurfaceView } from "./components/PriceCheckSurface";
import { bridge } from "./lib/bridge";
import { normalizeOverview } from "./lib/economy";
import { formatPrice } from "./lib/format";
import { isMobileApp } from "./lib/platform";
import { loadPreferences } from "./lib/preferences";
import { priceCheckCategoryCandidates } from "./lib/price-check/categories";
import { estimatePriceCheck } from "./lib/price-check/estimator";
import {
  dashboardSnapshotForCapture,
  dashboardSnapshotFromSession,
  filtersFromDashboardSnapshot,
  handoffLeague,
  onlineOnlyAfterSettings,
  plannedRangeModePatch,
  sameCaptureDelivery,
} from "./lib/price-check/dashboard-handoff";
import {
  formatPriceCheckHotkey,
  validatePriceCheckHotkey,
} from "./lib/price-check/hotkey";
import { appendPriceCheckHistory } from "./lib/price-check/history";
import {
  rememberIdentityPresetState,
  restoreIdentityPresetState,
  type PriceCheckIdentityPresetStates,
} from "./lib/price-check/identity-preset-state";
import { isOfficialPriceCheckFilter } from "./lib/price-check/equipment-properties";
import type { PriceCheckAvailability } from "./lib/price-check/availability";
import {
  defaultOfficialTradeStatusForItem,
  defaultPriceCheckModeForItem,
  priceCheckItemForMode,
  priceCheckModesForItem,
} from "./lib/price-check/official-trade-workflow";
import {
  isPresenceOnlyPriceCheckFilter,
  sanitizePresenceOnlyPriceCheckFilter,
} from "./lib/price-check/trade-stat-id";
import { parsePoeItem, isPoeItemText } from "./lib/price-check/parser";
import {
  buildPriceCheckQueryPlan,
  planPriceCheckFilters,
} from "./lib/price-check/query-plan";
import { resolvePriceCheckMatches } from "./lib/price-check/resolver";
import {
  hydrateTradeStatIds,
  loadTradeStatCatalog,
  tradeStatCatalogDiagnostic,
} from "./lib/price-check/stat-catalog";
import {
  uniqueIdentityProfile,
  uniqueIdentityProfilesForBase,
} from "./lib/price-check/magic-base-type";
import {
  clearPriceCheckHistory,
  loadPriceCheckHistory,
  schedulePriceCheckHistorySave,
  savePriceCheckHistory,
} from "./lib/price-check/storage";
import {
  defaultPriceCheckSettings,
  type ClipboardItemCapture,
  type PriceCheckHistoryEntry,
  type PriceCheckModifierFilter,
  type PriceCheckSession,
  type PriceCheckSettings,
} from "./lib/price-check/types";
import { reconcileSettingsSnapshot } from "./lib/settings-sync";
import { defaultDesktopShortcuts } from "./lib/shortcuts";
import type {
  EconomyRow,
  PriceCheckOverlayPanel,
  PriceCheckOverlayState,
} from "./types";

interface PriceCheckAppProps {
  embedded?: boolean;
  leagueOverride?: string;
  onClose?: () => void;
}

interface LoadedRows {
  rows: EconomyRow[];
  fetchedAt: number;
  stale: boolean;
}

interface OverlayPanelDrag {
  pointerId: number;
  captureId: number;
  startClientX: number;
  startClientY: number;
  startPanel: PriceCheckOverlayPanel;
  lastX: number;
  lastY: number;
  moved: boolean;
  frame: number | null;
}

const AUTO_REFRESH_MS = 15 * 60 * 1000;
const STALE_MARKET_MS = 2 * 60 * 60 * 1000;
const INACTIVE_OVERLAY_STATE: PriceCheckOverlayState = {
  revision: 0,
  active: false,
  attached: false,
  targetActive: false,
  interactive: false,
  shapeApplied: false,
  panel: null,
};

function validOverlayPanel(value: unknown): value is PriceCheckOverlayPanel {
  if (!value || typeof value !== "object") return false;
  const panel = value as Partial<PriceCheckOverlayPanel>;
  return (
    Number.isFinite(panel.x) &&
    Number.isFinite(panel.y) &&
    Number.isFinite(panel.width) &&
    Number.isFinite(panel.height) &&
    Number(panel.width) > 0 &&
    Number(panel.height) > 0
  );
}

function normalizeOverlayState(value: PriceCheckOverlayState) {
  return {
    revision: Number.isFinite(value?.revision)
      ? Math.max(0, Math.round(value.revision))
      : 0,
    active: Boolean(value?.active),
    attached: Boolean(value?.attached),
    targetActive: Boolean(value?.targetActive),
    interactive: Boolean(value?.interactive),
    shapeApplied: Boolean(value?.shapeApplied),
    panel: validOverlayPanel(value?.panel)
      ? {
          x: Math.round(value.panel.x),
          y: Math.round(value.panel.y),
          width: Math.round(value.panel.width),
          height: Math.round(value.panel.height),
        }
      : null,
    message:
      typeof value?.message === "string"
        ? value.message.replace(/\0/g, "").slice(0, 240)
        : undefined,
  } satisfies PriceCheckOverlayState;
}

function sessionId(capturedAt = Date.now()) {
  const random =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2);
  return `${capturedAt}-${random}`;
}

function idleSession(league = "", captureId?: number): PriceCheckSession {
  return {
    id: "idle",
    capturedAt: Date.now(),
    captureId,
    league,
    status: "idle",
    item: null,
    matches: [],
    estimate: null,
    query: null,
    sourceStale: false,
  };
}

async function writeText(value: string) {
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    let textarea: HTMLTextAreaElement | null = null;
    try {
      textarea = document.createElement("textarea");
      textarea.value = value;
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.select();
      const copied = document.execCommand("copy");
      return copied;
    } catch {
      return false;
    } finally {
      textarea?.remove();
    }
  }
}

function sourceFreshness(groups: LoadedRows[], rowKey?: string) {
  const matched = rowKey
    ? groups.find((group) => group.rows.some((row) => row.key === rowKey))
    : undefined;
  const relevant = matched ? [matched] : groups;
  return {
    fetchedAt: relevant.length
      ? Math.max(...relevant.map((group) => group.fetchedAt))
      : undefined,
    stale: relevant.length > 0 && relevant.every((group) => group.stale),
  };
}

type PriceCheckSettingKey = keyof PriceCheckSettings;

const PRICE_CHECK_WARMUP_CATEGORY_IDS = [
  "currency",
  "divination-cards",
  "unique-armours",
  "skill-gems",
  "maps",
  "base-types",
] as const;

export default function PriceCheckApp({
  embedded = false,
  leagueOverride,
  onClose,
}: PriceCheckAppProps) {
  const desktopOverlay = !embedded && !isMobileApp;
  const [session, setSession] = useState<PriceCheckSession>(() =>
    idleSession(leagueOverride || loadPreferences().league || ""),
  );
  const [settings, setSettings] = useState<PriceCheckSettings>(
    defaultPriceCheckSettings,
  );
  const [history, setHistory] = useState<PriceCheckHistoryEntry[]>(
    loadPriceCheckHistory,
  );
  const [mode, setMode] = useState<PriceCheckMode>("similar");
  const [view, setView] = useState<PriceCheckSurfaceView>("check");
  const [pinned, setPinned] = useState(false);
  const [onlineOnly, setOnlineOnly] = useState(true);
  const [manualText, setManualText] = useState("");
  const [manualError, setManualError] = useState("");
  const [hotkeyError, setHotkeyError] = useState("");
  const [tradePriceRefresh, setTradePriceRefresh] = useState(0);
  const [overlayState, setOverlayState] = useState<PriceCheckOverlayState>(
    INACTIVE_OVERLAY_STATE,
  );
  const overlayRevision = useRef(0);
  const overlayClosing = useRef(false);
  const overlayPanelDrag = useRef<OverlayPanelDrag | null>(null);
  const overlayDialog = useRef<HTMLDivElement>(null);
  const requestId = useRef(0);
  const tradePriceRequestId = useRef(0);
  const forceTradePriceRefresh = useRef(false);
  const sessionRef = useRef(session);
  const leagueRef = useRef(session.league);
  const settingsRef = useRef(settings);
  const savedSettingsRef = useRef(settings);
  const settingsRevisionRef = useRef(-1);
  const desktopShortcutsRef = useRef({ ...defaultDesktopShortcuts });
  const settingsMountedRef = useRef(true);
  const settingsSaveChain = useRef<Promise<void>>(Promise.resolve());
  const settingsSaveRevision = useRef(0);
  const pendingSettingRevisions = useRef(
    new Map<PriceCheckSettingKey, number>(),
  );
  const historyRef = useRef(history);
  const modeRef = useRef<PriceCheckMode>(mode);
  const identityPresetStates = useRef<PriceCheckIdentityPresetStates>({});
  const onlineOnlyRef = useRef(onlineOnly);
  const lastCapture = useRef<ClipboardItemCapture | null>(null);
  const sourceCaptureIdentity = useRef<
    Pick<ClipboardItemCapture, "captureId" | "capturedAt"> | undefined
  >(undefined);
  const loadedGroups = useRef<LoadedRows[]>([]);
  const lastRefreshAttempt = useRef(0);
  const leagueRequest = useRef<Promise<Awaited<ReturnType<typeof bridge.getLeagues>>> | null>(null);
  const warmedLeague = useRef("");

  const tradePriceQueryKey =
    session.status === "ready" &&
    session.query?.tradeApi !== "exchange" &&
    session.league
      ? JSON.stringify({
          league: session.league,
          tradeQuery: session.query?.tradeQuery,
        })
      : "";

  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);
  useEffect(() => {
    // The price-check renderer stays mounted while hidden. Warm and verify the
    // local Awakened stat pack here so the first Ctrl+D never pays that cost.
    void loadTradeStatCatalog().then(() => {
      document.documentElement.dataset.tradeStatCatalog = tradeStatCatalogDiagnostic();
    });
  }, []);
  useEffect(() => {
    settingsMountedRef.current = true;
    return () => {
      settingsMountedRef.current = false;
      const drag = overlayPanelDrag.current;
      if (drag?.frame != null) window.cancelAnimationFrame(drag.frame);
      overlayPanelDrag.current = null;
    };
  }, []);
  useEffect(() => {
    sessionRef.current = session;
  }, [session]);
  useEffect(() => {
    historyRef.current = history;
  }, [history]);
  useEffect(() => {
    if (!desktopOverlay) return;
    const subscribe = bridge.onPriceCheckOverlayState;
    if (!subscribe) return;
    let active = true;
    const applyOverlayState = (value: PriceCheckOverlayState) => {
      if (!active) return;
      const next = normalizeOverlayState(value);
      if (next.revision < overlayRevision.current) return;
      // X removes the card immediately. Ignore any already-queued active state
      // until native deactivation acknowledges the close, otherwise a stale
      // geometry event can remount the panel for one frame.
      if (overlayClosing.current && next.active) return;
      if (!next.active) {
        overlayClosing.current = false;
        const drag = overlayPanelDrag.current;
        if (drag?.frame != null) window.cancelAnimationFrame(drag.frame);
        overlayPanelDrag.current = null;
      }
      overlayRevision.current = next.revision;
      setOverlayState(next);
    };
    const unsubscribe = subscribe((value) => {
      applyOverlayState(value);
    });
    void bridge.getPriceCheckOverlayState?.().then((value) => {
      applyOverlayState(value);
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [desktopOverlay]);
  useEffect(() => {
    if (!desktopOverlay || !overlayState.active || !overlayState.interactive) return;
    const frame = window.requestAnimationFrame(() => {
      overlayDialog.current?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [desktopOverlay, overlayState.active, overlayState.interactive]);
  const desiredOverlayPanelHeight = compactPriceCheckPanelHeight(
    session,
    mode,
  );
  useEffect(() => {
    if (!desktopOverlay || !overlayState.active || !overlayState.panel) return;
    if (!Number.isSafeInteger(session.captureId)) return;
    // Keep the current card steady while a replacement Ctrl+D capture is in
    // flight. Collapsing a visible result to the 72px CHECKING shell and then
    // expanding it again creates a native setShape focus transition on some
    // packaged Windows builds, as well as a visible flash between items.
    if (session.status === "parsing" || session.status === "resolving") return;
    if (Math.abs(overlayState.panel.height - desiredOverlayPanelHeight) < 1) return;
    void bridge.surfaceAction({
      type: "set-price-check-panel-height",
      height: desiredOverlayPanelHeight,
      captureId: session.captureId!,
    }).catch(() => undefined);
  }, [
    desktopOverlay,
    desiredOverlayPanelHeight,
    overlayState.active,
    overlayState.panel?.height,
    session.captureId,
    session.status,
  ]);
  useEffect(() => {
    if (!leagueOverride) return;
    leagueRef.current = leagueOverride;
    setSession((current) => ({ ...current, league: leagueOverride }));
  }, [leagueOverride]);

  useEffect(() => {
    let active = true;
    const applyRemoteSettings = (value: Awaited<ReturnType<typeof bridge.getSettings>>) => {
      if (!active) return;
      desktopShortcutsRef.current = {
        ...defaultDesktopShortcuts,
        ...(value.shortcuts || {}),
      };
      const remote = {
        ...defaultPriceCheckSettings,
        ...(value.priceCheck || {}),
      };
      const previousAuthoritative = savedSettingsRef.current;
      const initialSettingsSnapshot = settingsRevisionRef.current < 0;
      const reconciliation = reconcileSettingsSnapshot({
        authoritative: savedSettingsRef.current,
        authoritativeRevision: settingsRevisionRef.current,
        incoming: remote,
        incomingRevision: value.settingsRevision,
        local: settingsRef.current,
        pendingKeys: pendingSettingRevisions.current.keys(),
      });
      if (!reconciliation.accepted) return;
      savedSettingsRef.current = reconciliation.authoritative;
      settingsRevisionRef.current = reconciliation.authoritativeRevision;
      const next = reconciliation.visible;
      settingsRef.current = next;
      setSettings(next);
      setHotkeyError(validatePriceCheckHotkey(
        next.hotkey,
        next.enabled ? desktopShortcutsRef.current : undefined,
      ));
      if (
        !pendingSettingRevisions.current.has("pinByDefault") &&
        (initialSettingsSnapshot ||
          previousAuthoritative.pinByDefault !==
            reconciliation.authoritative.pinByDefault)
      ) {
        setPinned(next.pinByDefault);
      }
      if (!pendingSettingRevisions.current.has("defaultOnlineOnly")) {
        const nextOnlineOnly = onlineOnlyAfterSettings(
          next.defaultOnlineOnly,
          sessionRef.current,
        );
        setOnlineOnly(nextOnlineOnly);
        onlineOnlyRef.current = nextOnlineOnly;
      }
    };
    const unsubscribeSettings = bridge.onSettingsChanged(applyRemoteSettings);
    bridge
      .getSettings()
      .then(applyRemoteSettings)
      .catch(() => {
        // Safe defaults keep the checker usable in a browser preview.
      });
    if (!leagueOverride) {
      const pendingLeagues = bridge.getLeagues();
      leagueRequest.current = pendingLeagues;
      void pendingLeagues
        .then((envelope) => {
          if (!active) return;
          const preferred = loadPreferences().league;
          const league =
            envelope.data.find((entry) => entry.id === preferred)?.id ||
            envelope.data[0]?.id ||
            "";
          leagueRef.current = league;
          setSession((current) => ({ ...current, league }));
        })
        .catch(() => {
          // A later check retries league resolution with a visible error.
        })
        .finally(() => {
          if (leagueRequest.current === pendingLeagues) leagueRequest.current = null;
        });
    }
    return () => {
      active = false;
      unsubscribeSettings();
    };
  }, [leagueOverride]);

  const resolveLeague = useCallback(async (force = false) => {
    if (leagueOverride) return leagueOverride;
    const preferred = loadPreferences().league;
    if (leagueRef.current && !force && (!preferred || preferred === leagueRef.current)) {
      return leagueRef.current;
    }
    const pendingLeagues = force
      ? bridge.getLeagues({ force: true })
      : leagueRequest.current || bridge.getLeagues();
    leagueRequest.current = pendingLeagues;
    let envelope: Awaited<typeof pendingLeagues>;
    try {
      envelope = await pendingLeagues;
    } finally {
      if (leagueRequest.current === pendingLeagues) leagueRequest.current = null;
    }
    const league =
      envelope.data.find((entry) => entry.id === preferred)?.id ||
      envelope.data[0]?.id ||
      "";
    if (!league) throw new Error("No active Path of Exile 1 economy league is available.");
    leagueRef.current = league;
    return league;
  }, [leagueOverride]);

  useEffect(() => {
    if (!desktopOverlay) return;
    let active = true;
    void resolveLeague().then(async (league) => {
      if (!active || !league || warmedLeague.current === league) return;
      warmedLeague.current = league;
      for (let index = 0; index < PRICE_CHECK_WARMUP_CATEGORY_IDS.length; index += 2) {
        const requests = PRICE_CHECK_WARMUP_CATEGORY_IDS.slice(index, index + 2)
          .map((categoryId) => categoryById[categoryId])
          .filter(Boolean)
          .map((category) => bridge.getOverview({
            league,
            type: category.apiType,
            source: defaultSource(category),
          }).catch(() => undefined));
        await Promise.all(requests);
        if (!active) return;
      }
    }).catch(() => undefined);
    return () => {
      active = false;
    };
  }, [desktopOverlay, resolveLeague]);

  useEffect(() => {
    const getSnapshot = bridge.getTradePriceSnapshot;
    if (!desktopOverlay || !getSnapshot || !tradePriceQueryKey) return;
    const targetSessionId = session.id;
    const targetLeague = session.league;
    const targetQuery = session.query!.tradeQuery;
    const generation = ++tradePriceRequestId.current;
    const force = forceTradePriceRefresh.current;
    forceTradePriceRefresh.current = false;
    let active = true;
    setSession((current) => current.id === targetSessionId
      ? {
          ...current,
          tradePriceSnapshot: undefined,
          tradePriceLoading: true,
        }
      : current);
    const timer = window.setTimeout(() => {
      void getSnapshot({
        league: targetLeague,
        tradeQuery: targetQuery,
        force,
      }).then((snapshot) => {
        if (!active || generation !== tradePriceRequestId.current) return;
        setSession((current) =>
          current.id === targetSessionId &&
          JSON.stringify({
            league: current.league,
            tradeQuery: current.query?.tradeQuery,
          }) === tradePriceQueryKey
            ? {
                ...current,
                tradePriceSnapshot: snapshot,
                tradePriceLoading: false,
              }
            : current,
        );
      }).catch((reason) => {
        if (!active || generation !== tradePriceRequestId.current) return;
        setSession((current) => current.id === targetSessionId
          ? {
              ...current,
              tradePriceSnapshot: {
                listings: [],
                total: 0,
                searchId: "",
                fetchedAt: Date.now(),
                cached: false,
                error: reason instanceof Error ? reason.message : String(reason),
              },
              tradePriceLoading: false,
            }
          : current);
      });
    }, 350);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [desktopOverlay, tradePriceQueryKey, tradePriceRefresh]);

  const checkText = useCallback(
    async (
      capture: ClipboardItemCapture,
      force = false,
      recordHistory = true,
      preserveChoices = false,
      refreshLeague = false,
    ) => {
      const currentRequest = ++requestId.current;
      const dashboardSnapshot = embedded
        ? dashboardSnapshotForCapture(capture, preserveChoices)
        : null;
      if (dashboardSnapshot?.handoffId != null) {
        void bridge.surfaceAction({
          type: "consume-price-check-dashboard-handoff",
          captureId: dashboardSnapshot.captureId,
          handoffId: dashboardSnapshot.handoffId,
        }).catch(() => undefined);
      }
      if (
        Number.isSafeInteger(capture.captureId) &&
        (!preserveChoices ||
          sourceCaptureIdentity.current?.captureId !== capture.captureId)
      ) {
        sourceCaptureIdentity.current = {
          captureId: capture.captureId,
          capturedAt: dashboardSnapshot?.capturedAt ?? capture.capturedAt,
        };
      } else if (!preserveChoices && !Number.isSafeInteger(capture.captureId)) {
        sourceCaptureIdentity.current = undefined;
      }
      const previous = preserveChoices ? sessionRef.current : null;
      const preservedLeague = handoffLeague(dashboardSnapshot, previous);
      const restorePrevious = (reason: unknown) => {
        if (previous?.status !== "ready" || currentRequest !== requestId.current) {
          return false;
        }
        const detail = reason instanceof Error ? reason.message : String(reason);
        const now = Date.now();
        setSession({
          ...previous,
          sourceStale: true,
          estimate:
            previous.item && previous.matches.length
              ? estimatePriceCheck(previous.item, previous.matches, {
                  now,
                  league: previous.league,
                  sourceFetchedAt: previous.sourceFetchedAt,
                  sourceStale: true,
                  history: historyRef.current,
                  selectedMatchKey: previous.selectedMatchKey,
                })
              : previous.estimate,
          message: `Live refresh failed (${detail}). The previous result and your filter choices remain visible.`,
        });
        return true;
      };
      lastRefreshAttempt.current = Date.now();
      lastCapture.current = capture;
      const id = sessionId(capture.capturedAt);
      const initialLeague = preservedLeague || leagueRef.current || previous?.league || "";
      // Match Awakened's event path: parse and reveal the copied item before
      // waiting on league discovery or market/stat hydration. A cold league
      // request must never make a valid capture look like an unresponsive key.
      //
      // A stalled or foreign clipboard read must also never replace the
      // previous card. Awakened simply keeps whatever the panel was showing,
      // so parity mode stays silent here; only the legacy 2.2.x escape hatch
      // paints the fail-closed card.
      if (!capture.text.trim() || !capture.validPrefix || !isPoeItemText(capture.text)) {
        if (currentRequest !== requestId.current) return;
        if (!settingsRef.current.legacyBehavior) return;
        setView("check");
        setSession({
          ...idleSession(initialLeague, capture.captureId),
          id,
          capturedAt: capture.capturedAt,
          status: "invalid",
          message:
            `No complete English PoE item was copied. Hover an item and press ${formatPriceCheckHotkey(settingsRef.current.hotkey)} again.`,
        });
        return;
      }

      setView("check");
      setSession({
        ...idleSession(initialLeague, capture.captureId),
        id,
        capturedAt: capture.capturedAt,
        status: "parsing",
      });

      const parsedItem = parsePoeItem(capture.text);
      if (!parsedItem.valid) {
        if (currentRequest !== requestId.current) return;
        setSession({
          ...idleSession(initialLeague, capture.captureId),
          id,
          capturedAt: capture.capturedAt,
          status: "invalid",
          item: parsedItem,
          message: parsedItem.errors[0] || "The copied item could not be read safely.",
        });
        return;
      }

      setSession({
        ...idleSession(initialLeague, capture.captureId),
        id,
        capturedAt: capture.capturedAt,
        status: "resolving",
        item: parsedItem,
      });
      const hydrationPromise = hydrateTradeStatIds(parsedItem).then(
        (item) => ({ ok: true as const, item }),
        (error) => ({ ok: false as const, error }),
      );
      const league = await (
        preservedLeague
          ? Promise.resolve(preservedLeague)
          : resolveLeague(refreshLeague)
      ).catch((reason) => {
        if (!restorePrevious(reason) && currentRequest === requestId.current) {
          setSession({
            ...idleSession("", capture.captureId),
            id: sessionId(capture.capturedAt),
            capturedAt: capture.capturedAt,
            status: "error",
            message: reason instanceof Error ? reason.message : String(reason),
          });
        }
        return "";
      });
      if (!league || currentRequest !== requestId.current) return;
      setSession((current) => current.id === id
        ? { ...current, league }
        : current);
      await Promise.resolve();

      try {
        const hydration = await hydrationPromise;
        if (!hydration.ok) throw hydration.error;
        const hydratedItem = hydration.item;
        const uniqueCandidates =
          hydratedItem.rarity === "unique" &&
          !hydratedItem.identified &&
          !uniqueIdentityProfile(hydratedItem.name, hydratedItem)
            ? uniqueIdentityProfilesForBase(
                hydratedItem.baseType || hydratedItem.name,
                hydratedItem,
              )
            : [];
        // Awakened resolves a sole unidentified unique candidate immediately;
        // ambiguous bases remain base-only until the user picks an identity.
        const item = uniqueCandidates.length === 1
          ? {
              ...hydratedItem,
              name: uniqueCandidates[0].name,
              baseType: uniqueCandidates[0].baseType,
              iconHint: uniqueCandidates[0].icon || hydratedItem.iconHint,
            }
          : hydratedItem;
        if (currentRequest !== requestId.current) return;
        const currentSettings = settingsRef.current;
        const currentMode = modeRef.current;
        const sameItem = previous?.item?.rawText === item.rawText;
        const previousQuery = sameItem ? previous?.query : undefined;
        const availableModes = priceCheckModesForItem(item);
        const requestedMode = dashboardSnapshot?.mode ??
          (sameItem ? currentMode : defaultPriceCheckModeForItem(item));
        const captureMode = availableModes.includes(requestedMode)
          ? requestedMode
          : defaultPriceCheckModeForItem(item);
        if (captureMode !== currentMode || dashboardSnapshot) {
          modeRef.current = captureMode;
          setMode(captureMode);
        }
        if (dashboardSnapshot) {
          const snapshotOnlineOnly = dashboardSnapshot.status !== "any";
          onlineOnlyRef.current = snapshotOnlineOnly;
          setOnlineOnly(snapshotOnlineOnly);
        }
        const captureFilters = dashboardSnapshot
          ? filtersFromDashboardSnapshot(item, dashboardSnapshot)
          : sameItem
            ? previousQuery?.filters
            : undefined;
        const captureTolerance = dashboardSnapshot?.rollTolerance ??
          previousQuery?.rollTolerance ??
          currentSettings.rollTolerance;
        const query = buildPriceCheckQueryPlan(item, league, {
          rollTolerance: captureTolerance,
          mode: captureMode,
          status:
            dashboardSnapshot?.status ??
            previousQuery?.status ??
            defaultOfficialTradeStatusForItem(item, onlineOnlyRef.current),
          identity:
            dashboardSnapshot?.identity ??
            previousQuery?.identity ??
            (captureMode === "base" ? "base" : "exact"),
          filters: captureFilters,
          itemFilters:
            dashboardSnapshot?.itemFilters ??
            previousQuery?.itemFilters,
        });
        if (!sameItem) identityPresetStates.current = {};
        identityPresetStates.current = rememberIdentityPresetState(
          identityPresetStates.current,
          captureMode,
          query.itemFilters,
        );
        const readyBase: PriceCheckSession = {
          ...idleSession(league, capture.captureId),
          id,
          capturedAt: capture.capturedAt,
          status: "ready",
          item,
          matches: [],
          estimate: null,
          query,
          sourceStale: false,
        };
        const rememberResult = (
          estimate: PriceCheckHistoryEntry["estimate"],
          selectedMatchKey?: string,
        ) => {
          if (!recordHistory || !currentSettings.rememberHistory) return;
          const entry: PriceCheckHistoryEntry = {
            id,
            checkedAt: capture.capturedAt,
            league,
            item,
            estimate,
            selectedMatchKey,
          };
          const next = appendPriceCheckHistory(
            historyRef.current,
            entry,
            currentSettings.maxHistory,
          );
          historyRef.current = next;
          setHistory(next);
          // Do not serialize and synchronously write the complete history in
          // the same task that reveals a freshly captured item. Awakened's
          // quick panel paints before ancillary persistence work.
          schedulePriceCheckHistorySave(next);
        };
        if (item.rarity === "rare" || item.rarity === "magic") {
          const estimate: PriceCheckHistoryEntry["estimate"] = {
            chaosValue: null,
            divineValue: null,
            lowChaos: null,
            highChaos: null,
            confidence: "none",
            confidenceScore: 0,
            label: "no reliable estimate",
            reasons: ["Rolled rare and magic items require modifier-level comparison."],
            warnings: ["Verify current listings on the official Trade page."],
            evidence: [],
          };
          setSession({ ...readyBase, estimate });
          rememberResult(estimate);
          return;
        }
        setSession(readyBase);
        const candidates = priceCheckCategoryCandidates(item);
        const publishEstimate = (groups: LoadedRows[], final: boolean) => {
          const matches = resolvePriceCheckMatches(
            item,
            groups.map((group) => group.rows),
          );
          const selectedMatchKey =
            sameItem && previous?.selectedMatchKey &&
            matches.some((match) => match.row.key === previous.selectedMatchKey)
              ? previous.selectedMatchKey
              : matches[0]?.row.key;
          const freshness = sourceFreshness(groups, selectedMatchKey);
          const estimate = estimatePriceCheck(item, matches, {
            league,
            sourceFetchedAt: freshness.fetchedAt,
            sourceStale: freshness.stale,
            history: historyRef.current,
            selectedMatchKey,
          });
          setSession((current) =>
            current.id === id
              ? {
                  ...current,
                  matches,
                  selectedMatchKey,
                  estimate,
                  sourceFetchedAt: freshness.fetchedAt,
                  sourceStale: freshness.stale,
                  message:
                    final && matches.length === 0
                      ? "No direct poe.ninja market row matched; review the comparison on official Trade."
                      : undefined,
                }
              : current,
          );
          return { estimate, selectedMatchKey };
        };
        const groups: LoadedRows[] = [];
        const settled = await Promise.allSettled(
          candidates.map(async ({ category, source }) => {
            const envelope = await bridge.getOverview({
              league,
              type: category.apiType,
              source,
              force,
            });
            const normalized = normalizeOverview(envelope.data, source, category);
            const group = {
              rows: normalized.rows,
              fetchedAt: envelope.fetchedAt,
              stale: envelope.stale,
            };
            groups.push(group);
            if (
              currentRequest === requestId.current &&
              groups.length < candidates.length
            ) {
              // Awakened reveals each arriving source instead of waiting for
              // the slowest one; paint partial matches as they land.
              publishEstimate(groups, false);
            }
            return group;
          }),
        );
        const successful = settled.flatMap((result) =>
          result.status === "fulfilled" ? [result.value] : [],
        );
        if (!successful.length) {
          const reason = settled.find((result) => result.status === "rejected");
          throw reason && reason.status === "rejected"
            ? reason.reason
            : new Error("No matching economy source is available.");
        }
        if (currentRequest !== requestId.current) return;
        loadedGroups.current = groups;
        const { estimate, selectedMatchKey } = publishEstimate(groups, true);
        rememberResult(estimate, selectedMatchKey);
      } catch (reason) {
        if (currentRequest !== requestId.current) return;
        if (restorePrevious(reason)) return;
        setSession((current) => {
          if (current.id === id && current.item && current.query) {
            return {
              ...current,
              status: "ready",
              message: "Market reference unavailable.",
            };
          }
          return {
            ...idleSession(league, capture.captureId),
            id,
            capturedAt: capture.capturedAt,
            status: "error",
            item: parsedItem,
            message:
              reason instanceof Error
                ? reason.message
                : "Price check failed.",
          };
        });
      }
    },
    [embedded, resolveLeague],
  );

  useEffect(() => {
    let active = true;
    const unsubscribe = bridge.onPriceCheckCapture((capture) => {
      if (sameCaptureDelivery(lastCapture.current, capture)) return;
      setPinned(settingsRef.current.pinByDefault);
      void checkText(capture);
    });
    void bridge.getPendingPriceCheckCapture().then((capture) => {
      if (
        active &&
        capture &&
        !sameCaptureDelivery(lastCapture.current, capture)
      ) {
        setPinned(settingsRef.current.pinByDefault);
        void checkText(capture);
      }
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [checkText]);

  useEffect(() => {
    // The native price checker remains mounted while hidden so Ctrl+D can
    // reopen instantly, but it must not retain even the minute refresh timer
    // while the shaped in-game panel is inactive.
    if (desktopOverlay && !overlayState.active) return;
    let active = true;
    let refreshing = false;
    const tick = () => {
      const now = Date.now();
      if (
        document.visibilityState !== "visible" ||
        (desktopOverlay && !overlayState.active)
      ) return;
      setSession((current) => {
        if (current.status !== "ready" || !current.item || !current.sourceFetchedAt) {
          return current;
        }
        const sourceAge = now - current.sourceFetchedAt;
        const stale =
          current.sourceStale ||
          !Number.isFinite(sourceAge) ||
          sourceAge < 0 ||
          sourceAge > STALE_MARKET_MS;
        return {
          ...current,
          sourceStale: stale,
          estimate: current.matches.length
            ? estimatePriceCheck(current.item, current.matches, {
                now,
                league: current.league,
                sourceFetchedAt: current.sourceFetchedAt,
                sourceStale: stale,
                history: historyRef.current,
                selectedMatchKey: current.selectedMatchKey,
              })
            : current.estimate,
        };
      });

      if (
        refreshing ||
        !lastCapture.current ||
        now - lastRefreshAttempt.current < AUTO_REFRESH_MS
      ) return;

      refreshing = true;
      const capture = {
        ...lastCapture.current,
        capturedAt: now,
      };
      void (async () => {
        try {
          if (active) await checkText(capture, true, false, true, !leagueOverride);
        } finally {
          refreshing = false;
        }
      })();
    };

    const interval = window.setInterval(tick, 60_000);
    document.addEventListener("visibilitychange", tick);
    tick();
    return () => {
      active = false;
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [checkText, desktopOverlay, leagueOverride, overlayState.active, resolveLeague]);

  const rebuildQuery = useCallback(
    (
      nextMode: PriceCheckMode,
      options: {
        online?: boolean;
        status?: PriceCheckAvailability;
        tolerance?: number;
        filters?: PriceCheckModifierFilter[];
        resetFilters?: boolean;
        itemFilters?: Record<string, string | number | boolean>;
      } = {},
    ) => {
      setSession((current) => {
        if (!current.item) return current;
        const tolerance = options.tolerance ?? settingsRef.current.rollTolerance;
        const plannedItem = priceCheckItemForMode(current.item, nextMode);
        const plannedFilters = planPriceCheckFilters(plannedItem, tolerance);
        let filters = options.filters;
        if (!filters && !options.resetFilters && current.query?.filters) {
          filters = current.query.filters.map((filter) => {
            if (options.tolerance == null || filter.mode !== "range") return filter;
            const planned = plannedFilters.find(
              (candidate) => candidate.modifierId === filter.modifierId,
            );
            return planned
              ? {
                  ...filter,
                  mode: planned.mode,
                  min: planned.min,
                  max: planned.max,
                  bounds: planned.bounds ?? filter.bounds,
                  explanation: planned.explanation,
                }
              : filter;
          });
        }
        if (!options.resetFilters) filters ||= plannedFilters;
        const query = buildPriceCheckQueryPlan(current.item, current.league, {
          rollTolerance: tolerance,
          mode: nextMode,
          status: options.status ?? (options.online == null
            ? current.query?.status
            : options.online
              ? defaultOfficialTradeStatusForItem(current.item)
              : "any"),
          identity: nextMode === "base" ? "base" : "exact",
          filters,
          itemFilters: options.itemFilters ??
            (options.resetFilters ? undefined : current.query?.itemFilters),
        });
        return {
          ...current,
          query,
        };
      });
    },
    [],
  );

  const close = () => {
    if (onClose) {
      onClose();
      return;
    }
    if (desktopOverlay) {
      overlayClosing.current = true;
      const drag = overlayPanelDrag.current;
      if (drag?.frame != null) window.cancelAnimationFrame(drag.frame);
      overlayPanelDrag.current = null;
      // Remove the card in this paint instead of waiting for the IPC state
      // round trip. Native state remains authoritative and is restored if the
      // hide request itself fails.
      setOverlayState((current) => ({
        ...current,
        active: false,
        interactive: false,
        shapeApplied: false,
        panel: null,
      }));
    }
    const reconcileAfterClose = async () => {
      try {
        const getOverlayState = bridge.getPriceCheckOverlayState;
        if (!getOverlayState) {
          overlayClosing.current = false;
          return;
        }
        const authoritative = normalizeOverlayState(
          await getOverlayState(),
        );
        // This read occurs only after the hide invoke has settled, so an active
        // result is a genuine later reopen rather than a queued pre-close event.
        overlayClosing.current = false;
        if (authoritative.revision < overlayRevision.current) return;
        overlayRevision.current = authoritative.revision;
        setOverlayState(authoritative);
      } catch {
        overlayClosing.current = false;
      }
    };
    void bridge.surfaceAction({ type: "hide-price-check" }).then(
      reconcileAfterClose,
    );
  };

  const sendOverlayPanelPosition = (
    drag: OverlayPanelDrag,
    x: number,
    y: number,
    commit: boolean,
  ) => {
    void bridge.surfaceAction({
      type: "set-price-check-panel-position",
      x,
      y,
      captureId: drag.captureId,
      commit,
    }).catch(() => undefined);
  };

  const overlayMovePointerDown = (event: ReactPointerEvent<HTMLElement>) => {
    const panel = overlayState.panel;
    const captureId = session.captureId;
    const target = event.target;
    if (
      event.button !== 0 ||
      !desktopOverlay ||
      !overlayState.active ||
      !overlayState.interactive ||
      !panel ||
      !Number.isSafeInteger(captureId) ||
      (target instanceof Element &&
        Boolean(target.closest("button, a, input, select, textarea, [role='button']")))
    ) return;
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      return;
    }
    event.preventDefault();
    overlayPanelDrag.current = {
      pointerId: event.pointerId,
      captureId: captureId!,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startPanel: { ...panel },
      lastX: panel.x,
      lastY: panel.y,
      moved: false,
      frame: null,
    };
  };

  const overlayMovePointerMove = (event: ReactPointerEvent<HTMLElement>) => {
    const drag = overlayPanelDrag.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    event.preventDefault();
    drag.lastX = drag.startPanel.x + event.clientX - drag.startClientX;
    drag.lastY = drag.startPanel.y + event.clientY - drag.startClientY;
    drag.moved ||=
      Math.abs(event.clientX - drag.startClientX) >= 2 ||
      Math.abs(event.clientY - drag.startClientY) >= 2;
    if (!drag.moved || drag.frame != null) return;
    drag.frame = window.requestAnimationFrame(() => {
      drag.frame = null;
      if (overlayPanelDrag.current !== drag) return;
      sendOverlayPanelPosition(drag, drag.lastX, drag.lastY, false);
    });
  };

  const finishOverlayPanelDrag = (
    event: ReactPointerEvent<HTMLElement>,
    commit: boolean,
  ) => {
    const drag = overlayPanelDrag.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    event.preventDefault();
    drag.lastX = drag.startPanel.x + event.clientX - drag.startClientX;
    drag.lastY = drag.startPanel.y + event.clientY - drag.startClientY;
    drag.moved ||=
      Math.abs(event.clientX - drag.startClientX) >= 2 ||
      Math.abs(event.clientY - drag.startClientY) >= 2;
    if (drag.frame != null) window.cancelAnimationFrame(drag.frame);
    drag.frame = null;
    overlayPanelDrag.current = null;
    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
      // Pointer capture may already be released by an OS-level cancellation.
    }
    if (drag.moved) {
      sendOverlayPanelPosition(drag, drag.lastX, drag.lastY, commit);
    }
  };

  const readClipboard = async (force = false) => {
    const capture = await bridge.readClipboardItem();
    await checkText(capture, force);
  };

  const updateSettings = (patch: Partial<PriceCheckSettings>) => {
    const next = { ...settingsRef.current, ...patch };
    const keyError = validatePriceCheckHotkey(
      next.hotkey,
      next.enabled ? desktopShortcutsRef.current : undefined,
    );
    setHotkeyError(keyError);
    settingsRef.current = next;
    setSettings(next);
    if ("defaultOnlineOnly" in patch) {
      setOnlineOnly(next.defaultOnlineOnly);
      onlineOnlyRef.current = next.defaultOnlineOnly;
      rebuildQuery(modeRef.current, {
        online: next.defaultOnlineOnly,
      });
    }
    if ("rollTolerance" in patch) {
      rebuildQuery(modeRef.current, { tolerance: next.rollTolerance });
    }
    if ("pinByDefault" in patch) {
      setPinned(next.pinByDefault);
      if (desktopOverlay) {
        void bridge.surfaceAction({
          type: "set-price-check-pinned",
          value: next.pinByDefault,
        });
      }
    }
    if (keyError && "hotkey" in patch) return;
    const persisted = keyError
      ? Object.fromEntries(
          Object.entries(patch).filter(([key]) => key !== "hotkey"),
        ) as Partial<PriceCheckSettings>
      : patch;
    const keys = Object.keys(persisted) as PriceCheckSettingKey[];
    if (!keys.length) return;
    const revision = ++settingsSaveRevision.current;
    for (const key of keys) pendingSettingRevisions.current.set(key, revision);
    settingsSaveChain.current = settingsSaveChain.current.then(async () => {
      try {
        const saved = await bridge.saveSettings({ priceCheck: persisted });
        desktopShortcutsRef.current = {
          ...defaultDesktopShortcuts,
          ...(saved.shortcuts || {}),
        };
        for (const key of keys) {
          if (pendingSettingRevisions.current.get(key) === revision) {
            pendingSettingRevisions.current.delete(key);
          }
        }
        const reconciliation = reconcileSettingsSnapshot({
          authoritative: savedSettingsRef.current,
          authoritativeRevision: settingsRevisionRef.current,
          incoming: {
            ...defaultPriceCheckSettings,
            ...(saved.priceCheck || {}),
          },
          incomingRevision: saved.settingsRevision,
          local: settingsRef.current,
          pendingKeys: pendingSettingRevisions.current.keys(),
        });
        savedSettingsRef.current = reconciliation.authoritative;
        settingsRevisionRef.current = reconciliation.authoritativeRevision;
        const reconciled = reconciliation.visible;
        settingsRef.current = reconciled;
        if (!settingsMountedRef.current) return;
        setSettings(reconciled);
        setHotkeyError(
          validatePriceCheckHotkey(
            reconciled.hotkey,
            reconciled.enabled ? desktopShortcutsRef.current : undefined,
          ),
        );
      } catch (reason) {
        const reconciled = { ...settingsRef.current };
        const rolledBack = new Set<PriceCheckSettingKey>();
        for (const key of keys) {
          if (pendingSettingRevisions.current.get(key) !== revision) continue;
          pendingSettingRevisions.current.delete(key);
          Object.assign(reconciled, { [key]: savedSettingsRef.current[key] });
          rolledBack.add(key);
        }
        settingsRef.current = reconciled;
        if (!settingsMountedRef.current) return;
        setSettings(reconciled);
        if (rolledBack.has("defaultOnlineOnly")) {
          onlineOnlyRef.current = reconciled.defaultOnlineOnly;
          setOnlineOnly(reconciled.defaultOnlineOnly);
          rebuildQuery(modeRef.current, {
            online: reconciled.defaultOnlineOnly,
          });
        }
        if (rolledBack.has("rollTolerance")) {
          rebuildQuery(modeRef.current, { tolerance: reconciled.rollTolerance });
        }
        if (rolledBack.has("pinByDefault")) {
          setPinned(reconciled.pinByDefault);
          if (desktopOverlay) {
            void bridge.surfaceAction({
              type: "set-price-check-pinned",
              value: reconciled.pinByDefault,
            });
          }
        }
        setHotkeyError(
          reason instanceof Error
            ? reason.message.replace(/^Error invoking remote method '[^']+':\s*/, "")
            : "That shortcut could not be registered; the previous shortcut is still active.",
        );
      }
    });
  };

  const selectMatch = (matchKey: string) => {
    setSession((current) => {
      if (!current.item) return current;
      const freshness = sourceFreshness(loadedGroups.current, matchKey);
      return {
        ...current,
        selectedMatchKey: matchKey,
        sourceFetchedAt: freshness.fetchedAt,
        sourceStale: freshness.stale,
        estimate: estimatePriceCheck(current.item, current.matches, {
          league: current.league,
          sourceFetchedAt: freshness.fetchedAt,
          sourceStale: freshness.stale,
          history: historyRef.current,
          selectedMatchKey: matchKey,
        }),
      };
    });
  };

  const selectHistory = (entry: PriceCheckHistoryEntry) => {
    requestId.current += 1;
    lastCapture.current = {
      text: entry.item.rawText,
      capturedAt: Date.now(),
      validPrefix: /^Item Class:\s*.+/m.test(entry.item.rawText),
    };
    const currentMode = defaultPriceCheckModeForItem(entry.item);
    modeRef.current = currentMode;
    setMode(currentMode);
    const query = buildPriceCheckQueryPlan(entry.item, entry.league, {
      rollTolerance: settingsRef.current.rollTolerance,
      mode: currentMode,
      status: defaultOfficialTradeStatusForItem(entry.item, onlineOnlyRef.current),
      identity: currentMode === "base" ? "base" : "exact",
    });
    identityPresetStates.current = rememberIdentityPresetState(
      {},
      currentMode,
      query.itemFilters,
    );
    const savedAge = Date.now() - entry.checkedAt;
    setSession({
      id: entry.id,
      capturedAt: entry.checkedAt,
      league: entry.league,
      status: "ready",
      item: entry.item,
      matches: [],
      selectedMatchKey: entry.selectedMatchKey,
      estimate: entry.estimate,
      query,
      sourceFetchedAt: entry.checkedAt,
      sourceStale:
        !Number.isFinite(savedAge) || savedAge < 0 || savedAge > 15 * 60 * 1000,
      message: "Saved result. Refresh the check before making a high-value trade.",
    });
    setView("check");
  };

  const selectedMatch =
    session.matches.find((match) => match.row.key === session.selectedMatchKey) ||
    session.matches[0];
  const mobile = isMobileApp;

  const changeModifier = useCallback(
    (modifierId: string, patch: Partial<PriceCheckModifierFilter>) => {
      setSession((current) => {
        if (!current.item || !current.query) return current;
        const plannedItem = priceCheckItemForMode(current.item, modeRef.current);
        const modifier = plannedItem.modifiers.find(
          (candidate) => candidate.id === modifierId,
        );
        const activeFilter = current.query.filters.find(
          (candidate) => candidate.modifierId === modifierId,
        );
        if (activeFilter?.equipmentProperty && patch.mode === "presence") {
          return current;
        }
        const presenceOnly = activeFilter
          ? isPresenceOnlyPriceCheckFilter(activeFilter, modifier)
          : false;
        const primaryRoll = modifier?.values.find((value) => Number.isFinite(value)) ??
          activeFilter?.copiedValue;
        let normalizedPatch = { ...patch };
        if (presenceOnly) {
          normalizedPatch = {
            ...normalizedPatch,
            mode: "presence",
            min: undefined,
            max: undefined,
          };
        } else if (patch.mode === "presence") {
          normalizedPatch = { ...normalizedPatch, min: undefined, max: undefined };
        } else if (patch.mode === "exact" && primaryRoll != null) {
          normalizedPatch = {
            ...normalizedPatch,
            min: primaryRoll,
            max: primaryRoll,
          };
        } else if (patch.mode === "range") {
          const plannedPatch = plannedRangeModePatch(
            plannedItem,
            current.query.rollTolerance,
            modifierId,
            activeFilter?.bounds,
          );
          if (plannedPatch) {
            normalizedPatch = {
              ...normalizedPatch,
              ...plannedPatch,
            };
          }
        }

        const filters = current.query.filters.map((filter) => {
          if (filter.modifierId !== modifierId) return filter;
          const next = sanitizePresenceOnlyPriceCheckFilter(
            { ...filter, ...normalizedPatch },
            modifier,
          );
          if (
            next.mode === "range" &&
            next.min != null &&
            next.max != null &&
            next.min > next.max
          ) {
            if (patch.min != null) next.max = next.min;
            else next.min = next.max;
          }
          return next;
        });
        const query = buildPriceCheckQueryPlan(current.item, current.league, {
          rollTolerance: current.query.rollTolerance,
          mode: modeRef.current,
          status: current.query.status,
          identity: current.query.identity,
          filters,
          itemFilters: current.query.itemFilters,
        });
        return {
          ...current,
          query,
        };
      });
    },
    [],
  );

  const changeItemFilter = useCallback(
    (key: string, value: string | number | boolean | undefined) => {
      setSession((current) => {
        if (!current.item || !current.query) return current;
        const itemFilters = { ...current.query.itemFilters };
        if (value === undefined) delete itemFilters[key];
        else itemFilters[key] = value;
        const query = buildPriceCheckQueryPlan(current.item, current.league, {
          rollTolerance: current.query.rollTolerance,
          mode: modeRef.current,
          status: current.query.status,
          identity: current.query.identity,
          filters: current.query.filters,
          itemFilters,
        });
        if (key === "identityRelaxed" || key === "identitySub") {
          identityPresetStates.current = rememberIdentityPresetState(
            identityPresetStates.current,
            modeRef.current,
            query.itemFilters,
          );
        }
        return {
          ...current,
          query,
        };
      });
    },
    [],
  );

  const identifyUnidentifiedUnique = useCallback((name: string) => {
    setSession((current) => {
      if (
        !current.item ||
        !current.query ||
        current.item.rarity !== "unique" ||
        current.item.identified
      ) return current;
      const profile = uniqueIdentityProfile(name, current.item);
      if (!profile || profile.baseType !== current.item.baseType) return current;
      const item = {
        ...current.item,
        name: profile.name,
        baseType: profile.baseType,
        iconHint: profile.icon || current.item.iconHint,
      };
      const nextMode = defaultPriceCheckModeForItem(item);
      modeRef.current = nextMode;
      setMode(nextMode);
      const query = buildPriceCheckQueryPlan(item, current.league, {
        rollTolerance: current.query.rollTolerance,
        mode: nextMode,
        status: current.query.status,
        identity: nextMode === "base" ? "base" : "exact",
      });
      identityPresetStates.current = rememberIdentityPresetState(
        {},
        nextMode,
        query.itemFilters,
      );
      return {
        ...current,
        item,
        matches: [],
        selectedMatchKey: undefined,
        estimate: null,
        query,
      };
    });
  }, []);

  const changeMode = useCallback((nextMode: PriceCheckMode) => {
    const previousMode = modeRef.current;
    setSession((current) => {
      if (!current.item || !current.query) return current;
      let states = rememberIdentityPresetState(
        identityPresetStates.current,
        previousMode,
        current.query.itemFilters,
      );
      const build = (
        itemFilters?: Record<string, string | number | boolean>,
      ) => buildPriceCheckQueryPlan(current.item!, current.league, {
        rollTolerance: current.query!.rollTolerance,
        mode: nextMode,
        status: current.query!.status,
        identity: nextMode === "base" ? "base" : "exact",
        itemFilters,
      });
      const defaults = build();
      const query = Object.hasOwn(states, nextMode)
        ? build(restoreIdentityPresetState(
            states,
            nextMode,
            defaults.itemFilters,
          ))
        : defaults;
      states = rememberIdentityPresetState(states, nextMode, query.itemFilters);
      identityPresetStates.current = states;
      return {
        ...current,
        query,
      };
    });
    modeRef.current = nextMode;
    setMode(nextMode);
  }, []);

  const surface = (
    <PriceCheckSurface
      session={session}
      history={history}
      settings={settings}
      mode={mode}
      activeView={view}
      pinned={pinned}
      onlineOnly={onlineOnly}
      isMobile={mobile}
      overlay={desktopOverlay}
      overlayState={desktopOverlay ? overlayState : undefined}
      manualText={manualText}
      manualError={manualError}
      hotkeyError={hotkeyError}
      onActiveViewChange={setView}
      onClose={close}
      onOverlayMovePointerDown={overlayMovePointerDown}
      onOverlayMovePointerMove={overlayMovePointerMove}
      onOverlayMovePointerUp={(event) => finishOverlayPanelDrag(event, true)}
      onOverlayMovePointerCancel={(event) => finishOverlayPanelDrag(event, false)}
      onPinChange={(value) => {
        setPinned(value);
        if (desktopOverlay) {
          void bridge.surfaceAction({ type: "set-price-check-pinned", value });
        }
      }}
      onOpenDashboard={
        embedded
          ? undefined
          : () =>
              void bridge.surfaceAction({
                type: "open-price-check-dashboard",
                snapshot: dashboardSnapshotFromSession(
                  session,
                  mode,
                  sourceCaptureIdentity.current,
                ),
              })
      }
      onCaptureRequested={() => void readClipboard()}
      onManualTextChange={(text) => {
        setManualText(text.slice(0, 65_536));
        setManualError("");
      }}
      onCheckManualText={() => {
        if (!isPoeItemText(manualText)) {
          setManualError("Paste the complete copied item text, starting with Item Class.");
          return;
        }
        setManualError("");
        void checkText({
          text: manualText,
          capturedAt: Date.now(),
          validPrefix: true,
        });
      }}
      onRetry={() => {
        if (
          session.status === "ready" &&
          session.query?.tradeApi !== "exchange" &&
          bridge.getTradePriceSnapshot
        ) {
          forceTradePriceRefresh.current = true;
          setTradePriceRefresh((value) => value + 1);
          return;
        }
        if (session.status === "invalid") void readClipboard(true);
        else if (lastCapture.current) {
          void checkText(
            lastCapture.current,
            true,
            session.status !== "ready",
            session.status === "ready",
            true,
          );
        }
        else void readClipboard(true);
      }}
      onModeChange={(nextMode) => {
        changeMode(nextMode);
      }}
      onIdentifyUnique={identifyUnidentifiedUnique}
      onMatchSelect={selectMatch}
      onModifierChange={changeModifier}
      onItemFilterChange={changeItemFilter}
      onRollToleranceChange={(value) => {
        updateSettings({ rollTolerance: value });
      }}
      onAvailabilityChange={(value) => {
        const nextOnlineOnly = value !== "any";
        onlineOnlyRef.current = nextOnlineOnly;
        setOnlineOnly(nextOnlineOnly);
        rebuildQuery(modeRef.current, { status: value });
      }}
      onOpenTrade={() => {
        const url = session.query?.tradeUrl;
        if (url) void bridge.openExternal(url);
      }}
      onCopySummary={() => {
        const name = session.item?.name || session.item?.baseType || "PoE item";
        const estimate = session.estimate;
        const value =
          estimate?.chaosValue != null
            ? `${formatPrice(estimate.chaosValue)} chaos${estimate.divineValue != null ? ` (${formatPrice(estimate.divineValue)} divine)` : ""}`
            : "no reliable estimate";
        return writeText(
          [
            `${name}: ${value} - ${estimate?.confidence || "none"} confidence`,
            `${session.league} - checked ${new Date(session.capturedAt).toLocaleString()}`,
            "Official Trade filter plan:",
            `Availability: ${session.query?.status || "available"}`,
            `Identity: ${session.query?.identity || "review item"}`,
            `Item state: ${Object.entries(session.query?.itemFilters || {}).map(([key, entry]) => `${key}=${String(entry)}`).join(", ") || "none"}`,
            ...(session.query?.filters || [])
              .filter((filter) => filter.enabled)
              .map((filter) => {
                const modifier = session.item
                  ? priceCheckItemForMode(session.item, modeRef.current).modifiers
                    .find((entry) => entry.id === filter.modifierId)
                  : undefined;
                const range = filter.mode === "presence"
                  ? "present"
                  : filter.mode === "exact"
                    ? `exact ${String(filter.min ?? filter.max ?? "roll")}`
                    : `${String(filter.min ?? "any")} to ${String(filter.max ?? "any")}`;
                return `- ${filter.label || modifier?.text || filter.modifierId}: ${range}${isOfficialPriceCheckFilter(filter) ? "" : " (manual only)"}`;
              }),
          ].join("\n"),
        );
      }}
      onWatchMatch={
        selectedMatch
          ? () => {
              void bridge.surfaceAction({
                type: "open-row",
                league: session.league,
                categoryId: selectedMatch.row.categoryId,
                source: selectedMatch.row.source,
                rowKey: selectedMatch.row.key,
              });
            }
          : undefined
      }
      onHistorySelect={selectHistory}
      onHistoryRemove={(id) => {
        const next = historyRef.current.filter((entry) => entry.id !== id);
        historyRef.current = next;
        setHistory(next);
        savePriceCheckHistory(next);
      }}
      onHistoryClear={() => {
        historyRef.current = [];
        setHistory([]);
        clearPriceCheckHistory();
      }}
      onSettingsChange={updateSettings}
    />
  );

  if (!desktopOverlay) return surface;

  const panel = overlayState.panel;
  return (
    <div
      className={`pc-overlay-host${overlayState.active ? " is-active" : ""}`}
      aria-hidden={!overlayState.active}
      onPointerDown={(event) => {
        if (event.target === event.currentTarget && overlayState.active) close();
      }}
    >
      {overlayState.active ? (
        <div
          ref={overlayDialog}
          className={`pc-overlay-card${panel ? "" : " pc-overlay-card--fallback"}`}
          style={
            panel
              ? {
                  left: panel.x,
                  top: panel.y,
                  width: panel.width,
                  height: panel.height,
                }
              : undefined
          }
          role="dialog"
          tabIndex={-1}
          aria-label="Path of Exile item price check overlay"
          aria-modal="false"
        >
          {surface}
        </div>
      ) : null}
    </div>
  );
}
