import type {
  MultiplayerClientContract,
  RealtimeConnection,
  RelayClientOptions,
} from "@relay/sdk";
import { RelayError } from "@relay/sdk";
import {
  normalizeUsername,
  type ApplicationView,
  type AuthResult,
  type AuthTokens,
  type ConversationType,
  type ConversationView,
  type MessageView,
  type RealtimeEvent,
  type Role,
  type UserView,
} from "@relay/shared";

interface MockUser extends UserView { email: string; password: string }
interface MockApplication { id: string; name: string; slug: string; ownerId: string; createdAt: string }
interface MockMembership { userId: string; applicationId: string; role: Role; joinedAt: string }
interface MockInvitation { id: string; applicationId: string; inviterId: string; inviteeId: string; status: "pending" | "accepted"; createdAt: string }
interface MockConversation { id: string; applicationId: string; type: ConversationType; name: string | null; directKey?: string; createdAt: string }

interface MockState {
  users: MockUser[];
  applications: MockApplication[];
  memberships: MockMembership[];
  invitations: MockInvitation[];
  conversations: MockConversation[];
  conversationMembers: Array<{ conversationId: string; userId: string; joinedAt: string }>;
  messages: MessageView[];
  accessTokens: Map<string, string>;
  refreshTokens: Map<string, string>;
  listeners: Map<string, Set<(event: RealtimeEvent) => void>>;
}

export interface MockRelayClientOptions extends Pick<RelayClientOptions, "accessToken" | "refreshToken" | "onTokens"> {}

function id() { return crypto.randomUUID(); }
function now() { return new Date().toISOString(); }
function publicUser(user: MockUser, includeEmail = false): UserView {
  const { password: _password, email, ...view } = user;
  return includeEmail ? { ...view, email } : view;
}

class MockConnection implements RealtimeConnection {
  private errorListeners = new Set<(error: Error) => void>();
  private closed = false;

  constructor(private readonly closeHandler: () => void) {}

  close() {
    if (this.closed) return;
    this.closed = true;
    this.closeHandler();
  }

  on(event: "error", listener: (error: Error) => void): this {
    if (event === "error") this.errorListeners.add(listener);
    return this;
  }
}

/**
 * In-memory stand-in for a hosted Relay deployment.
 * Data is process-local, passwords are not securely persisted, and nothing here
 * should be used for production or security testing.
 */
export class MockRelayBackend {
  readonly state: MockState = {
    users: [], applications: [], memberships: [], invitations: [], conversations: [],
    conversationMembers: [], messages: [], accessTokens: new Map(), refreshTokens: new Map(), listeners: new Map(),
  };

  createClient(options: MockRelayClientOptions = {}): MockMultiplayerClient {
    return new MockMultiplayerClient(this, options);
  }

  reset() {
    this.state.users.length = 0;
    this.state.applications.length = 0;
    this.state.memberships.length = 0;
    this.state.invitations.length = 0;
    this.state.conversations.length = 0;
    this.state.conversationMembers.length = 0;
    this.state.messages.length = 0;
    this.state.accessTokens.clear();
    this.state.refreshTokens.clear();
    this.state.listeners.clear();
  }
}

export class MockMultiplayerClient implements MultiplayerClientContract {
  private accessToken?: string;
  private refreshToken?: string;
  private readonly onTokens?: MockRelayClientOptions["onTokens"];

  constructor(private readonly backend: MockRelayBackend, options: MockRelayClientOptions = {}) {
    this.accessToken = options.accessToken;
    this.refreshToken = options.refreshToken;
    this.onTokens = options.onTokens;
  }

  private fail(status: number, message: string): never { throw new RelayError(status, message); }
  private currentUser(): MockUser {
    const userId = this.accessToken && this.backend.state.accessTokens.get(this.accessToken);
    const user = this.backend.state.users.find((candidate) => candidate.id === userId);
    return user ?? this.fail(401, "A valid access token is required");
  }
  private membership(userId: string, applicationId: string) {
    return this.backend.state.memberships.find((item) => item.userId === userId && item.applicationId === applicationId);
  }
  private requireMembership(userId: string, applicationId: string) {
    return this.membership(userId, applicationId) ?? this.fail(403, "You are not a member of this application");
  }
  private requireConversation(userId: string, conversationId: string) {
    const member = this.backend.state.conversationMembers.some((item) => item.userId === userId && item.conversationId === conversationId);
    if (!member) this.fail(403, "You are not a member of this conversation");
    return this.backend.state.conversations.find((item) => item.id === conversationId) ?? this.fail(404, "Conversation not found");
  }
  private appView(application: MockApplication, role: Role): ApplicationView {
    return { ...application, role };
  }
  private conversationView(conversation: MockConversation): ConversationView {
    const memberIds = this.backend.state.conversationMembers.filter((item) => item.conversationId === conversation.id).map((item) => item.userId);
    return {
      ...conversation,
      members: this.backend.state.users.filter((user) => memberIds.includes(user.id)).map((user) => publicUser(user)),
    };
  }
  private async issueTokens(userId: string): Promise<AuthTokens> {
    const tokens = { accessToken: `mock_access_${id()}`, refreshToken: `mock_refresh_${id()}` };
    this.backend.state.accessTokens.set(tokens.accessToken, userId);
    this.backend.state.refreshTokens.set(tokens.refreshToken, userId);
    this.accessToken = tokens.accessToken;
    this.refreshToken = tokens.refreshToken;
    await this.onTokens?.(tokens);
    return tokens;
  }

  async signup(input: { username: string; displayName: string; email: string; password: string }): Promise<AuthResult> {
    const username = normalizeUsername(input.username);
    const email = input.email.trim().toLowerCase();
    if (!/^[a-z0-9_]{2,32}$/.test(username)) this.fail(400, "Username must contain 2-32 letters, numbers, or underscores");
    if (!email.includes("@")) this.fail(400, "A valid email is required");
    if (input.password.length < 8) this.fail(400, "Password must be at least 8 characters");
    if (this.backend.state.users.some((user) => user.username === username || user.email === email)) this.fail(409, "Email or username is already registered");
    const user: MockUser = { id: id(), username, displayName: input.displayName.trim(), email, password: input.password, createdAt: now() };
    this.backend.state.users.push(user);
    return { user: publicUser(user, true), ...(await this.issueTokens(user.id)) };
  }

  async login(email: string, password: string): Promise<AuthResult> {
    const user = this.backend.state.users.find((candidate) => candidate.email === email.trim().toLowerCase() && candidate.password === password);
    if (!user) this.fail(401, "Invalid email or password");
    return { user: publicUser(user, true), ...(await this.issueTokens(user.id)) };
  }

  async refresh(): Promise<AuthTokens> {
    const userId = this.refreshToken && this.backend.state.refreshTokens.get(this.refreshToken);
    if (!userId || !this.refreshToken) this.fail(401, "Refresh token is invalid or expired");
    this.backend.state.refreshTokens.delete(this.refreshToken);
    if (this.accessToken) this.backend.state.accessTokens.delete(this.accessToken);
    return this.issueTokens(userId);
  }

  async logout(): Promise<void> {
    if (this.accessToken) this.backend.state.accessTokens.delete(this.accessToken);
    if (this.refreshToken) this.backend.state.refreshTokens.delete(this.refreshToken);
    this.accessToken = undefined;
    this.refreshToken = undefined;
  }

  async me() { return publicUser(this.currentUser(), true); }
  async user(username: string) {
    this.currentUser();
    const found = this.backend.state.users.find((candidate) => candidate.username === normalizeUsername(username));
    return found ? publicUser(found) : this.fail(404, "User not found");
  }

  async createApp(name: string, requestedSlug?: string): Promise<ApplicationView> {
    const owner = this.currentUser();
    const slug = (requestedSlug ?? name).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
    if (!slug) this.fail(400, "Application slug is empty");
    if (this.backend.state.applications.some((application) => application.slug === slug)) this.fail(409, "Application slug is already in use");
    const createdAt = now();
    const application: MockApplication = { id: id(), name: name.trim(), slug, ownerId: owner.id, createdAt };
    const conversation: MockConversation = { id: id(), applicationId: application.id, type: "group", name: "general", createdAt };
    this.backend.state.applications.push(application);
    this.backend.state.memberships.push({ userId: owner.id, applicationId: application.id, role: "owner", joinedAt: createdAt });
    this.backend.state.conversations.push(conversation);
    this.backend.state.conversationMembers.push({ conversationId: conversation.id, userId: owner.id, joinedAt: createdAt });
    return this.appView(application, "owner");
  }

  async apps(): Promise<ApplicationView[]> {
    const user = this.currentUser();
    return this.backend.state.memberships.filter((item) => item.userId === user.id).map((item) => {
      const application = this.backend.state.applications.find((candidate) => candidate.id === item.applicationId)!;
      return this.appView(application, item.role);
    });
  }

  async members(appId: string) {
    const user = this.currentUser();
    this.requireMembership(user.id, appId);
    return this.backend.state.memberships.filter((item) => item.applicationId === appId).map((item) => ({
      user: publicUser(this.backend.state.users.find((candidate) => candidate.id === item.userId)!),
      role: item.role,
      joinedAt: item.joinedAt,
    }));
  }

  async invite(appId: string, username: string): Promise<{ id: string }> {
    const inviter = this.currentUser();
    if (this.requireMembership(inviter.id, appId).role !== "owner") this.fail(403, "Only the application owner can invite members");
    const invitee = this.backend.state.users.find((user) => user.username === normalizeUsername(username));
    if (!invitee) this.fail(404, "User not found");
    if (this.membership(invitee.id, appId)) this.fail(409, "User is already a member");
    if (this.backend.state.invitations.some((item) => item.applicationId === appId && item.inviteeId === invitee.id && item.status === "pending")) this.fail(409, "A pending invitation already exists");
    const invitation: MockInvitation = { id: id(), applicationId: appId, inviterId: inviter.id, inviteeId: invitee.id, status: "pending", createdAt: now() };
    this.backend.state.invitations.push(invitation);
    return { id: invitation.id };
  }

  async invitations() {
    const user = this.currentUser();
    return this.backend.state.invitations.filter((item) => item.inviteeId === user.id && item.status === "pending").map((item) => {
      const application = this.backend.state.applications.find((candidate) => candidate.id === item.applicationId)!;
      return { id: item.id, application: this.appView(application, "member"), createdAt: item.createdAt };
    });
  }

  async acceptInvitation(invitationId: string) {
    const user = this.currentUser();
    const invitation = this.backend.state.invitations.find((item) => item.id === invitationId && item.inviteeId === user.id && item.status === "pending");
    if (!invitation) this.fail(404, "Pending invitation not found");
    const joinedAt = now();
    this.backend.state.memberships.push({ userId: user.id, applicationId: invitation.applicationId, role: "member", joinedAt });
    invitation.status = "accepted";
    for (const conversation of this.backend.state.conversations.filter((item) => item.applicationId === invitation.applicationId && item.type === "group")) {
      this.backend.state.conversationMembers.push({ conversationId: conversation.id, userId: user.id, joinedAt });
    }
    return { applicationId: invitation.applicationId };
  }

  async conversations(appId: string): Promise<ConversationView[]> {
    const user = this.currentUser();
    this.requireMembership(user.id, appId);
    const roomIds = this.backend.state.conversationMembers.filter((item) => item.userId === user.id).map((item) => item.conversationId);
    return this.backend.state.conversations.filter((item) => item.applicationId === appId && roomIds.includes(item.id)).map((item) => this.conversationView(item));
  }

  async direct(appId: string, username: string): Promise<ConversationView> {
    const user = this.currentUser();
    this.requireMembership(user.id, appId);
    const other = this.backend.state.users.find((candidate) => candidate.username === normalizeUsername(username));
    if (!other || !this.membership(other.id, appId)) this.fail(404, "User is not a member of this application");
    if (other.id === user.id) this.fail(400, "Cannot create a direct conversation with yourself");
    const directKey = [user.id, other.id].sort().join(":");
    let conversation = this.backend.state.conversations.find((item) => item.applicationId === appId && item.directKey === directKey);
    if (!conversation) {
      conversation = { id: id(), applicationId: appId, type: "direct", name: null, directKey, createdAt: now() };
      this.backend.state.conversations.push(conversation);
      this.backend.state.conversationMembers.push(
        { conversationId: conversation.id, userId: user.id, joinedAt: now() },
        { conversationId: conversation.id, userId: other.id, joinedAt: now() },
      );
    }
    return this.conversationView(conversation);
  }

  async createGroup(appId: string, name: string, usernames: string[]): Promise<ConversationView> {
    const user = this.currentUser();
    this.requireMembership(user.id, appId);
    const requested = [...new Set(usernames.map(normalizeUsername))];
    const others = requested.map((username) => this.backend.state.users.find((candidate) => candidate.username === username) ?? this.fail(404, `@${username} was not found`));
    for (const other of others) if (!this.membership(other.id, appId)) this.fail(403, `@${other.username} is not an application member`);
    const conversation: MockConversation = { id: id(), applicationId: appId, type: "group", name: name.trim(), createdAt: now() };
    this.backend.state.conversations.push(conversation);
    for (const userId of new Set([user.id, ...others.map((other) => other.id)])) this.backend.state.conversationMembers.push({ conversationId: conversation.id, userId, joinedAt: now() });
    return this.conversationView(conversation);
  }

  async messages(conversationId: string, limit = 100): Promise<MessageView[]> {
    const user = this.currentUser();
    this.requireConversation(user.id, conversationId);
    return this.backend.state.messages.filter((message) => message.conversationId === conversationId).slice(-limit);
  }

  async sendMessage(conversationId: string, body: string): Promise<MessageView> {
    const user = this.currentUser();
    this.requireConversation(user.id, conversationId);
    const text = body.trim();
    if (!text) this.fail(400, "Message body is required");
    const message: MessageView = { id: id(), conversationId, sender: publicUser(user), body: text, createdAt: now(), editedAt: null };
    this.backend.state.messages.push(message);
    const recipients = this.backend.state.conversationMembers.filter((item) => item.conversationId === conversationId).map((item) => item.userId);
    for (const userId of recipients) for (const listener of this.backend.state.listeners.get(userId) ?? []) listener({ type: "message.created", data: message });
    return message;
  }

  realtime(onEvent: (event: RealtimeEvent) => void): RealtimeConnection {
    const user = this.currentUser();
    const listeners = this.backend.state.listeners.get(user.id) ?? new Set();
    listeners.add(onEvent);
    this.backend.state.listeners.set(user.id, listeners);
    queueMicrotask(() => onEvent({ type: "ready", userId: user.id }));
    return new MockConnection(() => {
      listeners.delete(onEvent);
      if (!listeners.size) this.backend.state.listeners.delete(user.id);
    });
  }
}

export function createMockRelay(): MockRelayBackend {
  return new MockRelayBackend();
}

