import React from "react";
import ReactDOM from "react-dom/client";
import {
  applyDisplayPreferences,
  hydratePreferences,
  loadPreferences,
  PREFERENCES_STORAGE_KEY,
} from "./lib/preferences";
import { configureMobileRuntime, isMobileApp } from "./lib/platform";
import { RuntimeErrorBoundary } from "./components/RuntimeErrorBoundary";
import "./styles.css";

const surface = new URLSearchParams(window.location.search).get("surface");
document.documentElement.dataset.surface = surface || "dashboard";
if (isMobileApp) document.documentElement.dataset.mobile = "true";

const rootElement = document.getElementById("root");
if (!rootElement) throw new Error("GloamCore could not find its application root.");
const applicationRoot = ReactDOM.createRoot(rootElement);

function BootstrapFailure() {
  return (
    <main className="runtime-error runtime-error--bootstrap" role="alert">
      <strong>GloamCore could not start</strong>
      <p>The application files or saved display preferences could not be loaded.</p>
      <button type="button" className="is-primary" onClick={() => window.location.reload()}>
        Retry startup
      </button>
    </main>
  );
}

function renderBootstrapFailure(error: unknown) {
  console.error("GloamCore startup failure", error);
  applicationRoot.render(<BootstrapFailure />);
}

async function bootstrap() {
  await hydratePreferences();
  applyDisplayPreferences(loadPreferences(), document.documentElement);
  const Root =
    surface === "map-mod-check"
      ? (await import("./components/MapModCheckOverlaySurface"))
          .MapModCheckOverlaySurface
      : surface?.startsWith("toolkit-overlay-")
      ? (await import("./components/ToolkitOverlaySurface"))
          .ToolkitOverlaySurface
      : surface === "tray"
      ? (await import("./components/TraySurface")).TraySurface
      : surface === "quick"
        ? (await import("./components/QuickSearchSurface")).QuickSearchSurface
        : surface === "price-check"
          ? (await import("./PriceCheckApp")).default
        : (await import("./App")).default;
  window.addEventListener("storage", (event) => {
    if (event.storageArea && event.storageArea !== localStorage) return;
    if (event.key !== PREFERENCES_STORAGE_KEY && event.key !== null) return;
    applyDisplayPreferences(loadPreferences(), document.documentElement);
  });
  applicationRoot.render(
    <React.StrictMode>
      <RuntimeErrorBoundary resetKey={surface || "dashboard"} title="GloamCore stopped unexpectedly">
        <Root />
      </RuntimeErrorBoundary>
    </React.StrictMode>,
  );
  void configureMobileRuntime().catch((error) => {
    console.error("GloamCore mobile runtime configuration failed", error);
  });
}

void bootstrap().catch(renderBootstrapFailure);
