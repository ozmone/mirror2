# Mirror 2.0 PWA

Mirror 2.0 is a mobile-first, local-first PWA for roleplay projects and OpenRouter chat.

## Run Locally

```powershell
npm install
npm run dev
```

## Production Build

```powershell
npm run build
```

The app uses `base: "./"` so the built files in `dist/` can be hosted from a GitHub Pages repository subpath.

## Current Coverage

- Installable PWA manifest and service worker app shell.
- React + TypeScript strict mode + Vite.
- IndexedDB persistence through Dexie, with normalized tables for settings, projects, chats, branches, messages, stars, archives, archive entries, attachments, characters, character bonuses, memories, pending memories, models, and migrations.
- Mobile drawer navigation with project selection gating chat.
- Project creation/editing, pinned state, icon selection, icon colors, instructions, world setting, and memory settings.
- Chat with virtualized message rendering, streaming replies, composer context toggles, starred messages, and token usage. Resending an earlier user message replaces later messages in that branch and removes their attachments.
- Settings for themes, accent swatches, fonts, font size, bubble style, entry width, and message spacing.
- API page for OpenRouter key storage controls, privacy preset, fetched model search, and a custom model library.
- Archives, Characters, Memories, Stars, and Data pages.
- Character retrieval helpers that return only Identity, Bio, or final Stats divisions.
- Memory search helper restricted to the active project.
- Timeline continuity: one ordered project record shared by enabled chats, with compact editable entries and no clock/calendar dependency.
- Full database export, transactional merge/replace import, and recovery snapshots. Backup export excludes the API key.

Delta remains work in progress. Gear management is manual; the main chat does not offer automated gear changes.

## Timeline continuity

Open **Chat settings**, enable **Timeline continuity**, and save. **Memory compaction** is an independent per-chat control; turning it off also stops using and generating condensed message text. Existing chats retain their previous compaction preference when the database upgrades. Settings saved before creating a chat provide defaults for new chats.

The project sidebar's **Timeline continuity** page displays one oldest-to-newest record as **Title: content** entries. Enabled chats receive checked entries as context; unchecked entries stay visible but are excluded. Before sending a reply request, completed turns leaving the configured message history window are reviewed and added to continuity. If the window splits a turn, its user message and completed reply are reviewed together. Recent turns are not automatically captured after every reply. With unlimited history, automatic capture does not run. **Update timeline** manually reviews all unreviewed history in enabled chats and retries failed reviews, regardless of history limit. Reviews use additional OpenRouter requests; no review runs for disabled chats.

Entries support search, source-chat links, manual additions, edits, earlier/later ordering, and removal with undo. User edits remain authoritative, and removed entries are not regenerated from the same turn. Editing a source message invalidates its automatic entry until the next update; regenerating or deleting messages removes their linked entries. Failed or stopped responses do not become continuity. Full backups and recovery snapshots include the timeline.

Each timeline entry has visible **Edit** and **Delete** buttons; the three-dot menu contains ordering controls. Deletion offers **Undo removal** on the page.

With a model that supports tools, ask in chat to delete a saved memory or Timeline continuity entry. The AI uses `find_memory_entries` to find exact records, then `delete_memory_entry` to remove only those records from the current project. Lookup includes pending memory suggestions. Existing records can be managed even when automatic capture is disabled. The app rejects guessed IDs, entries from other projects, and entries changed since lookup. Administrative memory tool turns are excluded from timeline capture and automatic memory saving. Memory compaction and the original chat messages are untouched.

## Code ownership

- `src/ui/App.tsx`: navigation, project/settings screens, and app-level state.
- `src/ui/chat/ChatScreen.tsx`: chat controls and turn orchestration.
- `src/ui/chat/context.ts`: chat history, attachments, and context parsing.
- `src/ui/chat/MessageList.tsx`: message rendering, virtualization, and message information.
- `src/ui/chat/completeReply.ts`: shared send/resend completion, streaming, usage, and reply persistence.
- `src/ui/chat/transport.ts`: OpenRouter request transport and cancellation.
- `src/data/deletion.ts`: transactional deletion of records and owned attachments.
- `src/data/timeline.ts`: ordered continuity, incremental reviews, source tracking, and invalidation.
- `src/data/memoryManagement.ts`: project-scoped lookup and deletion tools with per-turn lookup receipts.
- `src/ui/timeline/TimelinePage.tsx`: compact project timeline and entry controls.
- `src/ui/shared/useAttachmentImages.ts`: attachment loading and object-URL lifetime.

## Verification

Run `npm run typecheck`, `npm test`, and `npm run build`. Tests use an in-memory IndexedDB implementation; they do not access the browser's saved projects. Coverage includes deletion isolation and rollback, attachment URL cleanup, split streaming responses, interruption, and tool finalization, alongside the existing feature tests.
