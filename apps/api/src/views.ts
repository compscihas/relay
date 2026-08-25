import type { MessageView, UserView } from "@relay/shared";

export function userView(user: { id: string; username: string; displayName: string; email?: string; createdAt: Date }, includeEmail = false): UserView {
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    ...(includeEmail && user.email ? { email: user.email } : {}),
    createdAt: user.createdAt.toISOString(),
  };
}

export function messageView(row: {
  id: string; conversationId: string; body: string; createdAt: Date; editedAt: Date | null;
  sender: { id: string; username: string; displayName: string; createdAt: Date };
}): MessageView {
  return {
    id: row.id,
    conversationId: row.conversationId,
    sender: userView(row.sender),
    body: row.body,
    createdAt: row.createdAt.toISOString(),
    editedAt: row.editedAt?.toISOString() ?? null,
  };
}

