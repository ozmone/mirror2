export type ThemeName = "onyx" | "ivory" | "blue" | "green";
export type AccentName = "sage" | "violet" | "blue" | "rose" | "amber" | "teal" | "clay" | "silver";
export type FontName = "system" | "inter" | "lora" | "nunito";
export type FontSizeName = "small" | "standard" | "large" | "xl";
export type BubbleMode = "bubbles" | "minimal";
export type BubbleScope = "global" | "project";
export type MemoryMode = "manual" | "automatic" | "approval";
export type RouteName =
  | "chat"
  | "projects"
  | "projectEdit"
  | "stars"
  | "archives"
  | "archiveEntries"
  | "characters"
  | "characterProfile"
  | "memories"
  | "compaction"
  | "sourceFiles"
  | "api"
  | "data"
  | "settings";

export interface Timestamped {
  id: string;
  createdAt: number;
  updatedAt: number;
}

export interface AppSettings extends Timestamped {
  theme: ThemeName;
  accent: AccentName;
  font: FontName;
  fontSize: FontSizeName;
  fontScale: number;
  bubbleMode: BubbleMode;
  bubbleScope: BubbleScope;
  entryWidth: number;
  messageSpacing: number;
  apiKey?: string;
  privacyPreset: "maximum" | "balanced" | "availability";
  defaultModelId?: string;
  temperature?: number;
  topP?: number;
  maxTokens?: number;
  maxHistoryMessages?: number;
  compactionEnabled?: boolean;
  includeSourceFiles?: boolean;
  streamingEnabled?: boolean;
}

export interface Project extends Timestamped {
  name: string;
  iconName: string;
  iconColor: string;
  orderIndex: number;
  pinned: boolean;
  instructions: string;
  worldSetting: string;
  bubbleMode?: BubbleMode;
  entryWidth?: number;
  memoryMode: MemoryMode;
  memoryInstruction: string;
  selectedModelId?: string;
  locked: boolean;
  inventoryEnabled: boolean;
  gearEnabled: boolean;
  currencyName?: string;
  currencyAmount?: number;
}

export interface Chat extends Timestamped {
  projectId: string;
  title: string;
  titleState: "manual" | "pending" | "generated" | "fallback";
  modelId?: string;
  activeBranchId: string;
  archived: boolean;
  compactionMemory: string;
}

export interface Branch extends Timestamped {
  chatId: string;
  rootMessageId?: string;
  label: string;
}

export interface Message extends Timestamped {
  chatId: string;
  branchId: string;
  parentMessageId?: string;
  sequence: number;
  role: "user" | "assistant" | "system";
  body: string;
  modelId?: string;
  inputTokens?: number;
  outputTokens?: number;
  estimatedTokens: boolean;
  starred: boolean;
  status: "pending" | "streaming" | "complete" | "failed" | "cancelled";
  error?: string;
  requestInfo?: {
    settings: string[];
    toggles: string[];
    toolCalls: string[];
  };
}

export interface Star extends Timestamped {
  projectId: string;
  chatId: string;
  branchId: string;
  messageId: string;
  role: Message["role"];
  bodyCopy: string;
  note?: string;
}

export interface Archive extends Timestamped {
  projectId: string;
  name: string;
  iconName?: string;
}

export interface ArchiveEntry extends Timestamped {
  archiveId: string;
  header: string;
  body: string;
  orderIndex: number;
}

export interface Attachment extends Timestamped {
  ownerType: "archiveEntry" | "character" | "sourceFile";
  ownerId: string;
  mimeType: string;
  size: number;
  blob: Blob;
  thumbnail?: Blob;
}

export interface SourceFile extends Timestamped {
  projectId: string;
  name: string;
  mimeType: string;
  size: number;
  textContent?: string;
  attachmentId?: string;
}

export type InventoryKind = "inventory" | "gear";

export interface InventoryItem extends Timestamped {
  projectId: string;
  kind: InventoryKind;
  name: string;
  normalisedName: string;
  quantity: number;
}

export interface InventoryLog extends Timestamped {
  projectId: string;
  sentence: string;
}

export interface Character extends Timestamped {
  projectId: string;
  name: string;
  normalisedName: string;
  orderIndex?: number;
  age: string;
  gender: string;
  personality: string;
  misc: string;
  bio: string;
  profileAttachmentId?: string;
  statsEnabled: boolean;
  str: number;
  dex: number;
  con: number;
  int: number;
  wis: number;
  cha: number;
}

export interface CharacterBonus extends Timestamped {
  characterId: string;
  name: string;
  stat: Ability;
  value: number;
}

export type Ability = "STR" | "DEX" | "CON" | "INT" | "WIS" | "CHA";

export interface Memory extends Timestamped {
  projectId: string;
  text: string;
  normalisedTags: string[];
  visibleTags: string[];
  sourceType: "manual" | "automatic" | "approved automatic";
  sourceChatId?: string;
  sourceMessageIds?: string[];
  lastRecalledAt?: number;
  recallCount: number;
  relevance: number;
  archived: boolean;
}

export interface PendingMemory extends Timestamped {
  projectId: string;
  text: string;
  tags: string[];
  reason: string;
  confidence: number;
  sourceMessageIds: string[];
}

export interface ModelLibraryEntry extends Timestamped {
  modelId: string;
  cosmeticName: string;
  orderIndex: number;
  contextLength?: number;
  supportsTools?: boolean;
  pricing?: string;
  lastSeenAt?: number;
}

export interface MigrationMetadata extends Timestamped {
  schemaVersion: number;
  appVersion: string;
}
