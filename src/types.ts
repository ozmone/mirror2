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
  unitWeightKg?: number;
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
  deltaEnabled?: boolean;
  currencyName?: string;
  deltaDefaultNpcStats?: AbilityScores;
  deltaPrefixes?: DeltaPrefixTemplate[];
  deltaBases?: DeltaBaseTemplate[];
  deltaJobs?: DeltaJobTemplate[];
  deltaSystemPrompt?: string;
  deltaRevealText?: boolean;
  deltaRevealSpeed?: number;
}

export interface Chat extends Timestamped {
  projectId: string;
  title: string;
  titleState: "manual" | "pending" | "generated" | "fallback";
  modelId?: string;
  activeBranchId: string;
  archived: boolean;
  compactionMemory: string;
  compactedThroughSequence?: number;
  compactionNeedsRebuild?: boolean;
  compactionHistoryLimit?: number;
  infiniteHistoryLocked?: boolean;
  currencyAmount?: number;
  deltaPlayerCharacterId?: string;
  deltaRevealText?: boolean;
  deltaRevealSpeed?: number;
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
  contextCondensation?: string;
  contextCondensationSourceUpdatedAt?: number;
  attachmentContext?: string;
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
    audit?: MainChatRequestAudit;
  };
  deltaBrief?: {
    status: "pending" | "started";
    brief: string;
    handoffContext?: string;
    playerCharacterId?: string;
    playerCharacterName?: string;
    roster?: DeltaBriefRoster;
    mapSize?: DeltaMapSize;
    avoidLabel?: string;
    avoidPrompt?: string;
    startedAt?: number;
  };
}

export interface MainChatAuditMemoryHit {
  id: string;
  text: string;
  tags: string[];
  relevance: number;
}

export interface MainChatAuditToolEvent {
  round: number;
  callId: string;
  name: string;
  arguments: string;
  result: string;
}

export interface MainChatMemoryReviewAudit {
  status: "skipped" | "completed" | "failed";
  reason?: string;
  error?: string;
  requestPayload?: Record<string, unknown>;
  rawResponse?: string;
  condensationMessageIds: string[];
  candidates: Array<{
    text: string;
    tags: string[];
    action: "saved" | "pending approval" | "duplicate" | "not saved";
  }>;
}

export interface MainChatRequestAudit {
  version: 1;
  capturedAt: number;
  requestKind: "send" | "resend";
  projectId: string;
  projectName: string;
  chatId: string;
  userMessageId?: string;
  selectedHistory: Array<{
    id: string;
    sequence: number;
    role: Message["role"];
    usedCondensation: boolean;
  }>;
  contextSources: Array<{
    name: string;
    included: boolean;
    detail?: string;
  }>;
  memoryRetrieval: {
    mode: MemoryMode;
    query: string;
    concepts: string[];
    hits: MainChatAuditMemoryHit[];
  };
  requestPayload: Record<string, unknown>;
  toolEvents: MainChatAuditToolEvent[];
  postResponseMemory?: MainChatMemoryReviewAudit;
}

export interface DeltaBriefRoster {
  team: string[];
  neutral: string[];
  enemies: string[];
}

export type DeltaMapSize = "S" | "M" | "L" | "XL" | "XXL";

export type DeltaMapTileKind = "solid" | "half" | "special" | "access";

export interface DeltaMapTile {
  row: number;
  column: number;
  kind: DeltaMapTileKind;
  label?: string;
  color?: string;
  accessState?: "open" | "closed" | "locked";
}

export interface DeltaModeSettings {
  modelId?: string;
  temperature?: number;
  topP?: number;
  maxTokens?: number;
  maxHistoryMessages?: number;
  playerEntityId?: string;
  revealText?: boolean;
  revealSpeed?: number;
}

export interface DeltaSession extends Timestamped {
  chatId: string;
  projectId: string;
  title: string;
  mapSize?: DeltaMapSize;
  mapTiles?: DeltaMapTile[];
  active: boolean;
  archivedAt?: number;
  initiativeStarted?: boolean;
  turnIndex?: number;
  awaitingPlayerAction?: boolean;
  awaitingPlayerRoll?: boolean;
  finishReady?: boolean;
  requiredRollDie?: number;
  requiredRollCount?: number;
  requiredRollResults?: number[];
  requiredRollKind?: "initiative" | "check" | "reaction";
  requiredRollLabel?: string;
  requiredRollerName?: string;
  requiredRollAbility?: "STR" | "DEX" | "CON" | "INT" | "WIS" | "CHA";
  requiredRollModifier?: number;
  requiredRollTurnNumber?: number;
  requiredRollRawValues?: number[];
  actionPrompt?: string;
  reactionUsedEntityIds?: string[];
  reactionState?: "checking" | "available" | "resolving";
  reactionSourceActorId?: string;
  reactionTargetEntityId?: string;
  reactionTrigger?: string;
  reactionTurnNumber?: number;
  continuedTurnNumber?: number;
  settings: DeltaModeSettings;
}

export interface DeltaRollReceipt {
  id: string;
  source: "client-web-crypto";
  generator: "crypto.getRandomValues";
  algorithm: "uint32-rejection-sampling-v1";
  toolName: "request_delta_roll" | "player_delta_roll";
  rollerName: string;
  label: string;
  ability?: "STR" | "DEX" | "CON" | "INT" | "WIS" | "CHA";
  modifier?: number;
  die: number;
  count: number;
  rawValues: number[];
  results: number[];
  total?: number;
  generatedAt: number;
  hpApplications?: DeltaHpApplication[];
}

export interface DeltaHpApplication {
  entityId: string;
  entityName: string;
  kind: "damage";
  amount: number;
  beforeHp: number;
  afterHp: number;
  appliedAt: number;
}

export interface DeltaMessage extends Timestamped {
  sessionId: string;
  sequence: number;
  role: "user" | "assistant" | "system";
  body: string;
  status: "complete" | "pending" | "failed";
  modelId?: string;
  turnNumber?: number;
  eventType?: "narrative" | "roll";
  rollReceipt?: DeltaRollReceipt;
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
  engagementState?: "active" | "ko" | "dead" | "escaped";
  currentHp?: number;
  maxHp?: number;
  appliedDamageReceiptIds?: string[];
  initiative?: number;
  statusText?: string;
  distanceFromPlayer?: string;
  elevation?: string;
  mapRow?: number;
  mapColumn?: number;
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

export interface CharacterActionSlot extends Timestamped {
  characterId: string;
  name?: string;
  orderIndex: number;
}

export interface CharacterActionMacro extends Timestamped {
  slotId: string;
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
  ownerType: "archiveEntry" | "character" | "sourceFile" | "message";
  ownerId: string;
  name?: string;
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
export type GearBodyType = "type-a" | "type-b";
export type GearSlotName = "head" | "torso" | "hands" | "legs" | "feet" | "ear" | "neck" | "wrist" | "ex1" | "ex2" | "belt" | "back";

export interface InventoryItem extends Timestamped {
  projectId: string;
  chatId: string;
  kind: InventoryKind;
  name: string;
  normalisedName: string;
  quantity: number;
  unitWeightKg?: number;
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
  prefix?: string;
  base?: string;
  job?: string;
  jobCategory?: string;
  buildMode?: "template" | "custom";
  customJobName?: string;
  gearBodyType?: GearBodyType;
}

export interface CharacterBonus extends Timestamped {
  characterId: string;
  name: string;
  stat: Ability;
  value: number;
}

export interface CharacterGearSlot extends Timestamped {
  characterId: string;
  slot: GearSlotName;
  itemName: string;
  dpBonus?: number;
  apBonus?: number;
  hpBonus?: number;
  carryWeightKg?: number;
  combatLoadKg?: number;
  carrySlots?: number;
  carryReductionPercent?: number;
  traits?: string;
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

export type DeltaEffectPolarity = "positive" | "negative";
export type DeltaEffectEndBehavior = "remove" | "retain";
export type DeltaEffectTargetMode = "single" | "multiple";
export type DeltaSavingThrowTiming = "inflict" | "turn-start" | "turn-end" | "every-turn";

export interface DeltaEffectDefinition extends Timestamped {
  projectId: string;
  name: string;
  polarity: DeltaEffectPolarity;
  iconId?: string;
  turns?: number;
  effectText: string;
  curable: boolean;
  cureText: string;
  cureEndBehavior: DeltaEffectEndBehavior;
  ko: boolean;
  koText: string;
  koEndBehavior: DeltaEffectEndBehavior;
  targetSelf: boolean;
  targetOthers: boolean;
  targetAllies: boolean;
  targetNeutral: boolean;
  targetEnemies: boolean;
  targetMode: DeltaEffectTargetMode;
  maxTargets?: number;
  savingThrowEnabled: boolean;
  savingThrowStat?: Ability;
  savingThrowMinimum?: number;
  savingThrowTiming: DeltaSavingThrowTiming;
  cancelledByStatus: boolean;
  cancellationPolarity: DeltaEffectPolarity;
  cancelledByEffectIds: string[];
}

export interface DeltaIconAsset extends Timestamped {
  projectId: string;
  name: string;
  dataUrl: string;
  sourceModel?: string;
  sourcePrompt?: string;
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
