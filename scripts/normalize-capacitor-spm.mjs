import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

export const CAPACITOR_SPM_PATHS = Object.freeze({
  CapacitorApp: "../../../node_modules/@capacitor/app",
  CapacitorBrowser: "../../../node_modules/@capacitor/browser",
  CapacitorHaptics: "../../../node_modules/@capacitor/haptics",
  CapacitorLocalNotifications: "../../../node_modules/@capacitor/local-notifications",
  CapacitorNetwork: "../../../node_modules/@capacitor/network",
  CapacitorPreferences: "../../../node_modules/@capacitor/preferences",
  CapacitorSplashScreen: "../../../node_modules/@capacitor/splash-screen",
  CapacitorStatusBar: "../../../node_modules/@capacitor/status-bar",
});

export function normalizeCapacitorSpmManifest(input) {
  let source = String(input).replace(/\r\n?/g, "\n");
  if (!source.includes("managed by Capacitor CLI commands")) {
    throw new Error("Refusing to normalize an unmanaged Swift package manifest.");
  }
  for (const [name, stablePath] of Object.entries(CAPACITOR_SPM_PATHS)) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pattern = new RegExp(`\\.package\\(name: "${escaped}", path: "[^"]*"\\)`, "g");
    const matches = source.match(pattern) || [];
    if (matches.length !== 1) {
      throw new Error(`Expected exactly one ${name} local package, found ${matches.length}.`);
    }
    source = source.replace(pattern, `.package(name: "${name}", path: "${stablePath}")`);
  }
  const localPaths = [...source.matchAll(/\.package\(name: "[^"]+", path: "([^"]*)"\)/g)];
  for (const match of localPaths) {
    const localPath = match[1];
    if (localPath.includes("\\") || localPath.includes(".pnpm") || /^[A-Za-z]:|^\//.test(localPath)) {
      throw new Error(`Unsafe or machine-specific Swift package path remains: ${localPath}`);
    }
  }
  return `${source.trimEnd()}\n`;
}

const scriptPath = fileURLToPath(import.meta.url);
if (process.argv[1] && resolve(process.argv[1]) === scriptPath) {
  const repoRoot = dirname(dirname(scriptPath));
  const manifestPath = join(repoRoot, "ios", "App", "CapApp-SPM", "Package.swift");
  const before = readFileSync(manifestPath, "utf8");
  const after = normalizeCapacitorSpmManifest(before);
  if (after !== before) writeFileSync(manifestPath, after, "utf8");
}
