import {
  AppWindow,
  ChevronsDownUp,
  ChevronsUpDown,
  EyeOff,
  Maximize2,
  Minus,
  Pin,
  PinOff,
  Settings,
  X,
} from "lucide-react";
import { isDesktop } from "../lib/bridge";

export function Titlebar({
  alwaysOnTop,
  compact,
  clickThrough,
  onAlwaysOnTop,
  onCompact,
  onOpenSettings,
}: {
  alwaysOnTop: boolean;
  compact: boolean;
  clickThrough: boolean;
  onAlwaysOnTop: (value: boolean) => void;
  onCompact: (value: boolean) => void;
  onOpenSettings: () => void;
}) {
  const action = (name: string, payload?: unknown) =>
    window.poeWidget?.windowAction(name, payload);

  return (
    <header className="titlebar">
      <div className="titlebar-brand">
        <div className="brand-mark" aria-hidden>
          <span>P</span>
        </div>
        <div className="brand-copy">
          <span className="brand-title">NINJA LENS</span>
          <span className="brand-kicker">POE 1 ECONOMY</span>
        </div>
      </div>

      <div className="titlebar-center">
        <span className="status-pulse" />
        <span>Live market widget</span>
        {clickThrough && <span className="titlebar-mode">CLICK-THROUGH</span>}
      </div>

      <div className="window-actions">
        <button
          className="window-action"
          type="button"
          title={alwaysOnTop ? "Disable always on top" : "Keep always on top"}
          onClick={() => onAlwaysOnTop(!alwaysOnTop)}
        >
          {alwaysOnTop ? <Pin size={15} /> : <PinOff size={15} />}
        </button>
        <button
          className="window-action"
          type="button"
          title={compact ? "Expanded layout" : "Compact widget layout"}
          onClick={() => onCompact(!compact)}
        >
          {compact ? <ChevronsUpDown size={16} /> : <ChevronsDownUp size={16} />}
        </button>
        <button
          className="window-action"
          type="button"
          title="Widget settings"
          onClick={onOpenSettings}
        >
          <Settings size={16} />
        </button>
        {isDesktop ? (
          <>
            <div className="window-divider" />
            <button
              className="window-action"
              type="button"
              title="Minimize"
              onClick={() => action("minimize")}
            >
              <Minus size={16} />
            </button>
            <button
              className="window-action window-action--expanded-only"
              type="button"
              title="Maximize"
              onClick={() => action("toggle-maximize")}
            >
              <Maximize2 size={14} />
            </button>
            <button
              className="window-action window-action--close"
              type="button"
              title="Hide to tray"
              onClick={() => action("close")}
            >
              <X size={17} />
            </button>
          </>
        ) : (
          <div className="browser-preview-badge" title="Browser preview mode">
            <AppWindow size={13} />
            Preview
          </div>
        )}
      </div>
      <div className="keyboard-hint" aria-hidden>
        <EyeOff size={12} />
        Ctrl Shift L
      </div>
    </header>
  );
}
