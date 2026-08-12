import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import journal from "./mapping-journal.cjs";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function line(time: string, body: string, level = "DEBUG", client = "4242") {
  return `2026/08/12 ${time} 100 1186a8a3 [${level} Client ${client}] ${body}`;
}

const instance = (time: string, id: string, client = "4242") =>
  line(time, `Client-Safe Instance ID = ${id}`, "DEBUG", client);
const generated = (time: string, area: string, seed: string, level = 83, client = "4242") =>
  line(time, `Generating level ${level} area "${area}" with seed ${seed}`, "DEBUG", client);
const entered = (time: string, area: string, client = "4242") =>
  line(time, `: You have entered ${area}.`, "INFO", client);
const died = (time: string, character: string, suicide = false, client = "4242") =>
  line(time, `: ${character} ${suicide ? "has committed suicide" : "has been slain"}.`, "INFO", client);

describe("Mapping Journal", () => {
  it("parses only exact client system facts and rejects chat-shaped imitations", () => {
    expect(journal.parseMappingJournalLine(instance("12:00:00", "123"))).toMatchObject({
      kind: "instance", instanceId: "123", clientId: "4242",
    });
    expect(journal.parseMappingJournalLine(generated("12:00:01", "MapWorldsCitySquare", "456"))).toMatchObject({
      kind: "generated", areaId: "MapWorldsCitySquare", areaLevel: 83, seed: "456", isMapWorld: true,
    });
    expect(journal.parseMappingJournalLine(entered("12:00:02", "City Square"))).toMatchObject({
      kind: "entered", areaName: "City Square",
    });
    expect(journal.parseMappingJournalLine(died("12:00:03", "Exact_Name"))).toMatchObject({
      kind: "death", character: "Exact_Name", cause: "slain",
    });
    expect(journal.parseMappingJournalLine(line("12:00:04", "Someone: You have entered City Square.", "INFO"))).toBeNull();
    expect(journal.parseMappingJournalLine(line("12:00:05", "Someone: Exact_Name has been slain.", "INFO"))).toBeNull();
  });

  it("uses client-safe instance identity, exact character deaths, and observed generation boundaries", () => {
    const service = journal.createMappingJournalService();
    service.updateSettings({ enabled: true, activeCharacter: "Exact_Name" });
    const firstVisit = [
      instance("12:00:00", "101"),
      generated("12:00:00", "MapWorldsCitySquare", "501"),
      entered("12:00:01", "City Square"),
      died("12:00:30", "Party_Member"),
      died("12:01:00", "Exact_Name"),
      instance("12:02:00", "202"),
      generated("12:02:00", "HideoutCourts", "1", 60),
      entered("12:02:01", "Stately Hideout"),
    ];
    service.ingestLines(firstVisit, "source-a");
    let state = service.getState();
    expect(state.sessions).toHaveLength(1);
    expect(state.sessions[0]).toMatchObject({
      areaName: "City Square",
      areaId: "MapWorldsCitySquare",
      entries: 1,
      deaths: 1,
      activeMilliseconds: 119_000,
    });
    expect(state.activeSessionId).toBe("");

    const returnAndNextMap = [
      instance("12:03:00", "101"),
      generated("12:03:00", "MapWorldsCitySquare", "501"),
      entered("12:03:01", "City Square"),
      died("12:03:30", "Exact_Name", true),
      instance("12:05:00", "303"),
      generated("12:05:00", "MapWorldsToxicSewer", "777"),
      entered("12:05:01", "Toxic Sewer"),
    ];
    service.ingestLines(returnAndNextMap, "source-a");
    state = service.getState();
    expect(state.sessions).toHaveLength(2);
    expect(state.sessions[0]).toMatchObject({ entries: 2, deaths: 2, activeMilliseconds: 238_000 });
    expect(state.sessions[1]).toMatchObject({ areaName: "Toxic Sewer", entries: 1, deaths: 0 });
    expect(state.activeSessionId).toBe(state.sessions[1].id);

    service.ingestLines([...firstVisit, ...returnAndNextMap], "source-a");
    expect(service.getState().sessions).toEqual(state.sessions);
  });

  it("fails closed when a map line has no current client-safe instance ID", () => {
    const service = journal.createMappingJournalService();
    service.updateSettings({ enabled: true });
    service.ingestLines([
      generated("12:00:00", "MapWorldsGrotto", "2049423767"),
      entered("12:00:01", "Grotto"),
    ], "source-a");
    expect(service.getState().sessions).toEqual([]);
  });

  it("persists only sanitized facts and exports escaped CSV", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "gloamcore-mapping-journal-"));
    roots.push(root);
    const storePath = path.join(root, "mapping-journal.json");
    const service = journal.createMappingJournalService({ storePath });
    service.updateSettings({ enabled: true, activeCharacter: " Exact_Name\n" });
    service.ingestLines([
      instance("12:00:00", "101"),
      generated("12:00:00", "MapWorldsCitySquare", "501"),
      entered("12:00:01", "City Square"),
    ], "source-a");
    const id = service.getState().sessions[0].id;
    service.updateSession({
      id,
      notes: "Dropped no claimed loot,\njust an observed note.",
      tags: [" Delirium ", "delirium", "boss, test", ""],
    });
    const stored = fs.readFileSync(storePath, "utf8");
    expect(stored).not.toContain("Client-Safe Instance ID");
    expect(stored).not.toContain("You have entered");
    expect(stored).not.toContain("has been slain");
    expect(stored).not.toContain('"instanceId"');
    expect(stored).not.toContain('"seed"');

    const restored = journal.createMappingJournalService({ storePath });
    expect(restored.getState()).toMatchObject({
      settings: { enabled: true, activeCharacter: "Exact_Name" },
      sessions: [{ notes: "Dropped no claimed loot,\njust an observed note.", tags: ["Delirium", "boss test"] }],
    });
    const csv = restored.exportCsv();
    expect(csv).toContain("started_iso_utc,last_entry_iso_utc,last_exit_iso_utc,area,internal_area");
    expect(csv).toContain('"Dropped no claimed loot,\njust an observed note."');
  });

  it("marks an unterminated observation incomplete when the log identity changes", () => {
    const service = journal.createMappingJournalService();
    service.updateSettings({ enabled: true });
    service.ingestLines([
      instance("12:00:00", "101"),
      generated("12:00:00", "MapWorldsCitySquare", "501"),
      entered("12:00:01", "City Square"),
    ], "source-a");
    service.ingestLines([line("12:10:00", "***** LOG FILE OPENING *****", "INFO")], "source-b");
    expect(service.getState()).toMatchObject({
      activeSessionId: "",
      sessions: [{ timingIncomplete: true, activeMilliseconds: 0 }],
    });
  });

  it("records nothing while paused and consumes each instance ID only once", () => {
    const service = journal.createMappingJournalService();
    const first = [
      instance("12:00:00", "101"),
      generated("12:00:01", "MapWorldsCitySquare", "501"),
      entered("12:00:02", "City Square"),
    ];
    service.ingestLines(first, "source-a");
    expect(service.getState().sessions).toEqual([]);

    service.updateSettings({ enabled: true });
    service.ingestLines([
      ...first,
      generated("12:00:30", "MapWorldsToxicSewer", "777"),
      entered("12:00:31", "Toxic Sewer"),
    ], "source-a");
    expect(service.getState().sessions).toMatchObject([{ areaName: "City Square" }]);
  });

  it("marks a persisted active visit incomplete on restart", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "gloamcore-mapping-journal-"));
    roots.push(root);
    const storePath = path.join(root, "mapping-journal.json");
    const service = journal.createMappingJournalService({ storePath });
    service.updateSettings({ enabled: true });
    service.ingestLines([
      instance("12:00:00", "101"),
      generated("12:00:01", "MapWorldsCitySquare", "501"),
      entered("12:00:02", "City Square"),
    ], "source-a");
    expect(service.getState().activeSessionId).not.toBe("");

    const restored = journal.createMappingJournalService({ storePath });
    expect(restored.getState()).toMatchObject({
      activeSessionId: "",
      sessions: [{ timingIncomplete: true }],
    });
  });

  it("never trusts persisted instance IDs or seeds as live pairing state", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "gloamcore-mapping-journal-"));
    roots.push(root);
    const storePath = path.join(root, "mapping-journal.json");
    fs.writeFileSync(storePath, JSON.stringify({
      version: 1,
      settings: { version: 1, enabled: true, activeCharacter: "" },
      sessions: [],
      runtime: {
        sourceIdentity: "source-a",
        seenLineHashes: [],
        instanceByClient: { 4242: { instanceId: "101", timestamp: new Date(2026, 7, 12, 12, 0, 0).getTime() } },
        generationByClient: {
          4242: {
            timestamp: new Date(2026, 7, 12, 12, 0, 1).getTime(),
            instanceId: "101",
            areaLevel: 83,
            areaId: "MapWorldsCitySquare",
            seed: "501",
            isMapWorld: true,
          },
        },
        currentVisit: null,
      },
    }), "utf8");
    const service = journal.createMappingJournalService({ storePath });
    service.ingestLines([entered("12:00:02", "City Square")], "source-a");
    expect(service.getState().sessions).toEqual([]);
  });
});
