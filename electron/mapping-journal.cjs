const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const STORE_VERSION = 1;
const MAX_STORE_BYTES = 16 * 1024 * 1024;
const MAX_SESSIONS = 25_000;
// A relevant Client.txt line is always much larger than 64 bytes. Retaining
// this many hashes therefore covers every relevant line that can fit in the
// Event Log's bounded 4 MiB restart window without persisting raw text.
const MAX_SEEN_LINES = 65_536;
const MAX_NOTE_LENGTH = 2_000;
const MAX_TAGS = 12;
const MAX_TAG_LENGTH = 32;
const MAX_CHARACTER_LENGTH = 64;
const MAX_AREA_NAME_LENGTH = 160;
const MAX_AREA_ID_LENGTH = 128;
const MAX_PAIR_DELAY_MS = 2 * 60 * 1_000;

function parseTimestamp(value) {
  const match = /^(\d{4})\/(\d{2})\/(\d{2}) (\d{2}):(\d{2}):(\d{2})/.exec(value);
  if (!match) return null;
  const timestamp = new Date(
    Number(match[1]), Number(match[2]) - 1, Number(match[3]),
    Number(match[4]), Number(match[5]), Number(match[6]),
  ).getTime();
  return Number.isFinite(timestamp) ? timestamp : null;
}

function clientProcessId(line) {
  return /\[(?:DEBUG|INFO) Client (\d+)\]/.exec(line)?.[1] || "";
}

function logBody(line) {
  const bracket = line.indexOf("]");
  return bracket >= 0 ? line.slice(bracket + 1).trim() : "";
}

function parseMappingJournalLine(rawLine) {
  const line = String(rawLine || "").replace(/\r$/, "");
  const timestamp = parseTimestamp(line);
  if (timestamp == null) return null;
  if (line.endsWith("***** LOG FILE OPENING *****")) {
    return { kind: "opening", timestamp };
  }
  const clientId = clientProcessId(line);
  if (!clientId) return null;
  const body = logBody(line);

  const instance = /^Client-Safe Instance ID = (\d+)$/.exec(body);
  if (instance) {
    return { kind: "instance", timestamp, clientId, instanceId: instance[1] };
  }

  const generated = /^Generating level (\d+) area "([^"]+)" with seed (\d+)$/.exec(body);
  if (generated) {
    const areaLevel = Number(generated[1]);
    const areaId = generated[2];
    if (!Number.isSafeInteger(areaLevel) || areaId.length > MAX_AREA_ID_LENGTH) return null;
    return {
      kind: "generated",
      timestamp,
      clientId,
      areaLevel,
      areaId,
      seed: generated[3],
      isMapWorld: areaId.startsWith("MapWorlds"),
    };
  }

  if (!body.startsWith(": ")) return null;
  const systemMessage = body.slice(2);
  const entered = /^You have entered (.+)\.$/.exec(systemMessage);
  if (entered && entered[1].length <= MAX_AREA_NAME_LENGTH) {
    return { kind: "entered", timestamp, clientId, areaName: entered[1] };
  }
  const death = /^(.+?) (has been slain|has committed suicide)\.$/.exec(systemMessage);
  if (death && death[1].length <= MAX_CHARACTER_LENGTH) {
    return {
      kind: "death",
      timestamp,
      clientId,
      character: death[1].normalize("NFC"),
      cause: death[2] === "has committed suicide" ? "suicide" : "slain",
    };
  }
  return null;
}

function cleanCharacter(value) {
  return String(value || "").replace(/[\0\r\n]/g, "").trim().normalize("NFC").slice(0, MAX_CHARACTER_LENGTH);
}

function cleanTags(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  const tags = [];
  for (const candidate of value) {
    const tag = String(candidate || "").replace(/[\0\r\n,]/g, " ").replace(/\s+/g, " ").trim().slice(0, MAX_TAG_LENGTH);
    const key = tag.toLocaleLowerCase();
    if (!tag || seen.has(key)) continue;
    seen.add(key);
    tags.push(tag);
    if (tags.length === MAX_TAGS) break;
  }
  return tags;
}

function cleanNote(value) {
  return String(value || "").replace(/\0/g, "").slice(0, MAX_NOTE_LENGTH);
}

function cleanInteger(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

function cleanTimestamp(value) {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : null;
}

function sanitizeSession(value) {
  const id = String(value?.id || "").replace(/[^a-f0-9]/g, "").slice(0, 64);
  const areaId = String(value?.areaId || "").slice(0, MAX_AREA_ID_LENGTH);
  const areaName = String(value?.areaName || "").replace(/[\0\r\n]/g, " ").trim().slice(0, MAX_AREA_NAME_LENGTH);
  const firstEnteredAt = cleanTimestamp(value?.firstEnteredAt);
  if (!id || !areaId.startsWith("MapWorlds") || !areaName || firstEnteredAt == null) return null;
  return {
    id,
    areaName,
    areaId,
    areaLevel: Math.min(100, cleanInteger(value?.areaLevel)),
    firstEnteredAt,
    lastEnteredAt: cleanTimestamp(value?.lastEnteredAt) ?? firstEnteredAt,
    lastExitedAt: cleanTimestamp(value?.lastExitedAt),
    entries: Math.max(1, cleanInteger(value?.entries, 1)),
    activeMilliseconds: cleanInteger(value?.activeMilliseconds),
    deaths: cleanInteger(value?.deaths),
    lastDeathAt: cleanTimestamp(value?.lastDeathAt),
    timingIncomplete: Boolean(value?.timingIncomplete),
    notes: cleanNote(value?.notes),
    tags: cleanTags(value?.tags),
  };
}

function emptyRuntime() {
  return {
    sourceIdentity: "",
    seenLineHashes: [],
    instanceByClient: {},
    generationByClient: {},
    currentVisit: null,
  };
}

function sanitizeRuntime(value, sessionIds) {
  const runtime = emptyRuntime();
  runtime.sourceIdentity = String(value?.sourceIdentity || "").slice(0, 240);
  runtime.seenLineHashes = Array.isArray(value?.seenLineHashes)
    ? value.seenLineHashes.filter((hash) => /^[a-f0-9]{64}$/.test(hash)).slice(-MAX_SEEN_LINES)
    : [];
  // Instance IDs and seeds are process-local pairing inputs. Never rehydrate
  // them from disk, even if a hand-edited or future store contains them.
  const currentSessionId = String(value?.currentVisit?.sessionId || "");
  const enteredAt = cleanTimestamp(value?.currentVisit?.enteredAt);
  if (sessionIds.has(currentSessionId) && enteredAt != null) {
    runtime.currentVisit = { sessionId: currentSessionId, enteredAt };
  }
  return runtime;
}

function sanitizeStore(value) {
  const sessions = [];
  const ids = new Set();
  if (Array.isArray(value?.sessions)) {
    for (const candidate of value.sessions.slice(-MAX_SESSIONS)) {
      const session = sanitizeSession(candidate);
      if (!session || ids.has(session.id)) continue;
      ids.add(session.id);
      sessions.push(session);
    }
  }
  return {
    version: STORE_VERSION,
    settings: {
      version: STORE_VERSION,
      enabled: Boolean(value?.settings?.enabled),
      activeCharacter: cleanCharacter(value?.settings?.activeCharacter),
    },
    sessions,
    runtime: sanitizeRuntime(value?.runtime, ids),
  };
}

function lineHash(line) {
  return crypto.createHash("sha256").update(line, "utf8").digest("hex");
}

function sessionId(sourceIdentity, generation) {
  return crypto.createHash("sha256").update([
    "gloamcore-map-session-v1",
    sourceIdentity,
    generation.instanceId,
    generation.areaId,
    generation.seed,
  ].join("\0"), "utf8").digest("hex");
}

function csvCell(value) {
  const text = String(value ?? "");
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function mappingJournalCsv(sessions) {
  const columns = [
    "started_iso_utc", "last_entry_iso_utc", "last_exit_iso_utc", "area", "internal_area",
    "area_level", "entries", "observed_seconds", "deaths", "timing_incomplete", "tags", "notes",
  ];
  const rows = sessions.map((session) => [
    new Date(session.firstEnteredAt).toISOString(),
    new Date(session.lastEnteredAt).toISOString(),
    session.lastExitedAt == null ? "" : new Date(session.lastExitedAt).toISOString(),
    session.areaName,
    session.areaId,
    session.areaLevel,
    session.entries,
    Math.floor(session.activeMilliseconds / 1_000),
    session.deaths,
    session.timingIncomplete,
    session.tags.join(" | "),
    session.notes,
  ]);
  return `${[columns, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n")}\r\n`;
}

function createMappingJournalService({ storePath } = {}) {
  let store = sanitizeStore(null);
  let storageError = "";
  const listeners = new Set();

  function publicState() {
    return {
      settings: { ...store.settings },
      sessions: store.sessions.map((session) => ({ ...session, tags: [...session.tags] })),
      activeSessionId: store.runtime.currentVisit?.sessionId || "",
      activeSince: store.runtime.currentVisit?.enteredAt || null,
      storageError,
      limits: {
        sessions: MAX_SESSIONS,
        noteLength: MAX_NOTE_LENGTH,
        tags: MAX_TAGS,
        tagLength: MAX_TAG_LENGTH,
      },
    };
  }

  function publish() {
    const state = publicState();
    for (const listener of listeners) listener(state);
    return state;
  }

  function serialize() {
    const durable = {
      ...store,
      runtime: {
        sourceIdentity: store.runtime.sourceIdentity,
        seenLineHashes: store.runtime.seenLineHashes,
        // Pairing state is process-local. Persist no raw instance ID or seed.
        instanceByClient: {},
        generationByClient: {},
        currentVisit: store.runtime.currentVisit,
      },
    };
    const text = `${JSON.stringify(durable, null, 2)}${os.EOL}`;
    if (Buffer.byteLength(text, "utf8") > MAX_STORE_BYTES) {
      throw new Error("The Mapping Journal reached its 16 MB local safety limit. Export CSV and remove older sessions before adding more notes.");
    }
    return text;
  }

  function save() {
    if (!storePath) return;
    const target = path.resolve(storePath);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const temporary = `${target}.${process.pid}.${crypto.randomUUID()}.tmp`;
    try {
      fs.writeFileSync(temporary, serialize(), "utf8");
      fs.renameSync(temporary, target);
    } finally {
      try { fs.unlinkSync(temporary); } catch (error) { if (error?.code !== "ENOENT") throw error; }
    }
    storageError = "";
  }

  function load() {
    if (!storePath) return publicState();
    try {
      const stat = fs.lstatSync(storePath);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_STORE_BYTES) {
        throw new Error("Mapping Journal storage is not a regular file within the 16 MB limit.");
      }
      store = sanitizeStore(JSON.parse(fs.readFileSync(storePath, "utf8")));
      if (store.runtime.currentVisit) {
        resetObservation(true);
        save();
      }
    } catch (error) {
      if (error?.code !== "ENOENT") {
        storageError = `Mapping Journal storage could not be loaded: ${String(error?.message || error)}`;
      }
    }
    return publicState();
  }

  function resetObservation(markIncomplete = true) {
    const activeId = store.runtime.currentVisit?.sessionId;
    if (markIncomplete && activeId) {
      const session = store.sessions.find((entry) => entry.id === activeId);
      if (session) session.timingIncomplete = true;
    }
    store.runtime.instanceByClient = {};
    store.runtime.generationByClient = {};
    store.runtime.currentVisit = null;
  }

  function transition(timestamp, session) {
    const current = store.runtime.currentVisit;
    if (current) {
      const previous = store.sessions.find((entry) => entry.id === current.sessionId);
      if (previous) {
        if (timestamp >= current.enteredAt) {
          previous.activeMilliseconds += timestamp - current.enteredAt;
          previous.lastExitedAt = timestamp;
        } else {
          previous.timingIncomplete = true;
        }
      }
    }
    store.runtime.currentVisit = session ? { sessionId: session.id, enteredAt: timestamp } : null;
  }

  function processRecord(record) {
    if (record.kind === "opening") {
      resetObservation(true);
      return;
    }
    if (record.kind === "instance") {
      store.runtime.instanceByClient[record.clientId] = {
        instanceId: record.instanceId,
        timestamp: record.timestamp,
      };
      return;
    }
    if (record.kind === "generated") {
      // Area generation is the first observed boundary out of the previous
      // area. Stop its timer here so loading screens are never counted.
      if (store.runtime.currentVisit) transition(record.timestamp, null);
      const instance = store.runtime.instanceByClient[record.clientId];
      delete store.runtime.instanceByClient[record.clientId];
      const instanceDelay = instance ? record.timestamp - instance.timestamp : -1;
      store.runtime.generationByClient[record.clientId] = {
        timestamp: record.timestamp,
        instanceId: instance && instanceDelay >= 0 && instanceDelay <= MAX_PAIR_DELAY_MS
          ? instance.instanceId
          : "",
        areaLevel: record.areaLevel,
        areaId: record.areaId,
        seed: record.seed,
        isMapWorld: record.isMapWorld,
      };
      return;
    }
    if (record.kind === "entered") {
      const generation = store.runtime.generationByClient[record.clientId];
      delete store.runtime.generationByClient[record.clientId];
      if (!generation || record.timestamp < generation.timestamp || record.timestamp - generation.timestamp > MAX_PAIR_DELAY_MS) {
        return;
      }
      if (!generation.isMapWorld) {
        transition(record.timestamp, null);
        return;
      }
      // Current clients expose this non-network instance identifier. Without it,
      // a seed or display name is not authoritative enough to create a session.
      if (!generation.instanceId) return;
      const id = sessionId(store.runtime.sourceIdentity, generation);
      let session = store.sessions.find((entry) => entry.id === id);
      if (!session) {
        if (store.sessions.length >= MAX_SESSIONS) {
          storageError = "Mapping Journal is full. Export CSV and remove older sessions; no session was discarded automatically.";
          transition(record.timestamp, null);
          return;
        }
        session = {
          id,
          areaName: record.areaName,
          areaId: generation.areaId,
          areaLevel: generation.areaLevel,
          firstEnteredAt: record.timestamp,
          lastEnteredAt: record.timestamp,
          lastExitedAt: null,
          entries: 1,
          activeMilliseconds: 0,
          deaths: 0,
          lastDeathAt: null,
          timingIncomplete: false,
          notes: "",
          tags: [],
        };
        store.sessions.push(session);
      } else {
        session.areaName = record.areaName;
        session.areaLevel = generation.areaLevel;
        session.lastEnteredAt = record.timestamp;
        session.entries += 1;
      }
      transition(record.timestamp, session);
      return;
    }
    if (record.kind === "death") {
      const current = store.runtime.currentVisit;
      if (!current || !store.settings.activeCharacter || record.character !== store.settings.activeCharacter) return;
      const session = store.sessions.find((entry) => entry.id === current.sessionId);
      if (!session || record.timestamp < current.enteredAt) return;
      session.deaths += 1;
      session.lastDeathAt = record.timestamp;
    }
  }

  function ingestLines(lines, sourceIdentity) {
    const identity = String(sourceIdentity || "").slice(0, 240);
    if (!store.settings.enabled || !identity || !Array.isArray(lines) || !lines.length) return publicState();
    const previousStore = store;
    store = sanitizeStore(store);
    if (identity !== store.runtime.sourceIdentity) {
      resetObservation(true);
      store.runtime.sourceIdentity = identity;
      store.runtime.seenLineHashes = [];
    }
    const seen = new Set(store.runtime.seenLineHashes);
    let changed = false;
    for (const rawLine of lines) {
      const record = parseMappingJournalLine(rawLine);
      if (!record) continue;
      const hash = lineHash(String(rawLine));
      if (seen.has(hash)) continue;
      seen.add(hash);
      store.runtime.seenLineHashes.push(hash);
      if (store.runtime.seenLineHashes.length > MAX_SEEN_LINES) {
        const removed = store.runtime.seenLineHashes.shift();
        seen.delete(removed);
      }
      processRecord(record);
      changed = true;
    }
    if (changed) {
      try {
        save();
      } catch (error) {
        store = previousStore;
        storageError = `Mapping Journal could not persist new observations: ${String(error?.message || error)}`;
      }
      publish();
    }
    return publicState();
  }

  function updateSettings(value) {
    const previousStore = store;
    store = sanitizeStore(store);
    const wasEnabled = store.settings.enabled;
    store.settings = {
      version: STORE_VERSION,
      enabled: Boolean(value?.enabled),
      activeCharacter: cleanCharacter(value?.activeCharacter),
    };
    if (wasEnabled && !store.settings.enabled) resetObservation(true);
    try {
      save();
    } catch (error) {
      store = previousStore;
      storageError = `Mapping Journal settings could not be saved: ${String(error?.message || error)}`;
      publish();
      throw error;
    }
    return publish();
  }

  function updateSession(request) {
    const id = String(request?.id || "");
    const session = store.sessions.find((entry) => entry.id === id);
    if (!session) throw new Error("Mapping Journal session was not found.");
    const previous = { notes: session.notes, tags: session.tags };
    session.notes = cleanNote(request?.notes);
    session.tags = cleanTags(request?.tags);
    try {
      save();
    } catch (error) {
      session.notes = previous.notes;
      session.tags = previous.tags;
      throw error;
    }
    return publish();
  }

  function removeSession(id) {
    const previousStore = store;
    store = sanitizeStore(store);
    const index = store.sessions.findIndex((entry) => entry.id === String(id || ""));
    if (index < 0) throw new Error("Mapping Journal session was not found.");
    if (store.runtime.currentVisit?.sessionId === store.sessions[index].id) {
      store.runtime.currentVisit = null;
    }
    store.sessions.splice(index, 1);
    try {
      save();
    } catch (error) {
      store = previousStore;
      storageError = `Mapping Journal session could not be removed: ${String(error?.message || error)}`;
      publish();
      throw error;
    }
    return publish();
  }

  function clearSessions(confirm) {
    if (confirm !== true) throw new Error("Mapping Journal clearing requires explicit confirmation.");
    const previousStore = store;
    store = sanitizeStore(store);
    store.sessions = [];
    store.runtime = emptyRuntime();
    try {
      save();
    } catch (error) {
      store = previousStore;
      storageError = `Mapping Journal could not be cleared: ${String(error?.message || error)}`;
      publish();
      throw error;
    }
    return publish();
  }

  function suspendObservation() {
    if (!store.runtime.currentVisit) return publicState();
    const previousStore = store;
    store = sanitizeStore(store);
    resetObservation(true);
    try {
      save();
    } catch (error) {
      store = previousStore;
      storageError = `Mapping Journal could not persist an interrupted session: ${String(error?.message || error)}`;
    }
    return publish();
  }

  function saveCsv(filePath) {
    const target = path.resolve(String(filePath || ""));
    if (path.extname(target).toLowerCase() !== ".csv") {
      throw new Error("Mapping Journal exports must use the .csv extension.");
    }
    if (fs.existsSync(target)) {
      const stat = fs.lstatSync(target);
      if (!stat.isFile() || stat.isSymbolicLink()) {
        throw new Error("The Mapping Journal export target must be a regular file.");
      }
    }
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const temporary = path.join(path.dirname(target), `.${path.basename(target)}.${crypto.randomUUID()}.tmp`);
    fs.writeFileSync(temporary, mappingJournalCsv(store.sessions), "utf8");
    fs.renameSync(temporary, target);
    return { path: target, name: path.basename(target), rows: store.sessions.length };
  }

  load();
  return {
    clearSessions,
    exportCsv: () => mappingJournalCsv(store.sessions),
    getState: publicState,
    ingestLines,
    load,
    removeSession,
    saveCsv,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    suspendObservation,
    updateSession,
    updateSettings,
  };
}

module.exports = {
  MAX_SESSIONS,
  createMappingJournalService,
  mappingJournalCsv,
  parseMappingJournalLine,
};
