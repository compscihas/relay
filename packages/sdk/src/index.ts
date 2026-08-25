import WebSocket from "ws";
import type { ApplicationView, AuthResult, AuthTokens, ConversationView, MessageView, RealtimeEvent, UserView } from "@relay/shared";

export interface RelayClientOptions {
  baseUrl: string;
  accessToken?: string;
  refreshToken?: string;
  onTokens?: (tokens: AuthTokens) => void | Promise<void>;
}

export class RelayError extends Error {
  constructor(public readonly status: number, message: string) { super(message); }
}

export class MultiplayerClient {
  private accessToken?: string;
  private refreshToken?: string;
  private readonly baseUrl: string;
  private readonly onTokens?: RelayClientOptions["onTokens"];

  constructor(options: RelayClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, "");
    this.accessToken = options.accessToken;
    this.refreshToken = options.refreshToken;
    this.onTokens = options.onTokens;
  }

  private async raw<T>(path: string, init: RequestInit = {}, retry = true): Promise<T> {
    const headers = new Headers(init.headers);
    headers.set("content-type", "application/json");
    if (this.accessToken) headers.set("authorization", `Bearer ${this.accessToken}`);
    const response = await fetch(`${this.baseUrl}${path}`, { ...init, headers });
    if (response.status === 401 && retry && this.refreshToken && path !== "/auth/refresh") {
      await this.refresh();
      return this.raw<T>(path, init, false);
    }
    if (!response.ok) {
      const payload = await response.json().catch(() => ({})) as { message?: string };
      throw new RelayError(response.status, payload.message ?? `${response.status} ${response.statusText}`);
    }
    if (response.status === 204) return undefined as T;
    return response.json() as Promise<T>;
  }

  private post<T>(path: string, body: unknown) { return this.raw<T>(path, { method: "POST", body: JSON.stringify(body) }); }
  private async remember(tokens: AuthTokens) {
    this.accessToken = tokens.accessToken;
    this.refreshToken = tokens.refreshToken;
    await this.onTokens?.(tokens);
  }

  async signup(input: { username: string; displayName: string; email: string; password: string }) {
    const result = await this.post<AuthResult>("/auth/register", input);
    await this.remember(result);
    return result;
  }

  async login(email: string, password: string) {
    const result = await this.post<AuthResult>("/auth/login", { email, password });
    await this.remember(result);
    return result;
  }

  async refresh() {
    if (!this.refreshToken) throw new RelayError(401, "No refresh token available");
    const result = await this.post<AuthTokens>("/auth/refresh", { refreshToken: this.refreshToken });
    await this.remember(result);
    return result;
  }

  async logout() {
    if (this.refreshToken) await this.post<void>("/auth/logout", { refreshToken: this.refreshToken });
    this.accessToken = undefined;
    this.refreshToken = undefined;
  }

  me = () => this.raw<UserView>("/users/me");
  user = (username: string) => this.raw<UserView>(`/users/${encodeURIComponent(username.replace(/^@/, ""))}`);
  createApp = (name: string, slug?: string) => this.post<ApplicationView>("/apps", { name, slug });
  apps = () => this.raw<ApplicationView[]>("/apps");
  members = (appId: string) => this.raw<Array<{ user: UserView; role: string; joinedAt: string }>>(`/apps/${appId}/members`);
  invite = (appId: string, username: string) => this.post<{ id: string }>(`/apps/${appId}/invitations`, { username });
  invitations = () => this.raw<Array<{ id: string; application: ApplicationView; createdAt: string }>>("/invitations");
  acceptInvitation = (id: string) => this.post<{ applicationId: string }>(`/invitations/${id}/accept`, {});
  conversations = (appId: string) => this.raw<ConversationView[]>(`/apps/${appId}/conversations`);
  direct = (appId: string, username: string) => this.post<ConversationView>(`/apps/${appId}/conversations/direct`, { username });
  createGroup = (appId: string, name: string, usernames: string[]) => this.post<ConversationView>(`/apps/${appId}/conversations/group`, { name, usernames });
  messages = (conversationId: string, limit = 100) => this.raw<MessageView[]>(`/conversations/${conversationId}/messages?limit=${limit}`);
  sendMessage = (conversationId: string, body: string) => this.post<MessageView>(`/conversations/${conversationId}/messages`, { body });

  realtime(onEvent: (event: RealtimeEvent) => void): WebSocket {
    if (!this.accessToken) throw new RelayError(401, "Login is required");
    const url = new URL(this.baseUrl);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    url.pathname = `${url.pathname.replace(/\/$/, "")}/realtime`;
    url.searchParams.set("token", this.accessToken);
    const socket = new WebSocket(url);
    socket.on("message", (data) => onEvent(JSON.parse(data.toString()) as RealtimeEvent));
    return socket;
  }
}

export * from "@relay/shared";

