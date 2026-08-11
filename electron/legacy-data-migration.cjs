const fs = require("node:fs");
const path = require("node:path");

function isRealDirectory(directoryPath) {
  try {
    const stats = fs.lstatSync(directoryPath);
    return stats.isDirectory() && !stats.isSymbolicLink();
  } catch {
    return false;
  }
}

function copyMissingUserDataEntries(legacyUserData, currentUserData) {
  fs.mkdirSync(currentUserData, { recursive: true });
  for (const entry of fs.readdirSync(legacyUserData, { withFileTypes: true })) {
    if (
      entry.isSymbolicLink() ||
      entry.name === "Update Cache" ||
      entry.name.toLowerCase() === "crashpad"
    ) {
      continue;
    }
    const target = path.join(currentUserData, entry.name);
    if (!fs.existsSync(target)) {
      fs.cpSync(path.join(legacyUserData, entry.name), target, {
        recursive: true,
        force: false,
        errorOnExist: true,
      });
    }
  }
}

function migrateLegacyBrowserPartition({
  currentUserData,
  legacyUserDataDirectories,
  legacyPartitionNames,
  currentPartitionName,
}) {
  const partitionsDirectory = path.join(currentUserData, "Partitions");
  const currentPartition = path.join(partitionsDirectory, currentPartitionName);
  if (fs.existsSync(currentPartition)) return false;

  const sourceRoots = [currentUserData, ...legacyUserDataDirectories];
  for (const sourceRoot of sourceRoots) {
    for (const legacyPartitionName of legacyPartitionNames) {
      const legacyPartition = path.join(
        sourceRoot,
        "Partitions",
        legacyPartitionName,
      );
      if (!isRealDirectory(legacyPartition)) continue;

      fs.mkdirSync(partitionsDirectory, { recursive: true });
      const stagingPartition = path.join(
        partitionsDirectory,
        `.${currentPartitionName}.migrating-${process.pid}-${Date.now()}`,
      );
      try {
        fs.cpSync(legacyPartition, stagingPartition, {
          recursive: true,
          force: false,
          errorOnExist: true,
        });
        fs.renameSync(stagingPartition, currentPartition);
        return true;
      } catch {
        try {
          if (fs.existsSync(stagingPartition)) {
            fs.rmSync(stagingPartition, { recursive: true, force: true });
          }
        } catch {
          // The source remains untouched and a later launch can retry.
        }
      }
    }
  }
  return false;
}

function migrateLegacyDataDirectories({
  currentUserData,
  appDataDirectory,
  legacyUserDataDirectoryNames,
  legacyPartitionNames,
  currentPartitionName,
}) {
  try {
    const legacyUserDataDirectories = legacyUserDataDirectoryNames
      .map((legacyName) => path.join(appDataDirectory, legacyName))
      .filter((legacyUserData) => (
        legacyUserData !== currentUserData && isRealDirectory(legacyUserData)
      ));
    const currentSettings = path.join(currentUserData, "settings.json");
    if (!fs.existsSync(currentSettings)) {
      for (const legacyUserData of legacyUserDataDirectories) {
        try {
          if (
            fs.existsSync(path.join(legacyUserData, "settings.json")) ||
            fs.existsSync(path.join(legacyUserData, "Local Storage"))
          ) {
            copyMissingUserDataEntries(legacyUserData, currentUserData);
            break;
          }
        } catch {
          // A locked legacy directory should not prevent trying the next one.
        }
      }
    }

    // A developer build, portable run, or interrupted first launch may have
    // created the new profile before the retired browser partition was copied.
    // Search the original profiles independently so the signed-in Wealthy
    // Exile session is still migrated without overwriting newer profile data.
    migrateLegacyBrowserPartition({
      currentUserData,
      legacyUserDataDirectories,
      legacyPartitionNames,
      currentPartitionName,
    });
  } catch {
    // Legacy data remains untouched if migration is not possible.
  }
}

module.exports = {
  copyMissingUserDataEntries,
  migrateLegacyBrowserPartition,
  migrateLegacyDataDirectories,
};
