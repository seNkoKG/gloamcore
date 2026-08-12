const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { StringDecoder } = require("node:string_decoder");

const MAX_EVENTS = 500;
const MAX_HISTORY_BYTES = 4 * 1024 * 1024;
const READ_CHUNK_BYTES = 256 * 1024;
const MAX_PARTIAL_LINE_BYTES = 256 * 1024;

function parseTimestamp(value) {
  const match = /^(\d{4})\/(\d{2})\/(\d{2}) (\d{2}):(\d{2}):(\d{2})/.exec(value);
  if (!match) return null;
  return new Date(
    Number(match[1]), Number(match[2]) - 1, Number(match[3]),
    Number(match[4]), Number(match[5]), Number(match[6]),
  ).getTime();
}

function parsePoeEventLogLine(rawLine, id = 0) {
  const line = String(rawLine || "").replace(/\r$/, "");
  const timestamp = parseTimestamp(line);
  if (timestamp == null) return null;
  const prefix = line.slice(0, 19);
  const bracket = line.indexOf("]");
  const message = (bracket >= 0 ? line.slice(bracket + 1) : line.slice(19))
    .replace(/^\s*(?::\s*)?/, "")
    .trim();
  if (!message) return null;

  let category = "other";
  let title = "Game event";
  if (/^@(From|To)\b/i.test(message)) {
    category = "whisper"; title = /^@From\b/i.test(message) ? "Whisper received" : "Whisper sent";
  } else if (/^\$/i.test(message)) {
    category = "trade"; title = "Trade chat";
  } else if (/^[#%]/.test(message)) {
    category = "chat"; title = message.startsWith("%") ? "Guild chat" : "Global chat";
  } else if (/^&/.test(message)) {
    category = "party"; title = "Party chat";
  } else if (/Generating level \d+ area\b/i.test(message) || /You have entered\b/i.test(message) || /Joined area\b/i.test(message) || /Left area\b/i.test(message)) {
    category = "zone"; title = /Generating level (\d+) area\s+"([^"]+)"/i.exec(message)?.slice(1).join(" · ") || "Area changed";
  } else if (/\b(?:is now|reached) level \d+\b/i.test(message) || /You have gained a level/i.test(message)) {
    category = "level"; title = "Level gained";
  } else if (/\b(?:has been slain|was slain|died)(?:\b|$)/i.test(message)) {
    category = "death"; title = "Death";
  } else if (/\b(?:AFK mode is now|DND mode is now|Auto-reply mode is now|You are now AFK|You are no longer AFK)\b/i.test(message)) {
    category = "status"; title = "Status changed";
  } else if (/\b(?:has joined the party|has left the party|You have joined the party|You have left the party|Party created|Party disbanded)\b/i.test(message)) {
    category = "party"; title = "Party event";
  } else if (/\b(?:Trade accepted|Trade cancelled|trade has been accepted|trade has been cancelled)\b/i.test(message)) {
    category = "trade"; title = "Trade event";
  } else if (/\b\d+ Items? identified\b/i.test(message) || /Item on cursor destroyed/i.test(message)) {
    category = "items"; title = "Item event";
  }
  return { id: Number(id), timestamp, time: prefix.slice(11), category, title, message };
}

function defaultLogCandidates() {
  const values = [
    path.join(process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)", "Steam", "steamapps", "common", "Path of Exile", "logs", "Client.txt"),
    path.join(process.env.ProgramFiles || "C:\\Program Files", "Grinding Gear Games", "Path of Exile", "logs", "Client.txt"),
    path.join(process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)", "Grinding Gear Games", "Path of Exile", "logs", "Client.txt"),
    path.join(process.env.ProgramFiles || "C:\\Program Files", "Epic Games", "PathOfExile", "logs", "Client.txt"),
  ];
  return [...new Set(values.map((value) => path.resolve(value)))];
}

function detectPoeLogPath() {
  return defaultLogCandidates().find((candidate) => {
    try { return fs.statSync(candidate).isFile(); } catch { return false; }
  }) || "";
}

function normalizeClientLogPath(value) {
  if (typeof value !== "string" || !value.trim()) return "";
  const resolved = path.resolve(value.trim());
  return path.basename(resolved).toLowerCase() === "client.txt" ? resolved : "";
}

function assertSelectableClientLogPath(value) {
  const resolved = normalizeClientLogPath(value);
  if (!resolved) throw new Error("Choose Path of Exile's logs\\Client.txt file.");
  const stat = fs.lstatSync(resolved);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error("Selected Client.txt must be a regular file, not a link.");
  }
  return resolved;
}

function sanitizeSettings(value, fallbackPath = "") {
  const logPath = normalizeClientLogPath(value?.logPath) || normalizeClientLogPath(fallbackPath);
  return { version: 1, logPath };
}

function createPoeEventLogService({ settingsPath, pollMilliseconds = 500 } = {}) {
  let settings = sanitizeSettings(null, detectPoeLogPath());
  let events = [];
  let status = "idle";
  let error = "";
  let offset = 0;
  let identity = "";
  let partial = "";
  let decoder = new StringDecoder("utf8");
  let timer = null;
  let sequence = 0;
  let polling = false;
  const listeners = new Set();

  function snapshot() {
    return { settings: { ...settings }, status, error, events: events.map((event) => ({ ...event })) };
  }

  function publish() {
    const value = snapshot();
    for (const listener of listeners) listener(value);
    return value;
  }

  function loadSettings() {
    if (!settingsPath) return settings;
    try {
      const parsed = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
      settings = sanitizeSettings(parsed, settings.logPath);
    } catch (caught) {
      if (caught?.code !== "ENOENT") error = "Event Log settings were corrupt; auto-detected defaults are active.";
    }
    return settings;
  }

  function saveSettings(next) {
    settings = sanitizeSettings(next, detectPoeLogPath());
    if (settingsPath) {
      fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
      const temporary = `${settingsPath}.${process.pid}.tmp`;
      fs.writeFileSync(temporary, `${JSON.stringify(settings, null, 2)}${os.EOL}`, "utf8");
      fs.renameSync(temporary, settingsPath);
    }
    return { ...settings };
  }

  function authorizePath(logPath) {
    const authorized = assertSelectableClientLogPath(logPath);
    return saveSettings({ logPath: authorized });
  }

  function appendText(text, historical = false) {
    const combined = partial + text;
    const lines = combined.split("\n");
    partial = lines.pop() || "";
    if (Buffer.byteLength(partial, "utf8") > MAX_PARTIAL_LINE_BYTES) partial = "";
    const next = [];
    for (const line of lines) {
      const event = parsePoeEventLogLine(line, ++sequence);
      if (event) next.push(event);
    }
    if (historical && next.length > MAX_EVENTS) next.splice(0, next.length - MAX_EVENTS);
    if (next.length) {
      events.push(...next);
      if (events.length > MAX_EVENTS) events.splice(0, events.length - MAX_EVENTS);
    }
    return next.length;
  }

  function readRange(filePath, start, end, historical = false) {
    if (end <= start) return 0;
    const descriptor = fs.openSync(filePath, "r");
    let position = start;
    let count = 0;
    try {
      while (position < end) {
        const size = Math.min(READ_CHUNK_BYTES, end - position);
        const buffer = Buffer.allocUnsafe(size);
        const bytes = fs.readSync(descriptor, buffer, 0, size, position);
        if (!bytes) break;
        position += bytes;
        count += appendText(decoder.write(buffer.subarray(0, bytes)), historical);
      }
    } finally {
      fs.closeSync(descriptor);
    }
    offset = position;
    return count;
  }

  function fileIdentity(stat) {
    return `${stat.dev}:${stat.ino}:${stat.birthtimeMs}`;
  }

  function openHistory(filePath) {
    const stat = fs.statSync(filePath);
    if (!stat.isFile()) throw new Error("Selected Client.txt is not a file.");
    decoder = new StringDecoder("utf8");
    partial = "";
    events = [];
    const start = Math.max(0, stat.size - MAX_HISTORY_BYTES);
    readRange(filePath, start, stat.size, true);
    identity = fileIdentity(stat);
    offset = stat.size;
  }

  function poll() {
    if (polling || status !== "watching") return;
    polling = true;
    try {
      const stat = fs.statSync(settings.logPath);
      const nextIdentity = fileIdentity(stat);
      if (nextIdentity !== identity || stat.size < offset) {
        decoder = new StringDecoder("utf8"); partial = ""; offset = 0; identity = nextIdentity;
      }
      const added = readRange(settings.logPath, offset, stat.size, false);
      if (added) publish();
    } catch (caught) {
      status = caught?.code === "ENOENT" ? "missing" : "error";
      error = caught?.code === "ENOENT" ? "Client.txt is missing. Choose the current Path of Exile log." : String(caught?.message || caught);
      stopTimer();
      publish();
    } finally {
      polling = false;
    }
  }

  function stopTimer() {
    if (timer) clearInterval(timer);
    timer = null;
  }

  function start(...requestedPaths) {
    stopTimer();
    if (requestedPaths.length) throw new Error("Client.txt paths must be authorized through the file picker.");
    error = "";
    if (!settings.logPath) {
      status = "missing";
      error = "No Path of Exile Client.txt was detected. Choose it manually.";
      return publish();
    }
    try {
      openHistory(settings.logPath);
      status = "watching";
      timer = setInterval(poll, Math.max(50, pollMilliseconds));
    } catch (caught) {
      status = caught?.code === "ENOENT" ? "missing" : "error";
      error = caught?.code === "ENOENT" ? "Client.txt is missing. Choose the current Path of Exile log." : String(caught?.message || caught);
    }
    return publish();
  }

  function stop() { stopTimer(); status = "idle"; return publish(); }
  function clear() { events = []; return publish(); }
  function subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); }
  function dispose() { stopTimer(); listeners.clear(); }

  loadSettings();
  return { authorizePath, clear, detectPoeLogPath, dispose, getState: snapshot, saveSettings, start, stop, subscribe, _poll: poll };
}

module.exports = {
  MAX_EVENTS,
  assertSelectableClientLogPath,
  createPoeEventLogService,
  defaultLogCandidates,
  detectPoeLogPath,
  parsePoeEventLogLine,
};
