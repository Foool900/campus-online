# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

Root `package.json` delegates to `server/` and `client/` via `--prefix`. There is **no linter**; tests use `node:test`.

```bash
npm install                 # root + server + client deps (postinstall hook)
npm run dev                 # start server (3001) + client (5173) together via concurrently
npm run server              # backend only, http://localhost:3001
npm run client              # frontend only (Vite), http://localhost:5173
npm run build               # build client into client/dist (needed before production/deploy)
npm start                   # run backend in production (serves client/dist)

# tests (node --test, in server/test/)
npm --prefix server test    # or: cd server && npm test
```

- **Node >= 22 is required.** `better-sqlite3@13` (native module) is pinned to Node 22's prebuilt binaries.
- The backend dev script (`server/package.json` `dev`) uses `node --watch` on `index.js`, `db.js`, `seed.js`, and `routes/`.
- **Tests** live in `server/test/*.test.js` and run against an in-memory SQLite — each file sets `process.env.DB_PATH = ':memory:'` *before* importing `db.js`, so it never touches `server/data/campus.db`. There is no root `test` script.
- To reset the database, delete `server/data/campus.db*` — `initDb()` + `seedIfEmpty()` recreate and reseed on next start.

## Architecture

Monorepo: Express 5 + Socket.IO backend in `server/`, React 19 + Vite frontend in `client/`. Everything is ESM (`"type": "module"`). All comments and user-facing strings are in **Chinese** — match that convention.

### Backend (`server/`)

- `index.js` wires Express routes + Socket.IO, mounts every router under `/api`, serves `/uploads` statically, and (in production) serves `client/dist` with a BrowserRouter fallback to `index.html` for any non-`/api` GET.
- `db.js` opens SQLite at `server/data/campus.db` (override with `DB_PATH`), WAL mode, `foreign_keys = ON`. Tables are created idempotently in `initDb()`, which also runs inline migrations (e.g. `messages` gains `conversation_type`/`conversation_id`, `users` gains `password_hash`/`role`/`coin`/`frozen_coin`). Timestamps are ISO strings via `nowIso()`.
- `seed.js` seeds **only when `campuses` is empty** (`seedIfEmpty`); `ensureWorldChannel()` and `ensureAdmin()` run on every boot.
- `routes/` = one file per resource. Handlers validate with `Number(...)` + `Number.isInteger(...)` and return `{ error, status }`-shaped errors in Chinese.

### Auth & roles

Token-based sessions replaced the old anonymous "reuse user by nickname" flow. **`POST /users` no longer exists** — users register/login via `/api/auth/*` (`routes/auth.js`).

- `auth.js` (module): scrypt password hashing, 30-day session tokens in the `sessions` table, plus `requireAuth` and `requireRole(...)` middleware. `getSessionUser(token)` resolves a token to a user.
- `index.js` mounts `authRouter` **before** a global `requireAuth`, so `/api/auth/*` is public and **everything else under `/api` requires a valid `Authorization: Bearer <token>`** (also accepted via `?token=`).
- Socket.IO authenticates the same way: `io.use` checks `socket.handshake.auth.token` and rejects unauthenticated connections.
- **Roles**: `member` (default) → `student` (granted when an admin approves a `verification`) → `admin`. Most REST write endpoints gate with `requireRole('student', 'admin')` (posting messages, stickers, tasks). Admin is bootstrapped by `ensureAdmin()` — nickname from `ADMIN_NICKNAME` env or default `FOolish` — and can promote/demote admins and review `verifications` via `routes/verification.js` (`/api/admin`, `/api/verification/*`).

### Unified message model (key invariant)

`routes/messages.js` exports `insertConversationMessage(type, id, userId, payload)` — the **single write path for all chat**. `conversation_type` is one of:

| type | `conversation_id` points at | notes |
| --- | --- | --- |
| `chat` | `channels.id` | area channels + world channel |
| `activity` | `posts.id` | activity discussion (participants only; read-only once ended/cancelled) |
| `direct` / `group` | `conversations.id` | DM / group chat (member-gated) |
| `task` | `tasks.id` | public-task discussion (publisher/assignee only) |

- Every `messages` row has a `channel_id` (NOT NULL); for `direct`/`group`/`task` messages it's a placeholder = `worldChannelId()` (the real dimension is `conversation_type` + `conversation_id`).
- `insertMessage(channelId, userId, content)` and `insertPostMessage(...)` are backward-compat wrappers over it.
- The REST route handlers **and** the `message:send` socket handler both call `insertConversationMessage`; only the socket handler broadcasts `message:new` to the room.
- Socket rooms: `channel:{id}`, `post:{id}`, and `{type}:{id}` for `direct`/`group`/`task`. `message:send` accepts the new `conversationType`/`conversationId` fields, falling back to the old `postId`/`channelId`. `join:conv`/`leave:conv` are the generic join/leave events.

### Experience + coin accounts (key invariant)

Two separate accounts live on `users`:

- **经验 `exp`** — total, monotonic, drives level. Earn-only (never spent); tagged with a `source` (`behavior` / `story` / `admin`).
- **金币 `coin` + `frozen_coin`** — spendable currency (task bounties now, market later).

- **All exp grants MUST go through `server/exp.js`** (`grantExp` / `applyExpRaw`). **All coin changes MUST go through `server/coin.js`** (`mintCoin` / `freezeCoin` / `transferCoin` / `refundCoin` / `sinkCoin`, or the lower-level `applyCoinTransaction` / `applyCoinRaw`). Never `UPDATE` the exp/coin columns directly.
- Every flow writes a ledger row with a unique `idempotency_key` (repeating a call is a no-op): exp → `exp_transactions`, coin → `coin_transactions`.
- `applyExpRaw` / `applyCoinRaw` exist for callers already inside a `db.transaction()` (better-sqlite3 throws on nested transactions) — see `routes/tasks.js`.
- Level formula `level = floor(exp / 100) + 1` is defined **only** in `server/config.js` (`levelOf`); the server returns `level` in user/wallet payloads, so the client does not reimplement it.

### Task system

`routes/tasks.js` — tasks are `private` (personal memo, reward forced 0) or `public` (posted with a **coin** bounty escrowed from the publisher via `freezeCoin`). State machine: private `todo → done`; public `published → accepted → submitted → approved` (reject → `accepted` up to a cap; terminal states are `approved`/`terminated`/`expired`/`cancelled`). Completing a task grants **exp** (behavior source, daily-capped + idempotent). `expireOverdueTasks(io)` runs on boot and every 60s to auto-refund/expire overdue tasks. Full spec lives in **`TASKS.md`**.

### The "world channel" is a hidden area

It's an `areas` row with `slug = 'world'` and `hidden = 1`. Normal area queries filter `WHERE hidden = 0`, so it never appears on the map or in the todo/task area dropdown; clients discover it via `GET /api/world`. The `areas_visited` achievement metric also excludes hidden areas. New area-based features must keep the `hidden = 0` filter.

### Map rendering (hash scatter, not stored coordinates)

The live map is `client/src/components/MapEngine.jsx`, which positions each area by a **deterministic hash of `area.id`** (`scatterPos`) inside a fixed 2400×1400 logical space — a "star map" whose layout is stable across reloads and intentionally not user-editable. The `areas.x`/`areas.y` columns still exist (seeded in a legacy 1000×1900 space) but are **not read by any live code**; the old `PATCH /api/areas/:id` edit endpoint and the `MapPage.jsx`/`HeDaMap.jsx` map were removed as dead code.

### Frontend (`client/`)

- `App.jsx` owns the auth state, persisted as the token in `localStorage.campus_token`. On mount it calls `authMe()` to restore the user (a failure clears the token). It connects/disconnects the socket when the token changes and shows `LoginModal` when unauthenticated. `UserContext.jsx` exposes `{ user, token, applyAuth, logout }` via `useUser()`.
- Routes in `App.jsx`: `/`, `/tasks`, `/leaderboard`, `/achievements`, `/profile`, `/activity/:id`, `/task/:id`, `/settings`, `/co-online`, and `*` → `null` (the map is the home screen, no page content on `/`).
- `api.js` is a `fetch` wrapper that attaches `Authorization: Bearer <token>` automatically and throws an `Error` with `.status` on non-2xx. `socket.js` is a singleton socket.io-client with `autoConnect: false` and token in the handshake auth.
- **HUD layout** (`components/Layout.jsx`) is the app shell: a full-screen, pannable/zoomable map (`MapEngine`) with floating HUD panels (`HudPanels.jsx`), the global `WorldChat` pinned bottom-center, and pages rendered on top inside `HudOverlay.jsx` (a glass overlay shown whenever the route is not `/`).
- `styles.css` is the original light theme; `hud.css` loads after it and overrides class names to the dark HUD look. Both are imported in `main.jsx`.
- **Legacy dead code** (not imported by `App.jsx`): `components/NicknameModal.jsx`. Leave it alone or delete it.

### Duplicated logic to keep in sync

- **Reward cap** `taskRewardCap(coin) = floor(min(coin * capRatio, capAbsolute))` is defined in `server/config.js` **and** re-implemented in `client/src/pages/TasksPage.jsx` (publish-form preview). The `config.coin` values (`capRatio`, `capAbsolute`, daily caps) are the single source of truth returned to clients via `GET /api/coin/config` — keep the client copy in sync when changing them.
- `config.js`'s own comment about a client-side `levelOf` copy is now stale — `levelOf` is server-only.

## Deployment

Two paths exist and both serve `client/dist` from the backend (single origin):

- **Render**: `render.yaml` Blueprint — `buildCommand: npm run build`, `startCommand: npm start`, `healthCheckPath: /api/health`, `NODE_VERSION: 22`. Free tier has no disk, so SQLite resets on redeploy.
- **PM2 / bare Linux**: `ecosystem.config.cjs` runs `npm start` with `NODE_ENV=production` and `PORT=80`. See `DEPLOY.md` for the full student-server walkthrough.

## Reference docs

- `README.md` — user-facing feature guide, API list, and data-model table (mostly current; the auth/roles and task/friend tables have since been added).
- `TASKS.md` — full task-system spec (experience wallet, state machine, anti-abuse rules).
- `DEPLOY.md` — Aliyun student-server deployment walkthrough.
