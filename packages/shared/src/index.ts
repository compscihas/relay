export type Role = "owner" | "member";
export type ConversationType = "direct" | "group";

export interface UserView {
  id: string;
  username: string;
  displayName: string;
  email?: string;
  createdAt: string;
}

export interface ApplicationView {
  id: string;
  name: string;
  slug: string;
  ownerId: string;
  role: Role;
  createdAt: string;
}

export interface ConversationView {
  id: string;
  applicationId: string;
  type: ConversationType;
  name: string | null;
  members: UserView[];
  createdAt: string;
}

export interface MessageView {
  id: string;
  conversationId: string;
  sender: UserView;
  body: string;
  createdAt: string;
  editedAt: string | null;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

export interface AuthResult extends AuthTokens { user: UserView }

export type RealtimeEvent =
  | { type: "ready"; userId: string }
  | { type: "message.created"; data: MessageView };

export function normalizeUsername(value: string): string {
  return value.trim().replace(/^@/, "").toLowerCase();
}

