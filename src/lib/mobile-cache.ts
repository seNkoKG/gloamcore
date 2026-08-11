const DATABASE_NAME = "gloamcore-cache";
const STORE_NAME = "responses";
const DATABASE_VERSION = 1;

let databasePromise: Promise<IDBDatabase> | null = null;

function openDatabase() {
  if (!databasePromise) {
    databasePromise = new Promise((resolve, reject) => {
      let settled = false;
      const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(STORE_NAME)) {
          database.createObjectStore(STORE_NAME);
        }
      };
      request.onsuccess = () => {
        const database = request.result;
        if (settled) {
          database.close();
          return;
        }
        settled = true;
        database.onversionchange = () => {
          database.close();
          databasePromise = null;
        };
        resolve(database);
      };
      request.onerror = () => {
        if (settled) return;
        settled = true;
        databasePromise = null;
        reject(request.error);
      };
      request.onblocked = () => {
        if (settled) return;
        settled = true;
        databasePromise = null;
        reject(new Error("The mobile cache database is blocked by another view."));
      };
    });
  }
  return databasePromise;
}

export async function readMobileCache<T>(key: string): Promise<T | null> {
  try {
    const database = await openDatabase();
    return await new Promise<T | null>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, "readonly");
      const request = transaction.objectStore(STORE_NAME).get(key);
      request.onsuccess = () => resolve((request.result as T | undefined) ?? null);
      request.onerror = () => reject(request.error);
    });
  } catch {
    return null;
  }
}

export async function writeMobileCache<T>(key: string, value: T) {
  try {
    const database = await openDatabase();
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, "readwrite");
      transaction.objectStore(STORE_NAME).put(value, key);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
  } catch {
    // A live response remains usable even if the device declines persistent storage.
  }
}
