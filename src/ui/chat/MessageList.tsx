import {
  Clipboard,
  Edit3,
  Image as ImageIcon,
  Info,
  Paperclip,
  Plus,
  RefreshCw,
  Save,
  Settings,
  Star,
  X
} from "lucide-react";
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { VariableSizeList, type ListChildComponentProps } from "react-window";
import { db } from "../../data/db";
import {
  normaliseInventoryName,
  toggleStar
} from "../../data/repositories";
import { BubbleMode, Character, InventoryUpdateRequest, Message, ModelLibraryEntry } from "../../types";
import { estimateTokens, now, uid } from "../../utils";
import { deltaMapPreviewSizes } from "../delta/DeltaMapPrototype";
import { formatInventoryKg } from "../delta/workspaceSupport";
import { retrievedSourceNames, summarizeAuditUsage } from "../responseAudit";
import { LoadingSignal } from "../shared/LoadingSignal";
import { MarkdownText } from "../shared/MarkdownText";
import { ImageStrip, ImageViewer } from "../shared/appElements";
import { deltaBriefRosterFromContext, normaliseDeltaBriefRoster } from "./context";

function formatMessageDate(timestamp: number) {
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(timestamp);
}

function MessageRow({
  projectId,
  message,
  expanded,
  onExpand,
  onEdit,
  onResend,
  onInventoryUpdateAction,
  onBeginDeltaBrief,
  onAvoidDeltaBrief,
  deltaLocked,
  onOpenChatSettings,
  onRefresh
}: {
  projectId: string;
  message: Message;
  expanded: boolean;
  onExpand: (messageId: string) => void;
  onEdit: (message: Message, nextBody: string) => Promise<Message>;
  onResend: (message: Message) => Promise<void>;
  onInventoryUpdateAction: (message: Message, action: "confirm" | "edit" | "reject", editedUpdates?: InventoryUpdateRequest[]) => Promise<void>;
  onBeginDeltaBrief: (message: Message) => Promise<void>;
  onAvoidDeltaBrief: (message: Message, attempt: string) => Promise<void>;
  deltaLocked: boolean;
  onOpenChatSettings: () => void;
  onRefresh: () => Promise<void>;
}) {
  const [infoOpen, setInfoOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [draftBody, setDraftBody] = useState(message.body);
  const [editAttachmentMenuOpen, setEditAttachmentMenuOpen] = useState(false);
  const [editAttachments, setEditAttachments] = useState<{ id: string; name?: string; mimeType: string; url: string }[]>([]);
  const [editImageIndex, setEditImageIndex] = useState<number>();
  const [deleteAttachmentId, setDeleteAttachmentId] = useState<string>();
  const [resendConfirm, setResendConfirm] = useState<"resend" | "edit-resend">();
  const [avoidOpen, setAvoidOpen] = useState(false);
  const [avoidText, setAvoidText] = useState("");
  const [avoidSaving, setAvoidSaving] = useState(false);
  const [deltaCharacters, setDeltaCharacters] = useState<Character[]>([]);
  const editImagePickerRef = useRef<HTMLInputElement>(null);
  const editFilePickerRef = useRef<HTMLInputElement>(null);
  const attachmentPressTimer = useRef<number>();
  useEffect(() => setDraftBody(message.body), [message.id, message.body]);
  async function loadDeltaCharacters() {
    const rows = await db.characters.where("projectId").equals(projectId).toArray();
    setDeltaCharacters(rows.sort((a, b) => (a.orderIndex ?? Number.MAX_SAFE_INTEGER) - (b.orderIndex ?? Number.MAX_SAFE_INTEGER) || a.normalisedName.localeCompare(b.normalisedName)));
  }
  useEffect(() => {
    if (message.deltaBrief?.status !== "pending") return;
    void loadDeltaCharacters();
  }, [message.id, message.deltaBrief?.status, projectId]);
  useEffect(() => {
    if (!editOpen) return;
    let alive = true;
    let urls: { url: string }[] = [];
    void db.attachments.where("[ownerType+ownerId]").equals(["message", message.id]).toArray().then((rows) => {
      const next = rows.map((attachment) => ({ id: attachment.id, name: attachment.name, mimeType: attachment.mimeType, url: URL.createObjectURL(attachment.blob) }));
      urls = next;
      if (alive) setEditAttachments(next);
      else next.forEach((attachment) => URL.revokeObjectURL(attachment.url));
    });
    return () => {
      alive = false;
      urls.forEach((attachment) => URL.revokeObjectURL(attachment.url));
      setEditAttachmentMenuOpen(false);
      setDeleteAttachmentId(undefined);
    };
  }, [editOpen, message.id]);
  async function star() {
    await toggleStar(projectId, message);
    await onRefresh();
  }
  async function copyMessage() {
    await navigator.clipboard.writeText(message.body);
  }
  async function resend() {
    if (deltaLocked) return;
    await onResend(message);
  }
  async function saveEdit() {
    if (deltaLocked) return;
    await onEdit(message, draftBody);
    setEditOpen(false);
  }
  async function saveEditAndResend() {
    if (deltaLocked) return;
    const updatedMessage = await onEdit(message, draftBody);
    setEditOpen(false);
    await onResend(updatedMessage);
  }
  async function confirmResendAction() {
    const action = resendConfirm;
    setResendConfirm(undefined);
    if (action === "edit-resend") await saveEditAndResend();
    else if (action === "resend") await resend();
  }
  async function addEditAttachments(files: FileList | null) {
    const next = Array.from(files ?? []);
    if (!next.length) return;
    const timestamp = now();
    await db.attachments.bulkAdd(next.map((file) => ({ id: uid(), ownerType: "message" as const, ownerId: message.id, name: file.name, mimeType: file.type || "application/octet-stream", size: file.size, blob: file, createdAt: timestamp, updatedAt: timestamp })));
    if (next.some((file) => file.type.startsWith("image/"))) await db.messages.update(message.id, { attachmentContext: undefined, updatedAt: timestamp });
    const rows = await db.attachments.where("[ownerType+ownerId]").equals(["message", message.id]).toArray();
    editAttachments.forEach((attachment) => URL.revokeObjectURL(attachment.url));
    setEditAttachments(rows.map((attachment) => ({ id: attachment.id, name: attachment.name, mimeType: attachment.mimeType, url: URL.createObjectURL(attachment.blob) })));
    setEditAttachmentMenuOpen(false);
  }
  function beginAttachmentPress(id: string) {
    window.clearTimeout(attachmentPressTimer.current);
    attachmentPressTimer.current = window.setTimeout(() => setDeleteAttachmentId(id), 520);
  }
  function cancelAttachmentPress() {
    window.clearTimeout(attachmentPressTimer.current);
  }
  async function removeEditAttachment() {
    if (!deleteAttachmentId) return;
    const deleting = editAttachments.find((attachment) => attachment.id === deleteAttachmentId);
    await db.attachments.delete(deleteAttachmentId);
    if (deleting?.mimeType.startsWith("image/")) await db.messages.update(message.id, { attachmentContext: undefined, updatedAt: now() });
    const removed = deleting;
    if (removed) URL.revokeObjectURL(removed.url);
    setEditAttachments((current) => current.filter((attachment) => attachment.id !== deleteAttachmentId));
    setDeleteAttachmentId(undefined);
  }
  async function submitAvoidDelta() {
    if (!avoidText.trim()) return;
    setAvoidSaving(true);
    try {
      await onAvoidDeltaBrief(message, avoidText);
      setAvoidText("");
      setAvoidOpen(false);
    } finally {
      setAvoidSaving(false);
    }
  }
  async function updateDeltaPlayerCharacter(playerCharacterId: string) {
    const brief = message.deltaBrief;
    if (!brief) return;
    const character = deltaCharacters.find((item) => item.id === playerCharacterId);
    await db.messages.update(message.id, {
      deltaBrief: { ...brief, playerCharacterId: character?.id, playerCharacterName: character?.name ?? "" },
      updatedAt: now()
    });
    await onRefresh();
  }
  const visibleDeltaRoster = (() => {
    const brief = message.deltaBrief;
    const roster = normaliseDeltaBriefRoster(brief?.roster ?? deltaBriefRosterFromContext(brief?.handoffContext));
    const selectedName = deltaCharacters.find((character) => character.id === brief?.playerCharacterId)?.name || brief?.playerCharacterName || "";
    if (selectedName) {
      roster.neutral = roster.neutral.filter((name) => name.toLowerCase() !== selectedName.toLowerCase());
      roster.enemies = roster.enemies.filter((name) => name.toLowerCase() !== selectedName.toLowerCase());
      if (!roster.team.some((name) => name.toLowerCase() === selectedName.toLowerCase())) roster.team.unshift(selectedName);
    }
    return roster;
  })();
  return (
    <>
      <article className={`message ${message.role} ${message.status === "cancelled" ? "cancelled" : ""}`} onClick={() => onExpand(message.id)}>
        {message.role === "user" && <MessageImageAttachments messageId={message.id} />}
        <div className="message-body">{message.status === "pending" && message.body.trim() === "..." ? <LoadingSignal /> : <MarkdownText text={message.body} inventoryMarkers />}</div>
        {message.deltaBrief?.status === "pending" && (
          <div className="delta-brief-panel" onClick={(event) => event.stopPropagation()}>
            <div className="delta-brief-preflight">
              <div className="delta-brief-player">
                <span>Player character</span>
                <select
                  value={message.deltaBrief.playerCharacterId || deltaCharacters.find((character) => character.name === message.deltaBrief?.playerCharacterName)?.id || ""}
                  onChange={(event) => void updateDeltaPlayerCharacter(event.target.value)}
                  aria-label="Player character for Delta engagement"
                >
                  <option value="">Player character</option>
                  {deltaCharacters.map((character) => <option key={character.id} value={character.id}>{character.name}</option>)}
                </select>
                <button className="icon-button" type="button" onClick={() => void loadDeltaCharacters()} aria-label="Refresh character list" title="Refresh characters"><RefreshCw size={14} /></button>
              </div>
              {(visibleDeltaRoster.team.length > 0 || visibleDeltaRoster.neutral.length > 0 || visibleDeltaRoster.enemies.length > 0) && (
                <dl className="delta-brief-roster">
                  {visibleDeltaRoster.team.length > 0 && <div><dt>Your team</dt><dd>{visibleDeltaRoster.team.join(", ")}</dd></div>}
                  {visibleDeltaRoster.neutral.length > 0 && <div><dt>Neutral</dt><dd>{visibleDeltaRoster.neutral.join(", ")}</dd></div>}
                  {visibleDeltaRoster.enemies.length > 0 && <div><dt>Enemies</dt><dd>{visibleDeltaRoster.enemies.join(", ")}</dd></div>}
                </dl>
              )}
              <span className="delta-brief-map-size">Map size: <b>{message.deltaBrief.mapSize ?? "M"}</b> ({deltaMapPreviewSizes[message.deltaBrief.mapSize ?? "M"].metres}m)</span>
            </div>
            <div className="delta-brief-actions">
              {message.deltaBrief.avoidLabel && (
                <button type="button" onClick={() => setAvoidOpen(true)}>{message.deltaBrief.avoidLabel}</button>
              )}
              <button type="button" onClick={() => void onBeginDeltaBrief(message)}>Begin Engagement</button>
            </div>
          </div>
        )}
        {message.role === "assistant" && (
          <InventoryUpdateCard
            updates={(message.requestInfo?.inventoryUpdates ?? []).filter((update) => update.status === "pending" || update.status === "edit" || update.status === "rejected")}
            onAction={(action, editedUpdates) => onInventoryUpdateAction(message, action, editedUpdates)}
          />
        )}
        {expanded && message.role === "assistant" && message.modelId && <div className="message-model">{message.modelId}</div>}
        <div className={`message-meta ${expanded ? "show" : ""}`}>
          <button aria-label="Edit message" title={deltaLocked ? "Resolve engagement to unlock editing" : "Edit"} disabled={deltaLocked} onClick={(event) => { event.stopPropagation(); if (!deltaLocked) setEditOpen(true); }}><Edit3 size={16} /></button>
          <button aria-label={message.starred ? "Unstar message" : "Star message"} title={message.starred ? "Unstar" : "Star"} onClick={(event) => { event.stopPropagation(); star(); }}><Star size={16} fill={message.starred ? "currentColor" : "none"} /></button>
          <button aria-label="Copy message" title="Copy" onClick={(event) => { event.stopPropagation(); copyMessage(); }}><Clipboard size={16} /></button>
          <button aria-label="Response audit" title="Response audit" onClick={(event) => { event.stopPropagation(); setInfoOpen(true); }}><Info size={16} /></button>
          <span>{formatMessageDate(message.createdAt)}</span>
          <span>{message.inputTokens ?? message.outputTokens ?? estimateTokens(message.body)}t</span>
          {expanded && <EstimatedMessageCost message={message} />}
          {message.role === "user" && <button className="resend" aria-label="Resend message" title={deltaLocked ? "Resolve engagement to unlock resend" : "Resend"} disabled={deltaLocked} onClick={(event) => { event.stopPropagation(); setResendConfirm("resend"); }}><RefreshCw size={16} /></button>}
        </div>
      </article>
      {infoOpen && createPortal(<MessageInfoModal message={message} onClose={() => setInfoOpen(false)} />, document.body)}
      {editOpen && (
        createPortal(<div className="modal-backdrop" onClick={() => setEditOpen(false)}>
          <section className="star-modal message-info-modal" onClick={(event) => event.stopPropagation()}>
            <div className="section-title">
              <h2>Edit Message</h2>
              <div className="split-actions">
                <button className="icon-button" onClick={() => setEditAttachmentMenuOpen(!editAttachmentMenuOpen)} aria-label="Message attachments" title="Attachments"><Plus size={18} /></button>
                <button className="icon-button" onClick={() => setEditOpen(false)} aria-label="Close edit message"><X size={18} /></button>
              </div>
            </div>
            {editAttachmentMenuOpen && <div className="edit-attachment-menu">
              <button type="button" onClick={() => { setEditOpen(false); onOpenChatSettings(); }}><Settings size={17} /> Chat settings</button>
              <button type="button" onClick={() => editImagePickerRef.current?.click()}><ImageIcon size={17} /> Attach Image</button>
              <button type="button" onClick={() => editFilePickerRef.current?.click()}><Paperclip size={17} /> Attach File</button>
              <input ref={editImagePickerRef} className="visually-hidden" type="file" accept="image/*" multiple onChange={(event) => { void addEditAttachments(event.target.files); event.currentTarget.value = ""; }} />
              <input ref={editFilePickerRef} className="visually-hidden" type="file" multiple onChange={(event) => { void addEditAttachments(event.target.files); event.currentTarget.value = ""; }} />
            </div>}
            {editAttachments.filter((attachment) => attachment.mimeType.startsWith("image/")).length > 0 && <div className="edit-message-image-strip">
              {editAttachments.filter((attachment) => attachment.mimeType.startsWith("image/")).map((attachment, index) => <button key={attachment.id} type="button" onPointerDown={() => beginAttachmentPress(attachment.id)} onPointerUp={cancelAttachmentPress} onPointerLeave={cancelAttachmentPress} onClick={() => setEditImageIndex(index)}><img src={attachment.url} alt="" /></button>)}
            </div>}
            {editAttachments.some((attachment) => !attachment.mimeType.startsWith("image/")) && <div className="edit-message-file-list">{editAttachments.filter((attachment) => !attachment.mimeType.startsWith("image/")).map((attachment) => <span key={attachment.id}><Paperclip size={14} /> {attachment.name || "Attached file"}</span>)}</div>}
            {deleteAttachmentId && <div className="inline-confirm"><span>Delete this attachment?</span><button onClick={removeEditAttachment}>Delete</button><button onClick={() => setDeleteAttachmentId(undefined)}>Cancel</button></div>}
            <textarea className="large-entry" value={draftBody} onChange={(event) => setDraftBody(event.target.value)} />
            <div className="split-actions">
              <button onClick={saveEdit} disabled={deltaLocked}><Save size={18} /> Save</button>
              {message.role === "user" && <button onClick={() => setResendConfirm("edit-resend")} disabled={deltaLocked}><RefreshCw size={18} /> Save & resend</button>}
              <button onClick={() => setEditOpen(false)}>Cancel</button>
            </div>
          </section>
        </div>, document.body)
      )}
      {resendConfirm && (
        createPortal(<div className="modal-backdrop confirm-backdrop" onClick={() => setResendConfirm(undefined)}>
          <section className="confirm-modal" onClick={(event) => event.stopPropagation()}>
            <div className="section-title">
              <h2>{resendConfirm === "edit-resend" ? "Save & Resend" : "Resend Message"}</h2>
              <button className="icon-button" onClick={() => setResendConfirm(undefined)} aria-label="Cancel"><X size={18} /></button>
            </div>
            <p>{resendConfirm === "edit-resend" ? "Save this edit and regenerate from this user message? Later messages in this branch will be replaced." : "Regenerate from this user message? Later messages in this branch will be replaced."}</p>
            <div className="split-actions">
              <button onClick={() => { void confirmResendAction(); }}><RefreshCw size={18} /> {resendConfirm === "edit-resend" ? "Save & resend" : "Resend"}</button>
              <button onClick={() => setResendConfirm(undefined)}>Cancel</button>
            </div>
          </section>
        </div>, document.body)
      )}
      {editImageIndex !== undefined && createPortal(<ImageViewer attachments={editAttachments.filter((attachment) => attachment.mimeType.startsWith("image/"))} index={editImageIndex} onChange={setEditImageIndex} onClose={() => setEditImageIndex(undefined)} />, document.body)}
      {avoidOpen && (
        createPortal(<div className="modal-backdrop" onClick={() => setAvoidOpen(false)}>
          <section className="star-modal message-info-modal" onClick={(event) => event.stopPropagation()}>
            <div className="section-title">
              <h2>{message.deltaBrief?.avoidPrompt || "What do you do?"}</h2>
              <button className="icon-button" onClick={() => setAvoidOpen(false)} aria-label="Cancel"><X size={18} /></button>
            </div>
            <textarea className="large-entry" value={avoidText} onChange={(event) => setAvoidText(event.target.value)} rows={5} autoFocus />
            <div className="split-actions">
              <button onClick={submitAvoidDelta} disabled={!avoidText.trim() || avoidSaving}>{avoidSaving ? "Sending..." : "Send"}</button>
              <button onClick={() => setAvoidOpen(false)} disabled={avoidSaving}>Cancel</button>
            </div>
          </section>
        </div>, document.body)
      )}
    </>
  );
}

const MemoMessageRow = memo(MessageRow, (previous, next) => {
  const a = previous.message;
  const b = next.message;
  if (previous.projectId !== next.projectId) return false;
  if (previous.expanded !== next.expanded) return false;
  if (previous.deltaLocked !== next.deltaLocked) return false;
  if (a === b) return true;
  return (
    a.id === b.id &&
    a.role === b.role &&
    a.body === b.body &&
    a.status === b.status &&
    a.starred === b.starred &&
    a.modelId === b.modelId &&
    a.error === b.error &&
    a.inputTokens === b.inputTokens &&
    a.outputTokens === b.outputTokens &&
    a.estimatedTokens === b.estimatedTokens &&
    a.updatedAt === b.updatedAt
  );
});

type VirtualMessageListData = {
  projectId: string;
  messages: Message[];
  expandedMessageId?: string;
  onExpand: (messageId: string) => void;
  onEdit: (message: Message, nextBody: string) => Promise<Message>;
  onResend: (message: Message) => Promise<void>;
  onInventoryUpdateAction: (message: Message, action: "confirm" | "edit" | "reject", editedUpdates?: InventoryUpdateRequest[]) => Promise<void>;
  onBeginDeltaBrief: (message: Message) => Promise<void>;
  onAvoidDeltaBrief: (message: Message, attempt: string) => Promise<void>;
  deltaLocked: boolean;
  onOpenChatSettings: () => void;
  onRefresh: () => Promise<void>;
  onSize: (index: number, messageId: string, height: number) => void;
};

function VirtualMessageListRow({ index, style, data }: ListChildComponentProps<VirtualMessageListData>) {
  const message = data.messages[index];
  const contentRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const element = contentRef.current;
    if (!element) return;
    const reportSize = () => data.onSize(index, message.id, element.getBoundingClientRect().height);
    reportSize();
    const observer = new ResizeObserver(reportSize);
    observer.observe(element);
    return () => observer.disconnect();
  }, [data.onSize, index, message.id]);
  return (
    <div style={style} className="virtual-message-slot">
      <div ref={contentRef} className="virtual-message-row">
        <MemoMessageRow
          projectId={data.projectId}
          message={message}
          expanded={data.expandedMessageId === message.id}
          onExpand={data.onExpand}
          onEdit={data.onEdit}
          onResend={data.onResend}
          onInventoryUpdateAction={data.onInventoryUpdateAction}
          onBeginDeltaBrief={data.onBeginDeltaBrief}
          onAvoidDeltaBrief={data.onAvoidDeltaBrief}
          deltaLocked={data.deltaLocked}
          onOpenChatSettings={data.onOpenChatSettings}
          onRefresh={data.onRefresh}
        />
      </div>
    </div>
  );
}

export function VirtualMessageList({
  projectId,
  messages,
  bubbleMode,
  expandedMessageId,
  onExpand,
  onEdit,
  onResend,
  onInventoryUpdateAction,
  onBeginDeltaBrief,
  onAvoidDeltaBrief,
  deltaLocked,
  onOpenChatSettings,
  onRefresh,
  chatId
}: Omit<VirtualMessageListData, "onSize"> & { bubbleMode: BubbleMode; chatId?: string }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<VariableSizeList<VirtualMessageListData>>(null);
  const listOuterRef = useRef<HTMLDivElement>(null);
  const rowHeights = useRef(new Map<string, number>());
  const pendingResetIndex = useRef<number>();
  const resizeFrame = useRef<number>();
  const [height, setHeight] = useState(0);
  const staysAtBottom = useRef(true);
  const lastMessage = messages[messages.length - 1];

  useEffect(() => {
    return () => {
      if (resizeFrame.current !== undefined) window.cancelAnimationFrame(resizeFrame.current);
    };
  }, []);

  useLayoutEffect(() => {
    const element = hostRef.current;
    if (!element) return;
    const updateHeight = () => setHeight(Math.floor(element.getBoundingClientRect().height));
    updateHeight();
    const observer = new ResizeObserver(updateHeight);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (resizeFrame.current !== undefined) window.cancelAnimationFrame(resizeFrame.current);
    resizeFrame.current = undefined;
    pendingResetIndex.current = undefined;
    rowHeights.current.clear();
    listRef.current?.resetAfterIndex(0, true);
    staysAtBottom.current = true;
    const frame = window.requestAnimationFrame(() => listRef.current?.scrollToItem(Math.max(0, messages.length - 1), "end"));
    return () => window.cancelAnimationFrame(frame);
  }, [chatId]);

  useEffect(() => {
    if (!lastMessage || !staysAtBottom.current) return;
    const frame = window.requestAnimationFrame(() => listRef.current?.scrollToItem(messages.length - 1, "end"));
    return () => window.cancelAnimationFrame(frame);
  }, [lastMessage?.id, lastMessage?.updatedAt, lastMessage?.body, messages.length]);

  const onSize = useCallback((index: number, messageId: string, nextHeight: number) => {
    const roundedHeight = Math.ceil(nextHeight);
    if (roundedHeight <= 0) return;
    if (rowHeights.current.get(messageId) === roundedHeight) return;
    rowHeights.current.set(messageId, roundedHeight);
    pendingResetIndex.current = pendingResetIndex.current === undefined ? index : Math.min(pendingResetIndex.current, index);
    if (resizeFrame.current !== undefined) return;
    resizeFrame.current = window.requestAnimationFrame(() => {
      const resetIndex = pendingResetIndex.current;
      resizeFrame.current = undefined;
      pendingResetIndex.current = undefined;
      if (resetIndex !== undefined) {
        listRef.current?.resetAfterIndex(resetIndex, true);
        // New threads begin with estimated row heights. Once the real, often much
        // shorter heights arrive, re-clamp the bottom position so row zero is not
        // left above the visible list viewport.
        if (staysAtBottom.current) listRef.current?.scrollToItem(Math.max(0, messages.length - 1), "end");
      }
    });
  }, [messages.length]);
  const itemData = useMemo<VirtualMessageListData>(() => ({
    projectId, messages, expandedMessageId, onExpand, onEdit, onResend, onInventoryUpdateAction,
    onBeginDeltaBrief, onAvoidDeltaBrief, deltaLocked, onOpenChatSettings, onRefresh, onSize
  }), [projectId, messages, expandedMessageId, onExpand, onEdit, onResend, onInventoryUpdateAction, onBeginDeltaBrief, onAvoidDeltaBrief, deltaLocked, onOpenChatSettings, onRefresh, onSize]);

  return (
    <div ref={hostRef} className="virtual-message-list-host">
      {height > 0 && <VariableSizeList
        ref={listRef}
        outerRef={listOuterRef}
        className={`message-list virtualized ${bubbleMode === "minimal" ? "minimal" : "bubbles"}`}
        height={height}
        width="100%"
        itemCount={messages.length}
        itemData={itemData}
        itemKey={(index) => messages[index].id}
        itemSize={(index) => rowHeights.current.get(messages[index].id) ?? 280}
        overscanCount={3}
        onScroll={({ scrollOffset }) => {
          const element = listOuterRef.current;
          if (element) staysAtBottom.current = element.scrollHeight - element.clientHeight - scrollOffset < 80;
        }}
      >
        {VirtualMessageListRow}
      </VariableSizeList>}
    </div>
  );
}

function MessageImageAttachments({ messageId }: { messageId: string }) {
  const [attachments, setAttachments] = useState<{ id: string; url: string; mimeType: string }[]>([]);
  const [viewerIndex, setViewerIndex] = useState<number>();
  useEffect(() => {
    let alive = true;
    let urls: { id: string; url: string; mimeType: string }[] = [];
    setAttachments([]);
    void db.attachments.where("[ownerType+ownerId]").equals(["message", messageId]).toArray().then((rows) => {
      const images = rows.filter((attachment) => attachment.mimeType.startsWith("image/")).map((attachment) => ({ id: attachment.id, mimeType: attachment.mimeType, url: URL.createObjectURL(attachment.blob) }));
      urls = images;
      if (!alive) {
        images.forEach((attachment) => URL.revokeObjectURL(attachment.url));
        return;
      }
      setAttachments(images);
    });
    return () => {
      alive = false;
      urls.forEach((attachment) => URL.revokeObjectURL(attachment.url));
    };
  }, [messageId]);
  if (!attachments.length) return null;
  return <><div className="message-image-strip"><ImageStrip attachments={attachments} onOpen={setViewerIndex} /></div>{viewerIndex !== undefined && <ImageViewer attachments={attachments} index={viewerIndex} onChange={setViewerIndex} onClose={() => setViewerIndex(undefined)} />}</>;
}

function InventoryUpdateCard({ updates, onAction }: { updates: InventoryUpdateRequest[]; onAction: (action: "confirm" | "edit" | "reject", editedUpdates?: InventoryUpdateRequest[]) => Promise<void> }) {
  const [editing, setEditing] = useState(false);
  const [drafts, setDrafts] = useState(updates);
  const [error, setError] = useState("");
  const rejected = updates.every((update) => update.status === "rejected");
  useEffect(() => {
    setDrafts(updates);
    setEditing(false);
    setError("");
  }, [updates]);
  if (!updates.length) return null;

  function updateDraft(id: string, patch: Partial<InventoryUpdateRequest>) {
    setDrafts((current) => current.map((update) => update.id === id ? { ...update, ...patch } : update));
  }

  async function saveEdits() {
    const cleaned = drafts.map((update) => ({
      ...update,
      name: update.kind === "currency" ? update.name.trim() : normaliseInventoryName(update.name),
      logSentence: update.logSentence.trim()
    }));
    if (cleaned.some((update) => !update.name || !Number.isFinite(update.delta) || update.delta === 0 || !update.logSentence || (update.kind === "inventory" && update.delta > 0 && (!update.unitWeightKg || !Number.isFinite(update.unitWeightKg))) || (update.unitWeightKg !== undefined && (!Number.isFinite(update.unitWeightKg) || update.unitWeightKg <= 0)))) {
      setError("Each update needs an item name, a non-zero quantity, and a log sentence. Added physical items also need a positive unit weight.");
      return;
    }
    await onAction("edit", cleaned);
  }

  return (
    <div className={`inventory-update-card ${rejected ? "rejected" : ""}`} onClick={(event) => event.stopPropagation()}>
      <h3>Inventory Update</h3>
      <div className="inventory-update-list">
        {(editing ? drafts : updates).map((update) => editing ? (
          <div className="inventory-update-editor" key={update.id}>
            <label>Item<input value={update.name} onChange={(event) => updateDraft(update.id, { name: event.target.value })} /></label>
            <label>Quantity<input type="number" step="any" value={update.delta} onChange={(event) => updateDraft(update.id, { delta: Number(event.target.value) })} /></label>
            {update.kind !== "currency" && <label>Unit weight (kg)<input type="number" min="0" step="any" value={update.unitWeightKg ?? ""} onChange={(event) => updateDraft(update.id, { unitWeightKg: event.target.value === "" ? undefined : Number(event.target.value) })} /></label>}
            <label className="inventory-update-log">Log sentence<input value={update.logSentence} onChange={(event) => updateDraft(update.id, { logSentence: event.target.value })} /></label>
          </div>
        ) : (
          <div className={`inventory-update-row ${update.delta > 0 ? "add" : "remove"}`} key={update.id}>
            <span>{update.name}{update.unitWeightKg ? <small>{formatInventoryKg(update.unitWeightKg)} kg each · {formatInventoryKg(Math.abs(update.delta) * update.unitWeightKg)} kg total</small> : null}</span>
            <strong>{update.delta > 0 ? "+" : ""}{update.delta}</strong>
          </div>
        ))}
      </div>
      {error && <small className="error">{error}</small>}
      {rejected ? <p className="inventory-update-status">((inventory rejected by user))</p> : editing ? (
        <div className="inventory-update-actions">
          <button type="button" onClick={() => void saveEdits()}>Save changes</button>
          <button type="button" onClick={() => { setDrafts(updates); setEditing(false); setError(""); }}>Cancel</button>
        </div>
      ) : (
        <div className="inventory-update-actions">
          <button type="button" onClick={() => void onAction("confirm")}>Confirm</button>
          <button type="button" onClick={() => setEditing(true)}>Edit</button>
          <button type="button" onClick={() => void onAction("reject")}>Reject</button>
        </div>
      )}
    </div>
  );
}

function formatEstimatedCost(cost: number) {
  if (cost === 0) return "$0";
  if (cost < 0.000001) return "<$0.000001";
  return `$${cost.toFixed(cost < 0.01 ? 6 : 4)}`;
}

function EstimatedMessageCost({ message }: { message: Message }) {
  const [pricing, setPricing] = useState<Pick<ModelLibraryEntry, "inputPricePerMillionUsd" | "outputPricePerMillionUsd">>();
  useEffect(() => {
    if (!message.modelId) { setPricing(undefined); return; }
    void db.modelLibrary.where("modelId").equals(message.modelId).first().then((model) => setPricing(model));
  }, [message.modelId]);
  const audit = message.requestInfo?.audit;
  const usage = audit?.version === 2 ? summarizeAuditUsage(audit.requests ?? []) : undefined;
  const inputCost = pricing?.inputPricePerMillionUsd !== undefined && message.inputTokens !== undefined ? message.inputTokens / 1_000_000 * pricing.inputPricePerMillionUsd : 0;
  const outputCost = pricing?.outputPricePerMillionUsd !== undefined && message.outputTokens !== undefined ? message.outputTokens / 1_000_000 * pricing.outputPricePerMillionUsd : 0;
  const hasCost = inputCost > 0 || outputCost > 0 || (pricing && ((message.inputTokens !== undefined && pricing.inputPricePerMillionUsd === 0) || (message.outputTokens !== undefined && pricing.outputPricePerMillionUsd === 0)));
  if (usage) return <span className="message-cost" title="Estimated from recorded requests and their saved prices">{formatEstimatedCost(usage.cost)}{usage.missingUsage || usage.missingPricing ? " (partial)" : ""}</span>;
  return hasCost ? <span className="message-cost" title="Estimated cost from the locally saved model rates">{formatEstimatedCost(inputCost + outputCost)}</span> : null;
}

export function MessageInfoModal({ message, onClose }: { message: Message; onClose: () => void }) {
  const audit = message.requestInfo?.audit;
  const usage = audit?.version === 2 ? summarizeAuditUsage(audit.requests ?? []) : undefined;
  const [pricing, setPricing] = useState<Pick<ModelLibraryEntry, "inputPricePerMillionUsd" | "outputPricePerMillionUsd">>();
  useEffect(() => {
    if (!message.modelId) { setPricing(undefined); return; }
    void db.modelLibrary.where("modelId").equals(message.modelId).first().then((model) => setPricing(model));
  }, [message.modelId]);
  const inputCost = pricing?.inputPricePerMillionUsd !== undefined && message.inputTokens !== undefined ? message.inputTokens / 1_000_000 * pricing.inputPricePerMillionUsd : 0;
  const outputCost = pricing?.outputPricePerMillionUsd !== undefined && message.outputTokens !== undefined ? message.outputTokens / 1_000_000 * pricing.outputPricePerMillionUsd : 0;
  const hasCost = inputCost > 0 || outputCost > 0 || (pricing && ((message.inputTokens !== undefined && pricing.inputPricePerMillionUsd === 0) || (message.outputTokens !== undefined && pricing.outputPricePerMillionUsd === 0)));
  async function copyAudit() {
    if (!audit) return;
    await navigator.clipboard.writeText(JSON.stringify(audit, null, 2));
  }
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <section className="star-modal message-info-modal" onClick={(event) => event.stopPropagation()}>
        <div className="section-title">
          <h2>Response Audit</h2>
          <div className="split-actions">{audit && <button className="icon-button" onClick={copyAudit} aria-label="Copy complete audit" title="Copy complete audit"><Clipboard size={17} /></button>}<button className="icon-button" onClick={onClose} aria-label="Close response audit"><X size={18} /></button></div>
        </div>
        <div className="info-grid">
          <span>Role</span><strong>{message.role}</strong>
          <span>Status</span><strong>{message.status}</strong>
          {message.modelId && <><span>Model</span><strong>{message.modelId}</strong></>}
          <span>Created</span><strong>{formatMessageDate(message.createdAt)}</strong>
          {usage ? <>
            <span>Input tokens</span><strong>{usage.input}t</strong>
            <span>Output tokens</span><strong>{usage.output}t</strong>
            <span>Total recorded tokens</span><strong>{usage.total}t{usage.missingUsage > 0 ? " (partial)" : ""}</strong>
            <span>Estimated recorded cost</span><strong>{formatEstimatedCost(usage.cost)}{usage.missingUsage || usage.missingPricing ? " (partial)" : ""}</strong>
          </> : <><span>Recorded tokens (legacy)</span><strong>{message.inputTokens !== undefined || message.outputTokens !== undefined ? (message.inputTokens ?? 0) + (message.outputTokens ?? 0) : estimateTokens(message.body)}t{message.estimatedTokens ? " (estimated)" : ""}</strong></>}
          {!usage && hasCost && <><span>Estimated cost (legacy)</span><strong>{formatEstimatedCost(inputCost + outputCost)} <small>(${pricing?.inputPricePerMillionUsd ?? 0}/M in · ${pricing?.outputPricePerMillionUsd ?? 0}/M out)</small></strong></>}
          {message.error && <><span>Error</span><strong>{message.error}</strong></>}
        </div>
        <p className="audit-note">Viewing this audit uses stored local data and makes no AI requests.</p>
        {usage ? <p className="audit-note">Totals include recorded reply rounds, compaction, and post-response memory review. {usage.missingUsage > 0 && (usage.missingUsage + " request(s) have missing or incomplete usage. ")}{usage.missingPricing > 0 && (usage.missingPricing + " request(s) have missing pricing. ")}Cost uses prices saved when each request started; provider billing can differ.{!audit?.postResponseMemory && " Post-response review has not finished being recorded."}</p> : <p className="audit-note">Legacy records may omit earlier tool rounds and background requests. Their original usage and prices cannot be reconstructed.</p>}
        {message.requestInfo && (
          <div className="response-audit-sections">
            <details open>
              <summary>Settings and toggles</summary>
              <div className="audit-list">{message.requestInfo.settings.map((item, index) => <p key={`setting-${index}`}>{item}</p>)}{message.requestInfo.toggles.map((item, index) => <p key={`toggle-${index}`}>{item}</p>)}</div>
            </details>
            {audit ? <>
              <details open>
                <summary>Context sources</summary>
                <div className="audit-source-list">{audit.contextSources.map((source) => <div key={source.name} className={source.included ? "included" : "excluded"}><span>{source.name}</span><strong>{source.name === "Source library" ? (source.included ? "Available for lookup" : "Unavailable") : (source.included ? "Included" : "Not included")}</strong>{source.detail && <small>{source.detail}</small>}</div>)}</div>
              </details>
              <details open>
                <summary>Memory retrieval ({audit.memoryRetrieval.hits.length} hit{audit.memoryRetrieval.hits.length === 1 ? "" : "s"})</summary>
                <div className="audit-block"><p><b>Mode:</b> {audit.memoryRetrieval.mode}</p><p><b>Concepts:</b> {audit.memoryRetrieval.concepts.join(", ") || "None"}</p><p><b>Query:</b> {audit.memoryRetrieval.query || "No search was run"}</p>{audit.memoryRetrieval.hits.length ? audit.memoryRetrieval.hits.map((hit) => <section className="audit-memory-hit" key={hit.id}><strong>{hit.text}</strong><small>Relevance {hit.relevance.toFixed(3)}{hit.tags.length ? ` · ${hit.tags.join(", ")}` : ""}</small></section>) : <p>No memories were supplied to this response.</p>}</div>
              </details>
              <details open>
                <summary>Tool execution ({audit.toolEvents.length})</summary>
                <div className="audit-tool-list">{audit.toolEvents.length ? audit.toolEvents.map((tool, index) => <details key={`${tool.callId}-${index}`}><summary>{index + 1}. {tool.name} · round {tool.round}</summary><label>Arguments<pre>{tool.arguments}</pre></label><label>Returned result<pre>{tool.result}</pre></label><small>Call ID: {tool.callId}</small>{tool.sources && <details><summary>Source versions at lookup</summary><pre>{JSON.stringify(tool.sources, null, 2)}</pre></details>}</details>) : <p>No tools were called.</p>}</div>
              </details>
              <details>
                <summary>History selection ({audit.selectedHistory.length} messages)</summary>
                <div className="audit-history-list">{audit.selectedHistory.map((item) => <div key={item.id}><span>#{item.sequence} · {item.role}</span><strong>{item.usedCondensation ? "Condensed" : "Original"}</strong><small>{item.id}</small></div>)}</div>
              </details>
              {audit.version === 2 ? <>
                <details open><summary>Source files</summary>
                  <p>Library available: {audit.sourceVersions?.length ?? 0} files. Sources with returned text: {retrievedSourceNames(audit.toolEvents).join(", ") || "None"}. Check tool results for the passages.</p>
                  <p className="audit-note">These are historical file fingerprints, not a live file listing or a file-edit log. Lookup events retain the versions used even if a file later changes or is removed.</p>
                  <details><summary>Library versions when reply started</summary><pre>{JSON.stringify(audit.sourceVersions ?? [], null, 2)}</pre></details>
                </details>
                <details><summary>Actual requests ({audit.requests?.length ?? 0})</summary>
                  <p className="audit-note">Each payload was captured at dispatch. Image bytes are omitted. Audit metadata and API keys are never added to these payloads.</p>
                  {audit.requests?.map((request, index) => <details key={index}><summary>{index + 1}. {request.purpose} / {request.status}</summary>
                    <p>Input: {request.usage?.prompt_tokens ?? "Unavailable"} / Output: {request.usage?.completion_tokens ?? "Unavailable"}</p>
                    {request.error && <p className="error">{request.error}</p>}
                    <pre className="audit-payload">{JSON.stringify(request.payload, null, 2)}</pre>
                  </details>)}
                </details>
              </> : <details>
                <summary>Legacy request snapshot</summary>
                <p className="audit-note">This older snapshot may differ from the dispatched request and does not include subsequent tool rounds. Image bytes are omitted.</p>
                <pre className="audit-payload">{JSON.stringify(audit.requestPayload, null, 2)}</pre>
              </details>}
              <details open>
                <summary>Post-response memory review</summary>
                {audit.postResponseMemory ? <div className="audit-block"><p><b>Status:</b> {audit.postResponseMemory.status}</p>{audit.postResponseMemory.reason && <p>{audit.postResponseMemory.reason}</p>}{audit.postResponseMemory.error && <p className="error">{audit.postResponseMemory.error}</p>}<p><b>Messages considered for condensation:</b> {audit.postResponseMemory.condensationMessageIds.join(", ") || "None"}</p>{audit.postResponseMemory.candidates.map((candidate, index) => <section className="audit-memory-hit" key={`${candidate.text}-${index}`}><strong>{candidate.text}</strong><small>{candidate.action}{candidate.tags.length ? ` · ${candidate.tags.join(", ")}` : ""}</small></section>)}{audit.postResponseMemory.requestPayload && <details><summary>Memory review request</summary><pre className="audit-payload">{JSON.stringify(audit.postResponseMemory.requestPayload, null, 2)}</pre></details>}{audit.postResponseMemory.rawResponse !== undefined && <details><summary>Raw memory review response</summary><pre className="audit-payload">{audit.postResponseMemory.rawResponse || "(empty response)"}</pre></details>}</div> : <p>Review has not completed or was not captured.</p>}
              </details>
            </> : <p className="notice">No detailed audit is stored for this message. It may predate auditing or its audit may have been cleared.</p>}
          </div>
        )}
      </section>
    </div>
  );
}
