import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import PriceCheckApp from "./PriceCheckApp";
import { QuickSearchSurface } from "./components/QuickSearchSurface";
import { TraySurface } from "./components/TraySurface";
import { ToolkitOverlaySurface } from "./components/ToolkitOverlaySurface";
import { MapModCheckOverlaySurface } from "./components/MapModCheckOverlaySurface";
import {
  applyDisplayPreferences,
  hydratePreferences,
  loadPreferences,
  PREFERENCES_STORAGE_KEY,
} from "./lib/preferences";
import { configureMobileRuntime, isMobileApp } from "./lib/platform";
import "./styles.css";

const surface = new URLSearchParams(window.location.search).get("surface");
document.documentElement.dataset.surface = surface || "dashboard";
if (isMobileApp) document.documentElement.dataset.mobile = "true";

const Root =
  surface === "map-mod-check"
    ? MapModCheckOverlaySurface
    : surface?.startsWith("toolkit-overlay-")
    ? ToolkitOverlaySurface
    : surface === "tray"
    ? TraySurface
    : surface === "quick"
      ? QuickSearchSurface
      : surface === "price-check"
        ? PriceCheckApp
      : App;

async function bootstrap() {
  await hydratePreferences();
  applyDisplayPreferences(loadPreferences(), document.documentElement);
  window.addEventListener("storage", (event) => {
    if (event.storageArea && event.storageArea !== localStorage) return;
    if (event.key !== PREFERENCES_STORAGE_KEY && event.key !== null) return;
    applyDisplayPreferences(loadPreferences(), document.documentElement);
  });
  ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
      <Root />
    </React.StrictMode>,
  );
  await configureMobileRuntime();
}

void bootstrap();
