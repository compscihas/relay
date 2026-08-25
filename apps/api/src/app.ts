import Fastify from "fastify";
import cors from "@fastify/cors";
import jwt from "@fastify/jwt";
import websocket from "@fastify/websocket";
import argon2 from "argon2";
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { normalizeUsername, type RealtimeEvent } from "@relay/shared";
import type { Config } from "./config.js";
import { createDatabase } from "./db/index.js";
import {
  applications, conversationMembers, conversations, invitations, memberships,
  messages, refreshSessions, users,
} from "./db/schema.js";
import errors from "./errors.js";
import { hashToken, newRefreshToken, requireMembership, requireUser, type AccessClaims } from "./security.js";
import { messageView, userView } from "./views.js";

const credentialsSchema = z.object({ email: z.string().email().transform((v) => v.toLowerCase()), password: z.string().min(8).max(200) });
const registerSchema = credentialsSchema.extend({
  username: z.string().trim().regex(/^[a-zA-Z0-9_]{2,32}$/).transform((v) => v.toLowerCase()),
  displayName: z.string().trim().min(1).max(80),
});

export async function buildApp(config: Config) {
  const app = Fastify({ logger: { level: config.LOG_LEVEL } });
  const { db, pool } = createDatabase(config.DATABASE_URL);
  const sockets = new Map<string, Set<{ send(value: string): void; readyState: number }>>();

  await app.register(errors);
  await app.register(cors, { origin: false });
  await app.register(jwt, { secret: config.JWT_SECRET, sign: { expiresIn: config.ACCESS_TOKEN_TTL } });
  await app.register(websocket);

  const accessToken = (userId: string) => app.jwt.sign({ sub: userId, type: "access" } satisfies AccessClaims);
  const issueTokens = async (userId: string) => {
    const refreshToken = newRefreshToken();
    await db.insert(refreshSessions).values({
      userId,
      tokenHash: hashToken(refreshToken),
      expiresAt: new Date(Date.now() + config.REFRESH_TOKEN_TTL_DAYS * 86_400_000),
    });
    return { accessToken: accessToken(userId), refreshToken };
  };
  const broadcast = (userIds: string[], event: RealtimeEvent) => {
    const payload = JSON.stringify(event);
    for (const userId of userIds) for (const socket of sockets.get(userId) ?? []) if (socket.readyState === 1) socket.send(payload);
  };
  const parse = <T>(schema: z.ZodType<T>, value: unknown): T => {
    const result = schema.safeParse(value);
    if (!result.success) throw app.httpErrors.badRequest(result.error.issues.map((i) => i.message).join(", "));
    return result.data;
  };

  app.get("/health", async () => ({ status: "ok" }));

  app.post("/auth/register", async (request, reply) => {
    const input = parse(registerSchema, request.body);
    const passwordHash = await argon2.hash(input.password);
    try {
      const [user] = await db.insert(users).values({ ...input, passwordHash }).returning();
      if (!user) throw new Error("User insert failed");
      return reply.code(201).send({ user: userView(user, true), ...(await issueTokens(user.id)) });
    } catch (error) {
      if ((error as { code?: string }).code === "23505") throw app.httpErrors.conflict("Email or username is already registered");
      throw error;
    }
  });

  app.post("/auth/login", async (request) => {
    const input = parse(credentialsSchema, request.body);
    const user = await db.query.users.findFirst({ where: (u, { eq }) => eq(u.email, input.email) });
    if (!user || !(await argon2.verify(user.passwordHash, input.password))) throw app.httpErrors.unauthorized("Invalid email or password");
    return { user: userView(user, true), ...(await issueTokens(user.id)) };
  });

  app.post("/auth/refresh", async (request) => {
    const { refreshToken } = parse(z.object({ refreshToken: z.string().min(20) }), request.body);
    const session = await db.query.refreshSessions.findFirst({
      where: (s, { and, eq, gt, isNull }) => and(eq(s.tokenHash, hashToken(refreshToken)), gt(s.expiresAt, new Date()), isNull(s.revokedAt)),
    });
    if (!session) throw app.httpErrors.unauthorized("Refresh token is invalid or expired");
    await db.update(refreshSessions).set({ revokedAt: new Date() }).where(eq(refreshSessions.id, session.id));
    return issueTokens(session.userId);
  });

  app.post("/auth/logout", async (request, reply) => {
    const { refreshToken } = parse(z.object({ refreshToken: z.string().min(20) }), request.body);
    await db.update(refreshSessions).set({ revokedAt: new Date() }).where(eq(refreshSessions.tokenHash, hashToken(refreshToken)));
    return reply.code(204).send();
  });

  app.get("/users/me", async (request) => {
    const userId = await requireUser(app, request);
    const user = await db.query.users.findFirst({ where: (u, { eq }) => eq(u.id, userId) });
    if (!user) throw app.httpErrors.notFound("User not found");
    return userView(user, true);
  });

  app.get("/users/:username", async (request) => {
    await requireUser(app, request);
    const { username } = parse(z.object({ username: z.string() }), request.params);
    const user = await db.query.users.findFirst({ where: (u, { eq }) => eq(u.username, normalizeUsername(username)) });
    if (!user) throw app.httpErrors.notFound("User not found");
    return userView(user);
  });

  app.post("/apps", async (request, reply) => {
    const userId = await requireUser(app, request);
    const { name, slug: requestedSlug } = parse(z.object({ name: z.string().trim().min(1).max(100), slug: z.string().trim().optional() }), request.body);
    const slug = (requestedSlug ?? name).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
    if (!slug) throw app.httpErrors.badRequest("Application slug is empty");
    try {
      const result = await db.transaction(async (tx) => {
        const [application] = await tx.insert(applications).values({ name, slug, ownerId: userId }).returning();
        if (!application) throw new Error("Application insert failed");
        await tx.insert(memberships).values({ userId, applicationId: application.id, role: "owner" });
        const [conversation] = await tx.insert(conversations).values({ applicationId: application.id, type: "group", name: "general" }).returning();
        if (conversation) await tx.insert(conversationMembers).values({ conversationId: conversation.id, userId });
        return application;
      });
      return reply.code(201).send({ ...result, role: "owner", createdAt: result.createdAt.toISOString(), updatedAt: result.updatedAt.toISOString() });
    } catch (error) {
      if ((error as { code?: string }).code === "23505") throw app.httpErrors.conflict("Application slug is already in use");
      throw error;
    }
  });

  app.get("/apps", async (request) => {
    const userId = await requireUser(app, request);
    const rows = await db.select({ application: applications, role: memberships.role }).from(memberships).innerJoin(applications, eq(memberships.applicationId, applications.id)).where(eq(memberships.userId, userId)).orderBy(asc(applications.name));
    return rows.map(({ application, role }) => ({ ...application, role, createdAt: application.createdAt.toISOString(), updatedAt: application.updatedAt.toISOString() }));
  });

  app.get("/apps/:appId/members", async (request) => {
    const userId = await requireUser(app, request);
    const { appId } = parse(z.object({ appId: z.string().uuid() }), request.params);
    if (!(await requireMembership(db, userId, appId))) throw app.httpErrors.forbidden("You are not a member of this application");
    const rows = await db.select({ user: users, role: memberships.role, joinedAt: memberships.joinedAt }).from(memberships).innerJoin(users, eq(memberships.userId, users.id)).where(eq(memberships.applicationId, appId)).orderBy(asc(users.username));
    return rows.map((row) => ({ user: userView(row.user), role: row.role, joinedAt: row.joinedAt.toISOString() }));
  });

  app.post("/apps/:appId/invitations", async (request, reply) => {
    const userId = await requireUser(app, request);
    const { appId } = parse(z.object({ appId: z.string().uuid() }), request.params);
    const { username } = parse(z.object({ username: z.string() }), request.body);
    const membership = await requireMembership(db, userId, appId);
    if (membership?.role !== "owner") throw app.httpErrors.forbidden("Only the application owner can invite members");
    const invitee = await db.query.users.findFirst({ where: (u, { eq }) => eq(u.username, normalizeUsername(username)) });
    if (!invitee) throw app.httpErrors.notFound("User not found");
    if (await requireMembership(db, invitee.id, appId)) throw app.httpErrors.conflict("User is already a member");
    try {
      const [invitation] = await db.insert(invitations).values({ applicationId: appId, inviterId: userId, inviteeId: invitee.id }).returning();
      return reply.code(201).send(invitation);
    } catch (error) {
      if ((error as { code?: string }).code === "23505") throw app.httpErrors.conflict("A pending invitation already exists");
      throw error;
    }
  });

  app.get("/invitations", async (request) => {
    const userId = await requireUser(app, request);
    return db.select({ id: invitations.id, application: applications, status: invitations.status, createdAt: invitations.createdAt }).from(invitations).innerJoin(applications, eq(invitations.applicationId, applications.id)).where(and(eq(invitations.inviteeId, userId), eq(invitations.status, "pending"))).orderBy(desc(invitations.createdAt));
  });

  app.post("/invitations/:invitationId/accept", async (request) => {
    const userId = await requireUser(app, request);
    const { invitationId } = parse(z.object({ invitationId: z.string().uuid() }), request.params);
    return db.transaction(async (tx) => {
      const invitation = await tx.query.invitations.findFirst({ where: (i, { and, eq }) => and(eq(i.id, invitationId), eq(i.inviteeId, userId), eq(i.status, "pending")) });
      if (!invitation) throw app.httpErrors.notFound("Pending invitation not found");
      await tx.insert(memberships).values({ userId, applicationId: invitation.applicationId, role: "member" });
      await tx.update(invitations).set({ status: "accepted" }).where(eq(invitations.id, invitation.id));
      const groupRooms = await tx.select({ id: conversations.id }).from(conversations).where(and(eq(conversations.applicationId, invitation.applicationId), eq(conversations.type, "group")));
      if (groupRooms.length) await tx.insert(conversationMembers).values(groupRooms.map((room) => ({ conversationId: room.id, userId }))).onConflictDoNothing();
      return { applicationId: invitation.applicationId };
    });
  });

  app.get("/apps/:appId/conversations", async (request) => {
    const userId = await requireUser(app, request);
    const { appId } = parse(z.object({ appId: z.string().uuid() }), request.params);
    if (!(await requireMembership(db, userId, appId))) throw app.httpErrors.forbidden("You are not a member of this application");
    const rooms = await db.select({ conversation: conversations }).from(conversationMembers).innerJoin(conversations, eq(conversationMembers.conversationId, conversations.id)).where(and(eq(conversationMembers.userId, userId), eq(conversations.applicationId, appId))).orderBy(asc(conversations.createdAt));
    return Promise.all(rooms.map(async ({ conversation }) => {
      const memberRows = await db.select({ user: users }).from(conversationMembers).innerJoin(users, eq(conversationMembers.userId, users.id)).where(eq(conversationMembers.conversationId, conversation.id));
      return { ...conversation, members: memberRows.map((r) => userView(r.user)), createdAt: conversation.createdAt.toISOString(), updatedAt: conversation.updatedAt.toISOString() };
    }));
  });

  app.post("/apps/:appId/conversations/direct", async (request, reply) => {
    const userId = await requireUser(app, request);
    const { appId } = parse(z.object({ appId: z.string().uuid() }), request.params);
    const { username } = parse(z.object({ username: z.string() }), request.body);
    if (!(await requireMembership(db, userId, appId))) throw app.httpErrors.forbidden("You are not a member of this application");
    const other = await db.query.users.findFirst({ where: (u, { eq }) => eq(u.username, normalizeUsername(username)) });
    if (!other || !(await requireMembership(db, other.id, appId))) throw app.httpErrors.notFound("User is not a member of this application");
    if (other.id === userId) throw app.httpErrors.badRequest("Cannot create a direct conversation with yourself");
    const directKey = [userId, other.id].sort().join(":");
    let conversation = await db.query.conversations.findFirst({ where: (c, { and, eq }) => and(eq(c.applicationId, appId), eq(c.directKey, directKey)) });
    if (!conversation) {
      conversation = await db.transaction(async (tx) => {
        const [created] = await tx.insert(conversations).values({ applicationId: appId, type: "direct", directKey }).onConflictDoNothing().returning();
        const room = created ?? await tx.query.conversations.findFirst({ where: (c, { and, eq }) => and(eq(c.applicationId, appId), eq(c.directKey, directKey)) });
        if (!room) throw new Error("Direct conversation creation failed");
        await tx.insert(conversationMembers).values([{ conversationId: room.id, userId }, { conversationId: room.id, userId: other.id }]).onConflictDoNothing();
        return room;
      });
    }
    return reply.code(201).send(conversation);
  });

  app.post("/apps/:appId/conversations/group", async (request, reply) => {
    const userId = await requireUser(app, request);
    const { appId } = parse(z.object({ appId: z.string().uuid() }), request.params);
    const input = parse(z.object({ name: z.string().trim().min(1).max(80), usernames: z.array(z.string()).default([]) }), request.body);
    if (!(await requireMembership(db, userId, appId))) throw app.httpErrors.forbidden("You are not a member of this application");
    const normalized = [...new Set(input.usernames.map(normalizeUsername))];
    const memberUsers = normalized.length ? await db.select().from(users).where(inArray(users.username, normalized)) : [];
    if (memberUsers.length !== normalized.length) throw app.httpErrors.notFound("One or more users were not found");
    for (const member of memberUsers) if (!(await requireMembership(db, member.id, appId))) throw app.httpErrors.forbidden(`@${member.username} is not an application member`);
    const conversation = await db.transaction(async (tx) => {
      const [room] = await tx.insert(conversations).values({ applicationId: appId, type: "group", name: input.name }).returning();
      if (!room) throw new Error("Group conversation insert failed");
      const ids = [...new Set([userId, ...memberUsers.map((u) => u.id)])];
      await tx.insert(conversationMembers).values(ids.map((id) => ({ conversationId: room.id, userId: id })));
      return room;
    });
    return reply.code(201).send(conversation);
  });

  async function assertConversationMember(userId: string, conversationId: string) {
    const row = await db.select({ conversation: conversations }).from(conversationMembers).innerJoin(conversations, eq(conversationMembers.conversationId, conversations.id)).where(and(eq(conversationMembers.userId, userId), eq(conversationMembers.conversationId, conversationId))).limit(1);
    if (!row[0]) throw app.httpErrors.forbidden("You are not a member of this conversation");
    return row[0].conversation;
  }

  app.get("/conversations/:conversationId/messages", async (request) => {
    const userId = await requireUser(app, request);
    const { conversationId } = parse(z.object({ conversationId: z.string().uuid() }), request.params);
    const { limit } = parse(z.object({ limit: z.coerce.number().int().min(1).max(200).default(100) }), request.query);
    await assertConversationMember(userId, conversationId);
    const rows = await db.select({ id: messages.id, conversationId: messages.conversationId, body: messages.body, createdAt: messages.createdAt, editedAt: messages.editedAt, sender: users }).from(messages).innerJoin(users, eq(messages.senderId, users.id)).where(eq(messages.conversationId, conversationId)).orderBy(asc(messages.createdAt), asc(messages.id)).limit(limit);
    return rows.map(messageView);
  });

  app.post("/conversations/:conversationId/messages", async (request, reply) => {
    const userId = await requireUser(app, request);
    const { conversationId } = parse(z.object({ conversationId: z.string().uuid() }), request.params);
    const { body } = parse(z.object({ body: z.string().trim().min(1).max(10_000) }), request.body);
    await assertConversationMember(userId, conversationId);
    const [inserted] = await db.insert(messages).values({ conversationId, senderId: userId, body }).returning();
    if (!inserted) throw new Error("Message insert failed");
    const sender = await db.query.users.findFirst({ where: (u, { eq }) => eq(u.id, userId) });
    if (!sender) throw new Error("Sender not found");
    const result = messageView({ ...inserted, sender });
    const recipients = await db.select({ userId: conversationMembers.userId }).from(conversationMembers).where(eq(conversationMembers.conversationId, conversationId));
    broadcast(recipients.map((r) => r.userId), { type: "message.created", data: result });
    return reply.code(201).send(result);
  });

  app.get("/realtime", { websocket: true }, (socket, request) => {
    const query = request.query as { token?: string };
    try {
      const claims = app.jwt.verify<AccessClaims>(query.token ?? "");
      if (claims.type !== "access") throw new Error("Invalid token");
      const set = sockets.get(claims.sub) ?? new Set();
      set.add(socket);
      sockets.set(claims.sub, set);
      socket.send(JSON.stringify({ type: "ready", userId: claims.sub } satisfies RealtimeEvent));
      socket.on("close", () => {
        set.delete(socket);
        if (!set.size) sockets.delete(claims.sub);
      });
    } catch {
      socket.close(1008, "Unauthorized");
    }
  });

  app.addHook("onClose", async () => { await pool.end(); });
  return app;
}

