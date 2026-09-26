import Dexie from "dexie";
import {
  Archive,
  BookOpen,
  ChevronLeft,
  ChevronRight,
  Database,
  Download,
  Edit3,
  Eye,
  Folder,
  GripVertical,
  Image as ImageIcon,
  KeyRound,
  Menu,
  MessageSquare,
  Pencil,
  Pin,
  Plus,
  RefreshCw,
  Save,
  Search,
  Settings,
  Shield,
  ShoppingBag,
  Star,
  Swords,
  Trash2,
  Upload,
  UserRound,
  X,
  Zap
} from "lucide-react";
import type React from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { createFullBackup, createRecoverySnapshot, installAutomaticRecoverySnapshots, listRecoverySnapshots, mergeFullBackup, parseAndValidateBackup, replaceWithFullBackup, restoreRecoverySnapshot, type RecoverySlot, type RecoverySnapshot } from "../data/backup";
import { importCastSources, isCastSource } from "../data/castImport";
import { db, ensureSeedData } from "../data/db";
import { defaultDeltaJobs, defaultDeltaNpcStats, defaultDeltaSystemPrompt, defaultSettings, effectiveDeltaSystemPrompt } from "../data/defaults";
import { deleteCharacters, deleteMessages, deleteProject } from "../data/deletion";
import {
  abilities,
  createMemory,
  createProject,
  deltaCarryProfile,
  effectiveDeltaBases,
  effectiveDeltaPrefixes,
  formatDeltaTemplateTag,
  generatedDeltaStats,
  getCharacterBio,
  getCharacterIdentity,
  getCharacterStats,
  getOrCreateDeltaSession,
  normaliseInventoryName,
  refreshActiveDeltaCharacterStats,
  searchMemories,
  validatePointBuy
} from "../data/repositories";
import { buildSourceChunks } from "../data/sources";
import { formatTracker, formatWorldTime, syncRealtimeWorld } from "../data/world";
import { Ability, AbilityModifiers, AbilityScores, AppSettings, Character, CharacterActionMacro, CharacterActionSlot, CharacterBonus, CharacterGearSlot, Chat, DeltaAllyCacheEntry, DeltaBaseTemplate, DeltaEffectDefinition, DeltaEffectPolarity, DeltaEntity, DeltaIconAsset, DeltaJobTemplate, DeltaMapSize, DeltaMessage, DeltaPrefixTemplate, DeltaSavingThrowTiming, DeltaSession, GearBodyType, GearSlotName, InventoryItem, InventoryKind, InventoryLog, Memory, Message, ModelLibraryEntry, PendingMemory, Project, RouteName, SidebarSpacing, SidebarWidth, SourceFile, WorldState } from "../types";
import { formatDate, normaliseTag, now, splitTags, uid } from "../utils";
import { ChatScreen } from "./chat/ChatScreen";
import { DeltaActionTree } from "./delta/DeltaActionTree";
import { DeltaModeWorkspace } from "./delta/DeltaModeWorkspace";
import { downloadJson, formatInventoryKg, isInvalidDeltaEntityName, jobCategories, useSavedNotice } from "./delta/workspaceSupport";
import { GearDrawer } from "./gear/GearDrawer";
import { ProjectIcon, projectIcons } from "./icons";
import { HpSquares } from "./shared/HpSquares";
import { MarkdownText } from "./shared/MarkdownText";
import { EmptyState, ImageStrip, ImageViewer, MothMark } from "./shared/appElements";
import { useAttachmentImages } from "./shared/useAttachmentImages";

const accents = [
  { name: "sage", value: "#8fbea8" },
  { name: "violet", value: "#b7a1e8" },
  { name: "blue", value: "#82aee6" },
  { name: "rose", value: "#d993a8" },
  { name: "amber", value: "#d3aa66" },
  { name: "teal", value: "#72bfc2" },
  { name: "clay", value: "#c58f78" },
  { name: "silver", value: "#b9bdc7" },
  { name: "bone", value: "#d8d1c2" },
  { name: "muted blue", value: "#6f8fb8" },
  { name: "dusty rose", value: "#a86373" },
  { name: "dark burgundy", value: "#5a1f2c" },
  { name: "dark violet", value: "#43245f" },
  { name: "plum", value: "#62314f" },
  { name: "deep navy", value: "#1f355c" },
  { name: "deep teal", value: "#1f5a5c" },
  { name: "forest green", value: "#284d34" },
  { name: "dark rust", value: "#74412a" },
  { name: "charcoal/slate", value: "#4b5563" }
] as const;

function hexToRgb(hex: string) {
  const clean = hex.replace("#", "");
  const value = Number.parseInt(clean, 16);
  return {
    r: (value >> 16) & 255,
    g: (value >> 8) & 255,
    b: value & 255
  };
}

function rgbToHex({ r, g, b }: { r: number; g: number; b: number }) {
  return `#${[r, g, b].map((part) => Math.round(Math.max(0, Math.min(255, part))).toString(16).padStart(2, "0")).join("")}`;
}

function relativeLuminance(hex: string) {
  const { r, g, b } = hexToRgb(hex);
  const channel = (value: number) => {
    const normalized = value / 255;
    return normalized <= 0.03928 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function mixHex(a: string, b: string, amount: number) {
  const first = hexToRgb(a);
  const second = hexToRgb(b);
  return rgbToHex({
    r: first.r + (second.r - first.r) * amount,
    g: first.g + (second.g - first.g) * amount,
    b: first.b + (second.b - first.b) * amount
  });
}

function formatByteSize(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const index = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const value = bytes / 1024 ** index;
  return `${value >= 10 || index === 0 ? Math.round(value) : value.toFixed(1)} ${units[index]}`;
}

function accentTokens(value: string) {
  const luminance = relativeLuminance(value);
  const isDark = luminance < 0.24;
  return {
    accent: value,
    fill: isDark ? mixHex(value, "#ffffff", 0.24) : value,
    contrast: isDark ? "#f4f6f8" : "#111315"
  };
}

const routeLabels: Record<RouteName, string> = {
  chat: "Chat",
  projects: "Projects",
  projectEdit: "Project Settings",
  stars: "Stars",
  archives: "Archives",
  archiveEntries: "Archive Entries",
  characters: "Characters",
  characterProfile: "Character Profile",
  memories: "Memories",
  compaction: "Compaction Memory",
  api: "API",
  data: "Data",
  settings: "Settings"
};

const sidebarSpacingOptions: SidebarSpacing[] = ["22", "24", "28", "36"];
const sidebarWidthOptions: SidebarWidth[] = ["380", "340", "300", "420"];

function fontSizeLabel(size: number) {
  if (size <= 12) return "XS";
  if (size <= 14) return "Small";
  if (size <= 16) return "Standard";
  if (size <= 18) return "Large";
  if (size <= 20) return "XL";
  if (size <= 22) return "XXL";
  return "Huge";
}

function normaliseSidebarSpacing(value: unknown): SidebarSpacing {
  if (value === "compact") return "28";
  if (value === "dense") return "24";
  if (value === "very-dense") return "22";
  return sidebarSpacingOptions.includes(value as SidebarSpacing) ? value as SidebarSpacing : "36";
}

function normaliseSidebarWidth(value: unknown): SidebarWidth {
  if (value === "narrow") return "340";
  if (value === "slim") return "300";
  if (value === "wide") return "420";
  return sidebarWidthOptions.includes(value as SidebarWidth) ? value as SidebarWidth : "380";
}

function cleanAbilityScores(value?: AbilityScores): AbilityScores {
  const defaults = defaultDeltaNpcStats();
  return abilities.reduce((scores, ability) => ({ ...scores, [ability]: Number.isFinite(value?.[ability]) ? Number(value?.[ability]) : defaults[ability] }), defaults);
}

function cleanAbilityModifiers(value?: AbilityModifiers): AbilityModifiers {
  return abilities.reduce((modifiers, ability) => {
    const amount = value?.[ability];
    return Number.isFinite(amount) && amount !== 0 ? { ...modifiers, [ability]: Number(amount) } : modifiers;
  }, {} as AbilityModifiers);
}

function isLegacyDefaultTitanBase(item: DeltaBaseTemplate) {
  return item.id.trim().toLowerCase() === "titan" &&
    item.label.trim().toUpperCase() === "TITAN" &&
    Object.keys(cleanAbilityModifiers(item.statModifiers)).length === 0 &&
    !item.hpBonus &&
    !item.notes?.trim();
}

function cleanDeltaPrefixes(value: DeltaPrefixTemplate[]) {
  return value
    .map((item) => ({
      id: item.id.trim() || uid(),
      label: item.label.trim(),
      statModifiers: cleanAbilityModifiers(item.statModifiers),
      notes: item.notes?.trim() || undefined
    }))
    .filter((item) => item.label);
}

function cleanDeltaBases(value: DeltaBaseTemplate[]) {
  return value
    .filter((item) => !isLegacyDefaultTitanBase(item))
    .map((item) => ({
      id: item.id.trim() || uid(),
      label: item.label.trim(),
      statModifiers: cleanAbilityModifiers(item.statModifiers),
      hpBonus: Number.isFinite(item.hpBonus) && item.hpBonus !== 0 ? Number(item.hpBonus) : undefined,
      carryKgPerStr: Number.isFinite(item.carryKgPerStr) && (item.carryKgPerStr ?? 0) > 0 ? Number(item.carryKgPerStr) : undefined,
      combatLoadPercent: Number.isFinite(item.combatLoadPercent) ? Math.min(100, Math.max(1, Number(item.combatLoadPercent))) : undefined,
      notes: item.notes?.trim() || undefined
    }))
    .filter((item) => item.label);
}

function deltaBaseDraft(value?: DeltaBaseTemplate[]) {
  const rows = value?.filter((item) => !isLegacyDefaultTitanBase(item));
  return effectiveDeltaBases(rows);
}

function cleanDeltaJobs(value: DeltaJobTemplate[]) {
  return value
    .map((item) => ({
      id: item.id.trim() || uid(),
      label: item.label.trim(),
      category: item.category.trim(),
      statModifiers: cleanAbilityModifiers(item.statModifiers),
      notes: item.notes?.trim() || undefined
    }))
    .filter((item) => item.label && item.category);
}

function categoryFromFilename(filename: string) {
  return filename.replace(/\.txt$/i, "").trim();
}

async function parseJobFiles(files: FileList | null) {
  if (!files?.length) return { jobs: [] as DeltaJobTemplate[], categories: [] as string[], errors: [] as string[] };
  const jobs: DeltaJobTemplate[] = [];
  const categories: string[] = [];
  const errors: string[] = [];
  for (const file of Array.from(files)) {
    const category = categoryFromFilename(file.name);
    if (!category) {
      errors.push(`${file.name}: filename must contain a category name.`);
      continue;
    }
    const text = await file.text();
    const parsedRows: DeltaJobTemplate[] = [];
    text.split(/\r?\n/).forEach((rawLine, lineIndex) => {
      const line = rawLine.trim();
      if (!line) return;
      const fields = line.split(/\s+/);
      if (fields.length !== 7) {
        errors.push(`${file.name}:${lineIndex + 1} expected JOB STR DEX CON INT WIS CHA.`);
        return;
      }
      const [label, ...numbers] = fields;
      const modifiers = numbers.map((value) => Number(value));
      if (modifiers.some((value) => !Number.isFinite(value))) {
        errors.push(`${file.name}:${lineIndex + 1} stat modifiers must be numbers.`);
        return;
      }
      parsedRows.push({
        id: `${category}-${label}`.toLowerCase(),
        label: label.trim().toUpperCase(),
        category,
        statModifiers: {
          STR: modifiers[0],
          DEX: modifiers[1],
          CON: modifiers[2],
          INT: modifiers[3],
          WIS: modifiers[4],
          CHA: modifiers[5]
        },
        notes: ""
      });
    });
    if (!errors.some((error) => error.startsWith(`${file.name}:`))) {
      categories.push(category);
      jobs.push(...parsedRows);
    }
  }
  return { jobs, categories, errors };
}

function downloadSourceCopy(file: SourceFile) {
  const blob = new Blob([file.textContent ?? ""], { type: file.mimeType || "text/plain" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = file.name || "source.txt";
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

type MirrorNavigationState = {
  mirrorNavigation?: true;
  mirrorRoute?: RouteName;
  /** The first entry is kept as a guard so Android back does not dismiss the PWA. */
  mirrorNavigationRoot?: boolean;
};

function isMirrorNavigationState(value: unknown): value is MirrorNavigationState {
  return Boolean(value && typeof value === "object" && (value as MirrorNavigationState).mirrorNavigation);
}

export function App() {
  const [ready, setReady] = useState(false);
  const [settings, setSettings] = useState<AppSettings>(defaultSettings());
  const [projects, setProjects] = useState<Project[]>([]);
  const [chats, setChats] = useState<Chat[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string>();
  const [selectedChatId, setSelectedChatId] = useState<string>();
  const [route, setRoute] = useState<RouteName>("chat");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editingProjectId, setEditingProjectId] = useState<string>();
  const [projectEditInitialTab, setProjectEditInitialTab] = useState<"general" | "delta">("general");
  const [profileCharacterId, setProfileCharacterId] = useState<string>();
  const [models, setModels] = useState<ModelLibraryEntry[]>([]);
  const [selectedModelId, setSelectedModelId] = useState("");
  const [inventoryOpen, setInventoryOpen] = useState(false);
  const [gearOpen, setGearOpen] = useState(false);
  const [gearEditingCharacterId, setGearEditingCharacterId] = useState<string>();
  const [gearRefreshVersion, setGearRefreshVersion] = useState(0);
  const [deltaOpen, setDeltaOpen] = useState(false);
  const [deltaProjectSettingsOpen, setDeltaProjectSettingsOpen] = useState(false);
  const [deltaSession, setDeltaSession] = useState<DeltaSession>();
  const [deltaMessages, setDeltaMessages] = useState<DeltaMessage[]>([]);
  const [deltaEntities, setDeltaEntities] = useState<DeltaEntity[]>([]);
  const [archivedDeltaSessions, setArchivedDeltaSessions] = useState<DeltaSession[]>([]);
  const [deltaAllyCache, setDeltaAllyCache] = useState<DeltaAllyCacheEntry[]>([]);
  const [deltaStartContext, setDeltaStartContext] = useState("");
  const [selectedChatActiveDelta, setSelectedChatActiveDelta] = useState<DeltaSession>();
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [worldStatusOpen, setWorldStatusOpen] = useState(false);
  const [, setWorldClockTick] = useState(0);
  const navigationReadyRef = useRef(false);
  const applyingHistoryNavigationRef = useRef(false);
  const routeRef = useRef<RouteName>(route);
  const selectedProject = projects.find((project) => project.id === selectedProjectId);
  const editingProject = projects.find((project) => project.id === (editingProjectId ?? selectedProjectId));
  const selectedChat = chats.find((chat) => chat.id === selectedChatId);

  useEffect(() => {
    routeRef.current = route;
  }, [route]);

  // This app has client-side screens rather than URL routes. Give those screens a
  // real browser history stack so the Android/iOS back gesture stays in the app.
  useEffect(() => {
    if (navigationReadyRef.current) return;
    navigationReadyRef.current = true;

    const rootState: MirrorNavigationState = {
      mirrorNavigation: true,
      mirrorRoute: "chat",
      mirrorNavigationRoot: true
    };
    window.history.replaceState(rootState, "", window.location.href);
    window.history.pushState({ ...rootState, mirrorNavigationRoot: false }, "", window.location.href);
  }, []);

  useEffect(() => {
    const handlePopState = (event: PopStateEvent) => {
      const state = event.state as unknown;
      if (!isMirrorNavigationState(state)) {
        // The entry created above normally means this branch is unreachable, but
        // retaining the guard prevents an edge swipe from closing an installed PWA.
        window.history.pushState({ mirrorNavigation: true, mirrorRoute: routeRef.current }, "", window.location.href);
        return;
      }

      const destination = state.mirrorRoute ?? "chat";
      if (state.mirrorNavigationRoot) {
        // Keep one in-app entry ahead of the root. A second back swipe therefore
        // remains on the chat screen instead of handing control to the OS.
        window.history.pushState({ ...state, mirrorNavigationRoot: false }, "", window.location.href);
      }

      if (destination !== routeRef.current) {
        applyingHistoryNavigationRef.current = true;
        setRoute(destination);
      }
    };

    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  useEffect(() => {
    if (!navigationReadyRef.current) return;
    if (applyingHistoryNavigationRef.current) {
      applyingHistoryNavigationRef.current = false;
      return;
    }
    const currentState = window.history.state as unknown;
    if (isMirrorNavigationState(currentState) && currentState.mirrorRoute === route && !currentState.mirrorNavigationRoot) return;
    window.history.pushState({ mirrorNavigation: true, mirrorRoute: route }, "", window.location.href);
  }, [route]);
  useEffect(() => {
    const timer = window.setInterval(() => {
      setWorldClockTick((value) => value + 1);
      if (!selectedChatId) return;
      void db.chats.get(selectedChatId).then(async (current) => {
        if (!current?.world || current.world.timeMode !== "realtime") return;
        const world = syncRealtimeWorld(current.world);
        await db.chats.update(current.id, { world, updatedAt: now() });
        setChats((rows) => rows.map((chat) => chat.id === current.id ? { ...chat, world, updatedAt: now() } : chat));
      });
    }, 30_000);
    return () => window.clearInterval(timer);
  }, [selectedChatId]);

  useEffect(() => {
    setDeltaOpen(false);
    setDeltaProjectSettingsOpen(false);
    setDeltaSession(undefined);
    setDeltaMessages([]);
    setDeltaEntities([]);
    setArchivedDeltaSessions([]);
    setDeltaAllyCache([]);
  }, [selectedChatId]);
  useEffect(() => {
    if (!deltaProjectSettingsOpen) return;
    const closeProjectSettingsFromHistory = (event: PopStateEvent) => {
      if (!(event.state as { mirrorDeltaProjectSettings?: boolean } | null)?.mirrorDeltaProjectSettings) setDeltaProjectSettingsOpen(false);
    };
    window.addEventListener("popstate", closeProjectSettingsFromHistory);
    return () => window.removeEventListener("popstate", closeProjectSettingsFromHistory);
  }, [deltaProjectSettingsOpen]);
  useEffect(() => {
    let alive = true;
    if (!selectedChatId) {
      setSelectedChatActiveDelta(undefined);
      return;
    }
    void db.deltaSessions.where("chatId").equals(selectedChatId).and((session) => session.active).first().then((session) => {
      if (alive) setSelectedChatActiveDelta(session);
    });
    return () => {
      alive = false;
    };
  }, [selectedChatId, deltaOpen, deltaSession?.updatedAt, chats]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (deltaProjectSettingsOpen || deltaOpen) {
        event.preventDefault();
        window.history.back();
      } else if (gearOpen) {
        event.preventDefault();
        setGearOpen(false);
      } else if (inventoryOpen) {
        event.preventDefault();
        setInventoryOpen(false);
      } else if (drawerOpen) {
        event.preventDefault();
        setDrawerOpen(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [deltaProjectSettingsOpen, deltaOpen, gearOpen, inventoryOpen, drawerOpen]);

  async function refresh() {
    const [nextSettings, nextProjects, unsortedChats] = await Promise.all([
      db.settings.get("settings"),
      db.projects.orderBy("orderIndex").toArray(),
      selectedProjectId ? db.chats.where("projectId").equals(selectedProjectId).toArray() : Promise.resolve([])
    ]);
    const nextChats = unsortedChats.sort((a, b) => b.updatedAt - a.updatedAt);
    setSettings(nextSettings ?? defaultSettings());
    setProjects(nextProjects);
    setChats(nextChats);
    const nextModels = await db.modelLibrary.orderBy("orderIndex").toArray();
    setModels(nextModels);
    setSelectedModelId((current) => nextSettings?.defaultModelId || current || nextModels[0]?.modelId || "");
    const activeChat = selectedChatId ? await db.chats.get(selectedChatId) : undefined;
    if (activeChat) {
      const rows = await db.messages
        .where("[chatId+branchId+sequence]")
        .between([activeChat.id, activeChat.activeBranchId, Dexie.minKey], [activeChat.id, activeChat.activeBranchId, Dexie.maxKey])
        .toArray();
      setMessages(rows.sort((a, b) => a.sequence - b.sequence));
    } else {
      setMessages([]);
    }
  }

  useEffect(() => {
    ensureSeedData().then(async () => {
      installAutomaticRecoverySnapshots();
      const first = await db.projects.orderBy("orderIndex").first();
      setSelectedProjectId(first?.id);
      setReady(true);
    });
  }, []);

  useEffect(() => {
    if (!ready) return;
    refresh();
  }, [ready, selectedProjectId, selectedChatId]);

  useEffect(() => {
    function showUpdate() {
      setUpdateAvailable(true);
    }
    window.addEventListener("mirror:update-available", showUpdate);
    return () => window.removeEventListener("mirror:update-available", showUpdate);
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = settings.theme;
    document.documentElement.dataset.font = settings.font;
    document.documentElement.dataset.sidebarSpacing = normaliseSidebarSpacing(settings.sidebarSpacing ?? (settings as AppSettings & { sidebarSize?: unknown }).sidebarSize);
    document.documentElement.dataset.sidebarWidth = normaliseSidebarWidth(settings.sidebarWidth);
    document.documentElement.style.setProperty("--app-font-size", `${settings.fontScale ?? 16}px`);
    document.documentElement.style.setProperty("--entry-width", `${settings.entryWidth}%`);
    document.documentElement.style.setProperty("--message-gap", `${settings.messageSpacing}px`);
    document.documentElement.style.setProperty("--paragraph-gap", `${settings.paragraphSpacing ?? 4}px`);
    const tokens = accentTokens(accents.find((accent) => accent.name === settings.accent)?.value ?? accents[0].value);
    document.documentElement.style.setProperty("--accent", tokens.accent);
    document.documentElement.style.setProperty("--accent-fill", tokens.fill);
    document.documentElement.style.setProperty("--accent-contrast", tokens.contrast);
  }, [settings]);

  const projectChats = useMemo(() => chats.filter((chat) => chat.projectId === selectedProjectId), [chats, selectedProjectId]);
  const title = route === "chat"
    ? selectedProject?.name ?? "Choose a project"
    : selectedProject && ["stars", "archives", "archiveEntries", "characters", "characterProfile", "memories", "compaction"].includes(route)
      ? `${selectedProject.name} / ${routeLabels[route]}`
      : routeLabels[route];

  if (!ready) return <div className="loading">Mirror 2.0</div>;

  async function selectChat(id: string) {
    const activeChat = await db.chats.get(id);
    setSelectedChatId(id);
    if (!activeChat) {
      setMessages([]);
      return;
    }
    const [rows, nextChats] = await Promise.all([
      db.messages
        .where("[chatId+branchId+sequence]")
        .between([activeChat.id, activeChat.activeBranchId, Dexie.minKey], [activeChat.id, activeChat.activeBranchId, Dexie.maxKey])
        .toArray(),
      db.chats.where("projectId").equals(activeChat.projectId).toArray()
    ]);
    setChats(nextChats.sort((a, b) => b.updatedAt - a.updatedAt));
    setMessages(rows.sort((a, b) => a.sequence - b.sequence));
  }

  async function renameChat(id: string) {
    const chat = await db.chats.get(id);
    if (!chat) return;
    const nextTitle = prompt("Rename chat thread", chat.title)?.trim();
    if (!nextTitle || nextTitle === chat.title) return;
    await db.chats.update(id, { title: nextTitle, titleState: "manual", updatedAt: now() });
    await refresh();
  }

  async function deleteChat(id: string) {
    const chat = await db.chats.get(id);
    if (!chat) return;
    if (!confirm(`Delete chat thread "${chat.title}"? This removes its messages and stars.`)) return;
    await db.transaction("rw", [db.chats, db.branches, db.messages, db.stars, db.attachments, db.inventoryItems, db.inventoryLogs, db.deltaSessions, db.deltaMessages, db.deltaEntities, db.deltaAllyCache, db.deltaActionMacros], async () => {
      const deltaSessionIds = (await db.deltaSessions.where("chatId").equals(id).primaryKeys()) as string[];
      const messageIds = (await db.messages.where("chatId").equals(id).primaryKeys()) as string[];
      await db.stars.where("chatId").equals(id).delete();
      await deleteMessages(messageIds);
      await db.branches.where("chatId").equals(id).delete();
      await db.inventoryItems.where("chatId").equals(id).delete();
      await db.inventoryLogs.where("chatId").equals(id).delete();
      if (deltaSessionIds.length) {
        await db.deltaMessages.where("sessionId").anyOf(deltaSessionIds).delete();
        await db.deltaEntities.where("sessionId").anyOf(deltaSessionIds).delete();
      }
      await db.deltaSessions.where("chatId").equals(id).delete();
      await db.deltaAllyCache.where("chatId").equals(id).delete();
      await db.deltaActionMacros.where("chatId").equals(id).delete();
      await db.chats.delete(id);
    });
    if (selectedChatId === id) {
      setSelectedChatId(undefined);
      setMessages([]);
    }
    await refresh();
  }

  async function toggleProjectPin(id: string) {
    const project = await db.projects.get(id);
    if (!project) return;
    await db.projects.update(id, { pinned: !project.pinned, updatedAt: now() });
    await refresh();
  }

  async function toggleChatPin(id: string) {
    const chat = await db.chats.get(id);
    if (!chat) return;
    await db.chats.update(id, { pinned: !chat.pinned, updatedAt: now() });
    await refresh();
  }

  async function openDeltaMode(chatOverride?: Chat, startContext = "", mapSize?: DeltaMapSize) {
    const activeChat = chatOverride ?? selectedChat;
    const activeProject = activeChat ? projects.find((project) => project.id === activeChat.projectId) : selectedProject;
    if (!activeProject || !activeChat) return;
    if (!activeProject.deltaEnabled || !activeProject.inventoryEnabled || !activeProject.gearEnabled) return;
    let session = startContext
      ? await getOrCreateDeltaSession(activeChat)
      : await db.deltaSessions.where("chatId").equals(activeChat.id).and((item) => item.active).first()
        ?? await db.deltaSessions.where("chatId").equals(activeChat.id).and((item) => !item.active).reverse().sortBy("updatedAt").then((items) => items[0]);
    if (!session) return;
    if (startContext && mapSize && session.mapSize !== mapSize) {
      const updatedAt = now();
      await db.deltaSessions.update(session.id, { mapSize, updatedAt });
      session = { ...session, mapSize, updatedAt };
    }
    const activeEntities = await db.deltaEntities.where("sessionId").equals(session.id).toArray();
    const linkedEntityNames = new Set(activeEntities.filter((entity) => entity.characterId).map((entity) => entity.name.trim().toLowerCase()));
    const malformedEntityIds = activeEntities
      .filter((entity) => !entity.characterId && (isInvalidDeltaEntityName(entity.name) || linkedEntityNames.has(entity.name.trim().toLowerCase())))
      .map((entity) => entity.id);
    if (malformedEntityIds.length) await db.deltaEntities.bulkDelete(malformedEntityIds);
    const selectedPlayerEntity = activeChat.deltaPlayerCharacterId
      ? activeEntities.find((entity) => entity.characterId === activeChat.deltaPlayerCharacterId)
      : undefined;
    if (selectedPlayerEntity && session.settings.playerEntityId !== selectedPlayerEntity.id) {
      const updatedAt = now();
      const settings = { ...session.settings, playerEntityId: selectedPlayerEntity.id };
      await db.deltaSessions.update(session.id, { settings, updatedAt });
      session = { ...session, settings, updatedAt };
    }
    const [nextMessages, nextEntities, archivedSessions, allyCache] = await Promise.all([
      db.deltaMessages.where("sessionId").equals(session.id).toArray(),
      db.deltaEntities.where("sessionId").equals(session.id).toArray(),
      db.deltaSessions.where("chatId").equals(activeChat.id).and((item) => !item.active).toArray(),
      db.deltaAllyCache.where("chatId").equals(activeChat.id).toArray()
    ]);
    setDeltaSession(session);
    setDeltaMessages(nextMessages.sort((a, b) => a.sequence - b.sequence));
    setDeltaEntities(nextEntities.sort((a, b) => a.orderIndex - b.orderIndex));
    setArchivedDeltaSessions(archivedSessions.sort((a, b) => b.updatedAt - a.updatedAt));
    setDeltaAllyCache(allyCache.sort((a, b) => b.updatedAt - a.updatedAt));
    setDeltaStartContext(startContext);
    setDeltaOpen(true);
    window.history.pushState({ mirrorDeltaMode: true }, "", window.location.href);
  }

  async function refreshDeltaMode() {
    if (!deltaSession) return;
    const [session, nextMessages, nextEntities, archivedSessions, allyCache] = await Promise.all([
      db.deltaSessions.get(deltaSession.id),
      db.deltaMessages.where("sessionId").equals(deltaSession.id).toArray(),
      db.deltaEntities.where("sessionId").equals(deltaSession.id).toArray(),
      db.deltaSessions.where("chatId").equals(deltaSession.chatId).and((item) => !item.active).toArray(),
      db.deltaAllyCache.where("chatId").equals(deltaSession.chatId).toArray()
    ]);
    if (session) setDeltaSession(session);
    setDeltaMessages(nextMessages.sort((a, b) => a.sequence - b.sequence));
    setDeltaEntities(nextEntities.sort((a, b) => a.orderIndex - b.orderIndex));
    setArchivedDeltaSessions(archivedSessions.sort((a, b) => b.updatedAt - a.updatedAt));
    setDeltaAllyCache(allyCache.sort((a, b) => b.updatedAt - a.updatedAt));
  }

  async function applyUpdate() {
    const registration = await navigator.serviceWorker?.getRegistration?.("./");
    if (!registration?.waiting) {
      location.reload();
      return;
    }
    navigator.serviceWorker.addEventListener("controllerchange", () => location.reload(), { once: true });
    registration.waiting.postMessage({ type: "SKIP_WAITING" });
  }

  return (
    <div className="app-shell">
      {updateAvailable && (
        <div className="update-banner">
          <span>Update available</span>
          <button onClick={applyUpdate}>Reload</button>
          <button className="icon-button" onClick={() => setUpdateAvailable(false)} aria-label="Dismiss update notice"><X size={16} /></button>
        </div>
      )}
      <Header
        title={title}
        subtitle={route === "chat" ? selectedChat?.title : undefined}
        contextNote={route === "chat" && selectedChat?.infiniteHistoryLocked ? "⚠︎ infinite context" : undefined}
        world={route === "chat" ? selectedChat?.world : undefined}
        worldStatusOpen={worldStatusOpen}
        onWorldToggle={() => setWorldStatusOpen((open) => !open)}
        onMenu={() => setDrawerOpen(true)}
        right={route === "chat" && selectedProject ? (
          <div className="header-actions">
            {selectedProject.inventoryEnabled && (
              <button className="inventory-trigger" onClick={() => setInventoryOpen(true)} aria-label="Open inventory" title="Inventory">
                <ShoppingBag size={19} />
              </button>
            )}
            {selectedProject.gearEnabled && (
              <button className="inventory-trigger" onClick={() => setGearOpen(true)} aria-label="Open gear" title="Gear">
                <Shield size={19} />
              </button>
            )}
            {selectedChat && selectedProject.deltaEnabled && selectedProject.inventoryEnabled && selectedProject.gearEnabled && (
              <button className={`inventory-trigger ${selectedChatActiveDelta ? "active" : ""}`} type="button" onClick={() => openDeltaMode()} aria-label="Open Delta Mode" title="Delta Mode">
                <Swords size={19} />
              </button>
            )}
          </div>
        ) : undefined}
      />
      {selectedProject && selectedChat && (
        <InventoryDrawer
          open={inventoryOpen}
          project={selectedProject}
          chat={selectedChat}
          elevated={deltaOpen}
          onClose={() => setInventoryOpen(false)}
          onRefresh={refresh}
        />
      )}
      {selectedProject && selectedChat && (
        <GearDrawer
          open={gearOpen}
          project={selectedProject}
          chat={selectedChat}
          refreshVersion={gearRefreshVersion}
          elevated={deltaOpen}
          onOpenCharacter={(id) => {
            setGearEditingCharacterId(id);
          }}
          onClose={() => setGearOpen(false)}
        />
      )}
      {selectedProject && gearEditingCharacterId && (
        <div className="modal-backdrop gear-character-modal" onClick={() => setGearEditingCharacterId(undefined)}>
          <section className="gear-character-editor-shell" onClick={(event) => event.stopPropagation()}>
            <CharacterProfilePage
              project={selectedProject}
              characterId={gearEditingCharacterId}
              chatId={selectedChat?.id}
              onSaved={() => setGearRefreshVersion((current) => current + 1)}
              onBack={() => setGearEditingCharacterId(undefined)}
              onDeleted={() => setGearEditingCharacterId(undefined)}
            />
          </section>
        </div>
      )}
      {selectedProject && selectedChat && deltaOpen && deltaSession && (
        <DeltaModeWorkspace
          project={selectedProject}
          chat={selectedChat}
          settings={settings}
          selectedModelId={selectedModelId}
          session={deltaSession}
          messages={deltaMessages}
          entities={deltaEntities}
          archivedSessions={archivedDeltaSessions}
          allyCache={deltaAllyCache}
          startContext={deltaStartContext}
          onStartContextConsumed={() => setDeltaStartContext("")}
          onOpenInventory={() => setInventoryOpen(true)}
          onOpenProjectDeltaSettings={() => {
            setEditingProjectId(selectedProject.id);
            setProjectEditInitialTab("delta");
            setDeltaProjectSettingsOpen(true);
            window.history.pushState({ ...window.history.state, mirrorDeltaProjectSettings: true }, "", window.location.href);
          }}
          onClose={() => setDeltaOpen(false)}
          onRefresh={refreshDeltaMode}
        />
      )}
      {selectedProject && deltaOpen && deltaProjectSettingsOpen && (
        <section className="delta-project-settings-layer">
          <ProjectEditPage
            key={`${selectedProject.id}:delta-overlay`}
            project={selectedProject}
            initialTab="delta"
            onRefresh={refresh}
            onDone={() => {
              if (window.history.state?.mirrorDeltaProjectSettings) window.history.back();
              else setDeltaProjectSettingsOpen(false);
            }}
          />
        </section>
      )}
      <Drawer
        open={drawerOpen}
        projects={projects}
        selectedProjectId={selectedProjectId}
        chats={projectChats}
        selectedChatId={selectedChatId}
        onClose={() => setDrawerOpen(false)}
        onRoute={(nextRoute) => {
          if (nextRoute === "projectEdit") {
            setEditingProjectId(selectedProjectId);
            setProjectEditInitialTab("general");
          }
          setRoute(nextRoute);
          setDrawerOpen(false);
        }}
        onProject={(id) => {
          setSelectedProjectId(id);
          setSelectedChatId(undefined);
          setRoute("chat");
          setDrawerOpen(false);
        }}
        onChat={(id) => {
          void selectChat(id);
          setRoute("chat");
          setDrawerOpen(false);
        }}
        onRenameChat={renameChat}
        onDeleteChat={deleteChat}
        onToggleProjectPin={toggleProjectPin}
        onToggleChatPin={toggleChatPin}
      />
      <main className="screen">
        {route === "chat" && (
          <ChatScreen
            project={selectedProject}
            chat={selectedChat}
            messages={messages}
            settings={settings}
            onRefresh={refresh}
            onMessageUpdated={(id, patch) => setMessages((rows) => rows.map((row) => row.id === id ? { ...row, ...patch } : row))}
            onChatCreated={selectChat}
            onRoute={setRoute}
            selectedModelId={selectedModelId}
            models={models}
            deltaLocked={Boolean(selectedChatActiveDelta)}
            onOpenDelta={(chatOverride, startContext, mapSize) => openDeltaMode(chatOverride, startContext, mapSize)}
            onSettingsSaved={async (modelId) => {
              setSelectedModelId(modelId);
              await refresh();
            }}
          />
        )}
        {route === "projects" && <ProjectsPage projects={projects} selectedProjectId={selectedProjectId} onSelect={setSelectedProjectId} onEdit={(id) => { setEditingProjectId(id); setProjectEditInitialTab("general"); setRoute("projectEdit"); }} onRefresh={refresh} />}
        {route === "projectEdit" && editingProject && <ProjectEditPage key={`${editingProject.id}:${projectEditInitialTab}`} project={editingProject} initialTab={projectEditInitialTab} onRefresh={refresh} onDone={() => setRoute("projects")} />}
        {route === "stars" && <StarsPage project={selectedProject} />}
        {route === "archives" && <ArchivesPage project={selectedProject} />}
        {route === "characters" && <CharactersPage project={selectedProject} onOpenProfile={(id) => { setProfileCharacterId(id); setRoute("characterProfile"); }} />}
        {route === "characterProfile" && selectedProject && profileCharacterId && <CharacterProfilePage project={selectedProject} characterId={profileCharacterId} chatId={selectedChat?.id} onBack={() => setRoute("characters")} onDeleted={() => { setProfileCharacterId(undefined); setRoute("characters"); }} />}
        {route === "memories" && <MemoriesPage project={selectedProject} />}
        {route === "compaction" && selectedChat && <CompactionPage chat={selectedChat} onRefresh={refresh} />}
        {route === "settings" && <SettingsPage settings={settings} onRefresh={refresh} />}
      </main>
    </div>
  );
}

function Header({ title, subtitle, contextNote, onMenu, right, world, worldStatusOpen, onWorldToggle }: { title: string; subtitle?: string; contextNote?: string; onMenu: () => void; right?: React.ReactNode; world?: WorldState; worldStatusOpen?: boolean; onWorldToggle?: () => void }) {
  const [locationTooltipOpen, setLocationTooltipOpen] = useState(false);
  const worldTime = world && formatWorldTime(world);
  const hasReadout = Boolean(worldTime || world?.location);
  return (
    <header className="topbar-wrap">
    <div className="topbar">
      <button className="icon-button" onClick={onMenu} aria-label="Open navigation">
        <Menu size={22} />
      </button>
      <div className="brand-mini">
        <div className="title-stack"><strong>{title}</strong>{(subtitle || contextNote) && <div className="title-meta">{subtitle && <span>{subtitle}</span>}{contextNote && <small>{contextNote}</small>}</div>}</div>
      </div>
      <div className="header-right">{hasReadout && <button className="world-readout" type="button" title="Show world details" aria-expanded={worldStatusOpen} onClick={() => { if (worldStatusOpen) setLocationTooltipOpen(false); onWorldToggle?.(); }}>{worldTime && <span>{worldTime}</span>}{world?.location && <span>{world.location}</span>}</button>}{right}</div>
    </div>
    {worldStatusOpen && world && <div className="world-status-wrap"><div className="world-status">{world.location && <button className="world-status-location" type="button" aria-expanded={locationTooltipOpen} onClick={() => setLocationTooltipOpen((open) => !open)}>{world.location}</button>}{world.trackers.filter((tracker) => tracker.visibleInStatusBar).sort((a, b) => a.orderIndex - b.orderIndex).map((tracker) => <span key={tracker.id}>{formatTracker(tracker)}</span>)}</div>{locationTooltipOpen && world.location && <div className="world-location-tooltip" role="status">{world.location}</div>}</div>}
    </header>
  );
}

function InventoryDrawer({ open, project, chat, elevated, onClose, onRefresh }: { open: boolean; project: Project; chat: Chat; elevated?: boolean; onClose: () => void; onRefresh: () => Promise<void> }) {
  const [tab, setTab] = useState<"inventory" | "log">("inventory");
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [logs, setLogs] = useState<InventoryLog[]>([]);
  const [currencyAmount, setCurrencyAmount] = useState(chat.currencyAmount?.toString() ?? "");
  const [currencyAdjustment, setCurrencyAdjustment] = useState<"add" | "sub" | "edit">();
  const [equipItem, setEquipItem] = useState<InventoryItem>();
  const [saved, showSaved] = useSavedNotice();
  useEffect(() => {
    setCurrencyAmount(chat.currencyAmount?.toString() ?? "");
    setTab("inventory");
  }, [chat.id, chat.currencyAmount, project.inventoryEnabled]);
  async function load() {
    const [nextItems, nextLogs] = await Promise.all([
      db.inventoryItems.where("chatId").equals(chat.id).toArray(),
      db.inventoryLogs.where("chatId").equals(chat.id).reverse().sortBy("updatedAt")
    ]);
    setItems(nextItems.sort((a, b) => a.kind.localeCompare(b.kind) || a.createdAt - b.createdAt));
    setLogs(nextLogs);
  }
  useEffect(() => { if (open) load(); }, [open, chat.id]);
  if (!open) return null;
  const shownItems = items.filter((item) => item.kind === "inventory");
  async function persistCurrency(nextAmount: number | undefined) {
    const value = nextAmount === undefined ? undefined : Math.max(0, nextAmount);
    setCurrencyAmount(value?.toString() ?? "");
    await db.chats.update(chat.id, { currencyAmount: value, updatedAt: now() });
    showSaved();
    await onRefresh();
  }
  async function addItem(kind: InventoryKind) {
    const timestamp = now();
    await db.inventoryItems.add({ id: uid(), projectId: project.id, chatId: chat.id, kind, name: "", normalisedName: "", quantity: 1, createdAt: timestamp, updatedAt: timestamp });
    await load();
  }
  return (
    <>
      <button className={`drawer-backdrop ${elevated ? "elevated" : ""}`} onClick={onClose} aria-label="Close inventory" />
      <aside className={`inventory-drawer ${elevated ? "delta-inventory" : ""}`}>
        <div className="section-title">
          <h2>Inventory</h2>
          <button className="icon-button" onClick={onClose} aria-label="Close inventory"><X size={20} /></button>
        </div>
        <div className="settings-tabs inventory-tabs">
          {project.inventoryEnabled && <button className={tab === "inventory" ? "picked" : ""} onClick={() => setTab("inventory")}>Items</button>}
          <button className={tab === "log" ? "picked" : ""} onClick={() => setTab("log")}>Log</button>
        </div>
        {tab === "inventory" && project.inventoryEnabled && (
          <div className="stack">
            {project.currencyName && <div className="currency-row"><button type="button" className="currency-value-button" onClick={() => setCurrencyAdjustment("edit")} aria-label={`Edit ${project.currencyName}`}>{currencyAmount || "0"}</button><span>{project.currencyName}</span><button type="button" className="currency-adjust-button" onClick={() => setCurrencyAdjustment("add")}>Add</button><button type="button" className="currency-adjust-button" onClick={() => setCurrencyAdjustment("sub")}>Sub</button>{saved && <span className="save-status">Saved</span>}</div>}
            {shownItems.map((item) => <InventoryItemRow key={item.id} item={item} onRefresh={load} onEquip={() => setEquipItem(item)} />)}
            <button onClick={() => addItem("inventory")}><Plus size={18} /> Add item</button>
          </div>
        )}
        {tab === "log" && <InventoryLogList logs={logs} onRefresh={load} />}
      </aside>
      {equipItem && <EquipItemModal item={equipItem} project={project} chat={chat} onClose={() => setEquipItem(undefined)} onEquipped={async () => { setEquipItem(undefined); await load(); await onRefresh(); }} />}
      {currencyAdjustment && <CurrencyAdjustmentModal kind={currencyAdjustment} currencyName={project.currencyName ?? "currency"} currentAmount={currencyAmount} onClose={() => setCurrencyAdjustment(undefined)} onApply={async (amount) => { const next = currencyAdjustment === "edit" ? amount : Math.max(0, (Number(currencyAmount) || 0) + (currencyAdjustment === "add" ? amount : -amount)); await persistCurrency(next); setCurrencyAdjustment(undefined); }} />}
    </>
  );
}

function CurrencyAdjustmentModal({ kind, currencyName, currentAmount, onClose, onApply }: { kind: "add" | "sub" | "edit"; currencyName: string; currentAmount: string; onClose: () => void; onApply: (amount: number) => Promise<void> }) {
  const [amount, setAmount] = useState(kind === "edit" ? currentAmount : "");
  const [saving, setSaving] = useState(false);
  const verb = kind === "add" ? "Add" : kind === "sub" ? "Subtract" : "Edit";
  const numericAmount = Number(amount);
  async function apply() {
    if (!Number.isFinite(numericAmount) || numericAmount < 0) return;
    setSaving(true);
    try { await onApply(numericAmount); } finally { setSaving(false); }
  }
  return <div className="modal-backdrop inventory-confirm-backdrop" onClick={onClose}>
    <section className="confirm-modal currency-adjust-modal" onClick={(event) => event.stopPropagation()}>
      <h2>{kind === "edit" ? `Edit ${currencyName}` : `${verb} ${currencyName}`}</h2>
      {kind !== "edit" && <p>Current amount: <strong>{currentAmount || "0"}</strong></p>}
      <label>{kind === "edit" ? "New total" : "Amount"}<input autoFocus type="number" min={0} step="any" value={amount} onChange={(event) => setAmount(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void apply(); }} /></label>
      <div className="split-actions"><button className="save-button" disabled={saving || !Number.isFinite(numericAmount) || (kind !== "edit" && numericAmount <= 0)} onClick={() => void apply()}>{saving ? "Saving…" : kind === "edit" ? "Save" : verb}</button><button disabled={saving} onClick={onClose}>Cancel</button></div>
    </section>
  </div>;
}

const equipSlotChoices: { slot: GearSlotName; label: string }[] = [
  { slot: "head", label: "Head" }, { slot: "torso", label: "Torso" }, { slot: "hands", label: "Hands" }, { slot: "legs", label: "Legs" }, { slot: "feet", label: "Feet" }, { slot: "ear", label: "Ear" }, { slot: "neck", label: "Neck" }, { slot: "wrist", label: "Wrist" }, { slot: "ex1", label: "EX1" }, { slot: "ex2", label: "EX2" }, { slot: "belt", label: "Belt" }, { slot: "back", label: "Back" }
];

function EquipItemModal({ item, project, chat, onClose, onEquipped }: { item: InventoryItem; project: Project; chat: Chat; onClose: () => void; onEquipped: () => Promise<void> }) {
  const [characters, setCharacters] = useState<Character[]>([]);
  const [characterId, setCharacterId] = useState("");
  const [slot, setSlot] = useState<GearSlotName>("head");
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const selectedCharacter = characters.find((character) => character.id === characterId);
  const selectedSlot = equipSlotChoices.find((choice) => choice.slot === slot);

  useEffect(() => {
    void db.characters.where("projectId").equals(project.id).toArray().then((rows) => {
      const sorted = rows.sort((a, b) => (a.orderIndex ?? Number.MAX_SAFE_INTEGER) - (b.orderIndex ?? Number.MAX_SAFE_INTEGER) || a.normalisedName.localeCompare(b.normalisedName));
      setCharacters(sorted);
      setCharacterId(sorted.some((character) => character.id === chat.deltaPlayerCharacterId) ? chat.deltaPlayerCharacterId! : sorted[0]?.id ?? "");
    });
  }, [project.id, chat.deltaPlayerCharacterId]);

  async function equip() {
    if (!characterId || !item.name.trim()) return;
    setBusy(true);
    try {
      const timestamp = now();
      await db.transaction("rw", [db.inventoryItems, db.characterGearSlots], async () => {
        const freshItem = await db.inventoryItems.get(item.id);
        if (!freshItem || freshItem.quantity < 1) return;
        const existing = await db.characterGearSlots.where("[characterId+slot]").equals([characterId, slot]).first();
        if (existing?.itemName.trim()) await returnGearToInventory(existing, project.id, chat.id, timestamp);
        if (freshItem.quantity === 1) await db.inventoryItems.delete(freshItem.id);
        else await db.inventoryItems.update(freshItem.id, { quantity: freshItem.quantity - 1, updatedAt: timestamp });
        const gearPatch = inventoryItemAsGear(freshItem);
        if (existing) await db.characterGearSlots.update(existing.id, { ...gearPatch, updatedAt: timestamp });
        else await db.characterGearSlots.add({ id: uid(), characterId, slot, ...gearPatch, createdAt: timestamp, updatedAt: timestamp });
      });
      if (selectedCharacter) await refreshActiveDeltaCharacterStats(project, selectedCharacter);
      await onEquipped();
    } finally {
      setBusy(false);
    }
  }

  return <div className="modal-backdrop inventory-confirm-backdrop" onClick={onClose}>
    <section className="confirm-modal equip-modal" onClick={(event) => event.stopPropagation()}>
      <h2>{confirming ? "Confirm Equipment" : "Equip Item"}</h2>
      {!confirming ? <>
        <p>Choose who will wear <strong>{item.name}</strong> and where it will go.</p>
        <label>Character<select value={characterId} onChange={(event) => setCharacterId(event.target.value)}>{characters.map((character) => <option key={character.id} value={character.id}>{character.name}</option>)}</select></label>
        <label>Gear slot<select value={slot} onChange={(event) => setSlot(event.target.value as GearSlotName)}>{equipSlotChoices.map((choice) => <option key={choice.slot} value={choice.slot}>{choice.label}</option>)}</select></label>
        {!characters.length && <p className="error">Create a character before equipping an item.</p>}
        <div className="split-actions"><button className="save-button" disabled={!characterId} onClick={() => setConfirming(true)}>Continue</button><button onClick={onClose}>Cancel</button></div>
      </> : <EquipConfirmation item={item} characterId={characterId} slot={slot} slotLabel={selectedSlot?.label ?? slot} characterName={selectedCharacter?.name ?? "character"} onConfirm={equip} onBack={() => setConfirming(false)} busy={busy} />}
    </section>
  </div>;
}

function EquipConfirmation({ item, characterId, slot, slotLabel, characterName, onConfirm, onBack, busy }: { item: InventoryItem; characterId: string; slot: GearSlotName; slotLabel: string; characterName: string; onConfirm: () => Promise<void>; onBack: () => void; busy: boolean }) {
  const [current, setCurrent] = useState<CharacterGearSlot>();
  useEffect(() => { void db.characterGearSlots.where("[characterId+slot]").equals([characterId, slot]).first().then(setCurrent); }, [characterId, slot]);
  return <>
    <p>Equip <strong>{item.name}</strong> to {characterName}'s <strong>{slotLabel}</strong> slot?</p>
    {current?.itemName.trim() && <p className="equip-swap-note"><strong>{current.itemName}</strong> is currently equipped and will return to inventory.</p>}
    <div className="split-actions"><button className="save-button" disabled={busy} onClick={() => void onConfirm()}>{busy ? "Equipping…" : "Equip"}</button><button disabled={busy} onClick={onBack}>Back</button></div>
  </>;
}

function inventoryItemAsGear(item: InventoryItem): Omit<CharacterGearSlot, "id" | "characterId" | "slot" | "createdAt" | "updatedAt"> {
  return { itemName: item.name.trim(), dpBonus: item.dpBonus, apBonus: item.apBonus, hpBonus: item.hpBonus, carryWeightKg: item.unitWeightKg, combatLoadKg: item.combatLoadKg, carrySlots: item.carrySlots, carryReductionPercent: item.carryReductionPercent, statBonuses: item.statBonuses };
}

async function returnGearToInventory(gear: CharacterGearSlot, projectId: string, chatId: string, timestamp: number) {
  const normalisedName = normaliseInventoryName(gear.itemName);
  const existing = await db.inventoryItems.where("[chatId+kind+normalisedName]").equals([chatId, "inventory", normalisedName]).first();
  const patch = { name: gear.itemName, normalisedName, unitWeightKg: gear.carryWeightKg, dpBonus: gear.dpBonus, apBonus: gear.apBonus, hpBonus: gear.hpBonus, combatLoadKg: gear.combatLoadKg, carrySlots: gear.carrySlots, carryReductionPercent: gear.carryReductionPercent, statBonuses: gear.statBonuses, updatedAt: timestamp };
  if (existing) await db.inventoryItems.update(existing.id, { ...patch, quantity: existing.quantity + 1 });
  else await db.inventoryItems.add({ id: uid(), projectId, chatId, kind: "inventory", quantity: 1, ...patch, createdAt: timestamp });
}

function InventoryItemRow({ item, onRefresh, onEquip }: { item: InventoryItem; onRefresh: () => Promise<void>; onEquip: () => void }) {
  const [name, setName] = useState(item.name);
  const [quantity, setQuantity] = useState(item.quantity);
  const [unitWeightKg, setUnitWeightKg] = useState(item.unitWeightKg?.toString() ?? "");
  const [editingWeight, setEditingWeight] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [pressTimer, setPressTimer] = useState<number>();
  useEffect(() => {
    setName(item.name);
    setQuantity(item.quantity);
    setUnitWeightKg(item.unitWeightKg?.toString() ?? "");
    setEditingWeight(false);
  }, [item.id, item.name, item.quantity, item.unitWeightKg]);
  function startPress() {
    window.clearTimeout(pressTimer);
    setPressTimer(window.setTimeout(() => setDeleteOpen(true), 520));
  }
  function cancelPress() {
    window.clearTimeout(pressTimer);
  }
  async function save(nextQuantity = quantity, nextUnitWeightKg = unitWeightKg) {
    const singular = normaliseInventoryName(name);
    if (Math.max(0, nextQuantity) === 0) {
      setQuantity(0);
      setDeleteOpen(true);
      return;
    }
    const safeQuantity = Math.max(0, nextQuantity);
    const parsedWeight = Number(nextUnitWeightKg);
    const savedUnitWeightKg = Number.isFinite(parsedWeight) && parsedWeight > 0
      ? parsedWeight
      : undefined;
    await db.inventoryItems.update(item.id, { name: singular, normalisedName: singular, quantity: safeQuantity, unitWeightKg: savedUnitWeightKg, updatedAt: now() });
    await onRefresh();
  }
  async function changeQuantity(nextQuantity: number) {
    const next = Math.max(0, nextQuantity);
    setQuantity(next);
    await save(next);
  }
  async function remove() {
    await db.inventoryItems.delete(item.id);
    setDeleteOpen(false);
    await onRefresh();
  }
  return (
    <div className="inventory-item-wrap">
      <div className="inventory-row">
        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          onBlur={() => save()}
          onPointerDown={startPress}
          onPointerUp={cancelPress}
          onPointerLeave={cancelPress}
          placeholder={item.kind === "gear" ? "gear name" : "item name"}
        />
        <button onClick={() => void changeQuantity(quantity - 1)}>-</button>
        <input type="number" value={quantity} onChange={(event) => setQuantity(Number(event.target.value))} onBlur={() => void changeQuantity(quantity)} />
        <button onClick={() => void changeQuantity(quantity + 1)}>+</button>
        {editingWeight ? <input className="inventory-unit-weight-input" autoFocus type="number" min={0.01} step={0.01} value={unitWeightKg} onChange={(event) => setUnitWeightKg(event.target.value)} onBlur={() => { setEditingWeight(false); void save(); }} aria-label={`${name || "item"} unit weight in kilograms`} /> : <button type="button" className="inventory-unit-weight" onClick={() => setEditingWeight(true)} aria-label={`Edit ${name || "item"} unit weight`}>{unitWeightKg ? `${formatInventoryKg(Number(unitWeightKg))} kg` : "— kg"}</button>}
        <button type="button" className="inventory-equip-button" disabled={!item.name.trim() || item.quantity < 1} onClick={onEquip}>Equip</button>
      </div>
      {deleteOpen && (
        <div className="modal-backdrop inventory-confirm-backdrop" onClick={() => { setDeleteOpen(false); if (quantity === 0) setQuantity(item.quantity || 1); }}>
          <section className="confirm-modal inventory-confirm-modal" onClick={(event) => event.stopPropagation()}>
            <h2>Delete Item</h2>
            <p>{quantity === 0 ? "Quantity is 0. Delete this item?" : `Delete ${name || "this item"}?`}</p>
            <div className="split-actions">
              <button className="danger" onClick={remove}>Delete</button>
              <button onClick={() => { setDeleteOpen(false); if (quantity === 0) setQuantity(item.quantity || 1); }}>Cancel</button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

function InventoryLogList({ logs, onRefresh }: { logs: InventoryLog[]; onRefresh: () => Promise<void> }) {
  const [activeLogId, setActiveLogId] = useState<string>();
  const [editLogId, setEditLogId] = useState<string>();
  const [deleteLogId, setDeleteLogId] = useState<string>();
  const [draft, setDraft] = useState("");
  const [pressTimer, setPressTimer] = useState<number>();
  async function remove(id: string) {
    await db.inventoryLogs.delete(id);
    setActiveLogId(undefined);
    setDeleteLogId(undefined);
    await onRefresh();
  }
  async function save(id: string) {
    await db.inventoryLogs.update(id, { sentence: draft, updatedAt: now() });
    setEditLogId(undefined);
    setActiveLogId(undefined);
    await onRefresh();
  }
  return (
    <div className="stack">
      {logs.length === 0 && <p className="muted-pad">No inventory changes logged yet.</p>}
      {logs.map((log) => (
        <section
          className="inventory-log"
          key={log.id}
          onPointerDown={() => setPressTimer(window.setTimeout(() => setActiveLogId(log.id), 520))}
          onPointerUp={() => { if (pressTimer) window.clearTimeout(pressTimer); }}
          onContextMenu={(event) => { event.preventDefault(); setActiveLogId(log.id); }}
        >
          {editLogId === log.id ? <input value={draft} onChange={(event) => setDraft(event.target.value)} /> : <p>{log.sentence}</p>}
          {activeLogId === log.id && <div className="context-menu"><button onClick={() => { setDraft(log.sentence); setEditLogId(log.id); }}>Edit</button><button className="danger" onClick={() => setDeleteLogId(log.id)}>Delete</button></div>}
          {editLogId === log.id && <button onClick={() => save(log.id)}><Save size={16} /> Save</button>}
        </section>
      ))}
      {deleteLogId && (
        <div className="modal-backdrop inventory-confirm-backdrop" onClick={() => setDeleteLogId(undefined)}>
          <section className="confirm-modal inventory-confirm-modal" onClick={(event) => event.stopPropagation()}>
            <h2>Delete Log Entry</h2>
            <p>Delete this inventory log entry?</p>
            <div className="split-actions">
              <button className="danger" onClick={() => remove(deleteLogId)}>Delete</button>
              <button onClick={() => setDeleteLogId(undefined)}>Cancel</button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

function Drawer(props: {
  open: boolean;
  projects: Project[];
  selectedProjectId?: string;
  chats: Chat[];
  selectedChatId?: string;
  onClose: () => void;
  onRoute: (route: RouteName) => void;
  onProject: (id: string) => void;
  onChat: (id: string) => void;
  onRenameChat: (id: string) => Promise<void>;
  onDeleteChat: (id: string) => Promise<void>;
  onToggleProjectPin: (id: string) => Promise<void>;
  onToggleChatPin: (id: string) => Promise<void>;
}) {
  const [showAllProjects, setShowAllProjects] = useState(false);
  const [activeChatId, setActiveChatId] = useState<string>();
  const [activeProjectId, setActiveProjectId] = useState<string>();
  const pressTimer = useRef<number>();
  const longPressedItem = useRef<string>();
  const orderedProjects = [...props.projects].sort((a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)) || a.orderIndex - b.orderIndex);
  const visibleProjects = showAllProjects ? orderedProjects : orderedProjects.slice(0, 3);
  const hiddenProjectCount = Math.max(0, orderedProjects.length - 3);
  const selectedProject = props.projects.find((project) => project.id === props.selectedProjectId);
  const orderedChats = [...props.chats].sort((a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)) || b.updatedAt - a.updatedAt);

  function clearPressTimer() {
    if (pressTimer.current) window.clearTimeout(pressTimer.current);
    pressTimer.current = undefined;
  }

  function beginPress(itemId: string, onLongPress: () => void) {
    clearPressTimer();
    pressTimer.current = window.setTimeout(() => {
      longPressedItem.current = itemId;
      onLongPress();
    }, 520);
  }

  function runClick(itemId: string, action: () => void) {
    if (longPressedItem.current === itemId) {
      longPressedItem.current = undefined;
      return;
    }
    action();
  }
  return (
    <>
      {props.open && <button className="drawer-backdrop" onClick={props.onClose} aria-label="Close navigation" />}
      <aside className={`drawer ${props.open ? "open" : ""}`} aria-hidden={!props.open}>
        <div className="drawer-head">
          <MothMark />
          <div>
            <strong>Mirror 2.0</strong>
            <span>local-first workspace</span>
          </div>
          <button className="icon-button" onClick={props.onClose} aria-label="Close navigation">
            <X size={20} />
          </button>
        </div>
        <DrawerSection title="Projects">
          {visibleProjects.map((project) => (
            <div className="nav-project" key={project.id}>
              <button
                className={`nav-row ${project.id === props.selectedProjectId ? "active" : ""}`}
                onClick={() => runClick(`project:${project.id}`, () => props.onProject(project.id))}
                onPointerDown={() => beginPress(`project:${project.id}`, () => setActiveProjectId(project.id))}
                onPointerUp={clearPressTimer}
                onPointerLeave={clearPressTimer}
                onPointerCancel={clearPressTimer}
                onContextMenu={(event) => { event.preventDefault(); setActiveProjectId(project.id); }}
              >
                <ProjectIcon name={project.iconName} color={project.iconColor} /> <span>{project.name}</span>{project.pinned && <Pin className="nav-pin" size={13} fill="currentColor" aria-label="Pinned" />}
              </button>
              {activeProjectId === project.id && <div className="row-context-menu"><button onClick={async () => { await props.onToggleProjectPin(project.id); setActiveProjectId(undefined); }}><Pin size={15} /> {project.pinned ? "Unpin" : "Pin"}</button><button onClick={() => setActiveProjectId(undefined)}><X size={15} /> Close</button></div>}
            </div>
          ))}
          {hiddenProjectCount > 0 && <div className="drawer-project-more-row"><button className="drawer-expand-link" onClick={() => setShowAllProjects((current) => !current)}>{showAllProjects ? "Show fewer projects" : `… and ${hiddenProjectCount} other project${hiddenProjectCount === 1 ? "" : "s"}`}</button><button className="icon-button drawer-manage-button" onClick={() => props.onRoute("projects")} aria-label="Manage projects" title="Manage projects"><Settings size={15} /></button></div>}
        </DrawerSection>
        {selectedProject ? (
          <DrawerSection title="Selected project">
            <div className="selected-project-row"><div className="selected-project-display"><ProjectIcon name={selectedProject.iconName} color={selectedProject.iconColor} /> <span>{selectedProject.name}</span></div><button className="icon-button" onClick={() => props.onRoute("projectEdit")} aria-label={`Open ${selectedProject.name} settings`} title="Project settings"><Settings size={18} /></button></div>
            <div className="drawer-project-tools">
            {(["stars", "characters", "archives", "memories"] as RouteName[]).map((route) => (
              <button className="nav-row" key={route} onClick={() => props.onRoute(route)}>
                {routeIcon(route)} {routeLabels[route]}
              </button>
            ))}
            </div>
          </DrawerSection>
        ) : (
          <p className="muted-pad">Choose a project before starting a chat.</p>
        )}
        <DrawerSection title="Chats">
          {props.chats.length === 0 && <p className="muted-pad">No chats yet.</p>}
          {orderedChats.map((chat) => (
            <div className="nav-chat" key={chat.id}>
              <button
                className={`nav-row ${chat.id === props.selectedChatId ? "active" : ""}`}
                onClick={() => runClick(`chat:${chat.id}`, () => props.onChat(chat.id))}
                onPointerDown={() => beginPress(`chat:${chat.id}`, () => setActiveChatId(chat.id))}
                onPointerUp={clearPressTimer}
                onPointerLeave={clearPressTimer}
                onPointerCancel={clearPressTimer}
                onContextMenu={(event) => {
                  event.preventDefault();
                  setActiveChatId(chat.id);
                }}
              >
                <MessageSquare size={18} /> <span>{chat.title}</span>{chat.pinned && <Pin className="nav-pin" size={13} fill="currentColor" aria-label="Pinned" />}
              </button>
              {activeChatId === chat.id && (
                <div className="row-context-menu">
                  <button onClick={async () => { await props.onToggleChatPin(chat.id); setActiveChatId(undefined); }}><Pin size={15} /> {chat.pinned ? "Unpin" : "Pin"}</button>
                  <button onClick={async () => { await props.onRenameChat(chat.id); setActiveChatId(undefined); }}><Edit3 size={15} /> Rename</button>
                  <button className="danger" onClick={async () => { await props.onDeleteChat(chat.id); setActiveChatId(undefined); }}><Trash2 size={15} /> Delete</button>
                  <button onClick={() => setActiveChatId(undefined)}><X size={15} /> Close</button>
                </div>
              )}
            </div>
          ))}
        </DrawerSection>
        <div className="drawer-foot">
          <button className="nav-row" onClick={() => props.onRoute("settings")}>
            <Settings size={18} /> App Settings
          </button>
        </div>
      </aside>
    </>
  );
}

function DrawerSection({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);
  return (
    <section className="drawer-section">
      <div className="section-title"><button className="drawer-section-toggle" onClick={() => setCollapsed((current) => !current)} aria-expanded={!collapsed}><h2>{title}</h2><ChevronRight className={collapsed ? "" : "expanded"} size={15} /></button>{action}</div>
      {!collapsed && children}
    </section>
  );
}

function routeIcon(route: RouteName) {
  const icons: Partial<Record<RouteName, JSX.Element>> = {
    stars: <Star size={18} />,
    characters: <UserRound size={18} />,
    archives: <Archive size={18} />,
    memories: <BookOpen size={18} />,
    projects: <Archive size={18} />,
    projectEdit: <Settings size={18} />
  };
  return icons[route] ?? <MessageSquare size={18} />;
}

function ProjectsPage({ projects, selectedProjectId, onSelect, onEdit, onRefresh }: { projects: Project[]; selectedProjectId?: string; onSelect: (id: string) => void; onEdit: (id: string) => void; onRefresh: () => Promise<void> }) {
  const [draftName, setDraftName] = useState("");
  const [draggedProjectId, setDraggedProjectId] = useState<string>();
  const [dropProjectId, setDropProjectId] = useState<string>();
  const [refreshing, setRefreshing] = useState(false);

  async function refreshProjects() {
    setRefreshing(true);
    try {
      await onRefresh();
    } finally {
      setRefreshing(false);
    }
  }

  async function reorderProjects(draggedId: string, targetId: string) {
    if (draggedId === targetId) return;
    const next = [...projects];
    const from = next.findIndex((project) => project.id === draggedId);
    const to = next.findIndex((project) => project.id === targetId);
    if (from < 0 || to < 0) return;
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    const timestamp = now();
    await db.transaction("rw", db.projects, async () => {
      await Promise.all(next.map((project, orderIndex) => db.projects.update(project.id, { orderIndex, updatedAt: timestamp })));
    });
    await onRefresh();
  }

  async function add() {
    const project = await createProject(draftName.trim() || "Untitled Project");
    setDraftName("");
    onSelect(project.id);
    await onRefresh();
  }
  return (
    <Page>
      <div className="form-row">
        <input value={draftName} onChange={(event) => setDraftName(event.target.value)} placeholder="New project name" />
        <button onClick={add}><Plus size={18} /> Add</button>
        <button className="icon-button" onClick={refreshProjects} disabled={refreshing} aria-label="Refresh projects" title="Refresh projects without changing any data"><RefreshCw size={17} className={refreshing ? "spin" : ""} /></button>
      </div>
      {projects.map((project) => (
        <ProjectCard key={project.id} project={project} active={project.id === selectedProjectId} onSelect={onSelect} onEdit={onEdit} onRefresh={onRefresh} dragging={draggedProjectId === project.id} dropTarget={dropProjectId === project.id && draggedProjectId !== project.id} onDragStart={(projectId) => {
          setDraggedProjectId(projectId);
          setDropProjectId(undefined);
        }} onDragOver={setDropProjectId} onDrop={async (draggedId, targetId) => {
          setDraggedProjectId(undefined);
          setDropProjectId(undefined);
          if (draggedId && targetId) await reorderProjects(draggedId, targetId);
        }} onDragEnd={() => {
          setDraggedProjectId(undefined);
          setDropProjectId(undefined);
        }} />
      ))}
    </Page>
  );
}

function ProjectCard({ project, active, onSelect, onEdit, onRefresh, dragging, dropTarget, onDragStart, onDragOver, onDrop, onDragEnd }: { project: Project; active: boolean; onSelect: (id: string) => void; onEdit: (id: string) => void; onRefresh: () => Promise<void>; dragging: boolean; dropTarget: boolean; onDragStart: (id: string) => void; onDragOver: (id: string) => void; onDrop: (draggedId: string, targetId: string) => void; onDragEnd: () => void }) {
  function beginDrag(event: React.DragEvent<HTMLButtonElement>) {
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", project.id);
    onDragStart(project.id);
  }

  function allowDrop(event: React.DragEvent<HTMLElement>) {
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    if (project.id !== event.dataTransfer.getData("text/plain")) onDragOver(project.id);
  }

  function drop(event: React.DragEvent<HTMLElement>) {
    event.preventDefault();
    const draggedId = event.dataTransfer.getData("text/plain");
    if (draggedId) onDrop(draggedId, project.id);
  }

  async function remove() {
    const count = await db.messages.where("chatId").anyOf((await db.chats.where("projectId").equals(project.id).primaryKeys()) as string[]).count();
    const ok = count > 0 ? prompt(`Deleting this project removes chats, messages, stars, archives, characters, and memories. Type DELETE ${project.name} to continue.`) === `DELETE ${project.name}` : confirm("Delete this project and its associated records?");
    if (!ok) return;
    await deleteProject(project.id);
    await onRefresh();
  }
  return (
    <section className={`item-card project-card ${active ? "selected" : ""} ${dragging ? "dragging" : ""} ${dropTarget ? "drop-target" : ""}`} onDragEnter={allowDrop} onDragOver={allowDrop} onDrop={drop}>
      <button className="project-drag-handle" draggable onDragStart={beginDrag} onDragEnd={onDragEnd} aria-label={`Drag ${project.name} to reorder`} title="Drag to reorder"><GripVertical size={20} /></button>
      <button className="item-main" onClick={() => onSelect(project.id)}>
        <ProjectIcon name={project.iconName} color={project.iconColor} size={22} />
        <span>{project.name}</span>
      </button>
      <div className="card-actions">
        <button onClick={() => onEdit(project.id)}><Edit3 size={18} /> Edit</button>
        <button className="danger" onClick={remove}><Trash2 size={18} /> Delete</button>
      </div>
    </section>
  );
}

function ProjectEditPage({ project, initialTab = "general", onRefresh, onDone }: { project: Project; initialTab?: "general" | "delta"; onRefresh: () => Promise<void>; onDone: () => void }) {
  const [draft, setDraft] = useState(project);
  const [tab, setTab] = useState<"general" | "delta">(initialTab);
  const [deltaTab, setDeltaTab] = useState<"system" | "values" | "prefix" | "base" | "job" | "effects">("system");
  const [deltaStats, setDeltaStats] = useState<AbilityScores>(cleanAbilityScores(project.deltaDefaultNpcStats));
  const [deltaPrefixes, setDeltaPrefixes] = useState<DeltaPrefixTemplate[]>(effectiveDeltaPrefixes(project.deltaPrefixes));
  const [deltaBases, setDeltaBases] = useState<DeltaBaseTemplate[]>(deltaBaseDraft(project.deltaBases));
  const [deltaJobs, setDeltaJobs] = useState<DeltaJobTemplate[]>(project.deltaJobs ?? defaultDeltaJobs());
  const [deltaSystemPrompt, setDeltaSystemPrompt] = useState(effectiveDeltaSystemPrompt(project.deltaSystemPrompt));
  const [deltaRevealText, setDeltaRevealText] = useState(project.deltaRevealText ?? true);
  const [deltaRevealSpeed, setDeltaRevealSpeed] = useState(project.deltaRevealSpeed ?? 5);
  const [showIconPicker, setShowIconPicker] = useState(false);
  const [editingProjectName, setEditingProjectName] = useState(false);
  const [saved, showSaved] = useSavedNotice();
  const [deltaSaved, showDeltaSaved] = useSavedNotice();
  useEffect(() => {
    setDraft(project);
    setDeltaStats(cleanAbilityScores(project.deltaDefaultNpcStats));
    setDeltaPrefixes(effectiveDeltaPrefixes(project.deltaPrefixes));
    setDeltaBases(deltaBaseDraft(project.deltaBases));
    setDeltaJobs(project.deltaJobs ?? defaultDeltaJobs());
    setDeltaSystemPrompt(effectiveDeltaSystemPrompt(project.deltaSystemPrompt));
    setDeltaRevealText(project.deltaRevealText ?? true);
    setDeltaRevealSpeed(project.deltaRevealSpeed ?? 5);
    setEditingProjectName(false);
  }, [project.id]);
  async function save() {
    const nextDraft = { ...draft, deltaEnabled: Boolean(draft.deltaEnabled && draft.inventoryEnabled && draft.gearEnabled) };
    await db.projects.put({ ...nextDraft, updatedAt: now() });
    setDraft(nextDraft);
    showSaved();
    await onRefresh();
  }
  async function saveDeltaPatch(patch: Partial<Pick<Project, "deltaDefaultNpcStats" | "deltaPrefixes" | "deltaBases" | "deltaJobs" | "deltaSystemPrompt" | "deltaRevealText" | "deltaRevealSpeed">>) {
    await db.projects.update(project.id, { ...patch, updatedAt: now() });
    showDeltaSaved();
    await onRefresh();
  }
  async function revertDeltaSystemPrompt() {
    setDeltaSystemPrompt(defaultDeltaSystemPrompt);
    await saveDeltaPatch({ deltaSystemPrompt: defaultDeltaSystemPrompt });
  }
  return (
    <Page>
      <div className="settings-tabs">
        <button className={tab === "general" ? "picked" : ""} onClick={() => setTab("general")}><Folder size={18} /> General</button>
        <button className={tab === "delta" ? "picked" : ""} onClick={() => setTab("delta")}><Swords size={18} /> Delta</button>
      </div>
      {tab === "general" && (
      <section className="item-card stack">
        <div className="project-identity-editor">
          <button className="project-icon-edit" onClick={() => setShowIconPicker(true)} aria-label="Change project icon" title="Change project icon"><ProjectIcon name={draft.iconName} color={draft.iconColor} size={36} /></button>
          {editingProjectName ? (
            <input className="project-name-input" autoFocus value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} onBlur={() => setEditingProjectName(false)} onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }} aria-label="Project name" />
          ) : (
            <button className="project-name-edit" onClick={() => setEditingProjectName(true)} title="Rename project">{draft.name || "Untitled project"}</button>
          )}
        </div>
        {showIconPicker && (
          <div className="modal-backdrop project-icon-picker-backdrop" onClick={() => setShowIconPicker(false)}>
            <section className="project-icon-picker" role="dialog" aria-modal="true" aria-label="Choose project icon" onClick={(event) => event.stopPropagation()}>
              <div className="section-title"><h2>Choose an icon</h2><button className="icon-button" onClick={() => setShowIconPicker(false)} aria-label="Close icon picker"><X size={18} /></button></div>
              <div className="icon-grid project-icon-grid">
              {projectIcons.map(({ name, label }) => (
                  <button key={name} className={draft.iconName === name ? "picked" : ""} onClick={() => { setDraft({ ...draft, iconName: name }); setShowIconPicker(false); }} aria-label={label} title={label}>
                  <ProjectIcon name={name} color={draft.iconColor} />
                </button>
              ))}
              </div>
              <div className="project-icon-colors"><span>Colour</span><ColorSwatches value={draft.iconColor} onChange={(iconColor) => setDraft({ ...draft, iconColor })} /></div>
            </section>
          </div>
        )}
        <div className="inventory-setting-row"><label className="compact-check"><input type="checkbox" checked={draft.inventoryEnabled} onChange={(event) => setDraft({ ...draft, inventoryEnabled: event.target.checked })} /> Enable inventory</label>{draft.inventoryEnabled && <label className="inventory-currency-name">Currency name<input value={draft.currencyName ?? ""} onChange={(event) => setDraft({ ...draft, currencyName: event.target.value })} placeholder="currency name" /></label>}</div>
        <label className="compact-check"><input type="checkbox" checked={draft.gearEnabled} onChange={(event) => setDraft({ ...draft, gearEnabled: event.target.checked })} /> Enable gear</label>
        <div className="delta-mode-setting-row"><label className="compact-check"><input type="checkbox" checked={Boolean(draft.deltaEnabled && draft.inventoryEnabled && draft.gearEnabled)} disabled={!draft.inventoryEnabled || !draft.gearEnabled} onChange={(event) => setDraft({ ...draft, deltaEnabled: event.target.checked })} /> Enable Delta Mode</label>{(!draft.inventoryEnabled || !draft.gearEnabled) && <small>Requires inventory and gear enabled</small>}</div>
        <textarea value={draft.instructions} onChange={(event) => setDraft({ ...draft, instructions: event.target.value })} placeholder="Project Instructions" />
        <textarea value={draft.worldSetting} onChange={(event) => setDraft({ ...draft, worldSetting: event.target.value })} placeholder="World Setting" />
        <label>Memory mode <select value={draft.memoryMode} onChange={(event) => setDraft({ ...draft, memoryMode: event.target.value as Project["memoryMode"] })}><option value="manual">Manual</option><option value="automatic">Automatic</option><option value="approval">Automatic with Approval</option></select></label>
        <textarea value={draft.memoryInstruction} onChange={(event) => setDraft({ ...draft, memoryInstruction: event.target.value })} />
        <SourceFilesSection project={project} />
        <div className="split-actions persistent-actions"><button onClick={save}><Save size={18} /> Save</button><button className="done-button" onClick={onDone}>Done</button>{saved && <span className="save-status">Saved</span>}</div>
      </section>
      )}
      {tab === "delta" && (
        <>
        <div className="delta-settings-subtabs" role="tablist" aria-label="Project Delta settings sections">
          <button className={deltaTab === "system" ? "picked" : ""} onClick={() => setDeltaTab("system")}>SYSTEM</button>
          <button className={deltaTab === "values" ? "picked" : ""} onClick={() => setDeltaTab("values")}>VALUES</button>
          <button className={deltaTab === "prefix" ? "picked" : ""} onClick={() => setDeltaTab("prefix")}>PREFIX</button>
          <button className={deltaTab === "base" ? "picked" : ""} onClick={() => setDeltaTab("base")}>BASE</button>
          <button className={deltaTab === "job" ? "picked" : ""} onClick={() => setDeltaTab("job")}>JOB</button>
          <button className={deltaTab === "effects" ? "picked" : ""} onClick={() => setDeltaTab("effects")}>EFFECTS</button>
        </div>
        <div className="stack delta-settings-editor">
          {deltaTab === "system" && (
          <section className="panel stack">
            <div className="section-title"><h2>System Prompt</h2></div>
            <p className="notice">This is the full Delta Mode system prompt for this project. Revert restores Mirror's default Delta behavior.</p>
            <p className="delta-prompt-warning">Warning: Only change this prompt if you know what you are doing.</p>
            <textarea className="large-entry" value={deltaSystemPrompt} onChange={(event) => setDeltaSystemPrompt(event.target.value)} />
            <div className="delta-stream-setting-row">
              <label className="compact-check"><input type="checkbox" checked={deltaRevealText} onChange={(event) => setDeltaRevealText(event.target.checked)} /> Stream text</label>
              {deltaRevealText && <label className="delta-stream-speed"><span>Speed <b>{deltaRevealSpeed}</b></span><input type="range" min={1} max={10} step={1} value={deltaRevealSpeed} onChange={(event) => setDeltaRevealSpeed(Number(event.target.value))} /></label>}
            </div>
            <div className="split-actions persistent-actions">
              <button onClick={() => saveDeltaPatch({ deltaSystemPrompt: deltaSystemPrompt.trim() || defaultDeltaSystemPrompt, deltaRevealText, deltaRevealSpeed })}><Save size={18} /> Save SYSTEM</button>
              <button onClick={revertDeltaSystemPrompt}>Revert to default</button>
              {deltaSaved && <span className="save-status">Saved</span>}
              <button className="delta-settings-done done-button" onClick={onDone}>Done</button>
            </div>
          </section>
          )}

          {deltaTab === "values" && (
          <section className="panel stack">
            <div className="section-title"><h2>Default NPC Values</h2></div>
            <p className="notice">Starting stats for generated Delta characters that do not have saved character stats.</p>
            <AbilityScoreEditor value={deltaStats} onChange={setDeltaStats} />
            <div className="split-actions persistent-actions"><button onClick={() => saveDeltaPatch({ deltaDefaultNpcStats: cleanAbilityScores(deltaStats) })}><Save size={18} /> Save Default NPC Values</button>{deltaSaved && <span className="save-status">Saved</span>}<button className="delta-settings-done done-button" onClick={onDone}>Done</button></div>
          </section>
          )}

          {deltaTab === "prefix" && (
          <section className="panel stack">
            <div className="section-title"><h2>PREFIXES</h2></div>
            <p className="notice">PREFIX templates are the first part of [PREFIX]-[BASE] [JOB].</p>
            <DeltaPrefixEditor value={deltaPrefixes} onChange={setDeltaPrefixes} />
            <div className="split-actions persistent-actions">
              <button onClick={() => setDeltaPrefixes([...deltaPrefixes, { id: uid(), label: "", statModifiers: {} }])}><Plus size={18} /> Add PREFIX</button>
              <button onClick={() => saveDeltaPatch({ deltaPrefixes: cleanDeltaPrefixes(deltaPrefixes) })}><Save size={18} /> Save PREFIXES</button>
              {deltaSaved && <span className="save-status">Saved</span>}
              <button className="delta-settings-done done-button" onClick={onDone}>Done</button>
            </div>
          </section>
          )}

          {deltaTab === "base" && (
          <section className="panel stack">
            <div className="section-title"><h2>BASES</h2></div>
            <p className="notice">BASE templates are modifiers applied on top of Default NPC Values, not full repeated stat blocks.</p>
            <DeltaBaseEditor value={deltaBases} onChange={setDeltaBases} />
            <div className="split-actions persistent-actions">
              <button onClick={() => setDeltaBases([...deltaBases, { id: uid(), label: "", statModifiers: {} }])}><Plus size={18} /> Add BASE</button>
              <button onClick={() => saveDeltaPatch({ deltaBases: cleanDeltaBases(deltaBases) })}><Save size={18} /> Save BASES</button>
              {deltaSaved && <span className="save-status">Saved</span>}
              <button className="delta-settings-done done-button" onClick={onDone}>Done</button>
            </div>
          </section>
          )}

          {deltaTab === "job" && (
          <section className="panel stack">
            <div className="section-title"><h2>JOBS</h2></div>
            <div className="notice delta-job-help">
              <p>Each .txt filename becomes its JOB category. Each non-empty line must be JOB STR DEX CON INT WIS CHA.</p>
              <small>Use dashes instead of spaces in filenames, for example street-lowlife.txt.</small>
            </div>
            <DeltaJobImport value={deltaJobs} onChange={setDeltaJobs} />
            <div className="split-actions persistent-actions"><button onClick={() => saveDeltaPatch({ deltaJobs: cleanDeltaJobs(deltaJobs) })}><Save size={18} /> Save JOBS</button>{deltaSaved && <span className="save-status">Saved</span>}<button className="delta-settings-done done-button" onClick={onDone}>Done</button></div>
          </section>
          )}

          {deltaTab === "effects" && <DeltaEffectsEditor project={project} onDone={onDone} />}
        </div>
        </>
      )}
    </Page>
  );
}

function newDeltaEffect(projectId: string, polarity: DeltaEffectPolarity): DeltaEffectDefinition {
  const timestamp = now();
  return {
    id: uid(),
    projectId,
    name: "",
    polarity,
    turns: undefined,
    effectText: "",
    curable: false,
    cureText: "",
    cureEndBehavior: "remove",
    ko: false,
    koText: "",
    koEndBehavior: "remove",
    targetSelf: true,
    targetOthers: false,
    targetAllies: true,
    targetNeutral: true,
    targetEnemies: true,
    targetMode: "single",
    maxTargets: undefined,
    savingThrowEnabled: false,
    savingThrowStat: undefined,
    savingThrowMinimum: undefined,
    savingThrowTiming: "inflict",
    cancelledByStatus: false,
    cancellationPolarity: "negative",
    cancelledByEffectIds: [],
    createdAt: timestamp,
    updatedAt: timestamp
  };
}

const savingThrowTimingHelp: Record<DeltaSavingThrowTiming, string> = {
  inflict: "Attempt saving throw when effect is inflicted.",
  "turn-start": "Attempt saving throw at start of user's turn.",
  "turn-end": "Attempt saving throw at end of user's turn.",
  "every-turn": "Attempt saving throw at start of every turn, regardless of whose turn it is."
};

function DeltaEffectsEditor({ project, onDone }: { project: Project; onDone: () => void }) {
  const [effects, setEffects] = useState<DeltaEffectDefinition[]>([]);
  const [icons, setIcons] = useState<DeltaIconAsset[]>([]);
  const [editing, setEditing] = useState<DeltaEffectDefinition>();
  const [iconLibraryOpen, setIconLibraryOpen] = useState(false);
  const [deleteEffect, setDeleteEffect] = useState<DeltaEffectDefinition>();
  const [saved, showSaved] = useSavedNotice();

  async function load() {
    const [effectRows, iconRows] = await Promise.all([
      db.deltaEffects.where("projectId").equals(project.id).sortBy("createdAt"),
      db.deltaIcons.where("projectId").equals(project.id).sortBy("name")
    ]);
    setEffects(effectRows);
    setIcons(iconRows);
  }

  useEffect(() => { void load(); }, [project.id]);

  function saveDraftEffect() {
    if (!editing?.name.trim()) return;
    const cleaned = { ...editing, name: editing.name.trim(), updatedAt: now() };
    setEffects((current) => current.some((effect) => effect.id === cleaned.id)
      ? current.map((effect) => effect.id === cleaned.id ? cleaned : effect)
      : [...current, cleaned]);
    setEditing(undefined);
  }

  async function saveEffects() {
    await db.transaction("rw", db.deltaEffects, async () => {
      await db.deltaEffects.where("projectId").equals(project.id).delete();
      if (effects.length) await db.deltaEffects.bulkPut(effects.map((effect) => ({ ...effect, projectId: project.id, updatedAt: now() })));
    });
    showSaved();
  }

  function confirmDeleteEffect() {
    if (!deleteEffect) return;
    setEffects((current) => current.filter((effect) => effect.id !== deleteEffect.id));
    setDeleteEffect(undefined);
  }

  const iconFor = (id?: string) => icons.find((icon) => icon.id === id);
  const renderGroup = (polarity: DeltaEffectPolarity, title: string) => {
    const rows = effects.filter((effect) => effect.polarity === polarity);
    return (
      <section className="delta-effect-group">
        <div className="section-title"><h3>{title}</h3><button className="icon-button" onClick={() => setEditing(newDeltaEffect(project.id, polarity))} aria-label={`Add ${title.toLowerCase()} effect`} title={`Add ${title.toLowerCase()} effect`}><Plus size={16} /></button></div>
        {rows.length === 0 && <p className="delta-effect-empty">No effects configured.</p>}
        {rows.map((effect) => {
          const icon = iconFor(effect.iconId);
          return (
            <div className="delta-effect-row" key={effect.id}>
              <span className="delta-effect-row-icon">{icon ? <img src={icon.dataUrl} alt="" /> : <span />}</span>
              <strong>{effect.name}</strong>
              <small>{effect.effectText || "No effect text"}</small>
              <button className="icon-button" onClick={() => setEditing({ ...effect, cancelledByEffectIds: [...effect.cancelledByEffectIds] })} aria-label={`Edit ${effect.name}`}><Pencil size={15} /></button>
              <button className="icon-button danger-icon" onClick={() => setDeleteEffect(effect)} aria-label={`Delete ${effect.name}`}><Trash2 size={15} /></button>
            </div>
          );
        })}
      </section>
    );
  };

  return (
    <section className="panel stack delta-effects-page">
      <div className="section-title"><h2>Effects</h2><button onClick={() => setIconLibraryOpen(true)}><ImageIcon size={16} /> Icon library</button></div>
      <p className="notice">Create reusable buffs and debuffs for this project's Delta system. Runtime effect application will plug into these definitions later.</p>
      {renderGroup("positive", "Positive (buffs)")}
      {renderGroup("negative", "Negative (debuffs)")}
      <div className="split-actions persistent-actions"><button onClick={saveEffects}><Save size={18} /> Save EFFECTS</button>{saved && <span className="save-status">Saved</span>}<button className="delta-settings-done done-button" onClick={onDone}>Done</button></div>

      {editing && (
        <div className="modal-backdrop delta-effect-modal-backdrop" onClick={() => setEditing(undefined)}>
          <section className="delta-effect-modal" onClick={(event) => event.stopPropagation()}>
            <div className="section-title"><h2>{effects.some((effect) => effect.id === editing.id) ? "Edit effect" : "Add effect"}</h2><button className="icon-button" onClick={() => setEditing(undefined)} aria-label="Close"><X size={18} /></button></div>
            <div className="delta-effect-name-row">
              <button className="delta-effect-icon-pick" onClick={() => setIconLibraryOpen(true)} aria-label="Choose effect icon">
                {iconFor(editing.iconId) ? <img src={iconFor(editing.iconId)?.dataUrl} alt="" /> : <ImageIcon size={20} />}
              </button>
              <label>Name<input value={editing.name} onChange={(event) => setEditing({ ...editing, name: event.target.value })} placeholder="Effect name" /></label>
              <label>Turns<input type="number" min={0} value={editing.turns ?? ""} onChange={(event) => setEditing({ ...editing, turns: event.target.value === "" ? undefined : Math.max(0, Number(event.target.value)) })} /></label>
            </div>
            <label>Effect<textarea value={editing.effectText} onChange={(event) => setEditing({ ...editing, effectText: event.target.value })} placeholder="What this effect does" /></label>

            <div className="delta-effect-pair">
              <section>
                <label className="compact-check"><input type="checkbox" checked={editing.curable} onChange={(event) => setEditing({ ...editing, curable: event.target.checked })} /> Curable</label>
                {editing.curable && <><label>Cure<input value={editing.cureText} onChange={(event) => setEditing({ ...editing, cureText: event.target.value })} placeholder="How this effect is cured" /></label><label>Cure on engagement end<select value={editing.cureEndBehavior} onChange={(event) => setEditing({ ...editing, cureEndBehavior: event.target.value as DeltaEffectDefinition["cureEndBehavior"] })}><option value="remove">Completely</option><option value="retain">Retain until expiry</option></select></label></>}
              </section>
              <section>
                <label className="compact-check"><input type="checkbox" checked={editing.ko} onChange={(event) => setEditing({ ...editing, ko: event.target.checked })} /> KO</label>
                {editing.ko && <><label>KO behavior<input value={editing.koText} onChange={(event) => setEditing({ ...editing, koText: event.target.value })} placeholder="What causes KO" /></label><label>Remove KO on engagement end<select value={editing.koEndBehavior} onChange={(event) => setEditing({ ...editing, koEndBehavior: event.target.value as DeltaEffectDefinition["koEndBehavior"] })}><option value="remove">Completely</option><option value="retain">Retain until expiry</option></select></label></>}
              </section>
            </div>

            <fieldset className="delta-effect-fieldset"><legend>Targeting behavior</legend>
              <div className="delta-effect-check-row"><label><input type="checkbox" checked={editing.targetSelf} onChange={(event) => setEditing({ ...editing, targetSelf: event.target.checked })} /> Self</label><label><input type="checkbox" checked={editing.targetOthers} onChange={(event) => setEditing({ ...editing, targetOthers: event.target.checked })} /> Others</label></div>
              <div className="delta-effect-check-row"><label><input type="checkbox" checked={editing.targetAllies} onChange={(event) => setEditing({ ...editing, targetAllies: event.target.checked })} /> Allies</label><label><input type="checkbox" checked={editing.targetNeutral} onChange={(event) => setEditing({ ...editing, targetNeutral: event.target.checked })} /> Neutral</label><label><input type="checkbox" checked={editing.targetEnemies} onChange={(event) => setEditing({ ...editing, targetEnemies: event.target.checked })} /> Enemy</label></div>
              <div className="delta-effect-check-row"><label><input type="radio" name="target-mode" checked={editing.targetMode === "single"} onChange={() => setEditing({ ...editing, targetMode: "single", maxTargets: undefined })} /> Single</label><label><input type="radio" name="target-mode" checked={editing.targetMode === "multiple"} onChange={() => setEditing({ ...editing, targetMode: "multiple" })} /> Multiple</label>{editing.targetMode === "multiple" && <label>Max targets<input type="number" min={1} value={editing.maxTargets ?? ""} onChange={(event) => setEditing({ ...editing, maxTargets: event.target.value === "" ? undefined : Math.max(1, Number(event.target.value)) })} /></label>}</div>
            </fieldset>

            <fieldset className="delta-effect-fieldset"><legend>Saving throw</legend>
              <label className="compact-check"><input type="checkbox" checked={editing.savingThrowEnabled} onChange={(event) => setEditing({ ...editing, savingThrowEnabled: event.target.checked })} /> Enable saving throw</label>
              {editing.savingThrowEnabled && <>
                <div className="delta-effect-inline-fields"><label>Stat<select value={editing.savingThrowStat ?? ""} onChange={(event) => setEditing({ ...editing, savingThrowStat: event.target.value as Ability })}><option value="" disabled>Select</option>{abilities.map((ability) => <option key={ability} value={ability}>{ability}</option>)}</select></label><label>Minimum<input type="number" value={editing.savingThrowMinimum ?? ""} onChange={(event) => setEditing({ ...editing, savingThrowMinimum: event.target.value === "" ? undefined : Number(event.target.value) })} /></label></div>
                <strong className="delta-effect-subheading">Initiate saving throw on:</strong>
                <div className="delta-effect-timing">
                  {(["inflict", "turn-start", "turn-end", "every-turn"] as DeltaSavingThrowTiming[]).map((timing) => <label key={timing}><input type="radio" name="saving-timing" checked={editing.savingThrowTiming === timing} onChange={() => setEditing({ ...editing, savingThrowTiming: timing })} /> {timing === "inflict" ? "INFLICT" : timing === "turn-start" ? "TURN START" : timing === "turn-end" ? "TURN END" : "EVERY TURN"}</label>)}
                </div>
                <p className="delta-effect-helper">{savingThrowTimingHelp[editing.savingThrowTiming]}</p>
              </>}
            </fieldset>

            <fieldset className="delta-effect-fieldset"><legend>Cancelled by status</legend>
              <label className="compact-check"><input type="checkbox" checked={editing.cancelledByStatus} onChange={(event) => setEditing({ ...editing, cancelledByStatus: event.target.checked })} /> Enable status cancellation</label>
              {editing.cancelledByStatus && <>
                <div className="delta-effect-check-row"><label><input type="radio" name="cancel-polarity" checked={editing.cancellationPolarity === "positive"} onChange={() => setEditing({ ...editing, cancellationPolarity: "positive", cancelledByEffectIds: [] })} /> Positive</label><label><input type="radio" name="cancel-polarity" checked={editing.cancellationPolarity === "negative"} onChange={() => setEditing({ ...editing, cancellationPolarity: "negative", cancelledByEffectIds: [] })} /> Negative</label></div>
                <div className="delta-effect-cancel-list">{effects.filter((effect) => effect.id !== editing.id && effect.polarity === editing.cancellationPolarity).map((effect) => <label key={effect.id}><input type="checkbox" checked={editing.cancelledByEffectIds.includes(effect.id)} onChange={(event) => setEditing({ ...editing, cancelledByEffectIds: event.target.checked ? [...editing.cancelledByEffectIds, effect.id] : editing.cancelledByEffectIds.filter((id) => id !== effect.id) })} /> {effect.name}</label>)}{!effects.some((effect) => effect.id !== editing.id && effect.polarity === editing.cancellationPolarity) && <small>No matching effects yet.</small>}</div>
              </>}
            </fieldset>
            <div className="split-actions"><button onClick={saveDraftEffect} disabled={!editing.name.trim()}><Save size={17} /> Save effect</button><button onClick={() => setEditing(undefined)}>Cancel</button></div>
          </section>
        </div>
      )}

      {iconLibraryOpen && <DeltaIconLibrary projectId={project.id} icons={icons} onIconsChange={(nextIcons) => { setIcons(nextIcons); setEffects((current) => current.map((effect) => effect.iconId && !nextIcons.some((icon) => icon.id === effect.iconId) ? { ...effect, iconId: undefined } : effect)); }} onSelect={editing ? (icon) => { setEditing({ ...editing, iconId: icon.id }); setIconLibraryOpen(false); } : undefined} onClose={() => setIconLibraryOpen(false)} />}
      {deleteEffect && <div className="modal-backdrop" onClick={() => setDeleteEffect(undefined)}><section className="confirm-modal" onClick={(event) => event.stopPropagation()}><h2>Delete effect?</h2><p>{deleteEffect.name} will be removed when you save EFFECTS.</p><div className="split-actions"><button className="danger" onClick={confirmDeleteEffect}>Delete</button><button onClick={() => setDeleteEffect(undefined)}>Cancel</button></div></section></div>}
    </section>
  );
}

async function fitGeneratedIcon(dataUrl: string) {
  const image = new Image();
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error("The generated image could not be opened."));
    image.src = dataUrl;
  });
  const source = document.createElement("canvas");
  source.width = image.naturalWidth;
  source.height = image.naturalHeight;
  const sourceContext = source.getContext("2d", { willReadFrequently: true });
  if (!sourceContext) throw new Error("Canvas is unavailable in this browser.");
  sourceContext.drawImage(image, 0, 0);
  const pixels = sourceContext.getImageData(0, 0, source.width, source.height).data;
  const samplePoints = [[0, 0], [source.width - 1, 0], [0, source.height - 1], [source.width - 1, source.height - 1]];
  const background = samplePoints.reduce((total, [x, y]) => {
    const index = (y * source.width + x) * 4;
    return [total[0] + pixels[index], total[1] + pixels[index + 1], total[2] + pixels[index + 2]];
  }, [0, 0, 0]).map((value) => value / samplePoints.length);
  let left = source.width;
  let top = source.height;
  let right = -1;
  let bottom = -1;
  for (let y = 0; y < source.height; y += 1) {
    for (let x = 0; x < source.width; x += 1) {
      const index = (y * source.width + x) * 4;
      const difference = Math.abs(pixels[index] - background[0]) + Math.abs(pixels[index + 1] - background[1]) + Math.abs(pixels[index + 2] - background[2]);
      if (pixels[index + 3] > 20 && difference > 78) {
        left = Math.min(left, x);
        top = Math.min(top, y);
        right = Math.max(right, x);
        bottom = Math.max(bottom, y);
      }
    }
  }
  const hasSubject = right >= left && bottom >= top;
  const subjectWidth = hasSubject ? right - left + 1 : source.width;
  const subjectHeight = hasSubject ? bottom - top + 1 : source.height;
  const paddedSide = Math.min(Math.max(source.width, source.height), Math.max(1, Math.ceil(Math.max(subjectWidth, subjectHeight) * 1.16)));
  const centerX = hasSubject ? (left + right + 1) / 2 : source.width / 2;
  const centerY = hasSubject ? (top + bottom + 1) / 2 : source.height / 2;
  const sourceX = Math.max(0, Math.min(source.width - paddedSide, Math.round(centerX - paddedSide / 2)));
  const sourceY = Math.max(0, Math.min(source.height - paddedSide, Math.round(centerY - paddedSide / 2)));
  const canvas = document.createElement("canvas");
  canvas.width = 32;
  canvas.height = 32;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas is unavailable in this browser.");
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(image, sourceX, sourceY, paddedSide, paddedSide, 0, 0, 32, 32);
  return canvas.toDataURL("image/png");
}

function DeltaIconLibrary({ projectId, icons, onIconsChange, onSelect, onClose }: { projectId: string; icons: DeltaIconAsset[]; onIconsChange: (icons: DeltaIconAsset[]) => void; onSelect?: (icon: DeltaIconAsset) => void; onClose: () => void }) {
  const [editing, setEditing] = useState<DeltaIconAsset>();
  const [creating, setCreating] = useState(false);
  const [deleteIcon, setDeleteIcon] = useState<DeltaIconAsset>();
  const [recentIcons, setRecentIcons] = useState<string[]>([]);

  async function saveIcon(icon: DeltaIconAsset) {
    await db.deltaIcons.put(icon);
    onIconsChange([...icons.filter((item) => item.id !== icon.id), icon].sort((a, b) => a.name.localeCompare(b.name)));
    setEditing(undefined);
    setCreating(false);
  }

  async function confirmDelete() {
    if (!deleteIcon) return;
    await db.transaction("rw", [db.deltaIcons, db.deltaEffects], async () => {
      await db.deltaIcons.delete(deleteIcon.id);
      await db.deltaEffects.where("projectId").equals(projectId).filter((effect) => effect.iconId === deleteIcon.id).modify({ iconId: undefined });
    });
    onIconsChange(icons.filter((icon) => icon.id !== deleteIcon.id));
    setDeleteIcon(undefined);
  }

  return (
    <div className="modal-backdrop delta-icon-library-backdrop" onClick={onClose}>
      <section className="delta-icon-library" onClick={(event) => event.stopPropagation()}>
        <div className="section-title"><div><h2>Icon library</h2><p className="delta-icon-library-description">Reusable icons for this project’s effects.</p></div><button className="icon-button" onClick={onClose} aria-label="Close"><X size={18} /></button></div>
        <div className="delta-icon-grid">
          {icons.map((icon) => <div className="delta-icon-cell" key={icon.id}><button onClick={() => onSelect ? onSelect(icon) : setEditing(icon)} title={onSelect ? `Use ${icon.name}` : `Edit ${icon.name}`}><img src={icon.dataUrl} alt="" /><span>{icon.name}</span></button><button className="icon-button" onClick={() => setEditing(icon)} aria-label={`Edit ${icon.name}`}><Pencil size={14} /></button><button className="icon-button danger-icon" onClick={() => setDeleteIcon(icon)} aria-label={`Delete ${icon.name}`}><Trash2 size={14} /></button></div>)}
          {icons.length === 0 && <p className="delta-effect-empty">No saved icons.</p>}
        </div>
        <button className="delta-icon-library-create" onClick={() => setCreating(true)}><Zap size={17} /> Create icon with FLUX</button>
      </section>
      {(creating || editing) && <DeltaIconEditor projectId={projectId} icon={editing} recentIcons={recentIcons} onGenerated={(dataUrl) => setRecentIcons((current) => [dataUrl, ...current.filter((item) => item !== dataUrl)].slice(0, 3))} onSave={saveIcon} onClose={() => { setCreating(false); setEditing(undefined); }} />}
      {deleteIcon && <div className="modal-backdrop nested-confirm" onClick={() => setDeleteIcon(undefined)}><section className="confirm-modal" onClick={(event) => event.stopPropagation()}><h2>Delete icon?</h2><p>The saved icon will be removed from this project. Effects using it will keep their other settings.</p><div className="split-actions"><button className="danger" onClick={confirmDelete}>Delete</button><button onClick={() => setDeleteIcon(undefined)}>Cancel</button></div></section></div>}
    </div>
  );
}

function DeltaIconEditor({ projectId, icon, recentIcons, onGenerated, onSave, onClose }: { projectId: string; icon?: DeltaIconAsset; recentIcons: string[]; onGenerated: (dataUrl: string) => void; onSave: (icon: DeltaIconAsset) => Promise<void>; onClose: () => void }) {
  const fallbackModel = "black-forest-labs/flux.2-klein-4b";
  const [models, setModels] = useState<{ id: string; name: string }[]>([{ id: fallbackModel, name: "FLUX.2 Klein 4B (budget)" }]);
  const [model, setModel] = useState(icon?.sourceModel ?? fallbackModel);
  const [prompt, setPrompt] = useState(icon?.sourcePrompt ?? "");
  const [name, setName] = useState(icon?.name ?? "");
  const [selectedCandidate, setSelectedCandidate] = useState(icon?.dataUrl ?? "");
  const [status, setStatus] = useState("");
  const [generating, setGenerating] = useState(false);

  useEffect(() => {
    void (async () => {
      const settings = await db.settings.get("settings");
      if (!settings?.apiKey?.trim()) return;
      try {
        const response = await fetch("https://openrouter.ai/api/v1/images/models", { headers: { Authorization: `Bearer ${settings.apiKey.trim()}` } });
        if (!response.ok) return;
        const json = await response.json() as { data?: { id: string; name?: string }[] };
        const rows = (json.data ?? []).map((row) => ({ id: row.id, name: row.name ?? row.id }));
        if (rows.length) setModels(rows);
      } catch {
        // Keep the known budget model available when discovery is offline.
      }
    })();
  }, []);

  async function generate() {
    if (!prompt.trim()) return;
    const settings = await db.settings.get("settings");
    if (!settings?.apiKey?.trim()) { setStatus("Save an OpenRouter API key in API Settings first."); return; }
    setGenerating(true);
    setStatus("Generating icon...");
    try {
      const iconPrompt = `Create one isolated small game status icon: ${prompt.trim()}. The icon itself must fill 82-90% of the square canvas, with only a thin 5-8% margin. Crop tightly around the symbol. Use a simple high-contrast silhouette that remains clear at 32x32 pixels. No words, letters, numbers, captions, frames, borders, UI, or extra objects. Plain dark neutral background.`;
      const response = await fetch("https://openrouter.ai/api/v1/images", {
        method: "POST",
        headers: { Authorization: `Bearer ${settings.apiKey.trim()}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model, prompt: iconPrompt, n: 1, aspect_ratio: "1:1", output_format: "png" })
      });
      if (!response.ok) throw new Error((await response.text()) || `Image request failed (${response.status}).`);
      const json = await response.json() as { data?: { b64_json?: string; media_type?: string }[] };
      const image = json.data?.[0];
      if (!image?.b64_json) throw new Error("The image model returned no image.");
      const fitted = await fitGeneratedIcon(`data:${image.media_type ?? "image/png"};base64,${image.b64_json}`);
      onGenerated(fitted);
      setSelectedCandidate(fitted);
      setStatus("Added to the temporary recent-icons tray.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Icon generation failed.");
    } finally {
      setGenerating(false);
    }
  }

  async function save() {
    if (!selectedCandidate || !name.trim()) return;
    const timestamp = now();
    await onSave({ id: icon?.id ?? uid(), projectId, name: name.trim(), dataUrl: selectedCandidate, sourceModel: model, sourcePrompt: prompt.trim(), createdAt: icon?.createdAt ?? timestamp, updatedAt: timestamp });
  }

  const availableIcons = [...new Set([...(icon ? [icon.dataUrl] : []), ...recentIcons])];

  return (
    <div className="modal-backdrop delta-icon-editor-backdrop" onClick={onClose}>
      <section className="delta-icon-editor" onClick={(event) => event.stopPropagation()}>
        <div className="section-title"><div><h2>{icon ? "Edit icon" : "Create icon with FLUX"}</h2><p className="delta-icon-library-description">Describe one clear symbol; it will be prepared for use at 32 × 32 pixels.</p></div><button className="icon-button" onClick={onClose} aria-label="Close"><X size={18} /></button></div>
        <label>Model<select value={model} onChange={(event) => setModel(event.target.value)}>{models.map((row) => <option value={row.id} key={row.id}>{row.name}</option>)}</select></label>
        <label>Prompt<textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder="Describe one simple status icon" /></label>
        <button onClick={generate} disabled={generating || !prompt.trim()}>{generating ? "Thinking..." : "Generate icon"}</button>
        {status && <p className="save-status">{status}</p>}
        <div className="delta-icon-candidates">{availableIcons.length > 0 && <small>Temporary recent icons</small>}<div>{availableIcons.map((candidate, index) => <button className={selectedCandidate === candidate ? "picked" : ""} key={`${candidate.slice(-20)}-${index}`} onClick={() => setSelectedCandidate(candidate)}><img src={candidate} alt={`Recent generated icon ${index + 1}`} /></button>)}</div>{selectedCandidate && <div className="delta-icon-actual-preview"><span>Actual size</span><img src={selectedCandidate} alt="Selected icon at actual size" /></div>}</div>
        <label>Name icon<input value={name} onChange={(event) => setName(event.target.value)} placeholder="Icon name" /></label>
        <div className="split-actions"><button onClick={save} disabled={!selectedCandidate || !name.trim()}><Save size={17} /> Save icon</button><button onClick={onClose}>Cancel</button></div>
      </section>
    </div>
  );
}

function AbilityScoreEditor({ value, onChange }: { value: AbilityScores; onChange: (value: AbilityScores) => void }) {
  return (
    <div className="ability-grid">
      {abilities.map((ability) => (
        <label key={ability}>{ability}<input type="number" value={value[ability]} onChange={(event) => onChange({ ...value, [ability]: Number(event.target.value) })} /></label>
      ))}
    </div>
  );
}

function AbilityModifierEditor({ value, onChange }: { value: AbilityModifiers; onChange: (value: AbilityModifiers) => void }) {
  return (
    <div className="ability-grid compact">
      {abilities.map((ability) => (
        <label key={ability}>{ability}<input type="number" value={value[ability] ?? 0} onChange={(event) => onChange({ ...value, [ability]: Number(event.target.value) })} /></label>
      ))}
    </div>
  );
}

function DeltaPrefixEditor({ value, onChange }: { value: DeltaPrefixTemplate[]; onChange: (value: DeltaPrefixTemplate[]) => void }) {
  function update(index: number, patch: Partial<DeltaPrefixTemplate>) {
    onChange(value.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item));
  }
  return (
    <div className="delta-template-list">
      {value.length === 0 && <p className="notice">No PREFIX templates are set up for this project.</p>}
      {value.map((item, index) => (
        <section className="delta-template-row" key={item.id || index}>
          <div className="form-row delta-template-fields delta-prefix-fields">
            <label>ID<input value={item.id} onChange={(event) => update(index, { id: event.target.value })} /></label>
            <label>Label<input value={item.label} onChange={(event) => update(index, { label: event.target.value.toUpperCase() })} placeholder="PREFIX" /></label>
            <button className="icon-button delta-template-delete" onClick={() => onChange(value.filter((_, itemIndex) => itemIndex !== index))} aria-label={`Delete ${item.label || "PREFIX"}`} title="Delete PREFIX"><Trash2 size={15} /></button>
          </div>
          <AbilityModifierEditor value={item.statModifiers} onChange={(statModifiers) => update(index, { statModifiers })} />
        </section>
      ))}
    </div>
  );
}

function DeltaBaseEditor({ value, onChange }: { value: DeltaBaseTemplate[]; onChange: (value: DeltaBaseTemplate[]) => void }) {
  function update(index: number, patch: Partial<DeltaBaseTemplate>) {
    onChange(value.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item));
  }
  return (
    <div className="delta-template-list">
      {value.length === 0 && <p className="notice">No BASE templates are set up for this project.</p>}
      {value.map((item, index) => (
        <section className="delta-template-row" key={item.id || index}>
          <div className="form-row delta-template-fields delta-base-fields">
            <label>ID<input value={item.id} onChange={(event) => update(index, { id: event.target.value })} /></label>
            <label>Label<input value={item.label} onChange={(event) => update(index, { label: event.target.value.toUpperCase() })} placeholder="BASE" /></label>
            <label>HP bonus<input type="number" value={item.hpBonus ?? 0} onChange={(event) => update(index, { hpBonus: Number(event.target.value) })} /></label>
            <label>Carry kg / STR<input type="number" min={0.1} step={0.1} value={item.carryKgPerStr ?? 6.8} onChange={(event) => update(index, { carryKgPerStr: Number(event.target.value) })} /></label>
            <label>Combat load %<input type="number" min={1} max={100} step={1} value={item.combatLoadPercent ?? 50} onChange={(event) => update(index, { combatLoadPercent: Number(event.target.value) })} /></label>
            <button className="icon-button delta-template-delete" onClick={() => onChange(value.filter((_, itemIndex) => itemIndex !== index))} aria-label={`Delete ${item.label || "BASE"}`} title="Delete BASE"><Trash2 size={15} /></button>
          </div>
          <AbilityModifierEditor value={item.statModifiers} onChange={(statModifiers) => update(index, { statModifiers })} />
        </section>
      ))}
    </div>
  );
}

function DeltaJobImport({ value, onChange }: { value: DeltaJobTemplate[]; onChange: (value: DeltaJobTemplate[]) => void }) {
  const [errors, setErrors] = useState<string[]>([]);
  async function importFiles(files: FileList | null) {
    const parsed = await parseJobFiles(files);
    setErrors(parsed.errors);
    if (parsed.errors.length) return;
    const replacing = new Set(parsed.categories);
    onChange([...value.filter((job) => !replacing.has(job.category)), ...parsed.jobs]);
  }
  function deleteCategory(category: string) {
    if (!confirm(`Delete JOB category "${category}" from this draft?`)) return;
    onChange(value.filter((job) => job.category !== category));
  }
  function downloadCategory(category: string) {
    const rows = value
      .filter((job) => job.category.trim() === category)
      .map((job) => `${job.label.trim()} ${abilities.map((ability) => Number(job.statModifiers[ability] ?? 0)).join(" ")}`);
    const blob = new Blob([`${rows.join("\n")}\n`], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${category.replace(/[<>:"/\\|?*\x00-\x1f]/g, "-") || "jobs"}.txt`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  }
  const categories = jobCategories(value);
  return (
    <div className="delta-template-list delta-job-import">
      <label className="file-pick"><Upload size={18} /> Import JOB .txt files<input type="file" accept=".txt,text/plain" multiple onChange={(event) => void importFiles(event.target.files)} /></label>
      {errors.length > 0 && (
        <div className="import-errors">
          {errors.map((error) => <p key={error}>{error}</p>)}
        </div>
      )}
      {categories.length === 0 && <p className="notice">No JOB categories are set up for this project.</p>}
      {categories.map(([category, count]) => (
        <section className="delta-category-row" key={category}>
          <button className="icon-button delta-category-download" onClick={() => downloadCategory(category)} aria-label={`Download ${category} category`} title={`Download ${category}.txt`}><Download size={15} /></button>
          <span>{category}</span>
          <small>{count} JOB{count === 1 ? "" : "S"}</small>
          <button className="icon-button delta-category-delete" onClick={() => deleteCategory(category)} aria-label={`Delete ${category} category`} title={`Delete ${category} category`}><Trash2 size={15} /></button>
        </section>
      ))}
    </div>
  );
}

function SettingsPage({ settings, onRefresh }: { settings: AppSettings; onRefresh: () => Promise<void> }) {
  const [draft, setDraft] = useState(settings);
  const [tab, setTab] = useState<"appearance" | "api" | "data">("appearance");
  const [saved, showSaved] = useSavedNotice();
  useEffect(() => setDraft(settings), [settings]);
  async function save() {
    const { sidebarSize: _legacySidebarSize, ...cleanDraft } = draft as AppSettings & { sidebarSize?: unknown };
    await db.settings.put({ ...cleanDraft, updatedAt: now() });
    showSaved();
    await onRefresh();
  }
  return (
    <Page>
      <div className="settings-tabs">
        <button className={tab === "appearance" ? "picked" : ""} onClick={() => setTab("appearance")}><Settings size={18} /> Look</button>
        <button className={tab === "api" ? "picked" : ""} onClick={() => setTab("api")}><KeyRound size={18} /> API</button>
        <button className={tab === "data" ? "picked" : ""} onClick={() => setTab("data")}><Database size={18} /> Data</button>
      </div>
      {tab === "appearance" && (
        <div className="settings-compact">
          <label className="settings-field">Theme
            <select value={draft.theme} onChange={(event) => setDraft({ ...draft, theme: event.target.value as AppSettings["theme"] })}>
              <option value="onyx">Onyx</option>
              <option value="ivory">Ivory</option>
              <option value="blue">Blue</option>
              <option value="green">Green</option>
            </select>
          </label>
          <div className="settings-field settings-field-wide">
            <span>Accent</span>
            <div className="swatches settings-accent-swatches">{accents.map((accent) => <button key={accent.name} className={draft.accent === accent.name ? "picked" : ""} style={{ background: accent.value }} aria-label={`${accent.name} accent${draft.accent === accent.name ? " (selected)" : ""}`} aria-pressed={draft.accent === accent.name} onClick={() => setDraft({ ...draft, accent: accent.name })} />)}</div>
          </div>
          <label className="settings-field">Font
            <select value={draft.font} onChange={(event) => setDraft({ ...draft, font: event.target.value as AppSettings["font"] })}>
              <option value="system">System</option>
              <option value="inter">Inter</option>
              <option value="lora">Lora</option>
              <option value="nunito">Nunito</option>
            </select>
          </label>
          <label className="settings-field settings-field-wide">Font size: {fontSizeLabel(draft.fontScale ?? 16)} ({draft.fontScale ?? 16}px)
            <input type="range" min={12} max={24} step={1} value={draft.fontScale ?? 16} onChange={(event) => setDraft({ ...draft, fontScale: Number(event.target.value) })} />
          </label>
          <div className="font-preview" data-preview-font={draft.font} style={{ fontSize: draft.fontScale }}>Jaeger opened the archive and found the thread of the story still intact.</div>
          <InlineSegment label="Bubbles" value={draft.bubbleMode} options={["bubbles", "minimal"]} labels={{ bubbles: "Bubbles", minimal: "Minimal" }} onChange={(bubbleMode) => setDraft({ ...draft, bubbleMode })} />
          <InlineSegment label="Scope" value={draft.bubbleScope} options={["global", "project"]} labels={{ global: "Global", project: "Project" }} onChange={(bubbleScope) => setDraft({ ...draft, bubbleScope })} />
          <SettingsSlider label="Sidebar spacing" value={normaliseSidebarSpacing(draft.sidebarSpacing ?? (draft as AppSettings & { sidebarSize?: unknown }).sidebarSize)} options={sidebarSpacingOptions} unit="px" onChange={(sidebarSpacing) => setDraft({ ...draft, sidebarSpacing })} />
          <SettingsSlider label="Sidebar width" value={normaliseSidebarWidth(draft.sidebarWidth)} options={sidebarWidthOptions} unit="px" onChange={(sidebarWidth) => setDraft({ ...draft, sidebarWidth })} />
          <label className="settings-field">Entry width {draft.entryWidth}%<input type="range" min={60} max={100} value={draft.entryWidth} onChange={(event) => setDraft({ ...draft, entryWidth: Number(event.target.value) })} /></label>
          <label className="settings-field">Message spacing {draft.messageSpacing}px<input type="range" min={4} max={28} value={draft.messageSpacing} onChange={(event) => setDraft({ ...draft, messageSpacing: Number(event.target.value) })} /></label>
          <label className="settings-field">Paragraph spacing {draft.paragraphSpacing ?? 4}px<input type="range" min={0} max={18} value={draft.paragraphSpacing ?? 4} onChange={(event) => setDraft({ ...draft, paragraphSpacing: Number(event.target.value) })} /></label>
          <div className="split-actions persistent-actions"><button onClick={save}><Save size={18} /> Save settings</button>{saved && <span className="save-status">Saved</span>}</div>
        </div>
      )}
      {tab === "api" && <ApiSettingsContent settings={settings} onRefresh={onRefresh} />}
      {tab === "data" && <DataSettingsContent />}
    </Page>
  );
}

function ApiSettingsContent({ settings, onRefresh }: { settings: AppSettings; onRefresh: () => Promise<void> }) {
  const [key, setKey] = useState(settings.apiKey ?? "");
  const [show, setShow] = useState(false);
  const [saved, showSaved] = useSavedNotice();
  async function save() {
    await db.settings.update("settings", { apiKey: key, updatedAt: now() });
    showSaved();
    await onRefresh();
  }
  async function remove() {
    if (!confirm("Remove the saved OpenRouter API key from this browser?")) return;
    setKey("");
    await db.settings.update("settings", { apiKey: undefined, updatedAt: now() });
    await onRefresh();
  }
  return (
    <>
      <p className="notice">This static app stores the key in this browser only. Browser-only storage cannot protect a key as strongly as a private server.</p>
      <label>OpenRouter API key<div className="input-with-action"><input type={show ? "text" : "password"} value={key} onChange={(event) => setKey(event.target.value)} placeholder="sk-or-..." /><button type="button" className="icon-button" onClick={() => setShow(!show)} aria-label={show ? "Hide API key" : "Show API key"} title={show ? "Hide API key" : "Show API key"}><Eye size={18} /></button></div></label>
      <div className="split-actions persistent-actions"><button onClick={save}><Save size={18} /> Save</button><button className="danger" onClick={remove}>Remove</button>{saved && <span className="save-status">Saved</span>}</div>
      <label>Privacy preset<select value={settings.privacyPreset} onChange={async (event) => { await db.settings.update("settings", { privacyPreset: event.target.value as AppSettings["privacyPreset"], updatedAt: now() }); await onRefresh(); }}><option value="maximum">Maximum Privacy</option><option value="balanced">Balanced</option><option value="availability">Maximum Availability</option></select></label>
      <ModelLibrary onRefresh={onRefresh} />
    </>
  );
}

function ModelLibrary({ onRefresh }: { onRefresh: () => Promise<void> }) {
  const [models, setModels] = useState<ModelLibraryEntry[]>([]);
  const [fetchedModels, setFetchedModels] = useState<{ id: string; name?: string; context_length?: number; supported_parameters?: string[]; pricing?: { prompt?: string; completion?: string } }[]>([]);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");
  const [editingNameId, setEditingNameId] = useState<string>();
  const [draftName, setDraftName] = useState("");
  const [savingName, setSavingName] = useState(false);
  const [nameError, setNameError] = useState("");
  async function saveName(model: ModelLibraryEntry) {
    if (savingName) return;
    const cosmeticName = draftName.trim();
    if (!cosmeticName) { setNameError("Enter a model name."); return; }
    setSavingName(true);
    setNameError("");
    try {
      const updated = await db.modelLibrary.update(model.id, { cosmeticName, updatedAt: now() });
      if (!updated) throw new Error("Model no longer exists.");
      await load();
      await onRefresh();
      setEditingNameId(undefined);
    } catch {
      setNameError("Couldn't save the model name. Please try again.");
    } finally {
      setSavingName(false);
    }
  }
  async function load() { setModels(await db.modelLibrary.orderBy("orderIndex").toArray()); }
  useEffect(() => { load(); }, []);
  async function fetchModels() {
    setStatus("Fetching models...");
    try {
      const response = await fetch("https://openrouter.ai/api/v1/models");
      if (!response.ok) throw new Error("Could not fetch models.");
      const json = await response.json() as { data?: { id: string; name?: string; context_length?: number; supported_parameters?: string[]; pricing?: { prompt?: string; completion?: string } }[] };
      setFetchedModels(json.data ?? []);
      setStatus(`Fetched ${(json.data ?? []).length} models`);
    } catch {
      setStatus("Model fetch failed. Check connection and try again.");
    }
  }
  function perMillion(value?: string) {
    const perToken = Number(value);
    return Number.isFinite(perToken) && perToken >= 0 ? perToken * 1_000_000 : undefined;
  }
  async function addOrUpdateModel(model: typeof fetchedModels[number]) {
    if (!model.id.trim()) return;
    const timestamp = now();
    const inputPricePerMillionUsd = perMillion(model.pricing?.prompt);
    const outputPricePerMillionUsd = perMillion(model.pricing?.completion);
    const existing = models.find((item) => item.modelId === model.id);
    const supportsTools = model.supported_parameters?.includes("tools");
    if (existing) await db.modelLibrary.update(existing.id, { contextLength: model.context_length, supportsTools, inputPricePerMillionUsd, outputPricePerMillionUsd, updatedAt: timestamp });
    else await db.modelLibrary.add({ id: uid(), modelId: model.id, cosmeticName: model.name || model.id.split("/").pop() || model.id, contextLength: model.context_length, supportsTools, inputPricePerMillionUsd, outputPricePerMillionUsd, orderIndex: models.length, createdAt: timestamp, updatedAt: timestamp });
    await load();
    await onRefresh();
  }
  async function updatePrice(model: ModelLibraryEntry, field: "inputPricePerMillionUsd" | "outputPricePerMillionUsd", value: string) {
    const parsed = value.trim() === "" ? undefined : Number(value);
    if (parsed !== undefined && (!Number.isFinite(parsed) || parsed < 0)) return;
    await db.modelLibrary.update(model.id, { [field]: parsed, updatedAt: now() });
    await load();
    await onRefresh();
  }
  const filtered = fetchedModels.filter((model) => `${model.id} ${model.name ?? ""}`.toLowerCase().includes(query.toLowerCase())).slice(0, 40);
  return (
    <section className="panel">
      <h2>Custom Model Library</h2>
      <button onClick={fetchModels}><Download size={18} /> Fetch OpenRouter models</button>
      {status && <p className="save-status">{status}</p>}
      <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Filter fetched models" />
      {filtered.length > 0 && <div className="model-results">{filtered.map((model) => { const saved = models.some((item) => item.modelId === model.id); return <button key={model.id} onClick={() => void addOrUpdateModel(model)}>{saved ? <RefreshCw size={16} /> : <Plus size={16} />}<span>{model.name ?? model.id}</span><small>{model.id}{model.pricing?.prompt !== undefined && model.pricing?.completion !== undefined ? ` · $${perMillion(model.pricing.prompt)?.toFixed(2)}/M in · $${perMillion(model.pricing.completion)?.toFixed(2)}/M out` : ""}</small></button>; })}</div>}
      {models.map((model) => <div className="model-library-row" key={model.id}><div>
        {editingNameId === model.id ? <form className="model-name-editor" onSubmit={(event) => { event.preventDefault(); void saveName(model); }}>
          <input autoFocus aria-label="Cosmetic model name" value={draftName} disabled={savingName} onFocus={(event) => event.target.select()} onChange={(event) => setDraftName(event.target.value)} onKeyDown={(event) => { if (event.key === "Escape" && !savingName) { event.preventDefault(); setEditingNameId(undefined); } }} />
          <div className="split-actions"><button type="submit" disabled={savingName}>{savingName ? "Saving?" : "Save"}</button><button type="button" disabled={savingName} onClick={() => setEditingNameId(undefined)}>Cancel</button></div>
          {nameError && <span role="alert">{nameError}</span>}
        </form> : <button type="button" className="model-name-button" title="Edit cosmetic model name" disabled={savingName} onClick={() => { setEditingNameId(model.id); setDraftName(model.cosmeticName); setNameError(""); }}>{model.cosmeticName || model.modelId}</button>}
        <small>{model.modelId}</small>
      </div><label>Input USD / 1M<input type="number" min={0} step="any" defaultValue={model.inputPricePerMillionUsd ?? ""} placeholder="not set" onBlur={(event) => void updatePrice(model, "inputPricePerMillionUsd", event.target.value)} /></label><label>Output USD / 1M<input type="number" min={0} step="any" defaultValue={model.outputPricePerMillionUsd ?? ""} placeholder="not set" onBlur={(event) => void updatePrice(model, "outputPricePerMillionUsd", event.target.value)} /></label><button className="danger" onClick={async () => { await db.modelLibrary.delete(model.id); await load(); }}><Trash2 size={16} /> Remove</button></div>)}
    </section>
  );
}

function MemoriesPage({ project }: { project?: Project }) {
  const [memories, setMemories] = useState<Memory[]>([]);
  const [pendingMemories, setPendingMemories] = useState<PendingMemory[]>([]);
  const [text, setText] = useState("");
  const [tags, setTags] = useState("");
  const [query, setQuery] = useState("");
  async function load() {
    if (project) {
      setMemories(await db.memories.where("projectId").equals(project.id).reverse().sortBy("updatedAt"));
      setPendingMemories(await db.pendingMemories.where("projectId").equals(project.id).reverse().sortBy("updatedAt"));
    }
  }
  useEffect(() => { load(); }, [project?.id]);
  if (!project) return <EmptyState title="No project selected" body="Choose a project to manage memories." />;
  const projectId = project.id;
  async function add() {
    if (!text.trim()) return;
    await createMemory(projectId, text.trim(), splitTags(tags));
    setText(""); setTags(""); await load();
  }
  async function runSearch() {
    const found = await searchMemories(projectId, splitTags(query), query);
    setMemories(await db.memories.bulkGet(found.map((item) => item.id)).then((rows) => rows.filter(Boolean) as Memory[]));
  }
  return (
    <Page>
      <textarea value={text} onChange={(event) => setText(event.target.value)} placeholder="Memory text" />
      <input value={tags} onChange={(event) => setTags(event.target.value)} placeholder="tags, comma separated" />
      <button disabled={!text.trim()} onClick={add}><Plus size={18} /> Add memory</button>
      <div className="form-row"><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search by tag or text" /><button onClick={runSearch}><Search size={18} /></button></div>
      {pendingMemories.length > 0 && (
        <section className="panel stack">
          <div className="section-title"><h2>Pending Memories</h2><span>{pendingMemories.length}</span></div>
          {pendingMemories.map((memory) => <PendingMemoryCard key={memory.id} memory={memory} onRefresh={load} />)}
        </section>
      )}
      {memories.map((memory) => <EditableMemory key={memory.id} memory={memory} onRefresh={load} />)}
    </Page>
  );
}

function CompactionPage({ chat, onRefresh }: { chat: Chat; onRefresh: () => Promise<void> }) {
  const [draft, setDraft] = useState(chat.compactionMemory || "");
  const [saved, showSaved] = useSavedNotice();
  useEffect(() => setDraft(chat.compactionMemory || ""), [chat.id, chat.compactionMemory]);
  async function save() {
    await db.chats.update(chat.id, { compactionMemory: draft, updatedAt: now() });
    showSaved();
    await onRefresh();
  }
  return (
    <Page>
      <section className="item-card stack">
        <p className="notice">Keep this as a compact outline of major plot facts and continuity. Prefer lines like "Jaeger destroyed the company building" over minor moment-to-moment details.</p>
        <textarea className="large-entry" value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="- Major plot event&#10;- Important thread consequence&#10;- Current unresolved conflict" />
        <div className="split-actions persistent-actions"><button onClick={save}><Save size={18} /> Save compaction memory</button>{saved && <span className="save-status">Saved</span>}</div>
      </section>
    </Page>
  );
}

function PendingMemoryCard({ memory, onRefresh }: { memory: PendingMemory; onRefresh: () => Promise<void> }) {
  const [draftText, setDraftText] = useState(memory.text);
  const [draftTags, setDraftTags] = useState(memory.tags.join(", "));
  const [saved, showSaved] = useSavedNotice();
  useEffect(() => {
    setDraftText(memory.text);
    setDraftTags(memory.tags.join(", "));
  }, [memory.id, memory.text, memory.tags]);
  async function saveDraft() {
    await db.pendingMemories.update(memory.id, { text: draftText, tags: splitTags(draftTags), updatedAt: now() });
    showSaved();
    await onRefresh();
  }
  async function approve() {
    await createMemory(memory.projectId, draftText, splitTags(draftTags), "approved automatic", memory.sourceMessageIds);
    await db.pendingMemories.delete(memory.id);
    await onRefresh();
  }
  async function reject() {
    if (!confirm("Reject this pending memory?")) return;
    await db.pendingMemories.delete(memory.id);
    await onRefresh();
  }
  return (
    <section className="item-card stack">
      <textarea value={draftText} onChange={(event) => setDraftText(event.target.value)} />
      <input value={draftTags} onChange={(event) => setDraftTags(event.target.value)} placeholder="tags, comma separated" />
      {memory.reason && <small>Reason: {memory.reason}</small>}
      <small>Confidence: {Math.round((memory.confidence ?? 0) * 100)}%</small>
      <div className="split-actions">
        <button onClick={approve}><Save size={18} /> Approve</button>
        <button className="save-button" onClick={saveDraft}>Save edit</button>
        <button className="danger" onClick={reject}><Trash2 size={18} /> Reject</button>
        {saved && <span className="save-status">Saved</span>}
      </div>
    </section>
  );
}

export function SourceFilesSection({ project }: { project: Project }) {
  const [files, setFiles] = useState<SourceFile[]>([]);
  const [openFile, setOpenFile] = useState<SourceFile>();
  async function load() {
    setFiles(await db.sourceFiles.where("projectId").equals(project.id).reverse().sortBy("updatedAt"));
  }
  useEffect(() => { void load(); }, [project.id]);
  const projectId = project.id;
  async function add(filesToAdd: FileList | null) {
    if (!filesToAdd?.length) return;
    const timestamp = now();
    const rows = await Promise.all(Array.from(filesToAdd).map(async (file) => ({
      id: uid(),
      projectId,
      name: file.name,
      mimeType: file.type || "text/plain",
      size: file.size,
      textContent: file.type.startsWith("text/") || file.name.toLowerCase().endsWith(".txt") || file.name.toLowerCase().endsWith(".md") ? await file.text() : undefined,
      createdAt: timestamp,
      updatedAt: timestamp
    })));
    await db.sourceFiles.bulkAdd(rows.map((row) => row.textContent ? { ...row, sourceChunks: buildSourceChunks(row.textContent), sourceIndexUpdatedAt: row.updatedAt } : row));
    await load();
  }
  async function remove(id: string) {
    if (!confirm("Remove this source file from the project library?")) return;
    await db.sourceFiles.delete(id);
    await load();
  }
  return (
    <section className="source-files-section stack">
      <div className="section-title"><h2>Source files</h2><small>{files.length ? `${files.length} file${files.length === 1 ? "" : "s"}` : "Library"}</small></div>
      <label className="file-pick source-upload"><span><Upload size={18} /> <strong>Add to library</strong></span><input type="file" multiple onChange={(event) => add(event.target.files)} /></label>
      {files.length === 0 && <p className="muted-pad">No source files yet.</p>}
      {files.length > 0 && <div className="source-file-list">{files.map((file) => <section className="source-file-row" key={file.id}><button className="source-file-open" onClick={() => setOpenFile(file)}><span className="source-file-icon"><Folder size={17} /></span><span className="source-file-details"><strong>{file.name}</strong><small>{file.mimeType === "text/markdown" || file.name.toLocaleLowerCase().endsWith(".md") ? "Markdown" : "Text file"} · {Math.ceil(file.size / 1024)} KB</small></span></button><button className="source-file-remove" onClick={() => void remove(file.id)} aria-label={`Remove ${file.name}`} title="Remove file"><Trash2 size={16} /></button></section>)}</div>}
      {openFile && <div className="modal-backdrop source-reader-backdrop" onClick={() => setOpenFile(undefined)}><section className="modal source-reader" role="dialog" aria-modal="true" aria-labelledby="source-reader-title" onClick={(event) => event.stopPropagation()}><div className="section-title"><div><h2 id="source-reader-title">{openFile.name}</h2><small>{Math.ceil(openFile.size / 1024)} KB</small></div><div className="split-actions source-reader-actions"><button onClick={() => downloadSourceCopy(openFile)}><Download size={16} /> Download copy</button><button className="icon-button" onClick={() => setOpenFile(undefined)} aria-label="Close source file"><X size={18} /></button></div></div><pre className="source-reader-text">{openFile.textContent || "No readable text was stored for this file."}</pre></section></div>}
    </section>
  );
}

function EditableMemory({ memory, onRefresh }: { memory: Memory; onRefresh: () => Promise<void> }) {
  const [relevance, setRelevance] = useState(memory.relevance ?? 5);
  const [saved, showSaved] = useSavedNotice();
  useEffect(() => setRelevance(memory.relevance ?? 5), [memory.id, memory.relevance]);
  async function saveRelevance() {
    await db.memories.update(memory.id, { relevance, updatedAt: now() });
    showSaved();
    await onRefresh();
  }
  async function remove() {
    if (!confirm("Delete this memory?")) return;
    await db.memories.delete(memory.id);
    await onRefresh();
  }
  return (
    <section className="item-card stack">
      <p>{memory.text}</p>
      <small>{memory.visibleTags.join(", ")}</small>
      <label>Relevance {relevance}<input type="range" min={0} max={10} step={1} value={relevance} onChange={(event) => setRelevance(Number(event.target.value))} /></label>
      <div className="card-actions"><button onClick={saveRelevance}><Save size={18} /> Save relevance</button><button className="danger" onClick={remove}><Trash2 size={18} /> Delete</button>{saved && <span className="save-status">Saved</span>}</div>
    </section>
  );
}

export function CharactersPage({ project, onOpenProfile }: { project?: Project; onOpenProfile: (id: string) => void }) {
  const [characters, setCharacters] = useState<Character[]>([]);
  const [sourcePicker, setSourcePicker] = useState<{ projectId: string; files: SourceFile[] }>();
  const [selectedSourceIds, setSelectedSourceIds] = useState<string[]>([]);
  const [loadingSources, setLoadingSources] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<{ projectId: string; message: string; error?: boolean }>();
  const [draggedCharacterId, setDraggedCharacterId] = useState<string>();
  const [managing, setManaging] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  useEffect(() => { setManaging(false); setSelectedIds([]); setDeleteError(""); }, [project?.id]);
  async function deleteSelected() {
    if (deleting || !selectedIds.length) return;
    if (!confirm(`Delete ${selectedIds.length} selected character(s)? This permanently removes their profiles, images, bonuses, gear slots, and actions.`)) return;
    setDeleting(true);
    setDeleteError("");
    try {
      await deleteCharacters(selectedIds);
      setSelectedIds([]);
      setManaging(false);
      await load();
    } catch { setDeleteError("Could not delete the selected characters. Please try again."); }
    finally { setDeleting(false); }
  }
  async function load() {
    if (!project) return;
    const rows = await db.characters.where("projectId").equals(project.id).toArray();
    setCharacters(rows.sort((a, b) => (a.orderIndex ?? Number.MAX_SAFE_INTEGER) - (b.orderIndex ?? Number.MAX_SAFE_INTEGER) || a.normalisedName.localeCompare(b.normalisedName)));
  }
  useEffect(() => { load(); }, [project?.id]);
  if (!project) return <EmptyState title="No project selected" body="Choose a project to manage characters." />;
  const projectId = project.id;
  async function openSourcePicker() {
    setLoadingSources(true);
    setSelectedSourceIds([]);
    setImportResult(undefined);
    try {
      const files = (await db.sourceFiles.where("projectId").equals(projectId).toArray())
        .filter((file) => isCastSource(file.name)).sort((a, b) => a.name.localeCompare(b.name));
      setSourcePicker({ projectId, files });
    } catch {
      setImportResult({ projectId, message: "Could not load source files. Please try again.", error: true });
    } finally { setLoadingSources(false); }
  }
  async function importCharacters() {
    if (importing || sourcePicker?.projectId !== projectId || !selectedSourceIds.length) return;
    setImporting(true);
    setImportResult(undefined);
    try {
      const result = await importCastSources(projectId, selectedSourceIds, (message) => setImportResult({ projectId, message }));
      const message = result.files === 0
        ? "No cast_*.md source files found in this project. Upload files such as cast_Girls.md or cast_Unity.md in the project’s source files first."
        : `Imported ${result.imported} character${result.imported === 1 ? "" : "s"} from ${result.files} cast file${result.files === 1 ? "" : "s"}.${result.skippedFiles.length ? ` No characters extracted from: ${result.skippedFiles.join(", ")}.` : ""}`;
      setImportResult({ projectId, message });
      setSourcePicker(undefined);
      setSelectedSourceIds([]);
      await load();
    } catch (error) {
      setImportResult({ projectId, message: error instanceof Error ? error.message : "Could not import characters. Please try again.", error: true });
    } finally { setImporting(false); }
  }
  async function add() {
    const timestamp = now();
    await db.characters.add({ id: uid(), projectId, name: "New Character", normalisedName: "new-character", orderIndex: characters.length, age: "", gender: "", personality: "", misc: "", bio: "", statsEnabled: false, str: 8, dex: 8, con: 8, int: 8, wis: 8, cha: 8, createdAt: timestamp, updatedAt: timestamp });
    await load();
  }
  async function moveCharacter(targetId: string) {
    if (!draggedCharacterId || draggedCharacterId === targetId) return;
    const next = [...characters];
    const from = next.findIndex((character) => character.id === draggedCharacterId);
    const to = next.findIndex((character) => character.id === targetId);
    if (from < 0 || to < 0) return;
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    setCharacters(next);
    const timestamp = now();
    await db.transaction("rw", db.characters, async () => {
      await Promise.all(next.map((character, orderIndex) => db.characters.update(character.id, { orderIndex, updatedAt: timestamp })));
    });
    setDraggedCharacterId(undefined);
  }
  return (
    <Page>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button onClick={add} disabled={importing}><Plus size={18} /> Add character</button>
        <button onClick={() => void openSourcePicker()} disabled={importing || loadingSources}>{importing ? "Importing characters…" : loadingSources ? "Loading source files…" : "Import characters from source files"}</button>
      </div>
      {characters.length > 0 && !managing && <button onClick={() => setManaging(true)}>Manage characters</button>}
      {managing && <div className="character-manage-toolbar" role="group" aria-label="Manage characters">
        <strong role="status">{selectedIds.length} selected</strong>
        <button disabled={deleting} onClick={() => setSelectedIds(selectedIds.length === characters.length ? [] : characters.map((character) => character.id))}>{selectedIds.length === characters.length ? "Deselect all" : "Select all"}</button>
        <button className="danger" disabled={deleting || !selectedIds.length} onClick={() => void deleteSelected()}><Trash2 size={18} />{deleting ? "Deleting…" : `Delete selected (${selectedIds.length})`}</button>
        <button disabled={deleting} onClick={() => { setManaging(false); setSelectedIds([]); setDeleteError(""); }}>Done</button>
      </div>}
      {deleteError && <p className="error" role="alert">{deleteError}</p>}
      {sourcePicker?.projectId === projectId && <fieldset disabled={importing}>
        <legend>Choose source files to import</legend>
        {sourcePicker.files.length ? <>
          <p className="notice">Select the files to process. Each import creates new character entries, including names already in your library.</p>
          <div style={{ display: "grid", gap: 8, maxHeight: 280, overflowY: "auto" }}>
            {sourcePicker.files.map((file) => <label key={file.id} style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <input type="checkbox" style={{ width: "auto" }} checked={selectedSourceIds.includes(file.id)} onChange={(event) => setSelectedSourceIds((ids) => event.target.checked ? [...ids, file.id] : ids.filter((id) => id !== file.id))} />
              {file.name}
            </label>)}
          </div>
        </> : <p role="status">No cast_*.md source files found in this project. Upload your cast files in the project’s source files first.</p>}
        <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
          <button onClick={() => { setSourcePicker(undefined); setSelectedSourceIds([]); }}>Cancel</button>
          <button disabled={!selectedSourceIds.length || importing} onClick={() => void importCharacters()}>{importing ? "Importing…" : `Import selected files (${selectedSourceIds.length})`}</button>
        </div>
      </fieldset>}
      {importResult?.projectId === projectId && <p className={importResult.error ? "error" : "notice"} role={importResult.error ? "alert" : "status"}>{importResult.message}</p>}
      <div className="character-gallery">
        {characters.map((character) => (
          <CharacterTile
            key={`${projectId}:${character.id}`}
            character={character}
            managing={managing}
            selected={selectedIds.includes(character.id)}
            disabled={deleting}
            onHold={() => { setManaging(true); setSelectedIds([character.id]); setDraggedCharacterId(undefined); }}
            onToggle={() => setSelectedIds((ids) => ids.includes(character.id) ? ids.filter((id) => id !== character.id) : [...ids, character.id])}
            dragging={draggedCharacterId === character.id}
            onDragStart={() => setDraggedCharacterId(character.id)}
            onDrop={() => moveCharacter(character.id)}
            onOpen={() => onOpenProfile(character.id)}
          />
        ))}
      </div>
    </Page>
  );
}

function CharacterTile({ character, dragging, managing, selected, disabled, onHold, onToggle, onDragStart, onDrop, onOpen }: { character: Character; dragging: boolean; managing: boolean; selected: boolean; disabled: boolean; onHold: () => void; onToggle: () => void; onDragStart: () => void; onDrop: () => void; onOpen: () => void }) {
  const holdTimer = useRef<ReturnType<typeof setTimeout>>();
  const origin = useRef<{ x: number; y: number }>();
  const suppressClick = useRef(false);
  function cancelHold() {
    clearTimeout(holdTimer.current);
    origin.current = undefined;
  }
  useEffect(() => cancelHold, []);
  const { images } = useAttachmentImages("character", character.id, true);
  const imageUrl = images[0]?.url;
  return (
    <button
      className={`character-tile ${dragging ? "dragging" : ""} ${managing ? "managing" : ""} ${selected ? "selected" : ""}`}
      disabled={disabled}
      aria-pressed={managing ? selected : undefined}
      draggable={!managing}
      onPointerDown={(event) => {
        cancelHold();
        suppressClick.current = false;
        if (managing || event.button !== 0) return;
        origin.current = { x: event.clientX, y: event.clientY };
        holdTimer.current = setTimeout(() => { suppressClick.current = true; onHold(); }, 500);
      }}
      onPointerMove={(event) => {
        if (origin.current && Math.hypot(event.clientX - origin.current.x, event.clientY - origin.current.y) > 10) cancelHold();
      }}
      onPointerUp={cancelHold}
      onPointerCancel={cancelHold}
      onPointerLeave={cancelHold}
      onContextMenu={(event) => event.preventDefault()}
      onClick={(event) => {
        if (suppressClick.current && event.detail !== 0) { suppressClick.current = false; return; }
        suppressClick.current = false;
        if (managing) onToggle(); else onOpen();
      }}
      onDragStart={(event) => {
        cancelHold();
        if (managing || suppressClick.current) { event.preventDefault(); return; }
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", character.id);
        onDragStart();
      }}
      onDragOver={(event) => {
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
      }}
      onDrop={(event) => {
        event.preventDefault();
        if (!managing) onDrop();
      }}
    >
      {managing && <span className="character-selection-mark" aria-hidden="true">{selected ? "✓" : ""}</span>}
      {imageUrl ? <img src={imageUrl} alt="" draggable={false} /> : <UserRound className="character-placeholder-icon" size={54} strokeWidth={1.55} />}
      <span>{character.name}</span>
    </button>
  );
}

function CharacterProfilePage({ project, characterId, chatId, onSaved, onBack, onDeleted }: { project: Project; characterId: string; chatId?: string; onSaved?: () => void; onBack: () => void; onDeleted: () => void }) {
  const [character, setCharacter] = useState<Character>();
  async function load() {
    const row = await db.characters.get(characterId);
    if (row?.projectId === project.id) setCharacter(row);
  }
  useEffect(() => { load(); }, [characterId, project.id]);
  if (!character) return <EmptyState title="Character not found" body="This character could not be opened in the selected project." />;
  return <Page><CharacterEditor project={project} character={character} chatId={chatId} onSaved={onSaved} onRefresh={load} onBack={onBack} onDeleted={onDeleted} /></Page>;
}

function CharacterEditor({ project, character, chatId, onSaved, onRefresh, onBack, onDeleted }: { project: Project; character: Character; chatId?: string; onSaved?: () => void; onRefresh: () => Promise<void>; onBack: () => void; onDeleted: () => void }) {
  const [draft, setDraft] = useState(character);
  const [editing, setEditing] = useState(false);
  const { images: attachments, refresh: loadAttachments } = useAttachmentImages("character", character.id);
  const [bonuses, setBonuses] = useState<CharacterBonus[]>([]);
  const [gearStatBonuses, setGearStatBonuses] = useState<AbilityModifiers>({});
  const [carryGearWeightKg, setCarryGearWeightKg] = useState(0);
  const [carryInventoryWeightKg, setCarryInventoryWeightKg] = useState(0);
  const [unweighedItemCount, setUnweighedItemCount] = useState(0);
  const [viewerIndex, setViewerIndex] = useState<number>();
  const [saved, showSaved] = useSavedNotice();
  const buildMode = characterBuildMode(draft);
  const valid = !draft.statsEnabled || (buildMode === "template" ? Boolean(draft.job) : validatePointBuy(draft) && Boolean(draft.customJobName?.trim()));

  async function loadBonuses() {
    setBonuses(await db.characterBonuses.where("characterId").equals(character.id).toArray());
  }
  async function loadCarryWeights() {
    const [gearSlots, inventoryItems] = await Promise.all([
      db.characterGearSlots.where("characterId").equals(character.id).toArray(),
      chatId ? db.inventoryItems.where("chatId").equals(chatId).and((item) => item.kind === "inventory").toArray() : Promise.resolve([])
    ]);
    setCarryGearWeightKg(gearSlots.reduce((sum, slot) => sum + (slot.carryWeightKg ?? 0), 0));
    setGearStatBonuses(abilities.reduce<AbilityModifiers>((totals, ability) => {
      totals[ability] = gearSlots.filter((slot) => slot.itemName.trim()).reduce((sum, slot) => sum + (slot.statBonuses?.[ability] ?? 0), 0);
      return totals;
    }, {}));
    setCarryInventoryWeightKg(inventoryItems.reduce((sum, item) => sum + (item.unitWeightKg ?? 0) * item.quantity, 0));
    setUnweighedItemCount(inventoryItems.filter((item) => !item.unitWeightKg).reduce((sum, item) => sum + item.quantity, 0));
  }
  useEffect(() => {
    setDraft(character);
    loadBonuses();
    loadCarryWeights();
  }, [character.id]);
  async function save() {
    const mode = characterBuildMode(draft);
    const savedCharacter: Character = {
      ...draft,
      buildMode: mode,
      jobCategory: mode === "template" ? draft.jobCategory : undefined,
      job: mode === "template" ? draft.job : undefined,
      customJobName: mode === "custom" ? draft.customJobName?.trim() : undefined,
      normalisedName: normaliseTag(draft.name),
      updatedAt: now()
    };
    await db.characters.put(savedCharacter);
    await refreshActiveDeltaCharacterStats(project, savedCharacter);
    setEditing(false);
    showSaved();
    await onRefresh();
    onSaved?.();
  }

  async function addImages(files: FileList | null) {
    if (!files?.length) return;
    const timestamp = now();
    const imageFiles = Array.from(files).filter((file) => file.type.startsWith("image/"));
    await db.attachments.bulkAdd(imageFiles.map((file) => ({ id: uid(), ownerType: "character" as const, ownerId: character.id, mimeType: file.type, size: file.size, blob: file, createdAt: timestamp, updatedAt: timestamp })));
    await loadAttachments();
  }
  async function previewTool(division: "identity" | "bio" | "stats") {
    const result =
      division === "identity"
        ? await getCharacterIdentity(character.projectId, character.id)
        : division === "bio"
          ? await getCharacterBio(character.projectId, character.id)
          : await getCharacterStats(character.projectId, character.id);
    alert(JSON.stringify(result, null, 2));
  }
  async function removeCharacter() {
    if (!confirm(`Delete ${character.name}? This removes the character profile, attached character images, and stat bonuses.`)) return;
    await deleteCharacters([character.id]);
    onDeleted();
  }
  return (
    <section className="item-card character-card">
      <div className="character-head">
        <div>
          <h2>Name: {character.name}</h2>
          <p>Identity: {character.age || "Age"}, {character.gender || "Gender"}, {character.personality || "Personality"}, {character.misc || "Misc"}</p>
        </div>
        <button onClick={() => setEditing(!editing)}><Edit3 size={18} /> {editing ? "Close" : "Edit"}</button>
      </div>
      {!editing && (
        <div className="character-display">
          <div className="character-summary-row">
            {attachments[0] && <img className="profile-side-image" src={attachments[0].url} alt="" />}
            {character.statsEnabled && <StatsDisplay project={project} character={character} bonuses={bonuses} gearStatBonuses={gearStatBonuses} />}
          </div>
          <p className="bio-full"><strong>Bio:</strong> {character.bio || "No bio saved yet."}</p>
          <div className="split-actions">
            <button onClick={() => previewTool("identity")}><Eye size={18} /> Identity</button>
            <button onClick={() => previewTool("bio")}><Eye size={18} /> Bio</button>
            <button onClick={() => previewTool("stats")}><Eye size={18} /> Stats</button>
          </div>
        </div>
      )}
      {editing && (
        <div className="stack edit-panel">
          <label>Name:<input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></label>
          <label>Identity: Age<input value={draft.age} onChange={(event) => setDraft({ ...draft, age: event.target.value })} /></label>
          <div className="paired-fields">
            <label>Identity: Gender<input value={draft.gender} onChange={(event) => setDraft({ ...draft, gender: event.target.value })} /></label>
            <label>Gear Display Body Type<select value={draft.gearBodyType ?? "type-a"} onChange={(event) => setDraft({ ...draft, gearBodyType: event.target.value as GearBodyType })}><option value="type-a">M</option><option value="type-b">F</option></select></label>
          </div>
          <label>Identity: Personality<textarea value={draft.personality} onChange={(event) => setDraft({ ...draft, personality: event.target.value })} /></label>
          <label>Identity: Misc<textarea value={draft.misc} onChange={(event) => setDraft({ ...draft, misc: event.target.value })} /></label>
          <label>Bio:<textarea className="large-entry" value={draft.bio} onChange={(event) => setDraft({ ...draft, bio: event.target.value })} /></label>
          <label className="file-pick"><ImageIcon size={18} /> Add images<input type="file" accept="image/*" multiple onChange={(event) => addImages(event.target.files)} /></label>
          <ImageStrip attachments={attachments} onOpen={setViewerIndex} />
          <label className="compact-check"><input type="checkbox" checked={draft.statsEnabled} onChange={(event) => setDraft({ ...draft, statsEnabled: event.target.checked })} /> Enable ability scores</label>
          {draft.statsEnabled && <PointBuyEditor project={project} draft={draft} bonuses={bonuses} gearStatBonuses={gearStatBonuses} onDraft={setDraft} />}
          {draft.statsEnabled && <CharacterCarryPreview project={project} character={draft} bonuses={bonuses} gearStatBonuses={gearStatBonuses} inventoryWeightKg={carryInventoryWeightKg} gearWeightKg={carryGearWeightKg} unweighedItemCount={unweighedItemCount} />}
          <CharacterActionLibraryEditor character={character} />
          {!valid && <p className="error">{buildMode === "template" ? "Choose a JOB for template builds." : "Custom builds need a job name and must stay within 27 points, with base scores from 8 to 15."}</p>}
          <div className="split-actions persistent-actions"><button disabled={!valid} onClick={save}><Save size={18} /> Save</button><button onClick={() => setEditing(false)}>Cancel</button>{saved && <span className="save-status">Saved</span>}</div>
        </div>
      )}
      {viewerIndex !== undefined && <ImageViewer attachments={attachments} index={viewerIndex} onChange={setViewerIndex} onClose={() => setViewerIndex(undefined)} />}
      <div className="character-back-row">
        <button onClick={onBack}><ChevronLeft size={18} /> Back to characters</button>
      </div>
      <div className="character-delete-row">
        <button className="danger" onClick={removeCharacter}><Trash2 size={18} /> Delete character</button>
      </div>
    </section>
  );
}

function CharacterActionLibraryEditor({ character }: { character: Character }) {
  const [slots, setSlots] = useState<CharacterActionSlot[]>([]);
  const [selectedSlotId, setSelectedSlotId] = useState("");
  const [macros, setMacros] = useState<CharacterActionMacro[]>([]);
  const [macroDraft, setMacroDraft] = useState<{
    macro?: CharacterActionMacro;
    parentId?: string;
    folder: boolean;
    label: string;
    template: string;
    requestEntitySelection: boolean;
  }>();
  async function load(preferredSlotId = selectedSlotId) {
    const timestamp = now();
    let nextSlots = (await db.characterActionSlots.where("characterId").equals(character.id).toArray()).sort((a, b) => a.orderIndex - b.orderIndex);
    if (!nextSlots.length) {
      const slot: CharacterActionSlot = { id: uid(), characterId: character.id, orderIndex: 0, createdAt: timestamp, updatedAt: timestamp };
      await db.characterActionSlots.add(slot);
      nextSlots = [slot];
    }
    const slotId = nextSlots.some((slot) => slot.id === preferredSlotId) ? preferredSlotId : nextSlots[0].id;
    const nextMacros = await db.characterActionMacros.where("slotId").equals(slotId).toArray();
    setSlots(nextSlots);
    setSelectedSlotId(slotId);
    setMacros(nextMacros.sort((a, b) => a.orderIndex - b.orderIndex));
  }
  useEffect(() => { void load(""); }, [character.id]);
  function slotName(slot: CharacterActionSlot, index = slots.findIndex((item) => item.id === slot.id)) {
    return slot.name?.trim() || String(index + 1);
  }
  async function addSlot() {
    const timestamp = now();
    const slot: CharacterActionSlot = { id: uid(), characterId: character.id, orderIndex: slots.length, createdAt: timestamp, updatedAt: timestamp };
    await db.characterActionSlots.add(slot);
    await load(slot.id);
  }
  async function renameSlot(name: string) {
    if (!selectedSlotId) return;
    await db.characterActionSlots.update(selectedSlotId, { name: name.trim() || undefined, updatedAt: now() });
    await load(selectedSlotId);
  }
  function addMacro(parentId: string | undefined, folder: boolean) {
    if (!selectedSlotId) return;
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
    if (!macroDraft || !selectedSlotId) return;
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
      const siblings = macros.filter((macro) => macro.parentId === macroDraft.parentId);
      await db.characterActionMacros.add({
        id: uid(),
        slotId: selectedSlotId,
        parentId: macroDraft.parentId,
        label,
        template: macroDraft.folder ? undefined : macroDraft.template,
        requestEntitySelection: macroDraft.folder ? false : macroDraft.requestEntitySelection,
        orderIndex: Math.max(-1, ...siblings.map((macro) => macro.orderIndex)) + 1,
        createdAt: timestamp,
        updatedAt: timestamp
      });
    }
    setMacroDraft(undefined);
    await load(selectedSlotId);
  }
  async function deleteMacro(macro: CharacterActionMacro) {
    if (!confirm(`Delete "${macro.label}" and anything inside it?`)) return;
    const ids = new Set<string>([macro.id]);
    let grew = true;
    while (grew) {
      grew = false;
      for (const item of macros) {
        if (item.parentId && ids.has(item.parentId) && !ids.has(item.id)) {
          ids.add(item.id);
          grew = true;
        }
      }
    }
    await db.characterActionMacros.bulkDelete(Array.from(ids));
    await load(selectedSlotId);
  }
  return (
    <section className="character-action-editor">
      <div className="section-title">
        <h2>Actions</h2>
        <div className="split-actions">
          <button type="button" onClick={addSlot}>+ Slot</button>
          <button type="button" onClick={() => addMacro(undefined, true)}>+ Menu</button>
          <button type="button" onClick={() => addMacro(undefined, false)}>+ Action</button>
        </div>
      </div>
      <div className="action-library-controls">
        <label>Save slot
          <select value={selectedSlotId} onChange={(event) => void load(event.target.value)}>
            {slots.map((slot, index) => <option key={slot.id} value={slot.id}>{slotName(slot, index)}</option>)}
          </select>
        </label>
        {selectedSlotId && (
          <label>Slot name
            <input value={slots.find((slot) => slot.id === selectedSlotId)?.name ?? ""} onChange={(event) => void renameSlot(event.target.value)} placeholder={slots.find((slot) => slot.id === selectedSlotId) ? slotName(slots.find((slot) => slot.id === selectedSlotId)!) : "Slot name"} />
          </label>
        )}
      </div>
      {macros.length === 0 && <p className="notice">Create nested action menus for this character. Delta will use the selected character's action slots.</p>}
      <DeltaActionTree macros={macros} parentId={undefined} editMode onChoose={() => undefined} onAdd={addMacro} onEdit={editMacro} onDelete={deleteMacro} />
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
    </section>
  );
}

function characterTemplateBonus(project: Project, character: Character) {
  const templateBuild = characterBuildMode(character) === "template";
  const defaultStats = project.deltaDefaultNpcStats ?? defaultDeltaNpcStats();
  const generated = generatedDeltaStats(project, {
    prefix: character.prefix,
    base: character.base,
    job: templateBuild ? character.job : undefined,
    jobCategory: templateBuild ? character.jobCategory : undefined
  });
  return {
    generated,
    bonus: abilities.reduce((scores, ability) => ({ ...scores, [ability]: generated.scores[ability] - defaultStats[ability] }), {} as AbilityScores)
  };
}

function characterBuildMode(character: Character) {
  return character.buildMode ?? (character.job ? "template" : "custom");
}

function characterBuildTag(character: Character, generatedTag?: string) {
  if (characterBuildMode(character) !== "custom") return generatedTag;
  const customJob = character.customJobName?.trim();
  return formatDeltaTemplateTag(character.prefix, character.base, customJob) || customJob;
}

function signedBonus(value: number) {
  return value > 0 ? `+${value}` : String(value);
}

function scoreModifier(score: number) {
  return Math.floor((score - 10) / 2);
}

function modifierLabel(score: number) {
  return `(${signedBonus(scoreModifier(score))})`;
}

const abilityHints: Record<Ability, string> = {
  STR: "force, carrying, melee",
  DEX: "aim, reflex, stealth",
  CON: "stamina, injury, HP",
  INT: "logic, tech, recall",
  WIS: "sense, focus, instinct",
  CHA: "presence, charm, nerve"
};

function templateOptionLabel(label: string, statModifiers: AbilityModifiers = {}, hpBonus = 0) {
  const bonuses = abilities
    .map((ability) => {
      const value = statModifiers[ability] ?? 0;
      return value === 0 ? "" : `${signedBonus(value)} ${ability}`;
    })
    .filter(Boolean);
  if (hpBonus !== 0) bonuses.push(`${signedBonus(hpBonus)} HP`);
  return bonuses.length > 0 ? `${label} (${bonuses.join(", ")})` : label;
}

function StatsDisplay({ project, character, bonuses, gearStatBonuses }: { project: Project; character: Character; bonuses: CharacterBonus[]; gearStatBonuses: AbilityModifiers }) {
  const template = characterTemplateBonus(project, character);
  const templateBuild = characterBuildMode(character) === "template";
  const buildTag = characterBuildTag(character, template.generated.templateTag);
  const defaultStats = project.deltaDefaultNpcStats ?? defaultDeltaNpcStats();
  const conBonus = bonuses.filter((item) => item.stat === "CON").reduce((sum, item) => sum + item.value, 0);
  const totalCon = (templateBuild ? defaultStats.CON : character.con) + template.bonus.CON + conBonus + (gearStatBonuses.CON ?? 0);
  const totalHp = Math.max(1, 10 + scoreModifier(totalCon) + template.generated.hpBonus);
  return <div className="stat-display">{abilities.map((ability) => {
    const key = ability.toLowerCase() as "str" | "dex" | "con" | "int" | "wis" | "cha";
    const legacyBonus = bonuses.filter((item) => item.stat === ability).reduce((sum, item) => sum + item.value, 0);
    const total = (templateBuild ? defaultStats[ability] : character[key]) + template.bonus[ability] + legacyBonus + (gearStatBonuses[ability] ?? 0);
    return <span key={ability}>{ability} {total} <small>{modifierLabel(total)}</small></span>;
  })}<span className="character-hp-display">HP {totalHp} <HpSquares current={totalHp} max={totalHp} character /></span>{buildTag && <small className="delta-template-tag">{buildTag}</small>}</div>;
}

function CharacterCarryPreview({ project, character, bonuses, gearStatBonuses, inventoryWeightKg, gearWeightKg, unweighedItemCount }: { project: Project; character: Character; bonuses: CharacterBonus[]; gearStatBonuses: AbilityModifiers; inventoryWeightKg: number; gearWeightKg: number; unweighedItemCount: number }) {
  const template = characterTemplateBonus(project, character);
  const templateBuild = characterBuildMode(character) === "template";
  const defaultStats = project.deltaDefaultNpcStats ?? defaultDeltaNpcStats();
  const legacyStrengthBonus = bonuses.filter((bonus) => bonus.stat === "STR").reduce((sum, bonus) => sum + bonus.value, 0);
  const finalStrength = (templateBuild ? defaultStats.STR : character.str) + template.bonus.STR + legacyStrengthBonus + (gearStatBonuses.STR ?? 0);
  const currentLoadKg = inventoryWeightKg + gearWeightKg;
  const profile = deltaCarryProfile(project, character.base, finalStrength, currentLoadKg);
  const status = profile.status === "overloaded" ? "Overloaded" : profile.status === "encumbered" ? "Encumbered" : "Normal";
  return (
    <section className="character-carry-preview" aria-label="Carrying preview">
      <div><span>Carry capacity</span><strong>{formatInventoryKg(profile.carryCapacityKg)} kg</strong><small>STR {finalStrength} × {profile.carryKgPerStr} kg</small></div>
      <div><span>Combat load</span><strong>{formatInventoryKg(profile.combatLoadKg)} kg</strong><small>{profile.combatLoadPercent}% of capacity</small></div>
      <div><span>Current load</span><strong>{formatInventoryKg(currentLoadKg)} kg</strong><small>{formatInventoryKg(inventoryWeightKg)} inventory + {formatInventoryKg(gearWeightKg)} gear</small></div>
      <div><span>Status</span><strong className={`gear-load-status ${profile.status}`}>{status}</strong>{unweighedItemCount > 0 && <small>+ {unweighedItemCount} unweighed item{unweighedItemCount === 1 ? "" : "s"}</small>}</div>
    </section>
  );
}

function PointBuyEditor({ project, draft, bonuses, gearStatBonuses, onDraft }: { project: Project; draft: Character; bonuses: CharacterBonus[]; gearStatBonuses: AbilityModifiers; onDraft: (character: Character) => void }) {
  const buildMode = characterBuildMode(draft);
  const templateBuild = buildMode === "template";
  const pointCost = abilities.reduce((sum, ability) => {
    const key = ability.toLowerCase() as "str" | "dex" | "con" | "int" | "wis" | "cha";
    const costs: Record<number, number> = { 8: 0, 9: 1, 10: 2, 11: 3, 12: 4, 13: 5, 14: 7, 15: 9 };
    return sum + costs[draft[key]];
  }, 0);
  const template = characterTemplateBonus(project, draft);
  const categories = jobCategories(project.deltaJobs ?? []);
  const jobsForCategory = (project.deltaJobs ?? []).filter((job) => job.category === draft.jobCategory);
  const defaultStats = project.deltaDefaultNpcStats ?? defaultDeltaNpcStats();
  const legacyConBonus = bonuses.filter((item) => item.stat === "CON").reduce((sum, item) => sum + item.value, 0);
  const totalCon = (templateBuild ? defaultStats.CON : draft.con) + template.bonus.CON + legacyConBonus + (gearStatBonuses.CON ?? 0);
  const baseHp = Math.max(1, 10 + scoreModifier(totalCon));
  const tagHpBonus = template.generated.hpBonus;
  const totalHp = Math.max(1, baseHp + tagHpBonus);
  const buildTag = characterBuildTag(draft, template.generated.templateTag);
  const statRows = abilities.map((ability) => {
    const key = ability.toLowerCase() as "str" | "dex" | "con" | "int" | "wis" | "cha";
    const base = templateBuild ? defaultStats[ability] : draft[key];
    const legacyBonus = bonuses.filter((item) => item.stat === ability).reduce((sum, item) => sum + item.value, 0);
    const bonus = template.bonus[ability] + legacyBonus + (gearStatBonuses[ability] ?? 0);
    const total = base + bonus;
    return { ability, key, base, bonus, total };
  });
  const statScale = Math.max(20, ...statRows.map((row) => Math.max(row.base, row.total)));
  return (
    <div className="point-buy">
      <div className="mini-row">
        <strong>{templateBuild ? "Template build" : `${pointCost} / 27 spent`}</strong>
        {buildTag && <small className="delta-template-tag">{buildTag}</small>}
      </div>
      <div className="build-mode-row">
        <button className={templateBuild ? "active" : ""} onClick={() => onDraft({ ...draft, buildMode: "template", customJobName: undefined })}>Template</button>
        <button className={!templateBuild ? "active" : ""} onClick={() => onDraft({ ...draft, buildMode: "custom", jobCategory: undefined, job: undefined })}>Custom</button>
      </div>
      <div className="template-select-grid">
        <label>PREFIX
          <select value={draft.prefix ?? ""} onChange={(event) => onDraft({ ...draft, prefix: event.target.value || undefined })}>
            <option value="">None</option>
            {effectiveDeltaPrefixes(project.deltaPrefixes).map((prefix) => <option key={prefix.id} value={prefix.label}>{templateOptionLabel(prefix.label, prefix.statModifiers)}</option>)}
          </select>
        </label>
        <label>BASE
          <select value={draft.base ?? ""} onChange={(event) => onDraft({ ...draft, base: event.target.value || undefined })}>
            <option value="">None</option>
            {effectiveDeltaBases(project.deltaBases).map((base) => <option key={base.id} value={base.label}>{templateOptionLabel(base.label, base.statModifiers, base.hpBonus ?? 0)}</option>)}
          </select>
        </label>
        {templateBuild ? (
          <>
            <label>JOB category
              <select value={draft.jobCategory ?? ""} onChange={(event) => onDraft({ ...draft, jobCategory: event.target.value || undefined, job: undefined })}>
                <option value="">None</option>
                {categories.map(([category]) => <option key={category} value={category}>{category}</option>)}
              </select>
            </label>
            <label>JOB
              <select value={draft.job ?? ""} onChange={(event) => onDraft({ ...draft, job: event.target.value || undefined })} disabled={!draft.jobCategory}>
                <option value="">None</option>
                {jobsForCategory.map((job) => <option key={job.id} value={job.label}>{templateOptionLabel(job.label, job.statModifiers)}</option>)}
              </select>
            </label>
          </>
        ) : (
          <label className="template-select-wide">JOB name
            <input value={draft.customJobName ?? ""} onChange={(event) => onDraft({ ...draft, customJobName: event.target.value })} placeholder="Name this build" />
          </label>
        )}
      </div>
      <div className={`hp-summary ${tagHpBonus < 0 ? "negative" : ""}`}>
        <div className="hp-summary-head">
          <span>HP</span>
          <strong>{totalHp} <small>({signedBonus(tagHpBonus)})</small></strong>
        </div>
        <HpSquares current={totalHp} max={totalHp} character />
        <div className="hp-summary-foot"><span>{baseHp} {signedBonus(tagHpBonus)} = {totalHp}</span></div>
      </div>
      {statRows.map(({ ability, key, base, bonus, total }) => {
        const baseWidth = (Math.max(0, bonus < 0 ? total : base) / statScale) * 100;
        const bonusWidth = (Math.abs(bonus) / statScale) * 100;
        return (
          <div className="stat-bar-row" key={ability}>
            <span className="stat-label"><strong>{ability}</strong></span>
            <button disabled={templateBuild || base <= 8} onClick={() => onDraft({ ...draft, [key]: base - 1 })}>-</button>
            <div className="stat-bar-cell">
              <div className={`stat-bar ${bonus < 0 ? "negative" : ""}`}><i style={{ width: `${baseWidth}%` }} />{bonus !== 0 && <b style={{ width: `${bonusWidth}%` }} />}</div>
              <small>{abilityHints[ability]}</small>
            </div>
            <button disabled={templateBuild || base >= 15} onClick={() => onDraft({ ...draft, [key]: base + 1 })}>+</button>
            <strong>{total} <small>{modifierLabel(total)}</small></strong>
          </div>
        );
      })}
      {bonuses.length > 0 && <p className="notice">Legacy custom bonuses are still included in totals, but new stat bonuses come from PREFIX / BASE / JOB tags.</p>}
    </div>
  );
}

function ArchivesPage({ project }: { project?: Project }) {
  const [archives, setArchives] = useState<{ id: string; name: string; updatedAt: number }[]>([]);
  async function load() { if (project) setArchives(await db.archives.where("projectId").equals(project.id).reverse().sortBy("updatedAt")); }
  useEffect(() => { load(); }, [project?.id]);
  if (!project) return <EmptyState title="No project selected" body="Choose a project to manage Archives." />;
  const projectId = project.id;
  async function add() {
    const timestamp = now();
    await db.archives.add({ id: uid(), projectId, name: "New Archive", createdAt: timestamp, updatedAt: timestamp });
    await load();
  }
  return <Page><button onClick={add}><Plus size={18} /> Add Archive</button>{archives.map((archive) => <ArchiveEditor key={archive.id} archiveId={archive.id} name={archive.name} onRefresh={load} />)}</Page>;
}

function ArchiveEditor({ archiveId, name, onRefresh }: { archiveId: string; name: string; onRefresh: () => Promise<void> }) {
  const [entries, setEntries] = useState<{ id: string; header: string; body: string; orderIndex: number }[]>([]);
  const [index, setIndex] = useState(0);
  const [viewAll, setViewAll] = useState(false);
  const entry = entries[index];
  async function load() { setEntries(await db.archiveEntries.where("archiveId").equals(archiveId).sortBy("orderIndex")); }
  useEffect(() => { load(); }, [archiveId]);
  async function addEntry() {
    const timestamp = now();
    await db.archiveEntries.add({ id: uid(), archiveId, header: "Entry", body: "", orderIndex: entries.length, createdAt: timestamp, updatedAt: timestamp });
    await db.archives.update(archiveId, { updatedAt: timestamp });
    await load();
  }
  async function saveEntry(next: typeof entry) {
    if (!next) return;
    await db.archiveEntries.update(next.id, { header: next.header, body: next.body, updatedAt: now() });
    await onRefresh(); await load();
  }
  return (
    <section className="item-card stack">
      <div className="section-title"><h2>{name}</h2><button className="link-button" onClick={() => setViewAll(!viewAll)}>{viewAll ? "Paged" : "View all"}</button></div>
      {!viewAll && <div className="pager"><button disabled={index === 0} onClick={() => setIndex(index - 1)}><ChevronLeft size={18} /></button><span>{entries.length ? index + 1 : 0} / {entries.length}</span><button disabled={index >= entries.length - 1} onClick={() => setIndex(index + 1)}><ChevronRight size={18} /></button></div>}
      {viewAll ? entries.map((nextEntry) => <ArchiveEntryForm key={nextEntry.id} entry={nextEntry} onSave={saveEntry} />) : entry ? <ArchiveEntryForm entry={entry} onSave={saveEntry} /> : <p className="muted-pad">No entries yet.</p>}
      <button onClick={addEntry}><Plus size={18} /> Add entry</button>
    </section>
  );
}

function ArchiveEntryForm({ entry, onSave }: { entry: { id: string; header: string; body: string; orderIndex: number }; onSave: (entry: { id: string; header: string; body: string; orderIndex: number }) => void }) {
  const [draft, setDraft] = useState(entry);
  const [editing, setEditing] = useState(false);
  const [active, setActive] = useState(false);
  const { images: attachments, refresh: loadAttachments } = useAttachmentImages("archiveEntry", entry.id);
  const [viewerIndex, setViewerIndex] = useState<number>();
  const [saved, showSaved] = useSavedNotice();
  const entryRef = useRef<HTMLDivElement>(null);
  useEffect(() => setDraft(entry), [entry]);

  useEffect(() => {
    function closeWhenOutside(event: PointerEvent) {
      if (!entryRef.current?.contains(event.target as Node)) setActive(false);
    }
    document.addEventListener("pointerdown", closeWhenOutside);
    return () => document.removeEventListener("pointerdown", closeWhenOutside);
  }, []);
  async function addImages(files: FileList | null) {
    if (!files?.length) return;
    const timestamp = now();
    const imageFiles = Array.from(files).filter((file) => file.type.startsWith("image/"));
    await db.attachments.bulkAdd(imageFiles.map((file) => ({ id: uid(), ownerType: "archiveEntry" as const, ownerId: entry.id, mimeType: file.type, size: file.size, blob: file, createdAt: timestamp, updatedAt: timestamp })));
    await loadAttachments();
  }
  async function save() {
    await onSave(draft);
    setEditing(false);
    showSaved();
  }
  return (
    <div className="stack archive-entry" ref={entryRef} onClick={() => setActive(true)}>
      {!editing && (
        <>
          <div className="character-head"><h2>{entry.header}</h2>{active && <button onClick={() => setEditing(true)}><Edit3 size={18} /> Edit</button>}</div>
          <div className="archive-preview-wrap">
            {attachments[0] && (
              <div className="archive-media-column">
                <button className="archive-main-image" onClick={() => setViewerIndex(0)}><img src={attachments[0].url} alt="" /></button>
                {attachments.length > 1 && <ImageStrip attachments={attachments.slice(1)} onOpen={(nextIndex) => setViewerIndex(nextIndex + 1)} />}
              </div>
            )}
            <div className="entry-body"><MarkdownText text={entry.body} emptyText="No entry text yet." /></div>
          </div>
        </>
      )}
      {editing && (
        <>
          <input value={draft.header} onChange={(event) => setDraft({ ...draft, header: event.target.value })} />
          <textarea className="large-entry" value={draft.body} onChange={(event) => setDraft({ ...draft, body: event.target.value })} />
          <label className="file-pick"><ImageIcon size={18} /> Add images<input type="file" accept="image/*" multiple onChange={(event) => addImages(event.target.files)} /></label>
          <ImageStrip attachments={attachments} onOpen={setViewerIndex} />
          <div className="split-actions"><button onClick={save}><Save size={18} /> Save entry</button><button onClick={() => setEditing(false)}>Cancel</button>{saved && <span className="save-status">Saved</span>}</div>
        </>
      )}
      {viewerIndex !== undefined && <ImageViewer attachments={attachments} index={viewerIndex} onChange={setViewerIndex} onClose={() => setViewerIndex(undefined)} />}
    </div>
  );
}

function StarsPage({ project }: { project?: Project }) {
  const [stars, setStars] = useState<{ id: string; role: string; bodyCopy: string; updatedAt: number }[]>([]);
  const [openStar, setOpenStar] = useState<{ id: string; role: string; bodyCopy: string; updatedAt: number }>();
  async function load() {
    if (project) setStars(await db.stars.where("projectId").equals(project.id).reverse().sortBy("updatedAt"));
  }
  useEffect(() => { load(); }, [project?.id]);
  if (!project) return <EmptyState title="No project selected" body="Choose a project to view stars." />;
  async function removeStar(starId: string) {
    if (!confirm("Remove this message from Stars?")) return;
    const star = await db.stars.get(starId);
    await db.transaction("rw", db.stars, db.messages, async () => {
      await db.stars.delete(starId);
      if (star) await db.messages.update(star.messageId, { starred: false, updatedAt: now() });
    });
    setOpenStar(undefined);
    await load();
  }
  return (
    <Page>
      {stars.length === 0 && <EmptyState title="No stars yet" body="Star chat messages to collect them here." />}
      {stars.map((star) => (
        <article
          className="star-card"
          key={star.id}
          role="button"
          tabIndex={0}
          onClick={() => setOpenStar(star)}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              setOpenStar(star);
            }
          }}
        >
          <small>{star.role} - {formatDate(star.updatedAt)}</small>
          <div className="star-card-preview"><MarkdownText text={star.bodyCopy} /></div>
        </article>
      ))}
      {openStar && <div className="modal-backdrop" onClick={() => setOpenStar(undefined)}><section className="star-modal" onClick={(event) => event.stopPropagation()}><small>{openStar.role} - {formatDate(openStar.updatedAt)}</small><div className="star-modal-body"><MarkdownText text={openStar.bodyCopy} /></div><div className="split-actions"><button onClick={() => setOpenStar(undefined)}>Close</button><button className="danger" onClick={() => removeStar(openStar.id)}><Trash2 size={18} /> Delete star</button></div></section></div>}
    </Page>
  );
}

function DataSettingsContent() {
  const [importStatus, setImportStatus] = useState("");
  const [auditStorage, setAuditStorage] = useState({ bytes: 0, messages: 0 });
  const [auditClearStep, setAuditClearStep] = useState<1 | 2>();
  const [auditStatus, setAuditStatus] = useState("");
  const [recoverySnapshots, setRecoverySnapshots] = useState<RecoverySnapshot[]>([]);
  const [recoveryStatus, setRecoveryStatus] = useState("");
  async function loadAuditStorage() {
    const messages = await db.messages.filter((message) => Boolean(message.requestInfo?.audit)).toArray();
    const bytes = messages.reduce((total, message) => total + new Blob([JSON.stringify(message.requestInfo?.audit)]).size, 0);
    setAuditStorage({ bytes, messages: messages.length });
  }
  async function loadRecoverySnapshots() {
    setRecoverySnapshots(await listRecoverySnapshots());
  }
  useEffect(() => {
    void loadAuditStorage();
    void loadRecoverySnapshots();
    window.addEventListener("mirror:recovery-snapshot", loadRecoverySnapshots);
    return () => window.removeEventListener("mirror:recovery-snapshot", loadRecoverySnapshots);
  }, []);
  async function downloadFullBackup() {
    if (!confirm("Generate a complete portable backup of all Mirror data except the API key?")) return;
    try {
      downloadJson("mirror-full-backup.json", await createFullBackup());
      setImportStatus("Full backup downloaded.");
    } catch (error) {
      setImportStatus(error instanceof Error ? error.message : "Backup failed.");
    }
  }
  async function readBackup(file: File | undefined) {
    if (!file) return;
    try {
      return await parseAndValidateBackup(await file.text());
    } catch (error) {
      setImportStatus(error instanceof Error ? error.message : "Import failed.");
      return undefined;
    }
  }
  function backupSummary(backup: { createdAt: string; tableCounts: Record<string, number> }) {
    const total = Object.values(backup.tableCounts).reduce((sum, count) => sum + count, 0);
    return `${formatDate(new Date(backup.createdAt).getTime())}; ${total} records across ${Object.keys(backup.tableCounts).length} tables.`;
  }
  async function mergeImport(file: File | undefined) {
    const backup = await readBackup(file);
    if (!backup) return;
    if (!confirm(`Merge this full backup into the current data? Existing records with matching IDs will be updated; records not in the backup will remain.\n\n${backupSummary(backup)}`)) return;
    try {
      await mergeFullBackup(backup);
      setImportStatus("Merge import complete.");
    } catch (error) {
      setImportStatus(error instanceof Error ? error.message : "Merge import failed.");
    }
  }
  async function fullRestore(file: File | undefined) {
    const backup = await readBackup(file);
    if (!backup) return;
    if (!confirm(`FULL RESTORE replaces all current Mirror data with this backup. The API key is not included in backups and will be removed. Continue?\n\n${backupSummary(backup)}`)) return;
    try {
      await replaceWithFullBackup(backup);
      setImportStatus("Full restore verified. Reloading…");
      location.reload();
    } catch (error) {
      setImportStatus(error instanceof Error ? error.message : "Full restore failed; current data was left unchanged.");
    }
  }
  async function createRecovery() {
    try {
      const snapshot = await createRecoverySnapshot();
      setRecoveryStatus(`Backup ${snapshot.slot} created and verified.`);
      await loadRecoverySnapshots();
    } catch (error) {
      setRecoveryStatus(error instanceof Error ? error.message : "Recovery backup failed.");
    }
  }
  async function restoreRecovery(slot: RecoverySlot) {
    if (!confirm(`Restore Backup ${slot}? This replaces all current Mirror data. The API key is not part of recovery snapshots and will be removed.`)) return;
    try {
      await restoreRecoverySnapshot(slot);
      setRecoveryStatus(`Backup ${slot} restored and verified. Reloading…`);
      location.reload();
    } catch (error) {
      setRecoveryStatus(error instanceof Error ? error.message : "Recovery restore failed; current data was left unchanged.");
    }
  }
  async function clearAll() {
    if (!confirm("Back up first if you need this data. Continue to clear all local Mirror data?")) return;
    if (prompt("Type DELETE MIRROR DATA to permanently clear local data.") !== "DELETE MIRROR DATA") return;
    await db.delete();
    location.reload();
  }
  async function clearAudits() {
    await db.messages.filter((message) => Boolean(message.requestInfo?.audit)).modify((message) => {
      if (!message.requestInfo) return;
      const { audit: _audit, ...requestInfo } = message.requestInfo;
      message.requestInfo = requestInfo;
    });
    setAuditClearStep(undefined);
    setAuditStatus("Response audits cleared.");
    await loadAuditStorage();
  }
  return <>
    <section className="panel stack audit-storage-panel">
      <div className="section-title"><h2>Response Audit Storage</h2><span>{formatByteSize(auditStorage.bytes)}</span></div>
      <p className="notice">{auditStorage.messages ? `${auditStorage.messages} assistant response${auditStorage.messages === 1 ? "" : "s"} currently retain an audit.` : "No response audits are stored yet."}</p>
      <div className="split-actions"><button className="danger" disabled={!auditStorage.messages} onClick={() => setAuditClearStep(1)}><Trash2 size={17} /> Clear response audits</button>{auditStatus && <span className="save-status">{auditStatus}</span>}</div>
    </section>
    <section className="panel stack">
      <div className="section-title"><h2>Portable Full Backup</h2></div>
      <p className="notice">Exports every current Mirror table, including attachments, but excludes the API key. Keep the downloaded file outside Chrome for protection against browser storage loss.</p>
      <div className="split-actions"><button onClick={downloadFullBackup}><Download size={18} /> Download Full Backup</button><label className="file-pick"><Upload size={18} /> Merge Import<input type="file" accept="application/json" onChange={(event) => void mergeImport(event.target.files?.[0])} /></label><label className="file-pick danger"><Upload size={18} /> Full Restore<input type="file" accept="application/json" onChange={(event) => void fullRestore(event.target.files?.[0])} /></label></div>
      {importStatus && <p className="save-status">{importStatus}</p>}
    </section>
    <section className="panel stack">
      <div className="section-title"><h2>Local Recovery Backups</h2><button onClick={() => void createRecovery()}><Save size={18} /> Create snapshot</button></div>
      <p className="notice">Mirror keeps only Backup A and Backup B in a separate local database. They protect against app-level data damage, not Chrome clearing this site’s storage.</p>
      {(["A", "B"] as RecoverySlot[]).map((slot) => {
        const snapshot = recoverySnapshots.find((item) => item.slot === slot);
        const newest = snapshot && recoverySnapshots.every((item) => item.slot === slot || item.createdAt <= snapshot.createdAt);
        return <div className="mini-row" key={slot}><strong>Backup {slot}</strong><small>{snapshot ? `${formatDate(new Date(snapshot.createdAt).getTime())}${newest ? " — newest" : ""}` : "Not created yet"}</small>{snapshot && <button className="danger" onClick={() => void restoreRecovery(slot)}>Restore {slot}</button>}</div>;
      })}
      {recoveryStatus && <p className="save-status">{recoveryStatus}</p>}
    </section>
    <button className="danger separated" onClick={clearAll}><Trash2 size={18} /> Clear All</button>
    {auditClearStep && <div className="modal-backdrop confirm-backdrop" onClick={() => setAuditClearStep(undefined)}><section className="confirm-modal" onClick={(event) => event.stopPropagation()}><div className="section-title"><h2>{auditClearStep === 1 ? "Clear response audits?" : "Clear them permanently?"}</h2><button className="icon-button" onClick={() => setAuditClearStep(undefined)} aria-label="Cancel"><X size={18} /></button></div>{auditClearStep === 1 ? <p>This removes {formatByteSize(auditStorage.bytes)} of stored audit snapshots from {auditStorage.messages} assistant response{auditStorage.messages === 1 ? "" : "s"}. Messages, tool results, memories, inventory updates, and all other data stay intact.</p> : <p>This is the final confirmation. The audit details cannot be recovered unless they exist in a backup.</p>}<div className="split-actions">{auditClearStep === 1 ? <button className="danger" onClick={() => setAuditClearStep(2)}>Continue</button> : <button className="danger" onClick={() => void clearAudits()}><Trash2 size={17} /> Clear audits</button>}<button onClick={() => setAuditClearStep(undefined)}>Cancel</button></div></section></div>}
  </>;
}

function Segment<T extends string>({ label, value, options, labels, onChange }: { label: string; value: T; options: T[]; labels?: Partial<Record<T, string>>; onChange: (value: T) => void }) {
  return <label>{label}<div className="segment">{options.map((option) => <button key={option} className={option === value ? "picked" : ""} onClick={() => onChange(option)}>{labels?.[option] ?? option}</button>)}</div></label>;
}

function InlineSegment<T extends string>({ label, value, options, labels, onChange }: { label: string; value: T; options: T[]; labels?: Partial<Record<T, string>>; onChange: (value: T) => void }) {
  return (
    <div className="settings-choice-row">
      <span>{label}</span>
      <div className="settings-choice-buttons">{options.map((option) => <button key={option} className={option === value ? "picked" : ""} onClick={() => onChange(option)}>{labels?.[option] ?? option}</button>)}</div>
    </div>
  );
}

function SettingsSlider<T extends string>({ label, value, options, unit, onChange }: { label: string; value: T; options: T[]; unit: string; onChange: (value: T) => void }) {
  const activeIndex = Math.max(0, options.indexOf(value));
  const listId = `${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-ticks`;
  return (
    <label className="settings-slider">{label}: {value}{unit}
      <input type="range" min={0} max={options.length - 1} step={1} value={activeIndex} list={listId} onChange={(event) => onChange(options[Number(event.target.value)] ?? options[0])} />
      <datalist id={listId}>{options.map((option, index) => <option key={option} value={index} label={`${option}${unit}`} />)}</datalist>
      <div className="settings-slider-ticks" aria-hidden="true">{options.map((option) => <span key={option}>{option}{unit}</span>)}</div>
    </label>
  );
}

function ColorSwatches({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const colors = ["#a7d8c4", "#c2a6ff", "#8bb8f7", "#e8a2b6", "#e2bf7a", "#7bd4d0", "#d8d3c7", "#d98f8f"];
  return <div className="swatches">{colors.map((color) => <button key={color} className={value === color ? "picked" : ""} style={{ background: color }} onClick={() => onChange(color)} />)}</div>;
}

function Page({ children }: { children: React.ReactNode }) {
  return <div className="page">{children}</div>;
}
