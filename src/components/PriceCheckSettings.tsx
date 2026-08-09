import {
  ArrowLeft,
  ClipboardPaste,
  Clock3,
  Crosshair,
  EyeOff,
  Keyboard,
  ListFilter,
  MousePointer2,
  Pin,
  ShieldCheck,
  SlidersHorizontal,
} from "lucide-react";
import { formatPriceCheckHotkey } from "../lib/price-check/hotkey";
import type { PriceCheckSettings as PriceCheckSettingsValue } from "../lib/price-check/types";

export interface PriceCheckSettingsProps {
  settings: PriceCheckSettingsValue;
  isMobile?: boolean;
  hotkeyError?: string;
  onChange: (patch: Partial<PriceCheckSettingsValue>) => void;
  onBack: () => void;
}

function SettingSwitch({
  checked,
  title,
  description,
  icon,
  disabled,
  onChange,
}: {
  checked: boolean;
  title: string;
  description?: string;
  icon: React.ReactNode;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="pc-setting-switch">
      <span className="pc-setting-icon" aria-hidden>{icon}</span>
      <span className="pc-setting-copy">
        <strong>{title}</strong>
        {description ? <small>{description}</small> : null}
      </span>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.currentTarget.checked)}
      />
      <span className="pc-switch-track" aria-hidden />
    </label>
  );
}

export function PriceCheckSettings({
  settings,
  isMobile = false,
  hotkeyError,
  onChange,
  onBack,
}: PriceCheckSettingsProps) {
  return (
    <section className="pc-settings">
      <header className="pc-section-heading">
        <button className="pc-back-button" type="button" onClick={onBack}>
          <ArrowLeft size={15} aria-hidden />
          Back
        </button>
        <div>
          <h1>Settings</h1>
        </div>
      </header>

      <div className="pc-settings-scroll">
        {!isMobile ? <section className="pc-settings-group">
          <h2>
            <Keyboard size={15} aria-hidden />
            Capture
          </h2>
          <SettingSwitch
            checked={settings.enabled}
            title="Global shortcut"
            icon={<MousePointer2 size={17} />}
            onChange={(enabled) => onChange({ enabled })}
          />
          <label className="pc-setting-field">
            <span className="pc-setting-icon" aria-hidden><Keyboard size={17} /></span>
            <span className="pc-setting-copy">
              <strong>Global shortcut</strong>
              <small>Example: Ctrl+D</small>
            </span>
            <input
              value={settings.hotkey}
              disabled={!settings.enabled}
              spellCheck={false}
              onChange={(event) => onChange({ hotkey: event.currentTarget.value })}
              aria-invalid={!!(hotkeyError || settings.shortcutWarning)}
              aria-describedby={hotkeyError || settings.shortcutWarning ? "pc-hotkey-error" : undefined}
            />
          </label>
          {hotkeyError || settings.shortcutWarning ? (
            <p id="pc-hotkey-error" className="pc-field-error" role="alert">
              {hotkeyError || settings.shortcutWarning}
            </p>
          ) : null}
          <div className="pc-setting-readonly">
            <ShieldCheck size={17} aria-hidden />
            <div>
              <strong>One-key capture</strong>
              <small>Copies and checks the hovered item.</small>
            </div>
            <span>{formatPriceCheckHotkey(settings.hotkey)}</span>
          </div>
        </section> : (
          <section className="pc-settings-group">
            <h2>
              <ClipboardPaste size={15} aria-hidden />
              Mobile capture
            </h2>
            <div className="pc-setting-readonly">
              <ShieldCheck size={17} aria-hidden />
              <div>
                <strong>Paste item text</strong>
                <small>Use the Check tab.</small>
              </div>
              <span>MOBILE</span>
            </div>
          </section>
        )}

        {!isMobile ? <section className="pc-settings-group">
          <h2>
            <Crosshair size={15} aria-hidden />
            Overlay
          </h2>
          <div className="pc-setting-readonly">
            <ShieldCheck size={17} aria-hidden />
            <div>
              <strong>Borderless or Windowed Fullscreen</strong>
              <small>Exclusive fullscreen can hide overlays.</small>
            </div>
            <span>IN-GAME</span>
          </div>
          <SettingSwitch
            checked={settings.openNearCursor}
            title="Open near cursor"
            icon={<Crosshair size={17} />}
            onChange={(openNearCursor) => onChange({ openNearCursor })}
          />
          <SettingSwitch
            checked={settings.closeOnBlur}
            title="Close when focus leaves"
            icon={<EyeOff size={17} />}
            onChange={(closeOnBlur) => onChange({ closeOnBlur })}
          />
          <SettingSwitch
            checked={settings.pinByDefault}
            title="Pin new checks"
            icon={<Pin size={17} />}
            onChange={(pinByDefault) => onChange({ pinByDefault })}
          />
        </section> : null}

        <section className="pc-settings-group">
          <h2>
            <SlidersHorizontal size={15} aria-hidden />
            Market query
          </h2>
          <SettingSwitch
            checked={settings.defaultOnlineOnly}
            title="Online sellers"
            icon={<ListFilter size={17} />}
            onChange={(defaultOnlineOnly) => onChange({ defaultOnlineOnly })}
          />
          <label className="pc-setting-slider">
            <span>
              <strong>Similar-roll tolerance</strong>
              <small>Lower is stricter.</small>
            </span>
            <output>{settings.rollTolerance}%</output>
            <input
              type="range"
              min="0"
              max="30"
              step="1"
              value={settings.rollTolerance}
              onChange={(event) =>
                onChange({ rollTolerance: Number(event.currentTarget.value) })
              }
            />
          </label>
          <SettingSwitch
            checked={settings.showAdvanced}
            title="Show advanced modifiers"
            icon={<SlidersHorizontal size={17} />}
            onChange={(showAdvanced) => onChange({ showAdvanced })}
          />
          <div className="pc-setting-readonly">
            <ShieldCheck size={17} aria-hidden />
            <div>
              <strong>Modifier data</strong>
              <small>8,123 local patterns. Ambiguous matches stay off.</small>
            </div>
            <span>LOCAL</span>
          </div>
        </section>

        <section className="pc-settings-group">
          <h2>
            <Clock3 size={15} aria-hidden />
            Local history
          </h2>
          <SettingSwitch
            checked={settings.rememberHistory}
            title="Remember checks"
            icon={<Clock3 size={17} />}
            onChange={(rememberHistory) => onChange({ rememberHistory })}
          />
          <label className="pc-setting-field">
            <span className="pc-setting-icon" aria-hidden><ListFilter size={17} /></span>
            <span className="pc-setting-copy">
              <strong>Maximum saved checks</strong>
            </span>
            <select
              value={settings.maxHistory}
              disabled={!settings.rememberHistory}
              onChange={(event) => onChange({ maxHistory: Number(event.currentTarget.value) })}
            >
              <option value="10">10</option>
              <option value="25">25</option>
              <option value="50">50</option>
              <option value="100">100</option>
              <option value="200">200</option>
            </select>
          </label>
        </section>
      </div>
    </section>
  );
}
