import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import PriceCheckApp from "./PriceCheckApp";
import { QuickSearchSurface } from "./components/QuickSearchSurface";
import { TraySurface } from "./components/TraySurface";
import { ToolkitOverlaySurface } from "./components/ToolkitOverlaySurface";
import { MapModCheckOverlaySurface } from "./components/MapModCheckOverlaySurface";
import { hydratePreferences, loadPreferences } from "./lib/preferences";
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
  document.documentElement.dataset.theme = loadPreferences().theme;
  ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
      <Root />
    </React.StrictMode>,
  );
  await configureMobileRuntime();
}

void bootstrap();
