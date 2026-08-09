"use strict";

function activeWebContents(window) {
  if (!window || window.isDestroyed?.()) return null;
  const webContents = window.webContents;
  if (!webContents || webContents.isDestroyed?.()) return null;
  return webContents;
}

function canAccessSettings(sender, { mainWindow, priceCheckWindow } = {}) {
  if (!sender) return false;
  return (
    sender === activeWebContents(mainWindow) ||
    sender === activeWebContents(priceCheckWindow)
  );
}

module.exports = { canAccessSettings };
