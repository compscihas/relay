# Relay

> **The multiplayer layer for JIT software.**

Relay is a working Phase 1 MVP for persistent identity and realtime communication across applications. Two users can create accounts, join the same application by invitation, exchange direct messages, and chat in shared group rooms from separate computers.

`Relay` is an internal codename, not a researched public product name.

## What is implemented

- Email/password registration and login with Argon2id password hashing
- Short-lived JWT access tokens and hashed, single-use rotating refresh tokens
- Users and username lookup
- Applications with `owner` and `member` roles
- Owner-issued invitations and explicit acceptance
- Direct and group conversations scoped to one application
- Plain-text messages with deterministic chronological retrieval
- Authenticated WebSockets delivering `message.created`
- A TypeScript SDK used by the CLI
- Interactive terminal chat
- PostgreSQL migrations and Docker Compose

The MVP intentionally does not include portable consent, relationship schemas, notifications, attachments, reactions, or other later-phase ideas.

## Architecture

```text
CLI (@relay/cli)
       │
       ▼
SDK (@relay/sdk) ── HTTPS / WebSocket ── Fastify API
                                              │
                                              ▼
                                          PostgreSQL
```

This is one deployable backend. Redis and microservices are not required.

## Build without a backend (mock mode)

Use `@relay/mock` while building an application's UI before a Relay server is
available. It implements the same client contract as the real SDK, but keeps
everything in memory inside the application process.

```ts
import { createMockRelay } from "@relay/mock";
import type { MultiplayerClientContract } from "@relay/sdk";

const mockBackend = createMockRelay();
export const relay: MultiplayerClientContract = mockBackend.createClient();
```

Create additional clients from the same `mockBackend` to simulate other users:

```ts
const hasan = mockBackend.createClient();
const jordan = mockBackend.createClient();

await hasan.signup({
  username: "hasan",
  displayName: "Hasan",
  email: "hasan@example.test",
  password: "password123",
});
await jordan.signup({
  username: "jordan",
  displayName: "Jordan",
  email: "jordan@example.test",
  password: "password123",
});

const app = await hasan.createApp("Pokemon Draft");
const invite = await hasan.invite(app.id, "@jordan");
await jordan.acceptInvitation(invite.id);
```

When the hosted backend is ready, keep the application's
`MultiplayerClientContract` dependency and replace only its construction:

```ts
import { MultiplayerClient } from "@relay/sdk";

export const relay: MultiplayerClientContract = new MultiplayerClient({
  baseUrl: "https://relay-api.example.com",
});
```

Mock mode is a development placeholder, not a small production server. It does
not communicate between devices, persists nothing after the process reloads,
and keeps test passwords as plain text in memory. Never use it for production
or security testing.

## Quick start with Docker

Requirements: Node.js 20+ and Docker with Compose.

```bash
cp .env.example .env
docker compose up --build
```

The API is available at `http://localhost:3000`; the container applies migrations before starting. For local development with only PostgreSQL in Docker:

```bash
npm install
docker compose up -d postgres
cp .env.example .env
npm run db:migrate
npm run dev
```

Use a random `JWT_SECRET` of at least 32 characters outside local development. Do not commit `.env`.

## CLI walkthrough

During development, run the CLI through the workspace:

```bash
npm run relay -- signup --email hasan@example.com --username hasan --name "Hasan"
npm run relay -- whoami
npm run relay -- app create "Howler"
```

On the second computer, point Relay at the reachable API and create the other account:

```bash
npm run relay -- config https://relay-api.example.com
npm run relay -- signup --email jordan@example.com --username jordan --name "Jordan"
```

Back on the owner's computer:

```bash
npm run relay -- app invite @jordan
```

On Jordan's computer:

```bash
npm run relay -- invite list
npm run relay -- invite accept <invitation-id>
npm run relay -- app current
npm run relay -- chat
```

The owner runs `npm run relay -- chat` too. Messages typed in the default `general` room appear on both computers without polling. Type `/quit` to exit.

Other useful commands:

```bash
npm run relay -- app list
npm run relay -- app use <application-id>
npm run relay -- app members
npm run relay -- user @jordan
npm run relay -- send @jordan "hello"
npm run relay -- history @jordan
npm run relay -- inbox
npm run relay -- app group planning @jordan
npm run relay -- chat --room planning
npm run relay -- logout
```

Passwords are masked when prompted. Supplying `--password` is useful for automation but may expose it in shell history.

For a global development install after building:

```bash
npm run build
npm install -g ./apps/cli
relay --help
```

## Credentials

The CLI stores its API URL, access token, refresh token, and selected application outside the repository at:

```text
~/.relay/config.json
```

It requests owner-only file permissions where supported and writes atomically. This is acceptable for the first prototype; moving tokens to the OS credential manager is a required hardening step before a public release. Override the location with `RELAY_CONFIG_PATH` for isolated testing.

## API surface

```text
POST /auth/register                 POST /auth/login
POST /auth/refresh                  POST /auth/logout
GET  /users/me                      GET  /users/:username
POST /apps                          GET  /apps
GET  /apps/:appId/members           POST /apps/:appId/invitations
GET  /invitations                   POST /invitations/:id/accept
GET  /apps/:appId/conversations
POST /apps/:appId/conversations/direct
POST /apps/:appId/conversations/group
GET  /conversations/:id/messages    POST /conversations/:id/messages
WS   /realtime?token=<access-token>
```

All application and conversation routes verify membership server-side. The authenticated token determines the message sender; a client-provided sender ID is never trusted.

## Verification

Always-runnable checks:

```bash
npm run typecheck
npm run build
npm test
npm audit --omit=dev
```

The real PostgreSQL integration suite requires an empty disposable database. Never point it at a database containing data because it truncates the `users` table with `CASCADE`:

```bash
# Create a relay_test database first, then:
TEST_DATABASE_URL=postgresql://relay:relay@localhost:5432/relay_test npm run test:integration --workspace @relay/api
```

It verifies authentication and refresh replay protection, application authorization, conversation authorization, sender spoof prevention, chronological history, invitation membership, and actual WebSocket delivery.

## Repository layout

```text
apps/api          Fastify API, Drizzle schema, migration runner, integration tests
apps/cli          Commander CLI and local credential/config handling
packages/sdk      Shared HTTP and WebSocket client
packages/mock     In-memory SDK-compatible backend placeholder
packages/shared   Wire types and small domain helpers
docs              Architecture and operating notes
```

## Current limitations

- One API process only; WebSocket fan-out is in memory.
- No rate limiting, abuse workflow, blocking, device UI, or audit log yet.
- Refresh-token storage in the CLI is a protected local file rather than an OS keychain.
- Application slugs are globally unique for the MVP.
- The repository-aware `repo init` wedge is the next milestone after the two-computer test is proven.

Do not add Redis or split services until a real scaling need appears.
