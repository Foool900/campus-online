# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

Root `package.json` delegates to `server/` and `client/` via `--prefix`. There is **no linter and no test suite** configured.

```bash
npm install          # installs root + server + client deps (postinstall hook)
npm run dev          # start server (3001) + client (5173) together via concurrently
npm run server       # backend only, http://localhost:3001
npm run client       # frontend only (Vite), http://localhost:5173
npm run build        # build client into client/dist (needed before production/deploy)
npm start            # run backend in production (serves client/dist)
```

- **Node >= 22 is required.** `better-sqlite3@13` (a native module) is pinned to Node 22's prebuilt binaries; see `engines` and the "锁定 Node 22" commit.
- The backend dev script (`server/package.json` `dev`) uses `node --watch` on `index.js`, `db.js`, `seed.js`, and `routes/`.
- To reset the database, delete `server/data/campus.db*` — `initDb()` + `seedIfEmpty()` recreate and reseed on next start.

## Architecture

Monorepo: Express 5 + Socket.IO backend in `server/`, React 19 + Vite frontend in `client/`. Everything is ESM (`"type": "module"`). All comments and user-facing strings are in **Chinese** — match that convention.

### Backend (`server/`)

- `index.js` wires Express routes, mounts Socket.IO, and (in production) serves `client/dist` with a BrowserRouter fallback to `index.html` for any non-`/api` GET.
- `db.js` opens SQLite at `server/data/campus.db` (override with `DB_PATH`), WAL mode, `foreign_keys = ON`. Tables are created idempotently in `initDb()`, which also runs inline migrations (e.g. the `areas.hidden` column).
- `seed.js` writes seed data **only when the `campuses` table is empty** (`seedIfEmpty`), and separately runs `ensureWorldChannel()` on every boot to guarantee the world channel exists.
- `routes/` = one file per resource (`areas`, `channels`, `messages`, `posts`, `todos`, `users`, `campuses`, `achievements`, `world`). Handlers validate inputs with `Number(...)` + `Number.isInteger(...)` and return `{ error, status }`-shaped errors in Chinese.

**REST + Socket.IO share one write path.** `routes/messages.js` exports `insertMessage(channelId, userId, content)` which validates, inserts, and returns `{ message }` or `{ error, status }`. The `POST /messages` route and the `message:send` socket handler both call it; only the socket handler broadcasts `message:new` to the room.

**The "world channel" is a hidden area.** It lives in the `areas` table with `slug = 'world'` and `hidden = 1`. All normal area queries filter `WHERE hidden = 0`, so it never appears on the map or in the todo area dropdown; clients discover it via `GET /api/world`. The `areas_visited` achievement metric also excludes hidden areas. If you add new area-based features, remember to keep the `hidden = 0` filter.

### Frontend (`client/`)

- `App.jsx` owns the `user` state, persisted in `localStorage` under `campus_user` and exposed via `UserContext.jsx` (`useUser()`). On mount it refreshes the user from the backend to sync `exp`/`level`; a 404 clears the stored user, which re-triggers `NicknameModal`. There is no auth — users are anonymous and reused by nickname (see `POST /users`).
- `api.js` is a thin `fetch` wrapper that throws an `Error` with `.status` on non-2xx; every endpoint has a named method. `socket.js` is a singleton `socket.io-client` connected same-origin (Vite proxies `/socket.io`).
- **HUD layout** (`components/Layout.jsx`) is the app shell: a full-screen, pannable/zoomable map (`HeDaMap`) with floating HUD panels (`HudPanels.jsx`), the global `WorldChat` pinned bottom-center, and pages rendered on top inside `HudOverlay.jsx` (a glass overlay that shows whenever the route is not `/`). Routes in `App.jsx` map `/` and `*` to `null`; only `/tasks`, `/leaderboard`, `/achievements`, `/profile` have page content.
- `pages/MapPage.jsx` is **legacy dead code** — it is not imported by `App.jsx` (the map now lives in `Layout`). Leave it alone or delete it, but don't treat it as the active map implementation.
- `styles.css` is the original light theme; `hud.css` loads after it and overrides class names to the dark HUD look. Both are imported in `main.jsx`.

### Map coordinate system

Seed coordinates are in a **logical 1000×1900 space** (`server/seed.js`). `HeDaMap.jsx` scales them to each campus's actual image size in `public/maps/` (`minglun.jpg` 1600×2749, `jinming.jpg` 920×1596). Marker positions are stored as `areas.x`/`areas.y` in logical units and patched via `PATCH /api/areas/:id` when dragged in edit mode — don't store pixel coordinates.

### Game rules (duplicated logic to keep in sync)

- Level formula: `level = floor(exp / 100) + 1`. Defined in `server/routes/users.js` (`levelOf`) **and** re-implemented in `client/src/pages/TasksPage.jsx` (`levelOf`). Keep both in sync when changing it.
- Completing a todo grants `exp_reward` exp and is idempotent server-side (`routes/todos.js` wraps the update in a transaction and returns `alreadyCompleted`).
- Achievements are **computed on read** (`routes/achievements.js` `metricValue`), not stored per-user; `threshold: 0` means "count of non-hidden channels" (`areas_visited`).

## Deployment

Two paths exist and both serve `client/dist` from the backend (single origin):

- **Render**: `render.yaml` Blueprint — `buildCommand: npm run build`, `startCommand: npm start`, `healthCheckPath: /api/health`, `NODE_VERSION: 22`. Free tier has no disk, so SQLite resets on redeploy.
- **PM2 / bare Linux**: `ecosystem.config.cjs` runs `npm start` with `NODE_ENV=production` and `PORT=80`. See `DEPLOY.md` for the full student-server walkthrough.
