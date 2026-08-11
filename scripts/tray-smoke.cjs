const path = require("node:path");
const { app, Menu, nativeImage, Tray } = require("electron");
const { loadTrayIcon } = require("../electron/tray-icon.cjs");

function countVisiblePixels(image) {
  const bitmap = image.toBitmap();
  let visible = 0;
  for (let index = 3; index < bitmap.length; index += 4) {
    if (bitmap[index] > 0) visible += 1;
  }
  return visible;
}

app
  .whenReady()
  .then(async () => {
    const appRoot = path.join(__dirname, "..");
    const image = loadTrayIcon(nativeImage, {
      resourcesPath: process.resourcesPath,
      appRoot,
    });
    const tray = new Tray(image);
    tray.setToolTip("GloamCore tray smoke test");
    tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: "Tray icon loaded", enabled: false },
        { label: "Close test", click: () => app.quit() },
      ]),
    );

    await new Promise((resolve) => setTimeout(resolve, 750));
    const result = {
      empty: image.isEmpty(),
      size: image.getSize(),
      pngBytes: image.toPNG().length,
      visiblePixels: countVisiblePixels(image),
      trayBounds: tray.getBounds(),
    };
    console.log(JSON.stringify(result));

    const valid =
      !result.empty &&
      result.pngBytes > 0 &&
      result.visiblePixels > 0 &&
      result.trayBounds.width > 0 &&
      result.trayBounds.height > 0;
    tray.destroy();
    app.exit(valid ? 0 : 1);
  })
  .catch((error) => {
    console.error(error);
    app.exit(1);
  });
