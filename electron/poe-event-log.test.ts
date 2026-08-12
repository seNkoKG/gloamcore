import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import eventLog from "./poe-event-log.cjs";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });
const line = (message: string, second = "01") => `2026/08/11 12:34:${second} 123 abc [INFO Client 1234] : ${message}\n`;

describe("PoE event log", () => {
  it("classifies game, communication, and privacy-sensitive lines", () => {
    expect(eventLog.parsePoeEventLogLine(line('Generating level 83 area "MapWorldsBeach"').trim(), 1)).toMatchObject({ category: "zone", title: "83 · MapWorldsBeach" });
    expect(eventLog.parsePoeEventLogLine(line("@From Account: hello").trim(), 2)?.category).toBe("whisper");
    expect(eventLog.parsePoeEventLogLine(line("Character has been slain").trim(), 3)?.category).toBe("death");
    expect(eventLog.parsePoeEventLogLine("garbage", 4)).toBeNull();
  });

  it("retains partial UTF-8 lines and recovers after truncation", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "gloamcore-event-log-")); roots.push(root);
    const logPath = path.join(root, "Client.txt");
    fs.writeFileSync(logPath, line("You have entered Lioneye's Watch", "01"), "utf8");
    const service = eventLog.createPoeEventLogService({ settingsPath: path.join(root, "settings.json"), pollMilliseconds: 10_000 });
    service.authorizePath(logPath);
    expect(service.start().events).toHaveLength(1);
    const bytes = Buffer.from(line("@From Álvaro: čar", "02"), "utf8");
    fs.appendFileSync(logPath, bytes.subarray(0, bytes.length - 4)); service._poll();
    expect(service.getState().events).toHaveLength(1);
    fs.appendFileSync(logPath, bytes.subarray(bytes.length - 4)); service._poll();
    expect(service.getState().events.at(-1)).toMatchObject({ category: "whisper", message: "@From Álvaro: čar" });
    fs.writeFileSync(logPath, line("Trade accepted", "03"), "utf8"); service._poll();
    expect(service.getState()).toMatchObject({ status: "watching" });
    expect(service.getState().events.at(-1)?.category).toBe("trade");
    service.dispose();
  });

  it("bounds history to 500 events without persisting event contents", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "gloamcore-event-log-")); roots.push(root);
    const logPath = path.join(root, "Client.txt");
    fs.writeFileSync(logPath, Array.from({ length: 520 }, (_, index) => line(`Trade accepted ${index}`)).join(""), "utf8");
    const settingsPath = path.join(root, "settings.json");
    const service = eventLog.createPoeEventLogService({ settingsPath });
    service.authorizePath(logPath);
    expect(service.start().events).toHaveLength(500);
    expect(fs.readFileSync(settingsPath, "utf8")).not.toContain("Trade accepted");
    service.dispose();
  });

  it("only starts the dialog-authorized regular Client.txt path", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "gloamcore-event-log-")); roots.push(root);
    const configured = path.join(root, "Client.txt");
    const otherRoot = fs.mkdtempSync(path.join(os.tmpdir(), "gloamcore-event-log-other-")); roots.push(otherRoot);
    const other = path.join(otherRoot, "Client.txt");
    fs.writeFileSync(configured, line("Trade accepted"), "utf8");
    fs.writeFileSync(other, line("Trade cancelled"), "utf8");
    const service = eventLog.createPoeEventLogService({ settingsPath: path.join(root, "settings.json") });
    service.authorizePath(configured);
    expect(() => service.start(other)).toThrow(/file picker/);
    expect(service.start().status).toBe("watching");
    service.dispose();
  });

  it("publishes completed raw lines to local consumers without retaining extra history", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "gloamcore-event-log-")); roots.push(root);
    const logPath = path.join(root, "Client.txt");
    fs.writeFileSync(logPath, line('Generating level 83 area "MapWorldsCitySquare"', "01"), "utf8");
    const service = eventLog.createPoeEventLogService({ settingsPath: path.join(root, "settings.json"), pollMilliseconds: 10_000 });
    service.authorizePath(logPath);
    const batches: Array<{ lines: string[]; identity: string }> = [];
    service.subscribeLines((lines: string[], identity: string) => batches.push({ lines, identity }));
    service.start();
    expect(batches).toHaveLength(1);
    expect(batches[0].lines).toEqual([line('Generating level 83 area "MapWorldsCitySquare"', "01").trim()]);
    expect(batches[0].identity).toMatch(/^\d+:\d+:/);
    service.dispose();
  });

  it("isolates a failing local line consumer from the Event Log", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "gloamcore-event-log-")); roots.push(root);
    const logPath = path.join(root, "Client.txt");
    fs.writeFileSync(logPath, line("Trade accepted", "01"), "utf8");
    const service = eventLog.createPoeEventLogService({ settingsPath: path.join(root, "settings.json") });
    service.authorizePath(logPath);
    service.subscribeLines(() => { throw new Error("consumer failed"); });
    expect(service.start()).toMatchObject({ status: "watching", events: [{ category: "trade" }] });
    service.dispose();
  });
});
