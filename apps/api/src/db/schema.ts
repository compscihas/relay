import { relations, sql } from "drizzle-orm";
import {
  index,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export const membershipRole = pgEnum("membership_role", ["owner", "member"]);
export const conversationType = pgEnum("conversation_type", ["direct", "group"]);
export const invitationStatus = pgEnum("invitation_status", ["pending", "accepted", "revoked"]);

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
};

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  username: text("username").notNull(),
  displayName: text("display_name").notNull(),
  email: text("email").notNull(),
  passwordHash: text("password_hash").notNull(),
  ...timestamps,
}, (t) => [uniqueIndex("users_username_unique").on(sql`lower(${t.username})`), uniqueIndex("users_email_unique").on(sql`lower(${t.email})`)]);

export const applications = pgTable("applications", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  slug: text("slug").notNull(),
  ownerId: uuid("owner_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  ...timestamps,
}, (t) => [uniqueIndex("applications_slug_unique").on(t.slug)]);

export const memberships = pgTable("memberships", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  applicationId: uuid("application_id").notNull().references(() => applications.id, { onDelete: "cascade" }),
  role: membershipRole("role").notNull().default("member"),
  joinedAt: timestamp("joined_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("memberships_user_app_unique").on(t.userId, t.applicationId), index("memberships_app_idx").on(t.applicationId)]);

export const invitations = pgTable("invitations", {
  id: uuid("id").primaryKey().defaultRandom(),
  applicationId: uuid("application_id").notNull().references(() => applications.id, { onDelete: "cascade" }),
  inviterId: uuid("inviter_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  inviteeId: uuid("invitee_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  status: invitationStatus("status").notNull().default("pending"),
  ...timestamps,
}, (t) => [uniqueIndex("invitations_pending_unique").on(t.applicationId, t.inviteeId).where(sql`${t.status} = 'pending'`)]);

export const conversations = pgTable("conversations", {
  id: uuid("id").primaryKey().defaultRandom(),
  applicationId: uuid("application_id").notNull().references(() => applications.id, { onDelete: "cascade" }),
  type: conversationType("type").notNull(),
  name: text("name"),
  directKey: text("direct_key"),
  ...timestamps,
}, (t) => [uniqueIndex("conversations_direct_unique").on(t.applicationId, t.directKey).where(sql`${t.directKey} is not null`), index("conversations_app_idx").on(t.applicationId)]);

export const conversationMembers = pgTable("conversation_members", {
  conversationId: uuid("conversation_id").notNull().references(() => conversations.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  joinedAt: timestamp("joined_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.conversationId, t.userId] }), index("conversation_members_user_idx").on(t.userId)]);

export const messages = pgTable("messages", {
  id: uuid("id").primaryKey().defaultRandom(),
  conversationId: uuid("conversation_id").notNull().references(() => conversations.id, { onDelete: "cascade" }),
  senderId: uuid("sender_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  body: text("body").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  editedAt: timestamp("edited_at", { withTimezone: true }),
}, (t) => [index("messages_conversation_created_idx").on(t.conversationId, t.createdAt)]);

export const refreshSessions = pgTable("refresh_sessions", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("refresh_sessions_token_unique").on(t.tokenHash), index("refresh_sessions_user_idx").on(t.userId)]);

export const userRelations = relations(users, ({ many }) => ({ memberships: many(memberships), messages: many(messages) }));
export const applicationRelations = relations(applications, ({ one, many }) => ({ owner: one(users, { fields: [applications.ownerId], references: [users.id] }), memberships: many(memberships), conversations: many(conversations) }));
export const conversationRelations = relations(conversations, ({ one, many }) => ({ application: one(applications, { fields: [conversations.applicationId], references: [applications.id] }), members: many(conversationMembers), messages: many(messages) }));

