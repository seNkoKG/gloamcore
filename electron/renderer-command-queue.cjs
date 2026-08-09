"use strict";

function activeWebContents(window) {
  if (!window || window.isDestroyed?.()) return null;
  const webContents = window.webContents;
  if (!webContents || webContents.isDestroyed?.()) return null;
  return webContents;
}

function createRendererCommandQueue({ channel = "shortcut", maxSize = 24 } = {}) {
  const limit = Math.max(1, Math.floor(Number(maxSize) || 24));
  const pending = [];
  let readyWebContents = null;

  function markLoading() {
    readyWebContents = null;
  }

  function enqueue(command, front = false) {
    if (front) pending.unshift(command);
    else pending.push(command);
    if (pending.length > limit) pending.splice(0, pending.length - limit);
  }

  function send(window, command) {
    const webContents = activeWebContents(window);
    if (
      webContents &&
      readyWebContents === webContents &&
      !webContents.isLoadingMainFrame?.()
    ) {
      try {
        webContents.send(channel, command);
        return true;
      } catch {
        readyWebContents = null;
      }
    }
    enqueue(command);
    return false;
  }

  function markReady(window) {
    const webContents = activeWebContents(window);
    if (!webContents || webContents.isLoadingMainFrame?.()) return 0;
    readyWebContents = webContents;
    const commands = pending.splice(0, pending.length);
    let sent = 0;
    for (let index = 0; index < commands.length; index += 1) {
      const command = commands[index];
      try {
        webContents.send(channel, command);
        sent += 1;
      } catch {
        readyWebContents = null;
        const unsent = commands.slice(index);
        for (let pendingIndex = unsent.length - 1; pendingIndex >= 0; pendingIndex -= 1) {
          enqueue(unsent[pendingIndex], true);
        }
        break;
      }
    }
    return sent;
  }

  return {
    markLoading,
    markReady,
    send,
    pendingCount: () => pending.length,
  };
}

module.exports = { createRendererCommandQueue };
