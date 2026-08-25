import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { fileURLToPath } from "node:url";
import { WebSocket } from "ws";
import { buildApp } from "./app.js";
import { createDatabase } from "./db/index.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
const suite = databaseUrl ? describe : describe.skip;

suite("Phase 1 API against PostgreSQL", () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  const password = "correct horse battery staple";

  async function register(username: string) {
    const response = await app.inject({ method: "POST", url: "/auth/register", payload: { username, displayName: username, email: `${username}@example.test`, password } });
    expect(response.statusCode).toBe(201);
    return response.json<{ user: { id: string; username: string }; accessToken: string; refreshToken: string }>();
  }
  const auth = (token: string) => ({ authorization: `Bearer ${token}` });

  beforeAll(async () => {
    const database = createDatabase(databaseUrl!);
    await migrate(database.db, { migrationsFolder: fileURLToPath(new URL("../drizzle", import.meta.url)) });
    await database.pool.query("TRUNCATE users CASCADE");
    await database.pool.end();
    app = await buildApp({ DATABASE_URL: databaseUrl!, JWT_SECRET: "integration-test-secret-at-least-32-characters", HOST: "127.0.0.1", PORT: 3000, ACCESS_TOKEN_TTL: "15m", REFRESH_TOKEN_TTL_DAYS: 30, LOG_LEVEL: "silent" });
  });
  afterAll(async () => { await app?.close(); });

  it("registers, logs in, and rotates refresh tokens", async () => {
    const account = await register("auth_user");
    const login = await app.inject({ method: "POST", url: "/auth/login", payload: { email: "auth_user@example.test", password } });
    expect(login.statusCode).toBe(200);
    const refresh = await app.inject({ method: "POST", url: "/auth/refresh", payload: { refreshToken: account.refreshToken } });
    expect(refresh.statusCode).toBe(200);
    const replay = await app.inject({ method: "POST", url: "/auth/refresh", payload: { refreshToken: account.refreshToken } });
    expect(replay.statusCode).toBe(401);
  });

  it("enforces app and conversation membership while preserving ordered history", async () => {
    const owner = await register("owner");
    const member = await register("member");
    const outsider = await register("outsider");
    const createApp = await app.inject({ method: "POST", url: "/apps", headers: auth(owner.accessToken), payload: { name: "Test Workspace", slug: "test-workspace" } });
    expect(createApp.statusCode).toBe(201);
    const applicationId = createApp.json<{ id: string }>().id;

    const invite = await app.inject({ method: "POST", url: `/apps/${applicationId}/invitations`, headers: auth(owner.accessToken), payload: { username: "@member" } });
    expect(invite.statusCode).toBe(201);
    const invitationId = invite.json<{ id: string }>().id;
    expect((await app.inject({ method: "POST", url: `/invitations/${invitationId}/accept`, headers: auth(member.accessToken), payload: {} })).statusCode).toBe(200);

    const ownerRooms = await app.inject({ method: "GET", url: `/apps/${applicationId}/conversations`, headers: auth(owner.accessToken) });
    const roomId = ownerRooms.json<Array<{ id: string; name: string }>>().find((room) => room.name === "general")!.id;
    expect((await app.inject({ method: "GET", url: `/apps/${applicationId}/conversations`, headers: auth(outsider.accessToken) })).statusCode).toBe(403);
    expect((await app.inject({ method: "GET", url: `/conversations/${roomId}/messages`, headers: auth(outsider.accessToken) })).statusCode).toBe(403);

    for (const body of ["first", "second"]) {
      const sent = await app.inject({ method: "POST", url: `/conversations/${roomId}/messages`, headers: auth(owner.accessToken), payload: { body, senderId: outsider.user.id } });
      expect(sent.statusCode).toBe(201);
      expect(sent.json<{ sender: { id: string } }>().sender.id).toBe(owner.user.id);
    }
    const history = await app.inject({ method: "GET", url: `/conversations/${roomId}/messages`, headers: auth(member.accessToken) });
    expect(history.json<Array<{ body: string }>>().map((message) => message.body)).toEqual(["first", "second"]);
  });

  it("delivers message.created over WebSocket", async () => {
    const owner = await register("realtime_owner");
    const created = await app.inject({ method: "POST", url: "/apps", headers: auth(owner.accessToken), payload: { name: "Realtime", slug: "realtime" } });
    const applicationId = created.json<{ id: string }>().id;
    const rooms = await app.inject({ method: "GET", url: `/apps/${applicationId}/conversations`, headers: auth(owner.accessToken) });
    const roomId = rooms.json<Array<{ id: string }>>()[0]!.id;
    await app.listen({ host: "127.0.0.1", port: 0 });
    const address = app.server.address();
    if (!address || typeof address === "string") throw new Error("Test server did not bind TCP");
    const socket = new WebSocket(`ws://127.0.0.1:${address.port}/realtime?token=${encodeURIComponent(owner.accessToken)}`);
    await new Promise<void>((resolve, reject) => { socket.once("open", resolve); socket.once("error", reject); });
    const received = new Promise<{ type: string; data?: { body: string } }>((resolve) => {
      socket.on("message", (raw) => { const event = JSON.parse(raw.toString()); if (event.type === "message.created") resolve(event); });
    });
    await app.inject({ method: "POST", url: `/conversations/${roomId}/messages`, headers: auth(owner.accessToken), payload: { body: "live" } });
    await expect(received).resolves.toMatchObject({ type: "message.created", data: { body: "live" } });
    socket.close();
  });
});

