export type ThemeName = "onyx" | "ivory" | "blue" | "green";
export type AccentName =
  | "sage"
  | "violet"
  | "blue"
  | "rose"
  | "amber"
  | "teal"
  | "clay"
  | "silver"
  | "bone"
  | "muted blue"
  | "dusty rose"
  | "dark burgundy"
  | "dark violet"
  | "plum"
  | "deep navy"
  | "deep teal"
  | "forest green"
  | "dark rust"
  | "charcoal/slate";
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
  paragraphSpacing?: number;
  apiKey?: string;
  privacyPreset: "maximum" | "balanced" | "availability";
  defaultModelId?: string;
  temperature?: number;
  topP?: number;
  maxTokens?: number;
  maxHistoryMessages?: number;
  compactionEnabled?: boolean;
  includeWorld?: boolean;
  includeInstructions?: boolean;
  includeCharacters?: boolean;
  includeSourceFiles?: boolean;
  streamingEnabled?: boolean;
  autoManageInventory?: boolean;
  confirmInventoryUpdates?: boolean;
  autoManageGear?: boolean;
  confirmGearUpdates?: boolean;
}

export interface InventoryUpdateRequest {
  id: string;
  kind: InventoryKind | "currency";
  name: string;
  delta: number;
  logSentence: string;
  status: "pending" | "confirmed" | "edit" | "rejected" | "applied";
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
  deltaDefaultNpcStats?: AbilityScores;
  deltaPrefixes?: DeltaPrefixTemplate[];
  deltaBases?: DeltaBaseTemplate[];
  deltaJobs?: DeltaJobTemplate[];
}

export interface Chat extends Timestamped {
  projectId: string;
  title: string;
  titleState: "manual" | "pending" | "generated" | "fallback";
  modelId?: string;
  activeBranchId: string;
  archived: boolean;
  compactionMemory: string;
  currencyAmount?: number;
  deltaPlayerCharacterId?: string;
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
    inventoryUpdates?: InventoryUpdateRequest[];
  };
}

export interface DeltaModeSettings {
  modelId?: string;
  temperature?: number;
  topP?: number;
  maxTokens?: number;
  maxHistoryMessages?: number;
  playerEntityId?: string;
}

export interface DeltaSession extends Timestamped {
  chatId: string;
  projectId: string;
  title: string;
  active: boolean;
  archivedAt?: number;
  settings: DeltaModeSettings;
}

export interface DeltaMessage extends Timestamped {
  sessionId: string;
  sequence: number;
  role: "user" | "assistant" | "system";
  body: string;
  status: "complete" | "pending" | "failed";
  modelId?: string;
}

export interface DeltaLootItem {
  id: string;
  name: string;
  quantity: number;
  pickedQuantity: number;
}

export interface DeltaFinishPacket {
  finalEngagementBeat: string;
  outcomeSummary: string;
  lootItems: DeltaLootItem[];
  parentChatHandoff: string;
}

export interface DeltaEntity extends Timestamped {
  sessionId: string;
  characterId?: string;
  name: string;
  side: "ally" | "neutral" | "hostile";
  currentHp?: number;
  maxHp?: number;
  statusText?: string;
  distanceFromPlayer?: string;
  elevation?: string;
  str?: number;
  dex?: number;
  con?: number;
  int?: number;
  wis?: number;
  cha?: number;
  templateTag?: string;
  prefix?: string;
  base?: string;
  job?: string;
  generatedStatsSource?: "generated-template";
  imageAttachmentId?: string;
  orderIndex: number;
}

export interface DeltaAllyCacheEntry extends Timestamped {
  chatId: string;
  name: string;
  templateTag?: string;
  prefix?: string;
  base?: string;
  job?: string;
  generatedStatsSource?: "generated-template";
  currentHp?: number;
  maxHp?: number;
  statusText?: string;
  str?: number;
  dex?: number;
  con?: number;
  int?: number;
  wis?: number;
  cha?: number;
}

export interface DeltaActionMacro extends Timestamped {
  chatId: string;
  parentId?: string;
  label: string;
  template?: string;
  requestEntitySelection?: boolean;
  orderIndex: number;
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
  chatId: string;
  kind: InventoryKind;
  name: string;
  normalisedName: string;
  quantity: number;
}

export interface InventoryLog extends Timestamped {
  projectId: string;
  chatId: string;
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
export type AbilityScores = Record<Ability, number>;
export type AbilityModifiers = Partial<Record<Ability, number>>;

export interface DeltaPrefixTemplate {
  id: string;
  label: string;
  statModifiers: AbilityModifiers;
  notes?: string;
}

export interface DeltaBaseTemplate {
  id: string;
  label: string;
  statModifiers: AbilityModifiers;
  hpBonus?: number;
  notes?: string;
}

export interface DeltaJobTemplate {
  id: string;
  label: string;
  category: string;
  statModifiers: AbilityModifiers;
  notes?: string;
}

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
