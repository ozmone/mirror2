import { Fragment, useEffect, useRef, useState } from "react";
import Dexie from "dexie";
import {
  Archive,
  Download,
  Edit3,
  Map as MapIcon,
  Pencil,
  Save,
  Settings,
  Share2,
  ShoppingBag,
  Swords,
  Trash2,
  Upload,
  UserRound,
  X,
  Zap
} from "lucide-react";
import { db } from "../../data/db";
import {
  addDeltaMessage,
  addMessage,
  applyDeltaDamage,
  applyInventoryChange,
  archiveDeltaSession,
  characterTemplateStats,
  effectiveDeltaBases,
  effectiveDeltaPrefixes,
  findCharacters,
  formatDeltaTemplateTag,
  generatedStatsPatch,
  getCharacterBio,
  getCharacterIdentity,
  getCharacterStats,
  normaliseInventoryName,
  upsertDeltaAllyCache
} from "../../data/repositories";
import { effectiveDeltaSystemPrompt } from "../../data/defaults";
import type {
  AppSettings,
  Character,
  CharacterActionMacro,
  CharacterActionSlot,
  Chat,
  DeltaAllyCacheEntry,
  DeltaEntity,
  DeltaFinishPacket,
  DeltaLootItem,
  DeltaMapTile,
  DeltaMapTileKind,
  DeltaMessage,
  DeltaRollReceipt,
  DeltaSession,
  Project
} from "../../types";
import { formatDate, now, uid } from "../../utils";
import { characterTools, deltaEntityTools, inventoryTools, type OpenRouterMessage, type OpenRouterResponse, type OpenRouterToolCall } from "../openRouter";
import { DeltaActionTree } from "./DeltaActionTree";
import { DeltaVerifiedRollRow } from "./DeltaVerifiedRollRow";
import { DeltaMapPrototype, deltaMapPreviewSizes } from "./DeltaMapPrototype";
import { DeltaTurnText, cinematicMarker, cleanDeltaCinematic, deltaRevealLines, deltaRevealStepMs, splitDeltaCinematic } from "./DeltaTurnText";
import { deltaRelationshipLabel, deltaRelationships, entityDisplayNames, formatEntityNameList, normaliseDeltaRelationship, type DeltaRelationship } from "./display";
import { deltaDiceImages } from "./config";
import { deltaEntityStats, deltaRollAbilities, deltaRollModifier, deltaRollResultText, statModifier, type DeltaRollAbility } from "./stats";
import { HpSquares } from "../shared/HpSquares";
import { LoadingSignal } from "../shared/LoadingSignal";
import { MarkdownText } from "../shared/MarkdownText";
import {
  abstractDeltaRosterName,
  cleanDeltaToolCallText,
  deltaInlineRollResultDice,
  deltaLogTurnCount,
  deltaRosterParticipants,
  downloadJson,
  entityPositionLabel,
  fitComposerTextarea,
  formatInventoryKg,
  formatLootList,
  isDeltaRollNotice,
  isInvalidDeltaEntityName,
  jobCategories,
  keepComposerVisible,
  parseDeltaFinishPacket,
  textMentionsName,
  useSavedNotice,
  visibleDeltaStartContext
} from "./workspaceSupport";

export function DeltaModeWorkspace({
  project,
  chat,
  settings,
  selectedModelId,
  session,
  messages,
  entities,
  archivedSessions,
  allyCache,
  startContext,
  onStartContextConsumed,
  onOpenInventory,
  onOpenProjectDeltaSettings,
  onClose,
  onRefresh
}: {
  project: Project;
  chat: Chat;
  settings: AppSettings;
  selectedModelId: string;
  session: DeltaSession;
  messages: DeltaMessage[];
  entities: DeltaEntity[];
  archivedSessions: DeltaSession[];
  allyCache: DeltaAllyCacheEntry[];
  startContext?: string;
  onStartContextConsumed: () => void;
  onOpenInventory: () => void;
  onOpenProjectDeltaSettings: () => void;
  onClose: () => void;
  onRefresh: () => Promise<void>;
}) {
  const [body, setBody] = useState("");
  const [activeTool, setActiveTool] = useState<"entities" | "map" | "inventory" | "history" | "actions" | undefined>();
  const [archiveSettingsOpen, setArchiveSettingsOpen] = useState(false);
  const [actionsEditMode, setActionsEditMode] = useState(false);
  const [entitySettingsOpen, setEntitySettingsOpen] = useState(false);
  const [entitySettingsTab, setEntitySettingsTab] = useState<"entities" | "ally-cache">("entities");
  const [cacheEditId, setCacheEditId] = useState<string>();
  const [cacheDraftTag, setCacheDraftTag] = useState("");
  const [cacheImportStatus, setCacheImportStatus] = useState("");
  const [clearCacheOpen, setClearCacheOpen] = useState(false);
  const [finishPacket, setFinishPacket] = useState<DeltaFinishPacket>();
  const [finishLootRoll, setFinishLootRoll] = useState<number>();
  const [finishCurrencyRoll, setFinishCurrencyRoll] = useState<{ dice: number[]; amount: number }>();
  const [finishCurrencyPicked, setFinishCurrencyPicked] = useState(0);
  const [finishAwaitingLootRoll, setFinishAwaitingLootRoll] = useState(false);
  const [finishLoading, setFinishLoading] = useState(false);
  const [finishError, setFinishError] = useState("");
  const [deltaBusy, setDeltaBusy] = useState(false);
  const [forfeitConfirmOpen, setForfeitConfirmOpen] = useState(false);
  const [expandedEntityId, setExpandedEntityId] = useState<string>();
  const [expandedRollId, setExpandedRollId] = useState<string>();
  const [projectCharacters, setProjectCharacters] = useState<Character[]>([]);
  const [actionCharacterId, setActionCharacterId] = useState("");
  const [actionSlots, setActionSlots] = useState<CharacterActionSlot[]>([]);
  const [selectedActionSlotId, setSelectedActionSlotId] = useState("");
  const [actionMacros, setActionMacros] = useState<CharacterActionMacro[]>([]);
  const [settingsDraft, setSettingsDraft] = useState(session.settings);
  const [settingsLeaveOpen, setSettingsLeaveOpen] = useState(false);
  const [playerCharacterId, setPlayerCharacterId] = useState(chat.deltaPlayerCharacterId ?? "");
  const [previewSession, setPreviewSession] = useState<DeltaSession>();
  const [previewMessages, setPreviewMessages] = useState<DeltaMessage[]>([]);
  const [previewEntities, setPreviewEntities] = useState<DeltaEntity[]>([]);
  const [pendingEntityMacro, setPendingEntityMacro] = useState<CharacterActionMacro>();
  const [selectedEntityIds, setSelectedEntityIds] = useState<Set<string>>(new Set());
  const [macroDraft, setMacroDraft] = useState<{
    macro?: CharacterActionMacro;
    parentId?: string;
    folder: boolean;
    label: string;
    template: string;
    requestEntitySelection: boolean;
  }>();
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const turnQueueRef = useRef<HTMLDivElement>(null);
  const deltaBodyRef = useRef<HTMLDivElement>(null);
  const deltaRevealSessionRef = useRef("");
  const deltaMessageSignaturesRef = useRef<Map<string, string>>(new Map());
  const stagedStartContextRef = useRef("");
  const deltaBusyRef = useRef(false);
  const pendingSettingsNavigationRef = useRef<() => void>(() => undefined);
  const [turnQueueEdges, setTurnQueueEdges] = useState({ left: false, right: false });
  const [saved, showSaved] = useSavedNotice();
  if (deltaRevealSessionRef.current !== session.id) {
    deltaRevealSessionRef.current = session.id;
    deltaMessageSignaturesRef.current = new Map(messages.map((message) => [message.id, `${message.status}:${message.body}`]));
  }
  const revealMessageIds = new Set(messages
    .filter((message) => deltaMessageSignaturesRef.current.get(message.id) !== `${message.status}:${message.body}`)
    .map((message) => message.id));
  useEffect(() => {
    deltaMessageSignaturesRef.current = new Map(messages.map((message) => [message.id, `${message.status}:${message.body}`]));
  }, [session.id, messages]);
  const archiveLimitOptions = [0, 1, 3, 5, 8, 12, 16, 20, 30, 40, 50, Infinity];
  function updateTurnQueueEdges() {
    const element = turnQueueRef.current;
    if (!element) {
      setTurnQueueEdges({ left: false, right: false });
      return;
    }
    const maxScroll = element.scrollWidth - element.clientWidth;
    setTurnQueueEdges({
      left: element.scrollLeft > 2,
      right: maxScroll > 2 && element.scrollLeft < maxScroll - 2
    });
  }
  function scrollDeltaToLatest() {
    window.requestAnimationFrame(() => {
      const element = deltaBodyRef.current;
      if (element) element.scrollTop = element.scrollHeight;
    });
  }
  useEffect(() => {
    updateTurnQueueEdges();
    window.addEventListener("resize", updateTurnQueueEdges);
    return () => window.removeEventListener("resize", updateTurnQueueEdges);
  }, [session.id, session.turnIndex, entities.length]);
  useEffect(() => {
    const composer = composerRef.current;
    fitComposerTextarea(composer);
    keepComposerVisible(composer);
  }, [body]);
  useEffect(() => {
    const handleViewportChange = () => {
      fitComposerTextarea(composerRef.current);
      keepComposerVisible(composerRef.current);
    };
    window.visualViewport?.addEventListener("resize", handleViewportChange);
    window.visualViewport?.addEventListener("scroll", handleViewportChange);
    return () => {
      window.visualViewport?.removeEventListener("resize", handleViewportChange);
      window.visualViewport?.removeEventListener("scroll", handleViewportChange);
    };
  }, []);
  useEffect(() => setSettingsDraft(session.settings), [session.id]);
  useEffect(() => setPlayerCharacterId(chat.deltaPlayerCharacterId ?? ""), [chat.id, chat.deltaPlayerCharacterId]);
  useEffect(() => {
    if (!startContext || messages.length > 0) return;
    const startKey = `${session.id}:${startContext}`;
    if (stagedStartContextRef.current === startKey) return;
    stagedStartContextRef.current = startKey;
    const handoff = startContext;
    onStartContextConsumed();
    void addDeltaMessage(session.id, "system", visibleDeltaStartContext(handoff)).then(async () => {
      const playerCharacterId = handoff.match(/PLAYER CHARACTER ID:\s*([^\n]+)/i)?.[1]?.trim();
      const timestamp = now();
      let nextOrderIndex = (await db.deltaEntities.where("sessionId").equals(session.id).count());
      if (playerCharacterId) {
        const character = await db.characters.get(playerCharacterId);
        const existing = await db.deltaEntities.where("sessionId").equals(session.id).and((entity) => entity.characterId === playerCharacterId).first();
        if (character && character.projectId === project.id && !existing) {
          await db.deltaEntities.add({ id: uid(), sessionId: session.id, ...(await characterStatsPatch(character)), side: "ally", statusText: "Entering engagement.", distanceFromPlayer: "0m", elevation: "", orderIndex: nextOrderIndex, createdAt: timestamp, updatedAt: timestamp });
          nextOrderIndex += 1;
        }
      }
      const savedCharacters = await db.characters.where("projectId").equals(project.id).toArray();
      for (const character of savedCharacters) {
        if (!textMentionsName(handoff, character.name)) continue;
        const existing = await db.deltaEntities.where("sessionId").equals(session.id).and((entity) => entity.characterId === character.id).first();
        if (existing) continue;
        await db.deltaEntities.add({ id: uid(), sessionId: session.id, ...(await characterStatsPatch(character)), side: "ally", statusText: "Entering engagement.", distanceFromPlayer: "", elevation: "", orderIndex: nextOrderIndex, createdAt: timestamp, updatedAt: timestamp });
        nextOrderIndex += 1;
      }
      for (const participant of deltaRosterParticipants(handoff)) {
        const savedCharacter = savedCharacters.find((character) => character.name.trim().toLowerCase() === participant.name.trim().toLowerCase());
        if (savedCharacter) continue;
        const existing = await db.deltaEntities
          .where("sessionId")
          .equals(session.id)
          .and((entity) => !entity.characterId && entity.name.trim().toLowerCase() === participant.name.trim().toLowerCase())
          .first();
        if (existing) continue;
        const stats = generatedStatsPatch(project, {});
        await db.deltaEntities.add({
          id: uid(),
          sessionId: session.id,
          ...stats,
          name: participant.name,
          side: participant.side,
          statusText: "Entering engagement.",
          distanceFromPlayer: "",
          elevation: "",
          orderIndex: nextOrderIndex,
          createdAt: timestamp,
          updatedAt: timestamp
        });
        nextOrderIndex += 1;
      }
      return submitDeltaTurn(handoff, {
        hideUser: true,
        stageEngagement: true,
        instruction: "Start this Delta engagement from the main-chat handoff. Do not place the handoff text in the user's composer. First stage the engagement, then write turn 1 as a concise roleplay-facing opening that explicitly names who is involved, what is happening, where it is happening, and why it matters. The client may have already created saved-character entities mentioned in the handoff; keep them, update them if needed, and do not recreate duplicates. Add only missing participants from the handoff. End by calling for initiative and stop there."
      });
    }).then(async (started) => {
      if (!started) return;
      const playerCharacterId = handoff.match(/PLAYER CHARACTER ID:\s*([^\n]+)/i)?.[1]?.trim();
      const playerName = handoff.match(/PLAYER CHARACTER:\s*([^\n]+)/i)?.[1]?.trim().toLocaleLowerCase();
      const nextSettings = { ...session.settings };
      if (playerCharacterId && !nextSettings.playerEntityId) {
        const stagedEntity = await db.deltaEntities.where("sessionId").equals(session.id).and((entity) => entity.characterId === playerCharacterId).first();
        if (stagedEntity) nextSettings.playerEntityId = stagedEntity.id;
      }
      if (playerName && !nextSettings.playerEntityId) {
        const stagedEntities = await db.deltaEntities.where("sessionId").equals(session.id).toArray();
        const matched = stagedEntities.find((entity) => entity.name.trim().toLocaleLowerCase() === playerName || entity.name.trim().toLocaleLowerCase().includes(playerName));
        if (matched) nextSettings.playerEntityId = matched.id;
      }
      await db.deltaSessions.update(session.id, { settings: nextSettings, initiativeStarted: false, awaitingPlayerRoll: true, awaitingPlayerAction: false, requiredRollDie: 20, requiredRollCount: 1, requiredRollResults: [], requiredRollKind: "initiative", requiredRollLabel: "initiative", requiredRollerName: undefined, requiredRollAbility: undefined, requiredRollModifier: undefined, requiredRollTurnNumber: undefined, requiredRollRawValues: [], actionPrompt: undefined, continuedTurnNumber: undefined, turnIndex: 0, updatedAt: now() });
      await onRefresh();
    });
  }, [startContext, messages.length]);
  useEffect(() => {
    const closeFromHistory = (event: PopStateEvent) => {
      if ((event.state as { mirrorDeltaMode?: boolean } | null)?.mirrorDeltaMode) return;
      onClose();
    };
    window.addEventListener("popstate", closeFromHistory);
    return () => window.removeEventListener("popstate", closeFromHistory);
  }, [onClose]);
  useEffect(() => {
    if (activeTool !== "entities" && activeTool !== "actions") return;
    void db.characters
      .where("projectId")
      .equals(project.id)
      .toArray()
      .then((rows) => setProjectCharacters(rows.sort((a, b) => (a.orderIndex ?? Number.MAX_SAFE_INTEGER) - (b.orderIndex ?? Number.MAX_SAFE_INTEGER) || a.normalisedName.localeCompare(b.normalisedName))));
  }, [activeTool, project.id]);
  useEffect(() => {
    const playerEntity = entities.find((entity) => entity.id === session.settings.playerEntityId) ?? entities.find((entity) => entity.characterId === chat.deltaPlayerCharacterId);
    setActionCharacterId(chat.deltaPlayerCharacterId || playerEntity?.characterId || "");
  }, [chat.deltaPlayerCharacterId, session.settings.playerEntityId, entities]);
  async function loadActionLibrary(characterId = actionCharacterId, preferredSlotId = selectedActionSlotId) {
    if (!characterId) {
      setActionSlots([]);
      setSelectedActionSlotId("");
      setActionMacros([]);
      return;
    }
    const timestamp = now();
    let slots = (await db.characterActionSlots.where("characterId").equals(characterId).toArray()).sort((a, b) => a.orderIndex - b.orderIndex);
    if (!slots.length) {
      const slot: CharacterActionSlot = { id: uid(), characterId, orderIndex: 0, createdAt: timestamp, updatedAt: timestamp };
      await db.characterActionSlots.add(slot);
      slots = [slot];
    }
    const slotId = slots.some((slot) => slot.id === preferredSlotId) ? preferredSlotId : slots[0].id;
    const macros = await db.characterActionMacros.where("slotId").equals(slotId).toArray();
    setActionSlots(slots);
    setSelectedActionSlotId(slotId);
    setActionMacros(macros.sort((a, b) => a.orderIndex - b.orderIndex));
  }
  useEffect(() => {
    if (activeTool !== "actions") return;
    void loadActionLibrary(actionCharacterId, selectedActionSlotId);
  }, [activeTool, actionCharacterId]);
  useEffect(() => {
    if (!session.awaitingPlayerRoll || activeTool !== "actions") return;
    setActiveTool(undefined);
  }, [session.awaitingPlayerRoll, activeTool]);
  function setDeltaRequestBusy(next: boolean) {
    deltaBusyRef.current = next;
    setDeltaBusy(next);
  }
  async function deltaOpenRouterRequest(payload: Record<string, unknown>) {
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${(settings.apiKey ?? "").trim()}`,
        "Content-Type": "application/json",
        "HTTP-Referer": location.origin,
        "X-Title": "Mirror 2.0"
      },
      body: JSON.stringify(payload)
    });
    if (!response.ok) throw new Error((await response.text()) || `OpenRouter request failed (${response.status})`);
    return response;
  }
  async function deltaCharacterPatch(character: Character) {
    return characterStatsPatch(character);
  }
  function deltaToolArgs(toolCall: OpenRouterToolCall) {
    try {
      return JSON.parse(toolCall.function.arguments || "{}") as Record<string, unknown>;
    } catch {
      return {};
    }
  }
  async function runDeltaTool(toolCall: OpenRouterToolCall, turnNumber?: number) {
    const args = deltaToolArgs(toolCall);
    const stringArg = (key: string) => typeof args[key] === "string" ? String(args[key]).trim() : "";
    const mapCoordinate = (key: "mapRow" | "mapColumn") => {
      const value = Number(args[key]);
      const limit = deltaMapPreviewSizes[session.mapSize ?? "M"].cells;
      return Number.isInteger(value) && value >= 1 && value <= limit ? value : undefined;
    };
    switch (toolCall.function.name) {
      case "update_inventory_item": {
        if (!project.inventoryEnabled || !settings.autoManageInventory) return { error: "Inventory auto-management is disabled." };
        const kind = args.kind === "currency" ? "currency" : "inventory";
        const name = kind === "currency" ? (project.currencyName?.trim() || stringArg("name")) : normaliseInventoryName(stringArg("name"));
        const delta = typeof args.delta === "number" ? args.delta : Number(args.delta);
        const unitWeightKg = typeof args.unitWeightKg === "number" ? args.unitWeightKg : Number(args.unitWeightKg);
        const logSentence = stringArg("logSentence");
        if (!name || !Number.isFinite(delta) || delta === 0) return { error: "A non-empty item name and non-zero delta are required." };
        if (!logSentence) return { error: "A one-line log sentence is required." };
        if (kind === "currency") {
          const timestamp = now();
          const activeChat = await db.chats.get(chat.id);
          const quantity = Math.max(0, (activeChat?.currencyAmount ?? 0) + delta);
          await db.transaction("rw", db.chats, db.inventoryLogs, async () => {
            await db.chats.update(chat.id, { currencyAmount: quantity, updatedAt: timestamp });
            await db.inventoryLogs.add({ id: uid(), projectId: project.id, chatId: chat.id, sentence: logSentence, createdAt: timestamp, updatedAt: timestamp });
          });
          return { applied: true, kind, name, delta, quantity };
        }
        const result = await applyInventoryChange(project.id, chat.id, "inventory", name, delta, logSentence, Number.isFinite(unitWeightKg) && unitWeightKg > 0 ? unitWeightKg : undefined);
        return { applied: Boolean(result), kind, name, delta, quantity: result?.quantity };
      }
      case "find_characters":
        return findCharacters(project.id, stringArg("nameQuery"));
      case "get_character_identity":
        return stringArg("characterId") ? getCharacterIdentity(project.id, stringArg("characterId")) : { error: "characterId is required." };
      case "get_character_bio":
        return stringArg("characterId") ? getCharacterBio(project.id, stringArg("characterId")) : { error: "characterId is required." };
      case "get_character_stats":
        return stringArg("characterId") ? getCharacterStats(project.id, stringArg("characterId")) : { error: "characterId is required." };
      case "set_delta_engagement_name": {
        const title = stringArg("title").slice(0, 96);
        if (!title) return { error: "An engagement title is required." };
        await db.deltaSessions.update(session.id, { title, updatedAt: now() });
        return { title };
      }
      case "set_delta_map": {
        const { cells } = deltaMapPreviewSizes[session.mapSize ?? "M"];
        const rawTiles = Array.isArray(args.tiles) ? args.tiles : [];
        const tilesByCoordinate = new Map<string, DeltaMapTile>();
        const errors: string[] = [];
        for (const rawTile of rawTiles) {
          if (!rawTile || typeof rawTile !== "object") {
            errors.push("A map tile was not an object.");
            continue;
          }
          const candidate = rawTile as Record<string, unknown>;
          const row = Math.floor(Number(candidate.row));
          const column = Math.floor(Number(candidate.column));
          const kind = typeof candidate.kind === "string" ? candidate.kind.trim().toLowerCase() as DeltaMapTileKind : undefined;
          if (!Number.isInteger(row) || !Number.isInteger(column) || row < 1 || row > cells || column < 1 || column > cells || !["solid", "half", "special", "access"].includes(kind ?? "")) {
            errors.push(`Ignored invalid tile at ${String(candidate.row)}, ${String(candidate.column)}.`);
            continue;
          }
          const label = typeof candidate.label === "string" ? candidate.label.trim().slice(0, 80) : "";
          const color = typeof candidate.color === "string" && /^#[0-9a-f]{6}$/i.test(candidate.color.trim()) ? candidate.color.trim() : undefined;
          const accessState = candidate.accessState === "open" || candidate.accessState === "locked" || candidate.accessState === "closed" ? candidate.accessState : "closed";
          if (kind === "special" && (!label || !color)) {
            errors.push(`Ignored special tile at ${row}, ${column}: special terrain needs a label and hex color.`);
            continue;
          }
          tilesByCoordinate.set(`${row}:${column}`, {
            row,
            column,
            kind: kind as DeltaMapTileKind,
            ...(label ? { label } : {}),
            ...(kind === "special" && color ? { color } : {}),
            ...(kind === "access" ? { accessState } : {})
          });
        }
        const mapTiles = [...tilesByCoordinate.values()];
        await db.deltaSessions.update(session.id, { mapTiles, updatedAt: now() });
        return { staged: mapTiles.length, mapSize: session.mapSize ?? "M", cells, ...(errors.length ? { errors } : {}) };
      }
      case "list_delta_job_categories": {
        const counts = jobCategories(project.deltaJobs ?? []);
        return counts.map(([category, count]) => ({ category, count }));
      }
      case "get_delta_jobs_for_category": {
        const category = stringArg("category").toLowerCase();
        return (project.deltaJobs ?? [])
          .filter((job) => job.category.trim().toLowerCase() === category)
          .map((job) => ({ label: job.label, category: job.category, statModifiers: job.statModifiers, notes: job.notes ?? "" }));
      }
      case "create_delta_entity": {
        const characterId = stringArg("characterId");
        const requestedName = stringArg("name");
        const requestedCharacter = characterId ? await db.characters.get(characterId) : undefined;
        const character = requestedCharacter && requestedCharacter.projectId === project.id
          ? requestedCharacter
          : requestedName
            ? await db.characters.where("projectId").equals(project.id).and((item) => item.name.trim().toLowerCase() === requestedName.toLowerCase()).first()
            : undefined;
        const entityName = character?.name || requestedName || "Unnamed entity";
        if (!character && (isInvalidDeltaEntityName(entityName) || abstractDeltaRosterName(entityName))) {
          return {
            error: "Use a concrete observable identity for this participant: a canonical name, visible person, animal/species, or recognizable role. Put range, cover, terrain, and position details in their dedicated fields.",
            rejectedName: entityName
          };
        }
        const mapRow = mapCoordinate("mapRow");
        const mapColumn = mapCoordinate("mapColumn");
        const existingEntity = await db.deltaEntities
          .where("sessionId")
          .equals(session.id)
          .and((entity) => character
            ? entity.characterId === character.id || entity.name.trim().toLowerCase() === entityName.trim().toLowerCase()
            : !entity.characterId && entity.name.trim().toLocaleLowerCase() === entityName.trim().toLocaleLowerCase())
          .first();
        if (existingEntity) {
          const generatedTemplateRequested = !character && ["prefix", "base", "job"].some((key) => stringArg(key));
          const patch = character && character.projectId === project.id
            ? await deltaCharacterPatch(character)
            : generatedTemplateRequested
              ? generatedStatsPatch(project, { prefix: stringArg("prefix"), base: stringArg("base"), job: stringArg("job"), jobCategory: stringArg("jobCategory") })
              : {};
          const next: Partial<DeltaEntity> = {
            ...patch,
            ...(mapRow !== undefined && mapColumn !== undefined ? { mapRow, mapColumn } : {}),
            updatedAt: now()
          };
          if (Object.keys(next).length > 1) await db.deltaEntities.update(existingEntity.id, next);
          if (generatedTemplateRequested) await upsertDeltaAllyCache(chat.id, { ...existingEntity, ...next });
          return {
            existing: character?.name || existingEntity.name,
            entityId: existingEntity.id,
            templateTag: next.templateTag ?? existingEntity.templateTag ?? "",
            stats: { STR: next.str ?? existingEntity.str, DEX: next.dex ?? existingEntity.dex, CON: next.con ?? existingEntity.con, INT: next.int ?? existingEntity.int, WIS: next.wis ?? existingEntity.wis, CHA: next.cha ?? existingEntity.cha },
            hp: { current: next.currentHp ?? existingEntity.currentHp, max: next.maxHp ?? existingEntity.maxHp },
            mapPosition: mapRow !== undefined && mapColumn !== undefined ? { row: mapRow, column: mapColumn } : undefined
          };
        }
        const timestamp = now();
        const basePatch = character && character.projectId === project.id
          ? await deltaCharacterPatch(character)
          : generatedStatsPatch(project, { prefix: stringArg("prefix"), base: stringArg("base"), job: stringArg("job"), jobCategory: stringArg("jobCategory") });
        const entity: DeltaEntity = {
          id: uid(),
          sessionId: session.id,
          ...basePatch,
          name: entityName,
          side: normaliseDeltaRelationship(stringArg("side")) as DeltaRelationship,
          statusText: stringArg("statusText"),
          distanceFromPlayer: stringArg("distanceFromPlayer"),
          elevation: stringArg("elevation"),
          ...(mapRow !== undefined && mapColumn !== undefined ? { mapRow, mapColumn } : {}),
          orderIndex: await db.deltaEntities.where("sessionId").equals(session.id).count(),
          createdAt: timestamp,
          updatedAt: timestamp
        };
        await db.deltaEntities.add(entity);
        await upsertDeltaAllyCache(chat.id, entity);
        return {
          created: entity.name,
          entityId: entity.id,
          templateTag: entity.templateTag ?? "",
          stats: { STR: entity.str, DEX: entity.dex, CON: entity.con, INT: entity.int, WIS: entity.wis, CHA: entity.cha },
          hp: { current: entity.currentHp, max: entity.maxHp }
        };
      }
      case "finish_delta_engagement":
        await db.deltaSessions.update(session.id, {
          finishReady: true,
          awaitingPlayerAction: false,
          awaitingPlayerRoll: false,
          actionPrompt: undefined,
          requiredRollDie: undefined,
          requiredRollCount: undefined,
          requiredRollResults: undefined,
          requiredRollKind: undefined,
          requiredRollLabel: undefined,
          requiredRollerName: undefined,
          requiredRollAbility: undefined,
          requiredRollModifier: undefined,
          requiredRollTurnNumber: undefined,
          requiredRollRawValues: undefined,
          continuedTurnNumber: undefined,
          updatedAt: now()
        });
        return { finishing: true, message: "The client will show the End Engagement control. Do not write a closing response." };
      case "set_delta_player_entity": {
        const entityId = stringArg("entityId");
        const entity = entityId ? await db.deltaEntities.get(entityId) : undefined;
        if (!entity || entity.sessionId !== session.id) return { error: "Entity not found in this active Delta engagement." };
        await db.deltaSessions.update(session.id, { settings: { ...session.settings, playerEntityId: entity.id }, updatedAt: now() });
        if (entity.characterId) await db.chats.update(chat.id, { deltaPlayerCharacterId: entity.characterId, updatedAt: now() });
        return { playerEntityId: entity.id, playerName: entity.name };
      }
      case "request_delta_roll": {
        const die = Number(args.die);
        const allowedDice = [4, 6, 8, 9, 12, 20, 100];
        if (!allowedDice.includes(die)) return { error: "Unsupported die. Use d4, d6, d8, d9, d12, d20, or d100." };
        const current = await db.deltaSessions.get(session.id);
        const ordered = (await db.deltaEntities.where("sessionId").equals(session.id).toArray())
          .filter(canTakeDeltaTurn)
          .sort((a, b) => a.orderIndex - b.orderIndex);
        const currentActor = ordered[current?.turnIndex ?? 0];
        const playerEntityId = current?.settings.playerEntityId ?? ordered.find((entity) => entity.characterId === chat.deltaPlayerCharacterId)?.id;
        const count = Math.max(1, Math.min(12, Math.floor(typeof args.count === "number" && Number.isFinite(args.count) ? args.count : 1)));
        const label = stringArg("label").slice(0, 80) || `d${die} roll`;
        const abilityArg = stringArg("ability").toUpperCase();
        if (abilityArg !== "NONE" && !deltaRollAbilities.includes(abilityArg as DeltaRollAbility)) {
          return { error: "A governing ability is required. Use STR, DEX, CON, INT, WIS, CHA, or NONE." };
        }
        const ability = abilityArg === "NONE" ? undefined : abilityArg as DeltaRollAbility;
        const rollerNameArg = stringArg("rollerName").slice(0, 80);
        const normalizedLabel = `${rollerNameArg} ${label}`.toLowerCase();
        const playerEntity = playerEntityId ? ordered.find((entity) => entity.id === playerEntityId) : undefined;
        const labelEntity = ordered.find((entity) => normalizedLabel.includes(entity.name.trim().toLowerCase()));
        const rollerEntity = rollerNameArg
          ? ordered.find((entity) => entity.name.trim().toLowerCase() === rollerNameArg.trim().toLowerCase()) ?? labelEntity
          : labelEntity ?? currentActor;
        const isNonPlayerRoll = Boolean(rollerEntity && (!playerEntityId || rollerEntity.id !== playerEntityId));
        const modifier = deltaRollModifier(rollerEntity, ability);
        if (isNonPlayerRoll) {
          const samples = Array.from({ length: count }, () => secureRollSample(die));
          const results = samples.map((sample) => sample.result);
          const rollResult = deltaRollResultText(die, results, modifier);
          const resultText = rollResult.text;
          const roller = rollerEntity?.name ?? "NPC";
          const receipt = createRollReceipt({
            toolName: "request_delta_roll",
            rollerName: roller,
            label,
            ability,
            modifier,
            die,
            results,
            rawValues: samples.map((sample) => sample.rawValue),
            total: rollResult.total
          });
          await addDeltaMessage(session.id, "system", `${roller}: Roll ${label}${ability ? ` (${ability})` : ""}: ${resultText}`, {
            turnNumber,
            eventType: "roll",
            rollReceipt: receipt
          });
          return {
            rolled: true,
            automatic: true,
            roller,
            label,
            die,
            count,
            results,
            ability: ability ?? "NONE",
            modifier,
            total: rollResult.total,
            resultText,
            receiptId: receipt.id,
            instruction: /damage/i.test(label)
              ? "This is an authoritative client-generated damage roll. Before writing aftermath, call apply_delta_damage with the correct target entityId, this exact total, and this receipt ID. Do not merely narrate damage and do not repeat the roll line."
              : /(?:attack|strike|shot)/i.test(label)
                ? "This is an authoritative client-generated attack roll. Determine hit or miss. If it hits, call request_delta_roll for damage and stop before writing hit aftermath. If it misses, resolve the miss without a damage roll. Do not repeat the attack roll line."
                : "These are authoritative client-generated dice results. The app has already displayed them in a separate verified roll row. Use these exact numbers to resolve the turn, but do not repeat or rewrite the roll line in narrative text."
          };
        }
        await db.deltaSessions.update(session.id, {
          awaitingPlayerRoll: true,
          awaitingPlayerAction: false,
          requiredRollDie: die,
          requiredRollCount: count,
          requiredRollResults: [],
          requiredRollKind: "check",
          requiredRollLabel: label,
          requiredRollerName: isNonPlayerRoll ? rollerEntity?.name ?? "NPC" : playerEntity?.name ?? currentActor?.name ?? "player",
          requiredRollAbility: ability,
          requiredRollModifier: modifier,
          requiredRollTurnNumber: turnNumber,
          requiredRollRawValues: [],
          actionPrompt: undefined,
          updatedAt: now()
        });
        return { waitingForRoll: `${count}d${die}`, label, roller: isNonPlayerRoll ? rollerEntity?.name ?? "NPC" : playerEntity?.name ?? currentActor?.name ?? "player", ability: ability ?? "NONE", modifier };
      }
      case "request_delta_reaction": {
        const current = await db.deltaSessions.get(session.id);
        const roster = (await db.deltaEntities.where("sessionId").equals(session.id).toArray())
          .filter(canTakeDeltaTurn)
          .sort((a, b) => a.orderIndex - b.orderIndex);
        const targetEntityId = stringArg("targetEntityId");
        const target = roster.find((entity) => entity.id === targetEntityId);
        if (!current || !target) return { error: "The reaction target is not an active entity in this engagement." };
        const used = new Set(current.reactionUsedEntityIds ?? []);
        if (used.has(target.id)) {
          return { reactionAvailable: false, target: target.name, reason: "Reaction already attempted this round. Resolve the incoming action without another reaction check." };
        }
        const trigger = stringArg("trigger").slice(0, 240) || "Incoming threat";
        const modifier = deltaRollModifier(target, "DEX");
        const reactionUsedEntityIds = [...used, target.id];
        const playerEntityId = current.settings.playerEntityId
          ?? roster.find((entity) => entity.characterId === chat.deltaPlayerCharacterId)?.id;
        const currentActor = roster[current.turnIndex ?? 0];
        if (target.id !== playerEntityId) {
          const sample = secureRollSample(8);
          const rollResult = deltaRollResultText(8, [sample.result], modifier);
          const receipt = createRollReceipt({
            toolName: "request_delta_roll",
            rollerName: target.name,
            label: "reaction",
            ability: "DEX",
            modifier,
            die: 8,
            results: [sample.result],
            rawValues: [sample.rawValue],
            total: rollResult.total
          });
          await addDeltaMessage(session.id, "system", `${target.name}: Roll reaction (DEX): ${rollResult.text}`, {
            turnNumber,
            eventType: "roll",
            rollReceipt: receipt
          });
          await db.deltaSessions.update(session.id, { reactionUsedEntityIds, updatedAt: now() });
          return {
            reactionAvailable: rollResult.total >= 6,
            target: target.name,
            trigger,
            die: 8,
            ability: "DEX",
            modifier,
            total: rollResult.total,
            receiptId: receipt.id,
            instruction: rollResult.total >= 6
              ? "The reaction check succeeded. Resolve one brief, physically plausible reaction for this non-player entity before finishing the current actor's turn. Do not create a separate turn."
              : "The reaction check failed. The target receives no reaction; finish resolving the current actor's action."
          };
        }
        await db.deltaSessions.update(session.id, {
          reactionUsedEntityIds,
          reactionState: "checking",
          reactionSourceActorId: currentActor?.id,
          reactionTargetEntityId: target.id,
          reactionTrigger: trigger,
          reactionTurnNumber: turnNumber,
          awaitingPlayerRoll: true,
          awaitingPlayerAction: false,
          requiredRollDie: 8,
          requiredRollCount: 1,
          requiredRollResults: [],
          requiredRollKind: "reaction",
          requiredRollLabel: "reaction",
          requiredRollerName: target.name,
          requiredRollAbility: "DEX",
          requiredRollModifier: modifier,
          requiredRollTurnNumber: turnNumber,
          requiredRollRawValues: [],
          actionPrompt: undefined,
          updatedAt: now()
        });
        return { waitingForRoll: "1d8", reactionCheck: true, target: target.name, trigger, ability: "DEX", modifier, threshold: 6 };
      }
      case "request_delta_action": {
        const prompt = stringArg("prompt").slice(0, 180) || "It is your turn.";
        await db.deltaSessions.update(session.id, {
          awaitingPlayerAction: true,
          awaitingPlayerRoll: false,
          actionPrompt: prompt,
          requiredRollDie: undefined,
          requiredRollCount: undefined,
          requiredRollResults: undefined,
          requiredRollKind: undefined,
          requiredRollLabel: undefined,
          requiredRollerName: undefined,
          requiredRollAbility: undefined,
          requiredRollModifier: undefined,
          requiredRollTurnNumber: undefined,
          requiredRollRawValues: undefined,
          updatedAt: now()
        });
        return { waitingForAction: true, prompt };
      }
      case "continue_delta_player_turn": {
        const current = await db.deltaSessions.get(session.id);
        const ordered = (await db.deltaEntities.where("sessionId").equals(session.id).toArray())
          .filter(canTakeDeltaTurn)
          .sort((a, b) => a.orderIndex - b.orderIndex);
        const currentActor = ordered[current?.turnIndex ?? 0];
        const playerEntityId = current?.settings.playerEntityId
          ?? ordered.find((entity) => entity.characterId === chat.deltaPlayerCharacterId)?.id;
        if (!current?.initiativeStarted || !currentActor || currentActor.id !== playerEntityId) {
          return { error: "Only the current player entity can retain its turn for free dialogue." };
        }
        const cinematicReply = cleanDeltaCinematic(stringArg("cinematicReply")).slice(0, 500).trim();
        if (!cinematicReply) return { error: "A concise cinematicReply is required to retain a dialogue-only turn." };
        const prompt = stringArg("prompt").slice(0, 180) || "Your turn remains open.";
        await addDeltaMessage(session.id, "assistant", `${cinematicMarker()} ${cinematicReply}`, { turnNumber, eventType: "narrative" });
        await db.deltaSessions.update(session.id, {
          awaitingPlayerAction: true,
          awaitingPlayerRoll: false,
          actionPrompt: prompt,
          continuedTurnNumber: turnNumber,
          updatedAt: now()
        });
        return { waitingForAction: true, retainedTurn: turnNumber, cinematicReplyPosted: true, prompt };
      }
      case "apply_delta_damage": {
        const entityId = stringArg("entityId");
        const rollReceiptId = stringArg("rollReceiptId");
        const amount = Number(args.amount);
        if (!entityId || !rollReceiptId || !Number.isFinite(amount)) return { error: "entityId, amount, and rollReceiptId are required." };
        const zeroHpOutcome = stringArg("zeroHpOutcome") === "dead" ? "dead" : "ko";
        const result = await applyDeltaDamage(session.id, entityId, amount, rollReceiptId, zeroHpOutcome);
        if ("applied" in result && result.applied) {
          const updatedEntity = await db.deltaEntities.get(entityId);
          if (updatedEntity) await upsertDeltaAllyCache(chat.id, updatedEntity);
          await markFinishReadyIfOppositionResolved();
        }
        return result;
      }
      case "update_delta_entity": {
        const entity = await db.deltaEntities.get(stringArg("entityId"));
        if (!entity || entity.sessionId !== session.id) return { error: "Entity not found in this active Delta engagement." };
        const templateRequested = ["prefix", "base", "job"].some((key) => stringArg(key));
        const patch = templateRequested && !entity.characterId
          ? generatedStatsPatch(project, { prefix: stringArg("prefix"), base: stringArg("base"), job: stringArg("job"), jobCategory: stringArg("jobCategory") })
          : {};
        const next: Partial<DeltaEntity> = {
          ...patch,
          name: stringArg("name") || entity.name,
          side: stringArg("side") ? normaliseDeltaRelationship(stringArg("side")) : entity.side,
          engagementState: ["active", "ko", "dead", "escaped"].includes(stringArg("engagementState"))
            ? stringArg("engagementState") as DeltaEntity["engagementState"]
            : entity.engagementState,
          statusText: stringArg("statusText") || entity.statusText,
          maxHp: typeof args.maxHp === "number" && Number.isFinite(args.maxHp) ? Math.max(1, args.maxHp) : entity.maxHp,
          initiative: typeof args.initiative === "number" && Number.isFinite(args.initiative) ? args.initiative : entity.initiative,
          distanceFromPlayer: stringArg("distanceFromPlayer") || entity.distanceFromPlayer,
          elevation: stringArg("elevation") || entity.elevation,
          ...(mapCoordinate("mapRow") !== undefined && mapCoordinate("mapColumn") !== undefined ? { mapRow: mapCoordinate("mapRow"), mapColumn: mapCoordinate("mapColumn") } : {}),
          updatedAt: now()
        };
        await db.deltaEntities.update(entity.id, next);
        await upsertDeltaAllyCache(chat.id, { ...entity, ...next });
        await markFinishReadyIfOppositionResolved();
        return { updated: next.name, entityId: entity.id, templateTag: "templateTag" in next ? next.templateTag ?? "" : entity.templateTag ?? "" };
      }
      default:
        return { error: `Unknown Delta tool ${toolCall.function.name}.` };
    }
  }
  async function nextDeltaTurnNumber() {
    const stored = await db.deltaMessages.where("sessionId").equals(session.id).toArray();
    return deltaLogTurnCount(stored.sort((a, b) => a.sequence - b.sequence)) + 1;
  }
  async function completeDeltaTurn(
    history: OpenRouterMessage[],
    toolLog: string[],
    requireInitialTool = false,
    turnNumber?: number,
    persistBeforeTools?: (content: string, includesRoll: boolean) => Promise<void>
  ) {
    let messagesToSend = history;
    const visibleChunks: string[] = [];
    const latestRequestContent = history[history.length - 1]?.content;
    let hasCurrentVerifiedRoll = typeof latestRequestContent === "string" && /(?:dice roll receipt|authoritative (?:roll|total))/i.test(latestRequestContent);
    const latestRequestText = typeof latestRequestContent === "string" ? latestRequestContent.toLowerCase() : "";
    let pendingAttackResolution = /client-generated[^.\n]*(?:attack|strike|shot)/i.test(latestRequestText);
    let pendingDamageApplication = /client-generated[^.\n]*damage/i.test(latestRequestText);
    const verifiedDice = new Set<number>();
    if (hasCurrentVerifiedRoll && typeof latestRequestContent === "string") {
      for (const match of latestRequestContent.matchAll(/\bd(4|6|8|9|12|20|100)\b/gi)) verifiedDice.add(Number(match[1]));
    }
    let forceCorrectiveTool = false;
    let forcedToolName: "request_delta_roll" | "apply_delta_damage" | undefined;
    for (let index = 0; index < 6; index += 1) {
      const response = await deltaOpenRouterRequest({
        model: session.settings.modelId || chat.modelId || selectedModelId || settings.defaultModelId,
        messages: messagesToSend,
        tools: [...characterTools, ...deltaEntityTools, ...(project.inventoryEnabled && settings.autoManageInventory ? [...inventoryTools] : [])],
        ...(forcedToolName
          ? { tool_choice: { type: "function", function: { name: forcedToolName } } }
          : forceCorrectiveTool
          ? { tool_choice: "required" }
          : requireInitialTool && index === 0
            ? { tool_choice: "required" }
            : {}),
        temperature: session.settings.temperature ?? 0,
        top_p: session.settings.topP ?? 0,
        ...(session.settings.maxTokens ? { max_tokens: session.settings.maxTokens } : {})
      });
      const json = await response.json() as OpenRouterResponse;
      const assistantMessage = json.choices?.[0]?.message;
      const toolCalls = assistantMessage?.tool_calls ?? [];
      const rawContent = assistantMessage?.content ?? "";
      const content = cleanDeltaToolCallText(rawContent);
      const inlineRollDice = deltaInlineRollResultDice(content);
      if (inlineRollDice.length > 0) {
        const onlyRepeatsVerifiedRoll = hasCurrentVerifiedRoll
          && inlineRollDice.every((die) => die !== 0 && verifiedDice.has(die));
        forceCorrectiveTool = !onlyRepeatsVerifiedRoll;
        toolLog.push("rejected_unverified_roll_text");
        messagesToSend = [
          ...messagesToSend,
          {
            role: "user",
            content: onlyRepeatsVerifiedRoll
              ? "The client rejected that response because dice results must never be written inside narrative text, including repetitions of a verified roll. Rewrite the outcome without any roll line or dice arithmetic. Use the existing authoritative receipt and do not reroll."
              : "The client discarded your entire response because it invented a dice result. That discarded response is not evidence that a roll was needed. Re-read the latest actual player entry and classify it again. If it was only direct speech, signalling, or communication, call continue_delta_player_turn with the addressed entity's brief response in cinematicReply; do not create an attack. If it contained a genuine uncertain action, call request_delta_roll with the correct rollerName, die, label, and ability. Never invent an action that the player did not declare, and do not write dice results in prose."
          }
        ];
        continue;
      }
      forceCorrectiveTool = false;
      forcedToolName = undefined;
      if (!toolCalls.length) {
        if (pendingDamageApplication) {
          forcedToolName = "apply_delta_damage";
          messagesToSend = [
            ...messagesToSend,
            {
              role: "user",
              content: "The verified damage roll has not been applied to the target entity. Discard that aftermath. Call apply_delta_damage now with the correct target entityId, the verified damage total, its exact receipt ID, and the appropriate KO or DEAD zero-HP outcome. Do not narrate the aftermath until the client confirms the HP update."
            }
          ];
          continue;
        }
        if (pendingAttackResolution && /\b(?:hit|hits|strikes?|clips?|connects?|grazes?|pierces?|wounds?|damage)\b/i.test(content)) {
          pendingAttackResolution = false;
          forcedToolName = "request_delta_roll";
          messagesToSend = [
            ...messagesToSend,
            {
              role: "user",
              content: "The verified attack appears to hit, but no verified damage roll exists. Discard that hit aftermath. Call request_delta_roll now for damage with the correct rollerName, damage die/count, label containing 'damage', and governing ability. Do not estimate damage or change HP yet."
            }
          ];
          continue;
        }
        if (content) visibleChunks.push(content);
        return visibleChunks.join("\n").trim();
      }
      const dialogueContinuationOwnsReply = toolCalls.some((toolCall) => toolCall.function.name === "continue_delta_player_turn");
      const contentBeforeTools = dialogueContinuationOwnsReply ? "" : content;
      const includesRoll = toolCalls.some((toolCall) => toolCall.function.name === "request_delta_roll" || toolCall.function.name === "request_delta_reaction");
      if (persistBeforeTools) await persistBeforeTools(contentBeforeTools, includesRoll);
      else if (contentBeforeTools) visibleChunks.push(contentBeforeTools);
      let pauseRequested = false;
      messagesToSend = [
        ...messagesToSend,
        { role: "assistant", content: assistantMessage?.content ?? "", tool_calls: toolCalls }
      ];
      for (const toolCall of toolCalls) {
        const result = await runDeltaTool(toolCall, turnNumber);
        toolLog.push(toolCall.function.name);
        if (typeof result === "object" && result && ("waitingForRoll" in result || "waitingForAction" in result)) pauseRequested = true;
        if (toolCall.function.name === "request_delta_roll" && typeof result === "object" && result && "total" in result && typeof result.total === "number") {
          hasCurrentVerifiedRoll = true;
          if ("die" in result && typeof result.die === "number") verifiedDice.add(result.die);
          const label = "label" in result && typeof result.label === "string" ? result.label.toLowerCase() : "";
          if (/damage/.test(label)) {
            pendingAttackResolution = false;
            pendingDamageApplication = true;
          } else if (/(?:attack|strike|shot)/.test(label)) {
            pendingAttackResolution = true;
          }
        }
        if (toolCall.function.name === "request_delta_reaction" && typeof result === "object" && result && "total" in result && typeof result.total === "number") {
          hasCurrentVerifiedRoll = true;
          verifiedDice.add(8);
        }
        if (toolCall.function.name === "apply_delta_damage" && typeof result === "object" && result && "applied" in result && result.applied === true) {
          pendingDamageApplication = false;
        }
        messagesToSend.push({ role: "tool", tool_call_id: toolCall.id, content: JSON.stringify(result) });
      }
      if (pauseRequested) {
        return visibleChunks.join("\n").trim();
      }
    }
    throw new Error("Delta blocked repeated AI-authored dice results. The current turn was not advanced; retry it.");
  }
  async function submitDeltaTurn(clean: string, options: { hideUser?: boolean; instruction?: string; stageEngagement?: boolean; turnActorId?: string; turnNumber?: number; allowDialogueReply?: boolean } = {}) {
    if (!clean || !session.active) return false;
    if (deltaBusyRef.current) return false;
    if (!settings.apiKey) {
      alert("Add your OpenRouter API key before sending Delta AI requests. Your draft is still here.");
      return false;
    }
    const model = session.settings.modelId || chat.modelId || selectedModelId || settings.defaultModelId;
    if (!model) {
      alert("Choose a model before sending Delta AI requests. Your draft is still here.");
      return false;
    }
    const turnNumber = options.turnNumber ?? await nextDeltaTurnNumber();
    if (!options.hideUser) await addDeltaMessage(session.id, "user", clean, { turnNumber, eventType: "narrative" });
    const timestamp = now();
    const replyId = uid();
    const replySequence = ((await db.deltaMessages.where("[sessionId+sequence]").between([session.id, Dexie.minKey], [session.id, Dexie.maxKey]).last())?.sequence ?? -1) + 1;
    await db.deltaMessages.add({ id: replyId, sessionId: session.id, sequence: replySequence, role: "assistant", body: "...", status: "pending", modelId: model, turnNumber, eventType: "narrative", createdAt: timestamp, updatedAt: timestamp });
    await onRefresh();
    const allCharacters = await db.characters.where("projectId").equals(project.id).toArray();
    const deltaPrompt = effectiveDeltaSystemPrompt(project.deltaSystemPrompt);
    const currentEntities = (await db.deltaEntities.where("sessionId").equals(session.id).toArray()).sort((a, b) => a.orderIndex - b.orderIndex);
    const [inventoryRows, activeChat] = project.inventoryEnabled
      ? await Promise.all([
        db.inventoryItems.where("chatId").equals(chat.id).toArray(),
        db.chats.get(chat.id)
      ])
      : [[], undefined] as const;
    const inventoryDetails = project.inventoryEnabled
      ? [
        `Inventory:\n${[
          project.currencyName ? `- ${project.currencyName}: ${activeChat?.currencyAmount ?? 0}` : "",
          ...inventoryRows.filter((item) => item.kind === "inventory" && item.name.trim()).map((item) => {
            const totalKg = (item.unitWeightKg ?? 0) * item.quantity;
            return `- ${item.name}: ${item.quantity}${item.unitWeightKg ? `, ${formatInventoryKg(item.unitWeightKg)}kg each, ${formatInventoryKg(totalKg)}kg total` : ""}`;
          })
        ].filter(Boolean).join("\n") || "(empty)"}`,
        settings.autoManageInventory ? "Inventory auto-management is enabled in Delta: use update_inventory_item when the player or NPC action gains, spends, fires, drops, consumes, steals, reloads, or loses inventory/currency. Subtract only the actual amount used, not the whole stack. Inventory log sentences must include where the item came from or went." : "Inventory is read-only in Delta because auto-management is disabled.",
        "If the user's text contains [i], treat the nearby action as an explicit inventory-management signal."
      ].filter(Boolean).join("\n\n")
      : "";
    const linkedCharacters = await linkedCharacterContext();
    const mapSize = session.mapSize ?? "M";
    const mapDefinition = session.mapTiles?.map((tile) => `${tile.row},${tile.column}: ${tile.kind}${tile.label ? ` (${tile.label})` : ""}${tile.kind === "special" && tile.color ? ` color=${tile.color}` : ""}${tile.kind === "access" ? ` ${tile.accessState ?? "closed"}` : ""}`).join("; ") || "(not staged)";
    const context = [
      deltaPrompt,
      `Project: ${project.name}`,
      project.worldSetting ? `World setting:\n${project.worldSetting}` : "",
      `Saved project character names:\n${allCharacters.map((character) => `- ${character.name} (${character.id})`).join("\n") || "(none)"}`,
      linkedCharacters ? `Linked involved character data:\n${linkedCharacters}` : "",
      `Current entity list:\n${currentEntities.map((entity) => `- ${entity.id}: ${entity.name}, ${entity.side}, state=${entity.engagementState ?? (entity.currentHp === 0 ? "ko" : "active")}, HP=${entity.currentHp ?? entity.maxHp ?? "?"}/${entity.maxHp ?? "?"}${entity.characterId ? `, characterId=${entity.characterId}` : ""}${entity.templateTag ? `, ${entity.templateTag}` : ""}${entity.statusText ? `, ${entity.statusText}` : ""}${entityPositionLabel(entity) ? `, ${entityPositionLabel(entity)}` : ""}`).join("\n") || "(none)"}`,
      options.turnActorId ? `Current turn actor: ${currentEntities.find((entity) => entity.id === options.turnActorId)?.name ?? options.turnActorId}` : "",
      inventoryDetails,
      `Map boundary: ${mapSize}, ${deltaMapPreviewSizes[mapSize].metres}m, ${deltaMapPreviewSizes[mapSize].cells} x ${deltaMapPreviewSizes[mapSize].cells} tiles. Current non-open terrain: ${mapDefinition}`,
      `Chat-scoped ally cache:\n${allyCache.map((entry) => `- ${entry.name}${entry.templateTag ? `, ${entry.templateTag}` : ""}`).join("\n") || "(none)"}`,
      `Available PREFIX labels: ${effectiveDeltaPrefixes(project.deltaPrefixes).map((item) => item.label).join(", ") || "(none)"}`,
      `Available BASE labels: ${effectiveDeltaBases(project.deltaBases).map((item) => item.label).join(", ") || "(none)"}`,
      `Available JOB categories: ${jobCategories(project.deltaJobs ?? []).map(([category, count]) => `${category} (${count})`).join(", ") || "(none)"}`,
      "Runtime enforcement: use the client for every new roll and never write dice results in prose. Apply HP damage only through apply_delta_damage after a verified damage roll. Keep reactions inside the triggering actor's turn, and use contested rolls for active opposition. Persist entity state rather than merely describing it. The Delta system prompt defines the prose, cut-in, dialogue, continuity, entity, and opening-engagement behavior; do not restate or override it here.",
      options.allowDialogueReply
        ? "Dialogue scope for this request: respond only to direct speech in the latest player entry currently being processed. Once posted, that dialogue is answered and must not be answered again on later turns."
        : "Dialogue scope for this request: do not answer, paraphrase, continue, or add another cinematic response to player dialogue from any earlier message. That dialogue has already been handled. Resolve only the current roll, action, or current entity turn.",
      options.stageEngagement
        ? "Current phase: opening a new engagement. Before any transcript response, call set_delta_engagement_name and set_delta_map. The map must use only valid one-based coordinates inside the fixed grid; include only non-open tiles. Special terrain needs a concrete label and hex color. Then create or reconcile the entities from the handoff, assign every participating entity a unique valid mapRow/mapColumn on an open or passable tile, and mark the selected player entity before calling for initiative. Do not treat continuity labels such as Situation, Location, Objective, Map, or Terrain as entities."
        : ""
    ].filter(Boolean).join("\n\n");
    const requestMessages: OpenRouterMessage[] = [
      { role: "system", content: context },
      ...messages.map((message) => ({ role: message.role as OpenRouterMessage["role"], content: message.body })),
      { role: "user", content: [options.instruction, clean].filter(Boolean).join("\n\n") }
    ];
    const toolLog: string[] = [];
    let pendingReplyOpen = true;
    let requestSucceeded = true;
    const persistBeforeTools = async (content: string, includesRoll: boolean) => {
      if (content) {
        if (pendingReplyOpen) {
          await db.deltaMessages.update(replyId, { body: content, status: "complete", updatedAt: now() });
          pendingReplyOpen = false;
        } else {
          await addDeltaMessage(session.id, "assistant", content, { turnNumber, eventType: "narrative", modelId: model });
        }
      } else if (includesRoll && pendingReplyOpen) {
        await db.deltaMessages.delete(replyId);
        pendingReplyOpen = false;
      }
    };
    setDeltaRequestBusy(true);
    try {
      const reply = await completeDeltaTurn(requestMessages, toolLog, options.stageEngagement, turnNumber, persistBeforeTools);
      if (reply.trim()) {
        if (pendingReplyOpen) await db.deltaMessages.update(replyId, { body: reply, status: "complete", updatedAt: now() });
        else await addDeltaMessage(session.id, "assistant", reply, { turnNumber, eventType: "narrative", modelId: model });
      } else if (pendingReplyOpen) await db.deltaMessages.delete(replyId);
    } catch (error) {
      requestSucceeded = false;
      const body = error instanceof Error ? error.message : "OpenRouter request failed.";
      if (pendingReplyOpen) await db.deltaMessages.update(replyId, { body, status: "failed", updatedAt: now() });
      else await addDeltaMessage(session.id, "assistant", body, { turnNumber, eventType: "narrative", modelId: model });
    } finally {
      setDeltaRequestBusy(false);
    }
    await onRefresh();
    return requestSucceeded;
  }
  async function send() {
    const clean = body.trim();
    if (!clean || !session.active) return;
    if (deltaBusyRef.current) return;
    if (session.awaitingPlayerRoll || (session.initiativeStarted && !session.awaitingPlayerAction)) return;
    if (clean.toLowerCase() === "((testing end engagement))") {
      setBody("");
      await startFinishFlow();
      return;
    }
    const ordered = (await db.deltaEntities.where("sessionId").equals(session.id).toArray())
      .filter(canTakeDeltaTurn)
      .sort((a, b) => a.orderIndex - b.orderIndex);
    const isReaction = session.reactionState === "available";
    const turnActorId = isReaction
      ? session.reactionSourceActorId ?? ordered[session.turnIndex ?? 0]?.id
      : ordered[session.turnIndex ?? 0]?.id;
    const wasAwaitingPlayerAction = Boolean(session.awaitingPlayerAction);
    if (wasAwaitingPlayerAction) await db.deltaSessions.update(session.id, {
      awaitingPlayerAction: false,
      actionPrompt: undefined,
      continuedTurnNumber: undefined,
      ...(isReaction ? { reactionState: "resolving" as const } : {}),
      updatedAt: now()
    });
    const sent = await submitDeltaTurn(clean, wasAwaitingPlayerAction ? {
      turnActorId,
      allowDialogueReply: !isReaction,
      ...(isReaction && session.reactionTurnNumber !== undefined
        ? { turnNumber: session.reactionTurnNumber }
        : session.continuedTurnNumber !== undefined
          ? { turnNumber: session.continuedTurnNumber }
          : {}),
      instruction: isReaction
        ? `This is the player's successful out-of-turn reaction to: ${session.reactionTrigger ?? "the immediate threat"}. Resolve this reaction inside the interrupted actor's current turn, not as a new turn. If its success is uncertain, call request_delta_roll with the governing ability and stop for the player's roll. Otherwise resolve the reaction and then finish the interrupted actor's remaining action. Do not grant another reaction check, request_delta_action, or advance another entity; the client owns turn advancement.`
        : "The player just submitted part of their current turn. Direct in-character speech addressed to another involved entity must receive one brief cinematic reply or immediate nonverbal response. If the entry also contains an action, put that cut-in first, begin it with 🎞️, and keep it concise. If the entry contains only speech, signalling, or communication and no movement, attack, item use, physical interaction, roll-worthy influence attempt, or other turn-consuming action, do not write a separate response: call continue_delta_player_turn with the addressed entity's concise response in cinematicReply so the client posts it and keeps the same numbered turn open. Never invent an action that the player did not declare. Otherwise, if the action has uncertain success, risk, opposition, contested movement, attack, defense, stealth, persuasion, hacking, resistance, damage, or hazard interaction, do not resolve success/failure yet. Call request_delta_roll with the required die/count/label and governing STR/DEX/CON/INT/WIS/CHA ability, then stop; use NONE only if no stat applies. The client applies the selected entity's real modifier. If it is an opposed control action such as disarm, grapple, shove, restrain, escape, hold position, stealth versus detection, deception versus insight, or hacking versus active defense, treat it as a contested check: request the player's roll now, then after the client provides that roll, call request_delta_roll with rollerName and governing ability for the opposing entity if an opposing roll is needed. Compare authoritative modified totals only after all required client-generated rolls are returned. If no roll is needed, resolve exactly one compact outcome, persist entity changes, and stop without calling request_delta_action again for this same turn."
    } : {});
    if (sent) {
      setBody("");
      const latest = await db.deltaSessions.get(session.id);
      if (isReaction && latest && !latest.awaitingPlayerAction && !latest.awaitingPlayerRoll) {
        await db.deltaSessions.update(session.id, {
          reactionState: undefined,
          reactionSourceActorId: undefined,
          reactionTargetEntityId: undefined,
          reactionTrigger: undefined,
          reactionTurnNumber: undefined,
          updatedAt: now()
        });
      }
      if (session.initiativeStarted && session.awaitingPlayerAction && !latest?.awaitingPlayerAction && !latest?.awaitingPlayerRoll) await advanceTurn(turnActorId);
    }
  }
  function secureRollSample(sides: number) {
    if (!globalThis.crypto?.getRandomValues) throw new Error("Secure browser randomness is unavailable. Delta will not generate an unverifiable fallback roll.");
    const values = new Uint32Array(1);
    const range = 0x100000000;
    const limit = range - (range % sides);
    do {
      globalThis.crypto.getRandomValues(values);
    } while (values[0] >= limit);
    return { rawValue: values[0], result: (values[0] % sides) + 1 };
  }
  function rollDie(sides: number) {
    return secureRollSample(sides).result;
  }
  function createRollReceipt({
    toolName,
    rollerName,
    label,
    ability,
    modifier,
    die,
    results,
    rawValues,
    total
  }: {
    toolName: DeltaRollReceipt["toolName"];
    rollerName: string;
    label: string;
    ability?: DeltaRollAbility;
    modifier?: number;
    die: number;
    results: number[];
    rawValues: number[];
    total?: number;
  }): DeltaRollReceipt {
    return {
      id: uid(),
      source: "client-web-crypto",
      generator: "crypto.getRandomValues",
      algorithm: "uint32-rejection-sampling-v1",
      toolName,
      rollerName,
      label,
      ability,
      modifier,
      die,
      count: results.length,
      rawValues,
      results,
      total,
      generatedAt: now()
    };
  }
  async function rollDeltaDie(sides: number) {
    if (deltaBusyRef.current) return;
    if (session.awaitingPlayerRoll && session.requiredRollDie && sides !== session.requiredRollDie) return;
    const sample = secureRollSample(sides);
    const result = sample.result;
    if (session.awaitingPlayerRoll) {
      const results = [...(session.requiredRollResults ?? []), result];
      const rawValues = [...(session.requiredRollRawValues ?? []), sample.rawValue];
      const requiredCount = Math.max(1, session.requiredRollCount ?? 1);
      if (results.length < requiredCount) {
        await db.deltaSessions.update(session.id, { requiredRollResults: results, requiredRollRawValues: rawValues, updatedAt: now() });
        await onRefresh();
        return;
      }
      if ((session.requiredRollKind ?? "initiative") === "initiative") await resolveInitiative(results[0] ?? result);
      else {
        const latestSession = await db.deltaSessions.get(session.id);
        const ordered = (await db.deltaEntities.where("sessionId").equals(session.id).toArray())
          .filter(canTakeDeltaTurn)
          .sort((a, b) => a.orderIndex - b.orderIndex);
        const currentActor = ordered[latestSession?.turnIndex ?? session.turnIndex ?? 0];
        const playerEntity = latestSession?.settings.playerEntityId ? ordered.find((entity) => entity.id === latestSession.settings.playerEntityId) : undefined;
        const rollerName = latestSession?.requiredRollerName ?? currentActor?.name ?? playerEntity?.name ?? "Player";
        const label = latestSession?.requiredRollLabel || `${requiredCount}d${sides} roll`;
        const ability = latestSession?.requiredRollAbility;
        const modifier = latestSession?.requiredRollModifier ?? deltaRollModifier(playerEntity ?? currentActor, ability);
        const rollResult = deltaRollResultText(sides, results, modifier);
        const resultText = rollResult.text;
        const receipt = createRollReceipt({
          toolName: "player_delta_roll",
          rollerName,
          label,
          ability,
          modifier,
          die: sides,
          results,
          rawValues,
          total: rollResult.total
        });
        await addDeltaMessage(session.id, "system", `${rollerName}: Roll ${label}${ability ? ` (${ability})` : ""}: ${resultText}`, {
          turnNumber: session.requiredRollTurnNumber,
          eventType: "roll",
          rollReceipt: receipt
        });
        if (latestSession?.requiredRollKind === "reaction") {
          const reactionSucceeded = rollResult.total >= 6;
          if (reactionSucceeded) {
            await db.deltaSessions.update(session.id, {
              reactionState: "available",
              awaitingPlayerRoll: false,
              awaitingPlayerAction: true,
              actionPrompt: `Reaction available: ${latestSession.reactionTrigger ?? "respond to the immediate threat"}`,
              requiredRollDie: undefined,
              requiredRollCount: undefined,
              requiredRollResults: undefined,
              requiredRollKind: undefined,
              requiredRollLabel: undefined,
              requiredRollerName: undefined,
              requiredRollAbility: undefined,
              requiredRollModifier: undefined,
              requiredRollTurnNumber: undefined,
              requiredRollRawValues: undefined,
              updatedAt: now()
            });
            await onRefresh();
            return;
          }
          const sourceActorId = latestSession.reactionSourceActorId ?? currentActor?.id;
          const reactionTurnNumber = latestSession.reactionTurnNumber ?? latestSession.requiredRollTurnNumber;
          await db.deltaSessions.update(session.id, {
            reactionState: "resolving",
            awaitingPlayerRoll: false,
            awaitingPlayerAction: false,
            actionPrompt: undefined,
            requiredRollDie: undefined,
            requiredRollCount: undefined,
            requiredRollResults: undefined,
            requiredRollKind: undefined,
            requiredRollLabel: undefined,
            requiredRollerName: undefined,
            requiredRollAbility: undefined,
            requiredRollModifier: undefined,
            requiredRollTurnNumber: undefined,
            requiredRollRawValues: undefined,
            updatedAt: now()
          });
          await submitDeltaTurn(`Reaction check receipt ${receipt.id}: ${resultText}. Authoritative total: ${rollResult.total}; reaction threshold: 6.`, {
            hideUser: true,
            turnActorId: sourceActorId,
            turnNumber: reactionTurnNumber,
            instruction: `The client-generated reaction check failed. ${latestSession.reactionTrigger ? `Immediate threat: ${latestSession.reactionTrigger}. ` : ""}The player receives no reaction. Resume and finish exactly the interrupted attacker's current turn using the already established attack and roll context. Do not start another entity's turn, request another reaction for this target this round, or invent a replacement roll.`
          });
          const afterReaction = await db.deltaSessions.get(session.id);
          if (afterReaction?.initiativeStarted && !afterReaction.awaitingPlayerAction && !afterReaction.awaitingPlayerRoll) {
            await db.deltaSessions.update(session.id, {
              reactionState: undefined,
              reactionSourceActorId: undefined,
              reactionTargetEntityId: undefined,
              reactionTrigger: undefined,
              reactionTurnNumber: undefined,
              updatedAt: now()
            });
            await advanceTurn(sourceActorId);
          }
          return;
        }
        await db.deltaSessions.update(session.id, {
          awaitingPlayerRoll: false,
          requiredRollDie: undefined,
          requiredRollCount: undefined,
          requiredRollResults: undefined,
          requiredRollKind: undefined,
          requiredRollLabel: undefined,
          requiredRollerName: undefined,
          requiredRollAbility: undefined,
          requiredRollModifier: undefined,
          requiredRollTurnNumber: undefined,
          requiredRollRawValues: undefined,
          updatedAt: now()
        });
        await submitDeltaTurn(`Dice roll receipt ${receipt.id}: ${resultText}. Authoritative total: ${rollResult.total}.`, {
          hideUser: true,
          turnActorId: currentActor?.id,
          turnNumber: session.requiredRollTurnNumber,
          instruction: /damage/i.test(label)
            ? `This is the actual client-generated damage roll. The result and receipt ID are authoritative and already visibly logged. Before writing aftermath, call apply_delta_damage with the correct target entityId, final damage amount ${rollResult.total}, and receipt ID ${receipt.id}; never calculate or overwrite currentHp. Do not repeat the roll line.`
            : /(?:attack|strike|shot)/i.test(label)
              ? `This is the actual client-generated attack roll. The result and receipt ID are authoritative and already visibly logged. Determine hit or miss. If it hits, call request_delta_roll for the correct damage die/count with a label containing 'damage', then stop before writing hit aftermath. If it misses, resolve the miss without damage. Do not repeat the attack roll line or change HP from an attack roll.`
              : `This is the actual client-generated ${session.requiredRollLabel || `${requiredCount}d${sides} roll`}. The result and receipt ID are authoritative and already visibly logged. If this was a contested check and an opposing entity still needs a roll, call request_delta_roll with rollerName for that entity now; do not invent the opposing number. Compare totals only after all required client-generated rolls are returned. Resolve exactly one compact Delta outcome from this roll bundle. Include the aftermath and persist non-HP status/entity changes. If another player roll is required to finish this same action, call request_delta_roll with the next required die/count and stop. Otherwise stop without calling request_delta_action again for this same turn; the client will advance to the next entity.`
        });
        const latest = await db.deltaSessions.get(session.id);
        if (latest?.initiativeStarted && !latest.awaitingPlayerAction && !latest.awaitingPlayerRoll) {
          if (latest.reactionState === "resolving") {
            await db.deltaSessions.update(session.id, {
              reactionState: undefined,
              reactionSourceActorId: undefined,
              reactionTargetEntityId: undefined,
              reactionTrigger: undefined,
              reactionTurnNumber: undefined,
              updatedAt: now()
            });
          }
          await advanceTurn(latest.reactionSourceActorId ?? currentActor?.id);
        }
      }
      return;
    }
    await submitDeltaTurn(`Dice roll: d${sides} = ${result}`, {
      instruction: "This is an actual client-generated dice roll. The result is authoritative. Do not reroll, reinterpret the number, or replace it with an AI-chosen value. Respond with the concise Delta outcome."
    });
  }
  async function resolveInitiative(playerRoll: number) {
    const playerId = session.settings.playerEntityId ?? entities[0]?.id;
    if (!playerId) return;
    const ranked = entities
      .map((entity, index) => {
        const dexModifier = Math.floor(((entity.dex ?? 10) - 10) / 2);
        const rawRoll = entity.id === playerId ? playerRoll : rollDie(20);
        return {
          entity,
          rawRoll,
          dexModifier,
          initiative: rawRoll + dexModifier,
          index
        };
      })
      .sort((a, b) => b.initiative - a.initiative || a.index - b.index);
    const first = ranked[0];
    await db.transaction("rw", db.deltaEntities, db.deltaSessions, async () => {
      await Promise.all(ranked.map(({ entity, initiative }, orderIndex) => db.deltaEntities.update(entity.id, { initiative, orderIndex, updatedAt: now() })));
      await db.deltaSessions.update(session.id, {
        initiativeStarted: true,
        awaitingPlayerRoll: false,
        requiredRollDie: undefined,
        requiredRollCount: undefined,
        requiredRollResults: undefined,
        requiredRollKind: undefined,
        requiredRollLabel: undefined,
        requiredRollerName: undefined,
        requiredRollAbility: undefined,
        requiredRollModifier: undefined,
        requiredRollTurnNumber: undefined,
        requiredRollRawValues: undefined,
        actionPrompt: undefined,
        reactionUsedEntityIds: [],
        reactionState: undefined,
        reactionSourceActorId: undefined,
        reactionTargetEntityId: undefined,
        reactionTrigger: undefined,
        reactionTurnNumber: undefined,
        continuedTurnNumber: undefined,
        awaitingPlayerAction: first?.entity.id === playerId,
        turnIndex: 0,
        updatedAt: now()
      });
    });
    await addDeltaMessage(session.id, "system", `Initiative order (+DEX):\n${ranked.map(({ entity, rawRoll, dexModifier, initiative }, index) => `${index + 1}. ${entity.name}: ${rawRoll}${dexModifier === 0 ? "" : dexModifier > 0 ? ` + ${dexModifier}` : ` - ${Math.abs(dexModifier)}`} = ${initiative}`).join("\n")}`);
    await onRefresh();
  }
  function canTakeDeltaTurn(entity: DeltaEntity) {
    const state = entity.engagementState ?? "active";
    return state === "active" && (entity.currentHp === undefined || entity.currentHp > 0);
  }
  async function markFinishReadyIfOppositionResolved() {
    const current = await db.deltaSessions.get(session.id);
    if (!current?.active || !current.initiativeStarted) return false;
    if (current.finishReady) return true;
    const roster = await db.deltaEntities.where("sessionId").equals(session.id).toArray();
    const hostiles = roster.filter((entity) => entity.side === "hostile");
    if (!hostiles.length || hostiles.some(canTakeDeltaTurn)) return false;
    await db.deltaSessions.update(session.id, {
      finishReady: true,
      awaitingPlayerAction: false,
      awaitingPlayerRoll: false,
      actionPrompt: undefined,
      requiredRollDie: undefined,
      requiredRollCount: undefined,
      requiredRollResults: undefined,
      requiredRollKind: undefined,
      requiredRollLabel: undefined,
      requiredRollerName: undefined,
      requiredRollAbility: undefined,
      requiredRollModifier: undefined,
      requiredRollTurnNumber: undefined,
      requiredRollRawValues: undefined,
      reactionState: undefined,
      reactionSourceActorId: undefined,
      reactionTargetEntityId: undefined,
      reactionTrigger: undefined,
      reactionTurnNumber: undefined,
      continuedTurnNumber: undefined,
      updatedAt: now()
    });
    return true;
  }
  async function advanceTurn(expectedActorId?: string) {
    const current = await db.deltaSessions.get(session.id);
    if (await markFinishReadyIfOppositionResolved()) {
      await onRefresh();
      return;
    }
    const ordered = (await db.deltaEntities.where("sessionId").equals(session.id).toArray())
      .filter(canTakeDeltaTurn)
      .sort((a, b) => a.orderIndex - b.orderIndex);
    if (!current || !ordered.length || !current.initiativeStarted) return;
    if (current.awaitingPlayerRoll || current.awaitingPlayerAction) return;
    const expectedIndex = expectedActorId ? ordered.findIndex((entity) => entity.id === expectedActorId) : -1;
    const currentIndex = expectedIndex >= 0
      ? expectedIndex
      : Math.max(0, Math.min(current.turnIndex ?? 0, ordered.length - 1));
    const nextIndex = (currentIndex + 1) % ordered.length;
    const playerId = current.settings.playerEntityId ?? ordered[0]?.id;
    const next = ordered[nextIndex];
    await db.deltaSessions.update(session.id, {
      turnIndex: nextIndex,
      awaitingPlayerAction: next?.id === playerId,
      awaitingPlayerRoll: false,
      ...(nextIndex === 0 ? { reactionUsedEntityIds: [] } : {}),
      reactionState: undefined,
      reactionSourceActorId: undefined,
      reactionTargetEntityId: undefined,
      reactionTrigger: undefined,
      reactionTurnNumber: undefined,
      continuedTurnNumber: undefined,
      updatedAt: now()
    });
    await onRefresh();
  }
  async function nextTurn() {
    if (deltaBusyRef.current) return;
    if (!session.initiativeStarted || session.awaitingPlayerAction || session.awaitingPlayerRoll) return;
    const current = await db.deltaSessions.get(session.id);
    if (!current || !current.initiativeStarted || current.awaitingPlayerAction || current.awaitingPlayerRoll) return;
    if (await markFinishReadyIfOppositionResolved()) {
      await onRefresh();
      return;
    }
    const ordered = (await db.deltaEntities.where("sessionId").equals(session.id).toArray())
      .filter(canTakeDeltaTurn)
      .sort((a, b) => a.orderIndex - b.orderIndex);
    const actor = ordered[current.turnIndex ?? 0];
    if (!actor) return;
    const sent = await submitDeltaTurn(`${actor.name}'s turn.`, {
      hideUser: true,
      turnActorId: actor.id,
      instruction: `Play exactly one turn for ${actor.name}. If this turn involves attack, defense, hazard, detection, resistance, damage, contested movement, or another uncertain NPC/ally/non-player action, call request_delta_roll with rollerName, the needed die, and the governing STR/DEX/CON/INT/WIS/CHA ability instead of inventing the number; use NONE only if no stat applies. Do not announce tool use with lines such as 'Requesting roll', 'Calling for damage roll', or 'Rolling attack for X'. The client applies the entity's real stat modifier and displays every returned roll in its own verified row; resolve from the returned total without repeating the dice line in prose. When this turn directly threatens another active entity and a physically meaningful reaction could affect the outcome, wait until the initiating attack/check roll is known, then call request_delta_reaction before resolving damage or the final consequence. The client owns the 1d8 + DEX reaction check and one-reaction-per-round limit. A reaction remains inside ${actor.name}'s current turn. If verified damage occurs, call apply_delta_damage with the target entityId, final damage amount, returned receipt ID, and a zeroHpOutcome of ko or dead; never overwrite currentHp. If an entity escapes, set engagementState to escaped immediately. KO, DEAD, and ESCAPED entities cannot act. If another entity actively resists a disarm, grapple, shove, restrain, escape, stealth, deception, hacking, or similar opposed action, use contested logic and request the needed rolls through the client. Default to no separate cinematic cut-in; use one only for a major emotional, relationship, reveal, near-death, reversal, or scene-pivot beat after several ordinary turns without one. Write the action and consequence directly, without prefixes like 'Turn resolved:'. Use multiple short lines if needed. Add one or two small sensory or character-flavor details when they sharpen the moment, but do not expand into main-chat story prose. Persist status, relationship, distance, elevation, or engagement-state changes with update_delta_entity. Do not resolve any later turns and do not tell the player to let you know what happens next.`
    });
    if (sent) await advanceTurn(actor.id);
  }
  async function cacheCurrentGeneratedAllies() {
    await Promise.all(entities.map((entity) => upsertDeltaAllyCache(chat.id, entity)));
  }
  function finishContext(
    lootRoll: number,
    currencyRoll: { dice: number[]; amount: number },
    finishMessages: DeltaMessage[],
    finishEntities: DeltaEntity[]
  ) {
    const currencyName = project.currencyName?.trim() || "money";
    const extraLootInstruction = lootRoll === 6
      ? "Loot recovery roll: 1d6 = 6. Include one rare/special world-appropriate recoverable item, or three ordinary world-appropriate items plus one standout item if that fits better."
      : `Loot recovery roll: 1d6 = ${lootRoll}. Include exactly ${lootRoll} world-appropriate recoverable loot item${lootRoll === 1 ? "" : "s"}. Use the project's world setting as the main source of flavor. Quantities should fit the item, not default to 1 when another quantity makes more sense.`;
    return [
      "Finish the current Delta engagement and return only valid JSON with this exact object shape:",
      "{\"finalEngagementBeat\":\"\",\"outcomeSummary\":\"\",\"lootItems\":[{\"id\":\"\",\"name\":\"\",\"quantity\":1,\"pickedQuantity\":0}],\"parentChatHandoff\":\"\"}",
      "finalEngagementBeat: short in-world closing beat for the Delta transcript.",
      "outcomeSummary: comprehensive factual account of the engagement outcome. Identify every involved participant and their final condition. Record every meaningful wound, who caused it, how it happened, deaths, knockouts, escapes, captures, relationship changes, unresolved threats, discoveries, objective changes, and important scene/location consequences. Do not omit an injury merely because that character survived.",
      "lootItems: assess recoverable loot from the engagement before returning JSON. Include concrete gained/recoverable items with quantities when anything was plausibly taken, dropped, captured, found, protected, disarmed, looted, or recovered from the scene, objective, containers, defeated/captured entities, or abandoned carried gear. Use pickedQuantity 0 initially. Use an empty array only when there is truly nothing recoverable.",
      extraLootInstruction,
      "The loot recovery roll is client-generated and authoritative. Do not reroll it or change the count.",
      `Currency recovery roll: 3d4 digits = ${currencyRoll.dice.join(", ")} for ${currencyRoll.amount} ${currencyName}. Currency is handled by the client as its own inventory category. Do not include currency in lootItems. Do not add money, credits, coins, cash, or any currency equivalent as a loot item.`,
      "parentChatHandoff: write a detailed but condensed third-person narrative reconstruction that can stand alone as the next main-chat reply. It must read as though the engagement played out inside the story, not as a report to the user. Preserve chronological cause and effect: how the confrontation began, the meaningful actions and turning points, what each important participant did, every consequential injury and exactly how it was sustained, who was killed/knocked out/escaped/captured, how the engagement resolved, and the immediate state of the people and location afterward. Retain exact names, wounds, discoveries, objectives, and unresolved consequences. Condense repetition and routine failed actions, but do not sacrifice continuity-critical detail. Use several compact paragraphs when needed. Do not include the full turn log, dice values unless narratively essential, tool calls, debug text, UI wording, headings, or technical explanation.",
      `Project: ${project.name}`,
      project.instructions ? `Project instructions:\n${project.instructions}` : "",
      project.worldSetting ? `World setting:\n${project.worldSetting}` : "",
      `Final entity state:\n${finishEntities.map((entity) => `- ${entity.name}, ${entity.side}, state=${entity.engagementState ?? (entity.currentHp === 0 ? "ko" : "active")}, HP=${entity.currentHp ?? entity.maxHp ?? "?"}/${entity.maxHp ?? "?"}${entity.templateTag ? `, ${entity.templateTag}` : ""}${entity.statusText ? `, ${entity.statusText}` : ""}${entityPositionLabel(entity) ? `, ${entityPositionLabel(entity)}` : ""}`).join("\n") || "(none)"}`,
      `Complete active Delta transcript:\n${finishMessages.map((message) => `${message.turnNumber ? `Turn ${message.turnNumber} ` : ""}[${message.role}${message.eventType ? `/${message.eventType}` : ""}]: ${message.body}`).join("\n\n") || "(none)"}`
    ].filter(Boolean).join("\n\n");
  }
  async function startFinishFlow() {
    if (!session.active) return;
    setFinishError("");
    setFinishPacket(undefined);
    setFinishLootRoll(undefined);
    setFinishCurrencyRoll(undefined);
    setFinishCurrencyPicked(0);
    setFinishAwaitingLootRoll(true);
  }
  async function rollFinishLoot() {
    if (finishLoading) return;
    const lootRoll = rollDie(6);
    const currencyDice = [rollDie(4), rollDie(4), rollDie(4)];
    const currencyRoll = { dice: currencyDice, amount: Number(currencyDice.join("")) };
    setFinishLootRoll(lootRoll);
    setFinishCurrencyRoll(currencyRoll);
    setFinishCurrencyPicked(0);
    setFinishAwaitingLootRoll(false);
    await requestFinishPacket(lootRoll, currencyRoll);
  }
  async function requestFinishPacket(lootRoll: number, currencyRoll: { dice: number[]; amount: number }) {
    if (!settings.apiKey) {
      setFinishError("Add your OpenRouter API key before finishing Delta.");
      return;
    }
    const model = session.settings.modelId || chat.modelId || selectedModelId || settings.defaultModelId;
    if (!model) {
      setFinishError("Choose a model before finishing Delta.");
      return;
    }
    setFinishError("");
    setFinishLoading(true);
    try {
      await cacheCurrentGeneratedAllies();
      const [finishMessages, finishEntities] = await Promise.all([
        db.deltaMessages.where("sessionId").equals(session.id).toArray(),
        db.deltaEntities.where("sessionId").equals(session.id).toArray()
      ]);
      const completeTranscript = finishMessages
        .filter((message) => message.status === "complete" && message.body.trim() && message.body.trim() !== "...")
        .sort((a, b) => a.sequence - b.sequence);
      const finalEntities = finishEntities.sort((a, b) => a.orderIndex - b.orderIndex);
      const response = await deltaOpenRouterRequest({
        model,
        messages: [
          { role: "system", content: "You write continuity-complete, roleplay-facing Delta finish packets as valid JSON only. Preserve consequential detail while condensing repetition." },
          { role: "user", content: finishContext(lootRoll, currencyRoll, completeTranscript, finalEntities) }
        ],
        temperature: session.settings.temperature ?? 0,
        top_p: session.settings.topP ?? 0,
        ...(session.settings.maxTokens ? { max_tokens: session.settings.maxTokens } : {})
      });
      const json = await response.json() as OpenRouterResponse;
      const packet = parseDeltaFinishPacket(json.choices?.[0]?.message?.content ?? "");
      if (!packet.finalEngagementBeat || !packet.parentChatHandoff) throw new Error("Finish packet was missing required text.");
      await addDeltaMessage(session.id, "assistant", packet.finalEngagementBeat);
      setFinishPacket(packet);
      await onRefresh();
    } catch (error) {
      setFinishError(error instanceof Error ? error.message : "Finish packet failed.");
    } finally {
      setFinishLoading(false);
    }
  }
  function updateLootItem(id: string, patch: Partial<DeltaLootItem>) {
    if (!finishPacket) return;
    setFinishPacket({
      ...finishPacket,
      lootItems: finishPacket.lootItems.map((item) => {
        if (item.id !== id) return item;
        const quantity = Math.max(0, Math.floor(patch.quantity ?? item.quantity));
        const pickedQuantity = Math.max(0, Math.min(quantity, Math.floor(patch.pickedQuantity ?? item.pickedQuantity)));
        return { ...item, ...patch, quantity, pickedQuantity };
      })
    });
  }
  function pickUpAllLoot() {
    if (!finishPacket) return;
    setFinishPacket({ ...finishPacket, lootItems: finishPacket.lootItems.map((item) => ({ ...item, pickedQuantity: item.quantity })) });
  }
  function dropAllLoot() {
    if (!finishPacket) return;
    setFinishPacket({ ...finishPacket, lootItems: finishPacket.lootItems.map((item) => ({ ...item, pickedQuantity: 0 })) });
  }
  function hasUnclaimedLoot(packet = finishPacket) {
    const unclaimedItems = Boolean(packet?.lootItems.some((item) => item.pickedQuantity < item.quantity));
    const unclaimedCurrency = Boolean(finishCurrencyRoll && finishCurrencyPicked < finishCurrencyRoll.amount);
    return unclaimedItems || unclaimedCurrency;
  }
  async function continueFromFinish(force = false) {
    if (!finishPacket) return;
    if (!force && hasUnclaimedLoot()) {
      setForfeitConfirmOpen(true);
      return;
    }
    const timestamp = now();
    const picked = finishPacket.lootItems.filter((item) => item.pickedQuantity > 0);
    const pickedInventory = picked;
    const pickedCurrencyAmount = finishCurrencyRoll ? Math.max(0, Math.min(finishCurrencyRoll.amount, Math.floor(finishCurrencyPicked))) : 0;
    const currencyName = project.currencyName?.trim() || "money";
    const leftBehind = finishPacket.lootItems
      .map((item) => ({ name: item.name, quantity: Math.max(0, item.quantity - item.pickedQuantity) }))
      .filter((item) => item.quantity > 0);
    if (finishCurrencyRoll && pickedCurrencyAmount < finishCurrencyRoll.amount) {
      leftBehind.push({ name: currencyName, quantity: finishCurrencyRoll.amount - pickedCurrencyAmount });
    }
    const took = [
      ...picked.map((item) => ({ name: item.name, quantity: item.pickedQuantity })),
      ...(pickedCurrencyAmount > 0 ? [{ name: currencyName, quantity: pickedCurrencyAmount }] : [])
    ];
    const selectedCharacterName = playerEntityId
      ? (namesByEntityId.get(playerEntityId) ?? entities.find((entity) => entity.id === playerEntityId)?.name ?? "Someone")
      : "Someone";
    const conclusionMessage = [
      "\u0394 Concluded.",
      finishPacket.parentChatHandoff,
      "",
      `${selectedCharacterName} took: ${formatLootList(took)}`,
      leftBehind.length ? `Left behind: ${formatLootList(leftBehind)}` : ""
    ].join("\n");
    if ((picked.length || pickedCurrencyAmount > 0) && !project.inventoryEnabled) await db.projects.update(project.id, { inventoryEnabled: true, updatedAt: timestamp });
    if (!project.currencyName?.trim()) await db.projects.update(project.id, { currencyName: "money", updatedAt: timestamp });
    for (const item of pickedInventory) {
      await applyInventoryChange(project.id, chat.id, "inventory", item.name, item.pickedQuantity, `Recovered ${item.name} x ${item.pickedQuantity} from \u0394 ${session.title}.`);
    }
    if (pickedCurrencyAmount > 0) {
      const activeChat = await db.chats.get(chat.id);
      const amount = Math.max(0, (activeChat?.currencyAmount ?? 0) + pickedCurrencyAmount);
      await db.transaction("rw", db.chats, db.inventoryLogs, async () => {
        await db.chats.update(chat.id, { currencyAmount: amount, updatedAt: timestamp });
        await db.inventoryLogs.add({ id: uid(), projectId: project.id, chatId: chat.id, sentence: `Recovered ${currencyName} x ${pickedCurrencyAmount} from \u0394 ${session.title}.`, createdAt: timestamp, updatedAt: timestamp });
      });
    }
    await addMessage(chat.id, chat.activeBranchId, "assistant", conclusionMessage);
    await archiveDeltaSession(session.id, session.title);
    await pruneArchivedDeltaSessions();
    setFinishPacket(undefined);
    setFinishLootRoll(undefined);
    setFinishCurrencyRoll(undefined);
    setFinishCurrencyPicked(0);
    setFinishAwaitingLootRoll(false);
    setForfeitConfirmOpen(false);
    await onRefresh();
    onClose();
    if (window.history.state?.mirrorDeltaMode) window.history.back();
  }
  async function pruneArchivedDeltaSessions() {
    const limit = settingsDraft.maxHistoryMessages;
    if (limit === undefined) return;
    const archived = await db.deltaSessions.where("chatId").equals(chat.id).and((item) => !item.active).toArray();
    const removals = archived.sort((a, b) => b.updatedAt - a.updatedAt).slice(limit);
    if (removals.length === 0) return;
    const ids = removals.map((item) => item.id);
    await db.transaction("rw", [db.deltaSessions, db.deltaMessages, db.deltaEntities], async () => {
      await db.deltaMessages.where("sessionId").anyOf(ids).delete();
      await db.deltaEntities.where("sessionId").anyOf(ids).delete();
      await db.deltaSessions.where("id").anyOf(ids).delete();
    });
  }
  async function openArchived(sessionRecord: DeltaSession) {
    const [archivedMessages, archivedEntities] = await Promise.all([
      db.deltaMessages.where("sessionId").equals(sessionRecord.id).toArray(),
      db.deltaEntities.where("sessionId").equals(sessionRecord.id).toArray()
    ]);
    setPreviewSession(sessionRecord);
    setPreviewMessages(archivedMessages.sort((a, b) => a.sequence - b.sequence));
    setPreviewEntities(archivedEntities.sort((a, b) => a.orderIndex - b.orderIndex));
  }
  async function renameArchived(sessionRecord: DeltaSession) {
    const title = prompt("Rename archived engagement", sessionRecord.title)?.trim();
    if (!title) return;
    await db.deltaSessions.update(sessionRecord.id, { title, updatedAt: now() });
    setPreviewSession({ ...sessionRecord, title, updatedAt: now() });
    await onRefresh();
  }
  async function saveSettings() {
    const timestamp = now();
    await db.deltaSessions.update(session.id, { settings: settingsDraft, updatedAt: timestamp });
    await pruneArchivedDeltaSessions();
    showSaved();
    await onRefresh();
  }
  const settingsDirty = JSON.stringify(settingsDraft) !== JSON.stringify(session.settings);
  function requestSettingsNavigation(action: () => void) {
    if (settingsDirty) {
      pendingSettingsNavigationRef.current = action;
      setSettingsLeaveOpen(true);
      return;
    }
    action();
  }
  async function saveSettingsAndContinue() {
    await saveSettings();
    setSettingsLeaveOpen(false);
    pendingSettingsNavigationRef.current();
  }
  function discardSettingsAndContinue() {
    setSettingsDraft(session.settings);
    setSettingsLeaveOpen(false);
    pendingSettingsNavigationRef.current();
  }
  async function renameActiveEngagement() {
    const title = prompt("Name this Delta engagement", session.title)?.trim();
    if (!title || title === session.title) return;
    await db.deltaSessions.update(session.id, { title, updatedAt: now() });
    await onRefresh();
  }
  function insertMacro(template: string) {
    const textarea = composerRef.current;
    const start = textarea?.selectionStart ?? body.length;
    const end = textarea?.selectionEnd ?? body.length;
    const next = `${body.slice(0, start)}${template}${body.slice(end)}`;
    setBody(next);
    window.setTimeout(() => {
      composerRef.current?.focus();
      const cursor = start + template.length;
      composerRef.current?.setSelectionRange(cursor, cursor);
    }, 0);
  }
  function chooseMacro(macro: CharacterActionMacro) {
    if (macro.template === undefined) return;
    if (macro.requestEntitySelection) {
      setPendingEntityMacro(macro);
      setSelectedEntityIds(new Set());
      setActiveTool("entities");
      return;
    }
    insertMacro(macro.template);
  }
  function insertPendingEntityMacro() {
    if (!pendingEntityMacro?.template) return;
    const namesById = entityDisplayNames(entities);
    const names = entities
      .filter((entity) => selectedEntityIds.has(entity.id))
      .map((entity) => namesById.get(entity.id) ?? entity.name);
    const targetText = formatEntityNameList(names);
    const template = pendingEntityMacro.template.includes("{target}")
      ? pendingEntityMacro.template.split("{target}").join(targetText)
      : `${pendingEntityMacro.template}${pendingEntityMacro.template.endsWith(" ") ? "" : " "}${targetText}`;
    insertMacro(template);
    setPendingEntityMacro(undefined);
    setSelectedEntityIds(new Set());
    setActiveTool("actions");
  }
  function toggleSelectedEntity(id: string) {
    setSelectedEntityIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  async function updateEntityRelationship(entity: DeltaEntity, side: DeltaRelationship) {
    await db.deltaEntities.update(entity.id, { side, updatedAt: now() });
    if (side === "ally") await upsertDeltaAllyCache(chat.id, { ...entity, side });
    await onRefresh();
  }
  async function characterStatsPatch(character: Character) {
    const stats = await characterTemplateStats(project, character);
    return {
      characterId: character.id,
      name: character.name,
      str: stats.STR,
      dex: stats.DEX,
      con: stats.CON,
      int: stats.INT,
      wis: stats.WIS,
      cha: stats.CHA,
      maxHp: stats.maxHp,
      currentHp: stats.maxHp,
      templateTag: undefined,
      prefix: undefined,
      base: undefined,
      job: undefined,
      generatedStatsSource: undefined
    };
  }
  async function linkedCharacterContext() {
    const sessionEntities = await db.deltaEntities.where("sessionId").equals(session.id).toArray();
    const linkedIds = Array.from(new Set(sessionEntities.map((entity) => entity.characterId).filter(Boolean) as string[]));
    if (!linkedIds.length) return "";
    const rows = (await db.characters.bulkGet(linkedIds)).filter((character): character is Character => Boolean(character && character.projectId === project.id));
    const sections = await Promise.all(rows.map(async (character) => {
      const stats = await characterStatsPatch(character);
      return [
        `${character.name} (${character.id})`,
        `Identity: age=${character.age || ""}; gender=${character.gender || ""}; personality=${character.personality || ""}; misc=${character.misc || ""}`,
        `Stats: STR ${stats.str}, DEX ${stats.dex}, CON ${stats.con}, INT ${stats.int}, WIS ${stats.wis}, CHA ${stats.cha}`
      ].join("\n");
    }));
    return sections.join("\n\n");
  }
  async function addCharacterEntity(characterId: string) {
    const character = await db.characters.get(characterId);
    if (!character || character.projectId !== project.id) return;
    const timestamp = now();
    const stats = await characterStatsPatch(character);
    await db.deltaEntities.add({
      id: uid(),
      sessionId: session.id,
      ...stats,
      side: "neutral",
      statusText: "Awaiting engagement status.",
      distanceFromPlayer: "",
      elevation: "",
      orderIndex: entities.length,
      createdAt: timestamp,
      updatedAt: timestamp
    });
    await onRefresh();
  }
  async function refreshEntityCharacterStats(entity: DeltaEntity) {
    if (!entity.characterId) return;
    const character = await db.characters.get(entity.characterId);
    if (!character || character.projectId !== project.id) return;
    const patch = await characterStatsPatch(character);
    const previousMax = entity.maxHp ?? patch.maxHp;
    const hpDelta = patch.maxHp - previousMax;
    await db.deltaEntities.update(entity.id, { ...patch, currentHp: Math.max(0, (entity.currentHp ?? patch.maxHp) + hpDelta), updatedAt: now() });
    await onRefresh();
  }
  async function linkCharacterToEntity(entity: DeltaEntity, characterId: string) {
    const character = await db.characters.get(characterId);
    if (!character || character.projectId !== project.id) return;
    await db.deltaEntities.update(entity.id, { ...(await characterStatsPatch(character)), updatedAt: now() });
    if (entity.id === playerEntityId) await db.chats.update(chat.id, { deltaPlayerCharacterId: character.id, updatedAt: now() });
    await onRefresh();
  }
  async function setPlayerCharacterData(characterId: string) {
    const player = entities.find((entity) => entity.id === playerEntityId);
    const patch = characterId ? await db.characters.get(characterId) : undefined;
    if (characterId && (!patch || patch.projectId !== project.id)) return;
    await db.chats.update(chat.id, { deltaPlayerCharacterId: characterId || undefined, updatedAt: now() });
    setPlayerCharacterId(characterId);
    if (player && patch) await db.deltaEntities.update(player.id, { ...(await characterStatsPatch(patch)), updatedAt: now() });
    await onRefresh();
  }
  function parseTemplateTag(value: string) {
    const clean = value.trim().toUpperCase().replace(/\s+/g, " ");
    const [first, job] = clean.split(" ");
    const [prefix, base] = first?.includes("-") ? first.split("-") : [undefined, first];
    return { prefix, base, job, templateTag: formatDeltaTemplateTag(prefix, base, job) };
  }
  async function saveCacheTag(entry: DeltaAllyCacheEntry) {
    const parsed = parseTemplateTag(cacheDraftTag);
    const patch = generatedStatsPatch(project, parsed);
    await db.deltaAllyCache.update(entry.id, {
      ...patch,
      templateTag: parsed.templateTag,
      prefix: parsed.prefix,
      base: parsed.base,
      job: parsed.job,
      updatedAt: now()
    });
    setCacheEditId(undefined);
    setCacheDraftTag("");
    await onRefresh();
  }
  function exportAllyCache() {
    downloadJson(`mirror-delta-ally-cache-${chat.title || chat.id}.json`, {
      schemaVersion: 1,
      exportedAt: new Date().toISOString(),
      chatTitle: chat.title,
      allyCache
    });
  }
  async function importAllyCache(file: File | undefined) {
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text()) as { allyCache?: DeltaAllyCacheEntry[] };
      if (!Array.isArray(parsed.allyCache)) {
        setCacheImportStatus("Invalid ally cache file.");
        return;
      }
      const timestamp = now();
      const rows = parsed.allyCache
        .filter((entry) => entry.name?.trim())
        .map((entry) => ({ ...entry, id: uid(), chatId: chat.id, createdAt: timestamp, updatedAt: timestamp }));
      if (rows.length) await db.deltaAllyCache.bulkAdd(rows);
      setCacheImportStatus(`Imported ${rows.length} ally cache entr${rows.length === 1 ? "y" : "ies"}.`);
      await onRefresh();
    } catch {
      setCacheImportStatus("Import failed.");
    }
  }
  async function clearAllyCache() {
    await db.deltaAllyCache.where("chatId").equals(chat.id).delete();
    setClearCacheOpen(false);
    await onRefresh();
  }
  async function removeEntity(entity: DeltaEntity) {
    if (entity.id === playerEntityId) return;
    if (!confirm(`Remove ${entity.name} from this Delta engagement?`)) return;
    await db.deltaEntities.delete(entity.id);
    if (expandedEntityId === entity.id) setExpandedEntityId(undefined);
    await onRefresh();
  }
  function actionSlotName(slot: CharacterActionSlot, index = actionSlots.findIndex((item) => item.id === slot.id)) {
    return slot.name?.trim() || String(index + 1);
  }
  async function addActionSlot() {
    if (!actionCharacterId) return;
    const timestamp = now();
    const slot: CharacterActionSlot = { id: uid(), characterId: actionCharacterId, orderIndex: actionSlots.length, createdAt: timestamp, updatedAt: timestamp };
    await db.characterActionSlots.add(slot);
    await loadActionLibrary(actionCharacterId, slot.id);
  }
  async function renameActionSlot(slotId: string, name: string) {
    await db.characterActionSlots.update(slotId, { name: name.trim() || undefined, updatedAt: now() });
    await loadActionLibrary(actionCharacterId, slotId);
  }
  async function changeActionCharacter(characterId: string) {
    setActionCharacterId(characterId);
    await loadActionLibrary(characterId, "");
  }
  async function changeActionSlot(slotId: string) {
    await loadActionLibrary(actionCharacterId, slotId);
  }
  function addMacro(parentId: string | undefined, folder: boolean) {
    if (!selectedActionSlotId) return;
    setMacroDraft({ parentId, folder, label: "", template: "", requestEntitySelection: false });
  }
  function editMacro(macro: CharacterActionMacro) {
    setMacroDraft({
      macro,
      parentId: macro.parentId,
      folder: macro.template === undefined,
      label: macro.label,
      template: macro.template ?? "",
      requestEntitySelection: macro.requestEntitySelection ?? false
    });
  }
  async function saveMacroDraft() {
    if (!macroDraft) return;
    if (!selectedActionSlotId) return;
    const label = macroDraft.label.trim();
    if (!label) return;
    const timestamp = now();
    if (macroDraft.macro) {
      await db.characterActionMacros.update(macroDraft.macro.id, {
        label,
        template: macroDraft.folder ? undefined : macroDraft.template,
        requestEntitySelection: macroDraft.folder ? false : macroDraft.requestEntitySelection,
        updatedAt: timestamp
      });
    } else {
      const siblings = actionMacros.filter((macro) => macro.parentId === macroDraft.parentId);
      await db.characterActionMacros.add({
        id: uid(),
        slotId: selectedActionSlotId,
        parentId: macroDraft.parentId,
        label,
        template: macroDraft.folder ? undefined : macroDraft.template,
        requestEntitySelection: macroDraft.folder ? false : macroDraft.requestEntitySelection,
        orderIndex: (Math.max(-1, ...siblings.map((macro) => macro.orderIndex)) + 1),
        createdAt: timestamp,
        updatedAt: timestamp
      });
    }
    setMacroDraft(undefined);
    await loadActionLibrary(actionCharacterId, selectedActionSlotId);
  }
  async function deleteMacro(macro: CharacterActionMacro) {
    if (!confirm(`Delete "${macro.label}" and anything inside it?`)) return;
    const ids = new Set<string>([macro.id]);
    let grew = true;
    while (grew) {
      grew = false;
      for (const item of actionMacros) {
        if (item.parentId && ids.has(item.parentId) && !ids.has(item.id)) {
          ids.add(item.id);
          grew = true;
        }
      }
    }
    await db.characterActionMacros.bulkDelete(Array.from(ids));
    await loadActionLibrary(actionCharacterId, selectedActionSlotId);
  }
  const playerEntityId = settingsDraft.playerEntityId ?? entities[0]?.id;
  const namesByEntityId = entityDisplayNames(entities);
  const orderedEntities = [...entities].sort((a, b) => a.orderIndex - b.orderIndex);
  const activeOrderedEntities = orderedEntities.filter(canTakeDeltaTurn);
  const turnIndex = Math.max(0, Math.min(session.turnIndex ?? 0, Math.max(0, activeOrderedEntities.length - 1)));
  const turnQueue = session.initiativeStarted ? [...activeOrderedEntities.slice(turnIndex), ...activeOrderedEntities.slice(0, turnIndex)] : [];
  const currentTurn = turnQueue[0];
  const requiredRollCount = Math.max(1, session.requiredRollCount ?? 1);
  const completedRollCount = session.requiredRollResults?.length ?? 0;
  const remainingRollCount = Math.max(1, requiredRollCount - completedRollCount);
  const requiredRollAbility = session.requiredRollKind === "initiative" ? "DEX" : session.requiredRollAbility;
  const requiredRollAbilityText = requiredRollAbility ? ` + ${requiredRollAbility}` : "";
  const requiredRollText = `${remainingRollCount} ${remainingRollCount === 1 ? "roll" : "rolls"} (d${session.requiredRollDie ?? 20}${requiredRollAbilityText}) left`;
  const revealTextEnabled = project.deltaRevealText !== false;
  const revealSpeed = Math.max(1, Math.min(10, Math.round(project.deltaRevealSpeed ?? 5)));
  const revealStepMs = deltaRevealStepMs(revealSpeed);
  const currentTurnLabel = session.awaitingPlayerRoll
    ? `Roll ${requiredRollCount}d${session.requiredRollDie ?? 20}${requiredRollAbilityText} for ${session.requiredRollLabel || "initiative"}`
    : currentTurn
      ? (namesByEntityId.get(currentTurn.id) ?? currentTurn.name)
      : "Engagement";
  const currentTurnNumber = session.continuedTurnNumber ?? deltaLogTurnCount(messages) + 1;
  const inputDisabled = Boolean(deltaBusy || session.awaitingPlayerRoll || (session.initiativeStarted && !session.awaitingPlayerAction));
  const isArchivedSession = !session.active;
  const relationshipForEntity = (entity?: DeltaEntity) => normaliseDeltaRelationship(entity?.side ?? "neutral");
  const entityByDisplayName = new Map(orderedEntities.flatMap((entity) => {
    const displayName = namesByEntityId.get(entity.id) ?? entity.name;
    return [[displayName.trim().toLowerCase(), entity], [entity.name.trim().toLowerCase(), entity]] as const;
  }));
  const relationshipForInitiativeLine = (line: string) => {
    const name = line.replace(/^\s*\d+\.\s*/, "").split(":")[0]?.trim().toLowerCase();
    return relationshipForEntity(name ? entityByDisplayName.get(name) : undefined);
  };
  let displayedTurnNumber = 0;
  let lastDisplayedTurnNumber: number | undefined;
  let legacyRollPendingResolution = false;
  let revealCursorMs = 0;
  const numberForMessage = (message: DeltaMessage) => {
    if (message.turnNumber !== undefined) {
      displayedTurnNumber = Math.max(displayedTurnNumber, message.turnNumber);
      const showNumber = lastDisplayedTurnNumber !== message.turnNumber;
      lastDisplayedTurnNumber = message.turnNumber;
      return showNumber ? String(message.turnNumber).padStart(2, "0") : "";
    }
    if (message.role === "assistant" && legacyRollPendingResolution && displayedTurnNumber > 0) {
      legacyRollPendingResolution = false;
      return "";
    }
    legacyRollPendingResolution = false;
    displayedTurnNumber += 1;
    lastDisplayedTurnNumber = displayedTurnNumber;
    return String(displayedTurnNumber).padStart(2, "0");
  };
  let previewTurnNumber = 0;
  let lastPreviewTurnNumber: number | undefined;
  let previewLegacyRollPendingResolution = false;
  const numberForPreviewMessage = (message: DeltaMessage) => {
    if (message.turnNumber !== undefined) {
      previewTurnNumber = Math.max(previewTurnNumber, message.turnNumber);
      const showNumber = lastPreviewTurnNumber !== message.turnNumber;
      lastPreviewTurnNumber = message.turnNumber;
      return showNumber ? String(message.turnNumber).padStart(2, "0") : "";
    }
    if (message.role === "assistant" && previewLegacyRollPendingResolution && previewTurnNumber > 0) {
      previewLegacyRollPendingResolution = false;
      return "";
    }
    previewLegacyRollPendingResolution = false;
    previewTurnNumber += 1;
    lastPreviewTurnNumber = previewTurnNumber;
    return String(previewTurnNumber).padStart(2, "0");
  };
  const previewEntityByName = new Map(previewEntities.map((entity) => [entity.name.trim().toLowerCase(), entity]));
  return (
    <div className="delta-layer">
      <div className="delta-dim" aria-hidden="true" />
      <aside className="delta-workspace">
        <div className="delta-top">
          <div className="delta-title-block">
            <h2><Swords size={18} /> Delta Mode</h2>
            {!isArchivedSession && <strong className="delta-engagement-name" title={session.title}>{session.title || "Untitled Engagement"}</strong>}
            <small title={`${project.name} / ${chat.title}`}>{project.name} / {chat.title}</small>
          </div>
          {!isArchivedSession && <button className="icon-button" onClick={renameActiveEngagement} aria-label="Rename Delta engagement" title={session.title || "Name engagement"}><Edit3 size={16} /></button>}
        </div>
        <nav className="delta-toolbar" aria-label="Delta tools">
          {!isArchivedSession && <>
            <button className={activeTool === "entities" ? "picked" : ""} onClick={() => requestSettingsNavigation(() => setActiveTool(activeTool === "entities" ? undefined : "entities"))} aria-label="Entity list"><UserRound size={18} /></button>
            <button className={activeTool === "map" ? "picked" : ""} onClick={() => requestSettingsNavigation(() => setActiveTool(activeTool === "map" ? undefined : "map"))} aria-label="Map"><MapIcon size={18} /></button>
            <button onClick={() => requestSettingsNavigation(onOpenInventory)} aria-label="Inventory"><ShoppingBag size={18} /></button>
          </>}
          <button className={`delta-archive-button ${activeTool === "history" ? "picked" : ""}`} onClick={() => requestSettingsNavigation(() => setActiveTool(activeTool === "history" ? undefined : "history"))} aria-label="Archive"><Archive size={16} /><span>Archive</span></button>
          {!isArchivedSession && <button className="delta-settings-button" onClick={() => requestSettingsNavigation(onOpenProjectDeltaSettings)} aria-label="Project Delta settings" title="Project Delta settings"><Settings size={17} /></button>}
        </nav>
        {!isArchivedSession && <div className={`delta-turn-queue-wrap ${turnQueueEdges.left ? "show-left" : ""} ${turnQueueEdges.right ? "show-right" : ""}`}>
          <div className="delta-turn-queue" aria-label="Turn order" ref={turnQueueRef} onScroll={updateTurnQueueEdges}>
            {turnQueue.map((entity, index) => (
              <span className={`${relationshipForEntity(entity)} ${index === 0 ? "active" : ""}`} key={entity.id}>
                {entity.orderIndex + 1}. {namesByEntityId.get(entity.id) ?? entity.name}
              </span>
            ))}
          </div>
        </div>}
        {activeTool && activeTool !== "actions" && (
          <section className={`delta-tool-panel ${activeTool === "map" ? "delta-map-tool-panel" : ""}`}>
            {activeTool === "entities" && (
              <>
                <div className="section-title">
                  <h2>{pendingEntityMacro ? "Select Targets" : "Entity List"}</h2>
                  <div className="split-actions">
                    {pendingEntityMacro && <span className="save-status">Macro target</span>}
                    <button className="icon-button" onClick={() => setEntitySettingsOpen(!entitySettingsOpen)} aria-label="Entity settings"><Settings size={16} /></button>
                  </div>
                </div>
                {entitySettingsOpen && (
                  <section className="entity-settings-panel stack">
                    <div className="tabs compact-tabs">
                      <button className={entitySettingsTab === "entities" ? "active" : ""} onClick={() => setEntitySettingsTab("entities")}>Entities</button>
                      <button className={entitySettingsTab === "ally-cache" ? "active" : ""} onClick={() => setEntitySettingsTab("ally-cache")}>Ally Cache</button>
                    </div>
                    {entitySettingsTab === "entities" && (
                      <>
                        <label>Highlighted player<select value={playerEntityId ?? ""} onChange={(event) => setSettingsDraft({ ...settingsDraft, playerEntityId: event.target.value })}>{entities.map((entity) => <option value={entity.id} key={entity.id}>{namesByEntityId.get(entity.id) ?? entity.name}</option>)}</select></label>
                        <label>Player character data
                          <select value={playerCharacterId} onChange={(event) => void setPlayerCharacterData(event.target.value)}>
                            <option value="">Not linked</option>
                            {projectCharacters.map((character) => <option key={character.id} value={character.id}>{character.name}</option>)}
                          </select>
                        </label>
                        <div className="split-actions"><button onClick={saveSettings}><Save size={18} /> Save entity settings</button>{saved && <span className="save-status">Saved</span>}</div>
                        <label>Add involved character
                          <select defaultValue="" onChange={(event) => { if (event.target.value) void addCharacterEntity(event.target.value); event.currentTarget.value = ""; }}>
                            <option value="">Choose from character data...</option>
                            {projectCharacters.map((character) => <option key={character.id} value={character.id}>{character.name}</option>)}
                          </select>
                        </label>
                        <p className="notice">Linked characters import their current stats from the project character database. Engagement-only entities can use readable PREFIX-BASE JOB tags.</p>
                      </>
                    )}
                    {entitySettingsTab === "ally-cache" && (
                      <div className="stack">
                        <div className="split-actions">
                          <button onClick={exportAllyCache}><Download size={16} /> Export</button>
                          <label className="file-pick"><Upload size={16} /> Import<input type="file" accept="application/json" onChange={(event) => void importAllyCache(event.target.files?.[0])} /></label>
                          <button className="danger" onClick={() => setClearCacheOpen(true)}>Clear all</button>
                        </div>
                        {cacheImportStatus && <p className="save-status">{cacheImportStatus}</p>}
                        {allyCache.length === 0 && <p className="notice">No generated allies cached for this chat yet.</p>}
                        <div className="ally-cache-list">
                          {allyCache.map((entry) => (
                            <section className="ally-cache-row" key={entry.id}>
                              <div>
                                <strong>{entry.name}</strong>
                                {cacheEditId === entry.id ? (
                                  <input value={cacheDraftTag} onChange={(event) => setCacheDraftTag(event.target.value)} placeholder="DEX-LIGHT ROGUE" />
                                ) : (
                                  <small>{entry.templateTag || "No template tag"}</small>
                                )}
                              </div>
                              <button className={cacheEditId === entry.id ? "picked" : ""} onClick={() => { setCacheEditId(entry.id); setCacheDraftTag(entry.templateTag ?? ""); }} aria-label={`Edit ${entry.name} cache tag`}><Pencil size={15} /></button>
                              {cacheEditId === entry.id && <button onClick={() => saveCacheTag(entry)}><Save size={15} /> Save</button>}
                            </section>
                          ))}
                        </div>
                      </div>
                    )}
                  </section>
                )}
                <div className="delta-entity-list">
                  {orderedEntities.map((entity) => {
                    const hp = entity.currentHp ?? 0;
                    const maxHp = entity.maxHp || 1;
                    const displayName = namesByEntityId.get(entity.id) ?? entity.name;
                    const relationship = normaliseDeltaRelationship(entity.side);
                    return (
                      <div key={entity.id} className="delta-entity-wrap">
                        <div
                          className={`delta-entity ${relationship} ${entity.id === playerEntityId ? "player" : ""} ${selectedEntityIds.has(entity.id) ? "selected" : ""} ${canTakeDeltaTurn(entity) ? "" : "inactive"}`}
                          onClick={() => pendingEntityMacro ? toggleSelectedEntity(entity.id) : setExpandedEntityId(expandedEntityId === entity.id ? undefined : entity.id)}
                        >
                          <small className="delta-initiative">{entity.initiative ?? "-"}</small>
                          <span>{displayName}{entity.templateTag && <small className="delta-template-tag">{entity.templateTag}</small>}</span>
                          <HpSquares current={hp} max={maxHp} relationship={relationship} />
                          <small>{hp}/{maxHp} HP</small>
                          <small className="delta-relationship-label">{deltaRelationshipLabel(relationship)}</small>
                        {entityPositionLabel(entity) && <small className="delta-position">{entityPositionLabel(entity)}</small>}
                        <small className="delta-status">{entity.engagementState && entity.engagementState !== "active" ? entity.engagementState.toUpperCase() : entity.statusText || "No status"}</small>
                      </div>
                      {expandedEntityId === entity.id && (
                        <div className="delta-entity-detail">
                          <p>{entity.statusText || "No current Delta status."}</p>
                          <div className="delta-stat-grid">
                            {deltaEntityStats(entity).map(([label, value]) => (
                              <span key={label}><b>{label}</b><strong>{value ?? "-"}</strong><small>{statModifier(value)}</small></span>
                            ))}
                          </div>
                          {entitySettingsOpen && entitySettingsTab === "entities" && (
                            <div className="split-actions">
                              <label>Relationship
                                <select value={relationship} onChange={(event) => void updateEntityRelationship(entity, event.target.value as DeltaRelationship)}>
                                  {deltaRelationships.map((value) => <option key={value} value={value}>{deltaRelationshipLabel(value)}</option>)}
                                </select>
                              </label>
                              <label>Character data
                                <select value={entity.characterId ?? ""} onChange={(event) => { if (event.target.value) void linkCharacterToEntity(entity, event.target.value); }}>
                                  <option value="">Not linked</option>
                                  {projectCharacters.map((character) => <option key={character.id} value={character.id}>{character.name}</option>)}
                                </select>
                              </label>
                              {entity.characterId && <button onClick={() => refreshEntityCharacterStats(entity)}>Refresh character stats</button>}
                              {entity.id !== playerEntityId && <button className="danger" onClick={() => removeEntity(entity)}>Remove</button>}
                            </div>
                          )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
                {pendingEntityMacro && (
                  <div className="split-actions">
                    <button onClick={insertPendingEntityMacro} disabled={selectedEntityIds.size === 0}>Insert selected</button>
                    <button onClick={() => { setPendingEntityMacro(undefined); setSelectedEntityIds(new Set()); }}>Cancel</button>
                  </div>
                )}
              </>
            )}
            {activeTool === "map" && <DeltaMapPrototype entities={orderedEntities} tiles={session.mapTiles ?? []} size={session.mapSize ?? "M"} />}
            {activeTool === "history" && (
              <div className="stack">
                <div className="section-title"><h2>Archive</h2><div className="split-actions"><span>{archivedSessions.length}</span><button className={`icon-button ${archiveSettingsOpen ? "picked" : ""}`} onClick={() => setArchiveSettingsOpen(!archiveSettingsOpen)} aria-label="Archive settings" title="Archive settings"><Settings size={16} /></button></div></div>
                {archiveSettingsOpen && <div className="stack archive-settings">
                  <label className="range-row">
                    <span>Archived engagements <b>{settingsDraft.maxHistoryMessages === undefined ? "infinite" : settingsDraft.maxHistoryMessages}</b></span>
                    <input
                      type="range"
                      min={0}
                      max={archiveLimitOptions.length - 1}
                      value={settingsDraft.maxHistoryMessages === undefined ? archiveLimitOptions.length - 1 : Math.max(0, archiveLimitOptions.findIndex((value) => value === settingsDraft.maxHistoryMessages))}
                      onChange={(event) => {
                        const value = archiveLimitOptions[Number(event.target.value)];
                        setSettingsDraft({ ...settingsDraft, maxHistoryMessages: value === Infinity ? undefined : value });
                      }}
                    />
                  </label>
                  <div className="split-actions"><button onClick={saveSettings}><Save size={18} /> Save</button>{saved && <span className="save-status">Saved</span>}</div>
                </div>}
                {finishError && <p className="import-errors">{finishError}</p>}
                <div className="delta-history-list">
                  {archivedSessions.length === 0 && <p className="notice">No archived Delta engagements for this chat yet.</p>}
                  {archivedSessions.map((item) => (
                    <button key={item.id} onClick={() => openArchived(item)}>
                      <span>{item.title}</span>
                      <small>{formatDate(item.archivedAt ?? item.updatedAt)}</small>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </section>
        )}
        <div className="delta-body" ref={deltaBodyRef}>
          {isArchivedSession ? (
            <section className="delta-archived-state">
              <Archive size={22} />
              <strong>No active engagement</strong>
              <span>Open Archive to review past engagements.</span>
            </section>
          ) : <div className="delta-messages">
            {messages.map((message) => {
              if (message.role === "system") {
                if (message.rollReceipt) {
                  const rollerEntity = entityByDisplayName.get(message.rollReceipt.rollerName.trim().toLowerCase());
                  const animateRoll = revealTextEnabled && revealMessageIds.has(message.id);
                  const revealDelayMs = animateRoll ? revealCursorMs : 0;
                  if (animateRoll) revealCursorMs += revealStepMs;
                  return (
                    <DeltaVerifiedRollRow
                      key={message.id}
                      message={message}
                      relationship={relationshipForEntity(rollerEntity)}
                      expanded={expandedRollId === message.id}
                      onToggle={() => setExpandedRollId(expandedRollId === message.id ? undefined : message.id)}
                      animate={animateRoll}
                      revealDelayMs={revealDelayMs}
                      onReveal={scrollDeltaToLatest}
                    />
                  );
                }
                const initiativeLines = message.body.startsWith("Initiative order")
                  ? message.body.split("\n").slice(1).filter((line) => line.trim())
                  : [];
                const isRollNotice = isDeltaRollNotice(message.body);
                if (isRollNotice) legacyRollPendingResolution = displayedTurnNumber > 0;
                return (
                  <article className={`delta-log-brief ${isRollNotice ? "delta-roll-notice" : ""}`} key={message.id}>
                    {initiativeLines.length > 0 ? (
                      <div className="delta-initiative-list">
                        <strong>Initiative order</strong>
                        {initiativeLines.map((line) => (
                          <span className={relationshipForInitiativeLine(line)} key={line}>{line}</span>
                        ))}
                      </div>
                    ) : (
                      <div className="message-body"><MarkdownText text={message.body} inventoryMarkers /></div>
                    )}
                  </article>
                );
              }
              const visibleBody = cleanDeltaToolCallText(message.body);
              if (!visibleBody) return null;
              const cinematicSplit = splitDeltaCinematic(visibleBody);
              const bodyText = cinematicSplit.turn;
              const cinematicOnly = Boolean(cinematicSplit.cinematic && !bodyText);
              const isLoading = message.status === "pending" && bodyText.trim() === "...";
              const animateMessage = revealTextEnabled && revealMessageIds.has(message.id) && !isLoading;
              const cinematicDelayMs = animateMessage ? revealCursorMs : 0;
              if (animateMessage && cinematicSplit.cinematic) revealCursorMs += deltaRevealLines(cinematicSplit.cinematic).length * revealStepMs;
              if (cinematicOnly) {
                return (
                  <article className="delta-cinematic-beat" key={message.id}>
                    <span className="delta-log-number delta-cinematic-icon">{cinematicMarker()}</span>
                    <div className="message-body"><DeltaTurnText text={cinematicSplit.cinematic} animate={animateMessage} startDelayMs={cinematicDelayMs} stepMs={revealStepMs} onReveal={scrollDeltaToLatest} /></div>
                  </article>
                );
              }
              const bodyDelayMs = animateMessage ? revealCursorMs : 0;
              if (animateMessage) revealCursorMs += deltaRevealLines(bodyText).length * revealStepMs;
              const numberLabel = numberForMessage(message);
              const effectiveTurnNumber = message.turnNumber ?? displayedTurnNumber;
              const rowEntity = session.initiativeStarted && activeOrderedEntities.length > 0
                ? activeOrderedEntities[Math.max(0, effectiveTurnNumber - 1) % activeOrderedEntities.length]
                : undefined;
              return (
                <Fragment key={message.id}>
                  {cinematicSplit.cinematic && (
                    <article className="delta-cinematic-beat">
                      <span className="delta-log-number delta-cinematic-icon">{cinematicMarker()}</span>
                      <div className="message-body"><DeltaTurnText text={cinematicSplit.cinematic} animate={animateMessage} startDelayMs={cinematicDelayMs} stepMs={revealStepMs} onReveal={scrollDeltaToLatest} /></div>
                    </article>
                  )}
                  <article className={`delta-log-row ${message.role === "user" ? "user" : "assistant"} ${relationshipForEntity(rowEntity)}`}>
                    <span className="delta-log-number">{numberLabel}</span>
                    <div className="message-body">{isLoading ? <LoadingSignal /> : <DeltaTurnText text={bodyText} animate={animateMessage} startDelayMs={bodyDelayMs} stepMs={revealStepMs} onReveal={scrollDeltaToLatest} />}</div>
                  </article>
                </Fragment>
              );
            })}
          </div>}
        </div>
        {!isArchivedSession && <div className="delta-turn-status">
          <span className="delta-ap-box"><b>AP</b><strong>4/4</strong></span>
          <div className="delta-current-turn">Turn {currentTurnNumber}: {currentTurnLabel}</div>
          {session.awaitingPlayerAction && !session.awaitingPlayerRoll && (
            <div className={`delta-turn-callout ${session.reactionState === "available" ? "reaction" : ""}`}>
              {session.reactionState === "available" ? session.actionPrompt || "Reaction available." : "It is your turn."}
            </div>
          )}
        </div>}
        {!isArchivedSession && session.awaitingPlayerRoll && <div className="delta-floating-prompt roll">{requiredRollText}</div>}
        {!isArchivedSession && session.awaitingPlayerRoll && deltaDiceImages[session.requiredRollDie ?? 20] && (
          <button className="delta-roll-image" type="button" onClick={() => rollDeltaDie(session.requiredRollDie ?? 20)} disabled={deltaBusy} aria-label={`Roll d${session.requiredRollDie ?? 20}`}>
            <img src={deltaDiceImages[session.requiredRollDie ?? 20]} alt={`d${session.requiredRollDie ?? 20}`} />
          </button>
        )}
        {!isArchivedSession && session.finishReady && (
          <section className="delta-finish-ready-bar">
            <button className="delta-end-engagement" onClick={startFinishFlow} disabled={finishLoading || finishAwaitingLootRoll}>{finishLoading ? "Finishing..." : "End Engagement"}</button>
          </section>
        )}
        {!isArchivedSession && !session.finishReady && <section className="composer delta-composer">
          <button className="delta-composer-tool" type="button" onClick={() => undefined} disabled={deltaBusy || session.awaitingPlayerRoll} aria-label="Movement" title="Movement"><Share2 size={18} /><span>MOVE</span></button>
          <button className="delta-composer-tool" type="button" onClick={() => { if (deltaBusy || session.awaitingPlayerRoll) return; setActiveTool(activeTool === "actions" ? undefined : "actions"); }} disabled={deltaBusy || session.awaitingPlayerRoll} aria-label="Actions" title="Actions"><Zap size={18} /><span>ACTIONS</span></button>
          <textarea ref={composerRef} value={body} onChange={(event) => setBody(event.target.value)} onFocus={() => keepComposerVisible(composerRef.current)} onClick={() => keepComposerVisible(composerRef.current)} disabled={inputDisabled} placeholder={session.awaitingPlayerRoll ? "Waiting on your roll..." : session.reactionState === "available" ? "Write your reaction" : session.awaitingPlayerAction ? "Write your move" : currentTurn ? `Next: ${currentTurn.name}` : "Write Delta message"} rows={2} />
          <button className="send-button" onClick={send} disabled={inputDisabled}>Send</button>
          <button className="delta-next-button" type="button" onClick={nextTurn} disabled={deltaBusy || !session.initiativeStarted || session.awaitingPlayerAction || session.awaitingPlayerRoll}>Next</button>
        </section>}
        {!isArchivedSession && activeTool === "actions" && !deltaBusy && !session.awaitingPlayerRoll && (
          <section className="delta-actions-panel">
            <div className="section-title">
              <h2>Actions</h2>
              <div className="split-actions">
                <label className="action-slot-header-select">Save slot
                  <select value={selectedActionSlotId} onChange={(event) => void changeActionSlot(event.target.value)} disabled={!actionCharacterId || actionSlots.length === 0}>
                    {actionSlots.map((slot, index) => <option key={slot.id} value={slot.id}>{actionSlotName(slot, index)}</option>)}
                  </select>
                </label>
                <button className={actionsEditMode ? "picked" : ""} onClick={() => setActionsEditMode(!actionsEditMode)} aria-label="Toggle action editing"><Pencil size={16} /></button>
                {actionsEditMode && actionCharacterId && <button onClick={addActionSlot}>+ Slot</button>}
                {actionsEditMode && selectedActionSlotId && <button onClick={() => addMacro(undefined, true)}>+ Menu</button>}
                {actionsEditMode && selectedActionSlotId && <button onClick={() => addMacro(undefined, false)}>+ Action</button>}
              </div>
            </div>
            <div className="action-library-controls">
              {actionsEditMode && (
                <label>Character
                  <select value={actionCharacterId} onChange={(event) => void changeActionCharacter(event.target.value)}>
                    <option value="">Choose character</option>
                    {projectCharacters.map((character) => <option key={character.id} value={character.id}>{character.name}</option>)}
                  </select>
                </label>
              )}
              {actionsEditMode && selectedActionSlotId && (
                <label>Slot name
                  <input value={actionSlots.find((slot) => slot.id === selectedActionSlotId)?.name ?? ""} onChange={(event) => void renameActionSlot(selectedActionSlotId, event.target.value)} placeholder={actionSlots.find((slot) => slot.id === selectedActionSlotId) ? actionSlotName(actionSlots.find((slot) => slot.id === selectedActionSlotId)!) : "Slot name"} />
                </label>
              )}
            </div>
            {!actionCharacterId && <p className="notice">Choose a character in edit mode to create action slots.</p>}
            {actionCharacterId && actionMacros.length === 0 && <p className="notice">Create text macros here. Selecting a macro inserts text into the composer without sending it.</p>}
            {actionCharacterId && <DeltaActionTree macros={actionMacros} parentId={undefined} editMode={actionsEditMode} onChoose={chooseMacro} onAdd={addMacro} onEdit={editMacro} onDelete={deleteMacro} />}
          </section>
        )}
      </aside>
      {macroDraft && (
        <div className="modal-backdrop" onClick={() => setMacroDraft(undefined)}>
          <section className="modal macro-editor" onClick={(event) => event.stopPropagation()}>
            <div className="section-title">
              <h2>{macroDraft.macro ? "Edit Action" : macroDraft.folder ? "New Menu" : "New Action"}</h2>
              <button className="icon-button" onClick={() => setMacroDraft(undefined)} aria-label="Close action editor"><X size={18} /></button>
            </div>
            <label>Name<input value={macroDraft.label} onChange={(event) => setMacroDraft({ ...macroDraft, label: event.target.value })} /></label>
            {!macroDraft.folder && (
              <>
                <label>Text template<textarea value={macroDraft.template} onChange={(event) => setMacroDraft({ ...macroDraft, template: event.target.value })} rows={4} placeholder="Halle uses basic attack on {target}" /></label>
                <label className="compact-check"><input type="checkbox" checked={macroDraft.requestEntitySelection} onChange={(event) => setMacroDraft({ ...macroDraft, requestEntitySelection: event.target.checked })} /> Ask me to choose one or more targets before inserting</label>
              </>
            )}
            <div className="split-actions">
              <button onClick={saveMacroDraft}><Save size={18} /> Save</button>
              <button onClick={() => setMacroDraft(undefined)}>Cancel</button>
            </div>
          </section>
        </div>
      )}
      {settingsLeaveOpen && (
        <div className="modal-backdrop confirm-backdrop" onClick={() => setSettingsLeaveOpen(false)}>
          <section className="confirm-modal delta-settings-leave-modal" onClick={(event) => event.stopPropagation()}>
            <div className="section-title">
              <h2>Unsaved Delta settings</h2>
              <button className="icon-button" onClick={() => setSettingsLeaveOpen(false)} aria-label="Stay in Delta settings"><X size={18} /></button>
            </div>
            <p>You have changes in this Delta workspace that have not been saved.</p>
            <div className="split-actions">
              <button onClick={saveSettingsAndContinue}><Save size={16} /> Save and continue</button>
              <button onClick={discardSettingsAndContinue}>Discard</button>
            </div>
          </section>
        </div>
      )}
      {clearCacheOpen && (
        <div className="modal-backdrop" onClick={() => setClearCacheOpen(false)}>
          <section className="modal macro-editor" onClick={(event) => event.stopPropagation()}>
            <div className="section-title">
              <h2>Clear Ally Cache</h2>
              <button className="icon-button" onClick={() => setClearCacheOpen(false)} aria-label="Close clear cache dialog"><X size={18} /></button>
            </div>
            <p className="notice">This removes generated ally cache entries for this chat only. It does not delete project characters or Delta messages.</p>
            <div className="split-actions">
              <button className="danger" onClick={clearAllyCache}><Trash2 size={18} /> Clear cache</button>
              <button onClick={() => setClearCacheOpen(false)}>Cancel</button>
            </div>
          </section>
        </div>
      )}
      {finishAwaitingLootRoll && !finishPacket && (
        <div className="modal-backdrop delta-finish-backdrop" onClick={() => undefined}>
          <section className="modal delta-loot-roll-modal" onClick={(event) => event.stopPropagation()}>
            <div className="section-title">
              <h2>Roll For Loot</h2>
              <button className="icon-button" type="button" onClick={() => { setFinishAwaitingLootRoll(false); setFinishLootRoll(undefined); setFinishCurrencyRoll(undefined); setFinishCurrencyPicked(0); }} aria-label="Cancel loot roll"><X size={18} /></button>
            </div>
            <p className="notice">Roll 1d6 to search the scene for recoverable loot. Currency is rolled separately in the background.</p>
            <button className="delta-loot-roll-button" type="button" onClick={rollFinishLoot} disabled={finishLoading} aria-label="Roll d6 for loot">
              <img src={deltaDiceImages[6]} alt="d6" />
            </button>
          </section>
        </div>
      )}
      {finishPacket && (
        <div className="modal-backdrop delta-finish-backdrop" onClick={() => undefined}>
          <section className="modal delta-finish-modal" onClick={(event) => event.stopPropagation()}>
            <div className="section-title">
              <h2>Finish Engagement</h2>
              <button className="icon-button" type="button" onClick={() => { setFinishPacket(undefined); setFinishLootRoll(undefined); setFinishCurrencyRoll(undefined); setFinishCurrencyPicked(0); setFinishAwaitingLootRoll(false); }} aria-label="Close finish review"><X size={18} /></button>
            </div>
            <section className="stack">
              <h3>Outcome</h3>
              <MarkdownText text={finishPacket.outcomeSummary} />
            </section>
            {finishCurrencyRoll && (
              <section className="stack">
                <h3>Currency</h3>
                <small className="loot-roll-note">Currency roll: 3d4 digits = {finishCurrencyRoll.dice.join(", ")} ({finishCurrencyRoll.amount})</small>
                <div className="loot-review-row currency-recovery-row">
                  <div className="loot-item-name">
                    <strong>{project.currencyName?.trim() || "money"}</strong>
                    <small>{finishCurrencyPicked}/{finishCurrencyRoll.amount}</small>
                  </div>
                  <div className="quantity-stepper">
                    <button type="button" onClick={() => setFinishCurrencyPicked(Math.max(0, finishCurrencyPicked - 1))} aria-label="Take less currency">-</button>
                    <input
                      type="number"
                      min={0}
                      max={finishCurrencyRoll.amount}
                      value={finishCurrencyPicked}
                      onChange={(event) => setFinishCurrencyPicked(Math.max(0, Math.min(finishCurrencyRoll.amount, Math.floor(Number(event.target.value) || 0))))}
                      aria-label={`${project.currencyName?.trim() || "money"} amount to recover`}
                    />
                    <button type="button" onClick={() => setFinishCurrencyPicked(Math.min(finishCurrencyRoll.amount, finishCurrencyPicked + 1))} aria-label="Take more currency">+</button>
                  </div>
                  <div className="loot-row-actions">
                    <button type="button" onClick={() => setFinishCurrencyPicked(finishCurrencyRoll.amount)}>Pick Up</button>
                    <button type="button" onClick={() => setFinishCurrencyPicked(0)}>Drop All</button>
                  </div>
                </div>
              </section>
            )}
            <section className="stack">
              <div className="section-title">
                <h3>Loot</h3>
                {finishPacket.lootItems.length > 0 && (
                  <div className="split-actions compact">
                    <button type="button" onClick={pickUpAllLoot}>Pick Up All</button>
                    <button type="button" onClick={dropAllLoot}>Drop All</button>
                  </div>
                )}
              </div>
              {finishLootRoll && <small className="loot-roll-note">Loot roll: 1d6 = {finishLootRoll}</small>}
              {finishPacket.lootItems.length > 0 ? (
                <div className="loot-review-list">
                  {finishPacket.lootItems.map((item) => (
                    <div className="loot-review-row" key={item.id}>
                      <div className="loot-item-name">
                        <strong>{item.name}</strong>
                        <small>{item.pickedQuantity}/{item.quantity}</small>
                      </div>
                      <div className="quantity-stepper">
                        <button type="button" onClick={() => updateLootItem(item.id, { pickedQuantity: item.pickedQuantity - 1 })} aria-label={`Take less ${item.name}`}>-</button>
                        <input
                          type="number"
                          min={0}
                          max={item.quantity}
                          value={item.pickedQuantity}
                          onChange={(event) => updateLootItem(item.id, { pickedQuantity: Number(event.target.value) })}
                          aria-label={`${item.name} quantity to pick up`}
                        />
                        <button type="button" onClick={() => updateLootItem(item.id, { pickedQuantity: item.pickedQuantity + 1 })} aria-label={`Take more ${item.name}`}>+</button>
                      </div>
                      <div className="loot-row-actions">
                        <button type="button" onClick={() => updateLootItem(item.id, { pickedQuantity: item.quantity })}>Pick Up</button>
                        <button type="button" onClick={() => updateLootItem(item.id, { pickedQuantity: 0 })}>Drop All</button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="notice">No recoverable loot was listed for this engagement.</p>
              )}
            </section>
            <div className="split-actions">
              <button className="send-button" type="button" onClick={() => continueFromFinish(false)}>Continue</button>
              <button type="button" onClick={() => { setFinishPacket(undefined); setFinishLootRoll(undefined); setFinishCurrencyRoll(undefined); setFinishCurrencyPicked(0); setFinishAwaitingLootRoll(false); }}>Cancel</button>
            </div>
          </section>
        </div>
      )}
      {forfeitConfirmOpen && (
        <div className="modal-backdrop delta-finish-backdrop" onClick={() => setForfeitConfirmOpen(false)}>
          <section className="modal macro-editor" onClick={(event) => event.stopPropagation()}>
            <div className="section-title">
              <h2>Continue in main chat?</h2>
              <button className="icon-button" type="button" onClick={() => setForfeitConfirmOpen(false)} aria-label="Close loot warning"><X size={18} /></button>
            </div>
            <p className="notice">You will forfeit any untouched loot.</p>
            <div className="split-actions">
              <button className="danger" type="button" onClick={() => continueFromFinish(true)}>Continue</button>
              <button type="button" onClick={() => setForfeitConfirmOpen(false)}>Review loot</button>
            </div>
          </section>
        </div>
      )}
      {previewSession && (
        <div className="modal-backdrop" onClick={() => setPreviewSession(undefined)}>
          <section className="modal delta-archive-preview" onClick={(event) => event.stopPropagation()}>
            <div className="section-title">
              <h2>{previewSession.title}</h2>
              <button onClick={() => renameArchived(previewSession)}><Edit3 size={16} /> Rename</button>
              <button className="icon-button" onClick={() => setPreviewSession(undefined)} aria-label="Close archived engagement"><X size={18} /></button>
            </div>
            <p className="notice">Archived Delta engagements are read-only reference records and are not used for future Delta prompts, summaries, or compaction.</p>
            <div className="delta-messages delta-archive-log">
              {previewMessages.map((message) => {
                if (message.role === "system") {
                  if (message.rollReceipt) {
                    const rollerEntity = previewEntityByName.get(message.rollReceipt.rollerName.trim().toLowerCase());
                    return (
                      <DeltaVerifiedRollRow
                        key={message.id}
                        message={message}
                        relationship={relationshipForEntity(rollerEntity)}
                        expanded={expandedRollId === message.id}
                        onToggle={() => setExpandedRollId(expandedRollId === message.id ? undefined : message.id)}
                      />
                    );
                  }
                  const initiativeLines = message.body.startsWith("Initiative order")
                    ? message.body.split("\n").slice(1).filter((line) => line.trim())
                    : [];
                  if (isDeltaRollNotice(message.body)) previewLegacyRollPendingResolution = previewTurnNumber > 0;
                  return (
                    <article className="delta-log-brief" key={message.id}>
                      {initiativeLines.length > 0 ? (
                        <div className="delta-initiative-list">
                          <strong>Initiative order</strong>
                          {initiativeLines.map((line) => {
                            const name = line.replace(/^\s*\d+\.\s*/, "").split(":")[0]?.trim().toLowerCase();
                            return <span className={relationshipForEntity(name ? previewEntityByName.get(name) : undefined)} key={line}>{line}</span>;
                          })}
                        </div>
                      ) : <div className="message-body"><DeltaTurnText text={message.body} /></div>}
                    </article>
                  );
                }
                const cinematicSplit = splitDeltaCinematic(message.body);
                const bodyText = cinematicSplit.turn;
                if (cinematicSplit.cinematic && !bodyText) {
                  return (
                    <article className="delta-cinematic-beat" key={message.id}>
                      <span className="delta-log-number delta-cinematic-icon">{cinematicMarker()}</span>
                      <div className="message-body"><DeltaTurnText text={cinematicSplit.cinematic} /></div>
                    </article>
                  );
                }
                const numberLabel = numberForPreviewMessage(message);
                const effectiveTurnNumber = message.turnNumber ?? previewTurnNumber;
                const rowEntity = previewSession.initiativeStarted && previewEntities.length > 0
                  ? previewEntities[Math.max(0, effectiveTurnNumber - 1) % previewEntities.length]
                  : undefined;
                return (
                  <Fragment key={message.id}>
                    {cinematicSplit.cinematic && (
                      <article className="delta-cinematic-beat">
                        <span className="delta-log-number delta-cinematic-icon">{cinematicMarker()}</span>
                        <div className="message-body"><DeltaTurnText text={cinematicSplit.cinematic} /></div>
                      </article>
                    )}
                    <article className={`delta-log-row ${message.role === "user" ? "user" : "assistant"} ${relationshipForEntity(rowEntity)}`}>
                      <span className="delta-log-number">{numberLabel}</span>
                      <div className="message-body"><DeltaTurnText text={bodyText} /></div>
                    </article>
                  </Fragment>
                );
              })}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
