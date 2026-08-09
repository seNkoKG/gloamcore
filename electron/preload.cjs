const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("poeWidget", {
  getLeagues: (options) => ipcRenderer.invoke("economy:get-leagues", options),
  getOverview: (request) => ipcRenderer.invoke("economy:get-overview", request),
  getItemTooltip: (request) =>
    ipcRenderer.invoke("economy:get-item-tooltip", request),
  searchKnowledge: (request) => ipcRenderer.invoke("knowledge:search", request),
  readClipboardItem: () => ipcRenderer.invoke("price-check:read-clipboard"),
  getPendingPriceCheckCapture: () =>
    ipcRenderer.invoke("price-check:get-pending-capture"),
  getPriceCheckOverlayState: () =>
    ipcRenderer.invoke("price-check:get-overlay-state"),
  getTradeStatCatalog: () =>
    ipcRenderer.invoke("price-check:get-trade-stat-catalog"),
  getOfficialTradeListings: (request) =>
    ipcRenderer.invoke("price-check:get-official-listings", request),
  openExternal: (url) => ipcRenderer.invoke("app:open-external", url),
  openToolkitText: (kind) => ipcRenderer.invoke("toolkit:open-text", kind),
  openToolkitImage: () => ipcRenderer.invoke("toolkit:open-image"),
  saveToolkitText: (request) => ipcRenderer.invoke("toolkit:save-text", request),
  createToolkitCheckpoint: (request) =>
    ipcRenderer.invoke("toolkit:create-checkpoint", request),
  listToolkitCheckpoints: (filePath) =>
    ipcRenderer.invoke("toolkit:list-checkpoints", filePath),
  restoreToolkitCheckpoint: (request) =>
    ipcRenderer.invoke("toolkit:restore-checkpoint", request),
  fetchToolkitText: (url) => ipcRenderer.invoke("toolkit:fetch-text", url),
  getRegexDataPack: () => ipcRenderer.invoke("toolkit:get-regex-data"),
  getToolkitWorkspace: () => ipcRenderer.invoke("toolkit:get-workspace"),
  recoverToolkitWorkspace: () => ipcRenderer.invoke("toolkit:recover-workspace"),
  saveToolkitWorkspace: (value) => ipcRenderer.invoke("toolkit:save-workspace", value),
  showToolkitOverlay: (kind) => ipcRenderer.invoke("toolkit:show-overlay", kind),
  hideToolkitOverlay: () => ipcRenderer.invoke("toolkit:hide-overlay"),
  captureToolkitGameWindow: () => ipcRenderer.invoke("toolkit:capture-game"),
  getPassiveTreeData: (options) => ipcRenderer.invoke("planner:get-passive-tree", options),
  decodePobBuild: (input) => ipcRenderer.invoke("planner:decode-pob", input),
  encodePobBuild: (input) => ipcRenderer.invoke("planner:encode-pob", input),
  diagnosePobEngine: () => ipcRenderer.invoke("planner:diagnose-engine"),
  calculatePobBuild: (request) => ipcRenderer.invoke("planner:calculate-build", request),
  importPobCharacter: (request) => ipcRenderer.invoke("planner:import-character-pob", request),
  readPlannerClipboard: () => ipcRenderer.invoke("planner:read-clipboard"),
  listPoeCharacters: (request) => ipcRenderer.invoke("planner:list-characters", request),
  getPoeCharacter: (request) => ipcRenderer.invoke("planner:get-character", request),
  getSettings: () => ipcRenderer.invoke("settings:get"),
  saveSettings: (patch) => ipcRenderer.invoke("settings:save", patch),
  windowAction: (action, payload) => ipcRenderer.invoke("window:action", action, payload),
  publishSurfaceState: (state) => ipcRenderer.invoke("surface:publish-state", state),
  getSurfaceState: () => ipcRenderer.invoke("surface:get-state"),
  surfaceAction: (action) => ipcRenderer.invoke("surface:action", action),
  getUpdateState: () => ipcRenderer.invoke("update:get-state"),
  checkForUpdates: () => ipcRenderer.invoke("update:check"),
  installUpdate: () => ipcRenderer.invoke("update:install"),
  rendererReady: () => ipcRenderer.invoke("renderer:ready"),
  onSettingsChanged: (callback) => {
    const listener = (_event, value) => callback(value);
    ipcRenderer.on("settings:changed", listener);
    return () => ipcRenderer.removeListener("settings:changed", listener);
  },
  onShortcut: (callback) => {
    const listener = (_event, value) => callback(value);
    ipcRenderer.on("shortcut", listener);
    return () => ipcRenderer.removeListener("shortcut", listener);
  },
  onPriceCheckCapture: (callback) => {
    const listener = (_event, value) => callback(value);
    ipcRenderer.on("price-check:capture", listener);
    return () => ipcRenderer.removeListener("price-check:capture", listener);
  },
  onPriceCheckOverlayState: (callback) => {
    const listener = (_event, value) => callback(value);
    ipcRenderer.on("price-check:overlay-state", listener);
    return () =>
      ipcRenderer.removeListener("price-check:overlay-state", listener);
  },
  onSurfaceState: (callback) => {
    const listener = (_event, value) => callback(value);
    ipcRenderer.on("surface:state", listener);
    return () => ipcRenderer.removeListener("surface:state", listener);
  },
  onUpdateState: (callback) => {
    const listener = (_event, value) => callback(value);
    ipcRenderer.on("update:state", listener);
    return () => ipcRenderer.removeListener("update:state", listener);
  },
});
