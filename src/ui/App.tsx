import type React from "react";
import { useEffect, useMemo, useRef, useState } from "react";
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
  Clipboard,
  FileText,
  Folder,
  Image as ImageIcon,
  KeyRound,
  Menu,
  MessageSquare,
  Plus,
  RefreshCw,
  Save,
  Search,
  Settings,
  Shield,
  Star,
  Trash2,
  Upload,
  UserRound,
  X
} from "lucide-react";
import { db, ensureSeedData } from "../data/db";
import {
  abilities,
  addMessage,
  createChat,
  createMemory,
  createProject,
  getCharacterBio,
  getCharacterIdentity,
  getCharacterStats,
  normaliseInventoryName,
  searchMemories,
  validatePointBuy
} from "../data/repositories";
import { defaultMemoryInstruction, defaultSettings } from "../data/defaults";
import { Ability, AppSettings, Character, CharacterBonus, Chat, InventoryKind, InventoryItem, InventoryLog, Memory, Message, Project, RouteName } from "../types";
import { estimateTokens, formatDate, normaliseTag, now, splitTags, uid } from "../utils";
import { ProjectIcon, projectIcons } from "./icons";

const accents = [
  { name: "sage", value: "#8fbea8" },
  { name: "violet", value: "#b7a1e8" },
  { name: "blue", value: "#82aee6" },
  { name: "rose", value: "#d993a8" },
  { name: "amber", value: "#d3aa66" },
  { name: "teal", value: "#72bfc2" },
  { name: "clay", value: "#c58f78" },
  { name: "silver", value: "#b9bdc7" }
] as const;

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
  sourceFiles: "Source Files",
  api: "API",
  data: "Data",
  settings: "Settings"
};

function fontSizeLabel(size: number) {
  if (size <= 12) return "XS";
  if (size <= 14) return "Small";
  if (size <= 16) return "Standard";
  if (size <= 18) return "Large";
  if (size <= 20) return "XL";
  if (size <= 22) return "XXL";
  return "Huge";
}

function formatMessageDate(timestamp: number) {
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(timestamp);
}

function optionalNumber(value: string) {
  if (value.trim() === "") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function openRouterContent(text: string, images: { dataUrl: string; mimeType: string }[]) {
  if (!images.length) return text;
  return [
    { type: "text", text },
    ...images.map((image) => ({ type: "image_url", image_url: { url: image.dataUrl } }))
  ];
}

function fileToDataUrl(file: File) {
  return new Promise<{ dataUrl: string; mimeType: string }>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve({ dataUrl: String(reader.result), mimeType: file.type });
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
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
  const [profileCharacterId, setProfileCharacterId] = useState<string>();
  const [models, setModels] = useState<{ modelId: string; cosmeticName: string }[]>([]);
  const [selectedModelId, setSelectedModelId] = useState("");
  const [inventoryOpen, setInventoryOpen] = useState(false);
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const selectedProject = projects.find((project) => project.id === selectedProjectId);
  const editingProject = projects.find((project) => project.id === (editingProjectId ?? selectedProjectId));
  const selectedChat = chats.find((chat) => chat.id === selectedChatId);

  async function refresh() {
    const [nextSettings, nextProjects, nextChats] = await Promise.all([
      db.settings.get("settings"),
      db.projects.orderBy("orderIndex").toArray(),
      selectedProjectId ? db.chats.where("projectId").equals(selectedProjectId).reverse().sortBy("updatedAt") : Promise.resolve([])
    ]);
    setSettings(nextSettings ?? defaultSettings());
    setProjects(nextProjects);
    setChats(nextChats);
    const nextModels = await db.modelLibrary.orderBy("orderIndex").toArray();
    setModels(nextModels);
    setSelectedModelId((current) => current || nextSettings?.defaultModelId || nextModels[0]?.modelId || "");
    const activeChat = selectedChatId ? await db.chats.get(selectedChatId) : undefined;
    if (activeChat) {
      const rows = await db.messages
        .where("[chatId+branchId+sequence]")
        .between([activeChat.id, activeChat.activeBranchId, Dexie.minKey], [activeChat.id, activeChat.activeBranchId, Dexie.maxKey])
        .toArray();
      setMessages(rows);
    } else {
      setMessages([]);
    }
  }

  useEffect(() => {
    ensureSeedData().then(async () => {
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
    document.documentElement.style.setProperty("--app-font-size", `${settings.fontScale ?? 16}px`);
    document.documentElement.style.setProperty("--entry-width", `${settings.entryWidth}%`);
    document.documentElement.style.setProperty("--message-gap", `${settings.messageSpacing}px`);
    document.documentElement.style.setProperty("--accent", accents.find((accent) => accent.name === settings.accent)?.value ?? accents[0].value);
  }, [settings]);

  const projectChats = useMemo(() => chats.filter((chat) => chat.projectId === selectedProjectId), [chats, selectedProjectId]);
  const title = route === "chat"
    ? selectedProject?.name ?? "Choose a project"
    : selectedProject && ["stars", "archives", "archiveEntries", "characters", "characterProfile", "memories", "compaction", "sourceFiles"].includes(route)
      ? `${selectedProject.name} / ${routeLabels[route]}`
      : routeLabels[route];

  if (!ready) return <div className="loading">Mirror 2.0</div>;

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
        onMenu={() => setDrawerOpen(true)}
        right={route === "chat" && selectedProject ? (
          <div className="header-actions">
            {(selectedProject.inventoryEnabled || selectedProject.gearEnabled) && <button className="inventory-trigger" onClick={() => setInventoryOpen(true)}>INV</button>}
            <select className="header-model-picker" value={selectedModelId} onChange={async (event) => { setSelectedModelId(event.target.value); await db.settings.update("settings", { defaultModelId: event.target.value, updatedAt: now() }); }}>
              <option value="">Model</option>
              {models.map((model) => <option value={model.modelId} key={model.modelId}>{model.cosmeticName}</option>)}
            </select>
          </div>
        ) : undefined}
      />
      {selectedProject && <InventoryDrawer open={inventoryOpen} project={selectedProject} onClose={() => setInventoryOpen(false)} onRefresh={refresh} />}
      <Drawer
        open={drawerOpen}
        projects={projects}
        selectedProjectId={selectedProjectId}
        chats={projectChats}
        selectedChatId={selectedChatId}
        onClose={() => setDrawerOpen(false)}
        onRoute={(nextRoute) => {
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
          setSelectedChatId(id);
          setRoute("chat");
          setDrawerOpen(false);
        }}
      />
      <main className="screen">
        {route === "chat" && (
          <ChatScreen
            project={selectedProject}
            chat={selectedChat}
            messages={messages}
            settings={settings}
            onRefresh={refresh}
            onChatCreated={setSelectedChatId}
            onRoute={setRoute}
            selectedModelId={selectedModelId}
          />
        )}
        {route === "projects" && <ProjectsPage projects={projects} selectedProjectId={selectedProjectId} onSelect={setSelectedProjectId} onEdit={(id) => { setEditingProjectId(id); setRoute("projectEdit"); }} onRefresh={refresh} />}
        {route === "projectEdit" && editingProject && <ProjectEditPage project={editingProject} onRefresh={refresh} onDone={() => setRoute("projects")} />}
        {route === "stars" && <StarsPage project={selectedProject} />}
        {route === "archives" && <ArchivesPage project={selectedProject} />}
        {route === "characters" && <CharactersPage project={selectedProject} onOpenProfile={(id) => { setProfileCharacterId(id); setRoute("characterProfile"); }} />}
        {route === "characterProfile" && selectedProject && profileCharacterId && <CharacterProfilePage project={selectedProject} characterId={profileCharacterId} onBack={() => setRoute("characters")} onDeleted={() => { setProfileCharacterId(undefined); setRoute("characters"); }} />}
        {route === "memories" && <MemoriesPage project={selectedProject} />}
        {route === "compaction" && selectedChat && <CompactionPage chat={selectedChat} onRefresh={refresh} />}
        {route === "sourceFiles" && <SourceFilesPage project={selectedProject} />}
        {route === "settings" && <SettingsPage settings={settings} onRefresh={refresh} />}
      </main>
    </div>
  );
}

function Header({ title, subtitle, onMenu, right }: { title: string; subtitle?: string; onMenu: () => void; right?: React.ReactNode }) {
  return (
    <header className="topbar">
      <button className="icon-button" onClick={onMenu} aria-label="Open navigation">
        <Menu size={22} />
      </button>
      <div className="brand-mini">
        <MothMark />
        <div className="title-stack"><strong>{title}</strong>{subtitle && <span>{subtitle}</span>}</div>
      </div>
      <div className="header-right">{right}</div>
    </header>
  );
}

function InventoryDrawer({ open, project, onClose, onRefresh }: { open: boolean; project: Project; onClose: () => void; onRefresh: () => Promise<void> }) {
  const defaultTab = project.inventoryEnabled ? "inventory" : "gear";
  const [tab, setTab] = useState<"inventory" | "gear" | "log">(defaultTab);
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [logs, setLogs] = useState<InventoryLog[]>([]);
  const [currencyAmount, setCurrencyAmount] = useState(project.currencyAmount?.toString() ?? "");
  const [saved, showSaved] = useSavedNotice();
  useEffect(() => {
    setCurrencyAmount(project.currencyAmount?.toString() ?? "");
    setTab(project.inventoryEnabled ? "inventory" : "gear");
  }, [project.id, project.inventoryEnabled, project.gearEnabled, project.currencyAmount]);
  async function load() {
    const [nextItems, nextLogs] = await Promise.all([
      db.inventoryItems.where("projectId").equals(project.id).toArray(),
      db.inventoryLogs.where("projectId").equals(project.id).reverse().sortBy("updatedAt")
    ]);
    setItems(nextItems.sort((a, b) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name)));
    setLogs(nextLogs);
  }
  useEffect(() => { if (open) load(); }, [open, project.id]);
  if (!open) return null;
  const shownItems = items.filter((item) => item.kind === tab);
  async function saveCurrency() {
    await db.projects.update(project.id, { currencyAmount: currencyAmount === "" ? undefined : Number(currencyAmount), updatedAt: now() });
    showSaved();
    await onRefresh();
  }
  async function addItem(kind: InventoryKind) {
    const timestamp = now();
    await db.inventoryItems.add({ id: uid(), projectId: project.id, kind, name: "", normalisedName: "", quantity: 1, createdAt: timestamp, updatedAt: timestamp });
    await load();
  }
  return (
    <>
      <button className="drawer-backdrop" onClick={onClose} aria-label="Close inventory" />
      <aside className="inventory-drawer">
        <div className="section-title">
          <h2>Inventory</h2>
          <button className="icon-button" onClick={onClose} aria-label="Close inventory"><X size={20} /></button>
        </div>
        <div className="settings-tabs">
          {project.inventoryEnabled && <button className={tab === "inventory" ? "picked" : ""} onClick={() => setTab("inventory")}>Items</button>}
          {project.gearEnabled && <button className={tab === "gear" ? "picked" : ""} onClick={() => setTab("gear")}>Gear</button>}
          <button className={tab === "log" ? "picked" : ""} onClick={() => setTab("log")}>Log</button>
        </div>
        {tab === "inventory" && project.inventoryEnabled && (
          <div className="stack">
            {project.currencyName && <div className="currency-row"><input type="number" value={currencyAmount} onChange={(event) => setCurrencyAmount(event.target.value)} /><span>{project.currencyName}</span><button onClick={saveCurrency}><Save size={16} /></button>{saved && <span className="save-status">Saved</span>}</div>}
            {shownItems.map((item) => <InventoryItemRow key={item.id} item={item} onRefresh={load} />)}
            <button onClick={() => addItem("inventory")}><Plus size={18} /> Add item</button>
          </div>
        )}
        {tab === "gear" && project.gearEnabled && (
          <div className="stack">
            {shownItems.map((item) => <InventoryItemRow key={item.id} item={item} onRefresh={load} />)}
            <button onClick={() => addItem("gear")}><Plus size={18} /> Add gear</button>
          </div>
        )}
        {tab === "log" && <InventoryLogList logs={logs} onRefresh={load} />}
      </aside>
    </>
  );
}

function InventoryItemRow({ item, onRefresh }: { item: InventoryItem; onRefresh: () => Promise<void> }) {
  const [name, setName] = useState(item.name);
  const [quantity, setQuantity] = useState(item.quantity);
  useEffect(() => {
    setName(item.name);
    setQuantity(item.quantity);
  }, [item.id, item.name, item.quantity]);
  async function save(nextQuantity = quantity) {
    const singular = normaliseInventoryName(name);
    await db.inventoryItems.update(item.id, { name: singular, normalisedName: singular, quantity: Math.max(0, nextQuantity), updatedAt: now() });
    await onRefresh();
  }
  return (
    <div className="inventory-row">
      <input value={name} onChange={(event) => setName(event.target.value)} onBlur={() => save()} placeholder={item.kind === "gear" ? "gear name" : "item name"} />
      <button onClick={() => { const next = Math.max(0, quantity - 1); setQuantity(next); save(next); }}>-</button>
      <input type="number" value={quantity} onChange={(event) => setQuantity(Number(event.target.value))} onBlur={() => save()} />
      <button onClick={() => { const next = quantity + 1; setQuantity(next); save(next); }}>+</button>
    </div>
  );
}

function InventoryLogList({ logs, onRefresh }: { logs: InventoryLog[]; onRefresh: () => Promise<void> }) {
  const [activeLogId, setActiveLogId] = useState<string>();
  const [editLogId, setEditLogId] = useState<string>();
  const [draft, setDraft] = useState("");
  const [pressTimer, setPressTimer] = useState<number>();
  async function remove(id: string) {
    if (!confirm("Delete this inventory log entry?")) return;
    await db.inventoryLogs.delete(id);
    setActiveLogId(undefined);
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
          {activeLogId === log.id && <div className="context-menu"><button onClick={() => { setDraft(log.sentence); setEditLogId(log.id); }}>Edit</button><button className="danger" onClick={() => remove(log.id)}>Delete</button></div>}
          {editLogId === log.id && <button onClick={() => save(log.id)}><Save size={16} /> Save</button>}
        </section>
      ))}
    </div>
  );
}

function MothMark() {
  return (
    <svg className="moth" viewBox="0 0 48 48" aria-hidden="true">
      <path d="M24 7 14 20l10 22 10-22z" />
      <path d="M21 18 5 10l7 22 9-4M27 18l16-8-7 22-9-4" />
      <path d="M24 7v35" />
    </svg>
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
}) {
  const visibleProjects = props.projects.slice(0, 4);
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
        <DrawerSection title="Projects" action={<button className="link-button" onClick={() => props.onRoute("projects")}>View All</button>}>
          <ProjectList projects={visibleProjects} selectedProjectId={props.selectedProjectId} onProject={props.onProject} />
        </DrawerSection>
        {props.selectedProjectId ? (
          <DrawerSection title={`Project Tools - ${props.projects.find((project) => project.id === props.selectedProjectId)?.name ?? "Project"}`}>
            {(["stars", "characters", "archives", "memories", "sourceFiles", "projectEdit"] as RouteName[]).map((route) => (
              <button className="nav-row" key={route} onClick={() => props.onRoute(route)}>
                {routeIcon(route)} {routeLabels[route]}
              </button>
            ))}
          </DrawerSection>
        ) : (
          <p className="muted-pad">Choose a project before starting a chat.</p>
        )}
        <DrawerSection title="Chats">
          {props.chats.length === 0 && <p className="muted-pad">No chats yet.</p>}
          {props.chats.map((chat) => (
            <button key={chat.id} className={`nav-row ${chat.id === props.selectedChatId ? "active" : ""}`} onClick={() => props.onChat(chat.id)}>
              <MessageSquare size={18} /> {chat.title}
            </button>
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
  return (
    <section className="drawer-section">
      <div className="section-title"><h2>{title}</h2>{action}</div>
      {children}
    </section>
  );
}

function ProjectList({ projects, selectedProjectId, onProject }: { projects: Project[]; selectedProjectId?: string; onProject: (id: string) => void }) {
  return (
    <>
      {projects.map((project) => (
        <div className="nav-project" key={project.id}>
          <button
            className={`nav-row ${project.id === selectedProjectId ? "active" : ""}`}
            onClick={() => onProject(project.id)}
          >
            <ProjectIcon name={project.iconName} color={project.iconColor} /> {project.name}
          </button>
        </div>
      ))}
    </>
  );
}

function routeIcon(route: RouteName) {
  const icons: Partial<Record<RouteName, JSX.Element>> = {
    stars: <Star size={18} />,
    characters: <UserRound size={18} />,
    archives: <Archive size={18} />,
    memories: <BookOpen size={18} />,
    projects: <Archive size={18} />,
    projectEdit: <Settings size={18} />,
    sourceFiles: <Folder size={18} />
  };
  return icons[route] ?? <MessageSquare size={18} />;
}

function ChatScreen({
  project,
  chat,
  messages,
  settings,
  onRefresh,
  onChatCreated,
  onRoute,
  selectedModelId
}: {
  project?: Project;
  chat?: Chat;
  messages: Message[];
  settings: AppSettings;
  onRefresh: () => Promise<void>;
  onChatCreated: (id: string) => void;
  onRoute: (route: RouteName) => void;
  selectedModelId: string;
}) {
  const [body, setBody] = useState("");
  const [contextOpen, setContextOpen] = useState(false);
  const [includeWorld, setIncludeWorld] = useState(true);
  const [includeInstructions, setIncludeInstructions] = useState(true);
  const [includeCharacters, setIncludeCharacters] = useState(false);
  const [includeSourceFiles, setIncludeSourceFiles] = useState(settings.includeSourceFiles ?? false);
  const [temperature, setTemperature] = useState(settings.temperature?.toString() ?? "0");
  const [topP, setTopP] = useState(settings.topP?.toString() ?? "0");
  const [maxTokens, setMaxTokens] = useState(settings.maxTokens?.toString() ?? "");
  const [maxHistory, setMaxHistory] = useState(settings.maxHistoryMessages?.toString() ?? "");
  const [historyNoLimit, setHistoryNoLimit] = useState(!settings.maxHistoryMessages);
  const [compactionEnabled, setCompactionEnabled] = useState(settings.compactionEnabled ?? false);
  const [streamingEnabled, setStreamingEnabled] = useState(settings.streamingEnabled ?? false);
  const [attachedImages, setAttachedImages] = useState<File[]>([]);
  const [expandedMessageId, setExpandedMessageId] = useState<string>();
  const composerRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const composer = composerRef.current;
    if (!composer) return;
    composer.style.height = "auto";
    composer.style.height = `${Math.min(composer.scrollHeight, 240)}px`;
  }, [body]);
  async function updateProjectInventorySetting(patch: Partial<Pick<Project, "inventoryEnabled" | "gearEnabled">>) {
    if (!project) return;
    await db.projects.update(project.id, { ...patch, updatedAt: now() });
    await onRefresh();
  }
  async function send() {
    if (!project || !body.trim()) return;
    if (!settings.apiKey) {
      alert("Add your OpenRouter API key before sending AI requests. Your draft is still here.");
      return;
    }
    if (!selectedModelId) {
      alert("Choose a model before sending.");
      return;
    }
    const text = body.trim();
    setBody("");
    let chatId = chat?.id;
    let branchId = chat?.activeBranchId;
    if (!chatId || !branchId) {
      chatId = await createChat(project.id, text);
      const created = await db.chats.get(chatId);
      branchId = created?.activeBranchId;
      onChatCreated(chatId);
    } else {
      await addMessage(chatId, branchId, "user", text);
    }
    if (chatId && branchId) {
      const timestamp = now();
      await db.settings.update("settings", {
        temperature: optionalNumber(temperature),
        topP: optionalNumber(topP),
        maxTokens: optionalNumber(maxTokens),
        maxHistoryMessages: historyNoLimit ? undefined : optionalNumber(maxHistory),
        compactionEnabled,
        includeSourceFiles,
        streamingEnabled,
        updatedAt: timestamp
      });
      const sourceFiles = includeSourceFiles
        ? await db.sourceFiles.where("projectId").equals(project.id).and((file) => Boolean(file.textContent)).toArray()
        : [];
      const activeChat = await db.chats.get(chatId);
      const systemParts = [
        `Project: ${project.name}`,
        includeInstructions && project.instructions ? `Project instructions:\n${project.instructions}` : "",
        includeWorld && project.worldSetting ? `World setting:\n${project.worldSetting}` : "",
        compactionEnabled && activeChat?.compactionMemory ? `Compaction memory:\n${activeChat.compactionMemory}` : "",
        sourceFiles.length ? `Source files:\n${sourceFiles.map((file) => `# ${file.name}\n${file.textContent}`).join("\n\n")}` : ""
      ].filter(Boolean);
      const allHistory = await db.messages
        .where("[chatId+branchId+sequence]")
        .between([chatId, branchId, Dexie.minKey], [chatId, branchId, Dexie.maxKey])
        .toArray();
      const historyLimit = historyNoLimit ? undefined : optionalNumber(maxHistory);
      const selectedHistory = historyLimit ? allHistory.slice(-historyLimit) : allHistory;
      const images = await Promise.all(attachedImages.map(fileToDataUrl));
      const requestMessages = [
        ...(systemParts.length ? [{ role: "system", content: systemParts.join("\n\n") }] : []),
        ...selectedHistory.map((message) => ({
          role: message.role === "system" ? "system" : message.role === "assistant" ? "assistant" : "user",
          content: message.id === allHistory[allHistory.length - 1]?.id ? openRouterContent(message.body, images) : message.body
        }))
      ];
      const requestInfo = {
        settings: [
          `Model: ${selectedModelId}`,
          `Temperature: ${temperature || "0"}`,
          `Top P: ${topP || "0"}`,
          `Max output: ${maxTokens || "no limit"}`,
          historyNoLimit ? "History: no limit" : `History: ${maxHistory || "not set"} messages`,
          `Streaming: ${streamingEnabled ? "on" : "off"}`
        ],
        toggles: [
          `World setting: ${includeWorld ? "on" : "off"}`,
          `Instructions: ${includeInstructions ? "on" : "off"}`,
          `Characters: ${includeCharacters ? "on" : "off"}`,
          `Source files: ${includeSourceFiles ? "on" : "off"}`,
          `Compaction memory: ${compactionEnabled ? "on" : "off"}`,
          `Images: ${attachedImages.length}`
        ],
        toolCalls: ["None"]
      };
      const reply = await addMessage(chatId, branchId, "assistant", streamingEnabled ? "" : "...");
      await db.messages.update(reply.id, { modelId: selectedModelId, status: streamingEnabled ? "streaming" : "pending", requestInfo });
      await onRefresh();
      const payload: Record<string, unknown> = {
        model: selectedModelId,
        messages: requestMessages,
        stream: streamingEnabled
      };
      const temperatureValue = optionalNumber(temperature || "0");
      const topPValue = optionalNumber(topP || "0");
      const maxTokensValue = optionalNumber(maxTokens);
      if (temperatureValue !== undefined) payload.temperature = temperatureValue;
      if (topPValue !== undefined) payload.top_p = topPValue;
      if (maxTokensValue !== undefined) payload.max_tokens = maxTokensValue;
      if (streamingEnabled) payload.stream_options = { include_usage: true };
      try {
        const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${settings.apiKey}`,
            "Content-Type": "application/json",
            "HTTP-Referer": location.origin,
            "X-Title": "Mirror 2.0"
          },
          body: JSON.stringify(payload)
        });
        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(errorText || `OpenRouter request failed (${response.status})`);
        }
        if (streamingEnabled && response.body) {
          const reader = response.body.getReader();
          const decoder = new TextDecoder();
          let buffer = "";
          let replyText = "";
          let inputTokens: number | undefined;
          let outputTokens: number | undefined;
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split("\n");
            buffer = lines.pop() ?? "";
            for (const line of lines) {
              const clean = line.trim();
              if (!clean.startsWith("data:")) continue;
              const data = clean.slice(5).trim();
              if (data === "[DONE]") continue;
              const chunk = JSON.parse(data) as { choices?: { delta?: { content?: string } }[]; usage?: { prompt_tokens?: number; completion_tokens?: number } };
              replyText += chunk.choices?.[0]?.delta?.content ?? "";
              inputTokens = chunk.usage?.prompt_tokens ?? inputTokens;
              outputTokens = chunk.usage?.completion_tokens ?? outputTokens;
              await db.messages.update(reply.id, { body: replyText, outputTokens: estimateTokens(replyText), updatedAt: now() });
              await onRefresh();
            }
          }
          await db.messages.update(reply.id, { body: replyText || "(No response text returned.)", inputTokens, outputTokens: outputTokens ?? estimateTokens(replyText), estimatedTokens: !outputTokens, status: "complete", updatedAt: now() });
        } else {
          const json = await response.json() as { choices?: { message?: { content?: string } }[]; usage?: { prompt_tokens?: number; completion_tokens?: number } };
          const replyText = json.choices?.[0]?.message?.content ?? "";
          await db.messages.update(reply.id, {
            body: replyText || "(No response text returned.)",
            inputTokens: json.usage?.prompt_tokens,
            outputTokens: json.usage?.completion_tokens ?? estimateTokens(replyText),
            estimatedTokens: !json.usage?.completion_tokens,
            status: "complete",
            updatedAt: now()
          });
        }
      } catch (error) {
        await db.messages.update(reply.id, {
          body: "OpenRouter request failed.",
          error: error instanceof Error ? error.message : "Unknown error",
          status: "failed",
          updatedAt: now()
        });
      }
    }
    setAttachedImages([]);
    await onRefresh();
  }

  if (!project) {
    return <EmptyState title="Choose a project" body="Open the sidebar and select a project before starting a chat." />;
  }

  return (
    <div className="chat-screen">
      {!chat && messages.length === 0 && <EmptyState title="Ready when you are" body="Start a new project chat from the composer." />}
      <div className={`message-list ${settings.bubbleMode === "minimal" ? "minimal" : "bubbles"}`}>
        {messages.map((message) => (
          <MessageRow
            key={message.id}
            projectId={project.id}
            message={message}
            expanded={expandedMessageId === message.id}
            onExpand={() => setExpandedMessageId(expandedMessageId === message.id ? undefined : message.id)}
            onRefresh={onRefresh}
          />
        ))}
      </div>
      <section className="composer">
        {contextOpen && (
          <div className="context-popover">
            <label className="file-pick"><ImageIcon size={18} /> Attach image<input type="file" accept="image/*" multiple onChange={(event) => setAttachedImages(Array.from(event.target.files ?? []))} /></label>
            <label className="compact-check"><input type="checkbox" checked={includeWorld} onChange={(event) => setIncludeWorld(event.target.checked)} /> World Setting</label>
            <label className="compact-check"><input type="checkbox" checked={includeInstructions} onChange={(event) => setIncludeInstructions(event.target.checked)} /> Instructions</label>
            <label className="compact-check"><input type="checkbox" checked={includeCharacters} onChange={(event) => setIncludeCharacters(event.target.checked)} /> Characters</label>
            <label className="compact-check"><input type="checkbox" checked={includeSourceFiles} onChange={(event) => setIncludeSourceFiles(event.target.checked)} /> Source files</label>
            <label className="compact-check"><input type="checkbox" checked={project.inventoryEnabled} onChange={(event) => updateProjectInventorySetting({ inventoryEnabled: event.target.checked })} /> Enable inventory</label>
            <label className="compact-check"><input type="checkbox" checked={project.gearEnabled} onChange={(event) => updateProjectInventorySetting({ gearEnabled: event.target.checked })} /> Enable gear</label>
            <label className="compact-check"><input type="checkbox" checked={compactionEnabled} onChange={(event) => setCompactionEnabled(event.target.checked)} /> Compaction memory</label>
            <button onClick={() => onRoute("compaction")}><BookOpen size={18} /> Open compaction memory</button>
            <label className="compact-check"><input type="checkbox" checked={streamingEnabled} onChange={(event) => setStreamingEnabled(event.target.checked)} /> Streaming</label>
            <label>Temperature<input type="number" min={0} max={2} step={0.05} value={temperature} placeholder="0" onChange={(event) => setTemperature(event.target.value)} /></label>
            <label>Top P<input type="number" min={0} max={1} step={0.05} value={topP} placeholder="0" onChange={(event) => setTopP(event.target.value)} /></label>
            <label>Max output tokens<input type="number" min={1} max={16000} value={maxTokens} placeholder="no limit" onChange={(event) => setMaxTokens(event.target.value)} /></label>
            <label className="compact-check"><input type="checkbox" checked={historyNoLimit} onChange={(event) => setHistoryNoLimit(event.target.checked)} /> No message history limit</label>
            {!historyNoLimit && <label>Message history limit<input type="number" min={10} max={500} value={maxHistory} onChange={(event) => setMaxHistory(event.target.value)} /></label>}
            {attachedImages.length > 0 && <small>{attachedImages.length} image(s) ready</small>}
          </div>
        )}
        <button className="composer-plus" onClick={() => setContextOpen(!contextOpen)} aria-label="Chat settings and attachments">
          <Plus size={20} />
        </button>
        <textarea ref={composerRef} className="composer-input" value={body} onChange={(event) => setBody(event.target.value)} placeholder="Message this project" rows={1} />
        <button className="send-button" onClick={send}>Send</button>
      </section>
    </div>
  );
}

function MessageRow({ projectId, message, expanded, onExpand, onRefresh }: { projectId: string; message: Message; expanded: boolean; onExpand: () => void; onRefresh: () => Promise<void> }) {
  const [infoOpen, setInfoOpen] = useState(false);
  async function star() {
    const { toggleStar } = await import("../data/repositories");
    await toggleStar(projectId, message);
    await onRefresh();
  }
  async function copyMessage() {
    await navigator.clipboard.writeText(message.body);
  }
  async function resend() {
    if (!confirm("Create a new branch from this point and regenerate from here? The original branch will remain stored.")) return;
    alert("Branch-safe resend is represented in the data model. API regeneration will be wired to OpenRouter next.");
  }
  return (
    <>
      <article className={`message ${message.role}`} onClick={onExpand}>
        {expanded && message.role === "assistant" && message.modelId && <div className="message-model">{message.modelId}</div>}
        <div className="message-body">{message.body}</div>
        <div className={`message-meta ${expanded ? "show" : ""}`}>
          <button aria-label="Edit message" title="Edit"><Edit3 size={16} /></button>
          <button aria-label={message.starred ? "Unstar message" : "Star message"} title={message.starred ? "Unstar" : "Star"} onClick={(event) => { event.stopPropagation(); star(); }}><Star size={16} fill={message.starred ? "currentColor" : "none"} /></button>
          <button aria-label="Copy message" title="Copy" onClick={(event) => { event.stopPropagation(); copyMessage(); }}><Clipboard size={16} /></button>
          <button aria-label="Message info" title="Info" onClick={(event) => { event.stopPropagation(); setInfoOpen(true); }}><FileText size={16} /></button>
          <span>{formatMessageDate(message.createdAt)}</span>
          <span>{message.inputTokens ?? message.outputTokens ?? estimateTokens(message.body)}t</span>
          <button className="resend" aria-label="Resend message" title="Resend" onClick={(event) => { event.stopPropagation(); resend(); }}><RefreshCw size={16} /></button>
        </div>
      </article>
      {infoOpen && <MessageInfoModal message={message} onClose={() => setInfoOpen(false)} />}
    </>
  );
}

function MessageInfoModal({ message, onClose }: { message: Message; onClose: () => void }) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <section className="star-modal message-info-modal" onClick={(event) => event.stopPropagation()}>
        <div className="section-title">
          <h2>Message Info</h2>
          <button className="icon-button" onClick={onClose} aria-label="Close message info"><X size={18} /></button>
        </div>
        <div className="info-grid">
          <span>Role</span><strong>{message.role}</strong>
          <span>Status</span><strong>{message.status}</strong>
          {message.modelId && <><span>Model</span><strong>{message.modelId}</strong></>}
          <span>Created</span><strong>{formatMessageDate(message.createdAt)}</strong>
          <span>Tokens</span><strong>{message.inputTokens ?? message.outputTokens ?? estimateTokens(message.body)}t</strong>
          {message.error && <><span>Error</span><strong>{message.error}</strong></>}
        </div>
        {message.requestInfo && (
          <div className="stack">
            <h2>Settings Used</h2>
            {message.requestInfo.settings.map((item) => <p key={item}>{item}</p>)}
            <h2>Toggles</h2>
            {message.requestInfo.toggles.map((item) => <p key={item}>{item}</p>)}
            <h2>Tool Calls</h2>
            {message.requestInfo.toolCalls.map((item) => <p key={item}>{item}</p>)}
          </div>
        )}
      </section>
    </div>
  );
}

function ProjectsPage({ projects, selectedProjectId, onSelect, onEdit, onRefresh }: { projects: Project[]; selectedProjectId?: string; onSelect: (id: string) => void; onEdit: (id: string) => void; onRefresh: () => Promise<void> }) {
  const [draftName, setDraftName] = useState("");
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
      </div>
      {projects.map((project, index) => (
        <ProjectCard key={project.id} project={project} active={project.id === selectedProjectId} index={index} total={projects.length} onSelect={onSelect} onEdit={onEdit} projects={projects} onRefresh={onRefresh} />
      ))}
    </Page>
  );
}

function ProjectCard({ project, active, index, total, onSelect, onEdit, projects, onRefresh }: { project: Project; active: boolean; index: number; total: number; onSelect: (id: string) => void; onEdit: (id: string) => void; projects: Project[]; onRefresh: () => Promise<void> }) {
  async function move(direction: -1 | 1) {
    const swap = projects[index + direction];
    if (!swap) return;
    await db.transaction("rw", db.projects, async () => {
      await db.projects.update(project.id, { orderIndex: swap.orderIndex, updatedAt: now() });
      await db.projects.update(swap.id, { orderIndex: project.orderIndex, updatedAt: now() });
    });
    await onRefresh();
  }
  async function remove() {
    if (project.locked) return;
    const count = await db.messages.where("chatId").anyOf((await db.chats.where("projectId").equals(project.id).primaryKeys()) as string[]).count();
    const ok = count > 0 ? prompt(`Deleting this project removes chats, messages, stars, archives, characters, and memories. Type DELETE ${project.name} to continue.`) === `DELETE ${project.name}` : confirm("Delete this project and its associated records?");
    if (!ok) return;
    await db.transaction("rw", [db.projects, db.chats, db.branches, db.messages, db.stars, db.archives, db.archiveEntries, db.characters, db.characterBonuses, db.memories], async () => {
      const chatIds = (await db.chats.where("projectId").equals(project.id).primaryKeys()) as string[];
      const archiveIds = (await db.archives.where("projectId").equals(project.id).primaryKeys()) as string[];
      const characterIds = (await db.characters.where("projectId").equals(project.id).primaryKeys()) as string[];
      await db.messages.where("chatId").anyOf(chatIds).delete();
      await db.branches.where("chatId").anyOf(chatIds).delete();
      await db.chats.where("projectId").equals(project.id).delete();
      await db.stars.where("projectId").equals(project.id).delete();
      await db.archiveEntries.where("archiveId").anyOf(archiveIds).delete();
      await db.archives.where("projectId").equals(project.id).delete();
      await db.characterBonuses.where("characterId").anyOf(characterIds).delete();
      await db.characters.where("projectId").equals(project.id).delete();
      await db.memories.where("projectId").equals(project.id).delete();
      await db.projects.delete(project.id);
    });
    await onRefresh();
  }
  return (
    <section className={`item-card ${active ? "selected" : ""}`}>
      <button className="item-main" onClick={() => onSelect(project.id)}>
        <ProjectIcon name={project.iconName} color={project.iconColor} size={28} />
        <span>{project.name}</span>{project.locked && <small>Locked</small>}
      </button>
      <div className="card-actions">
        <button onClick={() => onEdit(project.id)}><Edit3 size={18} /> Edit</button>
        <button disabled={index === 0} onClick={() => move(-1)}>Move Up</button>
        <button disabled={index === total - 1} onClick={() => move(1)}>Move Down</button>
        {!project.locked && <button className="danger" onClick={remove}><Trash2 size={18} /> Delete</button>}
      </div>
    </section>
  );
}

function ProjectEditPage({ project, onRefresh, onDone }: { project: Project; onRefresh: () => Promise<void>; onDone: () => void }) {
  const [draft, setDraft] = useState(project);
  const [showIconPicker, setShowIconPicker] = useState(false);
  const [saved, showSaved] = useSavedNotice();
  useEffect(() => setDraft(project), [project]);
  async function save() {
    await db.projects.put({ ...draft, updatedAt: now() });
    showSaved();
    await onRefresh();
  }
  return (
    <Page>
      <section className="item-card stack">
        <button className="project-icon-edit" onClick={() => setShowIconPicker(!showIconPicker)} aria-label="Change project icon">
          <ProjectIcon name={draft.iconName} color={draft.iconColor} size={36} />
          <span>{draft.name}</span>
        </button>
        {showIconPicker && (
          <>
            <div className="icon-grid">
              {projectIcons.map(({ name, label }) => (
                <button key={name} className={draft.iconName === name ? "picked" : ""} onClick={() => setDraft({ ...draft, iconName: name })} aria-label={label}>
                  <ProjectIcon name={name} color={draft.iconColor} />
                </button>
              ))}
            </div>
            <ColorSwatches value={draft.iconColor} onChange={(iconColor) => setDraft({ ...draft, iconColor })} />
          </>
        )}
        <label>Name<input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></label>
        <label className="compact-check"><input type="checkbox" checked={draft.locked} onChange={(event) => setDraft({ ...draft, locked: event.target.checked })} /> Lock project editing</label>
        <label className="compact-check"><input type="checkbox" checked={draft.inventoryEnabled} onChange={(event) => setDraft({ ...draft, inventoryEnabled: event.target.checked })} /> Enable inventory</label>
        {draft.inventoryEnabled && (
          <>
            <label>Currency name<input value={draft.currencyName ?? ""} onChange={(event) => setDraft({ ...draft, currencyName: event.target.value })} placeholder="currency name" /></label>
            <label>{draft.currencyName || "Currency"} amount<input type="number" value={draft.currencyAmount ?? ""} onChange={(event) => setDraft({ ...draft, currencyAmount: event.target.value === "" ? undefined : Number(event.target.value) })} /></label>
          </>
        )}
        <label className="compact-check"><input type="checkbox" checked={draft.gearEnabled} onChange={(event) => setDraft({ ...draft, gearEnabled: event.target.checked })} /> Enable gear</label>
        <textarea value={draft.instructions} onChange={(event) => setDraft({ ...draft, instructions: event.target.value })} placeholder="Project Instructions" />
        <textarea value={draft.worldSetting} onChange={(event) => setDraft({ ...draft, worldSetting: event.target.value })} placeholder="World Setting" />
        <label>Memory mode <select value={draft.memoryMode} onChange={(event) => setDraft({ ...draft, memoryMode: event.target.value as Project["memoryMode"] })}><option value="manual">Manual</option><option value="automatic">Automatic</option><option value="approval">Automatic with Approval</option></select></label>
        <textarea value={draft.memoryInstruction} onChange={(event) => setDraft({ ...draft, memoryInstruction: event.target.value })} />
        <div className="split-actions"><button onClick={save}><Save size={18} /> Save</button><button onClick={onDone}>Done</button>{saved && <span className="save-status">Saved</span>}</div>
      </section>
    </Page>
  );
}

function useSavedNotice() {
  const [saved, setSaved] = useState(false);
  function showSaved() {
    setSaved(true);
    window.setTimeout(() => setSaved(false), 1600);
  }
  return [saved, showSaved] as const;
}

function SettingsPage({ settings, onRefresh }: { settings: AppSettings; onRefresh: () => Promise<void> }) {
  const [draft, setDraft] = useState(settings);
  const [tab, setTab] = useState<"appearance" | "api" | "data">("appearance");
  const [saved, showSaved] = useSavedNotice();
  useEffect(() => setDraft(settings), [settings]);
  async function save() {
    await db.settings.put({ ...draft, updatedAt: now() });
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
        <>
          <Segment label="Theme" value={draft.theme} options={["onyx", "ivory", "blue", "green"]} onChange={(theme) => setDraft({ ...draft, theme })} />
          <label>Accent</label>
          <div className="swatches">{accents.map((accent) => <button key={accent.name} className={draft.accent === accent.name ? "picked" : ""} style={{ background: accent.value }} onClick={() => setDraft({ ...draft, accent: accent.name })} />)}</div>
          <Segment label="Font" value={draft.font} options={["system", "inter", "lora", "nunito"]} onChange={(font) => setDraft({ ...draft, font })} />
          <label>Font size: {fontSizeLabel(draft.fontScale ?? 16)} ({draft.fontScale ?? 16}px)
            <input type="range" min={12} max={24} step={1} value={draft.fontScale ?? 16} onChange={(event) => setDraft({ ...draft, fontScale: Number(event.target.value) })} />
          </label>
          <div className="font-preview" data-preview-font={draft.font} style={{ fontSize: draft.fontScale }}>Jaeger opened the archive and found the thread of the story still intact.</div>
          <Segment label="Bubbles" value={draft.bubbleMode} options={["bubbles", "minimal"]} onChange={(bubbleMode) => setDraft({ ...draft, bubbleMode })} />
          <Segment label="Scope" value={draft.bubbleScope} options={["global", "project"]} onChange={(bubbleScope) => setDraft({ ...draft, bubbleScope })} />
          <label>Entry width {draft.entryWidth}%<input type="range" min={60} max={100} value={draft.entryWidth} onChange={(event) => setDraft({ ...draft, entryWidth: Number(event.target.value) })} /></label>
          <label>Message spacing {draft.messageSpacing}px<input type="range" min={4} max={28} value={draft.messageSpacing} onChange={(event) => setDraft({ ...draft, messageSpacing: Number(event.target.value) })} /></label>
          <div className="split-actions"><button onClick={save}><Save size={18} /> Save settings</button>{saved && <span className="save-status">Saved</span>}</div>
        </>
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
      <label>OpenRouter API key<input type={show ? "text" : "password"} value={key} onChange={(event) => setKey(event.target.value)} placeholder="sk-or-..." /></label>
      <div className="split-actions"><button onClick={() => setShow(!show)}>{show ? "Hide" : "Show"}</button><button onClick={save}><Save size={18} /> Save</button><button className="danger" onClick={remove}>Remove</button>{saved && <span className="save-status">Saved</span>}</div>
      <label>Privacy preset<select value={settings.privacyPreset} onChange={async (event) => { await db.settings.update("settings", { privacyPreset: event.target.value as AppSettings["privacyPreset"], updatedAt: now() }); await onRefresh(); }}><option value="maximum">Maximum Privacy</option><option value="balanced">Balanced</option><option value="availability">Maximum Availability</option></select></label>
      <ModelLibrary />
    </>
  );
}

function ModelLibrary() {
  const [models, setModels] = useState<{ id: string; modelId: string; cosmeticName: string }[]>([]);
  const [fetchedModels, setFetchedModels] = useState<{ id: string; name?: string; context_length?: number }[]>([]);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");
  async function load() { setModels(await db.modelLibrary.orderBy("orderIndex").toArray()); }
  useEffect(() => { load(); }, []);
  async function fetchModels() {
    setStatus("Fetching models...");
    try {
      const response = await fetch("https://openrouter.ai/api/v1/models");
      if (!response.ok) throw new Error("Could not fetch models.");
      const json = await response.json() as { data?: { id: string; name?: string; context_length?: number }[] };
      setFetchedModels(json.data ?? []);
      setStatus(`Fetched ${(json.data ?? []).length} models`);
    } catch {
      setStatus("Model fetch failed. Check connection and try again.");
    }
  }
  async function addModel(modelId: string, name?: string, contextLength?: number) {
    if (!modelId.trim() || models.some((model) => model.modelId === modelId)) return;
    const timestamp = now();
    await db.modelLibrary.add({ id: uid(), modelId, cosmeticName: name || modelId.split("/").pop() || modelId, contextLength, orderIndex: models.length, createdAt: timestamp, updatedAt: timestamp });
    await load();
  }
  const filtered = fetchedModels.filter((model) => `${model.id} ${model.name ?? ""}`.toLowerCase().includes(query.toLowerCase())).slice(0, 40);
  return (
    <section className="panel">
      <h2>Custom Model Library</h2>
      <button onClick={fetchModels}><Download size={18} /> Fetch OpenRouter models</button>
      {status && <p className="save-status">{status}</p>}
      <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Filter fetched models" />
      {filtered.length > 0 && <div className="model-results">{filtered.map((model) => <button key={model.id} onClick={() => addModel(model.id, model.name, model.context_length)}><Plus size={16} /><span>{model.name ?? model.id}</span><small>{model.id}</small></button>)}</div>}
      {models.map((model) => <div className="mini-row" key={model.id}><span>{model.cosmeticName}</span><small>{model.modelId}</small><button className="danger" onClick={async () => { await db.modelLibrary.delete(model.id); await load(); }}><Trash2 size={16} /> Remove</button></div>)}
    </section>
  );
}

function MemoriesPage({ project }: { project?: Project }) {
  const [memories, setMemories] = useState<Memory[]>([]);
  const [text, setText] = useState("");
  const [tags, setTags] = useState("");
  const [query, setQuery] = useState("");
  async function load() { if (project) setMemories(await db.memories.where("projectId").equals(project.id).reverse().sortBy("updatedAt")); }
  useEffect(() => { load(); }, [project?.id]);
  if (!project) return <EmptyState title="No project selected" body="Choose a project to manage memories." />;
  const projectId = project.id;
  async function add() {
    await createMemory(projectId, text, splitTags(tags));
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
      <button onClick={add}><Plus size={18} /> Add memory</button>
      <div className="form-row"><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search by tag or text" /><button onClick={runSearch}><Search size={18} /></button></div>
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
        <div className="split-actions"><button onClick={save}><Save size={18} /> Save compaction memory</button>{saved && <span className="save-status">Saved</span>}</div>
      </section>
    </Page>
  );
}

function SourceFilesPage({ project }: { project?: Project }) {
  const [files, setFiles] = useState<{ id: string; name: string; size: number; mimeType: string }[]>([]);
  async function load() {
    if (project) setFiles(await db.sourceFiles.where("projectId").equals(project.id).reverse().sortBy("updatedAt"));
  }
  useEffect(() => { load(); }, [project?.id]);
  if (!project) return <EmptyState title="No project selected" body="Choose a project to manage source files." />;
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
      textContent: file.type.startsWith("text/") || file.name.endsWith(".txt") || file.name.endsWith(".md") ? await file.text() : undefined,
      createdAt: timestamp,
      updatedAt: timestamp
    })));
    await db.sourceFiles.bulkAdd(rows);
    await load();
  }
  async function remove(id: string) {
    if (!confirm("Remove this source file from the project library?")) return;
    await db.sourceFiles.delete(id);
    await load();
  }
  return (
    <Page>
      <label className="file-pick"><Upload size={18} /> Upload source files<input type="file" multiple onChange={(event) => add(event.target.files)} /></label>
      {files.map((file) => <section className="item-card mini-row" key={file.id}><span>{file.name}</span><small>{Math.ceil(file.size / 1024)} KB</small><button className="danger" onClick={() => remove(file.id)}><Trash2 size={16} /> Remove</button></section>)}
    </Page>
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

function CharactersPage({ project, onOpenProfile }: { project?: Project; onOpenProfile: (id: string) => void }) {
  const [characters, setCharacters] = useState<Character[]>([]);
  const [draggedCharacterId, setDraggedCharacterId] = useState<string>();
  async function load() {
    if (!project) return;
    const rows = await db.characters.where("projectId").equals(project.id).toArray();
    setCharacters(rows.sort((a, b) => (a.orderIndex ?? Number.MAX_SAFE_INTEGER) - (b.orderIndex ?? Number.MAX_SAFE_INTEGER) || a.normalisedName.localeCompare(b.normalisedName)));
  }
  useEffect(() => { load(); }, [project?.id]);
  if (!project) return <EmptyState title="No project selected" body="Choose a project to manage characters." />;
  const projectId = project.id;
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
      <button onClick={add}><Plus size={18} /> Add character</button>
      <div className="character-gallery">
        {characters.map((character) => (
          <CharacterTile
            key={character.id}
            character={character}
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

function CharacterTile({ character, dragging, onDragStart, onDrop, onOpen }: { character: Character; dragging: boolean; onDragStart: () => void; onDrop: () => void; onOpen: () => void }) {
  const [imageUrl, setImageUrl] = useState<string>();
  useEffect(() => {
    db.attachments.where("[ownerType+ownerId]").equals(["character", character.id]).first().then((attachment) => {
      if (attachment) setImageUrl(URL.createObjectURL(attachment.blob));
    });
    return () => { if (imageUrl) URL.revokeObjectURL(imageUrl); };
  }, [character.id]);
  return (
    <button
      className={`character-tile ${dragging ? "dragging" : ""}`}
      draggable
      onClick={onOpen}
      onDragStart={(event) => {
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
        onDrop();
      }}
    >
      {imageUrl ? <img src={imageUrl} alt="" /> : <UserRound size={48} />}
      <span>{character.name}</span>
    </button>
  );
}

function CharacterProfilePage({ project, characterId, onBack, onDeleted }: { project: Project; characterId: string; onBack: () => void; onDeleted: () => void }) {
  const [character, setCharacter] = useState<Character>();
  async function load() {
    const row = await db.characters.get(characterId);
    if (row?.projectId === project.id) setCharacter(row);
  }
  useEffect(() => { load(); }, [characterId, project.id]);
  if (!character) return <EmptyState title="Character not found" body="This character could not be opened in the selected project." />;
  return <Page><CharacterEditor character={character} onRefresh={load} onBack={onBack} onDeleted={onDeleted} /></Page>;
}

function CharacterEditor({ character, onRefresh, onBack, onDeleted }: { character: Character; onRefresh: () => Promise<void>; onBack: () => void; onDeleted: () => void }) {
  const [draft, setDraft] = useState(character);
  const [editing, setEditing] = useState(false);
  const [attachments, setAttachments] = useState<{ id: string; url: string; mimeType: string }[]>([]);
  const [bonuses, setBonuses] = useState<CharacterBonus[]>([]);
  const [viewerIndex, setViewerIndex] = useState<number>();
  const [saved, showSaved] = useSavedNotice();
  const valid = validatePointBuy(draft);
  async function loadAttachments() {
    const rows = await db.attachments.where("[ownerType+ownerId]").equals(["character", character.id]).toArray();
    setAttachments((old) => {
      old.forEach((item) => URL.revokeObjectURL(item.url));
      return rows.map((attachment) => ({ id: attachment.id, mimeType: attachment.mimeType, url: URL.createObjectURL(attachment.blob) }));
    });
  }
  async function loadBonuses() {
    setBonuses(await db.characterBonuses.where("characterId").equals(character.id).toArray());
  }
  useEffect(() => {
    setDraft(character);
    loadAttachments();
    loadBonuses();
    return () => attachments.forEach((item) => URL.revokeObjectURL(item.url));
  }, [character.id]);
  async function save() {
    await db.characters.put({ ...draft, normalisedName: normaliseTag(draft.name), updatedAt: now() });
    setEditing(false);
    showSaved();
    await onRefresh();
  }
  async function addBonus() {
    const timestamp = now();
    await db.characterBonuses.add({ id: uid(), characterId: character.id, name: "Bonus", stat: "STR", value: 1, createdAt: timestamp, updatedAt: timestamp });
    await loadBonuses();
  }
  async function updateBonus(bonus: CharacterBonus) {
    await db.characterBonuses.put({ ...bonus, updatedAt: now() });
    await loadBonuses();
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
    await db.transaction("rw", [db.characters, db.characterBonuses, db.attachments], async () => {
      await db.characterBonuses.where("characterId").equals(character.id).delete();
      const attachmentIds = await db.attachments.where("[ownerType+ownerId]").equals(["character", character.id]).primaryKeys();
      if (attachmentIds.length) await db.attachments.bulkDelete(attachmentIds as string[]);
      await db.characters.delete(character.id);
    });
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
            {character.statsEnabled && <StatsDisplay character={character} bonuses={bonuses} />}
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
          <label>Identity: Gender<input value={draft.gender} onChange={(event) => setDraft({ ...draft, gender: event.target.value })} /></label>
          <label>Identity: Personality<textarea value={draft.personality} onChange={(event) => setDraft({ ...draft, personality: event.target.value })} /></label>
          <label>Identity: Misc<textarea value={draft.misc} onChange={(event) => setDraft({ ...draft, misc: event.target.value })} /></label>
          <label>Bio:<textarea className="large-entry" value={draft.bio} onChange={(event) => setDraft({ ...draft, bio: event.target.value })} /></label>
          <label className="file-pick"><ImageIcon size={18} /> Add images<input type="file" accept="image/*" multiple onChange={(event) => addImages(event.target.files)} /></label>
          <ImageStrip attachments={attachments} onOpen={setViewerIndex} />
          <label className="compact-check"><input type="checkbox" checked={draft.statsEnabled} onChange={(event) => setDraft({ ...draft, statsEnabled: event.target.checked })} /> Enable ability scores</label>
          {draft.statsEnabled && <PointBuyEditor draft={draft} bonuses={bonuses} onDraft={setDraft} onAddBonus={addBonus} onBonus={updateBonus} />}
          {!valid && <p className="error">Point buy must stay within 27 points, with base scores from 8 to 15.</p>}
          <div className="split-actions"><button disabled={!valid} onClick={save}><Save size={18} /> Save</button><button onClick={() => setEditing(false)}>Cancel</button>{saved && <span className="save-status">Saved</span>}</div>
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

function StatsDisplay({ character, bonuses }: { character: Character; bonuses: CharacterBonus[] }) {
  return <div className="stat-display">{abilities.map((ability) => {
    const key = ability.toLowerCase() as "str" | "dex" | "con" | "int" | "wis" | "cha";
    const bonus = bonuses.filter((item) => item.stat === ability).reduce((sum, item) => sum + item.value, 0);
    return <span key={ability}>{ability} {character[key] + bonus}</span>;
  })}</div>;
}

function PointBuyEditor({ draft, bonuses, onDraft, onAddBonus, onBonus }: { draft: Character; bonuses: CharacterBonus[]; onDraft: (character: Character) => void; onAddBonus: () => void; onBonus: (bonus: CharacterBonus) => void }) {
  const pointCost = abilities.reduce((sum, ability) => {
    const key = ability.toLowerCase() as "str" | "dex" | "con" | "int" | "wis" | "cha";
    const costs: Record<number, number> = { 8: 0, 9: 1, 10: 2, 11: 3, 12: 4, 13: 5, 14: 7, 15: 9 };
    return sum + costs[draft[key]];
  }, 0);
  return (
    <div className="point-buy">
      <div className="mini-row"><strong>{pointCost} / 27 spent</strong><button onClick={onAddBonus}><Plus size={16} /> Bonus</button></div>
      {abilities.map((ability) => {
        const key = ability.toLowerCase() as "str" | "dex" | "con" | "int" | "wis" | "cha";
        const base = draft[key];
        const bonus = bonuses.filter((item) => item.stat === ability).reduce((sum, item) => sum + item.value, 0);
            const bonusWidth = Math.min(100 - ((base - 8) / 7) * 100, Math.max(0, bonus) * 9);
            return (
          <div className="stat-bar-row" key={ability}>
            <span>{ability}</span>
            <button disabled={base <= 8} onClick={() => onDraft({ ...draft, [key]: base - 1 })}>-</button>
            <div className="stat-bar"><i style={{ width: `${((base - 8) / 7) * 100}%` }} /><b style={{ width: `${bonusWidth}%` }} /></div>
            <button disabled={base >= 15} onClick={() => onDraft({ ...draft, [key]: base + 1 })}>+</button>
            <strong>{base + bonus}</strong>
          </div>
        );
      })}
      {bonuses.map((bonus) => (
        <div className="bonus-row" key={bonus.id}>
          <input value={bonus.name} onChange={(event) => onBonus({ ...bonus, name: event.target.value })} />
          <select value={bonus.stat} onChange={(event) => onBonus({ ...bonus, stat: event.target.value as Ability })}>{abilities.map((ability) => <option key={ability}>{ability}</option>)}</select>
          <button onClick={() => onBonus({ ...bonus, value: bonus.value - 1 })}>-</button>
          <span>{bonus.value}</span>
          <button onClick={() => onBonus({ ...bonus, value: bonus.value + 1 })}>+</button>
        </div>
      ))}
    </div>
  );
}

function ImageStrip({ attachments, onOpen }: { attachments: { id: string; url: string; mimeType: string }[]; onOpen: (index: number) => void }) {
  if (attachments.length === 0) return <p className="muted-pad">No images attached.</p>;
  return <div className="thumb-strip">{attachments.map((attachment, index) => <button key={attachment.id} onClick={() => onOpen(index)} aria-label="Open image"><img src={attachment.url} alt="" /></button>)}</div>;
}

function ImageViewer({ attachments, index, onChange, onClose }: { attachments: { id: string; url: string }[]; index: number; onChange: (index: number) => void; onClose: () => void }) {
  const active = attachments[index];
  if (!active) return null;
  return (
    <div className="image-viewer" onClick={onClose}>
      <img className="image-full" src={active.url} alt="" />
      <div className="viewer-thumbs" onClick={(event) => event.stopPropagation()}>
        {attachments.map((attachment, nextIndex) => <button className={nextIndex === index ? "picked" : ""} key={attachment.id} onClick={() => onChange(nextIndex)}><img src={attachment.url} alt="" /></button>)}
      </div>
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
  const [attachments, setAttachments] = useState<{ id: string; url: string; mimeType: string }[]>([]);
  const [viewerIndex, setViewerIndex] = useState<number>();
  const [saved, showSaved] = useSavedNotice();
  const entryRef = useRef<HTMLDivElement>(null);
  useEffect(() => setDraft(entry), [entry]);
  async function loadAttachments() {
    const rows = await db.attachments.where("[ownerType+ownerId]").equals(["archiveEntry", entry.id]).toArray();
    setAttachments((old) => {
      old.forEach((item) => URL.revokeObjectURL(item.url));
      return rows.map((attachment) => ({ id: attachment.id, mimeType: attachment.mimeType, url: URL.createObjectURL(attachment.blob) }));
    });
  }
  useEffect(() => {
    loadAttachments();
    return () => attachments.forEach((item) => URL.revokeObjectURL(item.url));
  }, [entry.id]);
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
            <p className="entry-body">{entry.body || "No entry text yet."}</p>
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
      {stars.map((star) => <button className="star-card" key={star.id} onClick={() => setOpenStar(star)}><small>{star.role} · {formatDate(star.updatedAt)}</small><p>{star.bodyCopy}</p></button>)}
      {openStar && <div className="modal-backdrop" onClick={() => setOpenStar(undefined)}><section className="star-modal" onClick={(event) => event.stopPropagation()}><small>{openStar.role} · {formatDate(openStar.updatedAt)}</small><p>{openStar.bodyCopy}</p><div className="split-actions"><button onClick={() => setOpenStar(undefined)}>Close</button><button className="danger" onClick={() => removeStar(openStar.id)}><Trash2 size={18} /> Delete star</button></div></section></div>}
    </Page>
  );
}

function DataSettingsContent() {
  const [importStatus, setImportStatus] = useState("");
  async function backupAll() {
    if (!confirm("Generate a backup of all app data except API keys?")) return;
    const data = {
      schemaVersion: 1,
      appVersion: "0.1.0",
      exportedAt: new Date().toISOString(),
      settings: { ...(await db.settings.get("settings")), apiKey: undefined },
      projects: await db.projects.toArray(),
      chats: await db.chats.toArray(),
      branches: await db.branches.toArray(),
      messages: await db.messages.toArray(),
      stars: await db.stars.toArray(),
      archives: await db.archives.toArray(),
      archiveEntries: await db.archiveEntries.toArray(),
      memories: await db.memories.toArray(),
      characters: await db.characters.toArray(),
      modelLibrary: await db.modelLibrary.toArray(),
      sourceFiles: await db.sourceFiles.toArray(),
      inventoryItems: await db.inventoryItems.toArray(),
      inventoryLogs: await db.inventoryLogs.toArray()
    };
    downloadJson("mirror-backup.json", data);
  }
  async function importBackup(file: File | undefined) {
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text()) as Record<string, unknown>;
      if (parsed.schemaVersion !== 1 || !Array.isArray(parsed.projects)) {
        setImportStatus("Invalid import file.");
        return;
      }
      const counts = ["projects", "chats", "branches", "messages", "stars", "archives", "archiveEntries", "memories", "characters", "modelLibrary", "sourceFiles", "inventoryItems", "inventoryLogs"]
        .map((key) => `${key}: ${Array.isArray(parsed[key]) ? parsed[key].length : 0}`)
        .join(", ");
      if (!confirm(`Import this backup?\n${counts}`)) return;
      await db.transaction("rw", [db.settings, db.projects, db.chats, db.branches, db.messages, db.stars, db.archives, db.archiveEntries, db.memories, db.characters, db.modelLibrary, db.sourceFiles, db.inventoryItems, db.inventoryLogs], async () => {
        if (parsed.settings && typeof parsed.settings === "object") await db.settings.put(parsed.settings as AppSettings);
        if (Array.isArray(parsed.projects)) await db.projects.bulkPut(parsed.projects as Project[]);
        if (Array.isArray(parsed.chats)) await db.chats.bulkPut(parsed.chats as Chat[]);
        if (Array.isArray(parsed.branches)) await db.branches.bulkPut(parsed.branches as never[]);
        if (Array.isArray(parsed.messages)) await db.messages.bulkPut(parsed.messages as Message[]);
        if (Array.isArray(parsed.stars)) await db.stars.bulkPut(parsed.stars as never[]);
        if (Array.isArray(parsed.archives)) await db.archives.bulkPut(parsed.archives as never[]);
        if (Array.isArray(parsed.archiveEntries)) await db.archiveEntries.bulkPut(parsed.archiveEntries as never[]);
        if (Array.isArray(parsed.memories)) await db.memories.bulkPut(parsed.memories as Memory[]);
        if (Array.isArray(parsed.characters)) await db.characters.bulkPut(parsed.characters as Character[]);
        if (Array.isArray(parsed.modelLibrary)) await db.modelLibrary.bulkPut(parsed.modelLibrary as never[]);
        if (Array.isArray(parsed.sourceFiles)) await db.sourceFiles.bulkPut(parsed.sourceFiles as never[]);
        if (Array.isArray(parsed.inventoryItems)) await db.inventoryItems.bulkPut(parsed.inventoryItems as never[]);
        if (Array.isArray(parsed.inventoryLogs)) await db.inventoryLogs.bulkPut(parsed.inventoryLogs as never[]);
      });
      setImportStatus("Import complete.");
    } catch {
      setImportStatus("Import failed.");
    }
  }
  async function clearAll() {
    if (!confirm("Back up first if you need this data. Continue to clear all local Mirror data?")) return;
    if (prompt("Type DELETE MIRROR DATA to permanently clear local data.") !== "DELETE MIRROR DATA") return;
    await db.delete();
    location.reload();
  }
  return <><button onClick={backupAll}><Download size={18} /> Backup All</button><button onClick={backupAll}><Download size={18} /> Backup Memories Only</button><label className="file-pick"><Upload size={18} /> Import backup<input type="file" accept="application/json" onChange={(event) => importBackup(event.target.files?.[0])} /></label>{importStatus && <p className="save-status">{importStatus}</p>}<button className="danger separated" onClick={clearAll}><Trash2 size={18} /> Clear All</button></>;
}

function downloadJson(filename: string, data: unknown) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function Segment<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: T[]; onChange: (value: T) => void }) {
  return <label>{label}<div className="segment">{options.map((option) => <button key={option} className={option === value ? "picked" : ""} onClick={() => onChange(option)}>{option}</button>)}</div></label>;
}

function ColorSwatches({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const colors = ["#a7d8c4", "#c2a6ff", "#8bb8f7", "#e8a2b6", "#e2bf7a", "#7bd4d0", "#d8d3c7", "#d98f8f"];
  return <div className="swatches">{colors.map((color) => <button key={color} className={value === color ? "picked" : ""} style={{ background: color }} onClick={() => onChange(color)} />)}</div>;
}

function Page({ children }: { children: React.ReactNode }) {
  return <div className="page">{children}</div>;
}

function EmptyState({ title, body }: { title: string; body: string }) {
  return <section className="empty"><MothMark /><h1>{title}</h1><p>{body}</p></section>;
}
