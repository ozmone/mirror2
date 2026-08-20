import Dexie, { Table } from "dexie";
import { db, MirrorDatabase } from "./db";

const FORMAT = "mirror-full-backup";
const FORMAT_VERSION = 2;
const VALUE_TAG = "__mirrorBackupValue";

type EncodedValue = null | boolean | number | string | EncodedValue[] | { [key: string]: EncodedValue };

export type FullBackup = {
  format: typeof FORMAT;
  formatVersion: typeof FORMAT_VERSION;
  createdAt: string;
  databaseName: string;
  schemaVersion: number;
  tableNames: string[];
  tableCounts: Record<string, number>;
  tables: Record<string, EncodedValue[]>;
};

export type RecoverySlot = "A" | "B";

export type RecoverySnapshot = {
  slot: RecoverySlot;
  createdAt: string;
  schemaVersion: number;
  tableCounts: Record<string, number>;
};

type RecoverySnapshotRow = RecoverySnapshot & { backup: FullBackup };

class RecoveryDatabase extends Dexie {
  snapshots!: Table<RecoverySnapshotRow, RecoverySlot>;

  constructor() {
    super("mirror-2-recovery-backups");
    this.version(1).stores({ snapshots: "slot, createdAt" });
  }
}

const recoveryDb = new RecoveryDatabase();
let automaticRecoveryInstalled = false;
let automaticRecoveryTimer: number | undefined;

function scheduleAutomaticRecovery() {
  if (automaticRecoveryTimer !== undefined) window.clearTimeout(automaticRecoveryTimer);
  automaticRecoveryTimer = window.setTimeout(() => {
    automaticRecoveryTimer = undefined;
    void createRecoverySnapshot().catch(() => undefined);
  }, 5_000);
}

/** Starts one debounced recovery snapshot after successful live-database writes. */
export function installAutomaticRecoverySnapshots(database = db) {
  if (automaticRecoveryInstalled || typeof window === "undefined") return;
  automaticRecoveryInstalled = true;
  for (const table of database.tables) {
    table.hook("creating", function () { this.onsuccess = scheduleAutomaticRecovery; });
    table.hook("updating", function () { this.onsuccess = scheduleAutomaticRecovery; });
    table.hook("deleting", function () { this.onsuccess = scheduleAutomaticRecovery; });
  }
}

function tableNames(database: MirrorDatabase) {
  return database.tables.map((table) => table.name).sort();
}

function withoutApiKey(value: unknown): unknown {
  if (!value || typeof value !== "object") return value;
  const settings = { ...(value as Record<string, unknown>) };
  delete settings.apiKey;
  return settings;
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

function base64ToBytes(value: string) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

async function blobBytes(value: Blob) {
  if (typeof value.arrayBuffer === "function") return new Uint8Array(await value.arrayBuffer());
  return new Promise<Uint8Array>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("Could not read attachment data."));
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
    reader.readAsArrayBuffer(value);
  });
}

export async function encodeBackupValue(value: unknown): Promise<EncodedValue> {
  if (value === undefined) return { [VALUE_TAG]: "undefined" };
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
  if (value instanceof Date) return { [VALUE_TAG]: "date", value: value.toISOString() };
  if (value instanceof Blob) {
    return {
      [VALUE_TAG]: "blob",
      type: value.type,
      data: bytesToBase64(await blobBytes(value))
    };
  }
  if (Array.isArray(value)) return Promise.all(value.map(encodeBackupValue));
  if (typeof value === "object") {
    const entries = await Promise.all(Object.entries(value as Record<string, unknown>).map(async ([key, item]) => [key, await encodeBackupValue(item)] as const));
    return Object.fromEntries(entries);
  }
  throw new Error(`Cannot back up value of type ${typeof value}.`);
}

export async function decodeBackupValue(value: EncodedValue): Promise<unknown> {
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) return Promise.all(value.map(decodeBackupValue));
  const tagged = value[VALUE_TAG];
  if (tagged === "undefined") return undefined;
  if (tagged === "date" && typeof value.value === "string") return new Date(value.value);
  if (tagged === "blob" && typeof value.data === "string" && typeof value.type === "string") return new Blob([base64ToBytes(value.data)], { type: value.type });
  const entries = await Promise.all(Object.entries(value).map(async ([key, item]) => [key, await decodeBackupValue(item)] as const));
  return Object.fromEntries(entries);
}

function requireRecord(value: unknown, message: string): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(message);
}

export async function createFullBackup(database = db): Promise<FullBackup> {
  const names = tableNames(database);
  const tables: Record<string, EncodedValue[]> = {};
  const tableCounts: Record<string, number> = {};
  await database.transaction("r", database.tables, async () => {
    for (const table of database.tables) {
      const rows = await table.toArray();
      const safeRows = table.name === "settings" ? rows.map(withoutApiKey) : rows;
      // Blob reads are asynchronous; keep Dexie's read transaction alive while they finish.
      tables[table.name] = await Dexie.waitFor(Promise.all(safeRows.map(encodeBackupValue)));
      tableCounts[table.name] = rows.length;
    }
  });
  return {
    format: FORMAT,
    formatVersion: FORMAT_VERSION,
    createdAt: new Date().toISOString(),
    databaseName: database.name,
    schemaVersion: database.verno,
    tableNames: names,
    tableCounts,
    tables
  };
}

export async function parseAndValidateBackup(text: string, database = db): Promise<FullBackup> {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error("The backup file is not valid JSON.");
  }
  return validateBackup(value, database);
}

export async function validateBackup(value: unknown, database = db): Promise<FullBackup> {
  requireRecord(value, "The backup has an invalid format.");
  if (value.format !== FORMAT || value.formatVersion !== FORMAT_VERSION) throw new Error("This is not a compatible full Mirror backup.");
  if (typeof value.createdAt !== "string" || typeof value.databaseName !== "string" || typeof value.schemaVersion !== "number") throw new Error("The backup metadata is incomplete.");
  if (!Array.isArray(value.tableNames) || !value.tableNames.every((name) => typeof name === "string")) throw new Error("The backup does not list its tables.");
  requireRecord(value.tableCounts, "The backup table counts are missing.");
  requireRecord(value.tables, "The backup table data is missing.");
  const names = tableNames(database);
  const backupNames = [...value.tableNames] as string[];
  backupNames.sort();
  if (new Set(backupNames).size !== backupNames.length || backupNames.some((name) => !names.includes(name))) throw new Error("This backup contains an unknown or duplicate table.");
  const tables: Record<string, EncodedValue[]> = {};
  const tableCounts: Record<string, number> = {};
  for (const name of backupNames) {
    const records = value.tables[name];
    const count = value.tableCounts[name];
    if (!Array.isArray(records) || typeof count !== "number" || count !== records.length) throw new Error(`The ${name} table is incomplete or corrupt.`);
    tables[name] = records as EncodedValue[];
    tableCounts[name] = count;
    await Promise.all(tables[name].map(decodeBackupValue));
  }
  return {
    format: FORMAT,
    formatVersion: FORMAT_VERSION,
    createdAt: value.createdAt,
    databaseName: value.databaseName,
    schemaVersion: value.schemaVersion,
    tableNames: backupNames,
    tableCounts,
    tables
  };
}

async function decodedRows(backup: FullBackup, tableName: string) {
  return Promise.all(backup.tables[tableName].map(decodeBackupValue));
}

export async function mergeFullBackup(backup: FullBackup, database = db) {
  const checked = await validateBackup(backup, database);
  await database.transaction("rw", database.tables, async () => {
    for (const tableName of checked.tableNames) await database.table(tableName).bulkPut(await decodedRows(checked, tableName));
  });
}

export async function replaceWithFullBackup(backup: FullBackup, database = db) {
  const checked = await validateBackup(backup, database);
  await database.transaction("rw", database.tables, async () => {
    for (const table of database.tables) await table.clear();
    for (const tableName of checked.tableNames) await database.table(tableName).bulkPut(await decodedRows(checked, tableName));
    for (const table of database.tables) {
      if (await table.count() !== (checked.tableCounts[table.name] ?? 0)) throw new Error(`Restore verification failed for ${table.name}.`);
    }
  });
}

export async function listRecoverySnapshots(): Promise<RecoverySnapshot[]> {
  const snapshots = await recoveryDb.snapshots.toArray();
  return snapshots.map(({ backup: _backup, ...snapshot }) => snapshot).sort((left, right) => left.slot.localeCompare(right.slot));
}

export async function createRecoverySnapshot(database = db): Promise<RecoverySnapshot> {
  if (automaticRecoveryTimer !== undefined && typeof window !== "undefined") {
    window.clearTimeout(automaticRecoveryTimer);
    automaticRecoveryTimer = undefined;
  }
  const backup = await createFullBackup(database);
  await validateBackup(backup, database);
  const snapshots = await recoveryDb.snapshots.toArray();
  const newest = [...snapshots].sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0];
  const slot: RecoverySlot = newest?.slot === "A" ? "B" : "A";
  const snapshot: RecoverySnapshotRow = { slot, createdAt: backup.createdAt, schemaVersion: backup.schemaVersion, tableCounts: backup.tableCounts, backup };
  await recoveryDb.snapshots.put(snapshot);
  const saved = await recoveryDb.snapshots.get(slot);
  if (!saved) throw new Error("Recovery snapshot could not be verified after saving.");
  await validateBackup(saved.backup, database);
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("mirror:recovery-snapshot"));
  return { slot: saved.slot, createdAt: saved.createdAt, schemaVersion: saved.schemaVersion, tableCounts: saved.tableCounts };
}

export async function restoreRecoverySnapshot(slot: RecoverySlot, database = db) {
  const snapshot = await recoveryDb.snapshots.get(slot);
  if (!snapshot) throw new Error(`Backup ${slot} is not available.`);
  await replaceWithFullBackup(snapshot.backup, database);
}
