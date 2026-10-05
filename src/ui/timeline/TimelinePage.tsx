import { liveQuery } from "dexie";
import { ArrowDown, ArrowUp, Check, GitCommitHorizontal, MoreHorizontal, Pencil, Plus, RefreshCw, Search, Trash2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { db } from "../../data/db";
import { addTimelineEntry, moveTimelineEntry, timelineEntries, updateTimelineContinuity } from "../../data/timeline";
import type { AppSettings, Chat, Project, TimelineEntry } from "../../types";
import { now } from "../../utils";
import { sendOpenRouterRequest } from "../chat/transport";
import { EmptyState } from "../shared/appElements";

export function TimelinePage({ project, settings, selectedModelId, onOpenChat }: {
  project?: Project; settings: AppSettings; selectedModelId: string; onOpenChat: (id: string) => Promise<void>;
}) {
  const [entries, setEntries] = useState<TimelineEntry[]>([]);
  const [chats, setChats] = useState<Chat[]>([]);
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<string>();
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [deletedId, setDeletedId] = useState<string>();
  const [expanded, setExpanded] = useState<string[]>([]);
  const latestRef = useRef<HTMLDivElement>(null);
  const workingRef = useRef(false);

  useEffect(() => {
    if (!project) return;
    const subscription = liveQuery(async () => ({
      entries: await timelineEntries(project.id),
      chats: await db.chats.where("projectId").equals(project.id).toArray()
    })).subscribe({ next: (value) => { setEntries(value.entries); setChats(value.chats); }, error: (cause) => setError(String(cause)) });
    return () => subscription.unsubscribe();
  }, [project?.id]);

  if (!project) return <EmptyState title="No project selected" body="Choose a project to open Timeline continuity." />;
  const projectId = project.id;
  const enabledChats = chats.filter((chat) => chat.timelineContinuityEnabled);
  const visible = entries.filter((entry) => `${entry.title} ${entry.body} ${chats.find((chat) => chat.id === entry.sourceChatId)?.title ?? ""}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));

  async function run(action: () => Promise<void>) {
    if (workingRef.current) return;
    workingRef.current = true;
    setBusy(true); setError(""); setNotice("");
    try { await action(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Could not save Timeline continuity."); }
    finally { workingRef.current = false; setBusy(false); }
  }

  function edit(entry?: TimelineEntry) {
    setEditing(entry?.id ?? "new"); setTitle(entry?.title ?? ""); setBody(entry?.body ?? "");
  }

  async function save() {
    if (editing === "new") await addTimelineEntry(projectId, title, body);
    else if (editing) {
      const updated = await db.timelineEntries.update(editing, {
        title: title.trim().replace(/[:\s]+$/, ""), body: body.trim(), manuallyEdited: true, stale: false, updatedAt: now()
      });
      if (!updated) throw new Error("This entry was removed after its source changed. Add it as a new entry if you want to keep it.");
    }
    setEditing(undefined); setNotice("Saved.");
  }

  const editor = <form className="timeline-editor" onSubmit={(event) => { event.preventDefault(); void run(save); }}>
    <label>Title<input autoFocus maxLength={160} value={title} onChange={(event) => setTitle(event.target.value)} placeholder="A short opening label" /></label>
    <label>Content<textarea rows={4} value={body} onChange={(event) => setBody(event.target.value)} placeholder="What became established?" /></label>
    <div className="timeline-inline-actions"><button type="submit" disabled={busy || !title.replace(/[:\s]+$/, "") || !body.trim()}>Save entry</button><button type="button" disabled={busy} onClick={() => setEditing(undefined)}>Cancel</button></div>
  </form>;

  return <section className="page timeline-page" aria-label="Timeline continuity">
    <div className="timeline-heading"><GitCommitHorizontal size={18} /><h2>Timeline continuity</h2><span>{entries.length}</span></div>
    <p className="timeline-description">One shared project record, oldest to newest.</p>
    <div className="timeline-toolbar">
      <label className="timeline-search"><Search size={15} /><input aria-label="Search Timeline continuity" placeholder="Search continuity" value={query} onChange={(event) => setQuery(event.target.value)} /></label>
      <button type="button" onClick={() => edit()} disabled={busy || Boolean(editing)}><Plus size={15} /> Add</button>
      <button type="button" disabled={busy || !enabledChats.length} onClick={() => void run(async () => {
        if (!settings.apiKey?.trim()) throw new Error("Add your OpenRouter API key in API Settings to update Timeline continuity.");
        setReviewing(true);
        try {
          for (const chat of enabledChats) {
            await updateTimelineContinuity(chat.id, selectedModelId || chat.modelId || settings.defaultModelId || "", (payload) => sendOpenRouterRequest(payload, settings.apiKey));
          }
          setNotice("Timeline continuity is up to date.");
        } finally { setReviewing(false); }
      })}><RefreshCw size={15} className={reviewing ? "timeline-updating" : undefined} />{reviewing ? "Updating…" : "Update timeline"}</button>
    </div>
    <div className="timeline-meta"><span>{enabledChats.length ? `${enabledChats.length} contributing chat${enabledChats.length === 1 ? "" : "s"}` : "Enable Timeline continuity in chat settings to capture developments."}</span>{entries.length > 0 && <button type="button" onClick={() => latestRef.current?.scrollIntoView({ behavior: "smooth", block: "end" })}>Jump to latest <ArrowDown size={12} /></button>}</div>
    {(notice || deletedId) && <div className="timeline-feedback" role="status">{notice}{deletedId && <button type="button" disabled={busy} onClick={() => void run(async () => { await db.timelineEntries.update(deletedId, { deleted: false, updatedAt: now() }); setDeletedId(undefined); setNotice("Entry restored."); })}>Undo removal</button>}</div>}
    {error && <p className="error" role="alert">{error}</p>}
    {enabledChats.filter((chat) => chat.timelineError).map((chat) => <p className="timeline-review-error" key={chat.id}><strong>{chat.title}:</strong> {chat.timelineError} Use Update timeline to retry.</p>)}
    {editing === "new" && editor}
    {!entries.length && !editing && <p className="timeline-empty">The story so far will appear here as concise entries. You can also add an entry yourself, or update the timeline to review existing chats with continuity enabled.</p>}
    {entries.length > 0 && visible.length === 0 && <p className="timeline-empty">No entries match your search.</p>}
    <ol className="timeline-list">
      {visible.map((entry) => {
        const source = chats.find((chat) => chat.id === entry.sourceChatId);
        const index = entries.findIndex((item) => item.id === entry.id);
        const isExpanded = expanded.includes(entry.id);
        return <li key={entry.id} className={`timeline-entry${entry.includedInContext === false ? " timeline-entry-excluded" : ""}`}>
          {!entry.pendingApproval && <input className="timeline-inclusion" type="checkbox" checked={entry.includedInContext !== false} disabled={busy}
            aria-label={`Include ${entry.title} in AI context`} title="Include in AI context"
            onChange={(event) => { const includedInContext = event.target.checked; void run(async () => {
              await db.timelineEntries.update(entry.id, { includedInContext, updatedAt: now() });
            }); }} />}
          {editing === entry.id ? editor : <>
            <p className={`timeline-entry-text ${entry.body.length > 420 && !isExpanded ? "timeline-collapsed" : ""}`}><strong>{entry.title.replace(/[:\s]+$/, "")}:</strong> {entry.body}</p>
            <div className="timeline-entry-footer">
              {entry.pendingApproval && <span>Awaiting approval</span>}
              {source ? <button className="timeline-source" type="button" onClick={() => void run(() => onOpenChat(source.id))}>{source.title}</button> : !entry.pendingApproval && <span>Added manually</span>}
              {entry.manuallyEdited && source && <span>Edited by you</span>}
              {entry.body.length > 420 && <button type="button" aria-expanded={isExpanded} onClick={() => setExpanded((values) => isExpanded ? values.filter((id) => id !== entry.id) : [...values, entry.id])}>{isExpanded ? "Show less" : "Read more"}</button>}
              <div className="timeline-entry-controls">
                {entry.pendingApproval && <>
                  <button type="button" aria-label={`Approve ${entry.title}`} title="Approve" disabled={busy || Boolean(editing)} onClick={() => void run(async () => { await db.timelineEntries.update(entry.id, { pendingApproval: false, updatedAt: now() }); })}><Check size={14} /></button>
                  <button type="button" className="danger" aria-label={`Deny ${entry.title}`} title="Deny" disabled={busy} onClick={() => void run(async () => { await db.timelineEntries.update(entry.id, { deleted: true, updatedAt: now() }); setDeletedId(entry.id); setNotice("Suggestion denied."); })}><X size={14} /></button>
                </>}
                <button type="button" disabled={busy || Boolean(editing)} onClick={() => edit(entry)}><Pencil size={13} /> Edit</button>
                {!entry.pendingApproval && <button type="button" className="danger" disabled={busy} onClick={() => void run(async () => { await db.timelineEntries.update(entry.id, { deleted: true, updatedAt: now() }); setDeletedId(entry.id); setNotice("Entry deleted."); })}><Trash2 size={13} /> Delete</button>}
              <details className="timeline-entry-menu"><summary aria-label={`Actions for ${entry.title}`}><MoreHorizontal size={16} /></summary><div>
                <button type="button" disabled={busy || index === 0} onClick={() => void run(() => moveTimelineEntry(entry.id, -1))}><ArrowUp size={13} /> Earlier</button>
                <button type="button" disabled={busy || index === entries.length - 1} onClick={() => void run(() => moveTimelineEntry(entry.id, 1))}><ArrowDown size={13} /> Later</button>
              </div></details>
              </div>
            </div>
          </>}
        </li>;
      })}
    </ol>
    <div ref={latestRef} />
  </section>;
}
