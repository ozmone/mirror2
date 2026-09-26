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
- Full database export, transactional merge/replace import, and recovery snapshots. Backup export excludes the API key.

Delta remains work in progress. Gear management is manual; the main chat does not offer automated gear changes.

## Code ownership

- `src/ui/App.tsx`: navigation, project/settings screens, and app-level state.
- `src/ui/chat/ChatScreen.tsx`: chat controls and turn orchestration.
- `src/ui/chat/context.ts`: chat history, attachments, and context parsing.
- `src/ui/chat/MessageList.tsx`: message rendering, virtualization, and message information.
- `src/ui/chat/completeReply.ts`: shared send/resend completion, streaming, usage, and reply persistence.
- `src/ui/chat/transport.ts`: OpenRouter request transport and cancellation.
- `src/data/deletion.ts`: transactional deletion of records and owned attachments.
- `src/ui/shared/useAttachmentImages.ts`: attachment loading and object-URL lifetime.

## Verification

Run `npm run typecheck`, `npm test`, and `npm run build`. Tests use an in-memory IndexedDB implementation; they do not access the browser's saved projects. Coverage includes deletion isolation and rollback, attachment URL cleanup, split streaming responses, interruption, and tool finalization, alongside the existing feature tests.
