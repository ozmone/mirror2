# Mirror 2.0 PWA

Mirror 2.0 is a mobile-first, local-first PWA scaffold for roleplay projects and OpenRouter chat.

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
- Chat shell with virtualized message rendering, composer context toggles, starred messages, token estimates, and branch-safe resend confirmation placeholder.
- Settings for themes, accent swatches, fonts, font size, bubble style, entry width, and message spacing.
- API page for OpenRouter key storage controls, privacy preset, and custom model library.
- Archives, Characters, Memories, Stars, and Data pages.
- Character retrieval helpers that return only Identity, Bio, or final Stats divisions.
- Memory search helper restricted to the active project.
- Backup All export excludes the API key.

OpenRouter live streaming, model search through the network API, full transactional import UI, image compression, and complete branch navigation are prepared in the structure but still need a follow-up implementation pass.
