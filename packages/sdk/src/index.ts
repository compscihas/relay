import type { ApplicationView, AuthResult, AuthTokens, ConversationView, MessageView, RealtimeEvent, UserView } from "@relay/shared";

export interface RelaySocket {
  close(code?: number, reason?: string): void;
  onMessage(listener: (data: unknown) => void): void;
  onError(listener: (error: Error) => void): void;
}

export type RelaySocketFactory = (url: string) => RelaySocket;

export interface RelayClientOptions {
  baseUrl: string;
  accessToken?: string;
  refreshToken?: string;
  onTokens?: (tokens: AuthTokens) => void | Promise<void>;
  socketFactory?: RelaySocketFactory;
}

export interface RealtimeConnection {
  close(code?: number, reason?: string): void;
  on(event: "error", listener: (error: Error) => void): this;
}

export interface MultiplayerClientContract {
  signup(input: { username: string; displayName: string; email: string; password: string }): Promise<AuthResult>;
  login(email: string, password: string): Promise<AuthResult>;
  refresh(): Promise<AuthTokens>;
  logout(): Promise<void>;
  me(): Promise<UserView>;
  user(username: string): Promise<UserView>;
  createApp(name: string, slug?: string): Promise<ApplicationView>;
  apps(): Promise<ApplicationView[]>;
  members(appId: string): Promise<Array<{ user: UserView; role: string; joinedAt: string }>>;
  invite(appId: string, username: string): Promise<{ id: string }>;
  invitations(): Promise<Array<{ id: string; application: ApplicationView; createdAt: string }>>;
  acceptInvitation(id: string): Promise<{ applicationId: string }>;
  conversations(appId: string): Promise<ConversationView[]>;
  direct(appId: string, username: string): Promise<ConversationView>;
  createGroup(appId: string, name: string, usernames: string[]): Promise<ConversationView>;
  messages(conversationId: string, limit?: number): Promise<MessageView[]>;
  sendMessage(conversationId: string, body: string): Promise<MessageView>;
  realtime(onEvent: (event: RealtimeEvent) => void): RealtimeConnection;
}

export class RelayError extends Error {
  constructor(public readonly status: number, message: string) { super(message); }
}

export function browserSocketFactory(url: string): RelaySocket {
  const Socket = globalThis.WebSocket;
  if (typeof Socket !== "function") {
    throw new RelayError(500, "WebSocket is unavailable in this runtime. Use @relay/sdk/node or provide socketFactory.");
  }
  const socket = new Socket(url);
  return {
    close: (code, reason) => socket.close(code, reason),
    onMessage: (listener) => socket.addEventListener("message", (event) => listener(event.data)),
    onError: (listener) => socket.addEventListener("error", () => listener(new Error("Relay WebSocket connection failed"))),
  };
}

async function socketDataToText(data: unknown): Promise<string> {
  if (typeof data === "string") return data;
  if (data instanceof ArrayBuffer) return new TextDecoder().decode(data);
  if (ArrayBuffer.isView(data)) return new TextDecoder().decode(data);
  if (data && typeof (data as { text?: unknown }).text === "function") {
    return (data as { text(): Promise<string> }).text();
  }
  return String(data);
}

export class MultiplayerClient implements MultiplayerClientContract {
  private accessToken?: string;
  private refreshToken?: string;
  private readonly baseUrl: string;
  private readonly onTokens?: RelayClientOptions["onTokens"];
  private readonly socketFactory: RelaySocketFactory;

  constructor(options: RelayClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, "");
    this.accessToken = options.accessToken;
    this.refreshToken = options.refreshToken;
    this.onTokens = options.onTokens;
    this.socketFactory = options.socketFactory ?? browserSocketFactory;
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

  realtime(onEvent: (event: RealtimeEvent) => void): RealtimeConnection {
    if (!this.accessToken) throw new RelayError(401, "Login is required");
    const url = new URL(this.baseUrl);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    url.pathname = `${url.pathname.replace(/\/$/, "")}/realtime`;
    url.searchParams.set("token", this.accessToken);
    const socket = this.socketFactory(url.toString());
    socket.onMessage(async (data) => onEvent(JSON.parse(await socketDataToText(data)) as RealtimeEvent));
    const connection: RealtimeConnection = {
      close: (code, reason) => socket.close(code, reason),
      on: (_event, listener) => {
        socket.onError(listener);
        return connection;
      },
    };
    return connection;
  }
}

export * from "@relay/shared";
