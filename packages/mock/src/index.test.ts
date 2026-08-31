import { describe, expect, it, vi } from "vitest";
import { RelayError, type MultiplayerClientContract } from "@relay/sdk";
import { createMockRelay } from "./index.js";

describe("mock Relay backend", () => {
  it("supports the Phase 1 flow without a server", async () => {
    const backend = createMockRelay();
    const owner: MultiplayerClientContract = backend.createClient();
    const member: MultiplayerClientContract = backend.createClient();
    const outsider: MultiplayerClientContract = backend.createClient();

    await owner.signup({ username: "hasan", displayName: "Hasan", email: "hasan@example.test", password: "password123" });
    await member.signup({ username: "jordan", displayName: "Jordan", email: "jordan@example.test", password: "password123" });
    await outsider.signup({ username: "miles", displayName: "Miles", email: "miles@example.test", password: "password123" });

    const application = await owner.createApp("Pokemon Draft");
    const invitation = await owner.invite(application.id, "@jordan");
    expect(await member.invitations()).toHaveLength(1);
    await member.acceptInvitation(invitation.id);
    expect(await owner.members(application.id)).toHaveLength(2);

    const room = (await member.conversations(application.id))[0]!;
    const received = vi.fn();
    const connection = member.realtime(received);
    await owner.sendMessage(room.id, "Choose your starter");
    expect(received).toHaveBeenCalledWith(expect.objectContaining({ type: "message.created", data: expect.objectContaining({ body: "Choose your starter" }) }));
    expect((await member.messages(room.id))[0]?.sender.username).toBe("hasan");
    connection.close();

    await expect(outsider.conversations(application.id)).rejects.toMatchObject({ status: 403 } satisfies Partial<RelayError>);
  });

  it("rotates mock refresh tokens and restores a session", async () => {
    const backend = createMockRelay();
    let savedTokens: { accessToken: string; refreshToken: string } | undefined;
    const first = backend.createClient({ onTokens: (tokens) => { savedTokens = tokens; } });
    await first.signup({ username: "user", displayName: "User", email: "user@example.test", password: "password123" });
    const restored = backend.createClient({ ...savedTokens, onTokens: (tokens) => { savedTokens = tokens; } });
    expect((await restored.me()).username).toBe("user");
    const oldRefreshToken = savedTokens!.refreshToken;
    await restored.refresh();
    expect(savedTokens!.refreshToken).not.toBe(oldRefreshToken);
  });
});
