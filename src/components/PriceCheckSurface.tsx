import clsx from "clsx";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEventHandler,
} from "react";
import {
  ClipboardPaste,
  History,
  LayoutDashboard,
  Settings,
  X,
} from "lucide-react";
import type {
  PriceCheckOverlayState,
} from "../types";
import type {
  PriceCheckHistoryEntry,
  PriceCheckModifierFilter,
  PriceCheckSession,
  PriceCheckSettings as PriceCheckSettingsValue,
} from "../lib/price-check/types";
import {
  normalizePriceCheckAvailability,
  type PriceCheckAvailability,
} from "../lib/price-check/availability";
import { PriceCheckHistory } from "./PriceCheckHistory";
import {
  PriceCheckPanel,
  type PriceCheckMode,
} from "./PriceCheckPanel";
import { PriceCheckSettings } from "./PriceCheckSettings";
import { CompactPriceCheckOverlay } from "./CompactPriceCheckOverlay";
import "../price-check.css";

export type PriceCheckSurfaceView = "check" | "history" | "settings";

const PRICE_CHECK_SCROLLABLE_SELECTOR =
  ".pc-content, .pc-panel, .pc-history, .pc-settings";

/**
 * Resets both nested price-check scrollers and the mobile workspace. The full
 * checker uses an inner scrolling panel inside `.main-content`, so resetting
 * only one of them can reopen the screen at its previous bottom position.
 */
export function resetPriceCheckSurfaceScroll(root: HTMLElement | null) {
  if (!root) return;
  root.scrollTop = 0;
  for (const scroller of root.querySelectorAll<HTMLElement>(
    PRICE_CHECK_SCROLLABLE_SELECTOR,
  )) {
    scroller.scrollTop = 0;
  }
  const workspace = root.closest<HTMLElement>(".main-content");
  if (workspace && workspace !== root) workspace.scrollTop = 0;
}

export interface PriceCheckSurfaceProps {
  session: PriceCheckSession;
  history: PriceCheckHistoryEntry[];
  settings: PriceCheckSettingsValue;
  mode: PriceCheckMode;
  activeView: PriceCheckSurfaceView;
  pinned: boolean;
  onlineOnly: boolean;
  isMobile?: boolean;
  overlay?: boolean;
  overlayState?: PriceCheckOverlayState;
  manualText?: string;
  manualError?: string;
  hotkeyError?: string;
  onActiveViewChange: (view: PriceCheckSurfaceView) => void;
  onClose: () => void;
  onOverlayMovePointerDown?: PointerEventHandler<HTMLElement>;
  onOverlayMovePointerMove?: PointerEventHandler<HTMLElement>;
  onOverlayMovePointerUp?: PointerEventHandler<HTMLElement>;
  onOverlayMovePointerCancel?: PointerEventHandler<HTMLElement>;
  onPinChange: (pinned: boolean) => void;
  onOpenDashboard?: () => void;
  onCaptureRequested: () => void;
  onManualTextChange: (text: string) => void;
  onCheckManualText: () => void;
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
  onHistorySelect: (entry: PriceCheckHistoryEntry) => void;
  onHistoryRemove: (id: string) => void;
  onHistoryClear: () => void;
  onSettingsChange: (patch: Partial<PriceCheckSettingsValue>) => void;
}

export function PriceCheckSurface({
  session,
  history,
  settings,
  mode,
  activeView,
  pinned,
  onlineOnly,
  isMobile = false,
  overlay = false,
  overlayState,
  manualText = "",
  manualError,
  hotkeyError,
  onActiveViewChange,
  onClose,
  onOverlayMovePointerDown,
  onOverlayMovePointerMove,
  onOverlayMovePointerUp,
  onOverlayMovePointerCancel,
  onPinChange,
  onOpenDashboard,
  onCaptureRequested,
  onManualTextChange,
  onCheckManualText,
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
  onHistorySelect,
  onHistoryRemove,
  onHistoryClear,
  onSettingsChange,
}: PriceCheckSurfaceProps) {
  const busy = session.status === "parsing" || session.status === "resolving";
  const ready = session.status === "ready" && !!session.item;
  const availability = normalizePriceCheckAvailability(
    session.query?.status ?? (onlineOnly ? "available" : "any"),
  );
  const [mobilePasteOpen, setMobilePasteOpen] = useState(!ready);
  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isMobile || activeView !== "check") return;
    if (ready) setMobilePasteOpen(false);
    else if (session.status === "idle" || session.status === "invalid" || session.status === "error") {
      setMobilePasteOpen(true);
    }
  }, [activeView, isMobile, ready, session.id, session.status]);

  useLayoutEffect(() => {
    if (!isMobile || !contentRef.current) return;
    resetPriceCheckSurfaceScroll(contentRef.current);
    // Capacitor/WebView and browser history can restore a nested scroll after
    // layout effects. Reassert once on the next frame so reopening is stable.
    const frame = window.requestAnimationFrame(() => {
      resetPriceCheckSurfaceScroll(contentRef.current);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [activeView, isMobile, session.id]);

  if (overlay) {
    return (
      <CompactPriceCheckOverlay
        session={session}
        mode={mode}
        pinned={pinned}
        hotkey={settings.hotkey}
        panelHeight={overlayState?.panel?.height}
        onClose={onClose}
        onMovePointerDown={onOverlayMovePointerDown}
        onMovePointerMove={onOverlayMovePointerMove}
        onMovePointerUp={onOverlayMovePointerUp}
        onMovePointerCancel={onOverlayMovePointerCancel}
        onPinChange={onPinChange}
        onRetry={onRetry}
        onModeChange={onModeChange}
        onIdentifyUnique={onIdentifyUnique}
        onOpenDashboard={onOpenDashboard}
        availability={availability}
        onModifierChange={onModifierChange}
        onItemFilterChange={onItemFilterChange}
        onAvailabilityChange={onAvailabilityChange}
        onOpenTrade={onOpenTrade}
      />
    );
  }
  const overlayTarget = overlayState?.attached
    ? overlayState.interactive
      ? "Controls active"
      : "Click panel to interact"
    : "Waiting for PoE";

  return (
    <div
      className={clsx(
        "pc-surface",
        isMobile && "pc-surface--mobile",
        overlay && "pc-surface--overlay",
        overlay && !overlayState?.interactive && "is-passive",
        isMobile && activeView === "check" && "pc-surface--has-paste",
      )}
    >
      <header
        className="pc-titlebar"
        title={overlay ? overlayState?.message : undefined}
      >
        <div className="pc-brand">
          <span aria-hidden>P</span>
          <div>
            <strong>PRICE CHECK</strong>
            <small>
              {session.league || "Current league"}
              {overlay ? (
                <>
                  <i
                    className={clsx(
                      "pc-overlay-target-dot",
                      overlayState?.attached && "is-attached",
                      (overlayState?.targetActive || overlayState?.interactive) &&
                        "is-active",
                    )}
                    aria-hidden
                  />
                  {overlayTarget}
                </>
              ) : null}
            </small>
          </div>
        </div>

        <nav aria-label="Price checker sections">
          <button
            type="button"
            title="Current price check"
            className={activeView === "check" ? "is-active" : undefined}
            onClick={() => onActiveViewChange("check")}
            aria-current={activeView === "check" ? "page" : undefined}
          >
            <ClipboardPaste size={14} aria-hidden />
            <span className="pc-nav-label">Check</span>
          </button>
          <button
            type="button"
            title="Price-check history"
            className={activeView === "history" ? "is-active" : undefined}
            onClick={() => onActiveViewChange("history")}
            aria-current={activeView === "history" ? "page" : undefined}
          >
            <History size={14} aria-hidden />
            <span className="pc-nav-label">History</span>
            {history.length ? <b>{Math.min(99, history.length)}</b> : null}
          </button>
          <button
            type="button"
            title="Price-check settings"
            className={activeView === "settings" ? "is-active" : undefined}
            onClick={() => onActiveViewChange("settings")}
            aria-current={activeView === "settings" ? "page" : undefined}
          >
            <Settings size={14} aria-hidden />
            <span className="pc-nav-label">Settings</span>
          </button>
        </nav>

        <div className="pc-window-actions">
          {!overlay && onOpenDashboard ? (
            <button type="button" onClick={onOpenDashboard} title="Open full dashboard">
              <LayoutDashboard size={14} aria-hidden />
              <span>Dashboard</span>
            </button>
          ) : null}
          <button type="button" onClick={onClose} title="Close price checker">
            <X size={15} aria-hidden />
            <span>Close</span>
          </button>
        </div>
      </header>

      {isMobile && activeView === "check" ? (
        mobilePasteOpen || !ready ? (
          <section className="pc-mobile-paste" aria-label="Paste Path of Exile item text">
            <textarea
              aria-label="Complete copied Path of Exile item text"
              value={manualText}
              onChange={(event) => onManualTextChange(event.currentTarget.value)}
              placeholder={'Paste item text (Item Class: ...)'}
              aria-invalid={!!manualError}
              aria-describedby={manualError ? "pc-manual-error" : undefined}
              spellCheck={false}
            />
            {manualError ? (
              <p id="pc-manual-error" className="pc-field-error" role="alert">
                {manualError}
              </p>
            ) : null}
            <button
              className="pc-button pc-button--primary"
              type="button"
              onClick={onCheckManualText}
              disabled={!manualText.trim() || busy}
            >
              <ClipboardPaste size={15} aria-hidden />
              {busy ? "CHECKING…" : "CHECK"}
            </button>
          </section>
        ) : (
          <section className="pc-mobile-paste pc-mobile-paste--compact">
            <button
              className="pc-button"
              type="button"
              onClick={() => {
                onManualTextChange("");
                setMobilePasteOpen(true);
              }}
            >
              <ClipboardPaste size={15} aria-hidden />
              NEW ITEM
            </button>
          </section>
        )
      ) : null}

      <div className="pc-content" ref={contentRef}>
        {activeView === "check" ? (
          <PriceCheckPanel
            session={session}
            mode={mode}
            rollTolerance={settings.rollTolerance}
            availability={availability}
            hotkey={settings.hotkey}
            isMobile={isMobile}
            showAdvanced={settings.showAdvanced}
            onCaptureRequested={onCaptureRequested}
            onRetry={onRetry}
            onModeChange={onModeChange}
            onIdentifyUnique={onIdentifyUnique}
            onMatchSelect={onMatchSelect}
            onModifierChange={onModifierChange}
            onItemFilterChange={onItemFilterChange}
            onRollToleranceChange={onRollToleranceChange}
            onAvailabilityChange={onAvailabilityChange}
            onOpenTrade={onOpenTrade}
            onCopySummary={onCopySummary}
            onWatchMatch={onWatchMatch}
          />
        ) : activeView === "history" ? (
          <PriceCheckHistory
            entries={history}
            selectedId={session.id}
            onSelect={onHistorySelect}
            onRemove={onHistoryRemove}
            onClear={onHistoryClear}
            onBack={() => onActiveViewChange("check")}
          />
        ) : (
          <PriceCheckSettings
            settings={settings}
            isMobile={isMobile}
            hotkeyError={hotkeyError}
            onChange={onSettingsChange}
            onBack={() => onActiveViewChange("check")}
          />
        )}
      </div>

    </div>
  );
}
