import Dexie, { Table } from "dexie";
import { db, MirrorDatabase } from "./db";

const FORMAT = "mirror-full-backup";
const FORMAT_VERSION = 2;
const PROJECT_FORMAT = "mirror-project-backup";
const PROJECT_FORMAT_VERSION = 1;
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

/** A portable copy of one project, its chats, media, and the settings needed to continue it elsewhere. */
export type ProjectBackup = {
  format: typeof PROJECT_FORMAT;
  formatVersion: typeof PROJECT_FORMAT_VERSION;
  createdAt: string;
  databaseName: string;
  schemaVersion: number;
  projectId: string;
  projectName: string;
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

function tableNames(database: MirrorDatabase) {
  return database.tables.map((table) => table.name).sort();
}

// Every database table must be deliberately classified. This protects project
// backups when a future feature adds storage: tests fail until it is either
// included here or explicitly documented as device-only migration metadata.
const PROJECT_TABLE_NAMES = [
  "settings", "modelLibrary", "projects", "chats", "branches", "messages", "stars",
  "archives", "archiveEntries", "attachments", "characters", "characterBonuses",
  "characterGearSlots", "characterActionSlots", "characterActionMacros", "characterBackgroundDetails",
  "memories", "pendingMemories", "sourceFiles", "chatSources", "inventoryItems", "inventoryLogs",
  "deltaSessions", "deltaMessages", "deltaEntities", "deltaAllyCache", "deltaActionMacros",
  "deltaEffects", "deltaIcons", "timelineEntries"
] as const;
const PROJECT_EXCLUDED_TABLE_NAMES = ["migrationMetadata"] as const;

export function unclassifiedProjectBackupTables(database = db) {
  const classified = new Set<string>([...PROJECT_TABLE_NAMES, ...PROJECT_EXCLUDED_TABLE_NAMES]);
  return tableNames(database).filter((name) => !classified.has(name));
}

function assertProjectBackupCoverage(database: MirrorDatabase) {
  const unclassified = unclassifiedProjectBackupTables(database);
  const missing = PROJECT_TABLE_NAMES.filter((name) => !database.tables.some((table) => table.name === name));
  if (unclassified.length || missing.length) {
    throw new Error(`Project backup coverage is incomplete (${[...unclassified, ...missing].join(", ")}).`);
  }
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

async function rowsForProjectBackup(database: MirrorDatabase, projectId: string) {
  assertProjectBackupCoverage(database);
  const project = await database.projects.get(projectId);
  if (!project) throw new Error("That project no longer exists.");
  const chats = await database.chats.where("projectId").equals(projectId).toArray();
  const chatIds = chats.map((row) => row.id);
  const branches = chatIds.length ? await database.branches.where("chatId").anyOf(chatIds).toArray() : [];
  const messages = chatIds.length ? await database.messages.where("chatId").anyOf(chatIds).toArray() : [];
  const archives = await database.archives.where("projectId").equals(projectId).toArray();
  const archiveIds = archives.map((row) => row.id);
  const archiveEntries = archiveIds.length ? await database.archiveEntries.where("archiveId").anyOf(archiveIds).toArray() : [];
  const characters = await database.characters.where("projectId").equals(projectId).toArray();
  const characterIds = characters.map((row) => row.id);
  const actionSlots = characterIds.length ? await database.characterActionSlots.where("characterId").anyOf(characterIds).toArray() : [];
  const slotIds = actionSlots.map((row) => row.id);
  const sourceFiles = await database.sourceFiles.where("projectId").equals(projectId).toArray();
  const sessions = chatIds.length ? await database.deltaSessions.where("chatId").anyOf(chatIds).toArray() : [];
  const sessionIds = sessions.map((row) => row.id);
  const deltaMessages = sessionIds.length ? await database.deltaMessages.where("sessionId").anyOf(sessionIds).toArray() : [];
  const deltaEntities = sessionIds.length ? await database.deltaEntities.where("sessionId").anyOf(sessionIds).toArray() : [];
  const attachmentOwners = [
    ...messages.map((row) => ["message", row.id] as [string, string]),
    ...archiveEntries.map((row) => ["archiveEntry", row.id] as [string, string]),
    ...characters.map((row) => ["character", row.id] as [string, string]),
    ...sourceFiles.map((row) => ["sourceFile", row.id] as [string, string])
  ];
  const ownerAttachments = attachmentOwners.length ? await database.attachments.where("[ownerType+ownerId]").anyOf(attachmentOwners).toArray() : [];
  const referencedAttachmentIds = new Set([
    ...sourceFiles.flatMap((row) => row.attachmentId ? [row.attachmentId] : []),
    ...characters.flatMap((row) => row.profileAttachmentId ? [row.profileAttachmentId] : []),
    ...deltaEntities.flatMap((row) => row.imageAttachmentId ? [row.imageAttachmentId] : [])
  ]);
  const referencedAttachments = referencedAttachmentIds.size ? await database.attachments.bulkGet([...referencedAttachmentIds]) : [];
  const attachments = [...new Map([...ownerAttachments, ...referencedAttachments.filter(Boolean)].map((row) => [row!.id, row!])).values()];
  return {
    settings: (await database.settings.toArray()).map(withoutApiKey),
    modelLibrary: await database.modelLibrary.toArray(), projects: [project], chats, branches, messages,
    stars: await database.stars.where("projectId").equals(projectId).toArray(), archives, archiveEntries, attachments,
    characters,
    characterBonuses: characterIds.length ? await database.characterBonuses.where("characterId").anyOf(characterIds).toArray() : [],
    characterGearSlots: characterIds.length ? await database.characterGearSlots.where("characterId").anyOf(characterIds).toArray() : [],
    characterActionSlots: actionSlots,
    characterActionMacros: slotIds.length ? await database.characterActionMacros.where("slotId").anyOf(slotIds).toArray() : [],
    characterBackgroundDetails: characterIds.length ? await database.characterBackgroundDetails.where("characterId").anyOf(characterIds).toArray() : [],
    memories: await database.memories.where("projectId").equals(projectId).toArray(),
    pendingMemories: await database.pendingMemories.where("projectId").equals(projectId).toArray(), sourceFiles,
    chatSources: chatIds.length ? await database.chatSources.where("chatId").anyOf(chatIds).toArray() : [],
    inventoryItems: chatIds.length ? await database.inventoryItems.where("chatId").anyOf(chatIds).toArray() : [],
    inventoryLogs: chatIds.length ? await database.inventoryLogs.where("chatId").anyOf(chatIds).toArray() : [], deltaSessions: sessions,
    deltaMessages, deltaEntities,
    deltaAllyCache: chatIds.length ? await database.deltaAllyCache.where("chatId").anyOf(chatIds).toArray() : [],
    deltaActionMacros: chatIds.length ? await database.deltaActionMacros.where("chatId").anyOf(chatIds).toArray() : [],
    deltaEffects: await database.deltaEffects.where("projectId").equals(projectId).toArray(),
    deltaIcons: await database.deltaIcons.where("projectId").equals(projectId).toArray(),
    timelineEntries: await database.timelineEntries.where("projectId").equals(projectId).toArray()
  };
}

export async function createProjectBackup(projectId: string, database = db): Promise<ProjectBackup> {
  let rows: Awaited<ReturnType<typeof rowsForProjectBackup>>;
  // Read all related rows in one IndexedDB transaction so a project save cannot
  // leave a backup with a chat but only part of its messages or media.
  await database.transaction("r", database.tables, async () => {
    rows = await rowsForProjectBackup(database, projectId);
  });
  const tables: Record<string, EncodedValue[]> = {};
  const tableCounts: Record<string, number> = {};
  for (const name of PROJECT_TABLE_NAMES) {
    const records = rows![name] as unknown[];
    tables[name] = await Promise.all(records.map(encodeBackupValue));
    tableCounts[name] = records.length;
  }
  const project = rows!.projects[0];
  return { format: PROJECT_FORMAT, formatVersion: PROJECT_FORMAT_VERSION, createdAt: new Date().toISOString(), databaseName: database.name, schemaVersion: database.verno, projectId, projectName: project.name, tableNames: [...PROJECT_TABLE_NAMES], tableCounts, tables };
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

export async function parseAndValidateProjectBackup(text: string, database = db): Promise<ProjectBackup> {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error("The project backup file is not valid JSON.");
  }
  return validateProjectBackup(value, database);
}

export async function validateProjectBackup(value: unknown, database = db): Promise<ProjectBackup> {
  assertProjectBackupCoverage(database);
  requireRecord(value, "The project backup has an invalid format.");
  if (value.format !== PROJECT_FORMAT || value.formatVersion !== PROJECT_FORMAT_VERSION) throw new Error("This is not a compatible Mirror project backup.");
  if (typeof value.createdAt !== "string" || typeof value.databaseName !== "string" || typeof value.schemaVersion !== "number" || typeof value.projectId !== "string" || typeof value.projectName !== "string") throw new Error("The project backup metadata is incomplete.");
  if (!Array.isArray(value.tableNames) || !value.tableNames.every((name) => typeof name === "string")) throw new Error("The project backup does not list its tables.");
  requireRecord(value.tableCounts, "The project backup table counts are missing.");
  requireRecord(value.tables, "The project backup table data is missing.");
  const backupNames = [...value.tableNames].sort();
  const expectedNames = [...PROJECT_TABLE_NAMES].sort();
  if (backupNames.length !== expectedNames.length || backupNames.some((name, index) => name !== expectedNames[index])) throw new Error("The project backup does not contain the complete project data set.");
  const tables: Record<string, EncodedValue[]> = {};
  const tableCounts: Record<string, number> = {};
  for (const name of PROJECT_TABLE_NAMES) {
    const records = value.tables[name];
    const count = value.tableCounts[name];
    if (!Array.isArray(records) || typeof count !== "number" || count !== records.length) throw new Error(`The ${name} table is incomplete or corrupt.`);
    tables[name] = records as EncodedValue[];
    tableCounts[name] = count;
    await Promise.all(tables[name].map(decodeBackupValue));
  }
  const decodedProject = await decodeBackupValue(tables.projects[0]);
  if (tables.projects.length !== 1 || !decodedProject || typeof decodedProject !== "object" || (decodedProject as { id?: unknown }).id !== value.projectId) throw new Error("The project record is missing or does not match this backup.");
  return { format: PROJECT_FORMAT, formatVersion: PROJECT_FORMAT_VERSION, createdAt: value.createdAt, databaseName: value.databaseName, schemaVersion: value.schemaVersion, projectId: value.projectId, projectName: value.projectName, tableNames: [...PROJECT_TABLE_NAMES], tableCounts, tables };
}

async function decodedRows(backup: Pick<FullBackup | ProjectBackup, "tables">, tableName: string) {
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

async function deleteCurrentProject(projectId: string, database: MirrorDatabase) {
  const chats = await database.chats.where("projectId").equals(projectId).toArray();
  const chatIds = chats.map((row) => row.id);
  const archives = await database.archives.where("projectId").equals(projectId).toArray();
  const archiveIds = archives.map((row) => row.id);
  const archiveEntries = archiveIds.length ? await database.archiveEntries.where("archiveId").anyOf(archiveIds).toArray() : [];
  const characters = await database.characters.where("projectId").equals(projectId).toArray();
  const characterIds = characters.map((row) => row.id);
  const slots = characterIds.length ? await database.characterActionSlots.where("characterId").anyOf(characterIds).toArray() : [];
  const slotIds = slots.map((row) => row.id);
  const sessions = chatIds.length ? await database.deltaSessions.where("chatId").anyOf(chatIds).toArray() : [];
  const sessionIds = sessions.map((row) => row.id);
  const deltaEntities = sessionIds.length ? await database.deltaEntities.where("sessionId").anyOf(sessionIds).toArray() : [];
  const sourceFiles = await database.sourceFiles.where("projectId").equals(projectId).toArray();
  const attachmentOwners = [
    ...chats.flatMap(() => [] as [string, string][]),
    ...(chatIds.length ? (await database.messages.where("chatId").anyOf(chatIds).primaryKeys()).map((id) => ["message", id] as [string, string]) : []),
    ...archiveEntries.map((row) => ["archiveEntry", row.id] as [string, string]),
    ...characters.map((row) => ["character", row.id] as [string, string]),
    ...sourceFiles.map((row) => ["sourceFile", row.id] as [string, string])
  ];
  if (attachmentOwners.length) await database.attachments.where("[ownerType+ownerId]").anyOf(attachmentOwners).delete();
  const referencedAttachmentIds = [
    ...sourceFiles.flatMap((row) => row.attachmentId ? [row.attachmentId] : []),
    ...characters.flatMap((row) => row.profileAttachmentId ? [row.profileAttachmentId] : []),
    ...deltaEntities.flatMap((row) => row.imageAttachmentId ? [row.imageAttachmentId] : [])
  ];
  if (referencedAttachmentIds.length) await database.attachments.bulkDelete(referencedAttachmentIds);
  if (slotIds.length) await database.characterActionMacros.where("slotId").anyOf(slotIds).delete();
  if (characterIds.length) {
    await database.characterBonuses.where("characterId").anyOf(characterIds).delete();
    await database.characterGearSlots.where("characterId").anyOf(characterIds).delete();
    await database.characterBackgroundDetails.where("characterId").anyOf(characterIds).delete();
    await database.characterActionSlots.where("characterId").anyOf(characterIds).delete();
  }
  if (sessionIds.length) {
    await database.deltaMessages.where("sessionId").anyOf(sessionIds).delete();
    await database.deltaEntities.where("sessionId").anyOf(sessionIds).delete();
    await database.deltaSessions.bulkDelete(sessionIds);
  }
  if (chatIds.length) {
    await database.branches.where("chatId").anyOf(chatIds).delete();
    await database.messages.where("chatId").anyOf(chatIds).delete();
    await database.deltaAllyCache.where("chatId").anyOf(chatIds).delete();
    await database.deltaActionMacros.where("chatId").anyOf(chatIds).delete();
    await database.chatSources.where("chatId").anyOf(chatIds).delete();
    await database.inventoryItems.where("chatId").anyOf(chatIds).delete();
    await database.inventoryLogs.where("chatId").anyOf(chatIds).delete();
    await database.chats.bulkDelete(chatIds);
  }
  if (archiveIds.length) await database.archiveEntries.where("archiveId").anyOf(archiveIds).delete();
  await database.archives.bulkDelete(archiveIds);
  await database.characters.bulkDelete(characterIds);
  for (const table of [database.stars, database.memories, database.pendingMemories, database.sourceFiles, database.deltaEffects, database.deltaIcons, database.timelineEntries]) await table.where("projectId").equals(projectId).delete();
  await database.projects.delete(projectId);
}

/** Replaces a same-ID project with its exact backup contents, while preserving other projects. */
export async function restoreProjectBackup(backup: ProjectBackup, database = db) {
  const checked = await validateProjectBackup(backup, database);
  await database.transaction("rw", database.tables, async () => {
    await deleteCurrentProject(checked.projectId, database);
    for (const name of PROJECT_TABLE_NAMES) await database.table(name).bulkPut(await decodedRows(checked, name));
    for (const name of PROJECT_TABLE_NAMES) {
      const expected = checked.tableCounts[name];
      if (name === "settings" || name === "modelLibrary") continue;
      const actual = await database.table(name).count();
      if (actual < expected) throw new Error(`Project restore verification failed for ${name}.`);
    }
  });
}

export async function listRecoverySnapshots(): Promise<RecoverySnapshot[]> {
  const snapshots = await recoveryDb.snapshots.toArray();
  return snapshots.map(({ backup: _backup, ...snapshot }) => snapshot).sort((left, right) => left.slot.localeCompare(right.slot));
}

const pendingSnapshots = new WeakMap<MirrorDatabase, Promise<RecoverySnapshot>>();

export function createRecoverySnapshot(database = db): Promise<RecoverySnapshot> {
  const pending = pendingSnapshots.get(database);
  if (pending) return pending;
  const operation = writeRecoverySnapshot(database).finally(() => pendingSnapshots.delete(database));
  pendingSnapshots.set(database, operation);
  return operation;
}

async function writeRecoverySnapshot(database: MirrorDatabase): Promise<RecoverySnapshot> {
  const backup = await createFullBackup(database);
  // Read just the index key: loading both previous backups clones the entire
  // database twice, including encoded attachments, on every project save.
  const [newestSlot] = await recoveryDb.snapshots.orderBy("createdAt").reverse().limit(1).primaryKeys();
  const slot: RecoverySlot = newestSlot === "A" ? "B" : "A";
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
