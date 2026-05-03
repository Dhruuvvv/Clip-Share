# Workspace

## Overview

pnpm workspace monorepo using TypeScript. Each package manages its own dependencies.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **API framework**: Express 5
- **Database**: PostgreSQL + Drizzle ORM
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **API codegen**: Orval (from OpenAPI spec)
- **Build**: esbuild (CJS bundle)

## Key Commands

- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- `pnpm --filter @workspace/api-server run dev` — run API server locally

See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details.

## Application: ClipShare

A cross-device clipboard sharing web app. Paste text or links on your phone, access them instantly on your laptop (and vice versa).

### Features
- Paste text or links — auto-detected as "text" or "link" type
- One-click copy to clipboard on any device
- Real-time sync via 2-second polling (no WebSocket needed)
- Delete clips when done
- Dark mode toggle
- Mobile-first responsive design
- Clip count summary

### Architecture
- **Frontend**: React + Vite at `/` (`artifacts/clipshare`)
- **Backend**: Express API at `/api` (`artifacts/api-server`)
- **Database**: PostgreSQL with `clips` table (id, content, type, createdAt)

### API Endpoints
- `GET /api/clips` — list clips (most recent first, paginatable)
- `POST /api/clips` — create a clip `{ content, type }`
- `DELETE /api/clips/:id` — delete a clip
- `GET /api/clips/summary` — usage stats (totalClips, textCount, linkCount, recentClips)

### DB Schema
- `lib/db/src/schema/clips.ts` — `clipsTable` with serial id, text content, text type enum, timestamp createdAt

### Orval Config Note
The zod output in `lib/api-spec/orval.config.ts` uses `mode: "single"` (not `mode: "split"`) to avoid a naming conflict between the Zod schemas and TypeScript types both exporting `CreateClipBody`.
