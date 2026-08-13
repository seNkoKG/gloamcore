import {
  Accessibility,
  Check,
  Contrast,
  Download,
  EyeOff,
  Keyboard,
  LifeBuoy,
  LayoutPanelTop,
  Minimize2,
  MonitorUp,
  MousePointer2,
  Palette,
  Pin,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  SlidersHorizontal,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { bridge } from "../lib/bridge";
import { loadGameData } from "../lib/game-data";
import { isMobileApp } from "../lib/platform";
import {
  applyWorkspaceStorage,
  collectWorkspaceStorage,
  supportContext,
} from "../lib/workspace-transfer";
import {
  defaultDesktopShortcuts,
  formatShortcut,
  shortcutFromKeyboardEvent,
  type ShortcutDraft,
  type ShortcutDraftKey,
  validateShortcutDraft,
} from "../lib/shortcuts";
import type {
  AppTheme,
  ColorVisionMode,
  Density,
  DesktopSettings,
  TextScale,
  UpdateState,
} from "../types";

export function SettingsDrawer({
  settings,
  density,
  theme,
  textScale,
  reducedMotion,
  colorVision,
  refreshMinutes,
  onClose,
  onSettings,
  onDensity,
  onTheme,
  onTextScale,
  onReducedMotion,
  onColorVision,
  onRefreshMinutes,
}: {
  settings: DesktopSettings;
  density: Density;
  theme: AppTheme;
  textScale: TextScale;
  reducedMotion: boolean;
  colorVision: ColorVisionMode;
  refreshMinutes: number;
  onClose: () => void;
  onSettings: (patch: Partial<DesktopSettings>) => Promise<void>;
  onDensity: (density: Density) => void;
  onTheme: (theme: AppTheme) => void;
  onTextScale: (scale: TextScale) => void;
  onReducedMotion: (value: boolean) => void;
  onColorVision: (mode: ColorVisionMode) => void;
  onRefreshMinutes: (minutes: number) => void;
}) {
  const [update, setUpdate] = useState<UpdateState | null>(null);
  const savedShortcutDraft = useMemo<ShortcutDraft>(() => ({
    ...settings.shortcuts,
    priceCheck: settings.priceCheck.hotkey,
  }), [settings.priceCheck.hotkey, settings.shortcuts]);
  const [shortcutDraft, setShortcutDraft] = useState(savedShortcutDraft);
  const [shortcutErrors, setShortcutErrors] = useState(
    () => validateShortcutDraft(savedShortcutDraft, {
      priceCheckEnabled: settings.priceCheck.enabled,
    }),
  );
  const [shortcutSaveError, setShortcutSaveError] = useState("");
  const [shortcutSaving, setShortcutSaving] = useState(false);
  const [transferStatus, setTransferStatus] = useState("");
  const [transferBusy, setTransferBusy] = useState(false);

  useEffect(() => {
    setShortcutDraft(savedShortcutDraft);
    setShortcutErrors(validateShortcutDraft(savedShortcutDraft, {
      priceCheckEnabled: settings.priceCheck.enabled,
    }));
    setShortcutSaveError("");
  }, [savedShortcutDraft, settings.priceCheck.enabled]);

  useEffect(() => {
    let active = true;
    bridge.getUpdateState().then((state) => active && setUpdate(state));
    const unsubscribe = bridge.onUpdateState(setUpdate);
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  return (
    <aside className="settings-drawer" aria-label="Widget settings">
      <div className="settings-heading">
        <div>
          <span>{isMobileApp ? "GLOAMCORE" : "WIDGET CONTROL"}</span>
          <h2>Settings</h2>
        </div>
        <button type="button" onClick={onClose} aria-label="Close settings">
          <X size={17} />
        </button>
      </div>

      {!isMobileApp && (
        <section className="settings-section">
          <h3>
            <MonitorUp size={15} />
            Window behaviour
          </h3>
        <label className="setting-row">
          <div>
            <Pin size={16} />
            <span>
              <strong>Always on top</strong>
              <small>Keep prices visible above PoE in borderless mode.</small>
            </span>
          </div>
          <input
            type="checkbox"
            checked={settings.alwaysOnTop}
            onChange={(event) => void onSettings({ alwaysOnTop: event.target.checked })}
          />
        </label>
        <label className="setting-row">
          <div>
            <LayoutPanelTop size={16} />
            <span>
              <strong>Compact widget</strong>
              <small>Collapse the interface to a fast 480px layout.</small>
            </span>
          </div>
          <input
            type="checkbox"
            checked={settings.compact}
            onChange={(event) => void onSettings({ compact: event.target.checked })}
          />
        </label>
        <label className="setting-row">
          <div>
            <MousePointer2 size={16} />
            <span>
              <strong>Click-through mode</strong>
              <small>
                Mouse input passes to the game. Toggle with {formatShortcut(settings.shortcuts.toggleClickThrough)}.
              </small>
            </span>
          </div>
          <input
            type="checkbox"
            checked={settings.clickThrough}
            onChange={(event) => void onSettings({ clickThrough: event.target.checked })}
          />
        </label>
        <label className="setting-row">
          <div>
            <Minimize2 size={16} />
            <span>
              <strong>Start minimized</strong>
              <small>Launch quietly in the tray instead of opening the dashboard.</small>
            </span>
          </div>
          <input
            type="checkbox"
            checked={settings.startMinimized}
            onChange={(event) => void onSettings({ startMinimized: event.target.checked })}
          />
        </label>
        <label className="setting-slider">
          <div>
            <EyeOff size={16} />
            <span>Window opacity</span>
            <strong>{Math.round(settings.opacity * 100)}%</strong>
          </div>
          <input
            type="range"
            min="65"
            max="100"
            value={Math.round(settings.opacity * 100)}
            onChange={(event) =>
              void onSettings({ opacity: Number(event.target.value) / 100 })
            }
          />
        </label>
        </section>
      )}

      <section className="settings-section">
        <h3>
          <SlidersHorizontal size={15} />
          Market display
        </h3>
        <div className="setting-theme">
          <div>
            <Palette size={16} />
            <span>
              <strong>Interface theme</strong>
              <small>Use one coordinated palette across every native workspace.</small>
            </span>
          </div>
          <div className="setting-theme-options" role="group" aria-label="Interface theme">
            {([
              ["gloam", "Gloam Teal"],
              ["azurite", "Azurite Blue"],
              ["ember", "Ember Gold"],
              ["wraeclast", "Path of Exile"],
            ] as Array<[AppTheme, string]>).map(([value, label]) => (
              <button
                key={value}
                className={`setting-theme-option setting-theme-option--${value}${theme === value ? " is-active" : ""}`}
                type="button"
                aria-pressed={theme === value}
                onClick={() => onTheme(value)}
              >
                <span aria-hidden="true" />
                {label}
              </button>
            ))}
          </div>
        </div>
        <div className="setting-choice" role="group" aria-label="Row density">
          <span>Row density</span>
          <div>
            <button
              className={density === "compact" ? "is-active" : undefined}
              type="button"
              aria-pressed={density === "compact"}
              onClick={() => onDensity("compact")}
            >
              Compact
            </button>
            <button
              className={density === "comfortable" ? "is-active" : undefined}
              type="button"
              aria-pressed={density === "comfortable"}
              onClick={() => onDensity("comfortable")}
            >
              Comfortable
            </button>
          </div>
        </div>
        <div className="setting-choice" role="group" aria-label="Text size">
          <span>Text size</span>
          <div>
            {(["small", "normal", "large"] as TextScale[]).map((value) => (
              <button
                key={value}
                className={textScale === value ? "is-active" : undefined}
                type="button"
                aria-pressed={textScale === value}
                onClick={() => onTextScale(value)}
              >
                {value[0].toUpperCase() + value.slice(1)}
              </button>
            ))}
          </div>
        </div>
        <label className="setting-row">
          <div>
            <Accessibility size={16} />
            <span>
              <strong>Reduce motion</strong>
              <small>Disable non-essential transitions, pulsing and animated scrolling.</small>
            </span>
          </div>
          <input
            type="checkbox"
            checked={reducedMotion}
            onChange={(event) => onReducedMotion(event.target.checked)}
          />
        </label>
        <label className="setting-row">
          <div>
            <Contrast size={16} />
            <span>
              <strong>Accessible status colours</strong>
              <small>Use a blue/orange-safe gain and loss palette with stronger outlines.</small>
            </span>
          </div>
          <input
            type="checkbox"
            checked={colorVision === "accessible"}
            onChange={(event) =>
              onColorVision(event.target.checked ? "accessible" : "standard")
            }
          />
        </label>
        <label className="setting-select">
          <div>
            <RefreshCw size={16} />
            <span>
              <strong>Backup market check</strong>
              <small>
                Source expiry drives live refreshes; this interval retries stale data and watch targets.
              </small>
            </span>
          </div>
          <select
            value={refreshMinutes}
            onChange={(event) => onRefreshMinutes(Number(event.target.value))}
          >
            <option value="5">5 min</option>
            <option value="10">10 min</option>
            <option value="15">15 min</option>
            <option value="30">30 min</option>
          </select>
        </label>
      </section>

      {!isMobileApp && update?.feedConfigured && (
        <section className="settings-section">
          <h3>
            <Download size={15} />
            Application updates
          </h3>
        <label className="setting-row">
          <div>
            <RefreshCw size={16} />
            <span>
              <strong>Check automatically</strong>
              <small>Download trusted releases and install after confirmation.</small>
            </span>
          </div>
          <input
            type="checkbox"
            checked={settings.autoCheckUpdates}
            onChange={(event) =>
              void onSettings({ autoCheckUpdates: event.target.checked })
            }
          />
        </label>
        <label className="setting-select">
          <div>
            <Download size={16} />
            <span>
              <strong>Release channel</strong>
              <small>Preview is opt-in and may receive pre-release builds before stable users.</small>
            </span>
          </div>
          <select
            value={settings.updateChannel}
            onChange={(event) =>
              void onSettings({
                updateChannel: event.target.value === "preview" ? "preview" : "stable",
              })
            }
          >
            <option value="stable">Stable</option>
            <option value="preview">Preview</option>
          </select>
        </label>
        <div className="update-setting-card">
          <div>
            <span
              className={`update-state-dot update-state-dot--${update?.status || "idle"}`}
            />
            <span>
              <strong>Version {update?.currentVersion || "…"}</strong>
              <small>{update?.message || "Reading update status…"}</small>
            </span>
          </div>
          <button
            type="button"
            disabled={
              !update?.feedConfigured ||
              update.status === "checking" ||
              update.status === "downloading"
            }
            onClick={async () => {
              if (update?.status === "downloaded") await bridge.installUpdate();
              else setUpdate(await bridge.checkForUpdates());
            }}
          >
            {update?.status === "downloaded"
              ? "Restart & install"
              : update?.status === "downloading"
                ? `${Math.round(update.progress || 0)}%`
                : "Check now"}
          </button>
        </div>
        </section>
      )}

      {!isMobileApp && (
        <section className="settings-section shortcut-section">
        <h3>
          <Keyboard size={15} />
          Shortcuts
        </h3>
        <p className="shortcut-help">
          Edit the keys directly. Global bindings are tested before anything is
          replaced, so a shortcut already used by Windows cannot break the old one.
        </p>
        {([
          ["toggleWidget", "Show / hide widget", "GLOBAL"],
          ["toggleClickThrough", "Toggle click-through", "GLOBAL"],
          [
            "priceCheck",
            "Price check hovered item",
            settings.priceCheck.enabled ? "IN-GAME" : "DISABLED",
          ],
          ["instantSearch", "Instant market search", "GLOBAL"],
          ["focusItemSearch", "Focus item search", "IN APP"],
          ["gameDataSearch", "Search game data", "IN APP"],
        ] as Array<[ShortcutDraftKey, string, string]>).map(([key, label, scope]) => (
          <label className="shortcut-editor" key={key}>
            <span>
              <strong>{label}</strong>
              <small>{scope}</small>
            </span>
            <input
              value={shortcutDraft[key]}
              spellCheck={false}
              autoCapitalize="off"
              placeholder="Press a key combination"
              aria-invalid={Boolean(shortcutErrors[key])}
              aria-label={`${label} shortcut`}
              onChange={(event) => {
                const next = { ...shortcutDraft, [key]: event.currentTarget.value };
                setShortcutDraft(next);
                setShortcutErrors(validateShortcutDraft(next, {
                  priceCheckEnabled: settings.priceCheck.enabled,
                }));
                setShortcutSaveError("");
              }}
              onFocus={(event) => event.currentTarget.select()}
              onKeyDown={(event) => {
                if (event.key === "Tab" && !event.ctrlKey && !event.metaKey && !event.altKey) {
                  return;
                }
                if (event.key === "Backspace" && !event.ctrlKey && !event.metaKey && !event.altKey) {
                  event.preventDefault();
                  const next = { ...shortcutDraft, [key]: "" };
                  setShortcutDraft(next);
                  setShortcutErrors(validateShortcutDraft(next, {
                    priceCheckEnabled: settings.priceCheck.enabled,
                  }));
                  return;
                }
                const captured = shortcutFromKeyboardEvent(event);
                if (!captured) return;
                event.preventDefault();
                const next = { ...shortcutDraft, [key]: captured };
                setShortcutDraft(next);
                setShortcutErrors(validateShortcutDraft(next, {
                  priceCheckEnabled: settings.priceCheck.enabled,
                }));
                setShortcutSaveError("");
              }}
            />
            {shortcutErrors[key] && (
              <small className="shortcut-error" role="alert">
                {shortcutErrors[key]}
              </small>
            )}
          </label>
        ))}
        {(shortcutSaveError || settings.shortcutWarning) && (
          <p className="shortcut-save-error" role="alert">
            {shortcutSaveError || settings.shortcutWarning}
          </p>
        )}
        <div className="shortcut-actions">
          <button
            type="button"
            className="shortcut-reset"
            onClick={() => {
              const next = {
                ...defaultDesktopShortcuts,
                priceCheck: "CommandOrControl+D",
              };
              setShortcutDraft(next);
              setShortcutErrors(validateShortcutDraft(next, {
                priceCheckEnabled: settings.priceCheck.enabled,
              }));
              setShortcutSaveError("");
            }}
          >
            <RotateCcw size={12} /> Defaults
          </button>
          <button
            type="button"
            className="shortcut-save"
            disabled={
              shortcutSaving ||
              Object.keys(shortcutErrors).length > 0 ||
              JSON.stringify(shortcutDraft) === JSON.stringify(savedShortcutDraft)
            }
            onClick={async () => {
              const errors = validateShortcutDraft(shortcutDraft, {
                priceCheckEnabled: settings.priceCheck.enabled,
              });
              setShortcutErrors(errors);
              if (Object.keys(errors).length) return;
              setShortcutSaving(true);
              setShortcutSaveError("");
              try {
                const { priceCheck, ...shortcuts } = shortcutDraft;
                await onSettings({
                  shortcuts,
                  priceCheck: { ...settings.priceCheck, hotkey: priceCheck },
                });
              } catch (reason) {
                setShortcutSaveError(
                  reason instanceof Error
                    ? reason.message.replace(/^Error invoking remote method '[^']+':\s*/, "")
                    : "Those shortcuts could not be activated. Your previous keys are still active.",
                );
              } finally {
                setShortcutSaving(false);
              }
            }}
          >
            <Check size={12} /> {shortcutSaving ? "Testing…" : "Save shortcuts"}
          </button>
        </div>
        </section>
      )}

      <section className="settings-section">
        <h3>
          <LifeBuoy size={15} />
          Data &amp; support
        </h3>
        <p className="shortcut-help">
          Backups contain your saved workspace. Support bundles contain only
          versions, capability flags and counts—never paths, character names,
          copied items, cookies or tokens.
        </p>
        <div className="settings-data-actions">
          <button
            type="button"
            disabled={transferBusy}
            onClick={async () => {
              setTransferBusy(true);
              setTransferStatus("");
              try {
                const result = await bridge.exportWorkspaceBackup(
                  collectWorkspaceStorage(),
                );
                setTransferStatus(result ? `Saved ${result.name}.` : "Export cancelled.");
              } catch (reason) {
                setTransferStatus(reason instanceof Error ? reason.message : String(reason));
              } finally {
                setTransferBusy(false);
              }
            }}
          >
            <Download size={13} /> Export workspace
          </button>
          <button
            type="button"
            disabled={transferBusy}
            onClick={async () => {
              if (!window.confirm(
                "Restore this backup? Current GloamCore workspace data will be replaced after an automatic recovery copy is created.",
              )) return;
              setTransferBusy(true);
              setTransferStatus("");
              try {
                const result = await bridge.importWorkspaceBackup(
                  collectWorkspaceStorage(),
                );
                if (!result) {
                  setTransferStatus("Restore cancelled.");
                  return;
                }
                applyWorkspaceStorage(result.renderer);
                setTransferStatus(
                  result.recoveryName
                    ? `Restored. Recovery copy: ${result.recoveryName}. Restarting…`
                    : "Restored. Restarting…",
                );
                window.setTimeout(() => window.location.reload(), 250);
              } catch (reason) {
                setTransferStatus(reason instanceof Error ? reason.message : String(reason));
              } finally {
                setTransferBusy(false);
              }
            }}
          >
            <RotateCcw size={13} /> Restore workspace
          </button>
          <button
            type="button"
            disabled={transferBusy}
            onClick={async () => {
              setTransferBusy(true);
              setTransferStatus("");
              try {
                const diagnostic = await bridge.diagnosePobEngine().catch(() => null);
                const gameData = await loadGameData().catch(() => null);
                const result = await bridge.exportSupportBundle(supportContext({
                  theme,
                  density,
                  textScale,
                  reducedMotion,
                  colorVision,
                  gameVersion: gameData?.bundle.manifest.gameVersion,
                  revision: gameData?.bundle.atlas.source.revision,
                  atlasNodes: gameData?.bundle.atlas.nodes.length,
                  gems: gameData?.bundle.navigator.gems.length,
                  pobEngine: diagnostic?.ok === true,
                }));
                setTransferStatus(result ? `Saved ${result.name}.` : "Export cancelled.");
              } catch (reason) {
                setTransferStatus(reason instanceof Error ? reason.message : String(reason));
              } finally {
                setTransferBusy(false);
              }
            }}
          >
            <ShieldCheck size={13} /> Export support bundle
          </button>
        </div>
        {transferStatus && (
          <p className="settings-transfer-status" role="status">{transferStatus}</p>
        )}
      </section>

      <section className="settings-notice">
        <ShieldCheck size={18} />
        <div>
          <strong>Cache-safe by design</strong>
          <p>
            The app respects ETags, CDN age and source cache windows. Market
            data older than two hours is informational only, and the verified mirror is rejected after 24 hours.
            It never reads game memory. A manual price-check shortcut sends one
            copy action, then the app reads only that copied item text.
          </p>
        </div>
      </section>

      <footer className="settings-footer">
        <p>
          This product isn’t affiliated with or endorsed by Grinding Gear Games or
          poe.ninja.
        </p>
      </footer>
    </aside>
  );
}
