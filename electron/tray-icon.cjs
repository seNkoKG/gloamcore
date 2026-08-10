const path = require("node:path");

function trayIconCandidates(resourcesPath, appRoot) {
  return [
    path.join(resourcesPath, "tray.ico"),
    path.join(resourcesPath, "tray.png"),
    path.join(appRoot, "build", "tray.ico"),
    path.join(appRoot, "build", "tray.png"),
    path.join(appRoot, "build", "icon.ico"),
    path.join(appRoot, "build", "icon.png"),
  ];
}

function loadTrayIcon(nativeImage, { resourcesPath, appRoot }) {
  const failures = [];

  for (const candidate of trayIconCandidates(resourcesPath, appRoot)) {
    try {
      const image = nativeImage.createFromPath(candidate);
      if (!image.isEmpty()) {
        return image;
      }
      failures.push(`${candidate} (empty image)`);
    } catch (error) {
      failures.push(
        `${candidate} (${error instanceof Error ? error.message : String(error)})`,
      );
    }
  }

  throw new Error(
    `Unable to load a visible Ninja Lens tray icon. Tried: ${failures.join(", ")}`,
  );
}

module.exports = {
  loadTrayIcon,
  trayIconCandidates,
};
