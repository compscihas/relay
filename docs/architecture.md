# Phase 1 architecture decisions

## Boundaries

Relay is a TypeScript npm-workspace monorepo. The API owns persistence and authorization. The SDK owns transport. The CLI owns terminal interaction and local session state. Shared wire types contain no server behavior.

## Authorization invariants

1. The access token, never a body field, identifies the actor.
2. Application reads require a membership row.
3. Conversation reads and sends require a conversation-membership row.
4. Direct conversation peers must both belong to the same application.
5. Only an application owner may create invitations.
6. An invitation can only be accepted by its named invitee.

These checks are adjacent to their database queries in the monolith. They can later become policy functions without changing the public API.

## Realtime

Each API process maps authenticated user IDs to WebSocket connections. A persisted message is broadcast only to conversation members. This keeps the first implementation understandable. Multi-process deployment will require Redis pub/sub (or an equivalent broker) but does not require changing clients or events.

## Tokens

Access tokens are short-lived signed JWTs. Refresh tokens are random opaque values; PostgreSQL stores only SHA-256 hashes. Refreshing revokes the used token and returns a new pair. Passwords use Argon2id through the `argon2` package.

## Evolution points

- Replace the in-memory socket registry with broker-backed fan-out.
- Move CLI refresh tokens into the OS credential manager.
- Add OpenAPI generation when the external SDK surface begins to stabilize.
- Add repository identity fields and `repo init` only after the core two-user workflow is validated.
- Add application-level OAuth consent before exposing universal identity data to third-party applications.

