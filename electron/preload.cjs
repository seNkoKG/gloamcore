const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("poeWidget", {
  getLeagues: (options) => ipcRenderer.invoke("economy:get-leagues", options),
  getOverview: (request) => ipcRenderer.invoke("economy:get-overview", request),
  getItemTooltip: (request) =>
    ipcRenderer.invoke("economy:get-item-tooltip", request),
  getFaustusOverview: (request) =>
    ipcRenderer.invoke("economy:get-faustus-overview", request),
  searchKnowledge: (request) => ipcRenderer.invoke("knowledge:search", request),
  readClipboardItem: () => ipcRenderer.invoke("price-check:read-clipboard"),
  getPendingPriceCheckCapture: () =>
    ipcRenderer.invoke("price-check:get-pending-capture"),
  getPriceCheckOverlayState: () =>
    ipcRenderer.invoke("price-check:get-overlay-state"),
  getTradeStatCatalog: () =>
    ipcRenderer.invoke("price-check:get-trade-stat-catalog"),
  getTradePriceSnapshot: (request) =>
    ipcRenderer.invoke("price-check:get-trade-price-snapshot", request),
  openExternal: (url) => ipcRenderer.invoke("app:open-external", url),
  openWealthyExile: (bounds) => ipcRenderer.invoke("app:open-wealthy-exile", bounds),
  hideWealthyExile: () => ipcRenderer.invoke("app:hide-wealthy-exile"),
  controlWealthyExile: (action) =>
    ipcRenderer.invoke("app:control-wealthy-exile", action),
  openCraftOfExile: (bounds) =>
    ipcRenderer.invoke("app:open-craft-of-exile", bounds),
  hideCraftOfExile: () => ipcRenderer.invoke("app:hide-craft-of-exile"),
  controlCraftOfExile: (action) =>
    ipcRenderer.invoke("app:control-craft-of-exile", action),
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
  getMapModCheck: () => ipcRenderer.invoke("map-mod-check:get"),
  saveMapModCheck: (settings) => ipcRenderer.invoke("map-mod-check:save", settings),
  checkMapMods: (text) => ipcRenderer.invoke("map-mod-check:analyse", text),
  getMapModOverlayResult: () => ipcRenderer.invoke("map-mod-check:get-overlay-result"),
  hideMapModOverlay: () => ipcRenderer.invoke("map-mod-check:hide-overlay"),
  getPoeEventLog: () => ipcRenderer.invoke("poe-event-log:get"),
  startPoeEventLog: () => ipcRenderer.invoke("poe-event-log:start"),
  stopPoeEventLog: () => ipcRenderer.invoke("poe-event-log:stop"),
  clearPoeEventLog: () => ipcRenderer.invoke("poe-event-log:clear"),
  selectPoeEventLogPath: () => ipcRenderer.invoke("poe-event-log:select-path"),
  getMappingJournal: () => ipcRenderer.invoke("mapping-journal:get"),
  updateMappingJournalSettings: (settings) =>
    ipcRenderer.invoke("mapping-journal:update-settings", settings),
  updateMappingJournalSession: (request) =>
    ipcRenderer.invoke("mapping-journal:update-session", request),
  removeMappingJournalSession: (id) =>
    ipcRenderer.invoke("mapping-journal:remove-session", id),
  clearMappingJournal: () => ipcRenderer.invoke("mapping-journal:clear", true),
  exportMappingJournalCsv: () => ipcRenderer.invoke("mapping-journal:export-csv"),
  getPassiveTreeData: (options) => ipcRenderer.invoke("planner:get-passive-tree", options),
  decodePobBuild: (input) => ipcRenderer.invoke("planner:decode-pob", input),
  encodePobBuild: (input) => ipcRenderer.invoke("planner:encode-pob", input),
  diagnosePobEngine: () => ipcRenderer.invoke("planner:diagnose-engine"),
  calculatePobBuild: (request) => ipcRenderer.invoke("planner:calculate-build", request),
  analyzePobNodes: (request) => ipcRenderer.invoke("planner:analyze-nodes", request),
  previewPobTimeless: (request) => ipcRenderer.invoke("planner:preview-timeless", request),
  huntPobTimeless: (request) => ipcRenderer.invoke("planner:hunt-timeless", request),
  readPlannerClipboard: () => ipcRenderer.invoke("planner:read-clipboard"),
  resolvePlannerItemArtwork: (request) => ipcRenderer.invoke("planner:resolve-item-artwork", request),
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
  onPoeEventLog: (callback) => {
    const listener = (_event, value) => callback(value);
    ipcRenderer.on("poe-event-log:update", listener);
    return () => ipcRenderer.removeListener("poe-event-log:update", listener);
  },
  onMappingJournal: (callback) => {
    const listener = (_event, value) => callback(value);
    ipcRenderer.on("mapping-journal:update", listener);
    return () => ipcRenderer.removeListener("mapping-journal:update", listener);
  },
});
