import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const {
  migrateLegacyBrowserPartition,
  migrateLegacyDataDirectories,
} = require("../electron/legacy-data-migration.cjs");

const temporaryRoots: string[] = [];

function temporaryRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "gloamcore-migration-test-"));
  temporaryRoots.push(root);
  return root;
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("legacy desktop data migration", () => {
  it("copies the retired browser partition when the current profile already exists", () => {
    const appDataDirectory = temporaryRoot();
    const currentUserData = path.join(appDataDirectory, "current-app");
    const legacyUserData = path.join(appDataDirectory, "retired-app");
    const legacyPartition = path.join(
      legacyUserData,
      "Partitions",
      "retired-wealth-session",
    );
    fs.mkdirSync(legacyPartition, { recursive: true });
    fs.mkdirSync(currentUserData, { recursive: true });
    fs.writeFileSync(path.join(currentUserData, "settings.json"), "current");
    fs.writeFileSync(path.join(legacyPartition, "Cookies"), "signed-in-session");

    migrateLegacyDataDirectories({
      currentUserData,
      appDataDirectory,
      legacyUserDataDirectoryNames: ["retired-app"],
      legacyPartitionNames: ["retired-wealth-session"],
      currentPartitionName: "current-wealth-session",
    });

    expect(fs.readFileSync(
      path.join(currentUserData, "Partitions", "current-wealth-session", "Cookies"),
      "utf8",
    )).toBe("signed-in-session");
    expect(fs.readFileSync(path.join(currentUserData, "settings.json"), "utf8"))
      .toBe("current");
    expect(fs.readFileSync(path.join(legacyPartition, "Cookies"), "utf8"))
      .toBe("signed-in-session");
  });

  it("does not overwrite an existing current browser partition", () => {
    const appDataDirectory = temporaryRoot();
    const currentUserData = path.join(appDataDirectory, "current-app");
    const currentPartition = path.join(
      currentUserData,
      "Partitions",
      "current-wealth-session",
    );
    const legacyPartition = path.join(
      appDataDirectory,
      "retired-app",
      "Partitions",
      "retired-wealth-session",
    );
    fs.mkdirSync(currentPartition, { recursive: true });
    fs.mkdirSync(legacyPartition, { recursive: true });
    fs.writeFileSync(path.join(currentPartition, "Cookies"), "current-session");
    fs.writeFileSync(path.join(legacyPartition, "Cookies"), "retired-session");

    expect(migrateLegacyBrowserPartition({
      currentUserData,
      legacyUserDataDirectories: [path.join(appDataDirectory, "retired-app")],
      legacyPartitionNames: ["retired-wealth-session"],
      currentPartitionName: "current-wealth-session",
    })).toBe(false);
    expect(fs.readFileSync(path.join(currentPartition, "Cookies"), "utf8"))
      .toBe("current-session");
  });
});
